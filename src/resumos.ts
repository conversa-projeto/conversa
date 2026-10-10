import { randomUUID } from 'node:crypto'
import { validarAcessoConversa } from './autorizacao.ts'
import { comUsuario, type Sql } from './banco.ts'
import type { Corpo } from './esquemas.ts'
import { httpErrors } from './erros.ts'
import { completar, iaConfigurada, lerJson } from './ia.ts'

// Resumo da conversa separado por assunto, feito pela IA. Um modelo local pode
// levar minutos, entao o pedido roda em segundo plano: quem pediu recebe o id
// e consulta ate ficar pronto. Os resumos ficam so na memoria, por 30 minutos.

export type PeriodoResumo = '24h' | '7d' | '30d' | 'recentes'

export interface AssuntoResumo {
  titulo: string
  resumo: string
  pendencias: string[]
  // Mensagens de onde o assunto saiu, para a pagina levar ate elas
  mensagens: number[]
}

interface Resumo {
  id: string
  usuario: number
  conversa: number
  periodo: PeriodoResumo
  status: 'processando' | 'concluido' | 'erro'
  mensagens: number
  assuntos: AssuntoResumo[]
  erro: string
  criado: number
}

const resumos = new Map<string, Resumo>()
const VALIDADE_MS = 30 * 60 * 1000

// O que cabe mandar ao modelo: as mais recentes, ate o limite de mensagens e de texto
const LIMITE_MENSAGENS = 400
const LIMITE_CARACTERES = 48_000
const LIMITE_POR_MENSAGEM = 1_500

const INTERVALO: Record<Exclude<PeriodoResumo, 'recentes'>, string> = { '24h': '24 hours', '7d': '7 days', '30d': '30 days' }

const INSTRUCOES = `Você organiza conversas de um chat de trabalho, em português do Brasil.
Leia as mensagens e separe a conversa por assunto. Para cada assunto escreva:
- "titulo": curto (até 8 palavras);
- "resumo": objetivo, de 1 a 4 frases, dizendo quem falou o quê quando importar;
- "pendencias": tarefas, decisões a tomar e perguntas sem resposta (lista vazia se não houver);
- "mensagens": os ids (o número entre colchetes) das mensagens que tratam do assunto.
Use só o que está nas mensagens, sem inventar. Ignore cumprimentos e conversa sem conteúdo.
Liste os assuntos na ordem em que começaram. Responda somente com JSON, assim:
{"assuntos":[{"titulo":"...","resumo":"...","pendencias":["..."],"mensagens":[1,2]}]}`

function esquecerVencidos() {
  const agora = Date.now()
  for (const [id, resumo] of resumos) {
    if (agora - resumo.criado > VALIDADE_MS) resumos.delete(id)
  }
}

function resposta(resumo: Resumo) {
  const { id, conversa, periodo, status, mensagens, assuntos, erro } = resumo
  return { id, conversa_id: conversa, periodo, status, mensagens, assuntos, erro }
}

export async function pedirResumo(sql: Sql, usuario: number, corpo: Corpo<'pedirResumo'>) {
  await validarAcessoConversa(sql, usuario, corpo.conversa_id)
  if (!iaConfigurada()) {
    throw httpErrors.badRequest('IA não configurada: defina o endereço e o modelo nas configurações do sistema.')
  }
  esquecerVencidos()
  // O mesmo pedido em andamento nao comeca outro
  for (const resumo of resumos.values()) {
    if (resumo.usuario === usuario && resumo.conversa === corpo.conversa_id && resumo.periodo === corpo.periodo && resumo.status === 'processando') {
      return resposta(resumo)
    }
  }

  const linhas = await mensagensDoPeriodo(sql, usuario, corpo.conversa_id, corpo.periodo)
  const texto = montarTexto(linhas)
  const resumo: Resumo = {
    id: randomUUID(),
    usuario,
    conversa: corpo.conversa_id,
    periodo: corpo.periodo,
    status: texto.ids.size ? 'processando' : 'concluido',
    mensagens: texto.ids.size,
    assuntos: [],
    erro: '',
    criado: Date.now(),
  }
  resumos.set(resumo.id, resumo)
  if (texto.ids.size) {
    void gerar(resumo, corpo.conversa_id, texto)
  }
  return resposta(resumo)
}

export function consultarResumo(usuario: number, id: string) {
  const resumo = resumos.get(id)
  if (!resumo || resumo.usuario !== usuario) {
    throw httpErrors.notFound('Resumo não encontrado (pode ter expirado). Peça de novo.')
  }
  return resposta(resumo)
}

interface LinhaConteudo {
  id: number
  autor: string
  quando: Date
  tipo: number
  conteudo: string | null
  anexo: string | null
  transcricao: string | null
  pergunta: string | null
}

async function mensagensDoPeriodo(sql: Sql, usuario: number, conversa: number, periodo: PeriodoResumo) {
  const quando = sql`coalesce(m.visivel_em, m.inserida)`
  return sql<LinhaConteudo[]>`
    with escolhidas as
         ( select m.id
             from mensagem m
            where m.conversa_id = ${conversa}
              and m.excluida_em is null
              and (m.usuario_id = ${usuario} or m.visivel_em is null or m.visivel_em <= now())
              ${periodo === 'recentes' ? sql`` : sql`and ${quando} >= now() - ${INTERVALO[periodo]}::interval`}
            order by ${quando} desc, m.id desc
            limit ${LIMITE_MENSAGENS}
         )
  select m.id
       , u.nome as autor
       , ${quando} as quando
       , mc.tipo
       , convert_from(mc.conteudo, 'utf-8') as conteudo
       , a.nome as anexo
       , t.texto as transcricao
       , e.pergunta
    from escolhidas es
   inner join mensagem m on m.id = es.id
   inner join usuario u on u.id = m.usuario_id
   inner join mensagem_conteudo mc on mc.mensagem_id = m.id
    left join anexo a on mc.tipo in (2, 3, 4, 5) and a.identificador = convert_from(mc.conteudo, 'utf-8')
    left join anexo_transcricao t on mc.tipo in (4, 5) and t.identificador = convert_from(mc.conteudo, 'utf-8') and t.status = 2
    left join enquete e on mc.tipo = 8 and e.id::text = convert_from(mc.conteudo, 'utf-8')
   order by ${quando}, m.id, mc.ordem`
}

// Uma linha por mensagem: "[id] 09/10 14:32 Ana: texto". As mais antigas saem
// primeiro quando o texto passa do limite.
function montarTexto(linhas: LinhaConteudo[]) {
  const porMensagem = new Map<number, { cabecalho: string; partes: string[] }>()
  for (const linha of linhas) {
    let mensagem = porMensagem.get(linha.id)
    if (!mensagem) {
      const data = new Date(linha.quando).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
      mensagem = { cabecalho: `[${linha.id}] ${data.replace(',', '')} ${linha.autor}:`, partes: [] }
      porMensagem.set(linha.id, mensagem)
    }
    const parte = descreverConteudo(linha)
    if (parte) mensagem.partes.push(parte)
  }

  const textos: { id: number; texto: string }[] = []
  for (const [id, { cabecalho, partes }] of porMensagem) {
    if (partes.length) textos.push({ id, texto: `${cabecalho} ${partes.join(' ').slice(0, LIMITE_POR_MENSAGEM)}` })
  }
  let total = 0
  let inicio = textos.length
  while (inicio > 0 && total + textos[inicio - 1]!.texto.length <= LIMITE_CARACTERES) {
    inicio--
    total += textos[inicio]!.texto.length + 1
  }
  const escolhidos = textos.slice(inicio)
  return { ids: new Set(escolhidos.map((t) => t.id)), texto: escolhidos.map((t) => t.texto).join('\n') }
}

function descreverConteudo(linha: LinhaConteudo) {
  switch (linha.tipo) {
    case 1:
      // Mencao @[Nome](id) vira @Nome
      return (linha.conteudo ?? '').replace(/@\[([^\]]+)\]\(\d+\)/g, '@$1').replace(/\s+/g, ' ').trim()
    case 2:
      return '[imagem]'
    case 3:
      return `[arquivo${linha.anexo ? `: ${linha.anexo}` : ''}]`
    case 4:
    case 5:
      return linha.transcricao ? `[áudio: "${linha.transcricao.replace(/\s+/g, ' ').trim()}"]` : '[áudio]'
    case 8:
      return linha.pergunta ? `[votação: ${linha.pergunta}]` : '[votação]'
    default:
      return ''
  }
}

async function gerar(resumo: Resumo, conversa: number, conteudo: { ids: Set<number>; texto: string }) {
  try {
    const titulo = await comUsuario(0, async (sql) => {
      const [linha] = await sql<{ descricao: string | null; tipo: number }[]>`select descricao, tipo from conversa where id = ${conversa}`
      return linha?.tipo === 2 && linha.descricao ? `Grupo "${linha.descricao}"` : 'Conversa direta'
    })
    const texto = await completar([
      { role: 'system', content: INSTRUCOES },
      { role: 'user', content: `${titulo}. Mensagens (id, data, autor: texto):\n${conteudo.texto}` },
    ], { json: true })
    resumo.assuntos = lerAssuntos(lerJson(texto), conteudo.ids)
    if (!resumo.assuntos.length) {
      throw new Error('A IA não encontrou assuntos para resumir.')
    }
    resumo.status = 'concluido'
  } catch (erro) {
    resumo.status = 'erro'
    resumo.erro = erro instanceof Error ? erro.message : String(erro)
    console.error('[Resumo] Falha ao resumir a conversa', conversa, erro)
  }
}

// Confere o que o modelo devolveu: campos de texto e so ids que foram enviados
export function lerAssuntos(dados: unknown, idsValidos: Set<number>): AssuntoResumo[] {
  const lista = (dados as { assuntos?: unknown })?.assuntos
  if (!Array.isArray(lista)) {
    throw new Error('A resposta da IA não veio no formato esperado.')
  }
  const texto = (valor: unknown) => (typeof valor === 'string' ? valor.trim() : '')
  return lista
    .map((item: Record<string, unknown>) => ({
      titulo: texto(item?.titulo),
      resumo: texto(item?.resumo),
      pendencias: Array.isArray(item?.pendencias) ? item.pendencias.map(texto).filter(Boolean) : [],
      mensagens: Array.isArray(item?.mensagens)
        ? [...new Set(item.mensagens.map(Number).filter((id: number) => idsValidos.has(id)))].sort((a, b) => a - b)
        : [],
    }))
    .filter((assunto) => assunto.titulo && assunto.resumo)
}

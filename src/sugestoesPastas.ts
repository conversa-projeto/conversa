import { randomUUID } from 'node:crypto'
import { validarAcessoConversa } from './autorizacao.ts'
import type { Sql } from './banco.ts'
import type { Corpo } from './esquemas.ts'
import { httpErrors } from './erros.ts'
import { completar, iaConfigurada, lerJson } from './ia.ts'
import { descreverConteudo } from './resumos.ts'

// Sugestao de pasta pela IA, quando a pessoa pede (painel de pastas): olha as
// mensagens recentes da conversa direta que ainda nao estao em pasta nenhuma
// e diz, pelo assunto, a pasta de cada uma. A IA conhece cada pasta pelo nome
// e por algumas mensagens que ja estao nela. Nada e posto na pasta aqui: a
// pessoa confirma (PUT /pasta/mensagens) ou ignora. Como o resumo, roda em
// segundo plano e fica so na memoria, por 30 minutos.

export interface SugestaoPasta {
  mensagem_id: number
  pasta_id: number
  autor: string
  texto: string
}

interface Analise {
  id: string
  usuario: number
  conversa: number
  status: 'processando' | 'concluido' | 'erro'
  analisadas: number
  sugestoes: SugestaoPasta[]
  erro: string
  criado: number
}

const analises = new Map<string, Analise>()
const VALIDADE_MS = 30 * 60 * 1000

const LIMITE_MENSAGENS = 80
const LIMITE_CARACTERES = 24_000
const LIMITE_POR_MENSAGEM = 800
const EXEMPLOS_POR_PASTA = 5
const LIMITE_POR_EXEMPLO = 300
const LIMITE_PREVIA = 200

const INSTRUCOES = `Você organiza as mensagens de uma conversa de chat de trabalho em pastas, em português do Brasil.
Você recebe as pastas (id, nome e exemplos de mensagens que já estão nela) e mensagens que ainda não estão em pasta nenhuma.
Para cada mensagem cujo assunto claramente combina com uma pasta, indique essa pasta (no máximo uma por mensagem).
Use o nome da pasta e os exemplos para entender do que ela trata. Na dúvida, não sugira.
Ignore cumprimentos, agradecimentos e mensagens sem conteúdo.
Use só os ids recebidos. Responda somente com JSON, assim:
{"sugestoes":[{"mensagem":123,"pasta":4}]}`

const ESQUEMA = {
  nome: 'sugestao_pastas',
  schema: {
    type: 'object',
    properties: {
      sugestoes: {
        type: 'array',
        items: {
          type: 'object',
          properties: { mensagem: { type: 'integer' }, pasta: { type: 'integer' } },
          required: ['mensagem', 'pasta'],
          additionalProperties: false,
        },
      },
    },
    required: ['sugestoes'],
    additionalProperties: false,
  },
}

function esquecerVencidas() {
  const agora = Date.now()
  for (const [id, analise] of analises) {
    if (agora - analise.criado > VALIDADE_MS) analises.delete(id)
  }
}

function resposta(analise: Analise) {
  const { id, conversa, status, analisadas, sugestoes, erro } = analise
  return { id, conversa_id: conversa, status, analisadas, sugestoes, erro }
}

export async function pedirSugestoes(sql: Sql, usuario: number, corpo: Corpo<'sugerirPastas'>) {
  await validarAcessoConversa(sql, usuario, corpo.conversa_id)
  if (!iaConfigurada()) {
    throw httpErrors.badRequest('IA não configurada: defina o endereço e o modelo nas configurações do sistema.')
  }
  esquecerVencidas()
  for (const analise of analises.values()) {
    if (analise.usuario === usuario && analise.conversa === corpo.conversa_id && analise.status === 'processando') {
      return resposta(analise)
    }
  }

  const pastas = await pastasComExemplos(sql, usuario, corpo.conversa_id)
  if (!pastas.length) {
    throw httpErrors.badRequest('Crie uma pasta antes de pedir sugestões.')
  }
  const mensagens = await mensagensSemPasta(sql, usuario, corpo.conversa_id, corpo.ignorar ?? [])
  const analise: Analise = {
    id: randomUUID(),
    usuario,
    conversa: corpo.conversa_id,
    status: mensagens.size ? 'processando' : 'concluido',
    analisadas: mensagens.size,
    sugestoes: [],
    erro: '',
    criado: Date.now(),
  }
  analises.set(analise.id, analise)
  if (mensagens.size) {
    void gerar(analise, pastas, mensagens)
  }
  return resposta(analise)
}

export function consultarSugestoes(usuario: number, id: string) {
  const analise = analises.get(id)
  if (!analise || analise.usuario !== usuario) {
    throw httpErrors.notFound('Sugestão não encontrada (pode ter expirado). Peça de novo.')
  }
  return resposta(analise)
}

interface LinhaConteudo {
  id: number
  autor: string
  tipo: number
  conteudo: string | null
  anexo: string | null
  transcricao: string | null
  pergunta: string | null
}

interface PastaComExemplos {
  id: number
  nome: string
  exemplos: string[]
}

interface MensagemSemPasta {
  autor: string
  texto: string
}

// Juntar os conteudos de cada mensagem num texto so (a ordem vem da consulta)
function juntarConteudos(linhas: (LinhaConteudo & { pasta_id?: number })[]) {
  const porMensagem = new Map<number, { autor: string; partes: string[]; pasta_id?: number }>()
  for (const linha of linhas) {
    let mensagem = porMensagem.get(linha.id)
    if (!mensagem) {
      mensagem = { autor: linha.autor, partes: [], pasta_id: linha.pasta_id }
      porMensagem.set(linha.id, mensagem)
    }
    const parte = descreverConteudo(linha)
    if (parte) mensagem.partes.push(parte)
  }
  return porMensagem
}

const COLUNAS_CONTEUDO = (sql: Sql) => sql`
       , u.nome as autor
       , mc.tipo
       , convert_from(mc.conteudo, 'utf-8') as conteudo
       , a.nome as anexo
       , t.transcricao
       , e.pergunta`

const JUNCOES_CONTEUDO = (sql: Sql) => sql`
   inner join usuario u on u.id = m.usuario_id
   inner join mensagem_conteudo mc on mc.mensagem_id = m.id
    left join anexo a on mc.tipo in (2, 3, 4, 5) and a.identificador = convert_from(mc.conteudo, 'utf-8')
    left join anexo_audio t on mc.tipo in (4, 5) and t.identificador = convert_from(mc.conteudo, 'utf-8') and t.transcricao_status = 2
    left join enquete e on mc.tipo = 8 and e.id::text = convert_from(mc.conteudo, 'utf-8')`

// As pastas que a pessoa enxerga na conversa, com as ultimas mensagens de cada uma
async function pastasComExemplos(sql: Sql, usuario: number, conversa: number): Promise<PastaComExemplos[]> {
  const pastas = await sql<{ id: number; nome: string }[]>`
    select id, nome
      from pasta
     where conversa_id = ${conversa}
       and (usuario_id = ${usuario} or compartilhada)
     order by lower(nome), id`
  if (!pastas.length) return []
  const linhas = await sql<(LinhaConteudo & { pasta_id: number })[]>`
    with exemplos as
         ( select pasta_id, mensagem_id
             from ( select pm.pasta_id
                         , pm.mensagem_id
                         , row_number() over (partition by pm.pasta_id order by coalesce(m.visivel_em, m.inserida) desc, m.id desc) as posicao
                      from pasta_mensagem pm
                     inner join mensagem m on m.id = pm.mensagem_id
                     where pm.pasta_id in ${sql(pastas.map((p) => p.id))}
                       and m.excluida_em is null
                       and (m.usuario_id = ${usuario} or m.visivel_em is null or m.visivel_em <= now())
                  ) as tbl
            where posicao <= ${EXEMPLOS_POR_PASTA}
         )
  select m.id
       , ex.pasta_id
       ${COLUNAS_CONTEUDO(sql)}
    from exemplos ex
   inner join mensagem m on m.id = ex.mensagem_id
   ${JUNCOES_CONTEUDO(sql)}
   order by ex.pasta_id, m.id, mc.ordem`
  const exemplos = new Map<number, string[]>()
  for (const [, mensagem] of juntarConteudos(linhas)) {
    if (!mensagem.partes.length || mensagem.pasta_id === undefined) continue
    const lista = exemplos.get(mensagem.pasta_id) ?? []
    lista.push(mensagem.partes.join(' ').slice(0, LIMITE_POR_EXEMPLO))
    exemplos.set(mensagem.pasta_id, lista)
  }
  return pastas.map((p) => ({ id: p.id, nome: p.nome, exemplos: exemplos.get(p.id) ?? [] }))
}

// As mais recentes que nao estao em nenhuma pasta que a pessoa enxerga, menos
// as que ela ja ignorou. Mensagem sem texto que a IA entenda (chamada) fica de fora.
async function mensagensSemPasta(sql: Sql, usuario: number, conversa: number, ignorar: number[]) {
  const quando = sql`coalesce(m.visivel_em, m.inserida)`
  const linhas = await sql<LinhaConteudo[]>`
    with escolhidas as
         ( select m.id
             from mensagem m
            where m.conversa_id = ${conversa}
              and m.excluida_em is null
              and (m.usuario_id = ${usuario} or m.visivel_em is null or m.visivel_em <= now())
              and not exists (select 1
                                from pasta_mensagem pm
                               inner join pasta p on p.id = pm.pasta_id
                               where pm.mensagem_id = m.id
                                 and (p.usuario_id = ${usuario} or p.compartilhada))
              ${ignorar.length ? sql`and m.id not in ${sql(ignorar)}` : sql``}
            order by ${quando} desc, m.id desc
            limit ${LIMITE_MENSAGENS}
         )
  select m.id
       ${COLUNAS_CONTEUDO(sql)}
    from escolhidas es
   inner join mensagem m on m.id = es.id
   ${JUNCOES_CONTEUDO(sql)}
   order by ${quando}, m.id, mc.ordem`
  // As mais antigas saem primeiro quando o texto passa do limite
  const textos: [number, MensagemSemPasta][] = []
  for (const [id, mensagem] of juntarConteudos(linhas)) {
    if (mensagem.partes.length) textos.push([id, { autor: mensagem.autor, texto: mensagem.partes.join(' ').slice(0, LIMITE_POR_MENSAGEM) }])
  }
  let total = 0
  let inicio = textos.length
  while (inicio > 0 && total + textos[inicio - 1]![1].texto.length <= LIMITE_CARACTERES) {
    inicio--
    total += textos[inicio]![1].texto.length + 1
  }
  return new Map(textos.slice(inicio))
}

async function gerar(analise: Analise, pastas: PastaComExemplos[], mensagens: Map<number, MensagemSemPasta>) {
  try {
    const textoPastas = pastas
      .map((p) => `Pasta ${p.id}: "${p.nome}"${p.exemplos.length ? `\n${p.exemplos.map((e) => `  - ${e}`).join('\n')}` : ' (ainda sem mensagens)'}`)
      .join('\n')
    const textoMensagens = [...mensagens].map(([id, m]) => `[${id}] ${m.autor}: ${m.texto}`).join('\n')
    const texto = await completar([
      { role: 'system', content: INSTRUCOES },
      { role: 'user', content: `Pastas:\n${textoPastas}\n\nMensagens sem pasta (id, autor: texto):\n${textoMensagens}` },
    ], { esquema: ESQUEMA, semRaciocinio: true })
    analise.sugestoes = lerSugestoes(lerJson(texto), mensagens, new Set(pastas.map((p) => p.id)))
    analise.status = 'concluido'
  } catch (erro) {
    analise.status = 'erro'
    analise.erro = erro instanceof Error ? erro.message : String(erro)
    console.error('[Pastas] Falha ao sugerir pastas', analise.conversa, erro)
  }
}

// Confere o que o modelo devolveu: so mensagens e pastas enviadas, uma pasta
// por mensagem (a primeira), na ordem das mensagens na conversa
export function lerSugestoes(dados: unknown, mensagens: Map<number, MensagemSemPasta>, pastas: Set<number>): SugestaoPasta[] {
  const lista = (dados as { sugestoes?: unknown })?.sugestoes
  if (!Array.isArray(lista)) {
    throw new Error('A resposta da IA não veio no formato esperado.')
  }
  const escolhidas = new Map<number, number>()
  for (const item of lista as Record<string, unknown>[]) {
    const mensagem = Number(item?.mensagem)
    const pasta = Number(item?.pasta)
    if (mensagens.has(mensagem) && pastas.has(pasta) && !escolhidas.has(mensagem)) escolhidas.set(mensagem, pasta)
  }
  return [...mensagens]
    .filter(([id]) => escolhidas.has(id))
    .map(([id, m]) => ({
      mensagem_id: id,
      pasta_id: escolhidas.get(id)!,
      autor: m.autor,
      texto: m.texto.length > LIMITE_PREVIA ? `${m.texto.slice(0, LIMITE_PREVIA - 1)}…` : m.texto,
    }))
}

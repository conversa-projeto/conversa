import type { Fragmento, Sql } from './banco.ts'
import { validarAcessoConversa, validarExclusaoMensagem } from './autorizacao.ts'
import { dataIso, excluir, inserir } from './comum.ts'
import type { Corpo } from './esquemas.ts'
import type { StatusTranscricao, TipoConteudo } from './tabelas.ts'
import { urlPublica } from './minio.ts'
import { notificarNovaMensagemConversa, notificarStatusMensagens } from './notificacoes.ts'
import { httpErrors } from './erros.ts'
import { notificarReacao } from './websocket.ts'
import {
  apagarAtividadeReacao,
  apagarAtividadesMensagem,
  avisarAtividadesMensagem,
  idsMencionados,
  registrarAtividades,
  TipoAtividade,
  type NovaAtividade,
} from './atividades.ts'


// --- Formato das mensagens devolvidas ao cliente ---

interface ConteudoResposta {
  id: number
  ordem: number
  tipo: TipoConteudo
  conteudo: string
  nome: string
  extensao: string
  transcricao_status: StatusTranscricao
  transcricao: string
}

// Mensagem respondida ou encaminhada, com a propria referencia (ate 5 niveis)
interface MensagemResumida {
  id: number
  conversa_id: number
  remetente: string
  inserida: Date
  excluida_em: Date | null
  conteudos: ConteudoResposta[]
  mensagem_referencia?: ReferenciaResposta
}

interface ReferenciaResposta {
  tipo: number
  mensagem?: MensagemResumida
}

interface ReacaoUsuarioResposta {
  usuario_id: number
  nome: string
  reagido_em: Date
  avatar_url: string | null
}

interface ReacaoResposta {
  emoji: string
  quantidade: number
  reagiu: boolean
  usuarios: ReacaoUsuarioResposta[]
}

export interface MensagemResposta {
  id: number
  remetente_id: number
  remetente: string
  conversa_id: number
  inserida: Date
  alterada: Date | null
  visivel_em: Date | null
  excluida_em: Date | null
  mensagem_referencia?: ReferenciaResposta
  recebida: boolean
  visualizada: boolean
  reproduzida: boolean
  conteudos: ConteudoResposta[]
  reacoes?: ReacaoResposta[]
}

// --- Linhas das consultas ---

interface ConteudoLinha {
  id: number
  ordem: number
  tipo: TipoConteudo
  conteudo: string | null
  nome: string | null
  extensao: string | null
  transcricao_status: StatusTranscricao | null
  transcricao: string | null
}

interface MensagemLinha {
  id: number
  remetente_id: number
  remetente: string | null
  conversa_id: number
  inserida: Date
  alterada: Date | null
  visivel_em: Date | null
  excluida_em: Date | null
  referencia_tipo: number | null
  referencia_origem_mensagem_id: number | null
}

// Somas por mensagem: quantos destinatarios receberam, viram e ouviram
interface StatusLinha {
  recebida: number
  visualizada: number
  reproduzida: number
  total: number
}

interface ReacaoLinha {
  emoji: string
  quantidade: number
  reagiu: boolean
  // json_agg: datas chegam como texto (com fuso), convertidas na resposta
  usuarios: { usuario_id: number; nome: string; avatar_objeto: string | null; reagido_em: string }[]
}

// Texto da notificacao: conteudos separados por " | ".
// Texto de uma linha para a notificacao, como nas previas do app: mencao
// vira @Nome e cada bloco de codigo vira "Código (linguagem)".
function resumirTexto(texto: string) {
  return texto
    .replace(/@\[([^\]]+)\]\(\d+\)/g, '@$1')
    .replace(/(`{3,})(\w*)\n([\s\S]*?)(?:\n\1`*|\1`*(?=\s*$))/g, (_, _cerca: string, linguagem: string) => ` Código${linguagem ? ` (${linguagem})` : ''} `)
    .replace(/\s+/g, ' ')
    .trim()
}

const FIGURINHA = /^[a-z0-9-]{1,40}\/[a-z0-9-]{1,40}$/

function textoConteudo(tipo: number, conteudo: string) {
  switch (tipo) {
    case 1: return resumirTexto(conteudo)
    case 2: return 'imagem'
    case 3: return 'arquivo'
    case 7: return 'figurinha'
    default: return ''
  }
}

export async function incluirMensagem(sql: Sql, usuario: number, corpo: Corpo<'incluirMensagem'>) {
  await validarAcessoConversa(sql, usuario, corpo.conversa_id)

  // visivel_em: agendamento entre agora + 5 min e agora + 1 ano, cortado no minuto.
  let visivelEm: string | undefined
  if (typeof corpo.visivel_em === 'string' && corpo.visivel_em.trim()) {
    const data = dataIso(corpo.visivel_em)
    if (!data) {
      throw httpErrors.badRequest('visivel_em inválido (use ISO-8601 com offset).')
    }
    data.setUTCSeconds(0, 0)
    const limiteMaximo = new Date()
    limiteMaximo.setUTCFullYear(limiteMaximo.getUTCFullYear() + 1)
    if (data.getTime() < Date.now() + 5 * 60 * 1000) {
      throw httpErrors.badRequest('visivel_em deve estar a pelo menos 5 minutos no futuro.')
    }
    if (data > limiteMaximo) {
      throw httpErrors.badRequest('visivel_em não pode estar mais de 1 ano no futuro.')
    }
    visivelEm = data.toISOString()
  }
  const agendada = visivelEm !== undefined

  const conteudos = corpo.conteudos
  if (agendada && conteudos.some((item) => item.tipo === 6)) {
    throw httpErrors.badRequest('Mensagens agendadas não podem ser de chamada (tipo 6).')
  }

  // Figurinha: o conteudo e o identificador pacote/nome; a animacao fica no
  // cliente, entao so aceita o formato do identificador
  if (conteudos.some((item) => item.tipo === 7 && !FIGURINHA.test(item.conteudo ?? ''))) {
    throw httpErrors.badRequest('Figurinha inválida!')
  }

  const referencia = corpo.mensagem_referencia
  if (referencia && referencia.tipo !== 1 && referencia.tipo !== 2) {
    throw httpErrors.badRequest('Tipo de referência inválido!')
  }

  const mensagem = await inserir(
    sql,
    'mensagem',
    { conversa_id: corpo.conversa_id, usuario_id: usuario, visivel_em: visivelEm },
    ['conversa_id', 'usuario_id', 'visivel_em'],
  )

  let referenciaGravada: { tipo: number; origem_mensagem_id: number } | undefined
  if (referencia && referencia.origem_mensagem_id > 0) {
    await inserir(
      sql,
      'mensagem_referencia',
      { tipo: referencia.tipo, origem_mensagem_id: mensagem.id, destino_mensagem_id: referencia.origem_mensagem_id },
      ['tipo', 'origem_mensagem_id', 'destino_mensagem_id'],
    )
    referenciaGravada = { tipo: referencia.tipo, origem_mensagem_id: referencia.origem_mensagem_id }
  }

  await sql`
    insert into mensagem_status (conversa_id, usuario_id, mensagem_id)
    select cu.conversa_id, cu.usuario_id, m.id
      from mensagem m
     inner join conversa_usuario cu
        on cu.conversa_id = m.conversa_id
       and cu.usuario_id <> ${usuario}
     where m.id = ${mensagem.id}`

  const partes: string[] = []
  for (const item of conteudos) {
    await sql`
      insert into mensagem_conteudo (mensagem_id, ordem, tipo, conteudo)
      values (${mensagem.id}, ${item.ordem}, ${item.tipo}, convert_to(${item.conteudo ?? null}, 'UTF8'))`
    partes.push(textoConteudo(item.tipo, item.conteudo ?? ''))
  }

  await registrarAtividadesMensagem(sql, usuario, corpo.conversa_id, mensagem.id, conteudos, referencia, visivelEm)

  // Agendadas so notificam quando amadurecem, pelo agendador.
  if (!agendada) {
    await notificarNovaMensagemConversa(sql, usuario, corpo.conversa_id, partes.filter(Boolean).join(' | '))
  }
  return referenciaGravada ? { ...mensagem, mensagem_referencia: referenciaGravada } : mensagem
}

// Resposta a mensagem de outra pessoa e mencoes (so de membros da conversa)
// viram atividade de quem foi respondido ou mencionado. Respondido e mencionado
// na mesma mensagem recebe uma so: a resposta.
async function registrarAtividadesMensagem(
  sql: Sql,
  usuario: number,
  conversa: number,
  mensagem: number,
  conteudos: Corpo<'incluirMensagem'>['conteudos'],
  referencia: Corpo<'incluirMensagem'>['mensagem_referencia'],
  visivelEm: string | undefined,
) {
  const base = { autor_id: usuario, conversa_id: conversa, mensagem_id: mensagem, criado_em: visivelEm ?? null }
  const novas: NovaAtividade[] = []
  let respondido: number | undefined
  if (referencia?.tipo === 1 && referencia.origem_mensagem_id > 0) {
    const [original] = await sql<{ usuario_id: number }[]>`
      select usuario_id from mensagem where id = ${referencia.origem_mensagem_id} and conversa_id = ${conversa}`
    respondido = original?.usuario_id
    if (respondido) {
      novas.push({ ...base, usuario_id: respondido, tipo: TipoAtividade.Resposta })
    }
  }
  const textos = conteudos.filter((c) => c.tipo === 1).map((c) => c.conteudo ?? '').join('\n')
  const mencionados = idsMencionados(textos).filter((id) => id !== respondido)
  if (mencionados.length) {
    const membros = await sql<{ usuario_id: number }[]>`
      select usuario_id from conversa_usuario where conversa_id = ${conversa} and usuario_id in ${sql(mencionados)}`
    for (const { usuario_id } of membros) {
      novas.push({ ...base, usuario_id, tipo: TipoAtividade.Mencao })
    }
  }
  await registrarAtividades(sql, novas)
}

export async function notificarMensagemAgendada(sql: Sql, mensagemId: number) {
  const [mensagem] = await sql<{ id: number; usuario_id: number; conversa_id: number; tipo: number | null; conteudo: string | null }[]>`
    select m.id
         , m.usuario_id
         , m.conversa_id
         , mc.tipo
         , convert_from(mc.conteudo, 'utf-8') as conteudo
      from mensagem m
      left join mensagem_conteudo mc
        on mc.mensagem_id = m.id
       and mc.ordem = 1
     where m.id = ${mensagemId}`
  if (!mensagem) {
    return
  }
  const texto = mensagem.tipo === 4 || mensagem.tipo === 5 ? 'áudio' : textoConteudo(mensagem.tipo ?? 0, mensagem.conteudo ?? '')
  await notificarNovaMensagemConversa(sql, mensagem.usuario_id, mensagem.conversa_id, texto)
  await notificarStatusMensagens(sql, mensagem.usuario_id, mensagem.conversa_id, String(mensagemId))
  await avisarAtividadesMensagem(sql, mensagemId)
}

// Excluir marca a mensagem: ela continua na conversa como excluida, com o
// conteudo guardado, e a marca chega aos outros como mudanca de status. So a
// agendada que ainda nao saiu (ninguem viu) e apagada de vez.
export async function excluirMensagem(sql: Sql, usuario: number, mensagem: number) {
  await validarExclusaoMensagem(sql, usuario, mensagem)

  const [alvo] = await sql<{ conversa_id: number; agendada: boolean; excluida_em: Date | null }[]>`
    select conversa_id
         , coalesce(visivel_em > now(), false) as agendada
         , excluida_em
      from mensagem
     where id = ${mensagem}`
  if (!alvo!.agendada) {
    if (alvo!.excluida_em) {
      return { id: mensagem, conversa_id: alvo!.conversa_id, excluida_em: alvo!.excluida_em }
    }
    const [marcada] = await sql<{ excluida_em: Date }[]>`
      update mensagem
         set excluida_em = now()
           , excluida_por = ${usuario}
       where id = ${mensagem}
   returning excluida_em`
    await apagarAtividadesMensagem(sql, mensagem)
    await notificarStatusMensagens(sql, usuario, alvo!.conversa_id, String(mensagem))
    return { id: mensagem, conversa_id: alvo!.conversa_id, excluida_em: marcada!.excluida_em }
  }

  // Dependentes primeiro: todos apontam para mensagem.id sem cascade.
  await sql`delete from mensagem_referencia where origem_mensagem_id = ${mensagem} or destino_mensagem_id = ${mensagem}`
  await sql`delete from mensagem_status where mensagem_id = ${mensagem}`
  await sql`delete from reacao where mensagem_id = ${mensagem}`
  await apagarAtividadesMensagem(sql, mensagem)

  const conteudo = await excluir(sql, 'mensagem_conteudo', mensagem, 'mensagem_id')
  const excluida = await excluir(sql, 'mensagem', mensagem)
  return { ...excluida, conteudo }
}

export async function mensagens(sql: Sql, conversa: number, usuario: number, referencia: number, previas: number, seguintes: number) {
  await validarAcessoConversa(sql, usuario, conversa)

  // Paginacao pelo timestamp efetivo coalesce(visivel_em, inserida), com id como
  // desempate. O cliente manda so o id de referencia e o servidor resolve o par.
  const visivel = () => sql`(m.usuario_id = ${usuario} or m.visivel_em is null or m.visivel_em <= now())`
  const posicao = () => sql`((select coalesce(visivel_em, inserida) from mensagem where id = ${referencia}), ${referencia})`
  const nenhum = sql``

  let script: Fragmento
  if (previas === 0 && seguintes === 0) {
    script = sql`
      select id
        from ( select id
                 from mensagem m
                where m.conversa_id = ${conversa}
                  and ${visivel()}
                  ${referencia > 0 ? sql`and m.id = ${referencia}` : nenhum}
                order by coalesce(m.visivel_em, m.inserida) desc, m.id desc
                limit 1
             ) as tbl`
  } else {
    const anteriores = sql`
      select id
        from ( select id
                 from mensagem m
                where m.conversa_id = ${conversa}
                  and ${visivel()}
                  ${referencia > 0 ? sql`and (coalesce(m.visivel_em, m.inserida), m.id) <= ${posicao()}` : nenhum}
                order by coalesce(m.visivel_em, m.inserida) desc, m.id desc
                limit ${previas}
             ) as tbl`
    const posteriores = sql`
      select id
        from ( select id
                 from mensagem m
                where m.conversa_id = ${conversa}
                  and ${visivel()}
                  ${referencia > 0 ? sql`and (coalesce(m.visivel_em, m.inserida), m.id) >= ${posicao()}` : nenhum}
                order by coalesce(m.visivel_em, m.inserida), m.id
                limit ${seguintes}
             ) as tbl`
    script = previas > 0 && seguintes > 0
      ? sql`${anteriores} union ${posteriores}`
      : previas > 0 ? anteriores : posteriores
  }

  return carregarMensagens(sql, conversa, usuario, script, true)
}

export async function pesquisar(sql: Sql, conversa: number, usuario: number, texto: string) {
  if (!texto.trim()) {
    throw httpErrors.badRequest('Texto inválido!')
  }
  const padrao = `%${texto.replaceAll(' ', ' ').replaceAll(' ', '%')}%`
  const script = sql`
    select id
      from ( select m.id
               from mensagem m
              inner join ( select conversa_id
                             from conversa_usuario
                            where usuario_id = ${usuario}
                            ${conversa > 0 ? sql`and conversa_id = ${conversa}` : sql``}
                         ) as c
                 on c.conversa_id = m.conversa_id
              inner join mensagem_conteudo mc
                 on mc.mensagem_id = m.id
                and mc.tipo = 1 /* 1-Texto */
                and unaccent(convert_from(mc.conteudo, 'UTF8')) ilike unaccent(${padrao})
              where (m.usuario_id = ${usuario} or m.visivel_em is null or m.visivel_em <= now())
                /* Texto de mensagem excluida nao aparece na pesquisa */
                and m.excluida_em is null
              order by m.id
           ) as tbl`

  return carregarMensagens(sql, 0, usuario, script, false)
}

async function carregarConteudos(sql: Sql, mensagemId: number): Promise<ConteudoResposta[]> {
  const linhas = await sql<ConteudoLinha[]>`
    select id, ordem, tipo, conteudo, nome, extensao, transcricao_status, transcricao
      from ( /* Texto, chamada e figurinha */
             select id
                  , ordem
                  , tipo
                  , convert_from(conteudo, 'utf-8') as conteudo
                  , null as nome
                  , null as extensao
                  , null::int4 as transcricao_status
                  , null::text as transcricao
               from mensagem_conteudo
              where mensagem_id = ${mensagemId}
                and tipo in (1, 6, 7)

              union

             /* Arquivos */
             select tbl.id
                  , tbl.ordem
                  , tbl.tipo
                  , tbl.conteudo
                  , a.nome
                  , a.extensao
                  , t.status as transcricao_status
                  , t.texto as transcricao
               from ( select id
                           , ordem
                           , tipo
                           , convert_from(conteudo, 'utf-8') as conteudo
                        from mensagem_conteudo
                       where mensagem_id = ${mensagemId}
                         and tipo in (2, 3, 4, 5)
                    ) as tbl
              inner join anexo a
                 on a.identificador = tbl.conteudo
               left join anexo_transcricao t
                 on t.identificador = tbl.conteudo
           ) as tbl
     order by ordem`
  return linhas.map((linha) => ({
    id: linha.id,
    ordem: linha.ordem,
    tipo: linha.tipo,
    conteudo: linha.conteudo ?? '',
    nome: linha.nome ?? '',
    extensao: linha.extensao ?? '',
    transcricao_status: linha.transcricao_status ?? 0,
    transcricao: linha.transcricao ?? '',
  }))
}

async function mensagemResumida(sql: Sql, id: number): Promise<MensagemResumida | undefined> {
  const [linha] = await sql<{ id: number; conversa_id: number; inserida: Date; excluida_em: Date | null; remetente: string | null }[]>`
    select m.id
         , m.conversa_id
         , m.inserida
         , m.excluida_em
         , substring(trim(u.nome) from '^([^ ]+)') as remetente
      from mensagem m
     inner join usuario u
        on u.id = m.usuario_id
     where m.id = ${id}`
  if (!linha) {
    return undefined
  }
  return {
    id: linha.id,
    conversa_id: linha.conversa_id,
    remetente: linha.remetente ?? '',
    inserida: linha.inserida,
    excluida_em: linha.excluida_em,
    conteudos: await carregarConteudos(sql, linha.id),
  }
}

// Cadeia de respostas e encaminhamentos, ate 5 niveis.
async function carregarReferencia(sql: Sql, mensagemId: number, destino: MensagemResumida, profundidade: number) {
  if (profundidade >= 5) {
    return
  }
  const [referencia] = await sql<{ tipo: number; destino_mensagem_id: number }[]>`
    select mr.tipo, mr.destino_mensagem_id
      from mensagem_referencia mr
     where mr.origem_mensagem_id = ${mensagemId}
     order by mr.id desc
     limit 1`
  if (!referencia) {
    return
  }
  const objeto: ReferenciaResposta = { tipo: referencia.tipo }
  destino.mensagem_referencia = objeto
  const alvo = await mensagemResumida(sql, referencia.destino_mensagem_id)
  if (alvo) {
    await carregarReferencia(sql, alvo.id, alvo, profundidade + 1)
    objeto.mensagem = alvo
  }
}

async function carregarMensagens(sql: Sql, conversa: number, usuario: number, script: Fragmento, marcarComoRecebida: boolean): Promise<MensagemResposta[]> {
  const linhas = await sql<MensagemLinha[]>`
    select *
      from ( select m.id
                  , m.usuario_id as remetente_id
                  , substring(trim(u.nome) from '^([^ ]+)') as remetente
                  , m.conversa_id
                  , m.inserida
                  , m.alterada
                  , m.visivel_em
                  , m.excluida_em
                  , mr.tipo as referencia_tipo
                  , mr.destino_mensagem_id as referencia_origem_mensagem_id
               from ( select m.*
                        from (${script}) as tm
                       inner join mensagem m
                          on m.id = tm.id
                    ) as m
               left join lateral
                    ( select tipo
                           , destino_mensagem_id
                        from mensagem_referencia mr
                       where mr.origem_mensagem_id = m.id
                       order by mr.id desc
                       limit 1
                    ) as mr
                 on true
              inner join usuario as u
                 on u.id = m.usuario_id
              order by coalesce(m.visivel_em, m.inserida) desc, m.id desc
              limit 100
           ) as tbl
     order by coalesce(visivel_em, inserida), id`

  if (marcarComoRecebida) {
    const recebidas = await sql<{ mensagem_id: number }[]>`
      update mensagem_status
         set recebida = now()
       where conversa_id = ${conversa}
         and usuario_id = ${usuario}
         and recebida is null
   returning mensagem_id`
    if (recebidas.length) {
      await notificarStatusMensagens(sql, usuario, conversa, recebidas.map((linha) => linha.mensagem_id).join(','))
    }
  }

  const resultado: MensagemResposta[] = []
  for (const linha of linhas) {
    let mensagemReferencia: ReferenciaResposta | undefined
    if (linha.referencia_tipo !== null && linha.referencia_origem_mensagem_id !== null) {
      mensagemReferencia = { tipo: linha.referencia_tipo }
      const alvo = await mensagemResumida(sql, linha.referencia_origem_mensagem_id)
      if (alvo) {
        await carregarReferencia(sql, alvo.id, alvo, 1)
        mensagemReferencia.mensagem = alvo
      }
    }

    // O remetente ve o status somado de todos. Os demais veem so o proprio.
    const [status] = await sql<StatusLinha[]>`
      select sum(case when recebida is null then 0 else 1 end) as recebida
           , sum(case when visualizada is null then 0 else 1 end) as visualizada
           , sum(case when reproduzida is null then 0 else 1 end) as reproduzida
           , count(1) as total
        from mensagem_status ms
       where ms.mensagem_id = ${linha.id}
         ${linha.remetente_id !== usuario ? sql`and ms.usuario_id = ${usuario}` : sql``}
       group by mensagem_id`
    const total = status?.total ?? 0
    const conteudos = await carregarConteudos(sql, linha.id)

    const reacoes = await sql<ReacaoLinha[]>`
      select r.emoji
           , count(1) as quantidade
           , bool_or(r.usuario_id = ${usuario}) as reagiu
           , json_agg(json_build_object('usuario_id', r.usuario_id, 'nome', u.nome, 'avatar_objeto', a.objeto, 'reagido_em', r.criado_em at time zone 'UTC') order by r.id) as usuarios
        from reacao r
        join usuario u
          on u.id = r.usuario_id
        left join anexo as a
          on a.id = u.avatar_anexo_id
       where r.mensagem_id = ${linha.id}
       group by r.emoji
       order by min(r.id)`
    const reacoesResposta: ReacaoResposta[] = await Promise.all(reacoes.map(async (reacao) => ({
      emoji: reacao.emoji,
      quantidade: reacao.quantidade,
      reagiu: reacao.reagiu,
      usuarios: await Promise.all(reacao.usuarios.map(async ({ avatar_objeto, reagido_em, ...pessoa }) => ({
        ...pessoa,
        reagido_em: new Date(reagido_em),
        avatar_url: avatar_objeto ? await urlPublica('GET', avatar_objeto, 600) : null,
      }))),
    })))

    // Mesmas chaves e na mesma ordem de sempre; referencia e reacoes so quando existem
    resultado.push({
      id: linha.id,
      remetente_id: linha.remetente_id,
      remetente: linha.remetente ?? '',
      conversa_id: linha.conversa_id,
      inserida: linha.inserida,
      alterada: linha.alterada,
      visivel_em: linha.visivel_em,
      excluida_em: linha.excluida_em,
      ...(mensagemReferencia ? { mensagem_referencia: mensagemReferencia } : {}),
      recebida: (status?.recebida ?? 0) === total,
      visualizada: (status?.visualizada ?? 0) === total,
      reproduzida: (status?.reproduzida ?? 0) === total,
      conteudos,
      ...(reacoesResposta.length ? { reacoes: reacoesResposta } : {}),
    })
  }
  return resultado
}

export async function marcarStatus(sql: Sql, usuario: number, corpo: Corpo<'marcarStatus'>, coluna: 'visualizada' | 'reproduzida') {
  await validarAcessoConversa(sql, usuario, corpo.conversa)
  await sql`
    update mensagem_status
       set ${sql(coluna)} = now()
     where conversa_id = ${corpo.conversa}
       and mensagem_id = ${corpo.mensagem}
       and usuario_id = ${usuario}
       and ${sql(coluna)} is null`
  await notificarStatusMensagens(sql, usuario, corpo.conversa, String(corpo.mensagem))
  return { sucesso: true }
}

export async function statusMensagens(sql: Sql, conversa: number, usuario: number, lista: string) {
  await validarAcessoConversa(sql, usuario, conversa)
  const ids = lista.split(',').map((parte) => parte.trim()).filter(Boolean).map(Number)
  if (ids.some((id) => !Number.isInteger(id))) {
    throw httpErrors.badRequest('O parâmetro "mensagem" deve ser uma lista de ids separados por vírgula!')
  }
  if (!ids.length) {
    return []
  }
  const linhas = await sql<({ conversa_id: number; mensagem_id: number; excluida_em: Date | null } & StatusLinha)[]>`
    select ms.conversa_id
         , ms.mensagem_id
         , sum(case when ms.recebida is null then 0 else 1 end) as recebida
         , sum(case when ms.visualizada is null then 0 else 1 end) as visualizada
         , sum(case when ms.reproduzida is null then 0 else 1 end) as reproduzida
         , count(*) as total
         , max(m.excluida_em) as excluida_em
      from mensagem_status ms
     inner join mensagem m
        on m.id = ms.mensagem_id
     where ms.conversa_id = ${conversa}
       and ms.mensagem_id in ${sql(ids)}
     group by ms.conversa_id, ms.mensagem_id
     order by ms.mensagem_id`
  return linhas.map((linha) => ({
    conversa_id: linha.conversa_id,
    mensagem_id: linha.mensagem_id,
    recebida: linha.recebida === linha.total,
    visualizada: linha.visualizada === linha.total,
    reproduzida: linha.reproduzida === linha.total,
    excluida_em: linha.excluida_em,
  }))
}

// Quem recebeu, viu e ouviu uma mensagem, com o horário de cada um. Só quem
// enviou a mensagem pode ver.
export async function detalheStatusMensagem(sql: Sql, usuario: number, mensagem: number) {
  const [dados] = await sql<{ conversa_id: number; usuario_id: number }[]>`select conversa_id, usuario_id from mensagem where id = ${mensagem}`
  if (!dados) {
    throw httpErrors.notFound('Mensagem não encontrada!')
  }
  if (dados.usuario_id !== usuario) {
    throw httpErrors.forbidden('Só quem enviou a mensagem vê quem recebeu e visualizou.')
  }
  return sql<{ usuario_id: number; nome: string; recebida: Date | null; visualizada: Date | null; reproduzida: Date | null }[]>`
    select ms.usuario_id
         , u.nome
         , ms.recebida
         , ms.visualizada
         , ms.reproduzida
      from mensagem_status ms
     inner join usuario u
        on u.id = ms.usuario_id
     where ms.mensagem_id = ${mensagem}
     order by ms.visualizada nulls last, ms.recebida nulls last, u.nome`
}

// Cursor pelo timestamp efetivo. Sem "desde", considera desde sempre.
export async function novasMensagens(sql: Sql, usuario: number, desde: string) {
  let inicio = new Date(0)
  if (desde.trim()) {
    const data = dataIso(desde)
    if (!data) {
      throw httpErrors.badRequest('Parâmetro "desde" inválido (use ISO-8601 com offset).')
    }
    inicio = data
  }
  // O cursor vem do navegador, onde o JavaScript so tem milissegundos, mas o
  // PostgreSQL grava microssegundos. Sem truncar os dois lados, a ultima
  // mensagem de cada conversa volta em toda consulta e vira notificacao
  // repetida. A comparacao direta na coluna fica junto so para o indice valer.
  return sql<{ conversa_id: number; mensagem_id: number; ate: Date }[]>`
    select m.conversa_id
         , max(m.id) as mensagem_id
         , date_trunc('milliseconds', max(coalesce(m.visivel_em, m.inserida))) as ate
      from mensagem as m
     inner join conversa_usuario as cu
        on cu.conversa_id = m.conversa_id
       and cu.usuario_id <> m.usuario_id
     where cu.usuario_id = ${usuario}
       and coalesce(m.visivel_em, m.inserida) >= ${inicio.toISOString()}::timestamptz
       and date_trunc('milliseconds', coalesce(m.visivel_em, m.inserida)) > ${inicio.toISOString()}::timestamptz
       and (m.visivel_em is null or m.visivel_em <= now())
       and not exists ( select 1
                          from mensagem_status ms
                         where ms.mensagem_id = m.id
                           and ms.usuario_id = cu.usuario_id
                           and ms.visualizada is not null )
     group by m.conversa_id`
}

export async function alternarReacao(sql: Sql, usuario: number, corpo: Corpo<'reacao'>) {
  const [alvo] = await sql<{ conversa_id: number; usuario_id: number }[]>`select conversa_id, usuario_id from mensagem where id = ${corpo.mensagem_id}`
  if (!alvo) {
    throw httpErrors.notFound('Mensagem não encontrada!')
  }
  await validarAcessoConversa(sql, usuario, alvo.conversa_id)

  const [existe] = await sql<{ id: number }[]>`select id from reacao where mensagem_id = ${corpo.mensagem_id} and usuario_id = ${usuario} and emoji = ${corpo.emoji}`
  let acao: 'add' | 'remove'
  if (existe) {
    await sql`delete from reacao where mensagem_id = ${corpo.mensagem_id} and usuario_id = ${usuario} and emoji = ${corpo.emoji}`
    await apagarAtividadeReacao(sql, corpo.mensagem_id, usuario, corpo.emoji)
    acao = 'remove'
  } else {
    await sql`insert into reacao (mensagem_id, usuario_id, emoji) values (${corpo.mensagem_id}, ${usuario}, ${corpo.emoji})`
    await registrarAtividades(sql, [{
      usuario_id: alvo.usuario_id,
      tipo: TipoAtividade.Reacao,
      autor_id: usuario,
      conversa_id: alvo.conversa_id,
      mensagem_id: corpo.mensagem_id,
      emoji: corpo.emoji,
    }])
    acao = 'add'
  }

  const membros = await sql<{ usuario_id: number }[]>`
    select usuario_id from conversa_usuario where conversa_id = ${alvo.conversa_id} and usuario_id <> ${usuario}`
  for (const { usuario_id } of membros) {
    notificarReacao(alvo.conversa_id, corpo.mensagem_id, usuario, usuario_id, corpo.emoji, acao)
  }

  return { mensagem_id: corpo.mensagem_id, emoji: corpo.emoji, acao }
}

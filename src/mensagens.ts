import sensible from '@fastify/sensible'
import type { Fragmento, Linha, Sql } from './banco.ts'
import { validarAcessoConversa, validarExclusaoMensagem } from './autorizacao.ts'
import { dataIso, excluir, inserir } from './comum.ts'
import { urlPublica } from './minio.ts'
import { notificarNovaMensagemConversa, notificarStatusMensagens } from './notificacoes.ts'
import { notificarReacao } from './websocket.ts'

const { httpErrors } = sensible

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

function textoConteudo(tipo: number, conteudo: string) {
  switch (tipo) {
    case 1: return resumirTexto(conteudo)
    case 2: return 'imagem'
    case 3: return 'arquivo'
    default: return ''
  }
}

export async function incluirMensagem(sql: Sql, usuario: number, corpo: Linha) {
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

  const conteudos: Linha[] = corpo.conteudos
  if (agendada && conteudos.some((item) => item.tipo === 6)) {
    throw httpErrors.badRequest('Mensagens agendadas não podem ser de chamada (tipo 6).')
  }

  const referencia: Linha | null | undefined = corpo.mensagem_referencia
  if (referencia && referencia.tipo !== 1 && referencia.tipo !== 2) {
    throw httpErrors.badRequest('Tipo de referência inválido!')
  }

  const mensagem = await inserir(
    sql,
    'mensagem',
    { conversa_id: corpo.conversa_id, usuario_id: usuario, visivel_em: visivelEm },
    ['conversa_id', 'usuario_id', 'visivel_em'],
  )

  if (referencia && referencia.origem_mensagem_id > 0) {
    await inserir(
      sql,
      'mensagem_referencia',
      { tipo: referencia.tipo, origem_mensagem_id: mensagem.id, destino_mensagem_id: referencia.origem_mensagem_id },
      ['tipo', 'origem_mensagem_id', 'destino_mensagem_id'],
    )
    mensagem.mensagem_referencia = { tipo: referencia.tipo, origem_mensagem_id: referencia.origem_mensagem_id }
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

  // Agendadas so notificam quando amadurecem, pelo agendador.
  if (!agendada) {
    await notificarNovaMensagemConversa(sql, usuario, corpo.conversa_id, partes.filter(Boolean).join(' | '))
  }
  return mensagem
}

export async function notificarMensagemAgendada(sql: Sql, mensagemId: number) {
  const [mensagem] = await sql`
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
  const texto = mensagem.tipo === 4 || mensagem.tipo === 5 ? 'áudio' : textoConteudo(mensagem.tipo, mensagem.conteudo ?? '')
  await notificarNovaMensagemConversa(sql, mensagem.usuario_id, mensagem.conversa_id, texto)
  await notificarStatusMensagens(sql, mensagem.usuario_id, mensagem.conversa_id, String(mensagemId))
}

export async function excluirMensagem(sql: Sql, usuario: number, mensagem: number) {
  await validarExclusaoMensagem(sql, usuario, mensagem)

  // Dependentes primeiro: todos apontam para mensagem.id sem cascade.
  await sql`delete from mensagem_referencia where origem_mensagem_id = ${mensagem} or destino_mensagem_id = ${mensagem}`
  await sql`delete from mensagem_status where mensagem_id = ${mensagem}`
  await sql`delete from reacao where mensagem_id = ${mensagem}`

  const conteudo = await excluir(sql, 'mensagem_conteudo', mensagem, 'mensagem_id')
  const excluida = await excluir(sql, 'mensagem', mensagem)
  excluida.conteudo = conteudo
  return excluida
}

export async function mensagens(sql: Sql, conversa: number, usuario: number, referencia: number, previas: number, seguintes: number) {
  await validarAcessoConversa(sql, usuario, conversa)

  // Paginacao pelo timestamp efetivo coalesce(visivel_em, inserida), com id como
  // desempate. O cliente manda so o id de referencia e o servidor resolve o par.
  const visivel = () => sql`(m.usuario_id = ${usuario} or m.visivel_em is null or m.visivel_em <= now())`
  const posicao = () => sql`((select coalesce(visivel_em, inserida) from mensagem where id = ${referencia}), ${referencia})`
  const nenhum = sql``

  let script
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
    throw new Error('Texto inválido!')
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
              order by m.id
           ) as tbl`

  return carregarMensagens(sql, 0, usuario, script, false)
}

async function carregarConteudos(sql: Sql, mensagemId: number) {
  const linhas = await sql`
    select id, ordem, tipo, conteudo, nome, extensao, transcricao_status, transcricao
      from ( /* Texto e chamada */
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
                and tipo in (1, 6)

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

async function mensagemResumida(sql: Sql, id: number): Promise<Linha | undefined> {
  const [linha] = await sql`
    select m.id
         , m.conversa_id
         , m.inserida
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
    conteudos: await carregarConteudos(sql, linha.id),
  }
}

// Cadeia de respostas e encaminhamentos, ate 5 niveis.
async function carregarReferencia(sql: Sql, mensagemId: number, destino: Linha, profundidade: number) {
  if (profundidade >= 5) {
    return
  }
  const [referencia] = await sql`
    select mr.tipo, mr.destino_mensagem_id
      from mensagem_referencia mr
     where mr.origem_mensagem_id = ${mensagemId}
     order by mr.id desc
     limit 1`
  if (!referencia) {
    return
  }
  const objeto: Linha = { tipo: referencia.tipo }
  destino.mensagem_referencia = objeto
  const alvo = await mensagemResumida(sql, referencia.destino_mensagem_id)
  if (alvo) {
    await carregarReferencia(sql, alvo.id, alvo, profundidade + 1)
    objeto.mensagem = alvo
  }
}

async function carregarMensagens(sql: Sql, conversa: number, usuario: number, script: Fragmento, marcarComoRecebida: boolean) {
  const linhas = await sql`
    select *
      from ( select m.id
                  , m.usuario_id as remetente_id
                  , substring(trim(u.nome) from '^([^ ]+)') as remetente
                  , m.conversa_id
                  , m.inserida
                  , m.alterada
                  , m.visivel_em
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

  const resultado: Linha[] = []
  for (const linha of linhas) {
    const mensagem: Linha = {
      id: linha.id,
      remetente_id: linha.remetente_id,
      remetente: linha.remetente ?? '',
      conversa_id: linha.conversa_id,
      inserida: linha.inserida,
      alterada: linha.alterada,
      visivel_em: linha.visivel_em,
    }

    if (linha.referencia_tipo !== null) {
      const referencia: Linha = { tipo: linha.referencia_tipo }
      mensagem.mensagem_referencia = referencia
      const alvo = await mensagemResumida(sql, linha.referencia_origem_mensagem_id)
      if (alvo) {
        await carregarReferencia(sql, alvo.id, alvo, 1)
        referencia.mensagem = alvo
      }
    }

    // O remetente ve o status somado de todos. Os demais veem so o proprio.
    const [status] = await sql`
      select sum(case when recebida is null then 0 else 1 end) as recebida
           , sum(case when visualizada is null then 0 else 1 end) as visualizada
           , sum(case when reproduzida is null then 0 else 1 end) as reproduzida
           , count(1) as total
        from mensagem_status ms
       where ms.mensagem_id = ${linha.id}
         ${linha.remetente_id !== usuario ? sql`and ms.usuario_id = ${usuario}` : sql``}
       group by mensagem_id`
    const total = status?.total ?? 0
    mensagem.recebida = (status?.recebida ?? 0) === total
    mensagem.visualizada = (status?.visualizada ?? 0) === total
    mensagem.reproduzida = (status?.reproduzida ?? 0) === total

    mensagem.conteudos = await carregarConteudos(sql, linha.id)

    const reacoes = await sql`
      select r.emoji
           , count(1) as quantidade
           , bool_or(r.usuario_id = ${usuario}) as reagiu
           , json_agg(json_build_object('usuario_id', r.usuario_id, 'nome', u.nome, 'avatar_objeto', a.objeto, 'reagido_em', r.criado_em) order by r.id) as usuarios
        from reacao r
        join usuario u
          on u.id = r.usuario_id
        left join anexo as a
          on a.id = u.avatar_anexo_id
       where r.mensagem_id = ${linha.id}
       group by r.emoji
       order by min(r.id)`
    if (reacoes.length) {
      mensagem.reacoes = await Promise.all(reacoes.map(async (reacao) => ({
        emoji: reacao.emoji,
        quantidade: reacao.quantidade,
        reagiu: reacao.reagiu,
        usuarios: await Promise.all((reacao.usuarios as Linha[]).map(async ({ avatar_objeto, ...pessoa }) => ({
          ...pessoa,
          avatar_url: avatar_objeto ? await urlPublica('GET', avatar_objeto, 600) : null,
        }))),
      })))
    }

    resultado.push(mensagem)
  }
  return resultado
}

export async function marcarStatus(sql: Sql, usuario: number, corpo: Linha, coluna: 'visualizada' | 'reproduzida') {
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
  const linhas = await sql`
    select conversa_id
         , mensagem_id
         , sum(case when recebida is null then 0 else 1 end) as recebida
         , sum(case when visualizada is null then 0 else 1 end) as visualizada
         , sum(case when reproduzida is null then 0 else 1 end) as reproduzida
         , count(*) as total
      from mensagem_status ms
     where ms.conversa_id = ${conversa}
       and ms.mensagem_id in ${sql(ids)}
     group by conversa_id, mensagem_id
     order by mensagem_id`
  return linhas.map((linha) => ({
    conversa_id: linha.conversa_id,
    mensagem_id: linha.mensagem_id,
    recebida: linha.recebida === linha.total,
    visualizada: linha.visualizada === linha.total,
    reproduzida: linha.reproduzida === linha.total,
  }))
}

// Quem recebeu, viu e ouviu uma mensagem, com o horário de cada um. Só quem
// enviou a mensagem pode ver.
export async function detalheStatusMensagem(sql: Sql, usuario: number, mensagem: number) {
  const [dados] = await sql`select conversa_id, usuario_id from mensagem where id = ${mensagem}`
  if (!dados) {
    throw httpErrors.notFound('Mensagem não encontrada!')
  }
  if (dados.usuario_id !== usuario) {
    throw httpErrors.forbidden('Só quem enviou a mensagem vê quem recebeu e visualizou.')
  }
  return sql`
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
  return sql`
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

export async function alternarReacao(sql: Sql, usuario: number, corpo: Linha) {
  const [alvo] = await sql<{ conversa_id: number }[]>`select conversa_id from mensagem where id = ${corpo.mensagem_id}`
  if (!alvo) {
    throw httpErrors.notFound('Mensagem não encontrada!')
  }
  await validarAcessoConversa(sql, usuario, alvo.conversa_id)

  const [existe] = await sql`select id from reacao where mensagem_id = ${corpo.mensagem_id} and usuario_id = ${usuario} and emoji = ${corpo.emoji}`
  let acao: 'add' | 'remove'
  if (existe) {
    await sql`delete from reacao where mensagem_id = ${corpo.mensagem_id} and usuario_id = ${usuario} and emoji = ${corpo.emoji}`
    acao = 'remove'
  } else {
    await sql`insert into reacao (mensagem_id, usuario_id, emoji) values (${corpo.mensagem_id}, ${usuario}, ${corpo.emoji})`
    acao = 'add'
  }

  const membros = await sql<{ usuario_id: number }[]>`
    select usuario_id from conversa_usuario where conversa_id = ${alvo.conversa_id} and usuario_id <> ${usuario}`
  for (const { usuario_id } of membros) {
    notificarReacao(alvo.conversa_id, corpo.mensagem_id, usuario, usuario_id, corpo.emoji, acao)
  }

  return { mensagem_id: corpo.mensagem_id, emoji: corpo.emoji, acao }
}

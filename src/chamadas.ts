import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { transacao, type Sql } from './banco.ts'
import { configuracao, pastaDados } from './configuracao.ts'
import { origemPublica } from './contexto.ts'
import type { Corpo, Consulta } from './esquemas.ts'
import { httpErrors } from './erros.ts'
import type { StatusChamada, StatusUsuarioChamada, TipoChamada } from './tabelas.ts'
import { urlPublica } from './minio.ts'
import { notificarMembrosChamada, notificarMembrosConversa, notificarStatusMensagens } from './notificacoes.ts'
import { esquecerParticipantesChamada, notificarChamada, notificarConversa, notificarSinalChamada, TipoMensagemSocket } from './websocket.ts'

// Status da chamada: 1-Pendente, 2-Recusada, 3-Em andamento, 4-Encerrada, 5-Desconectada, 6-Cancelada
// Status do usuario: 1-Pendente, 2-Recusou, 3-Entrou, 4-Saiu, 5-Desconectou
// Eventos: 1-Iniciada, 2-Cancelada, 3-Convidado, 4-Recusou, 5-Entrou, 6-Saiu, 7-Finalizada

interface DadosChamada {
  id: number
  iniciada: Date | null
  finalizada: Date | null
  tipo: TipoChamada
  status: StatusChamada
  criado_em: Date
  criado_por: number
  conversa_chat_id: number | null
}

export interface UsuarioChamada {
  usuario_id: number
  usuario_nome: string
  status: StatusUsuarioChamada
  adicionado_por: number
  adicionado_por_nome: string
  adicionado_em: Date | null
  entrou_em: Date | null
  saiu_em: Date | null
  recusou_em: Date | null
}

interface ParticipanteLinha {
  usuario_id: number
  nome: string
  status: StatusUsuarioChamada
  duracao: number | null
  avatar_objeto: string | null
}

export interface ChamadaHistorico {
  id: number
  tipo: number
  status: number
  criado_em: Date
  criado_por: number
  conversa_id: number | null
  iniciada: Date | null
  finalizada: Date | null
  duracao: number | null
}

// Resumo gravado no conteudo da mensagem de chamada: datas em texto sem fuso,
// o formato das mensagens ja gravadas.
type ResumoChamada = Omit<ChamadaHistorico, 'criado_em' | 'iniciada' | 'finalizada'> & {
  criado_em: string
  iniciada: string | null
  finalizada: string | null
}

async function validarChamada(sql: Sql, usuario: number, chamada: number) {
  const [participa] = chamada === 0 ? [] : await sql`
    select c.id
      from chamada as c
     inner join chamada_usuario u
        on u.chamada_id = c.id
       and u.usuario_id = ${usuario}
     where c.id = ${chamada}`
  // 404, nao 403: para quem nao participa, a chamada nao existe.
  if (!participa) {
    throw httpErrors.notFound('Chamada não encontrada!')
  }
}

function registrarEvento(sql: Sql, chamada: number, usuarioAlvo: number, tipo: number, usuario: number) {
  return sql`insert into chamada_evento (chamada_id, usuario_id, tipo, criado_por) values (${chamada}, ${usuarioAlvo}, ${tipo}, ${usuario})`
}

export async function iniciarChamada(sql: Sql, usuario: number, corpo: Corpo<'iniciarChamada'>) {
  const convidados = corpo.usuarios
  const tipo = corpo.tipo ?? (convidados.length === 2 ? 1 : 2)
  const conversa = corpo.conversa_id && corpo.conversa_id > 0 ? corpo.conversa_id : null

  const id = await transacao(sql, async () => {
    const [chamada] = await sql<{ id: number }[]>`insert into chamada (tipo, criado_por, conversa_id) values (${tipo}, ${usuario}, ${conversa}) returning id`
    if (!chamada) {
      throw new Error('Falha ao iniciar a chamada')
    }
    await registrarEvento(sql, chamada.id, usuario, 1, usuario)
    for (const convidado of convidados) {
      const ehOutro = convidado.id !== usuario
      await sql`insert into chamada_usuario (chamada_id, usuario_id, adicionado_por, status) values (${chamada.id}, ${convidado.id}, ${usuario}, ${ehOutro ? 1 : 3})`
      await registrarEvento(sql, chamada.id, convidado.id, ehOutro ? 3 : 5, usuario)
    }
    return chamada.id
  })

  const dados = await dadosChamada(sql, id)
  await notificarMembrosChamada(sql, id, usuario, TipoMensagemSocket.ChamadaRecebida)
  return dados
}

// A mensagem de resumo e um efeito colateral: falha nela nao cancela a acao.
async function tentarInserirMensagem(sql: Sql, chamada: number) {
  try {
    await inserirMensagemChamada(sql, chamada)
  } catch {
    // mesmo comportamento da API anterior
  }
}

export async function cancelarChamada(sql: Sql, usuario: number, chamada: number) {
  await validarChamada(sql, usuario, chamada)
  await registrarEvento(sql, chamada, usuario, 2, usuario)
  await atualizarStatusChamada(sql, chamada, 6)
  await tentarInserirMensagem(sql, chamada)
  await notificarMembrosChamada(sql, chamada, usuario, TipoMensagemSocket.ChamadaFinalizada)
  return { id: chamada }
}

export async function recusarChamada(sql: Sql, usuario: number, chamada: number) {
  await validarChamada(sql, usuario, chamada)
  await transacao(sql, async () => {
    await sql`update chamada_usuario set status = 2 where chamada_id = ${chamada} and usuario_id = ${usuario} and entrou_em is null`
    await registrarEvento(sql, chamada, usuario, 4, usuario)
    // Chamada toda recusada quando todos menos quem ligou recusaram.
    await sql`
      update chamada
         set status = 2
       where id = ${chamada}
         and exists (select *
                       from ( select count(1) as usuarios
                                   , sum(case when cu.status = 2 then 1 else 0 end) recusaram
                                from chamada c
                               inner join chamada_usuario cu
                                  on cu.chamada_id = c.id
                               where c.id = ${chamada}
                            ) as t
                      where usuarios - 1 = recusaram)`
  })
  await atualizarStatusChamada(sql, chamada)
  await tentarInserirMensagem(sql, chamada)
  await notificarMembrosChamada(sql, chamada, usuario, TipoMensagemSocket.UsuarioRecusou)
  // As outras abas e aparelhos do usuário param de tocar
  notificarChamada(chamada, usuario, usuario, TipoMensagemSocket.UsuarioRecusou)
  return { id: chamada }
}

export async function entrarChamada(sql: Sql, usuario: number, chamada: number) {
  await validarChamada(sql, usuario, chamada)
  await transacao(sql, async () => {
    await sql`update chamada_usuario set status = 3, entrou_em = current_timestamp where chamada_id = ${chamada} and usuario_id = ${usuario} and entrou_em is null`
    await registrarEvento(sql, chamada, usuario, 5, usuario)
  })
  await atualizarStatusChamada(sql, chamada)
  esquecerParticipantesChamada(chamada)
  await incluirNoChatChamada(sql, usuario, chamada)
  await notificarMembrosChamada(sql, chamada, usuario, TipoMensagemSocket.UsuarioEntrou)
  // As outras abas e aparelhos do usuário param de tocar
  notificarChamada(chamada, usuario, usuario, TipoMensagemSocket.UsuarioEntrou)
  return { id: chamada }
}

export async function sairChamada(sql: Sql, usuario: number, chamada: number) {
  await validarChamada(sql, usuario, chamada)
  await transacao(sql, async () => {
    await sql`update chamada_usuario set status = 4, saiu_em = current_timestamp where chamada_id = ${chamada} and usuario_id = ${usuario}`
    await registrarEvento(sql, chamada, usuario, 6, usuario)
  })
  await atualizarStatusChamada(sql, chamada)
  esquecerParticipantesChamada(chamada)
  await tentarInserirMensagem(sql, chamada)
  await notificarMembrosChamada(sql, chamada, usuario, TipoMensagemSocket.UsuarioSaiu)
  return { id: chamada }
}

// Chat da chamada: grupo criado na primeira mensagem, com quem esteve nela
// (entrou, saiu ou caiu; convidado que nao atendeu fica de fora). Ja existindo,
// devolve o mesmo grupo.
export async function chatChamada(sql: Sql, usuario: number, chamada: number) {
  await validarChamada(sql, usuario, chamada)
  const { conversa, criada } = await transacao(sql, async () => {
    const [dados] = await sql<{ conversa_chat_id: number | null }[]>`select conversa_chat_id from chamada where id = ${chamada} for update`
    if (dados?.conversa_chat_id) {
      return { conversa: dados.conversa_chat_id, criada: false }
    }
    const membros = await sql<{ usuario_id: number; nome: string }[]>`
      select distinct cu.usuario_id, u.nome
        from chamada_usuario cu
       inner join usuario u on u.id = cu.usuario_id
       where cu.chamada_id = ${chamada}
         and (cu.status in (3, 4, 5) or cu.usuario_id = ${usuario})
       order by u.nome`
    const nomes = membros.map((membro) => membro.nome).join(', ')
    const descricao = `Chamada: ${nomes.length > 80 ? `${nomes.slice(0, 77)}...` : nomes}`
    const [nova] = await sql<{ id: number }[]>`insert into conversa (descricao, tipo) values (${descricao}, 2) returning id`
    if (!nova) {
      throw new Error('Falha ao criar o chat da chamada')
    }
    for (const membro of membros) {
      await sql`insert into conversa_usuario (conversa_id, usuario_id) values (${nova.id}, ${membro.usuario_id})`
    }
    await sql`update chamada set conversa_chat_id = ${nova.id} where id = ${chamada}`
    return { conversa: nova.id, criada: true }
  })
  if (criada) {
    // A conversa nova aparece na lista de todos, e quem esta na chamada abre o chat
    await notificarMembrosConversa(sql, conversa, usuario, TipoMensagemSocket.ConversaNova)
    const participantes = await sql<{ usuario_id: number }[]>`
      select usuario_id from chamada_usuario where chamada_id = ${chamada} and usuario_id <> ${usuario}`
    for (const { usuario_id } of participantes) {
      notificarSinalChamada(chamada, usuario, usuario_id, { acao: 'chat', conversa_id: conversa })
    }
  }
  return { conversa_id: conversa }
}

// Quem entra depois de o chat existir passa a fazer parte do grupo
async function incluirNoChatChamada(sql: Sql, usuario: number, chamada: number) {
  const [incluido] = await sql<{ conversa_id: number }[]>`
    insert into conversa_usuario (conversa_id, usuario_id)
    select c.conversa_chat_id, ${usuario}
      from chamada c
     where c.id = ${chamada}
       and c.conversa_chat_id is not null
       and not exists (select 1 from conversa_usuario cu where cu.conversa_id = c.conversa_chat_id and cu.usuario_id = ${usuario})
    returning conversa_id`
  if (incluido) {
    notificarConversa(incluido.conversa_id, usuario, usuario, TipoMensagemSocket.ConversaNova)
  }
}

export async function adicionarUsuarioChamada(sql: Sql, usuario: number, corpo: Corpo<'adicionarUsuarioChamada'>) {
  await validarChamada(sql, usuario, corpo.chamada_id)
  await transacao(sql, async () => {
    await sql`insert into chamada_usuario (chamada_id, usuario_id, adicionado_por, status) values (${corpo.chamada_id}, ${corpo.usuario_id}, ${usuario}, 1)`
    await registrarEvento(sql, corpo.chamada_id, corpo.usuario_id, 3, usuario)
  })
  await notificarMembrosChamada(sql, corpo.chamada_id, usuario, TipoMensagemSocket.ChamadaRecebida)
  return { id: corpo.chamada_id }
}

export async function finalizarChamada(sql: Sql, usuario: number, chamada: number) {
  await validarChamada(sql, usuario, chamada)
  await registrarEvento(sql, chamada, usuario, 7, usuario)
  await atualizarStatusChamada(sql, chamada, 4)
  await tentarInserirMensagem(sql, chamada)
  await notificarMembrosChamada(sql, chamada, usuario, TipoMensagemSocket.ChamadaFinalizada)
  return { id: chamada }
}

export async function ativarVideo(sql: Sql, usuario: number, chamada: number) {
  await validarChamada(sql, usuario, chamada)
  await notificarMembrosChamada(sql, chamada, usuario, TipoMensagemSocket.VideoAtivado)
}

export async function dadosChamadaUsuario(sql: Sql, usuario: number, chamada: number) {
  await validarChamada(sql, usuario, chamada)
  return dadosChamada(sql, chamada)
}

export async function chamadasPendentes(sql: Sql, usuario: number) {
  const linhas = await sql<(DadosChamada & { conversa_id: number | null })[]>`
    select c.id
         , c.tipo
         , c.status
         , c.iniciada
         , c.finalizada
         , c.conversa_id
         , c.criado_em
         , c.criado_por
      from chamada as c
      join chamada_usuario as cu
        on cu.chamada_id = c.id
     where cu.usuario_id = ${usuario}
       and cu.status = 1
       and c.status in (1, 3)
     order by c.criado_em desc`
  return linhas.map((linha) => ({ ...linha, conversa_id: linha.conversa_id ?? 0 }))
}

async function dadosChamada(sql: Sql, chamada: number) {
  const [dados] = await sql<DadosChamada[]>`select id, iniciada, finalizada, tipo, status, criado_em, criado_por, conversa_chat_id from chamada where id = ${chamada}`
  // So e chamada depois de conferir (ou criar) a chamada
  if (!dados) {
    throw httpErrors.notFound('Chamada não encontrada!')
  }

  const usuarios = await sql<UsuarioChamada[]>`
    select cu.usuario_id
         , u.nome as usuario_nome
         , cu.status
         , cu.adicionado_por
         , u_add.nome as adicionado_por_nome
         , cu.adicionado_em
         , cu.entrou_em
         , cu.saiu_em
         , cu.recusou_em
      from ( select cu.usuario_id
                  , cu.status
                  , info.adicionado_por
                  , info.adicionado_em
                  , info.entrou_em
                  , info.saiu_em
                  , info.recusou_em
               from ( select usuario_id
                           , status
                        from chamada_usuario
                       where chamada_id = ${chamada}
                    ) as cu
               left join
                    ( select ce.usuario_id
                           , max(case when ce.tipo in (1, 3) then criado_por else null end) as adicionado_por
                           , max(case when ce.tipo in (1, 3) then criado_em else null end) as adicionado_em
                           , max(case when ce.tipo = 4 then criado_em else null end) as recusou_em
                           , max(case when ce.tipo = 5 then criado_em else null end) as entrou_em
                           , max(case when ce.tipo = 6 then criado_em else null end) as saiu_em
                        from ( select *
                                 from ( select usuario_id
                                             , criado_por
                                             , criado_em
                                             , tipo
                                             , row_number() over(partition by usuario_id, tipo order by criado_em desc) as rid
                                          from chamada_evento ce
                                         where ce.chamada_id = ${chamada}
                                           and ce.tipo in (1, 3, 4, 5, 6)
                                      ) as ce
                                where ce.rid = 1 /* Apenas o ultimo evento de cada tipo */
                             ) as ce
                       group by ce.usuario_id
                    ) as info
                 on info.usuario_id = cu.usuario_id
           ) as cu
     inner join usuario u
        on u.id = cu.usuario_id
     inner join usuario u_add
        on u_add.id = cu.adicionado_por`
  return { ...dados, usuarios }
}

type Participante = Omit<ParticipanteLinha, 'avatar_objeto'>

// Com avatar para o historico; sem, para o resumo gravado na mensagem.
async function participantes(sql: Sql, chamada: number, comAvatar: true): Promise<(Participante & { avatar_url: string | null })[]>
async function participantes(sql: Sql, chamada: number, comAvatar: false): Promise<Participante[]>
async function participantes(sql: Sql, chamada: number, comAvatar: boolean): Promise<Participante[]> {
  const linhas = await sql<ParticipanteLinha[]>`
    select cu.usuario_id
         , u.nome
         , cu.status
         , case when cu.entrou_em is not null and cu.saiu_em is not null
                then extract(epoch from cu.saiu_em - cu.entrou_em)::int
                else null end as duracao
         , a.objeto as avatar_objeto
      from chamada_usuario cu
     inner join usuario u on u.id = cu.usuario_id
      left join anexo a on a.id = u.avatar_anexo_id
     where cu.chamada_id = ${chamada}
     order by cu.id`
  return Promise.all(linhas.map(async ({ avatar_objeto, ...linha }) => comAvatar
    ? { ...linha, avatar_url: avatar_objeto ? await urlPublica('GET', avatar_objeto, 600) : null }
    : linha))
}

// O historico devolve as datas como data; o resumo da mensagem, em texto.
const camposHistorico = (sql: Sql, datasEmTexto = false) => sql`
    c.id
  , c.tipo
  , c.status
  , ${datasEmTexto ? sql`to_char(c.criado_em, 'YYYY-MM-DD"T"HH24:MI:SS')` : sql`c.criado_em`} as criado_em
  , c.criado_por
  , c.conversa_id
  , ${datasEmTexto ? sql`to_char(c.iniciada, 'YYYY-MM-DD"T"HH24:MI:SS')` : sql`c.iniciada`} as iniciada
  , ${datasEmTexto ? sql`to_char(c.finalizada, 'YYYY-MM-DD"T"HH24:MI:SS')` : sql`c.finalizada`} as finalizada
  , case when c.iniciada is not null and c.finalizada is not null
         then extract(epoch from c.finalizada - c.iniciada)::int
         else null end as duracao`

export async function historicoChamadas(sql: Sql, usuario: number, filtro: Consulta<'historicoChamadas'>) {
  const nenhum = sql``
  const temFiltro = filtro.participante > 0 || filtro.de.trim() || filtro.ate.trim()

  const chamadas = await sql<ChamadaHistorico[]>`
    select ${camposHistorico(sql)}
      from chamada c
     inner join chamada_usuario cu on cu.chamada_id = c.id
     where cu.usuario_id = ${usuario}
       and c.status in (2, 4, 5, 6)
       ${filtro.participante > 0 ? sql`and exists (select 1 from chamada_usuario cu2 where cu2.chamada_id = c.id and cu2.usuario_id = ${filtro.participante})` : nenhum}
       ${filtro.de.trim() ? sql`and c.criado_em >= ${filtro.de}::timestamp` : nenhum}
       ${filtro.ate.trim() ? sql`and c.criado_em < (${filtro.ate}::date + 1)` : nenhum}
     order by c.criado_em desc
     limit ${temFiltro ? 250 : 25}`

  const resultado = []
  for (const chamada of chamadas) {
    resultado.push({ ...chamada, participantes: await participantes(sql, chamada.id, true) })
  }
  return resultado
}

export async function atualizarStatusChamada(sql: Sql, chamada: number, status = 0) {
  if (status > 0) {
    await sql`
      update chamada
         set status = ${status}
           ${status === 4 ? sql`, finalizada = current_timestamp` : sql``}
       where id = ${chamada}
         and status <> ${status}`
    return
  }

  // Sem status informado, deduz pelo estado dos participantes.
  await sql`
    update chamada
       set status = novo_status
         , iniciada   = case when iniciada is null and novo_status = 3 then current_timestamp else iniciada end
         , finalizada = case when novo_status = 4 then current_timestamp else finalizada end
      from ( select *
               from ( select id
                           , status
                           , case
                             when tipo = 1 and u_recusou > 0 then 2               /* Simples | Recusada */
                             when tipo = 1 and u_saiu > 0 then 4                  /* Simples | Encerrada */
                             when tipo = 1 and u_entrou = usuarios then 3         /* Simples | Em andamento */
                             when tipo = 2 and u_recusou = usuarios - 1 then 2    /* Grupo | Recusada */
                             when tipo = 2 and u_saiu = usuarios - 1 then 4       /* Grupo | Encerrada */
                             when tipo = 2 and u_entrou > 0 then 3                /* Grupo | Em andamento */
                             else 0
                             end as novo_status
                        from ( select c.id
                                    , c.tipo
                                    , c.status
                                    , count(1) as usuarios
                                    , sum(case when cu.status = 1 then 1 else 0 end) as u_pendentes
                                    , sum(case when cu.status = 2 then 1 else 0 end) as u_recusou
                                    , sum(case when cu.status = 3 then 1 else 0 end) as u_entrou
                                    , sum(case when cu.status = 4 then 1 else 0 end) as u_saiu
                                    , sum(case when cu.status = 5 then 1 else 0 end) as u_desconectou
                                 from chamada c
                                inner join chamada_usuario cu
                                   on cu.chamada_id = c.id
                                where c.id = ${chamada}
                                  and c.status in (1, 3)
                                group by c.id, c.status, c.tipo
                             ) as t
                    ) as t
              where status <> novo_status
           ) c
     where c.id = chamada.id
       and c.novo_status <> chamada.status
       and c.novo_status <> 0
       and c.id = ${chamada}
       and c.status in (1, 3)`
}

// Mensagem de resumo na conversa quando a chamada chega a um status final.
async function inserirMensagemChamada(sql: Sql, chamada: number) {
  const [dados] = await sql<ResumoChamada[]>`select ${camposHistorico(sql, true)} from chamada c where c.id = ${chamada}`
  if (!dados || dados.conversa_id === null || ![2, 4, 5, 6].includes(dados.status)) {
    return
  }
  const conversa = dados.conversa_id

  const [existente] = await sql<{ total: number }[]>`
    select count(1) as total
      from mensagem_conteudo mc
     where mc.tipo = 6
       and convert_from(mc.conteudo, 'utf-8')::jsonb ->> 'chamada_id' = ${String(chamada)}`
  if (existente && existente.total > 0) {
    return
  }

  const conteudo = JSON.stringify({
    chamada_id: dados.id,
    tipo: dados.tipo,
    status: dados.status,
    iniciada: dados.iniciada,
    finalizada: dados.finalizada,
    duracao: dados.duracao,
    participantes: await participantes(sql, chamada, false),
  })

  const [mensagem] = await sql<{ id: number }[]>`insert into mensagem (conversa_id, usuario_id) values (${conversa}, ${dados.criado_por}) returning id`
  if (!mensagem) {
    return
  }
  await sql`insert into mensagem_conteudo (mensagem_id, ordem, tipo, conteudo) values (${mensagem.id}, 1, 6, convert_to(${conteudo}, 'UTF8'))`
  // Quem participou da chamada ja recebe o resumo como lido: nao faz sentido
  // aparecer como nao lida uma chamada da qual a pessoa estava. Quem nao
  // entrou (chamada perdida) continua com ela nao lida, como aviso.
  await sql`
    insert into mensagem_status (conversa_id, usuario_id, mensagem_id, recebida, visualizada)
    select cu.conversa_id, cu.usuario_id, ${mensagem.id}, participou.quando, participou.quando
      from conversa_usuario cu
      left join lateral
           ( select current_timestamp as quando
               from chamada_usuario chu
              where chu.chamada_id = ${chamada}
                and chu.usuario_id = cu.usuario_id
                and chu.entrou_em is not null
              limit 1
           ) as participou
        on true
     where cu.conversa_id = ${conversa}
       and cu.usuario_id <> ${dados.criado_por}`
  // Avisa todos, inclusive quem ligou (autor do resumo), para a conversa aberta
  // carregar a mensagem.
  await notificarStatusMensagens(sql, 0, conversa, String(mensagem.id))
}

// Gerado pelo container coturn na primeira vez, em turn-segredo na pasta de
// dados. Lido a cada pedido, porque a API pode subir antes do coturn gravar o arquivo.
function segredoTurn() {
  try {
    return readFileSync(`${pastaDados()}/turn-segredo`, 'utf8').trim()
  } catch {
    return ''
  }
}

// Credencial TURN temporaria no formato do use-auth-secret do coturn:
// usuario "<expiracao unix>:<id>", senha base64(HMAC-SHA1(segredo, usuario)).
// O endereco e o mesmo que o navegador usou para chamar a API. Em producao a
// borda recebe o TURN com TLS na porta CONVERSA_TURN_PORTA.
export function servidoresIce(usuario: number): {
  iceServers: { urls: string; username: string; credential: string }[]
  iceTransportPolicy: 'relay' | 'all'
} {
  const origem = origemPublica()
  const segredo = segredoTurn()
  if (!origem || !segredo) {
    return { iceServers: [], iceTransportPolicy: 'all' }
  }
  const { hostname } = new URL(origem)
  const { turnPorta, turnForcarRelay } = configuracao
  const urls = turnPorta ? `turns:${hostname}:${turnPorta}?transport=tcp` : `turn:${hostname}:3478?transport=tcp`
  const username = `${Math.floor(Date.now() / 1000) + 3600}:${usuario}`
  const credential = createHmac('sha1', segredo).update(username).digest('base64')
  return {
    iceServers: [{ urls, username, credential }],
    iceTransportPolicy: turnForcarRelay ? 'relay' : 'all',
  }
}

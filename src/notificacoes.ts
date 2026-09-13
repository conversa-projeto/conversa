import type { Sql } from './banco.ts'
import { enviarPush } from './fcm.ts'
import {
  notificarChamada,
  notificarConversa,
  notificarNovaMensagem,
  notificarStatusMensagem,
  usuarioConectado,
  type TipoMensagemSocket,
} from './websocket.ts'

export async function notificarMembrosConversa(sql: Sql, conversa: number, usuario: number, tipo: TipoMensagemSocket) {
  const membros = await sql<{ usuario_id: number }[]>`
    select u.usuario_id
      from conversa as c
     inner join conversa_usuario u
        on u.conversa_id = c.id
       and u.usuario_id <> ${usuario}
     where c.id = ${conversa}`
  for (const { usuario_id } of membros) {
    notificarConversa(conversa, usuario, usuario_id, tipo)
  }
}

export async function notificarMembrosChamada(sql: Sql, chamada: number, usuario: number, tipo: TipoMensagemSocket) {
  const membros = await sql<{ usuario_id: number }[]>`
    select u.usuario_id
      from chamada as c
     inner join chamada_usuario u
        on u.chamada_id = c.id
       and u.usuario_id <> ${usuario}
     where c.id = ${chamada}`
  if (!membros.length) {
    throw new Error('Chamada não encontrada!')
  }
  for (const { usuario_id } of membros) {
    notificarChamada(chamada, usuario, usuario_id, tipo)
  }
}

// Avisa os outros membros da conversa que o status de mensagens mudou.
// mensagens e uma lista de ids separados por virgula.
export async function notificarStatusMensagens(sql: Sql, usuario: number, conversa: number, mensagens: string) {
  const membros = await sql<{ usuario_id: number }[]>`
    select usuario_id from conversa_usuario where conversa_id = ${conversa} and usuario_id <> ${usuario}`
  for (const { usuario_id } of membros) {
    notificarStatusMensagem(usuario_id, conversa, mensagens)
  }
}

// Nova mensagem: evento em tempo real para todos e push para quem nao esta conectado.
export async function notificarNovaMensagemConversa(sql: Sql, usuario: number, conversa: number, texto: string) {
  const [remetente] = await sql<{ nome: string }[]>`select nome from usuario where id = ${usuario}`
  const titulo = remetente?.nome ?? ''

  const destinatarios = await sql<{ usuario_id: number; token_fcm: string | null }[]>`
    select distinct cu.usuario_id
         , d.token_fcm
      from conversa_usuario as cu
      left join dispositivo as d
        on d.usuario_id = cu.usuario_id
       and d.ativo = true
       and d.token_fcm is not null
     where cu.conversa_id = ${conversa}
       and cu.usuario_id <> ${usuario}`

  for (const { usuario_id, token_fcm } of destinatarios) {
    notificarNovaMensagem(usuario_id, titulo, texto)
    if (token_fcm && !usuarioConectado(usuario_id)) {
      // Falha de push nao pode derrubar o envio da mensagem.
      enviarPush(token_fcm, titulo, texto).catch(() => {})
    }
  }
}

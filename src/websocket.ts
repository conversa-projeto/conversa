import websocket from '@fastify/websocket'
import type { FastifyInstance } from 'fastify'
import type { WebSocket } from 'ws'
import { comUsuario } from './banco.ts'

export const TipoMensagemSocket = {
  Erro: 0,
  Login: 1,
  NovaMensagem: 2,
  AtualizacaoStatusMensagem: 3,
  Digitando: 4,
  GravandoAudio: 5,
  ReacaoMensagem: 7,
  ConversaNova: 40,
  ChamadaRecebida: 51,
  ChamadaFinalizada: 52,
  UsuarioRecusou: 53,
  UsuarioEntrou: 54,
  UsuarioSaiu: 55,
  VideoAtivado: 56,
  StatusUsuario: 60,
} as const
export type TipoMensagemSocket = (typeof TipoMensagemSocket)[keyof typeof TipoMensagemSocket]

// Conexoes abertas por usuario. Um usuario pode ter varias abas e aparelhos.
const conexoes = new Map<number, Set<WebSocket>>()

type VerificarToken = (token: string) => { sub: string }

// WebSocket na mesma porta da API, em /ws/. A autenticacao nao usa o
// cabecalho: o cliente manda { tipo: 1, token } como primeira mensagem.
export async function registrarWebSocket(app: FastifyInstance, verificarToken: VerificarToken) {
  await app.register(websocket)

  app.get('/ws/', { websocket: true }, (socket) => {
    let usuarioId = 0

    socket.on('message', (bruto) => {
      let mensagem: { tipo?: unknown; token?: unknown } | undefined
      try {
        mensagem = JSON.parse(bruto.toString())
      } catch {
        mensagem = undefined
      }

      if (!mensagem || typeof mensagem !== 'object' || mensagem.tipo === undefined) {
        socket.send(JSON.stringify({
          tipo: 9,
          message: mensagem
            ? 'Erro ao ler os dados do WebSocket: Par "tipo" não encontrado!'
            : 'Erro ao ler os dados do WebSocket: JSON inválido!',
        }))
        return
      }

      if (mensagem.tipo !== TipoMensagemSocket.Login || usuarioId) {
        return
      }

      try {
        usuarioId = Number(verificarToken(String(mensagem.token ?? '')).sub)
      } catch (erro) {
        socket.send(JSON.stringify({ tipo: TipoMensagemSocket.Erro, message: erro instanceof Error ? erro.message : String(erro) }))
        return
      }

      let doUsuario = conexoes.get(usuarioId)
      if (!doUsuario) {
        conexoes.set(usuarioId, doUsuario = new Set())
      }
      doUsuario.add(socket)
      // Avisa os contatos so na primeira conexao do usuario.
      if (doUsuario.size === 1) {
        notificarContatosStatus(usuarioId, true)
      }
    })

    socket.on('close', () => {
      if (!usuarioId) {
        return
      }
      const doUsuario = conexoes.get(usuarioId)
      doUsuario?.delete(socket)
      // Offline so quando fecha a ultima conexao.
      if (!doUsuario?.size) {
        conexoes.delete(usuarioId)
        notificarContatosStatus(usuarioId, false)
      }
    })
  })
}

function enviar(usuarioId: number, dados: object) {
  const destinos = conexoes.get(usuarioId)
  if (!destinos) {
    return
  }
  const texto = JSON.stringify(dados)
  for (const socket of destinos) {
    socket.send(texto)
  }
}

export function usuarioConectado(usuarioId: number) {
  return (conexoes.get(usuarioId)?.size ?? 0) > 0
}

export function notificarNovaMensagem(usuarioId: number, titulo: string, mensagem: string) {
  enviar(usuarioId, { tipo: TipoMensagemSocket.NovaMensagem, titulo, mensagem })
}

export function notificarStatusMensagem(usuarioId: number, conversa: number, mensagens: string) {
  enviar(usuarioId, { tipo: TipoMensagemSocket.AtualizacaoStatusMensagem, grupo: conversa, mensagens })
}

export function notificarConversa(conversa: number, remetente: number, destinatario: number, tipo: TipoMensagemSocket) {
  enviar(destinatario, { tipo, conversa_id: conversa, usuario_id: remetente })
}

export function notificarReacao(conversa: number, mensagem: number, remetente: number, destinatario: number, emoji: string, acao: string) {
  enviar(destinatario, { tipo: TipoMensagemSocket.ReacaoMensagem, conversa_id: conversa, mensagem_id: mensagem, usuario_id: remetente, emoji, acao })
}

export function notificarChamada(chamada: number, remetente: number, destinatario: number, tipo: TipoMensagemSocket) {
  enviar(destinatario, { tipo, chamada_id: chamada, usuario_id: remetente })
}

// Avisa quem tem conversa direta com o usuario que ele entrou ou saiu.
function notificarContatosStatus(usuarioId: number, online: boolean) {
  comUsuario(0, (sql) => sql<{ usuario_id: number }[]>`
    select distinct cu2.usuario_id
      from conversa_usuario cu1
     inner join conversa c on c.id = cu1.conversa_id and c.tipo = 1
     inner join conversa_usuario cu2 on cu2.conversa_id = cu1.conversa_id and cu2.usuario_id <> cu1.usuario_id
     where cu1.usuario_id = ${usuarioId}`)
    .then((contatos) => {
      for (const { usuario_id } of contatos) {
        enviar(usuario_id, { tipo: TipoMensagemSocket.StatusUsuario, usuario_id: usuarioId, online })
      }
    })
    .catch((erro) => console.error('[WebSocket] Falha ao notificar status do usuário', usuarioId, erro))
}

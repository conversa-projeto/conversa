import { Elysia } from 'elysia'
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
  SinalChamada: 57,
  StatusUsuario: 60,
  NovaAtividade: 61,
} as const
export type TipoMensagemSocket = (typeof TipoMensagemSocket)[keyof typeof TipoMensagemSocket]

// Conexao aberta, o socket nativo do Bun (o mesmo objeto do abrir ao fechar).
interface Conexao {
  send(texto: string): unknown
}

// Conexoes abertas por usuario. Um usuario pode ter varias abas e aparelhos.
const conexoes = new Map<number, Set<Conexao>>()
// Usuario de cada conexao, depois do login pela primeira mensagem
const usuarioDaConexao = new WeakMap<Conexao, number>()

// Confere o token do login e devolve o id do usuario; token invalido lanca erro.
export type VerificarToken = (token: string) => Promise<number>

// O Elysia ja entrega a mensagem convertida quando ela e JSON; texto que nao e
// JSON chega como string.
function lerMensagem(dado: unknown): { tipo?: unknown; token?: unknown; chamada_id?: unknown; dados?: unknown } | undefined {
  if (typeof dado === 'object' && dado !== null) {
    return dado
  }
  try {
    const convertido: unknown = JSON.parse(String(dado))
    return typeof convertido === 'object' && convertido !== null ? convertido : undefined
  } catch {
    return undefined
  }
}

// WebSocket na mesma porta da API, em /ws/. A autenticacao nao usa o
// cabecalho: o cliente manda { tipo: 1, token } como primeira mensagem.
export function criarWebSocket(verificarToken: VerificarToken) {
  return new Elysia({ name: 'websocket' }).ws('/ws/', {
    async message(ws, dado) {
      const socket: Conexao = ws.raw
      const mensagem = lerMensagem(dado)

      if (!mensagem || mensagem.tipo === undefined) {
        socket.send(JSON.stringify({
          tipo: 9,
          message: mensagem
            ? 'Erro ao ler os dados do WebSocket: Par "tipo" não encontrado!'
            : 'Erro ao ler os dados do WebSocket: JSON inválido!',
        }))
        return
      }

      if (mensagem.tipo === TipoMensagemSocket.SinalChamada) {
        const usuarioId = usuarioDaConexao.get(socket)
        if (usuarioId) {
          await repassarSinalChamada(usuarioId, mensagem.chamada_id, mensagem.dados)
        }
        return
      }

      if (mensagem.tipo !== TipoMensagemSocket.Login || usuarioDaConexao.has(socket)) {
        return
      }

      let usuarioId: number
      try {
        usuarioId = await verificarToken(String(mensagem.token ?? ''))
      } catch (erro) {
        socket.send(JSON.stringify({ tipo: TipoMensagemSocket.Erro, message: erro instanceof Error ? erro.message : String(erro) }))
        return
      }
      usuarioDaConexao.set(socket, usuarioId)

      let doUsuario = conexoes.get(usuarioId)
      if (!doUsuario) {
        conexoes.set(usuarioId, doUsuario = new Set())
      }
      doUsuario.add(socket)
      // Avisa os contatos so na primeira conexao do usuario.
      if (doUsuario.size === 1) {
        notificarContatosStatus(usuarioId, true)
      }
    },

    close(ws) {
      const socket: Conexao = ws.raw
      const usuarioId = usuarioDaConexao.get(socket)
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
    },
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

// Atividade nova (ou retirada) para o usuario: a pagina atualiza o contador
export function notificarAtividade(usuarioId: number) {
  enviar(usuarioId, { tipo: TipoMensagemSocket.NovaAtividade })
}

// Sinal da chamada enviado pelo proprio servidor (o chat da chamada foi criado)
export function notificarSinalChamada(chamada: number, remetente: number, destinatario: number, dados: object) {
  enviar(destinatario, { tipo: TipoMensagemSocket.SinalChamada, chamada_id: chamada, usuario_id: remetente, dados })
}

export function notificarChamada(chamada: number, remetente: number, destinatario: number, tipo: TipoMensagemSocket) {
  enviar(destinatario, { tipo, chamada_id: chamada, usuario_id: remetente })
}

// Quem esta dentro de cada chamada, lido do banco no maximo a cada 5 segundos:
// o ponteiro da tela compartilhada manda dezenas de sinais por segundo.
const participantesEmCache = new Map<number, { ate: number; usuarios: Promise<number[]> }>()

function participantesChamada(chamada: number): Promise<number[]> {
  const agora = Date.now()
  for (const [id, cache] of participantesEmCache) {
    if (cache.ate <= agora) {
      participantesEmCache.delete(id)
    }
  }
  const cache = participantesEmCache.get(chamada)
  if (cache) {
    return cache.usuarios
  }
  const usuarios = comUsuario(0, (sql) => sql<{ usuario_id: number }[]>`
    select cu.usuario_id
      from chamada_usuario cu
     inner join chamada c on c.id = cu.chamada_id and c.status in (1, 3)
     where cu.chamada_id = ${chamada}
       and cu.status = 3`)
    .then((linhas) => linhas.map((linha) => linha.usuario_id))
  participantesEmCache.set(chamada, { ate: agora + 5000, usuarios })
  return usuarios
}

// Alguem entrou ou saiu: a proxima leitura vem do banco
export function esquecerParticipantesChamada(chamada: number) {
  participantesEmCache.delete(chamada)
}

const TAMANHO_MAXIMO_SINAL = 2000

// Sinal da chamada (quem compartilha a tela, ponteiro sobre ela): o servidor so
// repassa aos outros que estao na chamada, sem gravar. Quem nao esta nela nao
// envia nem recebe.
async function repassarSinalChamada(usuarioId: number, chamada: unknown, dados: unknown) {
  if (typeof chamada !== 'number' || !Number.isInteger(chamada) || chamada <= 0) {
    return
  }
  if (typeof dados !== 'object' || dados === null || JSON.stringify(dados).length > TAMANHO_MAXIMO_SINAL) {
    return
  }
  try {
    const usuarios = await participantesChamada(chamada)
    if (!usuarios.includes(usuarioId)) {
      return
    }
    for (const destino of usuarios) {
      if (destino !== usuarioId) {
        enviar(destino, { tipo: TipoMensagemSocket.SinalChamada, chamada_id: chamada, usuario_id: usuarioId, dados })
      }
    }
  } catch (erro) {
    participantesEmCache.delete(chamada)
    console.error('[WebSocket] Falha ao repassar sinal da chamada', chamada, erro)
  }
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

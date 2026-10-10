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
  ConfirmacaoLeitura: 8,
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
  EnqueteAtualizada: 62,
  // Pagina -> servidor: { ativo, conversa_id } da aba; servidor -> pagina:
  // { conversa_id, usuario_id, aberta } de quem abriu ou saiu da conversa
  Presenca: 63,
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

// Presenca de cada aba: ativa (visivel e usada nos ultimos minutos) e a
// conversa aberta nela. O usuario fica ativo se alguma aba estiver ativa;
// conectado sem nenhuma, ausente.
export type EstadoPresenca = 'ativo' | 'ausente' | 'offline'
const presencaDaConexao = new WeakMap<Conexao, { ativo: boolean; conversa: number | null }>()
// O que cada usuario mostra aos outros, lido ao conectar e trocado pela tela de configuracoes
export interface PreferenciasPresenca {
  mostrar_visto_em: boolean
  mostrar_na_conversa: boolean
  aparecer_offline: boolean
}
const preferenciasDoUsuario = new Map<number, PreferenciasPresenca>()
// Ultimo estado e conversas abertas ja avisados, para avisar so o que mudou
const estadoAvisado = new Map<number, EstadoPresenca>()
const conversasAvisadas = new Map<number, Set<number>>()

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

      if (mensagem.tipo === TipoMensagemSocket.Presenca) {
        const usuarioId = usuarioDaConexao.get(socket)
        if (usuarioId) {
          const { ativo, conversa_id: conversa } = mensagem as { ativo?: unknown; conversa_id?: unknown }
          presencaDaConexao.set(socket, {
            ativo: ativo === true,
            conversa: typeof conversa === 'number' && Number.isInteger(conversa) && conversa > 0 ? conversa : null,
          })
          await atualizarPresenca(usuarioId)
        }
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
      // Ate a pagina dizer o contrario, quem acabou de conectar esta ativo
      presencaDaConexao.set(socket, { ativo: true, conversa: null })

      let doUsuario = conexoes.get(usuarioId)
      if (!doUsuario) {
        conexoes.set(usuarioId, doUsuario = new Set())
      }
      doUsuario.add(socket)
      if (!preferenciasDoUsuario.has(usuarioId)) {
        preferenciasDoUsuario.set(usuarioId, await carregarPreferencias(usuarioId))
      }
      await atualizarPresenca(usuarioId)
      // A aba nova sabe na hora como os outros veem o usuario
      const estado = presencaVisivel(usuarioId).estado
      socket.send(JSON.stringify({ tipo: TipoMensagemSocket.StatusUsuario, usuario_id: usuarioId, online: estado !== 'offline', estado, visto_em: null }))
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
      }
      void atualizarPresenca(usuarioId)
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

export function notificarConfirmacao(conversa: number, mensagem: number, remetente: number, destinatario: number, nome: string, confirmadaEm: Date) {
  enviar(destinatario, { tipo: TipoMensagemSocket.ConfirmacaoLeitura, conversa_id: conversa, mensagem_id: mensagem, usuario_id: remetente, nome, confirmada_em: confirmadaEm })
}

// Voto novo numa enquete: quem tem a bolha aberta le os votos de novo
export function notificarEnquete(usuarioId: number, enquete: number, conversa: number) {
  enviar(usuarioId, { tipo: TipoMensagemSocket.EnqueteAtualizada, enquete_id: enquete, conversa_id: conversa })
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

const PREFERENCIAS_PADRAO: PreferenciasPresenca = { mostrar_visto_em: true, mostrar_na_conversa: true, aparecer_offline: false }

async function carregarPreferencias(usuarioId: number): Promise<PreferenciasPresenca> {
  try {
    const [linha] = await comUsuario(0, (sql) => sql<PreferenciasPresenca[]>`
      select mostrar_visto_em, mostrar_na_conversa, aparecer_offline from usuario where id = ${usuarioId}`)
    return linha ?? PREFERENCIAS_PADRAO
  } catch (erro) {
    console.error('[WebSocket] Falha ao ler as preferências de presença', usuarioId, erro)
    return PREFERENCIAS_PADRAO
  }
}

function preferencias(usuarioId: number) {
  return preferenciasDoUsuario.get(usuarioId) ?? PREFERENCIAS_PADRAO
}

// Estado e conversas abertas de verdade, juntando as abas e aparelhos do usuario
function presencaReal(usuarioId: number): { estado: EstadoPresenca; conversas: Set<number> } {
  const doUsuario = conexoes.get(usuarioId)
  const conversas = new Set<number>()
  if (!doUsuario?.size) {
    return { estado: 'offline', conversas }
  }
  let ativo = false
  for (const socket of doUsuario) {
    const presenca = presencaDaConexao.get(socket)
    if (presenca?.ativo) {
      ativo = true
      if (presenca.conversa) conversas.add(presenca.conversa)
    }
  }
  return { estado: ativo ? 'ativo' : 'ausente', conversas }
}

// O que os outros veem: quem escolheu aparecer offline fica offline e fora das conversas
export function presencaVisivel(usuarioId: number): { estado: EstadoPresenca; conversas: Set<number> } {
  const real = presencaReal(usuarioId)
  const prefs = preferencias(usuarioId)
  return {
    estado: prefs.aparecer_offline ? 'offline' : real.estado,
    conversas: prefs.aparecer_offline || !prefs.mostrar_na_conversa ? new Set() : real.conversas,
  }
}

// Avisa o que mudou: o estado aos contatos e a conversa aberta aos membros dela.
// Quem deixa de estar ativo grava o "visto por ultimo".
async function atualizarPresenca(usuarioId: number) {
  const visivel = presencaVisivel(usuarioId)
  const prefs = preferencias(usuarioId)

  const antes = estadoAvisado.get(usuarioId) ?? 'offline'
  if (visivel.estado === 'offline') {
    estadoAvisado.delete(usuarioId)
  } else {
    estadoAvisado.set(usuarioId, visivel.estado)
  }
  const avisadas = conversasAvisadas.get(usuarioId) ?? new Set<number>()
  if (visivel.conversas.size) {
    conversasAvisadas.set(usuarioId, visivel.conversas)
  } else {
    conversasAvisadas.delete(usuarioId)
  }
  if (!conexoes.has(usuarioId)) {
    preferenciasDoUsuario.delete(usuarioId)
  }

  try {
    if (visivel.estado !== antes) {
      // Saiu do ativo: guarda quando. Aparecendo offline, o visto por ultimo fica parado.
      let vistoEm: Date | null = null
      if (antes === 'ativo') {
        const [linha] = await comUsuario(0, (sql) => sql<{ visto_em: Date }[]>`
          update usuario set visto_em = current_timestamp where id = ${usuarioId} returning visto_em`)
        vistoEm = linha?.visto_em ?? null
      }
      await notificarContatosStatus(usuarioId, visivel.estado, prefs.mostrar_visto_em ? vistoEm : null)
    }
    for (const conversa of visivel.conversas) {
      if (!avisadas.has(conversa)) await notificarNaConversa(usuarioId, conversa, true)
    }
    for (const conversa of avisadas) {
      if (!visivel.conversas.has(conversa)) await notificarNaConversa(usuarioId, conversa, false)
    }
  } catch (erro) {
    console.error('[WebSocket] Falha ao avisar a presença do usuário', usuarioId, erro)
  }
}

// Preferencias trocadas na tela de configuracoes valem na hora
export async function alterarPreferenciasPresenca(usuarioId: number, novas: PreferenciasPresenca) {
  if (!conexoes.has(usuarioId)) {
    return
  }
  preferenciasDoUsuario.set(usuarioId, novas)
  await atualizarPresenca(usuarioId)
}

// Avisa quem tem conversa direta com o usuario que o estado dele mudou.
async function notificarContatosStatus(usuarioId: number, estado: EstadoPresenca, vistoEm: Date | null) {
  const contatos = await comUsuario(0, (sql) => sql<{ usuario_id: number }[]>`
    select distinct cu2.usuario_id
      from conversa_usuario cu1
     inner join conversa c on c.id = cu1.conversa_id and c.tipo = 1
     inner join conversa_usuario cu2 on cu2.conversa_id = cu1.conversa_id and cu2.usuario_id <> cu1.usuario_id
     where cu1.usuario_id = ${usuarioId}`)
  // O proprio usuario tambem recebe, para ver como os outros o veem
  for (const destino of [usuarioId, ...contatos.map((contato) => contato.usuario_id)]) {
    enviar(destino, { tipo: TipoMensagemSocket.StatusUsuario, usuario_id: usuarioId, online: estado !== 'offline', estado, visto_em: vistoEm })
  }
}

// Avisa os outros membros que o usuario abriu (ou saiu de) a conversa
async function notificarNaConversa(usuarioId: number, conversa: number, aberta: boolean) {
  const membros = await comUsuario(0, (sql) => sql<{ usuario_id: number }[]>`
    select usuario_id from conversa_usuario where conversa_id = ${conversa} and usuario_id <> ${usuarioId}`)
  for (const { usuario_id } of membros) {
    enviar(usuario_id, { tipo: TipoMensagemSocket.Presenca, conversa_id: conversa, usuario_id: usuarioId, aberta })
  }
}

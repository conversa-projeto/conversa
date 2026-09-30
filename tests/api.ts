// Chama a API sem subir o servidor: cada requisicao passa por autenticacao,
// validacao, permissao e SQL de verdade, no banco conversa_teste.
import { criarApp } from '../src/app.ts'
import { comUsuario, type Sql } from '../src/banco.ts'

const app = criarApp('chave-dos-testes')

interface Opcoes {
  token?: string
  corpo?: unknown
  // Texto enviado como está, com content-type JSON (para testar JSON inválido)
  corpoBruto?: string
  consulta?: Record<string, string | number>
}

export async function chamar(metodo: string, caminho: string, { token, corpo, corpoBruto, consulta }: Opcoes = {}) {
  const url = new URL(`http://localhost/api${caminho}`)
  for (const [nome, valor] of Object.entries(consulta ?? {})) {
    url.searchParams.set(nome, String(valor))
  }
  // Host como o navegador manda: a API monta com ele os endereços do MinIO,
  // que passam pelo nginx em https://localhost/storage.
  const headers: Record<string, string> = { host: url.host }
  if (token) headers.authorization = `Bearer ${token}`
  const body = corpoBruto ?? (corpo === undefined ? undefined : JSON.stringify(corpo))
  if (body !== undefined) headers['content-type'] = 'application/json'
  const resposta = await app.handle(new Request(url, { method: metodo, headers, body }))
  const texto = await resposta.text()
  // Os testes leem campos variados da resposta; o formato de cada rota e do app.
  const dados: any = texto ? JSON.parse(texto) : null
  return { status: resposta.status, dados }
}

// Login unico por teste, para os testes nao dependerem uns dos outros.
let sequencia = 0
export function loginUnico(prefixo = 'usuario') {
  return `${prefixo}${Date.now().toString(36)}${sequencia++}`
}

export interface UsuarioTeste {
  id: number
  login: string
  senha: string
  token: string
}

export async function criarUsuario(nome = 'Usuário de teste'): Promise<UsuarioTeste> {
  const login = loginUnico()
  const senha = 'senha-de-teste'
  const cadastro = await chamar('PUT', '/usuario', { corpo: { nome, login, email: `${login}@teste.test`, senha } })
  if (cadastro.status !== 200) throw new Error(`cadastro falhou: ${JSON.stringify(cadastro.dados)}`)
  const entrada = await chamar('POST', '/login', { corpo: { login, senha } })
  if (entrada.status !== 200) throw new Error(`login falhou: ${JSON.stringify(entrada.dados)}`)
  return { id: entrada.dados.id, login, senha, token: entrada.dados.token }
}

// Tres usuarios criados uma vez e reaproveitados pelos arquivos de teste: cada
// cadastro e login custa o hash bcrypt de producao. Cada teste cria as proprias
// conversas, entao continuam independentes.
let comuns: Promise<{ ana: UsuarioTeste; bruno: UsuarioTeste; carla: UsuarioTeste }> | null = null
export function usuariosComuns() {
  comuns ??= (async () => {
    const [ana, bruno, carla] = await Promise.all([criarUsuario('Ana'), criarUsuario('Bruno'), criarUsuario('Carla')])
    return { ana, bruno, carla }
  })()
  return comuns
}

// Conversa criada por "dono", com os demais adicionados como membros.
export async function criarConversa(dono: UsuarioTeste, membros: UsuarioTeste[], tipo = membros.length > 1 ? 2 : 1): Promise<number> {
  const conversa = await chamar('PUT', '/conversa', { token: dono.token, corpo: { descricao: 'Conversa de teste', tipo } })
  if (conversa.status !== 200) throw new Error(`conversa falhou: ${JSON.stringify(conversa.dados)}`)
  for (const membro of membros) {
    await chamar('PUT', '/conversa/usuario', { token: dono.token, corpo: { conversa_id: conversa.dados.id, usuario_id: membro.id } })
  }
  return conversa.dados.id
}

export async function enviarTexto(autor: UsuarioTeste, conversa: number, texto: string, extras: Record<string, unknown> = {}) {
  return chamar('PUT', '/mensagem', { token: autor.token, corpo: { conversa_id: conversa, conteudos: [{ ordem: 1, tipo: 1, conteudo: texto }], ...extras } })
}

// Acesso direto ao banco, para preparar situacoes que a API nao cria sozinha
// (mensagem agendada vencida, anexo antigo, senha legada).
export function noBanco<T>(operacao: (sql: Sql) => Promise<T>) {
  return comUsuario(0, operacao)
}

// --- Anexos, com envio de verdade ao MinIO pelo nginx, como o navegador faz ---

export async function enviarAnexo(quem: UsuarioTeste, conteudo: string | Uint8Array<ArrayBuffer>, tipo = 3, nome = 'arquivo.txt') {
  const bytes = typeof conteudo === 'string' ? new TextEncoder().encode(conteudo) : conteudo
  const identificador = new Bun.CryptoHasher('sha256').update(bytes).digest('hex')
  const extensao = nome.split('.').pop() ?? ''
  const pedido = await chamar('PUT', '/anexo', { token: quem.token, corpo: { identificador, tipo, nome, extensao, tamanho: bytes.length } })
  if (pedido.status !== 200) throw new Error(`anexo falhou: ${JSON.stringify(pedido.dados)}`)
  if (!pedido.dados.existe) {
    const envio = await fetch(pedido.dados.upload_url, { method: 'PUT', body: bytes, tls: { rejectUnauthorized: false } })
    if (!envio.ok) throw new Error(`upload ao MinIO falhou: ${envio.status} ${await envio.text()}`)
  }
  return { identificador, pedido: pedido.dados }
}

// --- WebSocket: a mesma API escutando numa porta livre ---

let servidor: ReturnType<typeof app.listen> | null = null
function enderecoSocket() {
  servidor ??= app.listen({ port: 0, hostname: '127.0.0.1' })
  return `ws://127.0.0.1:${servidor.server!.port}/ws/`
}

export interface EventoSocket {
  tipo: number
  [campo: string]: unknown
}

export interface SocketTeste {
  eventos: EventoSocket[]
  enviar(dados: unknown): void
  esperar(filtro: (evento: EventoSocket) => boolean, ms?: number): Promise<EventoSocket>
  nadaChega(filtro: (evento: EventoSocket) => boolean, ms?: number): Promise<void>
  fechar(): Promise<void>
}

// Conecta e, com usuario, faz o login pela primeira mensagem, como a pagina.
export async function conectarSocket(usuario?: UsuarioTeste): Promise<SocketTeste> {
  const ws = new WebSocket(enderecoSocket())
  const eventos: EventoSocket[] = []
  const esperando = new Set<() => void>()
  ws.onmessage = (mensagem) => {
    eventos.push(JSON.parse(String(mensagem.data)))
    for (const avisar of esperando) avisar()
  }
  await new Promise<void>((resolver, rejeitar) => {
    ws.onopen = () => resolver()
    ws.onerror = () => rejeitar(new Error('WebSocket não conectou'))
  })

  const socket: SocketTeste = {
    eventos,
    enviar: (dados) => ws.send(typeof dados === 'string' ? dados : JSON.stringify(dados)),
    esperar(filtro, ms = 3000) {
      return new Promise((resolver, rejeitar) => {
        const conferir = () => {
          const achado = eventos.find(filtro)
          if (!achado) return
          esperando.delete(conferir)
          clearTimeout(limite)
          resolver(achado)
        }
        const limite = setTimeout(() => {
          esperando.delete(conferir)
          rejeitar(new Error(`evento esperado não chegou; recebidos: ${JSON.stringify(eventos)}`))
        }, ms)
        esperando.add(conferir)
        conferir()
      })
    },
    async nadaChega(filtro, ms = 500) {
      await Bun.sleep(ms)
      const indevido = eventos.find(filtro)
      if (indevido) throw new Error(`evento que não devia chegar: ${JSON.stringify(indevido)}`)
    },
    fechar() {
      return new Promise((resolver) => {
        if (ws.readyState === WebSocket.CLOSED) return resolver()
        ws.onclose = () => resolver()
        ws.close()
      })
    },
  }

  if (usuario) {
    socket.enviar({ tipo: 1, token: usuario.token })
    // O login nao tem resposta; a conexao passa a valer quando a API processa.
    await Bun.sleep(100)
  }
  return socket
}

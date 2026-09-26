import { openapi } from '@elysiajs/openapi'
import { Elysia, type ValidationError } from 'elysia'
import { criarToken, usuarioDoToken } from './autenticacao.ts'
import { ErroHttp } from './erros.ts'
import { criarRotas } from './rotas.ts'
import { criarWebSocket } from './websocket.ts'

// Tipo JSON Schema de um campo, para a mensagem de erro. Numero na consulta e
// uma uniao (texto com formato de numero, ou numero); vale o que nao e texto.
function tipoDoEsquema(esquema: unknown): string {
  if (typeof esquema !== 'object' || esquema === null) return 'desconhecido'
  const { type, anyOf } = esquema as { type?: unknown; anyOf?: unknown[] }
  if (type !== undefined) return String(type)
  const tipos = (anyOf ?? []).map(tipoDoEsquema).filter((tipo) => tipo !== 'desconhecido')
  return tipos.find((tipo) => tipo !== 'string') ?? tipos[0] ?? 'desconhecido'
}

// Em erro de limite (minimo, maximo) na consulta o Elysia nao informa o campo;
// ele e achado pelo valor na URL.
function campoPeloValor(consulta: URLSearchParams, valor: unknown): string | undefined {
  return [...consulta].find(([, recebido]) => recebido === String(valor))?.[0]
}

// Mensagens de validacao em portugues, no mesmo formato de antes.
function mensagemValidacao(erro: Readonly<ValidationError>, consulta: URLSearchParams): string {
  const [primeiro] = erro.all
  const onde = erro.type === 'query' || erro.type === 'property' ? 'querystring' : erro.type
  if (!primeiro || !('path' in primeiro)) {
    return `Dados inválidos em "${onde}"`
  }
  const campo = primeiro.path.replace(/^\//, '').replaceAll('/', '.') || campoPeloValor(consulta, primeiro.value) || onde
  if (primeiro.value === undefined) {
    return `Campo "${campo}" é obrigatório e não foi informado!`
  }
  if (/^Expected (integer|number|string|boolean|object|array|union value|null)$/i.test(primeiro.message)) {
    return `O valor de "${campo}" deve ser do tipo ${tipoDoEsquema(primeiro.schema)}!`
  }
  return `Valor inválido em "${campo}": ${primeiro.message}`
}

// A API inteira, sem subir o servidor. O tipo App e o que a pagina usa no
// cliente Eden.
export function criarApp(segredoJwt: string) {
  const token = criarToken(segredoJwt)
  const verificarToken = (valor: string) => usuarioDoToken(token.decorator.jwt.verify, valor)

  return new Elysia()
    // Documentacao das rotas em /api/docs (JSON em /api/docs/json)
    .use(openapi({
      path: '/api/docs',
      documentation: { info: { title: 'Conversa API', version: '1.0.0' } },
      // O plugin passa o caminho do JSON relativo (api/docs/json), que em
      // /api/docs vira /api/api/docs/json. Aqui vai o caminho absoluto.
      scalar: { url: '/api/docs/json' },
    }))
    // Resposta de erro sempre como { error: mensagem }, formato que a pagina le.
    .onError({ as: 'global' }, ({ code, error, set, request }) => {
      if (error instanceof ErroHttp) {
        set.status = error.status
        return { error: error.message }
      }
      if (code === 'VALIDATION') {
        set.status = 400
        return { error: mensagemValidacao(error, new URL(request.url).searchParams) }
      }
      if (code === 'NOT_FOUND') {
        set.status = 404
        return { error: `Rota ${request.method}:${new URL(request.url).pathname} não encontrada` }
      }
      if (code === 'PARSE') {
        set.status = 400
        return { error: 'Corpo da requisição inválido!' }
      }
      console.error(error)
      set.status = 500
      return { error: error instanceof Error ? error.message : String(error) }
    })
    .use(criarWebSocket(verificarToken))
    .use(criarRotas(token))
}

export type App = ReturnType<typeof criarApp>

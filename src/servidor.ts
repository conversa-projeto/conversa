import fastifyEnv from '@fastify/env'
import { fastifyRequestContext } from '@fastify/request-context'
import jwt from '@fastify/jwt'
import schedule from '@fastify/schedule'
import sensible from '@fastify/sensible'
import closeWithGrace from 'close-with-grace'
import Fastify from 'fastify'
import { comUsuario, encerrarBanco, garantirBanco, iniciarBanco } from './banco.ts'
import { carregarParametros, configuracao, definirAmbiente, esquemaAmbiente, resolverPepper, type Ambiente } from './configuracao.ts'
import { executarMigracoes } from './migracoes.ts'
import { iniciarMinio, verificarBucketS3 } from './minio.ts'
import { registrarRotas } from './rotas.ts'
import { registrarTarefas } from './tarefas.ts'
import { registrarWebSocket } from './websocket.ts'

const app = Fastify({
  logger: { level: 'warn' },
  // Mensagens de validacao em portugues.
  schemaErrorFormatter: (erros, contexto) => {
    const [erro] = erros
    const campo = erro.instancePath.replace(/^\//, '').replaceAll('/', '.') || contexto
    if (erro.keyword === 'required') {
      return new Error(`Campo "${(erro.params as { missingProperty: string }).missingProperty}" é obrigatório e não foi informado!`)
    }
    if (erro.keyword === 'type') {
      return new Error(`O valor de "${campo}" deve ser do tipo ${(erro.params as { type: string | string[] }).type}!`)
    }
    return new Error(`Valor inválido em "${campo}": ${erro.message}`)
  },
})

await app.register(fastifyEnv, { schema: esquemaAmbiente })
definirAmbiente(app.getEnvs<Ambiente>())

iniciarBanco(configuracao.banco)
app.addHook('onClose', encerrarBanco)

try {
  await garantirBanco(configuracao.banco)
  await executarMigracoes()
} catch (erro) {
  console.error('Erro ao executar as migrações no banco de dados 😵 -', erro instanceof Error ? erro.message : erro)
  process.exit(1)
}

try {
  await comUsuario(0, resolverPepper)
} catch (erro) {
  console.error('☠️ ', erro instanceof Error ? erro.message : erro)
  process.exit(1)
}

await comUsuario(0, carregarParametros)
iniciarMinio()
await verificarBucketS3()

await app.register(sensible)
await app.register(jwt, { secret: configuracao.jwtKey })
await app.register(schedule)
await app.register(fastifyRequestContext)

// Endereco que o navegador usou, repassado pelo Vite ou pelo nginx no Host e
// no X-Forwarded-Proto. As URLs do MinIO sao montadas com ele.
app.addHook('onRequest', async (req) => {
  const protocolo = String(req.headers['x-forwarded-proto'] ?? 'https').split(',')[0].trim()
  req.requestContext.set('origemPublica', `${protocolo}://${req.headers.host}`)
})

// Sem token: login, cadastro e o WebSocket, que autentica pela primeira mensagem.
const ROTAS_PUBLICAS = new Set(['POST /api/login', 'PUT /api/usuario', 'GET /ws/'])

app.addHook('onRequest', async (req) => {
  if (ROTAS_PUBLICAS.has(`${req.method} ${req.routeOptions.url}`)) {
    return
  }
  try {
    await req.jwtVerify()
  } catch (erro) {
    throw app.httpErrors.unauthorized(erro instanceof Error ? erro.message : 'Token inválido')
  }
})

// Resposta de erro sempre como { error: mensagem }, formato que o frontend le.
app.setErrorHandler((erro, req, reply) => {
  const status = (erro as { statusCode?: number }).statusCode ?? 500
  if (status >= 500) {
    req.log.error(erro)
  }
  return reply.status(status).send({ error: erro instanceof Error ? erro.message : String(erro) })
})

await registrarWebSocket(app, (token) => {
  const claims = app.jwt.verify<{ sub?: string; exp?: number; iat?: number }>(token)
  if (!claims.sub || !claims.exp || !claims.iat) {
    throw new Error('Token sem sub, exp ou iat')
  }
  return { sub: claims.sub }
})
await registrarRotas(app)
registrarTarefas(app)

closeWithGrace({ delay: 10_000 }, async ({ err }) => {
  if (err) {
    console.error(err)
  }
  await app.close()
})

await app.listen({ port: configuracao.portaHttp, host: '0.0.0.0' })
console.log(`Servidor iniciado 🚀 HTTP e WebSocket na porta ${configuracao.portaHttp}`)

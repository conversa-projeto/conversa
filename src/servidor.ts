import { criarApp } from './app.ts'
import { comUsuario, encerrarBanco, garantirBanco, iniciarBanco } from './banco.ts'
import { carregarParametros, configuracao, definirAmbiente, resolverPepper } from './configuracao.ts'
import { executarMigracoes } from './migracoes.ts'
import { iniciarMinio, verificarBucketS3 } from './minio.ts'
import { iniciarTarefas } from './tarefas.ts'

definirAmbiente()
iniciarBanco(configuracao.banco)

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

// O token de login e assinado com o parametro jwt_token, carregado acima.
const app = criarApp(configuracao.jwtKey).listen({ port: configuracao.portaHttp, hostname: '0.0.0.0' })
const pararTarefas = iniciarTarefas()
console.log(`Servidor iniciado 🚀 HTTP e WebSocket na porta ${configuracao.portaHttp}`)

// Encerramento: para de aceitar requisicoes, termina as tarefas e fecha o
// banco. Se travar, sai de qualquer jeito depois de 10 segundos.
async function encerrar(sinal: string) {
  console.log(`${sinal} recebido, encerrando...`)
  setTimeout(() => process.exit(1), 10_000).unref()
  pararTarefas()
  await app.stop()
  await encerrarBanco()
  process.exit(0)
}

for (const sinal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(sinal, () => void encerrar(sinal))
}

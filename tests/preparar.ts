// Carregado antes dos testes (bunfig.toml). Recria o banco conversa_teste do
// zero, aplica as migracoes, prepara um bucket de teste no MinIO e deixa a
// conexao pronta para a API.
//
// Usa o PostgreSQL e o MinIO do Docker (127.0.0.1:5433 e 127.0.0.1:9000). O
// nome do banco e do bucket sao fixos de proposito: nunca vem de variavel de
// ambiente, para os testes jamais apagarem os dados da aplicacao.
import { afterAll, mock } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import postgres from 'postgres'
import { pushEnviados } from './fcmFalso.ts'

const BANCO_TESTE = 'conversa_teste'
const log = console.log
const BUCKET_TESTE = 'conversa-teste'

// Push de verdade exige uma conta do Firebase: o envio e trocado por um que so
// registra, antes de qualquer modulo da API carregar o firebase-admin.
mock.module('firebase-admin/app', () => ({ cert: (dados: unknown) => dados, initializeApp: () => ({}) }))
mock.module('firebase-admin/messaging', () => ({
  getMessaging: () => ({ send: async (mensagem: unknown) => void pushEnviados.push(mensagem as never) }),
}))

const { comUsuario, encerrarBanco, garantirBanco, iniciarBanco } = await import('../src/banco.ts')
const { carregarParametros, configuracao, definirAmbiente, resolverPepper } = await import('../src/configuracao.ts')
const { executarMigracoes } = await import('../src/migracoes.ts')
const { iniciarMinio, verificarBucketS3 } = await import('../src/minio.ts')
const { Client } = await import('minio')

process.env.CONVERSA_SERVER ??= '127.0.0.1'
process.env.CONVERSA_PORT ??= '5433'
process.env.CONVERSA_PASSWORD ??= process.env.POSTGRES_PASSWORD ?? 'root'
process.env.CONVERSA_S3_INTERNO ??= 'http://127.0.0.1:9000'
definirAmbiente()
configuracao.banco.database = BANCO_TESTE

const { host, port, user, password } = configuracao.banco
const servidor = postgres({ host, port, username: user, password, database: 'postgres', max: 1, onnotice: () => {} })
try {
  await servidor`drop database if exists ${servidor(BANCO_TESTE)} with (force)`
  // Recriado pela mesma funcao que a API usa ao iniciar
  console.log = () => {}
  await garantirBanco(configuracao.banco)
} catch (erro) {
  throw new Error(`Não foi possível recriar o banco ${BANCO_TESTE} em ${host}:${port}. O PostgreSQL do Docker está no ar? (${erro instanceof Error ? erro.message : erro})`)
} finally {
  console.log = log
  await servidor.end()
}

iniciarBanco(configuracao.banco)
console.log = () => {}
await executarMigracoes()
console.log = log

// Usuario e senha do MinIO ficam no volume do container; fora do Docker, lidos
// por docker exec (ou informados em CONVERSA_TESTE_MINIO_USUARIO e _SENHA).
function credencialMinio(arquivo: string, variavel: string) {
  const informada = process.env[variavel]?.trim()
  if (informada) return informada
  const leitura = Bun.spawnSync(['docker', 'exec', 'minio', 'cat', `/dados/${arquivo}`])
  const valor = leitura.stdout.toString().trim()
  if (!valor) throw new Error(`Credencial do MinIO não encontrada: o container "minio" está no ar? (${leitura.stderr.toString().trim()})`)
  return valor
}

// Pasta de dados temporaria no lugar do volume /dados: o pepper e gerado nela e
// as credenciais do MinIO sao copiadas para ela. Assim a configuracao e
// carregada pelo mesmo caminho do servidor (resolverPepper e carregarParametros).
const pastaTeste = mkdtempSync(join(tmpdir(), 'conversa-dados-'))
process.env.CONVERSA_DADOS = pastaTeste
writeFileSync(join(pastaTeste, 'minio-usuario'), credencialMinio('minio-usuario', 'CONVERSA_TESTE_MINIO_USUARIO'))
writeFileSync(join(pastaTeste, 'minio-senha'), credencialMinio('minio-senha', 'CONVERSA_TESTE_MINIO_SENHA'))

console.log = () => {}
await comUsuario(0, async (sql) => {
  await sql`update parametros set valor = ${BUCKET_TESTE} where nome = 's3_bucket'`
  await resolverPepper(sql)
  await carregarParametros(sql)
})
iniciarMinio()
await verificarBucketS3()
console.log = log

// O push falso precisa de uma conta preenchida para ser chamado
configuracao.fcm = { projectId: 'teste', clientEmail: 'teste@teste.test', privateKey: 'chave' }

afterAll(async () => {
  // Apaga o bucket de teste com tudo o que os testes enviaram
  const url = new URL(configuracao.s3Interno)
  const minio = new Client({
    endPoint: url.hostname, port: Number(url.port), useSSL: false, region: 'us-east-1',
    accessKey: configuracao.s3.accessKey, secretKey: configuracao.s3.secretKey,
  })
  const objetos: string[] = []
  for await (const objeto of minio.listObjectsV2(BUCKET_TESTE, '', true)) {
    if (objeto.name) objetos.push(objeto.name)
  }
  if (objetos.length) await minio.removeObjects(BUCKET_TESTE, objetos)
  await minio.removeBucket(BUCKET_TESTE)
  await encerrarBanco()
  rmSync(pastaTeste, { recursive: true, force: true })
})

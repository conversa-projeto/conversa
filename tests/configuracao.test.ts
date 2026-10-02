import { afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { createHmac } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Sql } from '../src/banco.ts'
import { carregarParametros, configuracao, pastaDados, pastaGravacoes, resolverPepper } from '../src/configuracao.ts'
import { iniciarMinio, verificarBucketS3 } from '../src/minio.ts'
import { chamar, usuariosComuns, type UsuarioTeste } from './api.ts'

let ana: UsuarioTeste
beforeAll(async () => ({ ana } = await usuariosComuns()))

// Cada teste usa uma pasta de dados própria e devolve a do preparar.ts no fim,
// junto com a configuração que tiver mexido.
const pastaOriginal = process.env.CONVERSA_DADOS
const original = structuredClone({ ...configuracao, banco: configuracao.banco })
const pastas: string[] = []
function novaPasta(arquivos: Record<string, string> = {}) {
  const pasta = mkdtempSync(join(tmpdir(), 'conversa-config-'))
  for (const [nome, conteudo] of Object.entries(arquivos)) writeFileSync(join(pasta, nome), conteudo)
  process.env.CONVERSA_DADOS = pasta
  pastas.push(pasta)
  return pasta
}
afterEach(() => {
  process.env.CONVERSA_DADOS = pastaOriginal
  Object.assign(configuracao, structuredClone(original))
  iniciarMinio()
  for (const pasta of pastas.splice(0)) rmSync(pasta, { recursive: true, force: true })
})

// sql falso: devolve as linhas informadas e guarda o texto de cada consulta.
function sqlFalso(linhas: unknown[] = []) {
  const consultas: string[] = []
  const sql = ((partes: TemplateStringsArray) => {
    consultas.push(partes.join('?'))
    return Promise.resolve(linhas)
  }) as unknown as Sql
  Object.assign(sql, { unsafe: () => Promise.resolve([]) })
  // sql(lista) nos parâmetros: devolve a própria lista
  return { sql: new Proxy(sql, { apply: (alvo, este, args) => (Array.isArray(args[0]) && !('raw' in args[0]) ? args[0] : Reflect.apply(alvo, este, args)) }), consultas }
}

async function capturarLog(executar: () => Promise<void>) {
  const linhas: string[] = []
  const log = console.log
  console.log = (...partes: unknown[]) => void linhas.push(partes.join(' '))
  try {
    await executar()
  } finally {
    console.log = log
  }
  return linhas.join('\n')
}

describe('pasta de dados', () => {
  test('padrão é /dados; CONVERSA_DADOS troca', () => {
    delete process.env.CONVERSA_DADOS
    expect(pastaDados()).toBe('/dados')
    process.env.CONVERSA_DADOS = '/outra'
    expect(pastaDados()).toBe('/outra')
  })
})

describe('pasta das gravações', () => {
  test('padrão é /gravacoes; CONVERSA_GRAVACOES troca', () => {
    const original = process.env.CONVERSA_GRAVACOES
    try {
      delete process.env.CONVERSA_GRAVACOES
      expect(pastaGravacoes()).toBe('/gravacoes')
      process.env.CONVERSA_GRAVACOES = '/outra'
      expect(pastaGravacoes()).toBe('/outra')
    } finally {
      process.env.CONVERSA_GRAVACOES = original
    }
  })
})

describe('pepper das senhas', () => {
  test('lê o pepper do arquivo', async () => {
    novaPasta({ pepper: '  segredo-gravado \n' })
    await resolverPepper(sqlFalso().sql)
    expect(configuracao.bcryptPepper).toBe('segredo-gravado')
  })

  test('arquivo vazio impede a inicialização', async () => {
    novaPasta({ pepper: '   ' })
    await expect(resolverPepper(sqlFalso().sql)).rejects.toThrow('Arquivo de pepper vazio')
  })

  test('sem arquivo e com senhas já criadas, não gera outro (as senhas deixariam de conferir)', async () => {
    novaPasta()
    await expect(resolverPepper(sqlFalso([{ existe: true }]).sql)).rejects.toThrow('Pepper não encontrado!')
  })

  test('instalação nova: gera e grava o pepper', async () => {
    const pasta = novaPasta()
    const log = await capturarLog(() => resolverPepper(sqlFalso([{ existe: false }]).sql))
    const gravado = readFileSync(join(pasta, 'pepper'), 'utf8').trim()
    expect(gravado.length).toBeGreaterThanOrEqual(40)
    expect(configuracao.bcryptPepper).toBe(gravado)
    expect(log).toContain('Pepper das senhas gerado')
  })
})

describe('parâmetros', () => {
  const todos = (valores: Record<string, string> = {}) => Object.entries({
    jwt_token: 'chave-existente',
    fcm_project_id: 'p', fcm_client_email: 'e', fcm_private_key: 'k',
    s3_bucket: 'chat', turn_forcar_relay: '0', transcritor_url: 'http://t', transcritor_idioma: 'en',
    gravacao_dias: '30',
    ...valores,
  }).map(([nome, valor]) => ({ nome, valor }))

  test('carrega os valores do banco e as credenciais do MinIO da pasta de dados', async () => {
    novaPasta({ 'minio-usuario': 'usuario-minio', 'minio-senha': 'senha-minio' })
    await capturarLog(() => carregarParametros(sqlFalso(todos({ turn_forcar_relay: '1' })).sql))
    expect(configuracao).toMatchObject({
      jwtKey: 'chave-existente',
      transcritorUrl: 'http://t',
      transcritorIdioma: 'en',
      turnForcarRelay: true,
      gravacaoDias: 30,
      s3: { accessKey: 'usuario-minio', secretKey: 'senha-minio', bucket: 'chat' },
    })
  })

  test.each([['0', 0], ['365', 365]])('dias das gravações %p', async (texto, dias) => {
    novaPasta({ 'minio-usuario': 'u', 'minio-senha': 's' })
    await capturarLog(() => carregarParametros(sqlFalso(todos({ gravacao_dias: texto })).sql))
    expect(configuracao.gravacaoDias).toBe(dias)
  })

  test.each([[''], ['-1'], ['1.5'], ['noventa']])('dias das gravações inválido (%p) fica em 90, com aviso', async (texto) => {
    novaPasta({ 'minio-usuario': 'u', 'minio-senha': 's' })
    const log = await capturarLog(() => carregarParametros(sqlFalso(todos({ gravacao_dias: texto })).sql))
    expect(configuracao.gravacaoDias).toBe(90)
    expect(log).toContain('"gravacao_dias" inválido')
  })

  test('parâmetro faltando impede a inicialização', async () => {
    novaPasta({ 'minio-usuario': 'u', 'minio-senha': 's' })
    const semTranscritor = todos().filter((p) => p.nome !== 'transcritor_url')
    await expect(carregarParametros(sqlFalso(semTranscritor).sql)).rejects.toThrow('"transcritor_url" não configurado')
  })

  test('credencial do MinIO ausente impede a inicialização', async () => {
    novaPasta({ 'minio-usuario': 'u' })
    await expect(carregarParametros(sqlFalso(todos()).sql)).rejects.toThrow('Credencial do MinIO não encontrada')
  })

  test.each([[''], ['S3RV1D0R_4P1_C0NV3R54']])('chave dos logins vazia ou a pública (%p) é trocada por uma aleatória', async (chave) => {
    novaPasta({ 'minio-usuario': 'u', 'minio-senha': 's' })
    const { sql, consultas } = sqlFalso(todos({ jwt_token: chave }))
    const log = await capturarLog(() => carregarParametros(sql))
    expect(configuracao.jwtKey).not.toBe(chave)
    expect(configuracao.jwtKey.length).toBeGreaterThanOrEqual(60)
    expect(consultas.some((c) => c.includes("update parametros set valor = ? where nome = 'jwt_token'"))).toBe(true)
    expect(log).toContain('"jwt_token" gerado')
  })

  test('avisa o que está desligado: push, anexos e transcrição', async () => {
    novaPasta({ 'minio-usuario': 'u', 'minio-senha': 's' })
    const log = await capturarLog(() => carregarParametros(sqlFalso(todos({ fcm_project_id: '', s3_bucket: '', transcritor_url: '' })).sql))
    expect(log).toContain('FCM não vão funcionar')
    expect(log).toContain('Anexos não vão funcionar')
    expect(log).toContain('transcrição de áudio desligada')
  })
})

describe('servidores ICE com o segredo do TURN', () => {
  const ice = () => chamar('GET', '/ice', { token: ana.token })

  test('credencial temporária no formato do coturn, no endereço usado pelo navegador', async () => {
    novaPasta({ 'turn-segredo': 'segredo-turn\n' })
    configuracao.turnPorta = ''
    configuracao.turnForcarRelay = false
    const { dados } = await ice()
    const [servidor] = dados.iceServers
    expect(servidor.urls).toBe('turn:localhost:3478?transport=tcp')
    const [expira, usuario] = servidor.username.split(':')
    expect(Number(usuario)).toBe(ana.id)
    expect(Number(expira)).toBeGreaterThan(Date.now() / 1000 + 3500)
    expect(servidor.credential).toBe(createHmac('sha1', 'segredo-turn').update(servidor.username).digest('base64'))
    expect(dados.iceTransportPolicy).toBe('all')
  })

  test('produção: porta pública da borda com TLS e relay obrigatório', async () => {
    novaPasta({ 'turn-segredo': 'segredo-turn' })
    configuracao.turnPorta = '8443'
    configuracao.turnForcarRelay = true
    const { dados } = await ice()
    expect(dados.iceServers[0].urls).toBe('turns:localhost:8443?transport=tcp')
    expect(dados.iceTransportPolicy).toBe('relay')
  })
})

describe('verificação do bucket no MinIO', () => {
  test('credenciais recusadas geram aviso, sem derrubar a inicialização', async () => {
    configuracao.s3 = { ...configuracao.s3, secretKey: 'senha-errada' }
    iniciarMinio()
    expect(await capturarLog(() => verificarBucketS3())).toContain('MinIO recusou as credenciais')
  })

  test('MinIO fora do ar gera aviso', async () => {
    configuracao.s3Interno = 'http://127.0.0.1:1'
    iniciarMinio()
    expect(await capturarLog(() => verificarBucketS3())).toContain('MinIO inacessível')
  })

  test('bucket inexistente é criado; nome inválido gera aviso', async () => {
    const bucket = `conversa-teste-novo-${Date.now()}`
    configuracao.s3 = { ...configuracao.s3, bucket }
    iniciarMinio()
    expect(await capturarLog(() => verificarBucketS3())).toContain(`Bucket "${bucket}" não existia no MinIO e foi criado`)
    configuracao.s3 = { ...configuracao.s3, bucket: 'Nome_Invalido' }
    iniciarMinio()
    expect(await capturarLog(() => verificarBucketS3())).toMatch(/não existe e não pôde ser criado|MinIO inacessível/)
    // remove o bucket criado
    const { Client } = await import('minio')
    const url = new URL(configuracao.s3Interno)
    await new Client({ endPoint: url.hostname, port: Number(url.port), useSSL: false, accessKey: configuracao.s3.accessKey, secretKey: configuracao.s3.secretKey }).removeBucket(bucket)
  })

  test('sem bucket configurado não verifica nada', async () => {
    configuracao.s3 = { ...configuracao.s3, bucket: ' ' }
    iniciarMinio()
    expect(await capturarLog(() => verificarBucketS3())).toBe('')
  })
})

test('a pasta de dados do preparar.ts guarda o pepper gerado', () => {
  expect(existsSync(join(pastaOriginal!, 'pepper'))).toBe(true)
})

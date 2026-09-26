import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Sql } from './banco.ts'

export interface ConfigS3 {
  accessKey: string
  secretKey: string
  bucket: string
}

export interface ConfigBanco {
  host: string
  port: number
  database: string
  user: string
  password: string
}

// Variaveis de ambiente, conferidas na inicializacao. O Bun tambem le um
// arquivo .env na pasta atual.
function textoAmbiente(nome: string, padrao: string): string {
  return process.env[nome] ?? padrao
}

function inteiroAmbiente(nome: string, padrao: number): number {
  const valor = process.env[nome]?.trim()
  if (!valor) {
    return padrao
  }
  const numero = Number(valor)
  if (!Number.isInteger(numero)) {
    throw new Error(`Variável de ambiente ${nome} deve ser um número inteiro (recebido "${valor}").`)
  }
  return numero
}

export const configuracao = {
  banco: {} as ConfigBanco,
  portaHttp: 8080,
  bcryptPepper: '',
  s3Interno: '',

  jwtKey: '',
  fcm: { projectId: '', clientEmail: '', privateKey: '' },
  s3: { accessKey: '', secretKey: '', bucket: '' } as ConfigS3,
  turnPorta: '',
  turnForcarRelay: false,
  transcritorUrl: '',
  transcritorIdioma: 'pt',
}

export function definirAmbiente() {
  configuracao.banco = {
    host: textoAmbiente('CONVERSA_SERVER', 'localhost'),
    port: inteiroAmbiente('CONVERSA_PORT', 5432),
    // Criado na inicializacao se nao existir.
    database: textoAmbiente('CONVERSA_DATABASE', 'conversa'),
    user: textoAmbiente('CONVERSA_USERNAME', 'postgres'),
    password: textoAmbiente('CONVERSA_PASSWORD', ''),
  }
  configuracao.portaHttp = inteiroAmbiente('CONVERSA_PORTA_HTTP', 8080)
  // Endereco do MinIO para chamadas do proprio servidor. O endereco que vai
  // para o navegador vem de cada requisicao.
  configuracao.s3Interno = textoAmbiente('CONVERSA_S3_INTERNO', 'http://127.0.0.1:9000')
  // Producao: porta publica da borda para o TURN, com TLS terminado la.
  // Vazio usa o coturn direto na 3478, como em desenvolvimento.
  configuracao.turnPorta = textoAmbiente('CONVERSA_TURN_PORTA', '').trim()
}

// Pepper das senhas, sempre neste arquivo. No Docker e o volume conversa-dados.
const ARQUIVO_PEPPER = '/dados/pepper'

// Le o pepper do arquivo ou, em instalacao nova, gera e grava. Ele fica fora do
// banco de proposito: um dump vazado nao leva junto o que falta para quebrar
// as senhas.
export async function resolverPepper(sql: Sql) {
  const arquivo = ARQUIVO_PEPPER
  if (existsSync(arquivo)) {
    configuracao.bcryptPepper = readFileSync(arquivo, 'utf8').trim()
    if (!configuracao.bcryptPepper) {
      throw new Error(`Arquivo de pepper vazio: ${arquivo}`)
    }
    return
  }

  // Um pepper novo invalidaria as senhas bcrypt que ja existem. Senhas legadas
  // em texto puro nao dependem dele e sao convertidas no proximo login.
  const [linha] = await sql<{ existe: boolean }[]>`select exists (select 1 from usuario where length(senha) = 60) as existe`
  if (linha?.existe) {
    throw new Error(
      `Pepper não encontrado! O banco já tem senhas criadas com um pepper. Grave o pepper original em ${arquivo}.`,
    )
  }

  configuracao.bcryptPepper = randomBytes(32).toString('base64url')
  mkdirSync(dirname(arquivo), { recursive: true })
  writeFileSync(arquivo, `${configuracao.bcryptPepper}\n`, { mode: 0o600, flag: 'wx' })
  console.log(`ℹ  Pepper das senhas gerado em ${arquivo}. Inclua esse arquivo no backup: sem ele nenhum login confere.`)
}

// Usuario e senha do MinIO, gerados pelo container minio no mesmo volume do pepper.
function lerCredencialMinio(nome: string) {
  const arquivo = `${dirname(ARQUIVO_PEPPER)}/${nome}`
  const valor = existsSync(arquivo) ? readFileSync(arquivo, 'utf8').trim() : ''
  if (!valor) {
    throw new Error(`Credencial do MinIO não encontrada em ${arquivo}. Ela é gerada pelo container minio ao iniciar.`)
  }
  return valor
}

// Valor inserido pela migracao 015.
const JWT_PADRAO = 'S3RV1D0R_4P1_C0NV3R54'

const PARAMETROS = [
  'jwt_token',
  'fcm_project_id',
  'fcm_client_email',
  'fcm_private_key',
  's3_bucket',
  'turn_forcar_relay',
  'transcritor_url',
  'transcritor_idioma',
]

export async function carregarParametros(sql: Sql) {
  const linhas = await sql<{ nome: string; valor: string }[]>`select nome, valor from parametros where nome in ${sql(PARAMETROS)}`
  const valores = new Map(linhas.map((linha) => [linha.nome, linha.valor]))
  for (const nome of PARAMETROS) {
    if (!valores.has(nome)) {
      throw new Error(`Erro ao carregar as configurações do banco! ☠️ - "${nome}" não configurado nos parâmetros!`)
    }
  }
  const valor = (nome: string) => valores.get(nome)!

  // A chave que assina os logins nasce com um valor publico, que esta no
  // codigo. Vazia ou com esse valor, e trocada por uma aleatoria.
  configuracao.jwtKey = valor('jwt_token')
  if (!configuracao.jwtKey.trim() || configuracao.jwtKey === JWT_PADRAO) {
    configuracao.jwtKey = randomBytes(48).toString('base64url')
    await sql`update parametros set valor = ${configuracao.jwtKey} where nome = 'jwt_token'`
    console.log('ℹ  Parâmetro "jwt_token" gerado. Quem estava logado antes precisa entrar de novo.')
  }
  configuracao.fcm = {
    projectId: valor('fcm_project_id'),
    clientEmail: valor('fcm_client_email'),
    privateKey: valor('fcm_private_key'),
  }
  configuracao.s3 = {
    accessKey: lerCredencialMinio('minio-usuario'),
    secretKey: lerCredencialMinio('minio-senha'),
    bucket: valor('s3_bucket'),
  }
  configuracao.turnForcarRelay = valor('turn_forcar_relay').trim() === '1'
  configuracao.transcritorUrl = valor('transcritor_url')
  configuracao.transcritorIdioma = valor('transcritor_idioma')

  exibirAvisos()
}

function exibirAvisos() {
  const c = configuracao

  if (!c.fcm.projectId.trim() || !c.fcm.clientEmail.trim() || !c.fcm.privateKey.trim()) {
    console.log('⚠  Parâmetros "fcm_project_id", "fcm_client_email" e "fcm_private_key" vazios! FCM não vão funcionar!')
  }
  if (!c.s3.bucket.trim()) {
    console.log('⚠  Parâmetro "s3_bucket" vazio! Anexos não vão funcionar!')
  }
  if (!c.transcritorUrl.trim()) {
    console.log('ℹ  Parâmetro "transcritor_url" vazio: transcrição de áudio desligada.')
  }
  if (c.turnForcarRelay) {
    console.log('ℹ  TURN ativo em modo relay-only. Toda mídia passa pelo coturn.')
  }
  console.log()
}

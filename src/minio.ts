import { requestContext } from '@fastify/request-context'
import { Client } from 'minio'
import { configuracao } from './configuracao.ts'

declare module '@fastify/request-context' {
  interface RequestContextData {
    // Endereco que o navegador usou para chamar a API, como https://192.168.0.10.
    origemPublica: string
  }
}

const REGIAO = 'us-east-1'
// Caminho em que o Vite e o nginx repassam para o MinIO.
const PREFIXO = '/storage'

let interno: Client | undefined

// A regiao fixa evita que o cliente consulte o MinIO para descobri-la.
function criarCliente(url: URL) {
  const useSSL = url.protocol === 'https:'
  return new Client({
    endPoint: url.hostname,
    port: url.port ? Number(url.port) : useSSL ? 443 : 80,
    useSSL,
    accessKey: configuracao.s3.accessKey,
    secretKey: configuracao.s3.secretKey,
    region: REGIAO,
    pathStyle: true,
  })
}

export function iniciarMinio() {
  interno = criarCliente(new URL(configuracao.s3Interno))
}

// URL entregue ao navegador, no mesmo endereco que ele usou para chamar a API.
// Assim funciona por IP, localhost ou dominio sem configurar nada. O /storage
// entra na URL mas fica fora da assinatura, porque o proxy o remove antes de
// repassar ao MinIO.
export async function urlPublica(metodo: 'GET' | 'PUT', chave: string, expiraSegundos: number) {
  const origem = requestContext.get('origemPublica')
  if (!origem) {
    throw new Error('Endereço público indisponível fora de uma requisição.')
  }
  const cliente = criarCliente(new URL(origem))
  const { bucket } = configuracao.s3
  const assinada = metodo === 'GET'
    ? await cliente.presignedGetObject(bucket, chave, expiraSegundos)
    : await cliente.presignedPutObject(bucket, chave, expiraSegundos)
  const url = new URL(assinada)
  url.pathname = PREFIXO + url.pathname
  return url.toString()
}

export async function objetoExiste(chave: string) {
  try {
    await interno!.statObject(configuracao.s3.bucket, chave)
    return true
  } catch {
    return false
  }
}

const ERROS_CREDENCIAL = ['AccessDenied', 'InvalidAccessKeyId', 'SignatureDoesNotMatch']

// Numa instalacao nova o bucket nao existe e os anexos falhariam sem aviso.
// Nunca interrompe a inicializacao: cria o bucket ou avisa no console.
export async function verificarBucketS3() {
  const { s3, s3Interno } = configuracao
  if (!interno || !s3.bucket.trim()) {
    return
  }
  try {
    if (await interno.bucketExists(s3.bucket)) {
      return
    }
  } catch (erro) {
    const codigo = (erro as { code?: string }).code ?? ''
    if (ERROS_CREDENCIAL.includes(codigo)) {
      console.log('⚠  MinIO recusou as credenciais de /dados/minio-usuario e /dados/minio-senha! Anexos não vão funcionar!')
    } else {
      const motivo = erro instanceof Error ? erro.message : String(erro)
      console.log(`⚠  MinIO inacessível em "${s3Interno}" (${motivo})! Confira "CONVERSA_S3_INTERNO". Anexos não vão funcionar!`)
    }
    return
  }
  try {
    await interno.makeBucket(s3.bucket, REGIAO)
    console.log(`ℹ  Bucket "${s3.bucket}" não existia no MinIO e foi criado.`)
  } catch (erro) {
    const motivo = erro instanceof Error ? erro.message : String(erro)
    console.log(`⚠  Bucket "${s3.bucket}" não existe e não pôde ser criado (${motivo})! Anexos não vão funcionar!`)
  }
}

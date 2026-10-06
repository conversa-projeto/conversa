import type { Sql } from './banco.ts'
import { carregarParametros } from './configuracao.ts'
import type { Corpo } from './esquemas.ts'
import { httpErrors } from './erros.ts'
import { esquecerAplicativoFcm } from './fcm.ts'
import { CodigoPermissao, validarPermissao } from './permissoes.ts'

// Parametros que a tela de configuracao mostra. Segredos nao saem: o
// jwt_token nunca aparece e da chave do FCM so se diz se esta preenchida. O
// bucket aparece, mas nao muda pela tela (os anexos ja gravados ficariam para tras).
export async function parametrosSistema(sql: Sql, usuario: number) {
  await validarPermissao(sql, usuario, CodigoPermissao.Parametros)
  const linhas = await sql<{ nome: string; valor: string }[]>`select nome, valor from parametros`
  const valor = (nome: string) => linhas.find((linha) => linha.nome === nome)?.valor ?? ''
  return {
    fcm_project_id: valor('fcm_project_id'),
    fcm_client_email: valor('fcm_client_email'),
    fcm_private_key_configurada: valor('fcm_private_key').trim() !== '',
    turn_forcar_relay: valor('turn_forcar_relay').trim() === '1',
    transcritor_url: valor('transcritor_url'),
    transcritor_idioma: valor('transcritor_idioma'),
    gravacao_dias: Number(valor('gravacao_dias')) || 0,
    s3_bucket: valor('s3_bucket'),
  }
}

const IDIOMA = /^[a-z]{2,3}(-[A-Za-z]{2})?$/

function conferir(corpo: Corpo<'alterarParametros'>) {
  const url = corpo.transcritor_url?.trim()
  if (url) {
    let valida = false
    try {
      valida = ['http:', 'https:'].includes(new URL(url).protocol)
    } catch {
      valida = false
    }
    if (!valida) {
      throw httpErrors.badRequest('Endereço do transcritor inválido (use http:// ou https://).')
    }
  }
  const idioma = corpo.transcritor_idioma?.trim()
  if (idioma && !IDIOMA.test(idioma)) {
    throw httpErrors.badRequest('Idioma do transcritor inválido (ex.: pt, en, pt-BR).')
  }
  const email = corpo.fcm_client_email?.trim()
  if (email && !email.includes('@')) {
    throw httpErrors.badRequest('E-mail da conta de serviço do Firebase inválido.')
  }
  const chave = corpo.fcm_private_key?.trim()
  if (chave && !chave.includes('PRIVATE KEY')) {
    throw httpErrors.badRequest('Chave privada do Firebase inválida (cole o campo private_key do JSON da conta de serviço).')
  }
}

// Grava so os campos enviados e aplica na hora, sem reiniciar a API
export async function alterarParametros(sql: Sql, usuario: number, corpo: Corpo<'alterarParametros'>) {
  await validarPermissao(sql, usuario, CodigoPermissao.Parametros)
  conferir(corpo)
  const novos: [string, string][] = []
  if (corpo.fcm_project_id !== undefined) novos.push(['fcm_project_id', corpo.fcm_project_id.trim()])
  if (corpo.fcm_client_email !== undefined) novos.push(['fcm_client_email', corpo.fcm_client_email.trim()])
  if (corpo.fcm_private_key !== undefined) novos.push(['fcm_private_key', corpo.fcm_private_key.trim()])
  if (corpo.turn_forcar_relay !== undefined) novos.push(['turn_forcar_relay', corpo.turn_forcar_relay ? '1' : '0'])
  if (corpo.transcritor_url !== undefined) novos.push(['transcritor_url', corpo.transcritor_url.trim()])
  if (corpo.transcritor_idioma !== undefined) novos.push(['transcritor_idioma', corpo.transcritor_idioma.trim()])
  if (corpo.gravacao_dias !== undefined) novos.push(['gravacao_dias', String(corpo.gravacao_dias)])

  for (const [nome, valor] of novos) {
    await sql`update parametros set valor = ${valor} where nome = ${nome}`
  }
  await carregarParametros(sql)
  if (novos.some(([nome]) => nome.startsWith('fcm_'))) {
    await esquecerAplicativoFcm()
  }
  return parametrosSistema(sql, usuario)
}

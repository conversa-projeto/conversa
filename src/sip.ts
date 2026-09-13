import type { Linha, Sql } from './banco.ts'
import { validarSipUsuario } from './autorizacao.ts'
import { alterar, inserir } from './comum.ts'

const COLUNAS_SIP = ['sip_user', 'auth_user', 'sip_password', 'display_name', 'domain', 'ws_server', 'ativo']

export async function sip(sql: Sql, usuario: number) {
  const [registro] = await sql`
    select id
         , usuario_id
         , sip_user
         , auth_user
         , sip_password
         , display_name
         , domain
         , ws_server
         , ativo
         , criado_em
         , criado_por
      from sip
     where usuario_id = ${usuario}`
  return registro ?? {}
}

// usuario_id sempre do token: o cliente nao escolhe o dono do ramal.
export function incluirSip(sql: Sql, usuario: number, corpo: Linha) {
  return inserir(sql, 'sip', { ...corpo, usuario_id: usuario }, [...COLUNAS_SIP, 'usuario_id'])
}

export async function alterarSip(sql: Sql, usuario: number, corpo: Linha) {
  await validarSipUsuario(sql, usuario, corpo.id)
  return alterar(sql, 'sip', corpo.id, corpo, COLUNAS_SIP)
}

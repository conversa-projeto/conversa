import type { Sql } from './banco.ts'
import { validarSipUsuario } from './autorizacao.ts'
import { alterar, inserir } from './comum.ts'
import type { Corpo } from './esquemas.ts'
import type { Sip } from './tabelas.ts'
import { CodigoPermissao, permissaoUsuario, validarPermissao } from './permissoes.ts'

const COLUNAS_SIP = ['sip_user', 'auth_user', 'sip_password', 'display_name', 'domain', 'ws_server', 'ativo'] as const

// Sem ramal cadastrado, ou sem a permissao da telefonia, devolve objeto vazio
export async function sip(sql: Sql, usuario: number): Promise<Sip | Record<string, never>> {
  if (!await permissaoUsuario(sql, usuario, CodigoPermissao.Telefonia)) {
    return {}
  }
  const [registro] = await sql<Sip[]>`
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
export async function incluirSip(sql: Sql, usuario: number, corpo: Corpo<'incluirSip'>) {
  await validarPermissao(sql, usuario, CodigoPermissao.Telefonia)
  return inserir(sql, 'sip', { ...corpo, usuario_id: usuario }, [...COLUNAS_SIP, 'usuario_id'])
}

export async function alterarSip(sql: Sql, usuario: number, corpo: Corpo<'alterarSip'>) {
  await validarSipUsuario(sql, usuario, corpo.id)
  await validarPermissao(sql, usuario, CodigoPermissao.Telefonia)
  return alterar(sql, 'sip', corpo.id, corpo, COLUNAS_SIP)
}

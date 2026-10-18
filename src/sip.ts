import type { Sql } from './banco.ts'
import { alterar, inserir } from './comum.ts'
import { httpErrors } from './erros.ts'
import type { Corpo } from './esquemas.ts'
import type { Sip } from './tabelas.ts'
import { CodigoPermissao, permissaoUsuario, validarPermissao } from './permissoes.ts'

const COLUNAS_SIP = ['sip_user', 'auth_user', 'sip_password', 'display_name', 'domain', 'ws_server', 'turn_server', 'turn_user', 'turn_password', 'ativo'] as const

// Sem ramal cadastrado, ou sem a permissao da telefonia, devolve objeto vazio.
// O dono recebe as senhas: o navegador dele registra o ramal e usa o TURN.
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
         , turn_server
         , turn_user
         , turn_password
         , ativo
         , criado_em
         , criado_por
      from sip
     where usuario_id = ${usuario}`
  return registro ?? {}
}

type RamalAdministrador = Omit<Sip, 'sip_password' | 'turn_password'> & { tem_senha: boolean; tem_senha_turn: boolean }

// Para o administrador as senhas nunca voltam: so se estao salvas
export async function sipDoUsuario(sql: Sql, usuario: number, conta: number): Promise<RamalAdministrador | Record<string, never>> {
  await validarPermissao(sql, usuario, CodigoPermissao.Sip)
  const [registro] = await sql<RamalAdministrador[]>`
    select id
         , usuario_id
         , sip_user
         , auth_user
         , display_name
         , domain
         , ws_server
         , turn_server
         , turn_user
         , ativo
         , sip_password <> '' as tem_senha
         , coalesce(turn_password, '') <> '' as tem_senha_turn
         , criado_em
         , criado_por
      from sip
     where usuario_id = ${conta}`
  return registro ?? {}
}

// Mesmas regras da tela (utils/sip.ts na pagina): o que o sip.js recusaria
// ou o navegador nao conecta para aqui, com a mensagem do campo
export function conferirRamal(corpo: Corpo<'salvarSipUsuario'>) {
  const semEspaco = (valor: string) => valor !== '' && !/[\s@:]/.test(valor)
  if (!semEspaco(corpo.sip_user)) {
    throw httpErrors.badRequest('Ramal inválido: informe só o número ou nome do ramal, sem espaços.')
  }
  if (corpo.auth_user && !semEspaco(corpo.auth_user)) {
    throw httpErrors.badRequest('Usuário de autenticação inválido.')
  }
  if (!/^[a-z0-9.-]+(:\d+)?$/i.test(corpo.domain)) {
    throw httpErrors.badRequest('Domínio SIP inválido (ex.: voip.empresa.com).')
  }
  if (!/^wss?:\/\/[^\s/]+/i.test(corpo.ws_server)) {
    throw httpErrors.badRequest('Servidor WebSocket inválido: deve começar com wss:// (ex.: wss://voip.empresa.com:8089/ws).')
  }
  if (corpo.turn_server && !/^turns?:[^\s]+$/i.test(corpo.turn_server)) {
    throw httpErrors.badRequest('Servidor TURN inválido: deve começar com turn: ou turns: (ex.: turns:voip.empresa.com:443).')
  }
  if (corpo.turn_server && !corpo.turn_user) {
    throw httpErrors.badRequest('Informe o usuário do TURN.')
  }
}

// Cria ou altera o ramal da pessoa (um por pessoa). Senha vazia mantem a
// salva; sem TURN, a senha dele sai junto.
export async function salvarSipDoUsuario(sql: Sql, usuario: number, corpo: Corpo<'salvarSipUsuario'>) {
  await validarPermissao(sql, usuario, CodigoPermissao.Sip)
  conferirRamal(corpo)
  const [conta] = await sql`select 1 from usuario where id = ${corpo.usuario_id}`
  if (!conta) {
    throw httpErrors.notFound('Usuário não encontrado.')
  }
  const { usuario_id, sip_password, turn_password, ...resto } = corpo
  const dados = {
    ...resto,
    auth_user: corpo.auth_user || null,
    display_name: corpo.display_name || null,
    turn_server: corpo.turn_server || null,
    turn_user: corpo.turn_server ? corpo.turn_user || null : null,
    ...(sip_password ? { sip_password } : {}),
    ...(turn_password ? { turn_password } : {}),
    ...(corpo.turn_server ? {} : { turn_password: null }),
  }
  const [existente] = await sql<{ id: number }[]>`select id from sip where usuario_id = ${usuario_id}`
  if (existente) {
    await alterar(sql, 'sip', existente.id, dados, COLUNAS_SIP)
  } else {
    if (!sip_password) {
      throw httpErrors.badRequest('Informe a senha do ramal.')
    }
    await inserir(sql, 'sip', { ...dados, usuario_id }, [...COLUNAS_SIP, 'usuario_id'])
  }
  return sipDoUsuario(sql, usuario, usuario_id)
}

export async function excluirSipDoUsuario(sql: Sql, usuario: number, conta: number) {
  await validarPermissao(sql, usuario, CodigoPermissao.Sip)
  await sql`delete from sip where usuario_id = ${conta}`
  return {}
}

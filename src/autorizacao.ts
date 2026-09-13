import sensible from '@fastify/sensible'
import type { Sql } from './banco.ts'
import { conferirSenha } from './senha.ts'

const { httpErrors } = sensible
const acessoNegado = () => httpErrors.forbidden('Acesso negado!')

export async function validarAcessoConversa(sql: Sql, usuario: number, conversa: number) {
  if (usuario <= 0 || conversa <= 0) {
    throw acessoNegado()
  }
  const [linha] = await sql`select 1 from conversa_usuario where conversa_id = ${conversa} and usuario_id = ${usuario}`
  if (!linha) {
    throw acessoNegado()
  }
}

// Regra atual: so auto-remocao. Admin de grupo via conversa.criado_por fica para depois.
export async function validarRemocaoConversaUsuario(sql: Sql, usuario: number, conversaUsuario: number) {
  if (usuario <= 0 || conversaUsuario <= 0) {
    throw acessoNegado()
  }
  const [linha] = await sql`select 1 from conversa_usuario where id = ${conversaUsuario} and usuario_id = ${usuario}`
  if (!linha) {
    throw acessoNegado()
  }
}

// Bloqueia exclusao quando algum destinatario ja recebeu a mensagem. Agendadas
// ainda nao entregues continuam podendo ser canceladas.
export async function validarExclusaoMensagem(sql: Sql, usuario: number, mensagem: number) {
  if (usuario <= 0 || mensagem <= 0) {
    throw acessoNegado()
  }
  const [autor] = await sql`select 1 from mensagem where id = ${mensagem} and usuario_id = ${usuario}`
  if (!autor) {
    throw acessoNegado()
  }
  const [recebida] = await sql`select 1 from mensagem_status where mensagem_id = ${mensagem} and recebida is not null limit 1`
  if (recebida) {
    throw httpErrors.conflict('Mensagem não pode ser excluída: já foi recebida por algum destinatário.')
  }
}

export async function validarContatoUsuario(sql: Sql, usuario: number, usuarioContato: number) {
  if (usuario <= 0 || usuarioContato <= 0) {
    throw acessoNegado()
  }
  const [linha] = await sql`select 1 from usuario_contato where id = ${usuarioContato} and usuario_id = ${usuario}`
  if (!linha) {
    throw acessoNegado()
  }
}

export async function validarSipUsuario(sql: Sql, usuario: number, sip: number) {
  if (usuario <= 0 || sip <= 0) {
    throw acessoNegado()
  }
  const [linha] = await sql`select 1 from sip where id = ${sip} and usuario_id = ${usuario}`
  if (!linha) {
    throw acessoNegado()
  }
}

export async function validarSenhaAtual(sql: Sql, usuario: number, senhaAtual: string) {
  const [linha] = usuario > 0 ? await sql`select senha from usuario where id = ${usuario}` : []
  // Hash bcrypt tem 60 caracteres. Fora disso e senha legada em texto puro.
  const valida = linha && (linha.senha.length === 60 ? await conferirSenha(senhaAtual, linha.senha) : senhaAtual === linha.senha)
  if (!valida) {
    throw httpErrors.unauthorized('Senha atual incorreta!')
  }
}

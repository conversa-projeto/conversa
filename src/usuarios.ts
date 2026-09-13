import sensible from '@fastify/sensible'
import type { Linha, Sql } from './banco.ts'
import { validarContatoUsuario, validarSenhaAtual } from './autorizacao.ts'
import { alterar, excluir, inserir } from './comum.ts'
import { conferirSenha, gerarHash } from './senha.ts'
import { usuarioConectado } from './websocket.ts'

const { httpErrors } = sensible

const COLUNAS_DISPOSITIVO_INCLUIR = ['nome', 'modelo', 'versao_so', 'plataforma', 'ativo', 'usuario_id']
const COLUNAS_DISPOSITIVO_ALTERAR = ['nome', 'modelo', 'versao_so', 'plataforma', 'token_fcm']
const COLUNAS_USUARIO_INCLUIR = ['nome', 'login', 'email', 'telefone', 'senha']
const COLUNAS_USUARIO_ALTERAR = ['nome', 'email', 'telefone', 'avatar_anexo_id']

export async function login(sql: Sql, corpo: Linha) {
  const [usuario] = await sql`
    select u.id
         , u.nome
         , u.email
         , u.telefone
         , u.senha
         , a.identificador as avatar_identificador
      from usuario as u
      left join anexo as a
        on a.id = u.avatar_anexo_id
     where lower(u.login) = lower(${corpo.login})`
  if (!usuario) {
    throw httpErrors.unauthorized('Usuário não encontrado!')
  }

  const hash: string = usuario.senha
  // Hash bcrypt tem 60 caracteres. Fora disso e senha legada em texto puro.
  const valida = hash.length === 60 ? await conferirSenha(corpo.senha, hash) : corpo.senha === hash
  if (!valida) {
    throw httpErrors.unauthorized('Senha incorreta!')
  }

  // Senha legada correta: converte para bcrypt.
  if (hash.length !== 60) {
    await alterarSenha(sql, usuario.id, { senha_atual: corpo.senha, senha: corpo.senha })
  }
  delete usuario.senha

  let dispositivo: Linha | undefined
  if (corpo.dispositivo_id > 0) {
    dispositivo = (await sql`select id, nome, modelo, versao_so, plataforma, ativo from dispositivo where id = ${corpo.dispositivo_id}`)[0]
  }
  dispositivo ??= await inserir(sql, 'dispositivo', {
    nome: 'desconhecido',
    modelo: 'desconhecido',
    versao_so: 'desconhecido',
    plataforma: 'desconhecido',
    ativo: true,
    usuario_id: usuario.id,
  }, COLUNAS_DISPOSITIVO_INCLUIR)
  usuario.dispositivo = dispositivo

  if (!dispositivo.ativo) {
    throw httpErrors.unauthorized('Seção Encerrada!')
  }
  return usuario
}

export async function alterarSenha(sql: Sql, usuario: number, corpo: Linha) {
  await validarSenhaAtual(sql, usuario, corpo.senha_atual)
  if (corpo.senha.length > 72) {
    throw httpErrors.badRequest('Senha inválida!')
  }
  await sql`update usuario set senha = ${await gerarHash(corpo.senha)} where id = ${usuario}`
}

export async function alterarDispositivo(sql: Sql, corpo: Linha) {
  if (!COLUNAS_DISPOSITIVO_ALTERAR.some((coluna) => corpo[coluna] !== undefined)) {
    return { ...corpo }
  }
  return alterar(sql, 'dispositivo', corpo.id, corpo, COLUNAS_DISPOSITIVO_ALTERAR)
}

export function incluirDispositivoUsuario(sql: Sql, usuario: number, dispositivo: number) {
  return inserir(sql, 'dispositivo_usuario', { usuario_id: usuario, dispositivo_id: dispositivo }, ['usuario_id', 'dispositivo_id'])
}

export async function incluirUsuario(sql: Sql, corpo: Linha) {
  const [existente] = await sql`select id from usuario where lower(login) = lower(${corpo.login})`
  if (existente) {
    throw httpErrors.badRequest('Login já cadastrado!')
  }
  if (corpo.senha.length < 4 || corpo.senha.length > 72) {
    throw httpErrors.badRequest('A senha deve ter entre 4 e 72 caracteres!')
  }
  const usuario = await inserir(sql, 'usuario', { ...corpo, senha: await gerarHash(corpo.senha) }, COLUNAS_USUARIO_INCLUIR)
  delete usuario.senha
  return usuario
}

// Cada usuario so altera e exclui o proprio cadastro.
export async function alterarUsuario(sql: Sql, usuario: number, corpo: Linha) {
  if (corpo.id !== usuario) {
    throw httpErrors.forbidden('Acesso negado!')
  }
  const alterado = await alterar(sql, 'usuario', corpo.id, corpo, COLUNAS_USUARIO_ALTERAR)
  delete alterado.senha
  return alterado
}

export async function excluirUsuario(sql: Sql, usuario: number, id: number) {
  if (id !== usuario) {
    throw httpErrors.forbidden('Acesso negado!')
  }
  const excluido = await excluir(sql, 'usuario', id)
  delete excluido.senha
  return excluido
}

export function incluirContato(sql: Sql, usuario: number, relacionamento: number) {
  return inserir(sql, 'usuario_contato', { usuario_id: usuario, relacionamento_id: relacionamento }, ['usuario_id', 'relacionamento_id'])
}

export async function excluirContato(sql: Sql, usuario: number, contato: number) {
  await validarContatoUsuario(sql, usuario, contato)
  return excluir(sql, 'usuario_contato', contato)
}

export function contatos(sql: Sql) {
  return sql`select u.id, u.nome, u.login, u.email, u.telefone from usuario as u order by u.id`
}

// Contatos de conversas diretas que estao com o WebSocket conectado agora.
export async function contatosOnline(sql: Sql, usuario: number) {
  const linhas = await sql<{ usuario_id: number }[]>`
    select distinct cu2.usuario_id
      from conversa_usuario cu1
     inner join conversa c on c.id = cu1.conversa_id and c.tipo = 1
     inner join conversa_usuario cu2 on cu2.conversa_id = cu1.conversa_id and cu2.usuario_id <> cu1.usuario_id
     where cu1.usuario_id = ${usuario}`
  return linhas.map((linha) => linha.usuario_id).filter(usuarioConectado)
}

import { beforeAll, describe, expect, test } from 'bun:test'
import { chamar, criarUsuario, loginUnico, noBanco, usuariosComuns, type UsuarioTeste } from './api.ts'

let ana: UsuarioTeste, bruno: UsuarioTeste
beforeAll(async () => ({ ana, bruno } = await usuariosComuns()))

const entrar = (login: string, senha: string, dispositivo_id?: number) =>
  chamar('POST', '/login', { corpo: { login, senha, ...(dispositivo_id ? { dispositivo_id } : {}) } })

describe('login e dispositivo', () => {
  test('primeiro login cria um dispositivo do usuário; o próximo reaproveita', async () => {
    const usuario = await criarUsuario()
    const primeiro = await entrar(usuario.login, usuario.senha)
    expect(primeiro.dados.dispositivo).toMatchObject({ nome: 'desconhecido', ativo: true })
    const segundo = await entrar(usuario.login, usuario.senha, primeiro.dados.dispositivo.id)
    expect(segundo.dados.dispositivo.id).toBe(primeiro.dados.dispositivo.id)
  })

  test('dispositivo desativado encerra a sessão no login', async () => {
    const usuario = await criarUsuario()
    const { dados } = await entrar(usuario.login, usuario.senha)
    await noBanco((sql) => sql`update dispositivo set ativo = false where id = ${dados.dispositivo.id}`)
    const { status, dados: erro } = await entrar(usuario.login, usuario.senha, dados.dispositivo.id)
    expect(status).toBe(401)
    expect(erro.error).toBe('Seção Encerrada!')
  })

  test('o login devolve o identificador do avatar', async () => {
    const usuario = await criarUsuario()
    const identificador = 'a'.repeat(64)
    await noBanco(async (sql) => {
      const [anexo] = await sql<{ id: number }[]>`insert into anexo (identificador, tipo, tamanho, objeto) values (${identificador}, 2, 1, 'x') returning id`
      await sql`update usuario set avatar_anexo_id = ${anexo!.id} where id = ${usuario.id}`
    })
    expect((await entrar(usuario.login, usuario.senha)).dados.avatar_identificador).toBe(identificador)
  })

  test('dispositivo: o próprio usuário altera nome e token do push', async () => {
    const usuario = await criarUsuario()
    const { dados } = await entrar(usuario.login, usuario.senha)
    const alteracao = await chamar('PATCH', '/dispositivo', { token: usuario.token, corpo: { id: dados.dispositivo.id, nome: 'Chrome', token_fcm: 'token-do-push' } })
    expect(alteracao.status).toBe(200)
    expect(alteracao.dados).toMatchObject({ nome: 'Chrome', token_fcm: 'token-do-push' })
  })

  test('dispositivo sem nada para alterar volta como veio', async () => {
    const { dados } = await chamar('PATCH', '/dispositivo', { token: ana.token, corpo: { id: 123 } })
    expect(dados).toEqual({ id: 123 })
  })

  // FALHA CONHECIDA: PATCH /dispositivo não confere o dono. Qualquer pessoa
  // logada troca o token_fcm do aparelho de outra e passa a receber os pushes
  // dela (remetente e texto das mensagens).
  test.failing('não altera o dispositivo de outra pessoa', async () => {
    const vitima = await criarUsuario()
    const { dados } = await entrar(vitima.login, vitima.senha)
    const { status } = await chamar('PATCH', '/dispositivo', { token: ana.token, corpo: { id: dados.dispositivo.id, token_fcm: 'token-do-invasor' } })
    expect(status).toBe(403)
  })

  // FALHA CONHECIDA: o login aceita o dispositivo_id de outra pessoa.
  test.failing('login com o dispositivo de outra pessoa não o reaproveita', async () => {
    const vitima = await criarUsuario()
    const daVitima = (await entrar(vitima.login, vitima.senha)).dados.dispositivo.id
    const { dados } = await entrar(ana.login, ana.senha, daVitima)
    expect(dados.dispositivo.id).not.toBe(daVitima)
  })
})

describe('senha legada', () => {
  test('senha antiga em texto puro entra e é convertida para bcrypt', async () => {
    const login = loginUnico('legado')
    await noBanco((sql) => sql`insert into usuario (nome, login, email, senha) values ('Legado', ${login}, ${`${login}@teste.test`}, 'senha-antiga')`)
    expect((await entrar(login, 'senha-antiga')).status).toBe(200)
    const [linha] = await noBanco((sql) => sql<{ senha: string }[]>`select senha from usuario where login = ${login}`)
    expect(linha?.senha).toHaveLength(60)
    expect((await entrar(login, 'senha-antiga')).status).toBe(200)
  })

  test('senha antiga errada é 401', async () => {
    const login = loginUnico('legado')
    await noBanco((sql) => sql`insert into usuario (nome, login, email, senha) values ('Legado', ${login}, ${`${login}@teste.test`}, 'senha-antiga')`)
    expect((await entrar(login, 'outra')).status).toBe(401)
  })

  test('alterar a senha a partir de uma legada', async () => {
    const login = loginUnico('legado')
    await noBanco((sql) => sql`insert into usuario (nome, login, email, senha) values ('Legado', ${login}, ${`${login}@teste.test`}, 'senha-antiga')`)
    const token = (await entrar(login, 'senha-antiga')).dados.token
    await noBanco((sql) => sql`update usuario set senha = 'senha-antiga' where login = ${login}`)
    expect((await chamar('POST', '/alterar-senha', { token, corpo: { senha_atual: 'senha-antiga', senha: 'nova-senha' } })).status).toBe(200)
    expect((await entrar(login, 'nova-senha')).status).toBe(200)
  })

  test('nova senha acima de 72 caracteres é recusada', async () => {
    const usuario = await criarUsuario()
    const { status } = await chamar('POST', '/alterar-senha', { token: usuario.token, corpo: { senha_atual: usuario.senha, senha: 'x'.repeat(73) } })
    expect(status).toBe(400)
  })
})

describe('cadastro do usuário', () => {
  test('altera nome e telefone do próprio cadastro', async () => {
    const usuario = await criarUsuario()
    const { status, dados } = await chamar('PATCH', '/usuario', { token: usuario.token, corpo: { id: usuario.id, nome: 'Nome Novo', telefone: '11999990000' } })
    expect(status).toBe(200)
    expect(dados).toMatchObject({ nome: 'Nome Novo', telefone: '11999990000' })
    expect(dados.senha).toBeUndefined()
  })

  test('não exclui a conta de outra pessoa', async () => {
    const usuario = await criarUsuario()
    expect((await chamar('DELETE', '/usuario', { token: ana.token, consulta: { id: usuario.id } })).status).toBe(403)
  })

  // FALHA CONHECIDA: excluir a própria conta dá 500 para quem já fez login. O
  // dispositivo criado no login continua apontando para o usuário
  // (dispositivo_usuario_fk) e o banco recusa a exclusão.
  test.failing('exclui a própria conta', async () => {
    const usuario = await criarUsuario()
    const exclusao = await chamar('DELETE', '/usuario', { token: usuario.token, consulta: { id: usuario.id } })
    expect(exclusao.status).toBe(200)
    expect(exclusao.dados.senha).toBeUndefined()
    expect((await entrar(usuario.login, usuario.senha)).status).toBe(401)
  })

  test('lista de contatos traz os usuários sem a senha', async () => {
    const { dados } = await chamar('GET', '/usuario/contatos', { token: ana.token })
    const bru = dados.find((u: { id: number }) => u.id === bruno.id)
    expect(bru).toMatchObject({ id: bruno.id, login: bruno.login })
    expect(bru.senha).toBeUndefined()
  })
})

describe('contatos salvos', () => {
  test('inclui e exclui o próprio contato; outra pessoa não exclui', async () => {
    const inclusao = await chamar('PUT', '/usuario/contato', { token: ana.token, consulta: { relacionamento_id: bruno.id } })
    expect(inclusao.status).toBe(200)
    expect(inclusao.dados).toMatchObject({ usuario_id: ana.id, relacionamento_id: bruno.id })
    expect((await chamar('DELETE', '/usuario/contato', { token: bruno.token, consulta: { id: inclusao.dados.id } })).status).toBe(403)
    expect((await chamar('DELETE', '/usuario/contato', { token: ana.token, consulta: { id: inclusao.dados.id } })).status).toBe(200)
  })

  test('vincula um dispositivo ao usuário', async () => {
    const usuario = await criarUsuario()
    const { dados } = await entrar(usuario.login, usuario.senha)
    const vinculo = await chamar('PUT', '/dispositivo/usuario', { token: usuario.token, consulta: { dispositivo_id: dados.dispositivo.id } })
    expect(vinculo.status).toBe(200)
    expect(vinculo.dados).toMatchObject({ usuario_id: usuario.id, dispositivo_id: dados.dispositivo.id })
  })
})

describe('SIP', () => {
  const ramal = { sip_user: '1001', sip_password: 'segredo', domain: 'pbx.teste', ws_server: 'wss://pbx.teste/ws' }

  test('sem ramal devolve objeto vazio', async () => {
    const usuario = await criarUsuario()
    expect((await chamar('GET', '/sip', { token: usuario.token })).dados).toEqual({})
  })

  test('cadastra o ramal sempre para quem está logado', async () => {
    const usuario = await criarUsuario()
    const inclusao = await chamar('PUT', '/sip', { token: usuario.token, corpo: { ...ramal, usuario_id: ana.id } })
    expect(inclusao.status).toBe(200)
    expect(inclusao.dados.usuario_id).toBe(usuario.id)
    expect((await chamar('GET', '/sip', { token: usuario.token })).dados).toMatchObject({ sip_user: '1001', domain: 'pbx.teste' })
  })

  test('altera só o próprio ramal', async () => {
    const usuario = await criarUsuario()
    const { dados } = await chamar('PUT', '/sip', { token: usuario.token, corpo: ramal })
    expect((await chamar('PATCH', '/sip', { token: ana.token, corpo: { id: dados.id, sip_user: '9999' } })).status).toBe(403)
    const alteracao = await chamar('PATCH', '/sip', { token: usuario.token, corpo: { id: dados.id, sip_user: '1002', ativo: false } })
    expect(alteracao.dados).toMatchObject({ sip_user: '1002', ativo: false })
  })
})

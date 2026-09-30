import { describe, expect, test } from 'bun:test'
import { chamar, criarUsuario, loginUnico } from './api.ts'

describe('cadastro', () => {
  test('cria o usuário sem devolver a senha', async () => {
    const login = loginUnico()
    const { status, dados } = await chamar('PUT', '/usuario', { corpo: { nome: 'Ana', login, email: `${login}@teste.test`, senha: 'segredo' } })
    expect(status).toBe(200)
    expect(dados).toMatchObject({ nome: 'Ana', login })
    expect(dados.senha).toBeUndefined()
  })

  test('login repetido, sem diferenciar maiúsculas, é recusado', async () => {
    const usuario = await criarUsuario()
    const { status, dados } = await chamar('PUT', '/usuario', {
      corpo: { nome: 'Outro', login: usuario.login.toUpperCase(), email: 'outro@teste.test', senha: 'segredo' },
    })
    expect(status).toBe(400)
    expect(dados.error).toBe('Login já cadastrado!')
  })

  test.each([['abc'], ['x'.repeat(73)]])('senha fora de 4 a 72 caracteres é recusada (%#)', async (senha) => {
    const login = loginUnico()
    const { status } = await chamar('PUT', '/usuario', { corpo: { nome: 'Ana', login, email: `${login}@teste.test`, senha } })
    expect(status).toBe(400)
  })

  test('campo obrigatório ausente vira 400 com mensagem em português', async () => {
    const { status, dados } = await chamar('PUT', '/usuario', { corpo: { nome: 'Ana', email: 'a@teste.test', senha: 'segredo' } })
    expect(status).toBe(400)
    expect(dados.error).toContain('"login"')
  })
})

describe('login', () => {
  test('devolve token e dados do usuário', async () => {
    const usuario = await criarUsuario('Bruno')
    const { status, dados } = await chamar('POST', '/login', { corpo: { login: usuario.login, senha: usuario.senha } })
    expect(status).toBe(200)
    expect(dados).toMatchObject({ id: usuario.id, nome: 'Bruno' })
    expect(typeof dados.token).toBe('string')
  })

  test('login não diferencia maiúsculas', async () => {
    const usuario = await criarUsuario()
    const { status } = await chamar('POST', '/login', { corpo: { login: usuario.login.toUpperCase(), senha: usuario.senha } })
    expect(status).toBe(200)
  })

  test('senha errada é 401', async () => {
    const usuario = await criarUsuario()
    const { status, dados } = await chamar('POST', '/login', { corpo: { login: usuario.login, senha: 'errada' } })
    expect(status).toBe(401)
    expect(dados.error).toBe('Senha incorreta!')
  })

  test('usuário inexistente é 401', async () => {
    const { status } = await chamar('POST', '/login', { corpo: { login: loginUnico('ninguem'), senha: 'qualquer' } })
    expect(status).toBe(401)
  })
})

describe('rotas protegidas', () => {
  test('sem token é 401', async () => {
    const { status, dados } = await chamar('GET', '/conversas')
    expect(status).toBe(401)
    expect(dados.error).toBe('Token não informado')
  })

  test('token adulterado é 401', async () => {
    const usuario = await criarUsuario()
    const { status } = await chamar('GET', '/conversas', { token: `${usuario.token}x` })
    expect(status).toBe(401)
  })

  test('token assinado com outra chave é 401', async () => {
    const [cabecalho, carga] = (await criarUsuario()).token.split('.')
    const { status } = await chamar('GET', '/conversas', { token: `${cabecalho}.${carga}.assinatura-falsa` })
    expect(status).toBe(401)
  })

  test('usuário só altera o próprio cadastro', async () => {
    const ana = await criarUsuario('Ana')
    const bruno = await criarUsuario('Bruno')
    const { status } = await chamar('PATCH', '/usuario', { token: ana.token, corpo: { id: bruno.id, nome: 'Invadido' } })
    expect(status).toBe(403)
  })
})

describe('alterar senha', () => {
  test('com a senha atual correta, o login passa a usar a nova', async () => {
    const usuario = await criarUsuario()
    const troca = await chamar('POST', '/alterar-senha', { token: usuario.token, corpo: { senha_atual: usuario.senha, senha: 'nova-senha' } })
    expect(troca.status).toBe(200)
    expect((await chamar('POST', '/login', { corpo: { login: usuario.login, senha: 'nova-senha' } })).status).toBe(200)
    expect((await chamar('POST', '/login', { corpo: { login: usuario.login, senha: usuario.senha } })).status).toBe(401)
  })

  test('senha atual errada é 400, não 401 (a página deslogaria)', async () => {
    const usuario = await criarUsuario()
    const { status } = await chamar('POST', '/alterar-senha', { token: usuario.token, corpo: { senha_atual: 'errada', senha: 'nova-senha' } })
    expect(status).toBe(400)
  })
})

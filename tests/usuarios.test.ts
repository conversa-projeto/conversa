import { beforeAll, describe, expect, test } from 'bun:test'
import { chamar, criarConversa, criarUsuario, enviarTexto, loginUnico, noBanco, usuariosComuns, type UsuarioTeste } from './api.ts'

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

  // Trocar o token_fcm do aparelho de outra pessoa desviaria os pushes dela
  test('não altera o dispositivo de outra pessoa', async () => {
    const vitima = await criarUsuario()
    const { dados } = await entrar(vitima.login, vitima.senha)
    const { status } = await chamar('PATCH', '/dispositivo', { token: ana.token, corpo: { id: dados.dispositivo.id, token_fcm: 'token-do-invasor' } })
    expect(status).toBe(403)
  })

  test('login com o dispositivo de outra pessoa não o reaproveita', async () => {
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
    // Conta antiga: as migrações deram a ela as permissões de uso
    await noBanco((sql) => sql`
      insert into permissao_usuario (usuario_id, permissao_id)
      select u.id, p.id from usuario u cross join permissao p where u.login = ${login} and p.uso`)
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

  // O dispositivo criado no login sai junto com a conta
  test('exclui a própria conta', async () => {
    const usuario = await criarUsuario()
    const exclusao = await chamar('DELETE', '/usuario', { token: usuario.token, consulta: { id: usuario.id } })
    expect(exclusao.status).toBe(200)
    expect(exclusao.dados.senha).toBeUndefined()
    expect((await entrar(usuario.login, usuario.senha)).status).toBe(401)
  })

  test('conta com histórico não é excluída (409, não 500)', async () => {
    const [usuario, outro] = [await criarUsuario(), await criarUsuario()]
    const conversa = await criarConversa(usuario, [outro])
    await enviarTexto(usuario, conversa, 'oi')
    const exclusao = await chamar('DELETE', '/usuario', { token: usuario.token, consulta: { id: usuario.id } })
    expect(exclusao.status).toBe(409)
    expect((await entrar(usuario.login, usuario.senha)).status).toBe(200)
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

  test('não vincula o dispositivo de outra pessoa', async () => {
    const vitima = await criarUsuario()
    const { dados } = await entrar(vitima.login, vitima.senha)
    const vinculo = await chamar('PUT', '/dispositivo/usuario', { token: ana.token, consulta: { dispositivo_id: dados.dispositivo.id } })
    expect(vinculo.status).toBe(403)
  })
})

describe('SIP', () => {
  const ramal = { sip_user: '1001', sip_password: 'segredo', domain: 'pbx.teste', ws_server: 'wss://pbx.teste/ws' }
  let admin: UsuarioTeste
  beforeAll(async () => {
    // Com alguem com "permissoes" o modo aberto acaba: so quem tem "sip" configura
    admin = await criarUsuario('Admin SIP')
    await noBanco((sql) => sql`
      insert into permissao_usuario (usuario_id, permissao_id)
      select ${admin.id}, id from permissao where codigo in ('permissoes', 'sip')`)
  })

  test('sem ramal devolve objeto vazio', async () => {
    const usuario = await criarUsuario()
    expect((await chamar('GET', '/sip', { token: usuario.token })).dados).toEqual({})
  })

  test('o administrador cadastra o ramal da pessoa, que recebe os dados para registrar', async () => {
    const usuario = await criarUsuario()
    const inclusao = await chamar('PUT', '/sip/usuario', { token: admin.token, corpo: { ...ramal, usuario_id: usuario.id, turn_server: 'turns:pbx.teste:443', turn_user: 'webrtc', turn_password: 'turno' } })
    expect(inclusao.status).toBe(200)
    // Ao administrador as senhas nao voltam
    expect(inclusao.dados).toMatchObject({ usuario_id: usuario.id, sip_user: '1001', tem_senha: true, tem_senha_turn: true, turn_user: 'webrtc', ativo: true })
    expect(inclusao.dados.sip_password).toBeUndefined()
    expect(inclusao.dados.turn_password).toBeUndefined()
    expect((await chamar('GET', '/sip', { token: usuario.token })).dados).toMatchObject({
      sip_user: '1001', sip_password: 'segredo', domain: 'pbx.teste', ws_server: 'wss://pbx.teste/ws',
      turn_server: 'turns:pbx.teste:443', turn_user: 'webrtc', turn_password: 'turno',
    })
  })

  test('alterar sem senha mantém a salva; tirar o TURN apaga a senha dele', async () => {
    const usuario = await criarUsuario()
    await chamar('PUT', '/sip/usuario', { token: admin.token, corpo: { ...ramal, usuario_id: usuario.id, turn_server: 'turns:pbx.teste:443', turn_user: 'webrtc', turn_password: 'turno' } })
    const alteracao = await chamar('PUT', '/sip/usuario', { token: admin.token, corpo: { ...ramal, sip_password: '', usuario_id: usuario.id, sip_user: '1002', ativo: false } })
    expect(alteracao.dados).toMatchObject({ sip_user: '1002', ativo: false, tem_senha: true, tem_senha_turn: false, turn_server: null, turn_user: null })
    expect((await chamar('GET', '/sip/usuario', { token: admin.token, consulta: { usuario_id: usuario.id } })).dados).toMatchObject({ sip_user: '1002' })
    expect((await chamar('GET', '/sip', { token: usuario.token })).dados).toMatchObject({ sip_password: 'segredo', turn_password: null })
  })

  test('ramal novo sem senha, ou com dados inválidos, é recusado', async () => {
    const usuario = await criarUsuario()
    const salvar = (corpo: Record<string, unknown>) => chamar('PUT', '/sip/usuario', { token: admin.token, corpo: { ...ramal, usuario_id: usuario.id, ...corpo } })
    expect((await salvar({ sip_password: '' })).dados.error).toBe('Informe a senha do ramal.')
    expect((await salvar({ sip_user: 'sip:1001@pbx' })).dados.error).toContain('Ramal inválido')
    expect((await salvar({ domain: 'pbx teste' })).dados.error).toContain('Domínio SIP inválido')
    expect((await salvar({ ws_server: 'https://pbx.teste/ws' })).dados.error).toContain('wss://')
    expect((await salvar({ turn_server: 'pbx.teste:443', turn_user: 'x' })).dados.error).toContain('turn:')
    expect((await salvar({ turn_server: 'turns:pbx.teste:443' })).dados.error).toBe('Informe o usuário do TURN.')
    expect((await salvar({ usuario_id: 999999 })).status).toBe(404)
    expect((await chamar('GET', '/sip', { token: usuario.token })).dados).toEqual({})
  })

  test('sem a permissão "sip", ninguém vê nem mexe no ramal de ninguém, nem no próprio', async () => {
    const usuario = await criarUsuario()
    await chamar('PUT', '/sip/usuario', { token: admin.token, corpo: { ...ramal, usuario_id: usuario.id } })
    expect((await chamar('PUT', '/sip/usuario', { token: usuario.token, corpo: { ...ramal, usuario_id: usuario.id } })).status).toBe(403)
    expect((await chamar('GET', '/sip/usuario', { token: usuario.token, consulta: { usuario_id: usuario.id } })).status).toBe(403)
    expect((await chamar('DELETE', '/sip/usuario', { token: usuario.token, consulta: { usuario_id: usuario.id } })).status).toBe(403)
    // As rotas antigas, em que cada um cadastrava o seu, nao existem mais
    expect((await chamar('PUT', '/sip', { token: usuario.token, corpo: ramal })).status).toBe(404)
  })

  test('o administrador exclui o ramal', async () => {
    const usuario = await criarUsuario()
    await chamar('PUT', '/sip/usuario', { token: admin.token, corpo: { ...ramal, usuario_id: usuario.id } })
    expect((await chamar('DELETE', '/sip/usuario', { token: admin.token, consulta: { usuario_id: usuario.id } })).status).toBe(200)
    expect((await chamar('GET', '/sip', { token: usuario.token })).dados).toEqual({})
    expect((await chamar('GET', '/sip/usuario', { token: admin.token, consulta: { usuario_id: usuario.id } })).dados).toEqual({})
  })
})

describe('data de cadastro', () => {
  test('vem nos contatos e na lista de pessoas, para o "Usuário desde"', async () => {
    const antes = Date.now() - 60_000
    const nova = await criarUsuario('Nova Desde')
    const contatos = (await chamar('GET', '/usuario/contatos', { token: nova.token })).dados as { id: number; criado_em: string }[]
    const cadastro = new Date(contatos.find((c) => c.id === nova.id)!.criado_em).getTime()
    expect(cadastro).toBeGreaterThan(antes)
    expect(cadastro).toBeLessThanOrEqual(Date.now() + 60_000)

    const gestor = await criarUsuario('Gestor Desde')
    await noBanco((sql) => sql`insert into permissao_usuario (usuario_id, permissao_id) select ${gestor.id}, id from permissao where codigo = 'permissoes'`)
    const usuarios = (await chamar('GET', '/permissoes', { token: gestor.token })).dados.usuarios as { id: number; criado_em: string }[]
    expect(new Date(usuarios.find((u) => u.id === nova.id)!.criado_em).getTime()).toBe(cadastro)
  })
})

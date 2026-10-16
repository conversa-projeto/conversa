import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { chamar, criarConversa, criarUsuario, enviarAnexo, enviarTexto, noBanco, type UsuarioTeste } from './api.ts'
import { carregarParametros, configuracao } from '../src/configuracao.ts'

// Usuarios proprios: quem tem permissao aqui nao interfere nos outros arquivos
let gestor: UsuarioTeste, comum: UsuarioTeste
beforeEach(async () => {
  ;[gestor, comum] = await Promise.all([criarUsuario('Gestor Permissões'), criarUsuario('Comum Permissões')])
  await conceder(gestor, 'parametros', 'permissoes')
})

function conceder(quem: UsuarioTeste, ...codigos: string[]) {
  return noBanco((sql) => sql`
    insert into permissao_usuario (usuario_id, permissao_id)
    select ${quem.id}, id from permissao where codigo in ${sql(codigos)}`)
}

// De uso do app (migracoes 046 e 048): toda conta nova ganha todas
const USO_046 = [
  'emoji', 'figurinha', 'imagem', 'video', 'audio', 'arquivo', 'responder', 'encaminhar', 'reagir', 'postagem',
  'votacao', 'confirmacao', 'agendar', 'grupo', 'chamada_audio', 'chamada_video', 'compartilhar_tela', 'telefonia',
]
// "nome" era o "perfil" da 048, renomeado na 049
const USO_048 = ['ocultar', 'nome', 'senha', 'privacidade', 'cores', 'config_chamadas']
const USO_049 = ['email', 'avatar']
const USO = [...USO_046, ...USO_048, ...USO_049]
// Todas, na ordem do banco: as de administracao entram entre as de uso
const TODAS = ['parametros', 'permissoes', ...USO_046, 'bots', ...USO_048, 'usuarios', ...USO_049, 'ferramentas', 'conhecimento']

function retirar(quem: UsuarioTeste, ...codigos: string[]) {
  return noBanco((sql) => sql`
    delete from permissao_usuario
     where usuario_id = ${quem.id}
       and permissao_id in (select id from permissao where codigo in ${sql(codigos)})`)
}

const minhas = async (quem: UsuarioTeste) => (await chamar('GET', '/usuario/permissoes', { token: quem.token })).dados as string[]

describe('permissões', () => {
  test('cada um vê as próprias; conta nova tem só as de uso', async () => {
    expect(await minhas(gestor)).toEqual(['parametros', 'permissoes', ...USO])
    expect(await minhas(comum)).toEqual(USO)
  })

  test('sem a permissão "permissoes", não lista, não concede nem retira (403)', async () => {
    expect((await chamar('GET', '/permissoes', { token: comum.token })).status).toBe(403)
    expect((await chamar('PUT', '/permissao/usuario', { token: comum.token, corpo: { usuario_id: comum.id, codigo: 'parametros' } })).status).toBe(403)
    expect((await chamar('DELETE', '/permissao/usuario', { token: comum.token, consulta: { usuario_id: gestor.id, codigo: 'parametros' } })).status).toBe(403)
  })

  test('lista as permissões que existem e quem tem cada uma', async () => {
    const { dados } = await chamar('GET', '/permissoes', { token: gestor.token })
    expect(dados.permissoes.map((p: { codigo: string }) => p.codigo)).toEqual(TODAS)
    expect(dados.permissoes.filter((p: { uso: boolean }) => p.uso).map((p: { codigo: string }) => p.codigo)).toEqual(USO)
    const usuarios = dados.usuarios as { id: number; permissoes: string[] }[]
    expect(usuarios.find((u) => u.id === gestor.id)!.permissoes).toEqual(['parametros', 'permissoes', ...USO])
    expect(usuarios.find((u) => u.id === comum.id)!.permissoes).toEqual(USO)
  })

  test('conceder e retirar; conceder de novo não duplica', async () => {
    const corpo = { usuario_id: comum.id, codigo: 'parametros' }
    expect((await chamar('PUT', '/permissao/usuario', { token: gestor.token, corpo })).status).toBe(200)
    expect((await chamar('PUT', '/permissao/usuario', { token: gestor.token, corpo })).status).toBe(200)
    expect(await minhas(comum)).toEqual(['parametros', ...USO])
    expect((await chamar('DELETE', '/permissao/usuario', { token: gestor.token, consulta: corpo })).status).toBe(200)
    expect(await minhas(comum)).toEqual(USO)
  })

  test('permissão ou usuário inexistente é 404', async () => {
    expect((await chamar('PUT', '/permissao/usuario', { token: gestor.token, corpo: { usuario_id: comum.id, codigo: 'nao-existe' } })).status).toBe(404)
    expect((await chamar('PUT', '/permissao/usuario', { token: gestor.token, corpo: { usuario_id: 999_999_999, codigo: 'parametros' } })).status).toBe(404)
  })

  test('ninguém com "permissoes": todos têm todas, até a primeira ser concedida', async () => {
    await noBanco((sql) => sql`
      delete from permissao_usuario where permissao_id = (select id from permissao where codigo = 'permissoes')`)
    expect(await minhas(comum)).toEqual(TODAS)
    expect((await chamar('GET', '/parametros', { token: comum.token })).status).toBe(200)
    expect((await chamar('GET', '/permissoes', { token: comum.token })).dados.modo_aberto).toBe(true)

    // A primeira concedida fecha o modo aberto: vale só o que está marcado
    await chamar('PUT', '/permissao/usuario', { token: comum.token, corpo: { usuario_id: comum.id, codigo: 'permissoes' } })
    expect(await minhas(comum)).toEqual(['permissoes', ...USO])
    expect((await chamar('GET', '/permissoes', { token: comum.token })).dados.modo_aberto).toBe(false)
    expect((await chamar('GET', '/parametros', { token: comum.token })).status).toBe(403)
    expect((await chamar('GET', '/permissoes', { token: gestor.token })).status).toBe(403)
  })

  test('ninguém retira as próprias permissões (400), nem as de uso', async () => {
    for (const codigo of ['permissoes', 'parametros', 'emoji']) {
      const resposta = await chamar('DELETE', '/permissao/usuario', { token: gestor.token, consulta: { usuario_id: gestor.id, codigo } })
      expect(resposta.status).toBe(400)
      expect(resposta.dados.error).toContain('próprias permissões')
    }
    expect(await minhas(gestor)).toEqual(['parametros', 'permissoes', ...USO])
  })
})

describe('permissões de uso', () => {
  let outro: UsuarioTeste
  beforeEach(async () => {
    outro = await criarUsuario('Outro Permissões')
  })

  const proibido = async (resposta: Promise<{ status: number; dados: { error?: string } }>, trecho: string) => {
    const { status, dados } = await resposta
    expect(status).toBe(403)
    expect(dados.error).toContain(trecho)
  }

  test('sem emoji não manda texto com emoji, mas manda texto sem', async () => {
    const conversa = await criarConversa(comum, [outro])
    await retirar(comum, 'emoji')
    await proibido(enviarTexto(comum, conversa, 'oi 😀'), 'emojis')
    expect((await enviarTexto(comum, conversa, 'oi')).status).toBe(200)
  })

  test('figurinha, imagem, áudio e agendar pedem cada uma a sua', async () => {
    const conversa = await criarConversa(comum, [outro])
    await retirar(comum, 'figurinha', 'imagem', 'audio', 'agendar')
    const enviar = (tipo: number, conteudo: string, extras = {}) =>
      chamar('PUT', '/mensagem', { token: comum.token, corpo: { conversa_id: conversa, conteudos: [{ ordem: 1, tipo, conteudo }], ...extras } })
    await proibido(enviar(7, 'noto/1f600'), 'figurinhas')
    await proibido(enviar(2, 'a'.repeat(64)), 'imagens')
    await proibido(enviar(5, 'a'.repeat(64)), 'áudios')
    await proibido(enviar(1, 'depois', { visivel_em: new Date(Date.now() + 60 * 60 * 1000).toISOString() }), 'agendar')
  })

  test('vídeo e arquivo pela extensão do anexo', async () => {
    const conversa = await criarConversa(comum, [outro])
    const video = await enviarAnexo(comum, `video ${Math.random()}`, 3, 'filme.mp4')
    const documento = await enviarAnexo(comum, `doc ${Math.random()}`, 3, 'nota.txt')
    await retirar(comum, 'video')
    const enviar = (identificador: string) =>
      chamar('PUT', '/mensagem', { token: comum.token, corpo: { conversa_id: conversa, conteudos: [{ ordem: 1, tipo: 3, conteudo: identificador }] } })
    await proibido(enviar(video.identificador), 'vídeos')
    expect((await enviar(documento.identificador)).status).toBe(200)
  })

  test('responder, encaminhar e reagir', async () => {
    const conversa = await criarConversa(comum, [outro])
    const original = await enviarTexto(outro, conversa, 'original')
    await retirar(comum, 'responder', 'encaminhar', 'reagir')
    await proibido(enviarTexto(comum, conversa, 'resposta', { mensagem_referencia: { tipo: 1, origem_mensagem_id: original.dados.id } }), 'responder')
    await proibido(enviarTexto(comum, conversa, 'original', { mensagem_referencia: { tipo: 2, origem_mensagem_id: original.dados.id } }), 'encaminhar')
    await proibido(chamar('PUT', '/mensagem/reacao', { token: comum.token, corpo: { mensagem_id: original.dados.id, emoji: '👍' } }), 'reagir')
  })

  test('encaminhar não pede as permissões dos conteúdos', async () => {
    const conversa = await criarConversa(comum, [outro])
    const original = await enviarTexto(outro, conversa, 'com emoji 🎉')
    await retirar(comum, 'emoji')
    const resposta = await enviarTexto(comum, conversa, 'com emoji 🎉', { mensagem_referencia: { tipo: 2, origem_mensagem_id: original.dados.id } })
    expect(resposta.status).toBe(200)
  })

  test('grupo, votação, postagem e confirmação de leitura', async () => {
    const grupo = await criarConversa(comum, [outro, gestor])
    await retirar(comum, 'grupo', 'votacao', 'postagem', 'confirmacao')
    await proibido(chamar('PUT', '/conversa', { token: comum.token, corpo: { descricao: 'Grupo', tipo: 2 } }), 'grupos')
    expect((await chamar('PUT', '/conversa', { token: comum.token, corpo: { descricao: null, tipo: 1 } })).status).toBe(200)
    await proibido(chamar('PUT', '/enquete', { token: comum.token, corpo: { conversa_id: grupo, pergunta: 'Qual?', opcoes: ['A', 'B'], multipla: false, encerra_em: null } }), 'votações')
    await proibido(enviarTexto(comum, grupo, 'post', { postagem: { titulo: null } }), 'postagens')
    await proibido(enviarTexto(comum, grupo, 'leia', { pede_confirmacao: true }), 'confirmação')
    const enviada = await enviarTexto(comum, grupo, 'sem pedir')
    await proibido(chamar('POST', '/mensagem/pedir-confirmacao', { token: comum.token, corpo: { mensagem_id: enviada.dados.id } }), 'confirmação')
  })

  test('chamada de áudio e de vídeo; ligar o vídeo pede a de vídeo', async () => {
    const conversa = await criarConversa(comum, [outro])
    const usuarios = [{ id: comum.id }, { id: outro.id }]
    await retirar(comum, 'chamada_video')
    await proibido(chamar('PUT', '/chamada/iniciar', { token: comum.token, corpo: { tipo: 2, conversa_id: conversa, usuarios } }), 'vídeo')
    const audio = await chamar('PUT', '/chamada/iniciar', { token: comum.token, corpo: { tipo: 1, conversa_id: conversa, usuarios } })
    expect(audio.status).toBe(200)
    await proibido(chamar('POST', '/chamada/video', { token: comum.token, corpo: { id: audio.dados.id } }), 'vídeo')
    await chamar('POST', '/chamada/finalizar', { token: comum.token, corpo: { id: audio.dados.id } })
    await retirar(comum, 'chamada_audio')
    await proibido(chamar('PUT', '/chamada/iniciar', { token: comum.token, corpo: { tipo: 1, conversa_id: conversa, usuarios } }), 'áudio')
  })

  test('sem telefonia, o ramal não volta e não se cadastra', async () => {
    await retirar(comum, 'telefonia')
    expect((await chamar('GET', '/sip', { token: comum.token })).dados).toEqual({})
    const corpo = { sip_user: '100', auth_user: '100', sip_password: 'x', display_name: 'X', domain: 'pbx.test', ws_server: 'wss://pbx.test', ativo: true }
    await proibido(chamar('PUT', '/sip', { token: comum.token, corpo }), 'telefonia')
  })

  test('ocultar a própria mensagem pede a permissão', async () => {
    const conversa = await criarConversa(comum, [outro])
    const enviada = await enviarTexto(comum, conversa, 'vou ocultar')
    await retirar(comum, 'ocultar')
    await proibido(chamar('DELETE', '/mensagem', { token: comum.token, consulta: { id: enviada.dados.id } }), 'ocultar')
  })

  test('nome, e-mail (com o telefone), avatar e privacidade pedem cada um a sua', async () => {
    await retirar(comum, 'nome', 'avatar', 'privacidade')
    const alterar = (campos: object) => chamar('PATCH', '/usuario', { token: comum.token, corpo: { id: comum.id, ...campos } })
    await proibido(alterar({ nome: 'Outro Nome' }), 'nome')
    await proibido(alterar({ avatar_anexo_id: null }), 'avatar')
    await proibido(alterar({ aparecer_offline: true }), 'privacidade')
    expect((await alterar({ email: 'novo@teste.test', telefone: '1199' })).status).toBe(200)
    await retirar(comum, 'email')
    await proibido(alterar({ telefone: '1188' }), 'e-mail')
  })

  test('trocar a senha pede a permissão própria', async () => {
    await retirar(comum, 'senha')
    await proibido(chamar('POST', '/alterar-senha', { token: comum.token, corpo: { senha_atual: comum.senha, senha: 'nova-senha' } }), 'senha')
  })
})

describe('cadastro', () => {
  const novoLogin = () => `cad${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

  test('com o cadastro fechado, ninguém se cadastra pela tela de login; quem tem "usuarios" cadastra', async () => {
    expect((await chamar('GET', '/cadastro')).dados).toEqual({ aberto: true })
    await chamar('PATCH', '/parametros', { token: gestor.token, corpo: { cadastro_aberto: false } })
    try {
      expect((await chamar('GET', '/cadastro')).dados).toEqual({ aberto: false })
      const login = novoLogin()
      const proprio = await chamar('PUT', '/usuario', { corpo: { nome: 'Fechado', login, email: `${login}@teste.test`, senha: 'senha-x' } })
      expect(proprio.status).toBe(403)
      expect(proprio.dados.error).toContain('cadastro está fechado')
      expect((await chamar('GET', '/parametros', { token: gestor.token })).dados.cadastro_aberto).toBe(false)

      await conceder(gestor, 'usuarios')
      const pessoa = await chamar('PUT', '/usuario/novo', { token: gestor.token, corpo: { nome: 'Pelo Admin', login, email: `${login}@teste.test`, senha: 'senha-x' } })
      expect(pessoa.status).toBe(200)
      expect(pessoa.dados).toMatchObject({ nome: 'Pelo Admin', login, bot: false })
      expect((await chamar('POST', '/login', { corpo: { login, senha: 'senha-x' } })).status).toBe(200)
      expect(await minhas({ ...comum, token: (await chamar('POST', '/login', { corpo: { login, senha: 'senha-x' } })).dados.token })).toEqual(USO)
    } finally {
      await chamar('PATCH', '/parametros', { token: gestor.token, corpo: { cadastro_aberto: true } })
    }
  })

  test('sem "usuarios" não cadastra (403); faltando campo é 400; avatar precisa ser uma imagem', async () => {
    const login = novoLogin()
    const corpo = { nome: 'X', login, email: `${login}@teste.test`, senha: 'senha-x' }
    expect((await chamar('PUT', '/usuario/novo', { token: comum.token, corpo })).status).toBe(403)
    await conceder(gestor, 'usuarios')
    expect((await chamar('PUT', '/usuario/novo', { token: gestor.token, corpo: { nome: 'X', login } })).status).toBe(400)
    const arquivo = await enviarAnexo(gestor, `nao-e-imagem ${Math.random()}`, 3, 'nota.txt')
    const arquivoId = (await noBanco((sql) => sql<{ id: number }[]>`select id from anexo where identificador = ${arquivo.identificador}`))[0]!.id
    expect((await chamar('PUT', '/usuario/novo', { token: gestor.token, corpo: { ...corpo, avatar_anexo_id: arquivoId } })).status).toBe(400)
    const imagem = await enviarAnexo(gestor, `imagem ${Math.random()}`, 2, 'avatar.jpg')
    const imagemId = (await noBanco((sql) => sql<{ id: number }[]>`select id from anexo where identificador = ${imagem.identificador}`))[0]!.id
    const criado = await chamar('PUT', '/usuario/novo', { token: gestor.token, corpo: { ...corpo, avatar_anexo_id: imagemId } })
    expect(criado.status).toBe(200)
    const [conta] = await noBanco((sql) => sql<{ avatar_anexo_id: number }[]>`select avatar_anexo_id from usuario where id = ${criado.dados.id}`)
    expect(conta!.avatar_anexo_id).toBe(imagemId)
  })

  test('cadastra um bot, com as instruções e só o básico liberado', async () => {
    await conceder(gestor, 'usuarios')
    const anterior = { ...configuracao.ia }
    configuracao.ia = { url: 'http://ia.test', token: '', modelo: 'teste' }
    try {
      const { status, dados } = await chamar('PUT', '/usuario/novo', { token: gestor.token, corpo: { nome: 'Robô Cadastro', bot: true, instrucoes: 'Ajuda com o RH.' } })
      expect(status).toBe(200)
      expect(dados).toMatchObject({ nome: 'Robô Cadastro', bot: true })
      expect(dados.login).toStartWith('bot-robo-cadastro-')
      const [bot] = await noBanco((sql) => sql<{ instrucoes: string; criado_por: number }[]>`select instrucoes, criado_por from bot where usuario_id = ${dados.id}`)
      expect(bot).toEqual({ instrucoes: 'Ajuda com o RH.', criado_por: gestor.id })
      const permissoes = await noBanco((sql) => sql<{ codigo: string }[]>`
        select p.codigo from permissao_usuario pu inner join permissao p on p.id = pu.permissao_id where pu.usuario_id = ${dados.id} order by p.id`)
      expect(permissoes.map((p) => p.codigo)).toEqual(['emoji', 'responder', 'reagir'])
      expect((await chamar('PUT', '/usuario/novo', { token: gestor.token, corpo: { nome: 'Sem instruções', bot: true } })).status).toBe(400)
    } finally {
      configuracao.ia = anterior
    }
  })
})

describe('parâmetros', () => {
  let originais: { nome: string; valor: string }[]
  beforeAll(async () => {
    originais = await noBanco((sql) => sql<{ nome: string; valor: string }[]>`select nome, valor from parametros`)
  })
  afterAll(async () => {
    await noBanco(async (sql) => {
      for (const { nome, valor } of originais) await sql`update parametros set valor = ${valor} where nome = ${nome}`
      await carregarParametros(sql)
    })
  })

  test('sem a permissão "parametros", nem vê nem altera (403)', async () => {
    expect((await chamar('GET', '/parametros', { token: comum.token })).status).toBe(403)
    expect((await chamar('PATCH', '/parametros', { token: comum.token, corpo: { gravacao_dias: 1 } })).status).toBe(403)
  })

  test('mostra os parâmetros sem os segredos', async () => {
    await noBanco((sql) => sql`update parametros set valor = '-----BEGIN PRIVATE KEY-----x' where nome = 'fcm_private_key'`)
    const { status, dados } = await chamar('GET', '/parametros', { token: gestor.token })
    expect(status).toBe(200)
    expect(dados.fcm_private_key_configurada).toBe(true)
    expect(JSON.stringify(dados)).not.toContain('PRIVATE KEY')
    expect(dados).not.toHaveProperty('jwt_token')
    expect(dados).not.toHaveProperty('fcm_private_key')
  })

  test('altera só o que foi enviado e aplica na hora', async () => {
    const { status, dados } = await chamar('PATCH', '/parametros', {
      token: gestor.token,
      corpo: { gravacao_dias: 30, turn_forcar_relay: true, transcritor_url: 'http://transcritor:8000', transcritor_idioma: 'pt-BR' },
    })
    expect(status).toBe(200)
    expect(dados).toMatchObject({ gravacao_dias: 30, turn_forcar_relay: true, transcritor_url: 'http://transcritor:8000', transcritor_idioma: 'pt-BR' })
    expect(configuracao.gravacaoDias).toBe(30)
    expect(configuracao.turnForcarRelay).toBe(true)
    expect(configuracao.transcritorUrl).toBe('http://transcritor:8000')
    const [relay] = await noBanco((sql) => sql<{ valor: string }[]>`select valor from parametros where nome = 'turn_forcar_relay'`)
    expect(relay!.valor).toBe('1')
  })

  test('valores inválidos são recusados com a explicação (400) e nada muda', async () => {
    const antes = configuracao.gravacaoDias
    for (const corpo of [
      { transcritor_url: 'ftp://x', gravacao_dias: 7 },
      { transcritor_idioma: 'portugues' },
      { fcm_client_email: 'sem-arroba' },
      { fcm_private_key: 'qualquer coisa' },
      { gravacao_dias: -1 },
    ]) {
      expect((await chamar('PATCH', '/parametros', { token: gestor.token, corpo })).status).toBe(400)
    }
    expect(configuracao.gravacaoDias).toBe(antes)
  })

  test('servidor de IA: o token é gravado mas nunca volta; recursos dizem se está ligado', async () => {
    const { status, dados } = await chamar('PATCH', '/parametros', {
      token: gestor.token,
      corpo: { ia_url: 'http://ollama:11434', ia_modelo: 'llama3.1', ia_token: 'segredo-da-ia' },
    })
    expect(status).toBe(200)
    expect(dados).toMatchObject({ ia_url: 'http://ollama:11434', ia_modelo: 'llama3.1', ia_token_configurado: true })
    expect(JSON.stringify(dados)).not.toContain('segredo-da-ia')
    expect(configuracao.ia).toEqual({ url: 'http://ollama:11434', modelo: 'llama3.1', token: 'segredo-da-ia' })
    expect((await chamar('GET', '/recursos', { token: comum.token })).dados).toMatchObject({ ia: true })
    expect((await chamar('PATCH', '/parametros', { token: gestor.token, corpo: { ia_url: 'ollama:11434' } })).status).toBe(400)
    await chamar('PATCH', '/parametros', { token: gestor.token, corpo: { ia_modelo: '' } })
    expect((await chamar('GET', '/recursos', { token: comum.token })).dados).toMatchObject({ ia: false })
  })

  test('testar a IA usa o que está na tela e o token salvo; só com a permissão', async () => {
    const pedidos: { url: string; autorizacao: string | null; corpo: { model: string } }[] = []
    const ia = Bun.serve({
      port: 0,
      async fetch(req) {
        pedidos.push({ url: new URL(req.url).pathname, autorizacao: req.headers.get('authorization'), corpo: await req.json() })
        return Response.json({ choices: [{ message: { content: 'ok' } }] })
      },
    })
    try {
      await chamar('PATCH', '/parametros', { token: gestor.token, corpo: { ia_token: 'token-salvo' } })
      const corpo = { url: `http://localhost:${ia.port}/v1/`, modelo: 'qwen' }
      expect((await chamar('POST', '/parametros/ia/testar', { token: comum.token, corpo })).status).toBe(403)
      const { dados } = await chamar('POST', '/parametros/ia/testar', { token: gestor.token, corpo })
      expect(dados).toMatchObject({ ok: true, resposta: 'ok', erro: '' })
      expect(pedidos[0]).toEqual({ url: '/v1/chat/completions', autorizacao: 'Bearer token-salvo', corpo: expect.objectContaining({ model: 'qwen' }) })
      const semServidor = await chamar('POST', '/parametros/ia/testar', { token: gestor.token, corpo: { url: 'http://localhost:1', modelo: 'x', token: 'outro' } })
      expect(semServidor.dados.ok).toBe(false)
      expect(semServidor.dados.erro).toContain('Não foi possível falar com o servidor de IA')
    } finally {
      ia.stop(true)
    }
  })

  test('campo vazio é aceito (desliga a transcrição, por exemplo)', async () => {
    const { dados } = await chamar('PATCH', '/parametros', { token: gestor.token, corpo: { transcritor_url: '' } })
    expect(dados.transcritor_url).toBe('')
    expect(configuracao.transcritorUrl).toBe('')
  })
})

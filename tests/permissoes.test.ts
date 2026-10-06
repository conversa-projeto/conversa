import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { chamar, criarUsuario, noBanco, type UsuarioTeste } from './api.ts'
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

const minhas = async (quem: UsuarioTeste) => (await chamar('GET', '/usuario/permissoes', { token: quem.token })).dados as string[]

describe('permissões', () => {
  test('cada um vê as próprias; quem não tem nenhuma recebe lista vazia', async () => {
    expect(await minhas(gestor)).toEqual(['parametros', 'permissoes'])
    expect(await minhas(comum)).toEqual([])
  })

  test('sem a permissão "permissoes", não lista, não concede nem retira (403)', async () => {
    expect((await chamar('GET', '/permissoes', { token: comum.token })).status).toBe(403)
    expect((await chamar('PUT', '/permissao/usuario', { token: comum.token, corpo: { usuario_id: comum.id, codigo: 'parametros' } })).status).toBe(403)
    expect((await chamar('DELETE', '/permissao/usuario', { token: comum.token, consulta: { usuario_id: gestor.id, codigo: 'parametros' } })).status).toBe(403)
  })

  test('lista as permissões que existem e quem tem cada uma', async () => {
    const { dados } = await chamar('GET', '/permissoes', { token: gestor.token })
    expect(dados.permissoes.map((p: { codigo: string }) => p.codigo)).toEqual(['parametros', 'permissoes'])
    const usuarios = dados.usuarios as { id: number; permissoes: string[] }[]
    expect(usuarios.find((u) => u.id === gestor.id)!.permissoes).toEqual(['parametros', 'permissoes'])
    expect(usuarios.find((u) => u.id === comum.id)!.permissoes).toEqual([])
  })

  test('conceder e retirar; conceder de novo não duplica', async () => {
    const corpo = { usuario_id: comum.id, codigo: 'parametros' }
    expect((await chamar('PUT', '/permissao/usuario', { token: gestor.token, corpo })).status).toBe(200)
    expect((await chamar('PUT', '/permissao/usuario', { token: gestor.token, corpo })).status).toBe(200)
    expect(await minhas(comum)).toEqual(['parametros'])
    expect((await chamar('DELETE', '/permissao/usuario', { token: gestor.token, consulta: corpo })).status).toBe(200)
    expect(await minhas(comum)).toEqual([])
  })

  test('permissão ou usuário inexistente é 404', async () => {
    expect((await chamar('PUT', '/permissao/usuario', { token: gestor.token, corpo: { usuario_id: comum.id, codigo: 'nao-existe' } })).status).toBe(404)
    expect((await chamar('PUT', '/permissao/usuario', { token: gestor.token, corpo: { usuario_id: 999_999_999, codigo: 'parametros' } })).status).toBe(404)
  })

  test('ninguém com "permissoes": todos têm todas, até a primeira ser concedida', async () => {
    await noBanco((sql) => sql`
      delete from permissao_usuario where permissao_id = (select id from permissao where codigo = 'permissoes')`)
    expect(await minhas(comum)).toEqual(['parametros', 'permissoes'])
    expect((await chamar('GET', '/parametros', { token: comum.token })).status).toBe(200)
    expect((await chamar('GET', '/permissoes', { token: comum.token })).dados.modo_aberto).toBe(true)

    // A primeira concedida fecha o modo aberto: vale só o que está marcado
    await chamar('PUT', '/permissao/usuario', { token: comum.token, corpo: { usuario_id: comum.id, codigo: 'permissoes' } })
    expect(await minhas(comum)).toEqual(['permissoes'])
    expect((await chamar('GET', '/permissoes', { token: comum.token })).dados.modo_aberto).toBe(false)
    expect((await chamar('GET', '/parametros', { token: comum.token })).status).toBe(403)
    expect((await chamar('GET', '/permissoes', { token: gestor.token })).status).toBe(403)
  })

  test('não retira "permissoes" de quem é o último a tê-la', async () => {
    // Garante que só o gestor tem "permissoes" no banco de teste
    await noBanco((sql) => sql`
      delete from permissao_usuario
       where usuario_id <> ${gestor.id}
         and permissao_id = (select id from permissao where codigo = 'permissoes')`)
    const resposta = await chamar('DELETE', '/permissao/usuario', { token: gestor.token, consulta: { usuario_id: gestor.id, codigo: 'permissoes' } })
    expect(resposta.status).toBe(400)
    expect(resposta.dados.error).toContain('Ao menos uma pessoa')
    expect(await minhas(gestor)).toContain('permissoes')
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

  test('campo vazio é aceito (desliga a transcrição, por exemplo)', async () => {
    const { dados } = await chamar('PATCH', '/parametros', { token: gestor.token, corpo: { transcritor_url: '' } })
    expect(dados.transcritor_url).toBe('')
    expect(configuracao.transcritorUrl).toBe('')
  })
})

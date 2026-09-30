import { beforeAll, describe, expect, spyOn, test } from 'bun:test'
import { criarApp } from '../src/app.ts'
import { executarMigracoes } from '../src/migracoes.ts'
import { configuracao, definirAmbiente } from '../src/configuracao.ts'
import { iniciarTarefas } from '../src/tarefas.ts'
import { chamar, enviarAnexo, noBanco, usuariosComuns, type UsuarioTeste } from './api.ts'

let ana: UsuarioTeste
beforeAll(async () => ({ ana } = await usuariosComuns()))

describe('respostas de erro', () => {
  test('rota inexistente é 404 no formato { error }', async () => {
    const { status, dados } = await chamar('GET', '/nao-existe', { token: ana.token })
    expect(status).toBe(404)
    expect(dados).toEqual({ error: 'Rota GET:/api/nao-existe não encontrada' })
  })

  test('erro inesperado é 500 no formato { error } e vai para o log', async () => {
    const log = spyOn(console, 'error').mockImplementation(() => {})
    try {
      const app = criarApp('chave-dos-testes').get('/api/quebra', () => { throw new Error('quebrou') })
      const resposta = await app.handle(new Request('http://localhost/api/quebra'))
      expect(resposta.status).toBe(500)
      expect(await resposta.json()).toEqual({ error: 'quebrou' })
      expect(log).toHaveBeenCalled()
    } finally {
      log.mockRestore()
    }
  })

  test('corpo que não é JSON válido é 400', async () => {
    const { status, dados } = await chamar('PUT', '/conversa', { token: ana.token, corpoBruto: '{ isto não é json' })
    expect(status).toBe(400)
    expect(dados.error).toBeString()
  })

  test('tipo errado no corpo diz o campo e o tipo esperado', async () => {
    const { status, dados } = await chamar('PUT', '/mensagem', { token: ana.token, corpo: { conversa_id: 'um', conteudos: [] } })
    expect(status).toBe(400)
    expect(dados.error).toBe('O valor de "conversa_id" deve ser do tipo integer!')
  })

  test('tipo errado na consulta diz o campo', async () => {
    const { status, dados } = await chamar('GET', '/mensagens', { token: ana.token, consulta: { conversa: 'x' } })
    expect(status).toBe(400)
    expect(dados.error).toContain('"conversa"')
  })

  test('fora do limite na consulta acha o campo pelo valor', async () => {
    const { status, dados } = await chamar('GET', '/mensagens', { token: ana.token, consulta: { conversa: 1, mensagensprevias: 5000 } })
    expect(status).toBe(400)
    expect(dados.error).toContain('mensagensprevias')
  })

  test('documentação das rotas em /api/docs/json', async () => {
    const { status, dados } = await chamar('GET', '/docs/json')
    expect(status).toBe(200)
    expect(Object.keys(dados.paths)).toContain('/api/mensagem')
  })
})

describe('migrações', () => {
  test('rodar de novo não reaplica nada', async () => {
    const [antes] = await noBanco((sql) => sql<{ valor: string }[]>`select valor from parametros where nome = 'versao'`)
    await executarMigracoes()
    const [depois] = await noBanco((sql) => sql<{ valor: string }[]>`select valor from parametros where nome = 'versao'`)
    expect(depois?.valor).toBe(antes!.valor)
    expect(Number(antes!.valor)).toBeGreaterThan(0)
  })
})

describe('variáveis de ambiente', () => {
  test('porta que não é número inteiro impede a inicialização com mensagem clara', () => {
    const anterior = process.env.CONVERSA_PORTA_HTTP
    const banco = { ...configuracao.banco }
    process.env.CONVERSA_PORTA_HTTP = 'oito mil'
    try {
      expect(() => definirAmbiente()).toThrow('CONVERSA_PORTA_HTTP deve ser um número inteiro')
    } finally {
      if (anterior === undefined) delete process.env.CONVERSA_PORTA_HTTP
      else process.env.CONVERSA_PORTA_HTTP = anterior
      configuracao.banco = banco
    }
  })
})

describe('verificação de uploads pendentes', () => {
  test('confirma o anexo cujo arquivo já está no MinIO e marca como falho o que passou do prazo', async () => {
    const { identificador: enviado } = await enviarAnexo(ana, `pendente ${crypto.randomUUID()}`)
    const naoEnviado = new Bun.CryptoHasher('sha256').update(crypto.randomUUID()).digest('hex')
    await chamar('PUT', '/anexo', { token: ana.token, corpo: { identificador: naoEnviado, tipo: 3, nome: 'n.txt', extensao: 'txt', tamanho: 1 } })
    await noBanco(async (sql) => {
      await sql`update anexo set criado_em = current_timestamp - interval '2 minutes' where identificador = ${enviado}`
      await sql`update anexo set criado_em = current_timestamp - interval '20 minutes' where identificador = ${naoEnviado}`
    })
    const parar = iniciarTarefas()
    const status = async (identificador: string) =>
      (await noBanco((sql) => sql<{ upload_status: number }[]>`select upload_status from anexo where identificador = ${identificador}`))[0]?.upload_status
    try {
      for (let i = 0; i < 20 && (await status(enviado)) === 0; i++) await Bun.sleep(100)
    } finally {
      parar()
    }
    expect(await status(enviado)).toBe(1)
    expect(await status(naoEnviado)).toBe(2)
  })
})

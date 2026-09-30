import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { configuracao } from '../src/configuracao.ts'
import { chamar, criarConversa, enviarAnexo, noBanco, usuariosComuns, type UsuarioTeste } from './api.ts'

let ana: UsuarioTeste, bruno: UsuarioTeste, carla: UsuarioTeste
beforeAll(async () => ({ ana, bruno, carla } = await usuariosComuns()))

// Áudio numa conversa, com o anexo gravado direto no banco: para as regras de
// permissão basta o registro, sem o arquivo no MinIO.
async function audioNaConversa(conversa: number, tipo = 5) {
  const identificador = crypto.randomUUID().replaceAll('-', '').padEnd(64, '0')
  await noBanco((sql) => sql`
    insert into anexo (identificador, tipo, tamanho, nome, extensao, objeto)
    values (${identificador}, ${tipo}, 100, 'audio.webm', 'webm', ${`conversa/teste/${identificador}`})`)
  const envio = await chamar('PUT', '/mensagem', { token: ana.token, corpo: { conversa_id: conversa, conteudos: [{ ordem: 1, tipo, conteudo: identificador }] } })
  expect(envio.status).toBe(200)
  return identificador
}

describe('transcrição de áudio', () => {
  test('participante consulta: sem transcrição ainda', async () => {
    const identificador = await audioNaConversa(await criarConversa(ana, [bruno]))
    const { status, dados } = await chamar('GET', '/anexo/transcricao', { token: bruno.token, consulta: { identificador } })
    expect(status).toBe(200)
    expect(dados).toEqual({ status: 0, texto: '', erro: '' })
  })

  test('quem está fora da conversa não consulta nem pede', async () => {
    const identificador = await audioNaConversa(await criarConversa(ana, [bruno]))
    expect((await chamar('GET', '/anexo/transcricao', { token: carla.token, consulta: { identificador } })).status).toBe(403)
    expect((await chamar('PUT', '/anexo/transcricao', { token: carla.token, corpo: { identificador } })).status).toBe(403)
  })

  test('arquivo que não é áudio não é transcrito', async () => {
    const identificador = await audioNaConversa(await criarConversa(ana, [bruno]), 3)
    expect((await chamar('PUT', '/anexo/transcricao', { token: bruno.token, corpo: { identificador } })).status).toBe(403)
  })

  test('sem transcritor configurado, pedir é 400 com a explicação', async () => {
    const identificador = await audioNaConversa(await criarConversa(ana, [bruno]))
    const anterior = configuracao.transcritorUrl
    configuracao.transcritorUrl = ''
    try {
      const { status, dados } = await chamar('PUT', '/anexo/transcricao', { token: bruno.token, corpo: { identificador } })
      expect(status).toBe(400)
      expect(dados.error).toContain('transcritor_url')
    } finally {
      configuracao.transcritorUrl = anterior
    }
  })
})

describe('transcrição de ponta a ponta, com um transcritor falso', () => {
  // Imita o transcritor-api: POST /jobs, GET /jobs/:id e o download em txt.
  // Cada teste diz como o próximo job se comporta.
  let comportamento: 'sucesso' | 'erro-no-job' | 'recusa' = 'sucesso'
  const pedidos: FormData[] = []
  let consultas = 0
  const transcritor = Bun.serve({
    port: 0,
    async fetch(requisicao) {
      const { pathname } = new URL(requisicao.url)
      if (requisicao.method === 'POST' && pathname === '/jobs') {
        if (comportamento === 'recusa') return new Response('fila cheia', { status: 503 })
        pedidos.push(await requisicao.formData())
        return Response.json({ job_id: `job-${pedidos.length}`, status: 'queued' }, { status: 202 })
      }
      if (pathname.endsWith('/download')) return new Response('  texto transcrito  ')
      if (pathname.startsWith('/jobs/')) {
        consultas++
        if (comportamento === 'erro-no-job') return Response.json({ job_id: 'x', status: 'error', error: 'áudio corrompido' })
        return Response.json({ job_id: 'x', status: consultas > 1 ? 'done' : 'running' })
      }
      return new Response('não encontrado', { status: 404 })
    },
  })

  const pedir = (identificador: string) => chamar('PUT', '/anexo/transcricao', { token: bruno.token, corpo: { identificador } })
  const consultar = (identificador: string) => chamar('GET', '/anexo/transcricao', { token: bruno.token, consulta: { identificador } })
  async function aguardar(identificador: string) {
    for (let i = 0; i < 40; i++) {
      const { dados } = await consultar(identificador)
      if (dados.status !== 1) return dados
      await Bun.sleep(250)
    }
    throw new Error('transcrição não terminou')
  }
  // Áudio enviado de verdade ao MinIO: a API lê o arquivo de lá para mandar ao transcritor.
  async function audioDeVerdade(conteudo: string) {
    const conversa = await criarConversa(ana, [bruno])
    const { identificador } = await enviarAnexo(ana, conteudo, 5, 'gravacao.webm')
    await chamar('PUT', '/mensagem', { token: ana.token, corpo: { conversa_id: conversa, conteudos: [{ ordem: 1, tipo: 5, conteudo: identificador }] } })
    return { conversa, identificador }
  }

  beforeAll(() => {
    configuracao.transcritorUrl = `http://127.0.0.1:${transcritor.port}/`
    configuracao.transcritorIdioma = 'pt'
  })
  afterAll(() => {
    configuracao.transcritorUrl = ''
    transcritor.stop(true)
  })

  test('envia o áudio sem separar falantes nem alinhar palavras, e grava o texto', async () => {
    comportamento = 'sucesso'
    consultas = 0
    const { identificador } = await audioDeVerdade(`áudio ${crypto.randomUUID()}`)
    expect((await pedir(identificador)).dados).toEqual({ status: 1, texto: '', erro: '' })
    expect(await aguardar(identificador)).toEqual({ status: 2, texto: 'texto transcrito', erro: '' })
    const enviado = pedidos.at(-1)!
    expect(enviado.get('language')).toBe('pt')
    expect(enviado.get('diarization')).toBe('false')
    expect(enviado.get('alignment')).toBe('false')
    expect(enviado.has('num_speakers')).toBe(false)
    expect((enviado.get('file') as File).name).toBe('audio.webm')
  })

  test('a transcrição aparece na mensagem para os participantes', async () => {
    comportamento = 'sucesso'
    consultas = 0
    const { conversa, identificador } = await audioDeVerdade(`áudio ${crypto.randomUUID()}`)
    await pedir(identificador)
    await aguardar(identificador)
    const { dados } = await chamar('GET', '/mensagens', { token: bruno.token, consulta: { conversa, mensagemreferencia: 0, mensagensprevias: 5, mensagensseguintes: 0 } })
    const conteudo = dados.flatMap((m: { conteudos: object[] }) => m.conteudos).find((c: { conteudo: string }) => c.conteudo === identificador)
    expect(conteudo).toMatchObject({ transcricao_status: 2, transcricao: 'texto transcrito' })
  })

  test('pronta, pedir de novo não reenvia ao transcritor', async () => {
    comportamento = 'sucesso'
    consultas = 0
    const { identificador } = await audioDeVerdade(`áudio ${crypto.randomUUID()}`)
    await pedir(identificador)
    await aguardar(identificador)
    const antes = pedidos.length
    expect((await pedir(identificador)).dados.status).toBe(2)
    expect(pedidos.length).toBe(antes)
  })

  test('em andamento, pedir de novo não duplica o pedido', async () => {
    comportamento = 'sucesso'
    consultas = 0
    const { identificador } = await audioDeVerdade(`áudio ${crypto.randomUUID()}`)
    const antes = pedidos.length
    await pedir(identificador)
    expect((await pedir(identificador)).dados.status).toBe(1)
    await aguardar(identificador)
    expect(pedidos.length).toBe(antes + 1)
  })

  test('erro do transcritor no job fica registrado, e dá para pedir de novo', async () => {
    comportamento = 'erro-no-job'
    const { identificador } = await audioDeVerdade(`áudio ${crypto.randomUUID()}`)
    await pedir(identificador)
    expect(await aguardar(identificador)).toEqual({ status: 3, texto: '', erro: 'áudio corrompido' })
    comportamento = 'sucesso'
    consultas = 0
    expect((await pedir(identificador)).dados.status).toBe(1)
    expect((await aguardar(identificador)).status).toBe(2)
  })

  test('transcritor recusando o pedido vira erro com a resposta dele', async () => {
    comportamento = 'recusa'
    const { identificador } = await audioDeVerdade(`áudio ${crypto.randomUUID()}`)
    await pedir(identificador)
    const resultado = await aguardar(identificador)
    expect(resultado.status).toBe(3)
    expect(resultado.erro).toBe('transcritor respondeu 503: fila cheia')
  })

  test('transcritor fora do ar vira erro', async () => {
    comportamento = 'sucesso'
    const anterior = configuracao.transcritorUrl
    configuracao.transcritorUrl = 'http://127.0.0.1:1'
    try {
      const { identificador } = await audioDeVerdade(`áudio ${crypto.randomUUID()}`)
      await pedir(identificador)
      expect((await aguardar(identificador)).status).toBe(3)
    } finally {
      configuracao.transcritorUrl = anterior
    }
  })
})

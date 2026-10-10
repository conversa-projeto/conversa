import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { configuracao } from '../src/configuracao.ts'
import { lerAssuntos } from '../src/resumos.ts'
import { chamar, criarConversa, enviarTexto, usuariosComuns, type UsuarioTeste } from './api.ts'

let ana: UsuarioTeste, bruno: UsuarioTeste, carla: UsuarioTeste
beforeAll(async () => ({ ana, bruno, carla } = await usuariosComuns()))

// Imita um servidor no padrão da OpenAI. Cada teste diz o que ele responde.
let responder: (corpo: { messages: { content: string }[] }) => Response = () => new Response('', { status: 500 })
const pedidos: { messages: { role: string; content: string }[]; response_format?: unknown }[] = []
const ia = Bun.serve({
  port: 0,
  async fetch(req) {
    const corpo = await req.json()
    pedidos.push(corpo)
    return responder(corpo)
  },
})
const anterior = { ...configuracao.ia }
beforeEach(() => {
  pedidos.length = 0
  configuracao.ia = { url: `http://localhost:${ia.port}`, token: '', modelo: 'teste' }
})
afterAll(() => {
  configuracao.ia = anterior
  ia.stop(true)
})

const respostaIa = (conteudo: unknown) => Response.json({ choices: [{ message: { content: typeof conteudo === 'string' ? conteudo : JSON.stringify(conteudo) } }] })

async function esperarPronto(quem: UsuarioTeste, id: string) {
  for (let i = 0; i < 50; i++) {
    const { dados } = await chamar('GET', '/conversa/resumo', { token: quem.token, consulta: { id } })
    if (dados.status !== 'processando') return dados
    await Bun.sleep(50)
  }
  throw new Error('resumo não terminou')
}

describe('resumo da conversa', () => {
  test('manda as mensagens ao modelo e devolve os assuntos, só com ids da conversa', async () => {
    const conversa = await criarConversa(ana, [bruno])
    const { dados: primeira } = await enviarTexto(ana, conversa, 'Vamos fechar o orçamento até sexta?')
    const { dados: segunda } = await enviarTexto(bruno, conversa, 'Fecho até quinta, @[Ana](1)')
    responder = () => respostaIa('```json\n' + JSON.stringify({
      assuntos: [
        { titulo: 'Orçamento', resumo: 'Bruno fecha até quinta.', pendencias: ['Fechar orçamento'], mensagens: [segunda.id, primeira.id, 999_999] },
        { titulo: '', resumo: 'sem título some' },
      ],
    }) + '\n```')

    const { status, dados } = await chamar('POST', '/conversa/resumo', { token: ana.token, corpo: { conversa_id: conversa, periodo: '7d' } })
    expect(status).toBe(200)
    expect(dados).toMatchObject({ status: 'processando', mensagens: 2 })
    const pronto = await esperarPronto(ana, dados.id)
    expect(pronto).toMatchObject({ status: 'concluido', erro: '' })
    expect(pronto.assuntos).toEqual([{ titulo: 'Orçamento', resumo: 'Bruno fecha até quinta.', pendencias: ['Fechar orçamento'], mensagens: [primeira.id, segunda.id] }])

    const texto = pedidos[0]!.messages[1]!.content
    expect(texto).toContain(`[${primeira.id}]`)
    expect(texto).toContain('Vamos fechar o orçamento até sexta?')
    expect(texto).toContain('Fecho até quinta, @Ana')
    expect(pedidos[0]!.response_format).toMatchObject({ type: 'json_schema', json_schema: { name: 'resumo_conversa', strict: true } })
  })

  test('servidor que recusa o formato JSON recebe o pedido de novo sem ele', async () => {
    const conversa = await criarConversa(ana, [bruno])
    await enviarTexto(ana, conversa, 'Reunião amanhã às 9h')
    responder = (corpo) => 'response_format' in corpo
      ? new Response(JSON.stringify({ error: "'response_format.type' must be 'json_schema' or 'text'" }), { status: 400 })
      : respostaIa('Claro! {"assuntos":[{"titulo":"Reunião","resumo":"Amanhã às 9h.","pendencias":[],"mensagens":[]}]}')
    const { dados } = await chamar('POST', '/conversa/resumo', { token: ana.token, corpo: { conversa_id: conversa, periodo: '24h' } })
    const pronto = await esperarPronto(ana, dados.id)
    expect(pronto).toMatchObject({ status: 'concluido', assuntos: [{ titulo: 'Reunião', resumo: 'Amanhã às 9h.' }] })
    expect(pedidos).toHaveLength(2)
    expect(pedidos[1]!.response_format).toBeUndefined()
  })

  test('sem mensagens no período, fica pronto sem chamar a IA', async () => {
    const conversa = await criarConversa(ana, [bruno])
    const { dados } = await chamar('POST', '/conversa/resumo', { token: ana.token, corpo: { conversa_id: conversa, periodo: '24h' } })
    expect(dados).toMatchObject({ status: 'concluido', mensagens: 0, assuntos: [] })
    expect(pedidos).toHaveLength(0)
  })

  test('erro do servidor de IA aparece no resumo', async () => {
    const conversa = await criarConversa(ana, [bruno])
    await enviarTexto(ana, conversa, 'oi')
    responder = () => new Response('modelo não encontrado', { status: 404 })
    const { dados } = await chamar('POST', '/conversa/resumo', { token: ana.token, corpo: { conversa_id: conversa, periodo: 'recentes' } })
    const pronto = await esperarPronto(ana, dados.id)
    expect(pronto.status).toBe('erro')
    expect(pronto.erro).toContain('404')
  })

  test('quem está fora não pede; só quem pediu consulta; sem IA configurada é 400', async () => {
    const conversa = await criarConversa(ana, [bruno])
    await enviarTexto(ana, conversa, 'oi')
    expect((await chamar('POST', '/conversa/resumo', { token: carla.token, corpo: { conversa_id: conversa, periodo: '7d' } })).status).toBe(403)
    responder = () => respostaIa({ assuntos: [{ titulo: 'Oi', resumo: 'Cumprimento.', mensagens: [] }] })
    const { dados } = await chamar('POST', '/conversa/resumo', { token: ana.token, corpo: { conversa_id: conversa, periodo: '7d' } })
    expect((await chamar('GET', '/conversa/resumo', { token: bruno.token, consulta: { id: dados.id } })).status).toBe(404)
    configuracao.ia = { url: '', token: '', modelo: '' }
    expect((await chamar('POST', '/conversa/resumo', { token: ana.token, corpo: { conversa_id: conversa, periodo: '7d' } })).status).toBe(400)
  })
})

describe('leitura da resposta do modelo', () => {
  test('formato errado é recusado; pendências e mensagens ausentes viram listas vazias', () => {
    expect(() => lerAssuntos({ topicos: [] }, new Set())).toThrow('formato esperado')
    expect(lerAssuntos({ assuntos: [{ titulo: 'A', resumo: 'B' }] }, new Set([1]))).toEqual([{ titulo: 'A', resumo: 'B', pendencias: [], mensagens: [] }])
  })
})

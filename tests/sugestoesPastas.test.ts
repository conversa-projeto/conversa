import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { configuracao } from '../src/configuracao.ts'
import { lerSugestoes } from '../src/sugestoesPastas.ts'
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

const respostaIa = (conteudo: unknown) => Response.json({ choices: [{ message: { content: JSON.stringify(conteudo) } }] })

async function criarPasta(quem: UsuarioTeste, conversa: number, nome: string, compartilhada = false) {
  const { dados } = await chamar('PUT', '/pasta', { token: quem.token, corpo: { conversa_id: conversa, nome, compartilhada } })
  return dados.id as number
}

async function porNaPasta(quem: UsuarioTeste, pasta: number, mensagens: number[]) {
  await chamar('PUT', '/pasta/mensagens', { token: quem.token, corpo: { pasta_id: pasta, mensagens } })
}

async function esperarPronto(quem: UsuarioTeste, id: string) {
  for (let i = 0; i < 50; i++) {
    const { dados } = await chamar('GET', '/pastas/sugestao', { token: quem.token, consulta: { id } })
    if (dados.status !== 'processando') return dados
    await Bun.sleep(50)
  }
  throw new Error('a sugestão não terminou')
}

const pedir = (quem: UsuarioTeste, conversa: number, ignorar?: number[]) =>
  chamar('POST', '/pastas/sugerir', { token: quem.token, corpo: { conversa_id: conversa, ...(ignorar ? { ignorar } : {}) } })

describe('sugestão de pasta pela IA', () => {
  test('manda as pastas (nome e exemplos) e as mensagens sem pasta; devolve a pasta de cada uma', async () => {
    const conversa = await criarConversa(ana, [bruno])
    const financeiro = await criarPasta(ana, conversa, 'Financeiro')
    const viagem = await criarPasta(ana, conversa, 'Viagem')
    const { dados: exemplo } = await enviarTexto(bruno, conversa, 'Segue o boleto de outubro')
    await porNaPasta(ana, financeiro, [exemplo.id])
    const { dados: nota } = await enviarTexto(bruno, conversa, 'A nota fiscal do fornecedor chegou')
    const { dados: oi } = await enviarTexto(ana, conversa, 'Bom dia!')
    const { dados: hotel } = await enviarTexto(ana, conversa, 'Reservei o hotel em Recife')
    responder = () => respostaIa({
      sugestoes: [
        { mensagem: hotel.id, pasta: viagem },
        { mensagem: nota.id, pasta: financeiro },
        // Repetida (fica a primeira), id de fora e pasta que não existe somem
        { mensagem: nota.id, pasta: viagem },
        { mensagem: 999_999, pasta: viagem },
        { mensagem: oi.id, pasta: 999_999 },
      ],
    })

    const { status, dados } = await pedir(ana, conversa)
    expect(status).toBe(200)
    // A do boleto já está numa pasta: fica fora da análise
    expect(dados).toMatchObject({ status: 'processando', analisadas: 3, conversa_id: conversa })
    const pronto = await esperarPronto(ana, dados.id)
    expect(pronto).toMatchObject({ status: 'concluido', erro: '' })
    expect(pronto.sugestoes).toEqual([
      { mensagem_id: nota.id, pasta_id: financeiro, autor: 'Bruno', texto: 'A nota fiscal do fornecedor chegou' },
      { mensagem_id: hotel.id, pasta_id: viagem, autor: 'Ana', texto: 'Reservei o hotel em Recife' },
    ])

    const [sistema, usuario] = pedidos[0]!.messages
    expect(sistema!.content).toContain('no máximo uma por mensagem')
    expect(usuario!.content).toContain(`Pasta ${financeiro}: "Financeiro"\n  - Segue o boleto de outubro`)
    expect(usuario!.content).toContain(`Pasta ${viagem}: "Viagem" (ainda sem mensagens)`)
    expect(usuario!.content).toContain(`[${nota.id}] Bruno: A nota fiscal do fornecedor chegou`)
    expect(usuario!.content).not.toContain(`[${exemplo.id}]`)
    expect(pedidos[0]!.response_format).toMatchObject({ type: 'json_schema', json_schema: { name: 'sugestao_pastas', strict: true } })
    // Classificar não precisa do raciocínio do modelo: com ele, o Gemma 4 levava 3 vezes mais
    expect(pedidos[0]).toMatchObject({ reasoning_effort: 'none' })
  })

  test('as ignoradas e as que já estão em pasta compartilhada pela outra pessoa ficam de fora', async () => {
    const conversa = await criarConversa(ana, [bruno])
    await criarPasta(ana, conversa, 'Projeto')
    const daBruno = await criarPasta(bruno, conversa, 'Contratos', true)
    const { dados: contrato } = await enviarTexto(bruno, conversa, 'Contrato assinado')
    await porNaPasta(bruno, daBruno, [contrato.id])
    const { dados: ignorada } = await enviarTexto(ana, conversa, 'Prazo do projeto mudou')
    const { dados: nova } = await enviarTexto(ana, conversa, 'Projeto aprovado')
    responder = () => respostaIa({ sugestoes: [] })
    const { dados } = await pedir(ana, conversa, [ignorada.id])
    expect(dados.analisadas).toBe(1)
    expect((await esperarPronto(ana, dados.id)).sugestoes).toEqual([])
    const texto = pedidos[0]!.messages[1]!.content
    expect(texto).toContain(`[${nova.id}]`)
    expect(texto).not.toContain(`[${ignorada.id}]`)
    expect(texto).not.toContain(`[${contrato.id}]`)
    // A compartilhada entra como pasta, com o exemplo dela
    expect(texto).toContain(`Pasta ${daBruno}: "Contratos"\n  - Contrato assinado`)
  })

  test('tudo já em pasta: pronto sem chamar a IA', async () => {
    const conversa = await criarConversa(ana, [bruno])
    const pasta = await criarPasta(ana, conversa, 'Tudo')
    const { dados: mensagem } = await enviarTexto(ana, conversa, 'só esta')
    await porNaPasta(ana, pasta, [mensagem.id])
    const { dados } = await pedir(ana, conversa)
    expect(dados).toMatchObject({ status: 'concluido', analisadas: 0, sugestoes: [] })
    expect(pedidos).toHaveLength(0)
  })

  test('sem pasta, sem IA ou sem acesso à conversa, recusa', async () => {
    const conversa = await criarConversa(ana, [bruno])
    await enviarTexto(ana, conversa, 'oi')
    expect((await pedir(ana, conversa)).dados.error).toBe('Crie uma pasta antes de pedir sugestões.')
    // A pasta do Bruno, não compartilhada, não conta para a Ana
    await criarPasta(bruno, conversa, 'Só do Bruno')
    expect((await pedir(ana, conversa)).status).toBe(400)
    expect((await pedir(carla, conversa)).status).toBe(403)
    configuracao.ia = { url: '', token: '', modelo: '' }
    expect((await pedir(bruno, conversa)).dados.error).toContain('IA não configurada')
  })

  test('erro do servidor de IA aparece; só quem pediu consulta', async () => {
    const conversa = await criarConversa(ana, [bruno])
    await criarPasta(ana, conversa, 'Qualquer')
    await enviarTexto(ana, conversa, 'mensagem')
    responder = () => new Response('modelo não encontrado', { status: 404 })
    const { dados } = await pedir(ana, conversa)
    expect((await chamar('GET', '/pastas/sugestao', { token: bruno.token, consulta: { id: dados.id } })).status).toBe(404)
    const pronto = await esperarPronto(ana, dados.id)
    expect(pronto.status).toBe('erro')
    expect(pronto.erro).not.toBe('')
    expect((await chamar('GET', '/pastas/sugestao', { token: ana.token, consulta: { id: 'nao-existe' } })).status).toBe(404)
  })

  test('o mesmo pedido em andamento não começa outro', async () => {
    const conversa = await criarConversa(ana, [bruno])
    await criarPasta(ana, conversa, 'Lenta')
    await enviarTexto(ana, conversa, 'mensagem')
    let liberar = () => {}
    responder = () => {
      const pronto = new Promise<Response>((resolve) => { liberar = () => resolve(respostaIa({ sugestoes: [] })) })
      return pronto as unknown as Response
    }
    const primeiro = (await pedir(ana, conversa)).dados
    const segundo = (await pedir(ana, conversa)).dados
    expect(segundo.id).toBe(primeiro.id)
    await Bun.sleep(50)
    liberar()
    expect((await esperarPronto(ana, primeiro.id)).status).toBe('concluido')
  })
})

describe('leitura da resposta da IA', () => {
  const mensagens = new Map([[1, { autor: 'Ana', texto: 'a'.repeat(300) }], [2, { autor: 'Bruno', texto: 'curta' }]])

  test('corta a prévia longa e mantém a ordem das mensagens', () => {
    const lidas = lerSugestoes({ sugestoes: [{ mensagem: 2, pasta: 5 }, { mensagem: '1', pasta: '5' }] }, mensagens, new Set([5]))
    expect(lidas.map((s) => s.mensagem_id)).toEqual([1, 2])
    expect(lidas[0]!.texto).toHaveLength(200)
    expect(lidas[0]!.texto.endsWith('…')).toBe(true)
  })

  test('formato errado vira erro', () => {
    expect(() => lerSugestoes({ outra: [] }, mensagens, new Set([5]))).toThrow('não veio no formato esperado')
    expect(lerSugestoes({ sugestoes: [null, { mensagem: 1 }] }, mensagens, new Set([5]))).toEqual([])
  })
})

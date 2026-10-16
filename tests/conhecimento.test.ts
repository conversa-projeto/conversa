import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { configuracao } from '../src/configuracao.ts'
import { esperarBots } from '../src/bots.ts'
import { dividirEmTrechos, esperarIndexacao, StatusDocumento } from '../src/conhecimento.ts'
import { chamar, criarConversa, criarUsuario, enviarTexto, noBanco, type UsuarioTeste } from './api.ts'

// Usa o Qdrant do Docker (127.0.0.1:6333) numa colecao propria dos testes,
// apagada no comeco, como o banco conversa_teste.
const COLECAO_TESTE = 'conversa_teste_conhecimento'

// Embedding de mentira e previsivel: cada palavra soma 1 numa das 64 posicoes.
// Textos com as mesmas palavras ficam parecidos, como num modelo de verdade.
function vetor(texto: string) {
  const v = new Array(64).fill(0)
  for (const palavra of texto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').match(/[a-z0-9]{3,}/g) ?? []) {
    let h = 0
    for (const c of palavra) h = (h * 31 + c.charCodeAt(0)) % 64
    v[h] += 1
  }
  return v.some(Boolean) ? v : v.map((_, i) => (i === 0 ? 1 : 0))
}

type PedidoChat = { messages: { role: string; content: string | null }[]; tools?: { function: { name: string; parameters: { properties: Record<string, unknown> } } }[] }
let respostasChat: ((pedido: PedidoChat) => Response)[] = []
const pedidosChat: PedidoChat[] = []
let embeddingsFalham = false
const ia = Bun.serve({
  port: 0,
  async fetch(req) {
    const corpo = await req.json()
    if (new URL(req.url).pathname.endsWith('/embeddings')) {
      if (embeddingsFalham) return new Response('modelo de embeddings não carregado', { status: 404 })
      return Response.json({ data: (corpo.input as string[]).map((texto, index) => ({ index, embedding: vetor(texto) })) })
    }
    pedidosChat.push(corpo)
    return (respostasChat.shift() ?? (() => Response.json({ choices: [{ message: { content: '' } }] })))(corpo)
  },
})

const anterior = { ia: { ...configuracao.ia }, embeddings: configuracao.iaModeloEmbeddings, colecao: configuracao.qdrant.colecao }
let cuidador: UsuarioTeste, criador: UsuarioTeste, comum: UsuarioTeste
beforeAll(async () => {
  configuracao.qdrant.colecao = COLECAO_TESTE
  await fetch(`${configuracao.qdrant.url}/collections/${COLECAO_TESTE}`, { method: 'DELETE' })
  ;[cuidador, criador, comum] = await Promise.all([criarUsuario('Cuidador Conhecimento'), criarUsuario('Criador Conhecimento'), criarUsuario('Comum Conhecimento')])
  await noBanco((sql) => sql`
    insert into permissao_usuario (usuario_id, permissao_id)
    select ${cuidador.id}::int, id from permissao where codigo in ('permissoes', 'conhecimento')
     union all
    select ${criador.id}::int, id from permissao where codigo = 'bots'
        on conflict do nothing`)
})
beforeEach(() => {
  pedidosChat.length = 0
  respostasChat = []
  embeddingsFalham = false
  configuracao.ia = { url: `http://localhost:${ia.port}`, token: '', modelo: 'teste' }
  configuracao.iaModeloEmbeddings = 'embeddings-teste'
})
afterAll(async () => {
  await fetch(`${configuracao.qdrant.url}/collections/${COLECAO_TESTE}`, { method: 'DELETE' })
  configuracao.ia = anterior.ia
  configuracao.iaModeloEmbeddings = anterior.embeddings
  configuracao.qdrant.colecao = anterior.colecao
  ia.stop(true)
})

const FERIAS = `Política de férias (RH-12)

Cada colaborador tem 30 dias de férias por ano, que podem ser divididos em até 3 períodos.

O pedido de férias deve ser feito no Portal do RH com 45 dias de antecedência e aprovado pelo gestor.`

const REEMBOLSO = `Política de reembolso (FIN-03)

Despesas de viagem são reembolsadas em até 10 dias, com a nota fiscal anexada no sistema financeiro.`

let sequencia = 0
async function novaBase(nome = `Base ${Date.now().toString(36)}${sequencia++}`) {
  const { status, dados } = await chamar('PUT', '/conhecimento/base', { token: cuidador.token, corpo: { nome, descricao: 'Políticas internas' } })
  expect(status).toBe(200)
  return dados as { id: number; nome: string }
}

async function subir(base: number, nome: string, texto: string) {
  const { status, dados } = await chamar('PUT', '/conhecimento/documento', { token: cuidador.token, corpo: { base_id: base, nome, texto } })
  expect(status).toBe(200)
  await esperarIndexacao()
  return dados as { id: number; status: number }
}

const documentos = async (base: number) =>
  (await chamar('GET', '/conhecimento/documentos', { token: cuidador.token, consulta: { base } })).dados as { id: number; nome: string; status: number; trechos: number; erro: string | null }[]

describe('trechos', () => {
  test('texto curto vira um trecho; parágrafos se juntam até o tamanho', () => {
    expect(dividirEmTrechos('Um parágrafo só.')).toEqual(['Um parágrafo só.'])
    expect(dividirEmTrechos('Primeiro.\n\nSegundo.', 1000)).toEqual(['Primeiro.\n\nSegundo.'])
  })

  test('texto longo é cortado perto do tamanho, e cada trecho começa com o fim do anterior', () => {
    const paragrafos = Array.from({ length: 30 }, (_, i) => `Parágrafo número ${i} com algumas palavras para encher o texto até passar do limite.`)
    const trechos = dividirEmTrechos(paragrafos.join('\n\n'), 300, 60)
    expect(trechos.length).toBeGreaterThan(5)
    for (const trecho of trechos) expect(trecho.length).toBeLessThanOrEqual(300 + 60 + 2)
    const fim = trechos[0]!.slice(-60)
    expect(trechos[1]!.startsWith(fim.slice(fim.indexOf(' ') + 1))).toBe(true)
  })

  test('parágrafo maior que o trecho é cortado por frase', () => {
    const frase = 'Esta é uma frase de tamanho médio. '
    const trechos = dividirEmTrechos(frase.repeat(40), 200, 0)
    expect(trechos.length).toBeGreaterThan(5)
    expect(trechos.every((t) => t.endsWith('.'))).toBe(true)
  })
})

describe('bases e documentos', () => {
  test('sem a permissão "conhecimento" não mexe nas bases (403); quem cria bots vê as disponíveis', async () => {
    expect((await chamar('GET', '/conhecimento/bases', { token: criador.token })).status).toBe(403)
    expect((await chamar('PUT', '/conhecimento/base', { token: criador.token, corpo: { nome: 'X' } })).status).toBe(403)
    const base = await novaBase()
    const disponiveis = (await chamar('GET', '/conhecimento/disponiveis', { token: criador.token })).dados as { id: number }[]
    expect(disponiveis.some((b) => b.id === base.id)).toBe(true)
    expect((await chamar('GET', '/conhecimento/disponiveis', { token: comum.token })).status).toBe(403)
  })

  test('nome repetido é recusado (400); sem o modelo de embeddings não sobe documento', async () => {
    const base = await novaBase()
    expect((await chamar('PUT', '/conhecimento/base', { token: cuidador.token, corpo: { nome: base.nome.toUpperCase() } })).status).toBe(400)
    configuracao.iaModeloEmbeddings = ''
    const recusa = await chamar('PUT', '/conhecimento/documento', { token: cuidador.token, corpo: { base_id: base.id, nome: 'x.txt', texto: 'algo' } })
    expect(recusa.status).toBe(400)
    expect(recusa.dados.error).toContain('modelo de embeddings')
  })

  test('sobe, indexa em segundo plano e a busca acha o trecho certo, com o documento de origem', async () => {
    const base = await novaBase()
    const criado = await chamar('PUT', '/conhecimento/documento', { token: cuidador.token, corpo: { base_id: base.id, nome: 'ferias.pdf', texto: FERIAS } })
    expect(criado.dados.status).toBe(StatusDocumento.Processando)
    await esperarIndexacao()
    await subir(base.id, 'reembolso.docx', REEMBOLSO)
    const lista = await documentos(base.id)
    expect(lista.map((d) => [d.nome, d.status])).toEqual([['reembolso.docx', StatusDocumento.Pronto], ['ferias.pdf', StatusDocumento.Pronto]])
    expect(lista.every((d) => d.trechos > 0)).toBe(true)

    const { dados: achados } = await chamar('POST', '/conhecimento/buscar', { token: cuidador.token, corpo: { bases: [base.id], pergunta: 'quantos dias de férias e antecedência do pedido', limite: 2 } })
    expect(achados[0].documento).toBe('ferias.pdf')
    expect(achados[0].texto).toContain('45 dias de antecedência')
    expect(achados[0].nota).toBeGreaterThan(achados[1].nota)

    const bases = (await chamar('GET', '/conhecimento/bases', { token: cuidador.token })).dados as { id: number; documentos: number }[]
    expect(bases.find((b) => b.id === base.id)!.documentos).toBe(2)
  })

  test('a busca fica na base pedida', async () => {
    const [rh, financeiro] = [await novaBase(), await novaBase()]
    await subir(rh.id, 'ferias.txt', FERIAS)
    await subir(financeiro.id, 'reembolso.txt', REEMBOLSO)
    const { dados } = await chamar('POST', '/conhecimento/buscar', { token: cuidador.token, corpo: { bases: [financeiro.id], pergunta: 'férias' } })
    expect((dados as { documento: string }[]).every((t) => t.documento === 'reembolso.txt')).toBe(true)
  })

  test('falha nos embeddings deixa o documento com erro e o motivo', async () => {
    const base = await novaBase()
    embeddingsFalham = true
    const documento = await subir(base.id, 'ferias.txt', FERIAS)
    const [lido] = (await documentos(base.id)).filter((d) => d.id === documento.id)
    expect(lido!.status).toBe(StatusDocumento.Erro)
    expect(lido!.erro).toContain('modelo de embeddings não carregado')
  })

  test('excluir documento e base tira os trechos da busca', async () => {
    const base = await novaBase()
    const documento = await subir(base.id, 'ferias.txt', FERIAS)
    const buscar = async () => (await chamar('POST', '/conhecimento/buscar', { token: cuidador.token, corpo: { bases: [base.id], pergunta: 'férias' } })).dados as unknown[]
    expect((await buscar()).length).toBeGreaterThan(0)
    expect((await chamar('DELETE', '/conhecimento/documento', { token: cuidador.token, consulta: { id: documento.id } })).status).toBe(200)
    expect(await buscar()).toEqual([])
    await subir(base.id, 'ferias.txt', FERIAS)
    expect((await chamar('DELETE', '/conhecimento/base', { token: cuidador.token, consulta: { id: base.id } })).status).toBe(200)
    expect(await buscar()).toEqual([])
  })

  test('reindexar tudo indexa de novo todos os documentos', async () => {
    const base = await novaBase()
    await subir(base.id, 'ferias.txt', FERIAS)
    const { dados } = await chamar('POST', '/conhecimento/reindexar', { token: cuidador.token })
    expect(dados.documentos).toBeGreaterThan(0)
    await esperarIndexacao()
    expect((await documentos(base.id))[0]!.status).toBe(StatusDocumento.Pronto)
    const { dados: achados } = await chamar('POST', '/conhecimento/buscar', { token: cuidador.token, corpo: { bases: [base.id], pergunta: 'férias' } })
    expect(achados.length).toBeGreaterThan(0)
  })
})

describe('bot com base de conhecimento', () => {
  test('consulta a base ligada e responde com o trecho', async () => {
    const [rh, financeiro] = [await novaBase('RH ' + Date.now()), await novaBase('Financeiro ' + Date.now())]
    await subir(rh.id, 'ferias.pdf', FERIAS)
    await subir(financeiro.id, 'reembolso.pdf', REEMBOLSO)
    const { dados: bot } = await chamar('PUT', '/bot', { token: criador.token, corpo: { nome: 'Assistente RH', instrucoes: 'Responde dúvidas de RH.' } })
    const ligado = await chamar('PUT', '/bot/conhecimento', { token: criador.token, corpo: { id: bot.id, bases: [rh.id, financeiro.id] } })
    expect(ligado.dados.bases).toEqual([rh.id, financeiro.id].sort((a, b) => a - b))
    const conversa = await criarConversa(comum, [{ id: bot.usuario_id } as UsuarioTeste])

    respostasChat = [
      () => Response.json({ choices: [{ message: { content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'consultar_conhecimento', arguments: JSON.stringify({ pergunta: 'antecedência do pedido de férias', base: rh.nome }) } }] } }] }),
      () => Response.json({ choices: [{ message: { content: 'Peça com 45 dias de antecedência (Política de férias).' } }] }),
    ]
    await enviarTexto(comum, conversa, 'Com quanta antecedência peço férias?')
    await esperarBots()

    const ferramenta = pedidosChat[0]!.tools!.find((t) => t.function.name === 'consultar_conhecimento')!
    expect(Object.keys(ferramenta.function.parameters.properties)).toEqual(['pergunta', 'base'])
    expect(pedidosChat[0]!.messages[0]!.content).toContain('use consultar_conhecimento')
    const resultado = JSON.parse(pedidosChat[1]!.messages.find((m) => m.role === 'tool')!.content!) as { ok: boolean; trechos: { documento: string; texto: string }[] }
    expect(resultado.ok).toBe(true)
    expect(resultado.trechos.every((t) => t.documento === 'ferias.pdf')).toBe(true)
    expect(resultado.trechos[0]!.texto).toContain('45 dias de antecedência')
  })

  test('sem o modelo de embeddings a ferramenta não é oferecida', async () => {
    const base = await novaBase()
    const { dados: bot } = await chamar('PUT', '/bot', { token: criador.token, corpo: { nome: 'Sem Embeddings', instrucoes: 'Ajuda.' } })
    await chamar('PUT', '/bot/conhecimento', { token: criador.token, corpo: { id: bot.id, bases: [base.id] } })
    const conversa = await criarConversa(comum, [{ id: bot.usuario_id } as UsuarioTeste])
    configuracao.iaModeloEmbeddings = ''
    respostasChat = [() => Response.json({ choices: [{ message: { content: 'Oi' } }] })]
    await enviarTexto(comum, conversa, 'Oi')
    await esperarBots()
    expect(pedidosChat[0]!.tools!.some((t) => t.function.name === 'consultar_conhecimento')).toBe(false)
  })
})

describe('prefixos dos modelos de embeddings', () => {
  test('nomic e e5 recebem o prefixo de pergunta e de documento; os outros, nada', async () => {
    const { prefixoEmbeddings } = await import('../src/ia.ts')
    expect(prefixoEmbeddings('text-embedding-nomic-embed-text-v1.5', 'pergunta')).toBe('search_query: ')
    expect(prefixoEmbeddings('nomic-embed-text', 'documento')).toBe('search_document: ')
    expect(prefixoEmbeddings('intfloat/multilingual-e5-large', 'pergunta')).toBe('query: ')
    expect(prefixoEmbeddings('e5-base', 'documento')).toBe('passage: ')
    expect(prefixoEmbeddings('text-embedding-3-small', 'pergunta')).toBe('')
  })
})

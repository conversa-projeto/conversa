import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { configuracao } from '../src/configuracao.ts'
import { esperarBots } from '../src/bots.ts'
import { chamar, criarConversa, criarUsuario, enviarTexto, noBanco, type UsuarioTeste } from './api.ts'

// API externa de mentira: guarda cada pedido e responde o que o teste mandar
type PedidoExterno = { metodo: string; caminho: string; consulta: Record<string, string>; corpo: unknown; autorizacao: string | null }
const externos: PedidoExterno[] = []
let respostaExterna: () => Response = () => Response.json({ trechos: ['O prazo de entrega é de 5 dias úteis.'] })
const api = Bun.serve({
  port: 0,
  async fetch(req) {
    const url = new URL(req.url)
    const texto = req.method === 'POST' ? await req.text() : ''
    externos.push({
      metodo: req.method,
      caminho: url.pathname,
      consulta: Object.fromEntries(url.searchParams),
      corpo: texto ? JSON.parse(texto) : null,
      autorizacao: req.headers.get('authorization'),
    })
    return respostaExterna()
  },
})
const base = `http://localhost:${api.port}`

// Servidor de IA de mentira, pedido a pedido
type PedidoIa = { messages: { role: string; content: string | null }[]; tools?: { function: { name: string; parameters: { properties: object; required: string[] } } }[] }
let respostasIa: ((pedido: PedidoIa) => Response)[] = []
const pedidosIa: PedidoIa[] = []
const ia = Bun.serve({
  port: 0,
  async fetch(req) {
    const pedido = await req.json() as PedidoIa
    pedidosIa.push(pedido)
    return (respostasIa.shift() ?? (() => Response.json({ choices: [{ message: { content: '' } }] })))(pedido)
  },
})

const anterior = { ...configuracao.ia }
let admin: UsuarioTeste, criador: UsuarioTeste, comum: UsuarioTeste
beforeAll(async () => {
  ;[admin, criador, comum] = await Promise.all([criarUsuario('Admin Ferramentas'), criarUsuario('Criador Ferramentas'), criarUsuario('Comum Ferramentas')])
  await noBanco((sql) => sql`
    insert into permissao_usuario (usuario_id, permissao_id)
    select ${admin.id}::int, id from permissao where codigo in ('permissoes', 'ferramentas')
     union all
    select ${criador.id}::int, id from permissao where codigo = 'bots'
        on conflict do nothing`)
})
beforeEach(() => {
  externos.length = 0
  pedidosIa.length = 0
  respostasIa = []
  respostaExterna = () => Response.json({ trechos: ['O prazo de entrega é de 5 dias úteis.'] })
  configuracao.ia = { url: `http://localhost:${ia.port}`, token: '', modelo: 'teste' }
})
afterAll(() => {
  configuracao.ia = anterior
  api.stop(true)
  ia.stop(true)
})

let sequencia = 0
const conhecimento = (extras: Record<string, unknown> = {}) => ({
  nome: `consultar_conhecimento_${Date.now().toString(36)}${sequencia++}`,
  descricao: 'Busca na base de conhecimento da empresa trechos que respondem à pergunta.',
  metodo: 'GET',
  url: `${base}/colecoes/{colecao}/buscar`,
  cabecalhos: [{ nome: 'Authorization', valor: 'Bearer segredo-da-base' }],
  parametros: [
    { nome: 'colecao', tipo: 'string', descricao: 'Coleção', obrigatorio: true },
    { nome: 'pergunta', tipo: 'string', descricao: 'O que procurar', obrigatorio: true },
    { nome: 'limite', tipo: 'number', descricao: '', obrigatorio: false },
  ],
  ...extras,
})

async function criar(extras: Record<string, unknown> = {}) {
  const { status, dados } = await chamar('PUT', '/ferramenta', { token: admin.token, corpo: conhecimento(extras) })
  expect(status).toBe(200)
  return dados as { id: number; nome: string; cabecalhos: string[] }
}

describe('cadastro de ferramentas', () => {
  test('sem a permissão "ferramentas" não lista nem cria (403); quem cria bots vê só nome e descrição', async () => {
    expect((await chamar('GET', '/ferramentas', { token: criador.token })).status).toBe(403)
    expect((await chamar('PUT', '/ferramenta', { token: criador.token, corpo: conhecimento() })).status).toBe(403)
    const ferramenta = await criar()
    const disponiveis = (await chamar('GET', '/ferramentas/disponiveis', { token: criador.token })).dados as Record<string, unknown>[]
    expect(disponiveis.find((f) => f.id === ferramenta.id)).toEqual({ id: ferramenta.id, nome: ferramenta.nome, descricao: conhecimento().descricao })
    expect((await chamar('GET', '/ferramentas/disponiveis', { token: comum.token })).status).toBe(403)
  })

  test('o valor dos cabeçalhos nunca volta; editar com o valor vazio mantém o salvo', async () => {
    const ferramenta = await criar()
    expect(ferramenta.cabecalhos).toEqual(['Authorization'])
    const lista = (await chamar('GET', '/ferramentas', { token: admin.token })).dados
    expect(JSON.stringify(lista)).not.toContain('segredo-da-base')
    const editada = await chamar('PATCH', '/ferramenta', {
      token: admin.token,
      corpo: { id: ferramenta.id, ...conhecimento({ nome: ferramenta.nome, descricao: 'Nova descrição', cabecalhos: [{ nome: 'Authorization', valor: '' }] }) },
    })
    expect(editada.dados).toMatchObject({ descricao: 'Nova descrição', cabecalhos: ['Authorization'] })
    await chamar('POST', '/ferramenta/testar', { token: admin.token, corpo: { id: ferramenta.id, argumentos: { colecao: 'vendas', pergunta: 'prazo' } } })
    expect(externos[0]!.autorizacao).toBe('Bearer segredo-da-base')
  })

  test('valida nome, nome do chat, endereço e {parametro} sem cadastro (400)', async () => {
    const recusa = async (extras: Record<string, unknown>, trecho: string) => {
      const { status, dados } = await chamar('PUT', '/ferramenta', { token: admin.token, corpo: conhecimento(extras) })
      expect(status).toBe(400)
      expect(dados.error).toContain(trecho)
    }
    await recusa({ nome: 'Consultar Base' }, 'Nome inválido')
    await recusa({ nome: 'reagir' }, 'próprio chat')
    await recusa({ url: 'ftp://base/buscar' }, 'http')
    await recusa({ url: `${base}/{outra}/buscar` }, '{outra}')
    const criada = await criar()
    await recusa({ nome: criada.nome }, 'Já existe')
  })

  test('testar: GET com o parâmetro na URL e o resto na consulta; POST manda no corpo JSON', async () => {
    const get = await criar()
    const teste = await chamar('POST', '/ferramenta/testar', { token: admin.token, corpo: { id: get.id, argumentos: { colecao: 'vendas e compras', pergunta: 'prazo', limite: '3' } } })
    expect(teste.dados).toMatchObject({ ok: true, status: 200, resposta: '{"trechos":["O prazo de entrega é de 5 dias úteis."]}' })
    expect(externos[0]).toMatchObject({ metodo: 'GET', caminho: '/colecoes/vendas%20e%20compras/buscar', consulta: { pergunta: 'prazo', limite: '3' } })

    const post = await criar({ metodo: 'POST', url: `${base}/buscar`, parametros: [{ nome: 'pergunta', tipo: 'string', descricao: '', obrigatorio: true }, { nome: 'limite', tipo: 'number', descricao: '', obrigatorio: false }] })
    await chamar('POST', '/ferramenta/testar', { token: admin.token, corpo: { id: post.id, argumentos: { pergunta: 'prazo', limite: 2 } } })
    expect(externos[1]).toMatchObject({ metodo: 'POST', caminho: '/buscar', corpo: { pergunta: 'prazo', limite: 2 } })

    const faltando = await chamar('POST', '/ferramenta/testar', { token: admin.token, corpo: { id: get.id, argumentos: { colecao: 'vendas' } } })
    expect(faltando.dados).toMatchObject({ ok: false, erro: 'Faltou o parâmetro pergunta.' })
  })

  test('a embutida da base de conhecimento vem como exemplo, com a definição que o modelo recebe', async () => {
    expect((await chamar('GET', '/ferramentas/embutidas', { token: criador.token })).status).toBe(403)
    const { status, dados } = await chamar('GET', '/ferramentas/embutidas', { token: admin.token })
    expect(status).toBe(200)
    const [conhecimento] = dados as { nome: string; descricao: string; origem: string; parametros: { nome: string; obrigatorio: boolean }[]; definicao: { function: { name: string; description: string; parameters: { required: string[] } } } }[]
    expect(conhecimento!.nome).toBe('consultar_conhecimento')
    expect(conhecimento!.origem).toContain('Não chama endereço externo')
    expect(conhecimento!.parametros.map((p) => [p.nome, p.obrigatorio])).toEqual([['pergunta', true], ['base', false]])
    expect(conhecimento!.definicao.function.name).toBe('consultar_conhecimento')
    expect(conhecimento!.definicao.function.description).toBe(conhecimento!.descricao)
    expect(conhecimento!.definicao.function.parameters.required).toEqual(['pergunta'])
  })

  test('excluir tira a ferramenta dos bots', async () => {
    const ferramenta = await criar()
    const { dados: bot } = await chamar('PUT', '/bot', { token: criador.token, corpo: { nome: 'Com Ferramenta', instrucoes: 'Ajuda.' } })
    await chamar('PUT', '/bot/ferramentas', { token: criador.token, corpo: { id: bot.id, ferramentas: [ferramenta.id] } })
    expect((await chamar('DELETE', '/ferramenta', { token: admin.token, consulta: { id: ferramenta.id } })).status).toBe(200)
    const bots = (await chamar('GET', '/bots', { token: criador.token })).dados as { id: number; ferramentas: number[] }[]
    expect(bots.find((b) => b.id === bot.id)!.ferramentas).toEqual([])
  })
})

describe('bot com ferramenta externa', () => {
  test('o modelo recebe a ferramenta, o servidor chama a API e o resultado volta ao modelo para responder', async () => {
    const ferramenta = await criar()
    const { dados: bot } = await chamar('PUT', '/bot', { token: criador.token, corpo: { nome: 'Atendente RAG', instrucoes: 'Responde dúvidas de entrega.' } })
    const ligado = await chamar('PUT', '/bot/ferramentas', { token: criador.token, corpo: { id: bot.id, ferramentas: [ferramenta.id] } })
    expect(ligado.dados.ferramentas).toEqual([ferramenta.id])
    const conversa = await criarConversa(comum, [{ id: bot.usuario_id } as UsuarioTeste])

    respostasIa = [
      () => Response.json({ choices: [{ message: { content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: ferramenta.nome, arguments: JSON.stringify({ colecao: 'entregas', pergunta: 'qual o prazo?' }) } }] } }] }),
      () => Response.json({ choices: [{ message: { content: 'O prazo de entrega é de 5 dias úteis.' } }] }),
    ]
    await enviarTexto(comum, conversa, 'Qual o prazo de entrega?')
    await esperarBots()

    const oferecida = pedidosIa[0]!.tools!.find((t) => t.function.name === ferramenta.nome)!
    expect(oferecida.function.parameters.required).toEqual(['colecao', 'pergunta'])
    expect(pedidosIa[0]!.messages[0]!.content).toContain(`use as ferramentas ${ferramenta.nome}`)
    expect(externos[0]).toMatchObject({ caminho: '/colecoes/entregas/buscar', consulta: { pergunta: 'qual o prazo?' }, autorizacao: 'Bearer segredo-da-base' })
    const resultado = pedidosIa[1]!.messages.find((m) => m.role === 'tool')!
    expect(JSON.parse(resultado.content!)).toEqual({ ok: true, resposta: '{"trechos":["O prazo de entrega é de 5 dias úteis."]}' })
    expect(JSON.stringify(pedidosIa)).not.toContain('segredo-da-base')
    const [resposta] = await noBanco((sql) => sql<{ conteudo: string }[]>`
      select convert_from(mc.conteudo, 'utf-8') as conteudo
        from mensagem m inner join mensagem_conteudo mc on mc.mensagem_id = m.id
       where m.conversa_id = ${conversa} and m.usuario_id = ${bot.usuario_id}`)
    expect(resposta!.conteudo).toBe('O prazo de entrega é de 5 dias úteis.')
  })

  test('erro da API externa volta ao modelo como erro, sem derrubar o bot', async () => {
    const ferramenta = await criar()
    const { dados: bot } = await chamar('PUT', '/bot', { token: criador.token, corpo: { nome: 'Atendente Erro', instrucoes: 'Ajuda.' } })
    await chamar('PUT', '/bot/ferramentas', { token: criador.token, corpo: { id: bot.id, ferramentas: [ferramenta.id] } })
    const conversa = await criarConversa(comum, [{ id: bot.usuario_id } as UsuarioTeste])
    respostaExterna = () => new Response('base fora do ar', { status: 502 })
    respostasIa = [
      () => Response.json({ choices: [{ message: { content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: ferramenta.nome, arguments: JSON.stringify({ colecao: 'x', pergunta: 'y' }) } }] } }] }),
      () => Response.json({ choices: [{ message: { content: 'Não consegui consultar a base agora.' } }] }),
    ]
    await enviarTexto(comum, conversa, 'Pergunta')
    await esperarBots()
    const resultado = pedidosIa[1]!.messages.find((m) => m.role === 'tool')!
    expect(JSON.parse(resultado.content!)).toEqual({ erro: 'A ferramenta respondeu 502: base fora do ar' })
  })
})

import { configuracao } from './configuracao.ts'
import { httpErrors } from './erros.ts'

// Cliente de IA no padrao da OpenAI (POST /v1/chat/completions), que vLLM,
// Ollama e a propria OpenAI aceitam. O endereco pode vir com ou sem o /v1.

export interface ServidorIa {
  url: string
  token: string
  modelo: string
}

export interface MensagemIa {
  role: 'system' | 'user' | 'assistant'
  content: string
}

// Modelo local pode levar bastante para responder uma conversa longa
const TEMPO_LIMITE_MS = 5 * 60 * 1000

export function iaConfigurada() {
  return configuracao.ia.url.trim() !== '' && configuracao.ia.modelo.trim() !== ''
}

export function enderecoCompletions(url: string) {
  const base = url.trim().replace(/\/+$/, '')
  return `${/\/v1$/.test(base) ? base : `${base}/v1`}/chat/completions`
}

// Formato da resposta em JSON Schema (response_format json_schema), que vLLM,
// Ollama, LM Studio e OpenAI aceitam
export interface EsquemaResposta {
  nome: string
  schema: object
}

export interface OpcoesCompletar {
  esquema?: EsquemaResposta
  servidor?: ServidorIa
  tempoLimiteMs?: number
  // Limite da resposta, em tokens
  maxTokens?: number
  // Modelo que "pensa" antes (Gemma 4, Qwen 3...) responde direto: para
  // sugestoes, o raciocinio levaria dezenas de segundos
  semRaciocinio?: boolean
  // Quem pediu desistiu (a pagina cancelou): o pedido ao modelo para junto
  sinal?: AbortSignal
}

// Pede uma resposta ao modelo; com esquema, pede JSON nesse formato. Servidor
// que recusar os extras (formato JSON, desligar o raciocinio) com 400 recebe o
// pedido de novo sem eles: as instrucoes ja pedem JSON e lerJson aceita texto em volta.
export async function completar(mensagens: MensagemIa[], opcoes: OpcoesCompletar = {}): Promise<string> {
  const servidor = opcoes.servidor ?? configuracao.ia
  if (!servidor.url.trim() || !servidor.modelo.trim()) {
    throw httpErrors.badRequest('IA não configurada: defina o endereço e o modelo nas configurações do sistema.')
  }
  const extras = {
    ...(opcoes.esquema
      ? { response_format: { type: 'json_schema', json_schema: { name: opcoes.esquema.nome, strict: true, schema: opcoes.esquema.schema } } }
      : {}),
    ...(opcoes.semRaciocinio ? { reasoning_effort: 'none' } : {}),
  }
  const temExtras = Object.keys(extras).length > 0
  const tempo = AbortSignal.timeout(opcoes.tempoLimiteMs ?? TEMPO_LIMITE_MS)
  const pedir = (comExtras: boolean) => fetch(enderecoCompletions(servidor.url), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(servidor.token.trim() ? { Authorization: `Bearer ${servidor.token.trim()}` } : {}),
    },
    body: JSON.stringify({
      model: servidor.modelo.trim(),
      messages: mensagens,
      temperature: 0.2,
      stream: false,
      ...(opcoes.maxTokens ? { max_tokens: opcoes.maxTokens } : {}),
      ...(comExtras ? extras : {}),
    }),
    signal: opcoes.sinal ? AbortSignal.any([tempo, opcoes.sinal]) : tempo,
  })
  let resposta: Response
  try {
    resposta = await pedir(true)
    if (resposta.status === 400 && temExtras) {
      console.warn('[IA] Servidor recusou o formato JSON ou o raciocínio desligado, pedindo sem eles:', (await resposta.text()).slice(0, 200))
      resposta = await pedir(false)
    }
  } catch (erro) {
    if (opcoes.sinal?.aborted) throw new Error('Pedido cancelado.')
    const esgotado = erro instanceof Error && erro.name === 'TimeoutError'
    throw new Error(esgotado ? 'O servidor de IA demorou demais para responder.' : `Não foi possível falar com o servidor de IA (${erro instanceof Error ? erro.message : erro}).`)
  }
  if (!resposta.ok) {
    const detalhe = (await resposta.text()).slice(0, 300)
    throw new Error(`O servidor de IA respondeu ${resposta.status}${detalhe ? `: ${detalhe}` : ''}`)
  }
  const dados = await resposta.json() as { choices?: { message?: { content?: string | null } }[] }
  const texto = dados.choices?.[0]?.message?.content
  if (typeof texto !== 'string' || !texto.trim()) {
    throw new Error('O servidor de IA não devolveu texto.')
  }
  return texto
}

// O modelo as vezes cerca o JSON com ```json ou texto em volta: pega do primeiro { ao ultimo }
export function lerJson(texto: string): unknown {
  const inicio = texto.indexOf('{')
  const fim = texto.lastIndexOf('}')
  if (inicio < 0 || fim < inicio) {
    throw new Error('A resposta da IA não veio no formato esperado.')
  }
  try {
    return JSON.parse(texto.slice(inicio, fim + 1))
  } catch {
    throw new Error('A resposta da IA não veio no formato esperado.')
  }
}

// --- Ferramentas (function calling no padrao da OpenAI), para os bots ---

export interface ChamadaFerramenta {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export type MensagemComFerramentas =
  | MensagemIa
  | { role: 'assistant'; content: string | null; tool_calls: ChamadaFerramenta[] }
  | { role: 'tool'; tool_call_id: string; content: string }

export interface Ferramenta {
  type: 'function'
  function: { name: string; description: string; parameters: object }
}

export interface RespostaComFerramentas {
  texto: string
  chamadas: ChamadaFerramenta[]
}

// Como completar, mas o modelo pode pedir ferramentas em vez de (ou junto com)
// o texto. Servidor que recusar as ferramentas com 400 recebe o pedido sem elas:
// o bot ao menos responde em texto.
export async function completarComFerramentas(
  mensagens: MensagemComFerramentas[],
  ferramentas: Ferramenta[],
  opcoes: { servidor?: ServidorIa; tempoLimiteMs?: number; maxTokens?: number } = {},
): Promise<RespostaComFerramentas> {
  const servidor = opcoes.servidor ?? configuracao.ia
  if (!servidor.url.trim() || !servidor.modelo.trim()) {
    throw httpErrors.badRequest('IA não configurada: defina o endereço e o modelo nas configurações do sistema.')
  }
  const tempo = AbortSignal.timeout(opcoes.tempoLimiteMs ?? TEMPO_LIMITE_MS)
  const pedir = (comFerramentas: boolean) => fetch(enderecoCompletions(servidor.url), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(servidor.token.trim() ? { Authorization: `Bearer ${servidor.token.trim()}` } : {}),
    },
    body: JSON.stringify({
      model: servidor.modelo.trim(),
      messages: mensagens,
      temperature: 0.4,
      stream: false,
      ...(opcoes.maxTokens ? { max_tokens: opcoes.maxTokens } : {}),
      ...(comFerramentas && ferramentas.length ? { tools: ferramentas, tool_choice: 'auto' } : {}),
    }),
    signal: tempo,
  })
  let resposta: Response
  try {
    resposta = await pedir(true)
    if (resposta.status === 400 && ferramentas.length) {
      console.warn('[IA] Servidor recusou as ferramentas, pedindo sem elas:', (await resposta.text()).slice(0, 200))
      resposta = await pedir(false)
    }
  } catch (erro) {
    const esgotado = erro instanceof Error && erro.name === 'TimeoutError'
    throw new Error(esgotado ? 'O servidor de IA demorou demais para responder.' : `Não foi possível falar com o servidor de IA (${erro instanceof Error ? erro.message : erro}).`)
  }
  if (!resposta.ok) {
    const detalhe = (await resposta.text()).slice(0, 300)
    throw new Error(`O servidor de IA respondeu ${resposta.status}${detalhe ? `: ${detalhe}` : ''}`)
  }
  const dados = await resposta.json() as { choices?: { message?: { content?: string | null; tool_calls?: ChamadaFerramenta[] | null } }[] }
  const mensagem = dados.choices?.[0]?.message
  return {
    texto: typeof mensagem?.content === 'string' ? mensagem.content : '',
    chamadas: (mensagem?.tool_calls ?? []).filter((chamada) => chamada?.function?.name),
  }
}

// --- Embeddings (POST /v1/embeddings), para a base de conhecimento ---

// Modelos treinados com um prefixo que diz se o texto e a pergunta ou o
// documento: sem ele, os resultados ficam bem piores
const PREFIXOS_EMBEDDINGS: [RegExp, { pergunta: string; documento: string }][] = [
  [/nomic-embed/i, { pergunta: 'search_query: ', documento: 'search_document: ' }],
  [/(^|[/-])e5[-_]/i, { pergunta: 'query: ', documento: 'passage: ' }],
]

export function prefixoEmbeddings(modelo: string, tipo: 'pergunta' | 'documento') {
  return PREFIXOS_EMBEDDINGS.find(([padrao]) => padrao.test(modelo))?.[1][tipo] ?? ''
}

// Vetor de cada texto, na mesma ordem, com o modelo de embeddings do sistema
export async function gerarEmbeddings(textos: string[], opcoes: { tempoLimiteMs?: number; tipo?: 'pergunta' | 'documento' } = {}): Promise<number[][]> {
  const servidor = configuracao.ia
  const modelo = configuracao.iaModeloEmbeddings
  if (!servidor.url.trim() || !modelo) {
    throw httpErrors.badRequest('Base de conhecimento desligada: defina o servidor de IA e o modelo de embeddings nas configurações do sistema.')
  }
  const endereco = enderecoCompletions(servidor.url).replace(/\/chat\/completions$/, '/embeddings')
  let resposta: Response
  try {
    resposta = await fetch(endereco, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(servidor.token.trim() ? { Authorization: `Bearer ${servidor.token.trim()}` } : {}),
      },
      body: JSON.stringify({ model: modelo, input: textos.map((texto) => prefixoEmbeddings(modelo, opcoes.tipo ?? 'documento') + texto) }),
      signal: AbortSignal.timeout(opcoes.tempoLimiteMs ?? TEMPO_LIMITE_MS),
    })
  } catch (erro) {
    const esgotado = erro instanceof Error && erro.name === 'TimeoutError'
    throw new Error(esgotado ? 'O servidor de IA demorou demais para gerar os embeddings.' : `Não foi possível falar com o servidor de IA (${erro instanceof Error ? erro.message : erro}).`)
  }
  if (!resposta.ok) {
    const detalhe = (await resposta.text()).slice(0, 300)
    throw new Error(`O servidor de IA respondeu ${resposta.status} aos embeddings${detalhe ? `: ${detalhe}` : ''}`)
  }
  const dados = await resposta.json() as { data?: { index?: number; embedding?: number[] }[] }
  const itens = [...(dados.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
  if (itens.length !== textos.length || itens.some((item) => !Array.isArray(item.embedding) || !item.embedding.length)) {
    throw new Error('O servidor de IA não devolveu os embeddings.')
  }
  return itens.map((item) => item.embedding!)
}

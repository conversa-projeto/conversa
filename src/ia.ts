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

// Pede uma resposta ao modelo; com json, pede um objeto JSON (e confere)
export async function completar(mensagens: MensagemIa[], opcoes: { json?: boolean; servidor?: ServidorIa; tempoLimiteMs?: number } = {}): Promise<string> {
  const servidor = opcoes.servidor ?? configuracao.ia
  if (!servidor.url.trim() || !servidor.modelo.trim()) {
    throw httpErrors.badRequest('IA não configurada: defina o endereço e o modelo nas configurações do sistema.')
  }
  let resposta: Response
  try {
    resposta = await fetch(enderecoCompletions(servidor.url), {
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
        ...(opcoes.json ? { response_format: { type: 'json_object' } } : {}),
      }),
      signal: AbortSignal.timeout(opcoes.tempoLimiteMs ?? TEMPO_LIMITE_MS),
    })
  } catch (erro) {
    const tempo = erro instanceof Error && erro.name === 'TimeoutError'
    throw new Error(tempo ? 'O servidor de IA demorou demais para responder.' : `Não foi possível falar com o servidor de IA (${erro instanceof Error ? erro.message : erro}).`)
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

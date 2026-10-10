import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { configuracao } from '../src/configuracao.ts'
import { continuacao, separarFim } from '../src/sugestoes.ts'
import { chamar, criarConversa, enviarTexto, usuariosComuns, type UsuarioTeste } from './api.ts'

let ana: UsuarioTeste, bruno: UsuarioTeste, carla: UsuarioTeste
beforeAll(async () => ({ ana, bruno, carla } = await usuariosComuns()))

// Servidor no padrão da OpenAI de mentira; cada teste diz o que ele responde
let responder: (corpo: Record<string, unknown>) => Response = () => new Response('', { status: 500 })
const pedidos: Record<string, unknown>[] = []
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

const respostaIa = (conteudo: string) => Response.json({ choices: [{ message: { content: conteudo } }] })
const sugerir = (quem: UsuarioTeste, conversa: number, texto: string) =>
  chamar('POST', '/ia/sugestao', { token: quem.token, corpo: { conversa_id: conversa, texto } })

describe('sugestão do campo de mensagem', () => {
  test('continua o texto pelo contexto da conversa, rápido e sem raciocínio', async () => {
    const conversa = await criarConversa(ana, [bruno])
    await enviarTexto(ana, conversa, 'O servidor novo chegou?')
    await enviarTexto(bruno, conversa, 'Ainda não, a transportadora atrasou.')
    responder = () => respostaIa('Ok, então vamos aguardar até segunda.')
    const { status, dados } = await sugerir(ana, conversa, 'Ok, então vamos')
    expect(status).toBe(200)
    expect(dados).toEqual({ sugestao: ' aguardar até segunda.' })
    const pedido = pedidos[0] as { messages: { content: string }[]; reasoning_effort: string; max_tokens: number }
    expect(pedido.reasoning_effort).toBe('none')
    expect(pedido.max_tokens).toBeGreaterThan(0)
    expect(pedido.messages[1]!.content).toContain('Bruno: Ainda não, a transportadora atrasou.')
    expect(pedido.messages[1]!.content).toContain('(você): O servidor novo chegou?')
    expect(pedido.messages[1]!.content).toContain('Trecho final digitado até agora: Ok, então vamos')
  })

  test('servidor que não aceita desligar o raciocínio recebe o pedido sem isso', async () => {
    const conversa = await criarConversa(ana, [bruno])
    responder = (corpo) => 'reasoning_effort' in corpo ? new Response('campo desconhecido', { status: 400 }) : respostaIa('Bom dia a todos!')
    expect((await sugerir(ana, conversa, 'Bom dia')).dados).toEqual({ sugestao: ' a todos!' })
    expect(pedidos).toHaveLength(2)
  })

  test('falha da IA ou texto vazio só não sugerem nada; quem está fora recebe 403', async () => {
    const conversa = await criarConversa(ana, [bruno])
    responder = () => new Response('', { status: 500 })
    expect((await sugerir(ana, conversa, 'Olá')).dados).toEqual({ sugestao: '' })
    expect((await sugerir(ana, conversa, '   ')).dados).toEqual({ sugestao: '' })
    expect((await sugerir(carla, conversa, 'Olá')).status).toBe(403)
    configuracao.ia = { url: '', token: '', modelo: '' }
    expect((await sugerir(ana, conversa, 'Olá')).status).toBe(400)
  })
})

describe('encaixe da continuação', () => {
  test('palavra inteira, com e sem espaço no fim, e palavra pela metade', () => {
    expect(continuacao('Ok, então vamos', 'Ok, então vamos aguardar.')).toBe(' aguardar.')
    expect(continuacao('Ok, então vamos ', 'Ok, então vamos aguardar.')).toBe('aguardar.')
    expect(continuacao('vou avisar o pes', 'vou avisar o pessoal que vai atrasar.')).toBe('soal que vai atrasar.')
  })

  test('aspas e linhas a mais saem; sem repetir o trecho não há como encaixar', () => {
    expect(continuacao('Bom dia', '"Bom dia a todos!"\nOutra linha')).toBe(' a todos!')
    expect(continuacao('Bom dia', 'bom dia a todos')).toBe(' a todos')
    expect(continuacao('vou avisar o pes', 'soal que vai atrasar.')).toBe('')
    expect(continuacao('Bom dia', 'Bom dia')).toBe('')
  })

  test('texto longo: só o fim, começando numa palavra, é repetido', () => {
    const digitado = `${'palavra '.repeat(30)}final do texto`
    const { inicio, fim } = separarFim(digitado)
    expect(fim.length).toBeLessThanOrEqual(120)
    expect(fim.endsWith('final do texto')).toBe(true)
    expect(fim.startsWith('palavra')).toBe(true)
    expect(`${inicio} ${fim}`).toBe(digitado)
  })
})

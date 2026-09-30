import { beforeAll, describe, expect, test } from 'bun:test'
import { chamar, criarConversa, enviarTexto, usuariosComuns, type UsuarioTeste } from './api.ts'

let ana: UsuarioTeste, bruno: UsuarioTeste, carla: UsuarioTeste
beforeAll(async () => ({ ana, bruno, carla } = await usuariosComuns()))

const listar = (quem: UsuarioTeste, conversa: number) =>
  chamar('GET', '/mensagens', { token: quem.token, consulta: { conversa, mensagemreferencia: 0, mensagensprevias: 80, mensagensseguintes: 0 } })

const textos = (lista: { conteudos: { conteudo: string }[] }[]) => lista.map((m) => m.conteudos[0]?.conteudo)

describe('enviar e listar', () => {
  test('mensagens voltam na ordem em que foram enviadas', async () => {
    const conversa = await criarConversa(ana, [bruno])
    await enviarTexto(ana, conversa, 'primeira')
    await enviarTexto(bruno, conversa, 'segunda')
    await enviarTexto(ana, conversa, 'terceira')
    const { status, dados } = await listar(bruno, conversa)
    expect(status).toBe(200)
    expect(textos(dados)).toEqual(['primeira', 'segunda', 'terceira'])
  })

  test('texto com acento e emoji volta igual', async () => {
    const conversa = await criarConversa(ana, [bruno])
    await enviarTexto(ana, conversa, 'Olá, ação! 🦜')
    expect(textos((await listar(bruno, conversa)).dados)).toEqual(['Olá, ação! 🦜'])
  })

  test('quem está fora não lê nem envia', async () => {
    const conversa = await criarConversa(ana, [bruno])
    expect((await listar(carla, conversa)).status).toBe(403)
    expect((await enviarTexto(carla, conversa, 'intrusa')).status).toBe(403)
  })

  test('responder outra mensagem guarda a referência', async () => {
    const conversa = await criarConversa(ana, [bruno])
    const original = await enviarTexto(ana, conversa, 'pergunta')
    await enviarTexto(bruno, conversa, 'resposta', { mensagem_referencia: { tipo: 1, origem_mensagem_id: original.dados.id } })
    const resposta = (await listar(ana, conversa)).dados.at(-1)
    expect(resposta.mensagem_referencia.mensagem.id).toBe(original.dados.id)
  })

  test('tipo de referência inválido é 400', async () => {
    const conversa = await criarConversa(ana, [bruno])
    const original = await enviarTexto(ana, conversa, 'pergunta')
    const { status } = await enviarTexto(bruno, conversa, 'x', { mensagem_referencia: { tipo: 9, origem_mensagem_id: original.dados.id } })
    expect(status).toBe(400)
  })
})

describe('agendadas', () => {
  const daquiA = (minutos: number) => new Date(Date.now() + minutos * 60_000).toISOString()

  test('só o autor vê antes da hora', async () => {
    const conversa = await criarConversa(ana, [bruno])
    const { status } = await enviarTexto(ana, conversa, 'para depois', { visivel_em: daquiA(30) })
    expect(status).toBe(200)
    expect(textos((await listar(ana, conversa)).dados)).toEqual(['para depois'])
    expect((await listar(bruno, conversa)).dados).toEqual([])
  })

  test('menos de 5 minutos no futuro é recusado', async () => {
    const conversa = await criarConversa(ana, [bruno])
    expect((await enviarTexto(ana, conversa, 'cedo demais', { visivel_em: daquiA(2) })).status).toBe(400)
  })

  test('mais de um ano no futuro é recusado', async () => {
    const conversa = await criarConversa(ana, [bruno])
    expect((await enviarTexto(ana, conversa, 'tarde demais', { visivel_em: daquiA(60 * 24 * 400) })).status).toBe(400)
  })
})

describe('excluir', () => {
  test('o autor exclui enquanto ninguém recebeu', async () => {
    const conversa = await criarConversa(ana, [bruno])
    const enviada = await enviarTexto(ana, conversa, 'engano')
    expect((await chamar('DELETE', '/mensagem', { token: ana.token, consulta: { id: enviada.dados.id } })).status).toBe(200)
  })

  test('depois de recebida não pode mais ser excluída', async () => {
    const conversa = await criarConversa(ana, [bruno])
    const enviada = await enviarTexto(ana, conversa, 'já foi')
    await listar(bruno, conversa) // ao listar, o destinatário marca como recebida
    const { status } = await chamar('DELETE', '/mensagem', { token: ana.token, consulta: { id: enviada.dados.id } })
    expect(status).toBe(409)
  })

  test('outra pessoa não exclui', async () => {
    const conversa = await criarConversa(ana, [bruno])
    const enviada = await enviarTexto(ana, conversa, 'minha')
    expect((await chamar('DELETE', '/mensagem', { token: bruno.token, consulta: { id: enviada.dados.id } })).status).toBe(403)
  })
})

describe('pesquisa', () => {
  test('acha só nas conversas de quem pesquisa', async () => {
    const termo = `agulha${Date.now()}`
    const daAnaComBruno = await criarConversa(ana, [bruno])
    const daCarlaComBruno = await criarConversa(carla, [bruno])
    await enviarTexto(ana, daAnaComBruno, `procure a ${termo}`)
    await enviarTexto(carla, daCarlaComBruno, `outra ${termo}`)
    const { status, dados } = await chamar('GET', '/pesquisar', { token: ana.token, consulta: { conversa: 0, texto: termo } })
    expect(status).toBe(200)
    expect(dados.map((m: { conversa_id: number }) => m.conversa_id)).toEqual([daAnaComBruno])
  })
})

describe('reações', () => {
  test('reagir de novo com o mesmo emoji desfaz', async () => {
    const conversa = await criarConversa(ana, [bruno])
    const enviada = await enviarTexto(ana, conversa, 'reaja')
    const reagir = () => chamar('PUT', '/mensagem/reacao', { token: bruno.token, corpo: { mensagem_id: enviada.dados.id, emoji: '👍' } })
    const reacoes = async () => (await listar(ana, conversa)).dados[0].reacoes ?? []
    expect((await reagir()).status).toBe(200)
    expect(await reacoes()).toMatchObject([{ emoji: '👍', quantidade: 1 }])
    await reagir()
    expect(await reacoes()).toEqual([])
  })
})

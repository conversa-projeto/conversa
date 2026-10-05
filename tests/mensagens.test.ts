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

describe('figurinha', () => {
  const enviarFigurinha = (quem: UsuarioTeste, conversa: number, conteudo: string) =>
    chamar('PUT', '/mensagem', { token: quem.token, corpo: { conversa_id: conversa, conteudos: [{ ordem: 1, tipo: 7, conteudo }] } })

  test('volta com o identificador e aparece como "figurinha" na prévia da conversa', async () => {
    const conversa = await criarConversa(ana, [bruno])
    expect((await enviarFigurinha(ana, conversa, 'basico/coracao')).status).toBe(200)
    const [mensagem] = (await listar(bruno, conversa)).dados
    expect(mensagem.conteudos).toMatchObject([{ ordem: 1, tipo: 7, conteudo: 'basico/coracao' }])
    const conversas = (await chamar('GET', '/conversas', { token: bruno.token })).dados as { id: number; ultima_mensagem_texto: string }[]
    expect(conversas.find((c) => c.id === conversa)!.ultima_mensagem_texto).toBe('figurinha')
  })

  test('identificador fora do formato pacote/nome é 400', async () => {
    const conversa = await criarConversa(ana, [bruno])
    for (const conteudo of ['../segredo', 'coracao', 'Basico/Coracao', '<script>/x']) {
      expect((await enviarFigurinha(ana, conversa, conteudo)).status).toBe(400)
    }
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
  const excluir = (quem: UsuarioTeste, id: number) => chamar('DELETE', '/mensagem', { token: quem.token, consulta: { id } })

  test('marca como excluída: continua na conversa, com o conteúdo, para todos', async () => {
    const conversa = await criarConversa(ana, [bruno])
    const enviada = await enviarTexto(ana, conversa, 'engano')
    await listar(bruno, conversa) // recebida pelo destinatário: antes isso impedia excluir
    const exclusao = await excluir(ana, enviada.dados.id)
    expect(exclusao.status).toBe(200)
    expect(exclusao.dados).toMatchObject({ id: enviada.dados.id, conversa_id: conversa })
    expect(Date.parse(exclusao.dados.excluida_em)).toBeGreaterThan(Date.now() - 60_000)
    for (const quem of [ana, bruno]) {
      const [mensagem] = (await listar(quem, conversa)).dados
      expect(mensagem.excluida_em).toBe(exclusao.dados.excluida_em)
      expect(textos([mensagem])).toEqual(['engano'])
    }
  })

  test('excluir de novo não muda o horário', async () => {
    const conversa = await criarConversa(ana, [bruno])
    const enviada = await enviarTexto(ana, conversa, 'duas vezes')
    const primeira = await excluir(ana, enviada.dados.id)
    await Bun.sleep(20)
    expect((await excluir(ana, enviada.dados.id)).dados.excluida_em).toBe(primeira.dados.excluida_em)
  })

  test('mensagem normal vem com excluida_em nulo', async () => {
    const conversa = await criarConversa(ana, [bruno])
    await enviarTexto(ana, conversa, 'normal')
    expect((await listar(bruno, conversa)).dados[0].excluida_em).toBeNull()
  })

  test('agendada que ainda não saiu é apagada de vez', async () => {
    const conversa = await criarConversa(ana, [bruno])
    const daqui30 = new Date(Date.now() + 30 * 60_000).toISOString()
    const agendada = await enviarTexto(ana, conversa, 'cancelada', { visivel_em: daqui30 })
    expect((await excluir(ana, agendada.dados.id)).status).toBe(200)
    expect((await listar(ana, conversa)).dados).toEqual([])
  })

  test('status, pesquisa e prévia da conversa mostram a exclusão sem o texto', async () => {
    const termo = `segredo${Date.now()}`
    const conversa = await criarConversa(ana, [bruno])
    const enviada = await enviarTexto(ana, conversa, `o ${termo}`)
    await excluir(ana, enviada.dados.id)
    const status = await chamar('GET', '/mensagem/status', { token: bruno.token, consulta: { conversa, mensagem: String(enviada.dados.id) } })
    expect(status.dados[0].excluida_em).not.toBeNull()
    expect((await chamar('GET', '/pesquisar', { token: bruno.token, consulta: { texto: termo, conversa: 0 } })).dados).toEqual([])
    const conversas = (await chamar('GET', '/conversas', { token: bruno.token })).dados
    expect(conversas.find((c: { id: number }) => c.id === conversa).ultima_mensagem_texto).toBe('Mensagem oculta')
  })

  test('resposta a uma mensagem excluída traz a marca na referência', async () => {
    const conversa = await criarConversa(ana, [bruno])
    const original = await enviarTexto(ana, conversa, 'original')
    await enviarTexto(bruno, conversa, 'respondendo', { mensagem_referencia: { tipo: 1, origem_mensagem_id: original.dados.id } })
    await excluir(ana, original.dados.id)
    const resposta = (await listar(bruno, conversa)).dados.find((m: { id: number }) => m.id !== original.dados.id)
    expect(resposta.mensagem_referencia.mensagem.excluida_em).not.toBeNull()
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

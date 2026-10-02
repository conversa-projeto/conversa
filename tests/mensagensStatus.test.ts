import { afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { iniciarTarefas } from '../src/tarefas.ts'
import { chamar, conectarSocket, criarConversa, criarUsuario, enviarTexto, noBanco, usuariosComuns, type SocketTeste, type UsuarioTeste } from './api.ts'
import { pushEnviados } from './fcmFalso.ts'

let ana: UsuarioTeste, bruno: UsuarioTeste, carla: UsuarioTeste
beforeAll(async () => ({ ana, bruno, carla } = await usuariosComuns()))

const abertos: SocketTeste[] = []
afterEach(async () => {
  await Promise.all(abertos.splice(0).map((socket) => socket.fechar()))
})

const listar = (quem: UsuarioTeste, conversa: number, referencia = 0, previas = 80, seguintes = 0) =>
  chamar('GET', '/mensagens', { token: quem.token, consulta: { conversa, mensagemreferencia: referencia, mensagensprevias: previas, mensagensseguintes: seguintes } })
const textos = (lista: { conteudos: { conteudo: string }[] }[]) => lista.map((m) => m.conteudos[0]?.conteudo)
const statusDe = (quem: UsuarioTeste, conversa: number, ids: number[]) =>
  chamar('GET', '/mensagem/status', { token: quem.token, consulta: { conversa, mensagem: ids.join(',') } })

describe('status de entrega', () => {
  test('recebida ao listar, visualizada e reproduzida quando marcadas', async () => {
    const conversa = await criarConversa(ana, [bruno])
    const { dados } = await enviarTexto(ana, conversa, 'áudio')
    const id = dados.id
    expect((await statusDe(ana, conversa, [id])).dados).toEqual([{ conversa_id: conversa, mensagem_id: id, recebida: false, visualizada: false, reproduzida: false, excluida_em: null }])
    await listar(bruno, conversa)
    expect((await statusDe(ana, conversa, [id])).dados[0]).toMatchObject({ recebida: true, visualizada: false })
    await chamar('POST', '/mensagem/visualizar', { token: bruno.token, corpo: { conversa, mensagem: id } })
    await chamar('POST', '/mensagem/reproduzir', { token: bruno.token, corpo: { conversa, mensagem: id } })
    expect((await statusDe(ana, conversa, [id])).dados[0]).toMatchObject({ recebida: true, visualizada: true, reproduzida: true })
  })

  test('em grupo, só fica visualizada quando todos visualizaram', async () => {
    const conversa = await criarConversa(ana, [bruno, carla])
    const { dados } = await enviarTexto(ana, conversa, 'para o grupo')
    await chamar('POST', '/mensagem/visualizar', { token: bruno.token, corpo: { conversa, mensagem: dados.id } })
    expect((await statusDe(ana, conversa, [dados.id])).dados[0].visualizada).toBe(false)
    await chamar('POST', '/mensagem/visualizar', { token: carla.token, corpo: { conversa, mensagem: dados.id } })
    expect((await statusDe(ana, conversa, [dados.id])).dados[0].visualizada).toBe(true)
  })

  test('na lista, quem enviou vê o status somado; quem recebeu vê o próprio', async () => {
    const conversa = await criarConversa(ana, [bruno, carla])
    const { dados } = await enviarTexto(ana, conversa, 'grupo')
    await chamar('POST', '/mensagem/visualizar', { token: bruno.token, corpo: { conversa, mensagem: dados.id } })
    expect((await listar(ana, conversa)).dados[0].visualizada).toBe(false)
    expect((await listar(bruno, conversa)).dados[0].visualizada).toBe(true)
  })

  test('lista de ids inválida é 400; vazia devolve nada', async () => {
    const conversa = await criarConversa(ana, [bruno])
    expect((await statusDe(ana, conversa, [1.5 as number])).status).toBe(400)
    expect((await chamar('GET', '/mensagem/status', { token: ana.token, consulta: { conversa, mensagem: ' , ' } })).dados).toEqual([])
  })

  test('quem está fora não consulta nem marca', async () => {
    const conversa = await criarConversa(ana, [bruno])
    const { dados } = await enviarTexto(ana, conversa, 'x')
    expect((await statusDe(carla, conversa, [dados.id])).status).toBe(403)
    expect((await chamar('POST', '/mensagem/visualizar', { token: carla.token, corpo: { conversa, mensagem: dados.id } })).status).toBe(403)
  })
})

describe('detalhe do status', () => {
  test('quem enviou vê quem recebeu e visualizou, com horário', async () => {
    const conversa = await criarConversa(ana, [bruno, carla])
    const { dados } = await enviarTexto(ana, conversa, 'quem viu?')
    await chamar('POST', '/mensagem/visualizar', { token: bruno.token, corpo: { conversa, mensagem: dados.id } })
    const detalhe = (await chamar('GET', '/mensagem/status/detalhe', { token: ana.token, consulta: { id: dados.id } })).dados
    expect(detalhe.map((d: { usuario_id: number }) => d.usuario_id)).toEqual([bruno.id, carla.id])
    expect(detalhe[0].visualizada).not.toBeNull()
    expect(detalhe[1].visualizada).toBeNull()
  })

  test('só quem enviou vê; mensagem inexistente é 404', async () => {
    const conversa = await criarConversa(ana, [bruno])
    const { dados } = await enviarTexto(ana, conversa, 'minha')
    expect((await chamar('GET', '/mensagem/status/detalhe', { token: bruno.token, consulta: { id: dados.id } })).status).toBe(403)
    expect((await chamar('GET', '/mensagem/status/detalhe', { token: ana.token, consulta: { id: 999_999_999 } })).status).toBe(404)
  })
})

describe('novas mensagens', () => {
  const novas = (quem: UsuarioTeste, desde = '') => chamar('GET', '/mensagens/novas', { token: quem.token, consulta: { desde } })

  test('traz a última não visualizada de cada conversa, e some ao visualizar', async () => {
    const conversa = await criarConversa(ana, [bruno])
    await enviarTexto(ana, conversa, 'uma')
    const ultima = (await enviarTexto(ana, conversa, 'duas')).dados.id
    const antes = (await novas(bruno)).dados.find((n: { conversa_id: number }) => n.conversa_id === conversa)
    expect(antes.mensagem_id).toBe(ultima)
    for (const m of (await listar(bruno, conversa)).dados) {
      await chamar('POST', '/mensagem/visualizar', { token: bruno.token, corpo: { conversa, mensagem: m.id } })
    }
    expect((await novas(bruno)).dados.find((n: { conversa_id: number }) => n.conversa_id === conversa)).toBeUndefined()
  })

  test('não traz as próprias mensagens', async () => {
    const conversa = await criarConversa(ana, [bruno])
    await enviarTexto(ana, conversa, 'minha')
    expect((await novas(ana)).dados.find((n: { conversa_id: number }) => n.conversa_id === conversa)).toBeUndefined()
  })

  test('o cursor "ate" não traz a mesma mensagem de novo', async () => {
    const conversa = await criarConversa(ana, [bruno])
    await enviarTexto(ana, conversa, 'uma vez')
    const item = (await novas(bruno)).dados.find((n: { conversa_id: number }) => n.conversa_id === conversa)
    const depois = (await novas(bruno, new Date(item.ate).toISOString())).dados
    expect(depois.find((n: { conversa_id: number }) => n.conversa_id === conversa)).toBeUndefined()
  })

  test('"desde" inválido é 400', async () => {
    expect((await novas(ana, 'ontem')).status).toBe(400)
  })
})

describe('paginação', () => {
  test('anteriores e seguintes a partir de uma mensagem', async () => {
    const conversa = await criarConversa(ana, [bruno])
    const ids: number[] = []
    for (const n of [1, 2, 3, 4, 5]) ids.push((await enviarTexto(ana, conversa, `m${n}`)).dados.id)
    expect(textos((await listar(bruno, conversa, ids[2], 2, 0)).dados)).toEqual(['m2', 'm3'])
    expect(textos((await listar(bruno, conversa, ids[2], 0, 2)).dados)).toEqual(['m3', 'm4'])
    expect(textos((await listar(bruno, conversa, ids[2], 2, 2)).dados)).toEqual(['m2', 'm3', 'm4'])
    expect(textos((await listar(bruno, conversa, 0, 2, 0)).dados)).toEqual(['m4', 'm5'])
  })

  test('sem prévias nem seguintes devolve só a referência, ou a última', async () => {
    const conversa = await criarConversa(ana, [bruno])
    const primeira = (await enviarTexto(ana, conversa, 'primeira')).dados.id
    await enviarTexto(ana, conversa, 'última')
    expect(textos((await listar(bruno, conversa, primeira, 0, 0)).dados)).toEqual(['primeira'])
    expect(textos((await listar(bruno, conversa, 0, 0, 0)).dados)).toEqual(['última'])
  })

  test('limite de paginação acima de 1000 é recusado pela validação', async () => {
    const conversa = await criarConversa(ana, [bruno])
    const { status, dados } = await listar(bruno, conversa, 0, 1001, 0)
    expect(status).toBe(400)
    expect(dados.error).toContain('mensagensprevias')
  })
})

describe('encaminhar e responder', () => {
  test('encaminhada de outra conversa carrega a original, com a cadeia de respostas', async () => {
    const origem = await criarConversa(ana, [bruno])
    const pergunta = (await enviarTexto(ana, origem, 'pergunta')).dados.id
    const resposta = (await enviarTexto(bruno, origem, 'resposta', { mensagem_referencia: { tipo: 1, origem_mensagem_id: pergunta } })).dados.id
    const destino = await criarConversa(bruno, [carla])
    await enviarTexto(bruno, destino, 'olha isso', { mensagem_referencia: { tipo: 2, origem_mensagem_id: resposta } })
    const encaminhada = (await listar(carla, destino)).dados[0]
    expect(encaminhada.mensagem_referencia.tipo).toBe(2)
    expect(encaminhada.mensagem_referencia.mensagem).toMatchObject({ id: resposta, conversa_id: origem, remetente: 'Bruno' })
    expect(encaminhada.mensagem_referencia.mensagem.mensagem_referencia.mensagem).toMatchObject({ id: pergunta, remetente: 'Ana' })
  })

  test('a cadeia para em 5 níveis', async () => {
    const conversa = await criarConversa(ana, [bruno])
    let anterior = (await enviarTexto(ana, conversa, 'n0')).dados.id
    for (const n of [1, 2, 3, 4, 5, 6, 7]) {
      anterior = (await enviarTexto(ana, conversa, `n${n}`, { mensagem_referencia: { tipo: 1, origem_mensagem_id: anterior } })).dados.id
    }
    let referencia = (await listar(ana, conversa)).dados.at(-1).mensagem_referencia
    let niveis = 0
    while (referencia?.mensagem) {
      niveis++
      referencia = referencia.mensagem.mensagem_referencia
    }
    expect(niveis).toBe(5)
  })
})

describe('pesquisa', () => {
  test('ignora acentos e maiúsculas, e junta palavras separadas', async () => {
    const conversa = await criarConversa(ana, [bruno])
    const marca = `x${Date.now()}`
    await enviarTexto(ana, conversa, `Reunião de ${marca} amanhã cedo`)
    const busca = (texto: string) => chamar('GET', '/pesquisar', { token: bruno.token, consulta: { conversa, texto } })
    expect((await busca(`reuniao ${marca}`)).dados).toHaveLength(1)
    expect((await busca(`AMANHA`)).dados).toHaveLength(1)
    expect((await busca(`${marca} cedo`)).dados).toHaveLength(1)
  })

  test('não acha agendada de outra pessoa antes da hora', async () => {
    const conversa = await criarConversa(ana, [bruno])
    const marca = `agendada${Date.now()}`
    await enviarTexto(ana, conversa, marca, { visivel_em: new Date(Date.now() + 30 * 60_000).toISOString() })
    expect((await chamar('GET', '/pesquisar', { token: bruno.token, consulta: { conversa, texto: marca } })).dados).toEqual([])
    expect((await chamar('GET', '/pesquisar', { token: ana.token, consulta: { conversa, texto: marca } })).dados).toHaveLength(1)
  })

  test('texto vazio é 400', async () => {
    expect((await chamar('GET', '/pesquisar', { token: ana.token, consulta: { conversa: 0, texto: ' ' } })).status).toBe(400)
  })
})

describe('reações', () => {
  test('lista quem reagiu e marca a própria reação', async () => {
    const conversa = await criarConversa(ana, [bruno, carla])
    const { dados } = await enviarTexto(ana, conversa, 'reaja')
    for (const quem of [bruno, carla]) {
      await chamar('PUT', '/mensagem/reacao', { token: quem.token, corpo: { mensagem_id: dados.id, emoji: '🎉' } })
    }
    const [reacao] = (await listar(bruno, conversa)).dados[0].reacoes
    expect(reacao).toMatchObject({ emoji: '🎉', quantidade: 2, reagiu: true })
    expect(reacao.usuarios.map((u: { usuario_id: number }) => u.usuario_id)).toEqual([bruno.id, carla.id])
    expect((await listar(ana, conversa)).dados[0].reacoes[0].reagiu).toBe(false)
  })

  test('mensagem inexistente é 404; de conversa alheia é 403', async () => {
    const conversa = await criarConversa(ana, [bruno])
    const { dados } = await enviarTexto(ana, conversa, 'x')
    expect((await chamar('PUT', '/mensagem/reacao', { token: ana.token, corpo: { mensagem_id: 999_999_999, emoji: '👍' } })).status).toBe(404)
    expect((await chamar('PUT', '/mensagem/reacao', { token: carla.token, corpo: { mensagem_id: dados.id, emoji: '👍' } })).status).toBe(403)
  })
})

describe('push para quem não está conectado', () => {
  test('vai para o aparelho de quem está desconectado, com remetente e texto', async () => {
    const destinatario = await criarUsuario('Destinatário Push')
    const { dados } = await chamar('POST', '/login', { corpo: { login: destinatario.login, senha: destinatario.senha } })
    await chamar('PATCH', '/dispositivo', { token: destinatario.token, corpo: { id: dados.dispositivo.id, token_fcm: `push-${destinatario.id}` } })
    const conversa = await criarConversa(ana, [destinatario])
    await enviarTexto(ana, conversa, 'chegou?')
    await Bun.sleep(50)
    expect(pushEnviados.filter((p) => p.token === `push-${destinatario.id}`)).toEqual([
      expect.objectContaining({ data: { titulo: 'Ana', mensagem: 'chegou?', conversa: String(conversa) } }),
    ])
  })

  test('não vai para quem está conectado nem para quem arquivou a conversa', async () => {
    const conectado = await criarUsuario('Conectado Push')
    const arquivou = await criarUsuario('Arquivou Push')
    for (const quem of [conectado, arquivou]) {
      const { dados } = await chamar('POST', '/login', { corpo: { login: quem.login, senha: quem.senha } })
      await chamar('PATCH', '/dispositivo', { token: quem.token, corpo: { id: dados.dispositivo.id, token_fcm: `push-${quem.id}` } })
    }
    const conversa = await criarConversa(ana, [conectado, arquivou])
    await chamar('PATCH', '/conversa/arquivada', { token: arquivou.token, corpo: { conversa, arquivada: true } })
    abertos.push(await conectarSocket(conectado))
    await enviarTexto(ana, conversa, 'para o grupo')
    await Bun.sleep(50)
    expect(pushEnviados.filter((p) => p.token === `push-${conectado.id}` || p.token === `push-${arquivou.id}`)).toEqual([])
  })
})

describe('agendadas', () => {
  test('ao chegar a hora, o agendador avisa os destinatários', async () => {
    const conversa = await criarConversa(ana, [bruno])
    const { dados } = await enviarTexto(ana, conversa, 'hora marcada', { visivel_em: new Date(Date.now() + 30 * 60_000).toISOString() })
    const doBruno = await conectarSocket(bruno)
    abertos.push(doBruno)
    await noBanco((sql) => sql`update mensagem set visivel_em = now() - interval '1 minute' where id = ${dados.id}`)
    const parar = iniciarTarefas()
    try {
      const aviso = await doBruno.esperar((e) => e.tipo === 2 && e.mensagem === 'hora marcada')
      expect(aviso.titulo).toBe('Ana')
      await doBruno.esperar((e) => e.tipo === 3 && e.mensagens === String(dados.id))
    } finally {
      parar()
    }
    expect(textos((await listar(bruno, conversa)).dados)).toEqual(['hora marcada'])
  })
})

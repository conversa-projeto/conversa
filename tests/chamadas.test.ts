import { beforeAll, describe, expect, test } from 'bun:test'
import { chamar, criarConversa, criarUsuario, usuariosComuns, type UsuarioTeste } from './api.ts'

let ana: UsuarioTeste, bruno: UsuarioTeste, carla: UsuarioTeste
beforeAll(async () => ({ ana, bruno, carla } = await usuariosComuns()))

// Quem liga entra na lista junto com os convidados, como a página faz.
async function ligar(de: UsuarioTeste, para: UsuarioTeste[], tipo = 2) {
  const conversa = await criarConversa(de, para)
  const { status, dados } = await chamar('PUT', '/chamada/iniciar', {
    token: de.token,
    corpo: { tipo, usuarios: [{ id: de.id }, ...para.map((u) => ({ id: u.id }))], conversa_id: conversa },
  })
  expect(status).toBe(200)
  return dados.id as number
}

const dados = (quem: UsuarioTeste, id: number) => chamar('GET', '/chamada/dados', { token: quem.token, consulta: { id } })

describe('chamadas', () => {
  test('convidado vê a chamada como pendente', async () => {
    const id = await ligar(ana, [bruno])
    const pendentes = await chamar('GET', '/chamadas/pendentes', { token: bruno.token })
    expect(pendentes.dados.map((c: { id: number }) => c.id)).toContain(id)
  })

  test('ao entrar, a chamada fica em andamento e registra o início', async () => {
    const id = await ligar(ana, [bruno])
    expect((await chamar('POST', '/chamada/entrar', { token: bruno.token, corpo: { id } })).status).toBe(200)
    const { dados: chamada } = await dados(ana, id)
    expect(chamada.status).toBe(3)
    expect(chamada.iniciada).not.toBeNull()
  })

  test('recusar sozinho encerra a chamada como recusada', async () => {
    const id = await ligar(ana, [bruno])
    await chamar('POST', '/chamada/recusar', { token: bruno.token, corpo: { id } })
    expect((await dados(ana, id)).dados.status).toBe(2)
  })

  test('finalizar marca o fim', async () => {
    const id = await ligar(ana, [bruno])
    await chamar('POST', '/chamada/entrar', { token: bruno.token, corpo: { id } })
    await chamar('POST', '/chamada/finalizar', { token: ana.token, corpo: { id } })
    const { dados: chamada } = await dados(ana, id)
    expect(chamada.status).toBe(4)
    expect(chamada.finalizada).not.toBeNull()
  })

  test('quem não participa não vê nem entra: para ele a chamada não existe (404)', async () => {
    const id = await ligar(ana, [bruno])
    for (const resposta of [await dados(carla, id), await chamar('POST', '/chamada/entrar', { token: carla.token, corpo: { id } })]) {
      expect(resposta.status).toBe(404)
      expect(resposta.dados.error).toBe('Chamada não encontrada!')
    }
  })

  test('chamada inexistente é 404', async () => {
    expect((await dados(ana, 999_999_999)).status).toBe(404)
  })

  // Para os membros, o aviso de vídeo abre a janela "Apenas assistir".
  test('só quem participa anuncia vídeo na chamada', async () => {
    const id = await ligar(ana, [bruno])
    expect((await chamar('POST', '/chamada/video', { token: bruno.token, corpo: { id } })).status).toBe(200)
    expect((await chamar('POST', '/chamada/video', { token: carla.token, corpo: { id } })).status).toBe(404)
  })

  test('cancelar antes de atender marca como cancelada', async () => {
    const id = await ligar(ana, [bruno])
    expect((await chamar('POST', '/chamada/cancelar', { token: ana.token, corpo: { id } })).status).toBe(200)
    expect((await dados(ana, id)).dados.status).toBe(6)
  })

  test('quando o penúltimo sai, a chamada termina', async () => {
    const id = await ligar(ana, [bruno])
    await chamar('POST', '/chamada/entrar', { token: bruno.token, corpo: { id } })
    await chamar('POST', '/chamada/sair', { token: bruno.token, corpo: { id } })
    const { dados: chamada } = await dados(ana, id)
    expect(chamada.status).toBe(4)
    expect(chamada.usuarios.find((u: { usuario_id: number }) => u.usuario_id === bruno.id).saiu_em).not.toBeNull()
  })

  test('dados trazem quem adicionou cada participante', async () => {
    const id = await ligar(ana, [bruno])
    const { dados: chamada } = await dados(bruno, id)
    expect(chamada.usuarios).toEqual(expect.arrayContaining([
      expect.objectContaining({ usuario_id: bruno.id, usuario_nome: 'Bruno', adicionado_por: ana.id, adicionado_por_nome: 'Ana', status: 1 }),
      expect.objectContaining({ usuario_id: ana.id, status: 3 }),
    ]))
  })

  test('sem conversa informada, a chamada funciona sem resumo', async () => {
    const { dados: criada } = await chamar('PUT', '/chamada/iniciar', { token: ana.token, corpo: { usuarios: [{ id: ana.id }, { id: bruno.id }] } })
    expect(criada.tipo).toBe(1) // dois participantes sem tipo informado: áudio
    await chamar('POST', '/chamada/recusar', { token: bruno.token, corpo: { id: criada.id } })
    expect((await dados(ana, criada.id)).dados.status).toBe(2)
  })

  test('participante pode adicionar outra pessoa, que passa a ver a chamada', async () => {
    const id = await ligar(ana, [bruno])
    expect((await chamar('PUT', '/chamada/usuario', { token: ana.token, corpo: { chamada_id: id, usuario_id: carla.id } })).status).toBe(200)
    expect((await dados(carla, id)).status).toBe(200)
  })
})

describe('chamar de novo quem não atendeu', () => {
  const statusDe = async (id: number, quem: UsuarioTeste) =>
    ((await dados(ana, id)).dados.usuarios as { usuario_id: number; status: number }[]).find((u) => u.usuario_id === quem.id)!.status

  test('quem recusou volta a pendente e vê a chamada de novo', async () => {
    const id = await ligar(ana, [bruno, carla])
    await chamar('POST', '/chamada/entrar', { token: bruno.token, corpo: { id } })
    await chamar('POST', '/chamada/recusar', { token: carla.token, corpo: { id, nao_atendeu: true } })
    expect(await statusDe(id, carla)).toBe(2)
    const { status } = await chamar('POST', '/chamada/chamar-novamente', { token: bruno.token, corpo: { chamada_id: id, usuario_id: carla.id } })
    expect(status).toBe(200)
    expect(await statusDe(id, carla)).toBe(1)
    const pendentes = await chamar('GET', '/chamadas/pendentes', { token: carla.token })
    expect(pendentes.dados.map((c: { id: number }) => c.id)).toContain(id)
  })

  test('não chama de novo quem está pendente, nem com a chamada encerrada', async () => {
    const id = await ligar(ana, [bruno, carla])
    expect((await chamar('POST', '/chamada/chamar-novamente', { token: ana.token, corpo: { chamada_id: id, usuario_id: carla.id } })).status).toBe(400)
    await chamar('POST', '/chamada/recusar', { token: carla.token, corpo: { id } })
    await chamar('POST', '/chamada/finalizar', { token: ana.token, corpo: { id } })
    expect((await chamar('POST', '/chamada/chamar-novamente', { token: ana.token, corpo: { chamada_id: id, usuario_id: carla.id } })).status).toBe(400)
  })
})

describe('chat da chamada', () => {
  const membros = async (quem: UsuarioTeste, conversa: number) =>
    ((await chamar('GET', '/conversa/usuarios', { token: quem.token, consulta: { conversa } })).dados as { usuario_id: number }[]).map((m) => m.usuario_id).sort()

  // Ligação feita fora de uma conversa: o chat é um grupo novo
  async function ligarAvulsa(de: UsuarioTeste, para: UsuarioTeste[]) {
    const { dados: criada } = await chamar('PUT', '/chamada/iniciar', { token: de.token, corpo: { tipo: 2, usuarios: [{ id: de.id }, ...para.map((u) => ({ id: u.id }))] } })
    return criada.id as number
  }
  const conteudoDaChamada = async (quem: UsuarioTeste, conversa: number) => {
    const { dados: lista } = await chamar('GET', '/mensagens', { token: quem.token, consulta: { conversa, mensagemreferencia: 0, mensagensprevias: 10, mensagensseguintes: 0 } })
    return (lista as { conteudos: { tipo: number; chat_chamada_id?: number }[] }[]).flatMap((m) => m.conteudos).find((c) => c.tipo === 6)
  }

  test('só existe depois de pedido; cria um grupo com quem esteve na chamada e devolve o mesmo depois', async () => {
    const id = await ligarAvulsa(ana, [bruno, carla])
    await chamar('POST', '/chamada/entrar', { token: bruno.token, corpo: { id } })
    expect((await dados(ana, id)).dados.conversa_chat_id).toBeNull()

    const { status, dados: chat } = await chamar('PUT', '/chamada/chat', { token: bruno.token, corpo: { id } })
    expect(status).toBe(200)
    expect((await dados(ana, id)).dados.conversa_chat_id).toBe(chat.conversa_id)
    // Carla não atendeu: fica de fora até entrar
    expect(await membros(ana, chat.conversa_id)).toEqual([ana.id, bruno.id].sort())
    const conversas = (await chamar('GET', '/conversas', { token: ana.token })).dados as { id: number; tipo: number; descricao: string; chamada: boolean }[]
    const grupo = conversas.find((c) => c.id === chat.conversa_id)!
    expect(grupo.tipo).toBe(2)
    expect(grupo.descricao).toStartWith('Chamada: ')
    expect(grupo.chamada).toBe(true)
    expect(conversas.filter((c) => c.id !== chat.conversa_id).every((c) => !c.chamada)).toBe(true)

    expect((await chamar('PUT', '/chamada/chat', { token: ana.token, corpo: { id } })).dados.conversa_id).toBe(chat.conversa_id)

    await chamar('POST', '/chamada/entrar', { token: carla.token, corpo: { id } })
    expect(await membros(ana, chat.conversa_id)).toEqual([ana.id, bruno.id, carla.id].sort())
  })

  test('ligação numa conversa que já tem todo mundo reaproveita a conversa, sem mudar os membros', async () => {
    const grupo = await criarConversa(ana, [bruno, carla])
    const { dados: criada } = await chamar('PUT', '/chamada/iniciar', { token: ana.token, corpo: { tipo: 2, usuarios: [{ id: ana.id }, { id: bruno.id }, { id: carla.id }], conversa_id: grupo } })
    await chamar('POST', '/chamada/entrar', { token: bruno.token, corpo: { id: criada.id } })
    const antes = (await chamar('GET', '/conversas', { token: ana.token })).dados.length
    const { dados: chat } = await chamar('PUT', '/chamada/chat', { token: bruno.token, corpo: { id: criada.id } })
    expect(chat.conversa_id).toBe(grupo)
    const conversas = (await chamar('GET', '/conversas', { token: ana.token })).dados as { id: number; chamada: boolean }[]
    expect(conversas).toHaveLength(antes)
    expect(conversas.find((c) => c.id === grupo)!.chamada).toBe(false)

    // Alguém de fora adicionado depois não entra no grupo
    const davi = (await chamar('PUT', '/chamada/usuario', { token: ana.token, corpo: { chamada_id: criada.id, usuario_id: (await criarUsuario()).id } }))
    expect(davi.status).toBe(200)
    expect(await membros(ana, grupo)).toEqual([ana.id, bruno.id, carla.id].sort())

    // A mensagem da ligação fica na própria conversa, sem apontar para outro chat
    await chamar('POST', '/chamada/finalizar', { token: ana.token, corpo: { id: criada.id } })
    expect((await conteudoDaChamada(ana, grupo))!.chat_chamada_id).toBeUndefined()
  })

  test('com alguém de fora da conversa, cria o grupo; a mensagem e o histórico apontam para ele, só para os membros', async () => {
    const direta = await criarConversa(ana, [bruno])
    const { dados: criada } = await chamar('PUT', '/chamada/iniciar', { token: ana.token, corpo: { tipo: 2, usuarios: [{ id: ana.id }, { id: bruno.id }, { id: carla.id }], conversa_id: direta } })
    await chamar('POST', '/chamada/entrar', { token: bruno.token, corpo: { id: criada.id } })
    await chamar('POST', '/chamada/entrar', { token: carla.token, corpo: { id: criada.id } })
    const { dados: chat } = await chamar('PUT', '/chamada/chat', { token: ana.token, corpo: { id: criada.id } })
    expect(chat.conversa_id).not.toBe(direta)
    await chamar('POST', '/chamada/finalizar', { token: ana.token, corpo: { id: criada.id } })

    expect((await conteudoDaChamada(ana, direta))!.chat_chamada_id).toBe(chat.conversa_id)
    const historico = (await chamar('GET', '/chamadas', { token: carla.token })).dados as { id: number; conversa_chat_id: number | null }[]
    expect(historico.find((h) => h.id === criada.id)!.conversa_chat_id).toBe(chat.conversa_id)
  })

  test('quem não participa da chamada não cria o chat', async () => {
    const id = await ligar(ana, [bruno])
    expect((await chamar('PUT', '/chamada/chat', { token: carla.token, corpo: { id } })).status).toBe(404)
  })
})

describe('resumo da chamada na conversa', () => {
  const resumoNaConversa = async (quem: UsuarioTeste, conversa: number) => {
    const { dados: lista } = await chamar('GET', '/mensagens', { token: quem.token, consulta: { conversa, mensagemreferencia: 0, mensagensprevias: 10, mensagensseguintes: 0 } })
    return lista.filter((m: { conteudos: { tipo: number }[] }) => m.conteudos[0]?.tipo === 6)
  }

  test('ao terminar, grava uma única mensagem de resumo com os participantes', async () => {
    const conversa = await criarConversa(ana, [bruno])
    const { dados: criada } = await chamar('PUT', '/chamada/iniciar', { token: ana.token, corpo: { tipo: 2, usuarios: [{ id: ana.id }, { id: bruno.id }], conversa_id: conversa } })
    await chamar('POST', '/chamada/entrar', { token: bruno.token, corpo: { id: criada.id } })
    await chamar('POST', '/chamada/sair', { token: bruno.token, corpo: { id: criada.id } })
    await chamar('POST', '/chamada/finalizar', { token: ana.token, corpo: { id: criada.id } })
    const resumos = await resumoNaConversa(bruno, conversa)
    expect(resumos).toHaveLength(1)
    const conteudo = JSON.parse(resumos[0].conteudos[0].conteudo)
    expect(conteudo).toMatchObject({ chamada_id: criada.id, tipo: 2, status: 4 })
    expect(conteudo.participantes.map((p: { usuario_id: number }) => p.usuario_id)).toEqual([ana.id, bruno.id])
    expect(resumos[0].remetente_id).toBe(ana.id)
  })

  test('quem participou recebe o resumo já como lido; quem perdeu, como não lido', async () => {
    const conversa = await criarConversa(ana, [bruno, carla])
    const { dados: criada } = await chamar('PUT', '/chamada/iniciar', { token: ana.token, corpo: { tipo: 1, usuarios: [{ id: ana.id }, { id: bruno.id }, { id: carla.id }], conversa_id: conversa } })
    await chamar('POST', '/chamada/entrar', { token: bruno.token, corpo: { id: criada.id } })
    await chamar('POST', '/chamada/finalizar', { token: ana.token, corpo: { id: criada.id } })
    expect((await resumoNaConversa(bruno, conversa))[0].visualizada).toBe(true)
    expect((await resumoNaConversa(carla, conversa))[0].visualizada).toBe(false)
  })
})

describe('histórico', () => {
  const historico = (quem: UsuarioTeste, filtro: Record<string, string | number> = {}) =>
    chamar('GET', '/chamadas', { token: quem.token, consulta: { participante: 0, de: '', ate: '', ...filtro } })

  test('só chamadas encerradas, com participantes e duração', async () => {
    const encerrada = await ligar(ana, [bruno])
    await chamar('POST', '/chamada/entrar', { token: bruno.token, corpo: { id: encerrada } })
    await chamar('POST', '/chamada/finalizar', { token: ana.token, corpo: { id: encerrada } })
    const aberta = await ligar(ana, [bruno])
    const lista = (await historico(bruno)).dados
    const item = lista.find((c: { id: number }) => c.id === encerrada)
    expect(item).toMatchObject({ status: 4 })
    expect(item.duracao).toBeGreaterThanOrEqual(0)
    expect(item.participantes.map((p: { usuario_id: number }) => p.usuario_id).sort()).toEqual([ana.id, bruno.id].sort())
    expect(lista.find((c: { id: number }) => c.id === aberta)).toBeUndefined()
  })

  test('filtra por participante e por data', async () => {
    const comCarla = await ligar(ana, [carla])
    await chamar('POST', '/chamada/recusar', { token: carla.token, corpo: { id: comCarla } })
    const comBruno = await ligar(ana, [bruno])
    await chamar('POST', '/chamada/recusar', { token: bruno.token, corpo: { id: comBruno } })
    const soCarla = (await historico(ana, { participante: carla.id })).dados.map((c: { id: number }) => c.id)
    expect(soCarla).toContain(comCarla)
    expect(soCarla).not.toContain(comBruno)
    const hoje = new Date().toISOString().slice(0, 10)
    expect((await historico(ana, { de: '2000-01-01', ate: hoje })).dados.map((c: { id: number }) => c.id)).toContain(comBruno)
    expect((await historico(ana, { ate: '2000-01-01' })).dados).toEqual([])
  })

  test('quem não participou não vê a chamada no histórico', async () => {
    const id = await ligar(ana, [bruno])
    await chamar('POST', '/chamada/recusar', { token: bruno.token, corpo: { id } })
    expect((await historico(carla)).dados.map((c: { id: number }) => c.id)).not.toContain(id)
  })
})

describe('servidores ICE', () => {
  // O segredo do TURN é lido de /dados/turn-segredo, que só existe no container.
  // Fora dele, a API responde sem servidores, e o WebRTC usa só a rede local.
  test('sem o segredo do TURN, não oferece servidor', async () => {
    const { status, dados: ice } = await chamar('GET', '/ice', { token: ana.token })
    expect(status).toBe(200)
    expect(ice).toEqual({ iceServers: [], iceTransportPolicy: 'all' })
  })
})

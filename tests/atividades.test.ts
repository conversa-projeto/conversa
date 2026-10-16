import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { chamar, conectarSocket, criarConversa, criarUsuario, enviarTexto, type SocketTeste, type UsuarioTeste } from './api.ts'

// Usuarios novos a cada teste: as atividades de um nao aparecem no outro
let ana: UsuarioTeste, bruno: UsuarioTeste, carla: UsuarioTeste
beforeEach(async () => {
  ;[ana, bruno, carla] = await Promise.all([criarUsuario('Ana Atividade'), criarUsuario('Bruno Atividade'), criarUsuario('Carla Atividade')])
})

const abertos: SocketTeste[] = []
afterEach(async () => {
  await Promise.all(abertos.splice(0).map((socket) => socket.fechar()))
})

interface Atividade {
  id: number
  tipo: number
  pendente: boolean
  autor_id: number
  autor_nome: string
  conversa_id: number | null
  mensagem_id: number | null
  chamada_id: number | null
  emoji: string | null
  texto: string | null
}

const listar = async (quem: UsuarioTeste, consulta: Record<string, number> = {}) =>
  (await chamar('GET', '/atividades', { token: quem.token, consulta })).dados as Atividade[]
const novas = async (quem: UsuarioTeste) => ((await chamar('GET', '/atividades/novas', { token: quem.token })).dados as { quantidade: number }).quantidade
const reagir = (quem: UsuarioTeste, mensagem: number, emoji: string) =>
  chamar('PUT', '/mensagem/reacao', { token: quem.token, corpo: { mensagem_id: mensagem, emoji } })
const mencao = (u: UsuarioTeste) => `@[Fulano](${u.id})`

describe('reação', () => {
  test('vira atividade de quem escreveu a mensagem, e some quando a reação é retirada', async () => {
    const conversa = await criarConversa(ana, [bruno])
    const mensagem = (await enviarTexto(ana, conversa, 'bom dia')).dados.id
    await reagir(bruno, mensagem, '😂')
    const [atividade] = await listar(ana)
    expect(atividade).toMatchObject({ tipo: 1, autor_id: bruno.id, autor_nome: 'Bruno Atividade', conversa_id: conversa, mensagem_id: mensagem, emoji: '😂', texto: 'bom dia', pendente: true })
    expect(await listar(bruno)).toEqual([])

    await reagir(bruno, mensagem, '😂')
    expect(await listar(ana)).toEqual([])
  })

  test('reagir à própria mensagem não gera atividade', async () => {
    const conversa = await criarConversa(ana, [bruno])
    const mensagem = (await enviarTexto(ana, conversa, 'oi')).dados.id
    await reagir(ana, mensagem, '👍')
    expect(await listar(ana)).toEqual([])
  })

  test('quem recebe é avisado pelo socket', async () => {
    const conversa = await criarConversa(ana, [bruno])
    const mensagem = (await enviarTexto(ana, conversa, 'oi')).dados.id
    const daAna = await conectarSocket(ana)
    abertos.push(daAna)
    await reagir(bruno, mensagem, '❤️')
    await daAna.esperar((e) => e.tipo === 61)
  })
})

describe('resposta e menção', () => {
  test('resposta vira atividade de quem foi respondido, com o texto da resposta', async () => {
    const conversa = await criarConversa(ana, [bruno])
    const original = (await enviarTexto(ana, conversa, 'pergunta')).dados.id
    const resposta = (await enviarTexto(bruno, conversa, 'resposta', { mensagem_referencia: { tipo: 1, origem_mensagem_id: original } })).dados.id
    expect(await listar(ana)).toMatchObject([{ tipo: 2, autor_id: bruno.id, mensagem_id: resposta, texto: 'resposta' }])
  })

  test('menção vira atividade só de membros da conversa; o texto mostra @Nome', async () => {
    const grupo = await criarConversa(ana, [bruno])
    await enviarTexto(ana, grupo, `olha isso ${mencao(bruno)} e ${mencao(carla)}`)
    expect(await listar(bruno)).toMatchObject([{ tipo: 3, autor_id: ana.id, texto: 'olha isso @Fulano e @Fulano' }])
    // Carla não está na conversa
    expect(await listar(carla)).toEqual([])
  })

  test('respondido e mencionado na mesma mensagem recebe uma atividade só', async () => {
    const conversa = await criarConversa(ana, [bruno, carla])
    const original = (await enviarTexto(ana, conversa, 'pergunta')).dados.id
    await enviarTexto(bruno, conversa, `${mencao(ana)} veja`, { mensagem_referencia: { tipo: 1, origem_mensagem_id: original } })
    expect((await listar(ana)).map((a) => a.tipo)).toEqual([2])
  })

  test('ocultar a mensagem apaga as atividades dela', async () => {
    const conversa = await criarConversa(ana, [bruno])
    const mensagem = (await enviarTexto(ana, conversa, `oi ${mencao(bruno)}`)).dados.id
    expect(await listar(bruno)).toHaveLength(1)
    await chamar('DELETE', '/mensagem', { token: ana.token, consulta: { id: mensagem } })
    expect(await listar(bruno)).toEqual([])
  })

  test('menção em mensagem agendada só aparece quando ela sai', async () => {
    const conversa = await criarConversa(ana, [bruno])
    const daqui10min = new Date(Date.now() + 10 * 60 * 1000).toISOString()
    expect((await enviarTexto(ana, conversa, `depois ${mencao(bruno)}`, { visivel_em: daqui10min })).status).toBe(200)
    expect(await listar(bruno)).toEqual([])
    expect(await novas(bruno)).toBe(0)
  })
})

describe('chamada perdida', () => {
  async function ligar(de: UsuarioTeste, para: UsuarioTeste[]) {
    const conversa = await criarConversa(de, para)
    const { dados } = await chamar('PUT', '/chamada/iniciar', {
      token: de.token,
      corpo: { tipo: 1, usuarios: [{ id: de.id }, ...para.map((u) => ({ id: u.id }))], conversa_id: conversa },
    })
    return { chamada: dados.id as number, conversa }
  }

  test('deixar tocar até o app recusar sozinho é chamada perdida', async () => {
    const { chamada, conversa } = await ligar(ana, [bruno])
    await chamar('POST', '/chamada/recusar', { token: bruno.token, corpo: { id: chamada, nao_atendeu: true } })
    expect(await listar(bruno)).toMatchObject([{ tipo: 4, autor_id: ana.id, chamada_id: chamada, conversa_id: conversa }])
    // Para a chamada, continua sendo recusa
    expect((await chamar('GET', '/chamada/dados', { token: ana.token, consulta: { id: chamada } })).dados.status).toBe(2)
  })

  test('recusar no botão não é chamada perdida', async () => {
    const { chamada } = await ligar(ana, [bruno])
    await chamar('POST', '/chamada/recusar', { token: bruno.token, corpo: { id: chamada } })
    expect(await listar(bruno)).toEqual([])
  })

  test('quem ainda estava tocando quando a chamada terminou perdeu a chamada, uma vez só', async () => {
    const { chamada } = await ligar(ana, [bruno, carla])
    await chamar('POST', '/chamada/entrar', { token: bruno.token, corpo: { id: chamada } })
    await chamar('POST', '/chamada/finalizar', { token: ana.token, corpo: { id: chamada } })
    await chamar('POST', '/chamada/recusar', { token: carla.token, corpo: { id: chamada, nao_atendeu: true } })
    expect((await listar(carla)).map((a) => a.chamada_id)).toEqual([chamada])
    expect(await listar(bruno)).toEqual([])
  })

  test('quem ligou e desistiu deixa chamada perdida para quem não atendeu', async () => {
    const { chamada } = await ligar(ana, [bruno])
    await chamar('POST', '/chamada/cancelar', { token: ana.token, corpo: { id: chamada } })
    expect(await listar(bruno)).toMatchObject([{ tipo: 4, chamada_id: chamada }])
  })
})

describe('lista, novas e vistas', () => {
  test('mais recentes primeiro, em páginas', async () => {
    const conversa = await criarConversa(ana, [bruno])
    for (const texto of ['um', 'dois', 'tres']) {
      const mensagem = (await enviarTexto(ana, conversa, texto)).dados.id
      await reagir(bruno, mensagem, '👍')
    }
    const primeira = await listar(ana, { limite: 2 })
    expect(primeira.map((a) => a.texto)).toEqual(['tres', 'dois'])
    const segunda = await listar(ana, { limite: 2, antes: primeira[1]!.id })
    expect(segunda.map((a) => a.texto)).toEqual(['um'])
  })

  test('o número conta as pendentes: abrir a tela não conclui; concluir à mão sim, e avisa', async () => {
    const conversa = await criarConversa(ana, [bruno])
    const mensagem = (await enviarTexto(ana, conversa, 'oi')).dados.id
    await reagir(bruno, mensagem, '👍')
    await reagir(bruno, mensagem, '🎉')
    expect(await novas(ana)).toBe(2)
    expect((await chamar('POST', '/atividades/vistas', { token: ana.token })).status).toBe(200)
    expect(await novas(ana)).toBe(2)
    const [primeira] = await listar(ana)
    const daAna = await conectarSocket(ana)
    abertos.push(daAna)
    expect((await chamar('POST', '/atividade/concluir', { token: ana.token, corpo: { id: primeira!.id } })).status).toBe(200)
    await daAna.esperar((e) => e.tipo === 61)
    expect(await novas(ana)).toBe(1)
    expect((await listar(ana)).map((a) => a.pendente)).toEqual([false, true])
    // Só a própria atividade
    await chamar('POST', '/atividade/concluir', { token: bruno.token, corpo: { id: (await listar(ana))[1]!.id } })
    expect(await novas(ana)).toBe(1)
  })

  test('quem saiu da conversa não vê mais as atividades dela', async () => {
    const grupo = await criarConversa(ana, [bruno, carla])
    await enviarTexto(ana, grupo, `oi ${mencao(bruno)}`)
    expect(await listar(bruno)).toHaveLength(1)
    const membros = (await chamar('GET', '/conversa/usuarios', { token: bruno.token, consulta: { conversa: grupo } })).dados as { id: number; usuario_id: number }[]
    const doBruno = membros.find((m) => m.usuario_id === bruno.id)!
    expect((await chamar('DELETE', '/conversa/usuario', { token: bruno.token, consulta: { id: doBruno.id } })).status).toBe(200)
    expect(await listar(bruno)).toEqual([])
  })
})

describe('lida no chat', () => {
  const visualizar = (quem: UsuarioTeste, conversa: number, mensagem: number) =>
    chamar('POST', '/mensagem/visualizar', { token: quem.token, corpo: { conversa, mensagem } })

  test('resposta e menção lidas no chat deixam de contar como novas, e quem leu é avisado', async () => {
    const conversa = await criarConversa(ana, [bruno])
    const original = (await enviarTexto(ana, conversa, 'pergunta')).dados.id
    const resposta = (await enviarTexto(bruno, conversa, 'resposta', { mensagem_referencia: { tipo: 1, origem_mensagem_id: original } })).dados.id
    const comMencao = (await enviarTexto(bruno, conversa, `veja ${mencao(ana)}`)).dados.id
    expect(await novas(ana)).toBe(2)

    const daAna = await conectarSocket(ana)
    abertos.push(daAna)
    expect((await visualizar(ana, conversa, resposta)).status).toBe(200)
    await daAna.esperar((e) => e.tipo === 61)
    expect(await novas(ana)).toBe(1)

    await visualizar(ana, conversa, comMencao)
    expect(await novas(ana)).toBe(0)
    // Continuam na lista, concluídas
    expect((await listar(ana)).map((a) => a.pendente)).toEqual([false, false])
  })

  test('reação não depende de leitura', async () => {
    const conversa = await criarConversa(ana, [bruno])
    const mensagem = (await enviarTexto(ana, conversa, 'oi')).dados.id
    await reagir(bruno, mensagem, '👍')
    await visualizar(ana, conversa, mensagem)
    expect(await novas(ana)).toBe(1)
  })

  test('resposta de postagem deixa de contar quando as respostas são vistas', async () => {
    const grupo = await criarConversa(ana, [bruno, carla])
    const postagem = (await enviarTexto(ana, grupo, 'Pauta', { postagem: { titulo: null } })).dados.id
    await enviarTexto(bruno, grupo, 'eu topo', { postagem_id: postagem })
    expect(await novas(ana)).toBe(1)
    const daAna = await conectarSocket(ana)
    abertos.push(daAna)
    await chamar('POST', '/postagem/visualizar', { token: ana.token, corpo: { postagem_id: postagem } })
    await daAna.esperar((e) => e.tipo === 61)
    expect(await novas(ana)).toBe(0)
  })
})

describe('pedido de confirmação de leitura', () => {
  const confirmar = (quem: UsuarioTeste, mensagem: number) => chamar('POST', '/mensagem/confirmar', { token: quem.token, corpo: { mensagem_id: mensagem } })

  test('quem precisa confirmar ganha a atividade, pendente até confirmar (ler não basta)', async () => {
    const grupo = await criarConversa(ana, [bruno, carla])
    const mensagem = (await enviarTexto(ana, grupo, 'leiam', { pede_confirmacao: true, confirmacao_usuarios: [bruno.id] })).dados.id
    expect(await listar(bruno)).toMatchObject([{ tipo: 5, autor_id: ana.id, mensagem_id: mensagem, pendente: true }])
    expect(await listar(carla)).toEqual([])
    await chamar('POST', '/mensagem/visualizar', { token: bruno.token, corpo: { conversa: grupo, mensagem } })
    expect(await novas(bruno)).toBe(1)
    const doBruno = await conectarSocket(bruno)
    abertos.push(doBruno)
    expect((await confirmar(bruno, mensagem)).status).toBe(200)
    await doBruno.esperar((e) => e.tipo === 61)
    expect(await novas(bruno)).toBe(0)
    expect((await listar(bruno))[0]!.pendente).toBe(false)
  })

  test('concluir à mão tira do número e deixa a confirmação pendente', async () => {
    const conversa = await criarConversa(ana, [bruno])
    const mensagem = (await enviarTexto(ana, conversa, 'confirma?', { pede_confirmacao: true })).dados.id
    const [atividade] = await listar(bruno)
    await chamar('POST', '/atividade/concluir', { token: bruno.token, corpo: { id: atividade!.id } })
    expect(await novas(bruno)).toBe(0)
    const dados = (await chamar('GET', '/mensagens', { token: bruno.token, consulta: { conversa, mensagemreferencia: 0, mensagensprevias: 10, mensagensseguintes: 0 } })).dados as { id: number; confirmacao?: { pode_confirmar: boolean } }[]
    expect(dados.find((m) => m.id === mensagem)!.confirmacao).toMatchObject({ pode_confirmar: true })
    expect((await confirmar(bruno, mensagem)).status).toBe(200)
  })

  test('pedir depois também cria a atividade', async () => {
    const conversa = await criarConversa(ana, [bruno])
    const mensagem = (await enviarTexto(ana, conversa, 'sem pedir')).dados.id
    expect(await listar(bruno)).toEqual([])
    expect((await chamar('POST', '/mensagem/pedir-confirmacao', { token: ana.token, corpo: { mensagem_id: mensagem } })).status).toBe(200)
    expect(await listar(bruno)).toMatchObject([{ tipo: 5, mensagem_id: mensagem, pendente: true }])
  })
})

describe('reação vista na mensagem', () => {
  const vistas = (quem: UsuarioTeste, mensagens: number[]) => chamar('POST', '/atividades/reacoes-vistas', { token: quem.token, corpo: { mensagens } })

  test('ver a própria mensagem com a reação conclui as reações dela, e avisa', async () => {
    const conversa = await criarConversa(ana, [bruno, carla])
    const uma = (await enviarTexto(ana, conversa, 'um')).dados.id
    const outra = (await enviarTexto(ana, conversa, 'dois')).dados.id
    await reagir(bruno, uma, '👍')
    await reagir(carla, uma, '❤️')
    await reagir(bruno, outra, '🎉')
    expect(await novas(ana)).toBe(3)
    const daAna = await conectarSocket(ana)
    abertos.push(daAna)
    expect((await vistas(ana, [uma])).dados).toEqual({ concluidas: 2 })
    await daAna.esperar((e) => e.tipo === 61)
    expect(await novas(ana)).toBe(1)
    // Outra pessoa não conclui as de Ana
    expect((await vistas(bruno, [outra])).dados).toEqual({ concluidas: 0 })
    expect(await novas(ana)).toBe(1)
  })
})

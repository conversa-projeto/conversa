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
  nova: boolean
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
    expect(atividade).toMatchObject({ tipo: 1, autor_id: bruno.id, autor_nome: 'Bruno Atividade', conversa_id: conversa, mensagem_id: mensagem, emoji: '😂', texto: 'bom dia', nova: true })
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

  test('as novas contam até o usuário ver; depois deixam de ser novas', async () => {
    const conversa = await criarConversa(ana, [bruno])
    const mensagem = (await enviarTexto(ana, conversa, 'oi')).dados.id
    await reagir(bruno, mensagem, '👍')
    await reagir(bruno, mensagem, '🎉')
    expect(await novas(ana)).toBe(2)
    expect((await chamar('POST', '/atividades/vistas', { token: ana.token })).status).toBe(200)
    expect(await novas(ana)).toBe(0)
    expect((await listar(ana)).every((a) => !a.nova)).toBe(true)
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

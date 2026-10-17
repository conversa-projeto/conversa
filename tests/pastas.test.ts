import { afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { chamar, conectarSocket, criarConversa, enviarTexto, usuariosComuns, type SocketTeste, type UsuarioTeste } from './api.ts'

let ana: UsuarioTeste, bruno: UsuarioTeste, carla: UsuarioTeste
beforeAll(async () => ({ ana, bruno, carla } = await usuariosComuns()))

const abertos: SocketTeste[] = []
afterEach(async () => {
  await Promise.all(abertos.splice(0).map((socket) => socket.fechar()))
})

interface Pasta {
  id: number
  conversa_id: number
  dono_id: number
  nome: string
  cor: string
  compartilhada: boolean
  mensagens: number
}

const criar = (quem: UsuarioTeste, conversa: number, extras: Record<string, unknown> = {}) =>
  chamar('PUT', '/pasta', { token: quem.token, corpo: { conversa_id: conversa, nome: 'Contratos', ...extras } })
const listar = async (quem: UsuarioTeste, conversa: number) =>
  (await chamar('GET', '/pastas', { token: quem.token, consulta: { conversa } })).dados as Pasta[]
const por = (quem: UsuarioTeste, pasta: number, mensagens: number[]) =>
  chamar('PUT', '/pasta/mensagens', { token: quem.token, corpo: { pasta_id: pasta, mensagens } })
const tirar = (quem: UsuarioTeste, pasta: number, mensagens: number[]) =>
  chamar('DELETE', '/pasta/mensagens', { token: quem.token, corpo: { pasta_id: pasta, mensagens } })
const daPasta = async (quem: UsuarioTeste, pasta: number, antes = 0) =>
  (await chamar('GET', '/pasta/mensagens', { token: quem.token, consulta: { id: pasta, antes } }))
const doChat = async (quem: UsuarioTeste, conversa: number) =>
  (await chamar('GET', '/mensagens', { token: quem.token, consulta: { conversa, mensagemreferencia: 0, mensagensprevias: 80, mensagensseguintes: 0 } })).dados as { id: number; pastas?: number[] }[]

describe('criar e listar', () => {
  test('só em conversa direta, com nome', async () => {
    const direta = await criarConversa(ana, [bruno])
    const { status, dados } = await criar(ana, direta, { cor: '#f59e0b' })
    expect(status).toBe(200)
    expect(dados).toMatchObject({ conversa_id: direta, dono_id: ana.id, nome: 'Contratos', cor: '#f59e0b', compartilhada: false, mensagens: 0 })
    expect((await criar(ana, direta, { nome: '   ' })).status).toBe(400)
    const grupo = await criarConversa(ana, [bruno, carla])
    expect((await criar(ana, grupo)).status).toBe(400)
    expect((await criar(carla, direta)).status).toBe(403)
  })

  test('a pasta não compartilhada só o dono vê; compartilhada, os dois', async () => {
    const direta = await criarConversa(ana, [bruno])
    const privada = (await criar(ana, direta, { nome: 'Minha' })).dados as Pasta
    const comum = (await criar(ana, direta, { nome: 'Nossa', compartilhada: true })).dados as Pasta
    expect((await listar(ana, direta)).map((p) => p.id)).toEqual([privada.id, comum.id])
    expect((await listar(bruno, direta)).map((p) => p.id)).toEqual([comum.id])
    expect((await daPasta(bruno, privada.id)).status).toBe(404)
  })
})

describe('mudar e excluir', () => {
  test('só o dono renomeia, compartilha e exclui', async () => {
    const direta = await criarConversa(ana, [bruno])
    const pasta = (await criar(ana, direta, { compartilhada: true })).dados as Pasta
    expect((await chamar('PATCH', '/pasta', { token: bruno.token, corpo: { id: pasta.id, nome: 'Outro' } })).status).toBe(403)
    expect((await chamar('DELETE', '/pasta', { token: bruno.token, consulta: { id: pasta.id } })).status).toBe(403)

    const alterada = await chamar('PATCH', '/pasta', { token: ana.token, corpo: { id: pasta.id, nome: 'Notas', compartilhada: false } })
    expect(alterada.dados).toMatchObject({ nome: 'Notas', compartilhada: false })
    expect(await listar(bruno, direta)).toEqual([])

    expect((await chamar('DELETE', '/pasta', { token: ana.token, consulta: { id: pasta.id } })).status).toBe(200)
    expect(await listar(ana, direta)).toEqual([])
  })
})

describe('mensagens na pasta', () => {
  test('continuam no chat, com a pasta marcada só para quem a vê', async () => {
    const direta = await criarConversa(ana, [bruno])
    const m1 = (await enviarTexto(ana, direta, 'primeira')).dados.id as number
    const m2 = (await enviarTexto(bruno, direta, 'segunda')).dados.id as number
    await enviarTexto(ana, direta, 'terceira')
    const pasta = (await criar(ana, direta)).dados as Pasta

    const { status, dados } = await por(ana, pasta.id, [m1, m2])
    expect(status).toBe(200)
    expect(dados).toEqual({ pasta_id: pasta.id, incluidas: 2 })
    // De novo não duplica
    expect((await por(ana, pasta.id, [m1])).dados.incluidas).toBe(0)

    const chatAna = await doChat(ana, direta)
    expect(chatAna).toHaveLength(3)
    expect(chatAna.find((m) => m.id === m1)!.pastas).toEqual([pasta.id])
    expect((await doChat(bruno, direta)).find((m) => m.id === m1)!.pastas).toBeUndefined()

    const lista = await daPasta(ana, pasta.id)
    expect(lista.dados.map((m: { id: number }) => m.id)).toEqual([m1, m2])
    expect((await listar(ana, direta))[0]!.mensagens).toBe(2)

    expect((await tirar(ana, pasta.id, [m1])).dados.tiradas).toBe(1)
    expect((await daPasta(ana, pasta.id)).dados.map((m: { id: number }) => m.id)).toEqual([m2])
  })

  test('na compartilhada a outra pessoa também põe e tira', async () => {
    const direta = await criarConversa(ana, [bruno])
    const m1 = (await enviarTexto(ana, direta, 'oi')).dados.id as number
    const pasta = (await criar(ana, direta, { compartilhada: true })).dados as Pasta
    expect((await por(bruno, pasta.id, [m1])).status).toBe(200)
    expect((await doChat(bruno, direta)).find((m) => m.id === m1)!.pastas).toEqual([pasta.id])
    expect((await tirar(bruno, pasta.id, [m1])).dados.tiradas).toBe(1)
  })

  test('mensagem de outra conversa é recusada', async () => {
    const direta = await criarConversa(ana, [bruno])
    const outra = await criarConversa(ana, [carla])
    const alheia = (await enviarTexto(ana, outra, 'longe')).dados.id as number
    const pasta = (await criar(ana, direta)).dados as Pasta
    expect((await por(ana, pasta.id, [alheia])).status).toBe(400)
  })

  test('pagina das mais recentes para as antigas', async () => {
    const direta = await criarConversa(ana, [bruno])
    const ids: number[] = []
    for (let i = 0; i < 55; i++) ids.push((await enviarTexto(ana, direta, `m${i}`)).dados.id)
    const pasta = (await criar(ana, direta)).dados as Pasta
    await por(ana, pasta.id, ids)
    const recentes = (await daPasta(ana, pasta.id)).dados.map((m: { id: number }) => m.id)
    expect(recentes).toEqual(ids.slice(5))
    const antigas = (await daPasta(ana, pasta.id, recentes[0])).dados.map((m: { id: number }) => m.id)
    expect(antigas).toEqual(ids.slice(0, 5))
  })
})

describe('aviso pelo WebSocket', () => {
  test('compartilhada avisa a outra pessoa; privada, não', async () => {
    const direta = await criarConversa(ana, [bruno])
    const m1 = (await enviarTexto(ana, direta, 'oi')).dados.id as number
    const socketBruno = await conectarSocket(bruno)
    abertos.push(socketBruno)
    const privada = (await criar(ana, direta)).dados as Pasta
    await por(ana, privada.id, [m1])
    await socketBruno.nadaChega((e) => e.tipo === 67)

    const comum = (await criar(ana, direta, { compartilhada: true })).dados as Pasta
    await socketBruno.esperar((e) => e.tipo === 67 && e.pasta_id === comum.id)
    await por(ana, comum.id, [m1])
    const evento = await socketBruno.esperar((e) => e.tipo === 67 && e.acao === 'incluir')
    expect(evento).toMatchObject({ conversa_id: direta, pasta_id: comum.id, mensagens: [m1] })
  })
})

import { afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { chamar, conectarSocket, criarConversa, criarUsuario, enviarTexto, noBanco, usuariosComuns, type SocketTeste, type UsuarioTeste } from './api.ts'

let ana: UsuarioTeste, bruno: UsuarioTeste, carla: UsuarioTeste
beforeAll(async () => ({ ana, bruno, carla } = await usuariosComuns()))

const abertos: SocketTeste[] = []
afterEach(async () => {
  await Promise.all(abertos.splice(0).map((socket) => socket.fechar()))
})

interface Enquete {
  id: number
  pergunta: string
  multipla: boolean
  opcoes: { id: number; texto: string; votantes: { id: number; nome: string }[] }[]
  total_votantes: number
  meus_votos: number[]
  encerra_em: string | null
  encerrada_em: string | null
  encerrada: boolean
  pode_encerrar: boolean
  pode_alterar_prazo: boolean
}

const criar = (quem: UsuarioTeste, conversa: number, extras: Record<string, unknown> = {}) =>
  chamar('PUT', '/enquete', { token: quem.token, corpo: { conversa_id: conversa, pergunta: 'Almoço?', opcoes: ['Pizza', 'Sushi', 'Salada'], multipla: false, ...extras } })
const ler = async (quem: UsuarioTeste, id: number) => (await chamar('GET', '/enquete', { token: quem.token, consulta: { id } })).dados as Enquete
const votar = (quem: UsuarioTeste, enquete: number, opcoes: number[]) =>
  chamar('POST', '/enquete/votar', { token: quem.token, corpo: { enquete_id: enquete, opcoes } })

describe('criar', () => {
  test('em grupo vira uma mensagem com a enquete; a prévia diz "enquete"', async () => {
    const grupo = await criarConversa(ana, [bruno, carla])
    const { status, dados } = await criar(ana, grupo)
    expect(status).toBe(200)
    const mensagens = (await chamar('GET', '/mensagens', { token: bruno.token, consulta: { conversa: grupo, mensagemreferencia: 0, mensagensprevias: 80, mensagensseguintes: 0 } })).dados
    expect(mensagens.at(-1).conteudos).toMatchObject([{ tipo: 8, conteudo: String(dados.enquete_id) }])
    const enquete = await ler(bruno, dados.enquete_id)
    expect(enquete).toMatchObject({ pergunta: 'Almoço?', multipla: false, total_votantes: 0, meus_votos: [] })
    expect(enquete.opcoes.map((o) => o.texto)).toEqual(['Pizza', 'Sushi', 'Salada'])
    const conversas = (await chamar('GET', '/conversas', { token: bruno.token })).dados as { id: number; ultima_mensagem_texto: string }[]
    expect(conversas.find((c) => c.id === grupo)!.ultima_mensagem_texto).toBe('enquete')
  })

  test('só em grupo; opções vazias, repetidas ou poucas são recusadas', async () => {
    const direta = await criarConversa(ana, [bruno])
    expect((await criar(ana, direta)).status).toBe(400)
    const grupo = await criarConversa(ana, [bruno, carla])
    expect((await criar(ana, grupo, { opcoes: ['Sim', ' '] })).status).toBe(400)
    expect((await criar(ana, grupo, { opcoes: ['Sim', 'sim'] })).status).toBe(400)
    expect((await criar(ana, grupo, { pergunta: '  ' })).status).toBe(400)
  })

  test('não se cria nem encaminha enquete como mensagem comum', async () => {
    const grupo = await criarConversa(ana, [bruno, carla])
    const { dados } = await criar(ana, grupo)
    const { status } = await chamar('PUT', '/mensagem', { token: ana.token, corpo: { conversa_id: grupo, conteudos: [{ ordem: 1, tipo: 8, conteudo: String(dados.enquete_id) }] } })
    expect(status).toBe(400)
  })

  test('quem não está na conversa não cria, não vê nem vota', async () => {
    const grupo = await criarConversa(ana, [bruno, carla])
    const id = (await criar(ana, grupo)).dados.enquete_id
    const intruso = await criarUsuario('Intruso Enquete')
    expect((await criar(intruso, grupo)).status).toBe(403)
    expect((await chamar('GET', '/enquete', { token: intruso.token, consulta: { id } })).status).toBe(403)
    expect((await votar(intruso, id, [])).status).toBe(403)
  })
})

describe('votar', () => {
  test('escolha única: votar em outra troca o voto; lista vazia tira; duas opções é 400', async () => {
    const grupo = await criarConversa(ana, [bruno, carla])
    const id = (await criar(ana, grupo)).dados.enquete_id
    const [pizza, sushi] = (await ler(ana, id)).opcoes
    await votar(bruno, id, [pizza!.id])
    await votar(bruno, id, [sushi!.id])
    let enquete = await ler(bruno, id)
    expect(enquete.meus_votos).toEqual([sushi!.id])
    expect(enquete.opcoes.find((o) => o.id === pizza!.id)!.votantes).toEqual([])
    expect(enquete.opcoes.find((o) => o.id === sushi!.id)!.votantes.map((v) => v.id)).toEqual([bruno.id])
    expect((await votar(bruno, id, [pizza!.id, sushi!.id])).status).toBe(400)
    await votar(bruno, id, [])
    enquete = await ler(bruno, id)
    expect(enquete.total_votantes).toBe(0)
  })

  test('múltipla escolha: cada um marca várias; o total conta pessoas, não votos', async () => {
    const grupo = await criarConversa(ana, [bruno, carla])
    const id = (await criar(ana, grupo, { multipla: true })).dados.enquete_id
    const [pizza, sushi, salada] = (await ler(ana, id)).opcoes
    await votar(bruno, id, [pizza!.id, sushi!.id])
    const resposta = await votar(carla, id, [sushi!.id, salada!.id])
    const enquete = resposta.dados as Enquete
    expect(enquete.total_votantes).toBe(2)
    expect(enquete.opcoes.map((o) => o.votantes.length)).toEqual([1, 2, 1])
    expect(enquete.meus_votos).toEqual([sushi!.id, salada!.id])
  })

  test('opção de outra enquete é recusada', async () => {
    const grupo = await criarConversa(ana, [bruno, carla])
    const primeira = (await criar(ana, grupo)).dados.enquete_id
    const segunda = (await criar(ana, grupo)).dados.enquete_id
    const deOutra = (await ler(ana, segunda)).opcoes[0]!.id
    expect((await votar(bruno, primeira, [deOutra])).status).toBe(400)
  })

  test('cada voto avisa os membros pelo socket, inclusive quem votou', async () => {
    const grupo = await criarConversa(ana, [bruno, carla])
    const id = (await criar(ana, grupo)).dados.enquete_id
    const daAna = await conectarSocket(ana)
    const doBruno = await conectarSocket(bruno)
    abertos.push(daAna, doBruno)
    await votar(bruno, id, [(await ler(bruno, id)).opcoes[0]!.id])
    await daAna.esperar((e) => e.tipo === 62 && e.enquete_id === id && e.conversa_id === grupo)
    await doBruno.esperar((e) => e.tipo === 62 && e.enquete_id === id)
  })
})

describe('prazo e encerramento', () => {
  const daqui = (minutos: number) => new Date(Date.now() + minutos * 60 * 1000).toISOString()
  const encerrar = (quem: UsuarioTeste, enquete: number) => chamar('POST', '/enquete/encerrar', { token: quem.token, corpo: { enquete_id: enquete } })
  const prazo = (quem: UsuarioTeste, enquete: number, encerra_em: string | null) => chamar('PATCH', '/enquete', { token: quem.token, corpo: { enquete_id: enquete, encerra_em } })

  test('data final na criação: no futuro e até 1 ano', async () => {
    const grupo = await criarConversa(ana, [bruno, carla])
    expect((await criar(ana, grupo, { encerra_em: daqui(-5) })).status).toBe(400)
    expect((await criar(ana, grupo, { encerra_em: daqui(60 * 24 * 400) })).status).toBe(400)
    expect((await criar(ana, grupo, { encerra_em: 'amanhã' })).status).toBe(400)
    const { dados } = await criar(ana, grupo, { encerra_em: daqui(90) })
    const enquete = await ler(bruno, dados.enquete_id)
    expect(enquete.encerrada).toBe(false)
    expect(new Date(enquete.encerra_em!).getTime()).toBeGreaterThan(Date.now())
  })

  test('prazo vencido encerra: ninguém vota mais e ninguém encerra de novo', async () => {
    const grupo = await criarConversa(ana, [bruno, carla])
    const id = (await criar(ana, grupo, { encerra_em: daqui(30) })).dados.enquete_id
    const pizza = (await ler(ana, id)).opcoes[0]!.id
    expect((await votar(bruno, id, [pizza])).status).toBe(200)
    await noBanco((sql) => sql`update enquete set encerra_em = now() at time zone 'UTC' - interval '1 minute' where id = ${id}`)
    const enquete = await ler(ana, id)
    expect(enquete).toMatchObject({ encerrada: true, pode_encerrar: false, pode_alterar_prazo: false, total_votantes: 1 })
    const voto = await votar(carla, id, [pizza])
    expect(voto.status).toBe(400)
    expect(voto.dados.error).toBe('Esta votação já foi encerrada.')
    expect((await encerrar(ana, id)).status).toBe(400)
  })

  test('encerram antes do prazo: quem criou a votação e quem criou o grupo; os demais não', async () => {
    // Ana criou o grupo; Bruno cria as votações
    const grupo = await criarConversa(ana, [bruno, carla])
    const daBruno = (await criar(bruno, grupo)).dados.enquete_id
    expect((await ler(bruno, daBruno)).pode_encerrar).toBe(true)
    expect((await ler(ana, daBruno)).pode_encerrar).toBe(true)
    expect((await ler(carla, daBruno)).pode_encerrar).toBe(false)
    expect((await encerrar(carla, daBruno)).status).toBe(403)

    const socket = await conectarSocket(carla)
    abertos.push(socket)
    const { status, dados } = await encerrar(ana, daBruno)
    expect(status).toBe(200)
    expect(dados).toMatchObject({ encerrada: true, pode_encerrar: false })
    expect(dados.encerrada_em).toBeTruthy()
    await socket.esperar((evento) => evento.tipo === 62 && evento.enquete_id === daBruno)

    const outra = (await criar(bruno, grupo)).dados.enquete_id
    expect((await encerrar(bruno, outra)).status).toBe(200)
    expect((await votar(carla, outra, [])).status).toBe(400)
  })

  test('a data final muda só por quem criou, enquanto aberta; null tira o prazo', async () => {
    const grupo = await criarConversa(ana, [bruno, carla])
    const id = (await criar(bruno, grupo, { encerra_em: daqui(30) })).dados.enquete_id
    // Dono do grupo encerra, mas não mexe na data
    expect((await ler(ana, id)).pode_alterar_prazo).toBe(false)
    expect((await prazo(ana, id, daqui(120))).status).toBe(403)
    expect((await prazo(bruno, id, daqui(-1))).status).toBe(400)

    const adiada = await prazo(bruno, id, daqui(120))
    expect(adiada.status).toBe(200)
    expect(new Date(adiada.dados.encerra_em).getTime()).toBeGreaterThan(Date.now() + 100 * 60 * 1000)
    const semPrazo = await prazo(bruno, id, null)
    expect(semPrazo.dados.encerra_em).toBeNull()

    await encerrar(bruno, id)
    expect((await prazo(bruno, id, daqui(60))).status).toBe(400)
  })
})

describe('mensagem comum continua igual', () => {
  test('texto ainda é enviado normalmente', async () => {
    const grupo = await criarConversa(ana, [bruno, carla])
    expect((await enviarTexto(ana, grupo, 'oi')).status).toBe(200)
  })
})

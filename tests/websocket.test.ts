import { afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { chamar, conectarSocket, criarConversa, criarUsuario, enviarTexto, type SocketTeste, type UsuarioTeste } from './api.ts'

// Usuarios proprios: o status online de um afeta o que os outros arquivos veem.
let ana: UsuarioTeste, bruno: UsuarioTeste, carla: UsuarioTeste
beforeAll(async () => {
  ;[ana, bruno, carla] = await Promise.all([criarUsuario('Ana Socket'), criarUsuario('Bruno Socket'), criarUsuario('Carla Socket')])
})

const abertos: SocketTeste[] = []
async function conectar(usuario?: UsuarioTeste) {
  const socket = await conectarSocket(usuario)
  abertos.push(socket)
  return socket
}
afterEach(async () => {
  await Promise.all(abertos.splice(0).map((socket) => socket.fechar()))
  await Bun.sleep(100)
})

const online = async (quem: UsuarioTeste) => (await chamar('GET', '/contatos/online', { token: quem.token })).dados as number[]

describe('login pelo socket', () => {
  test('JSON inválido recebe erro', async () => {
    const socket = await conectar()
    socket.enviar('isto não é json')
    const erro = await socket.esperar((e) => e.tipo === 9)
    expect(String(erro.message)).toContain('JSON inválido')
  })

  test('mensagem sem "tipo" recebe erro', async () => {
    const socket = await conectar()
    socket.enviar({ token: 'x' })
    const erro = await socket.esperar((e) => e.tipo === 9)
    expect(String(erro.message)).toContain('"tipo" não encontrado')
  })

  test('token inválido recebe erro e não conecta', async () => {
    await criarConversa(ana, [bruno])
    const socket = await conectar()
    socket.enviar({ tipo: 1, token: 'token-falso' })
    await socket.esperar((e) => e.tipo === 0)
    expect(await online(bruno)).not.toContain(ana.id)
  })
})

describe('online e offline', () => {
  test('contato de conversa direta aparece online e recebe o aviso', async () => {
    await criarConversa(ana, [bruno])
    const doBruno = await conectar(bruno)
    await conectar(ana)
    const aviso = await doBruno.esperar((e) => e.tipo === 60 && e.usuario_id === ana.id)
    expect(aviso.online).toBe(true)
    expect(await online(bruno)).toContain(ana.id)
  })

  test('quem não tem conversa direta não recebe o aviso nem vê online', async () => {
    const daCarla = await conectar(carla)
    await conectar(ana)
    await daCarla.nadaChega((e) => e.tipo === 60 && e.usuario_id === ana.id)
    const conversaSoEmGrupo = await criarConversa(ana, [carla, bruno])
    expect(conversaSoEmGrupo).toBeGreaterThan(0)
    expect(await online(carla)).not.toContain(ana.id)
  })

  test('com duas abas, só fica offline ao fechar a última', async () => {
    await criarConversa(ana, [bruno])
    const doBruno = await conectar(bruno)
    const aba1 = await conectar(ana)
    const aba2 = await conectar(ana)
    await aba1.fechar()
    await doBruno.nadaChega((e) => e.tipo === 60 && e.usuario_id === ana.id && e.online === false)
    expect(await online(bruno)).toContain(ana.id)
    await aba2.fechar()
    await doBruno.esperar((e) => e.tipo === 60 && e.usuario_id === ana.id && e.online === false)
    expect(await online(bruno)).not.toContain(ana.id)
  })
})

describe('eventos chegam só a quem participa', () => {
  test('digitando', async () => {
    const conversa = await criarConversa(ana, [bruno])
    const doBruno = await conectar(bruno)
    const daCarla = await conectar(carla)
    const daAna = await conectar(ana)
    await chamar('POST', '/conversa/digitando', { token: ana.token, corpo: { id: conversa } })
    await doBruno.esperar((e) => e.tipo === 4 && e.conversa_id === conversa && e.usuario_id === ana.id)
    await daCarla.nadaChega((e) => e.tipo === 4)
    await daAna.nadaChega((e) => e.tipo === 4)
  })

  test('nova mensagem, com o nome de quem enviou e o texto resumido', async () => {
    const conversa = await criarConversa(ana, [bruno])
    const doBruno = await conectar(bruno)
    const daCarla = await conectar(carla)
    await enviarTexto(ana, conversa, 'oi @[Bruno](1)\n```ts\nconst a = 1\n```')
    const aviso = await doBruno.esperar((e) => e.tipo === 2)
    expect(aviso).toMatchObject({ titulo: 'Ana Socket', mensagem: 'oi @Bruno Código (ts)' })
    await daCarla.nadaChega((e) => e.tipo === 2)
  })

  test('reação', async () => {
    const conversa = await criarConversa(ana, [bruno])
    const enviada = await enviarTexto(ana, conversa, 'reaja')
    const daAna = await conectar(ana)
    await chamar('PUT', '/mensagem/reacao', { token: bruno.token, corpo: { mensagem_id: enviada.dados.id, emoji: '❤️' } })
    const aviso = await daAna.esperar((e) => e.tipo === 7)
    expect(aviso).toMatchObject({ conversa_id: conversa, mensagem_id: enviada.dados.id, usuario_id: bruno.id, emoji: '❤️', acao: 'add' })
  })

  test('status: quem enviou fica sabendo quando o outro visualiza', async () => {
    const conversa = await criarConversa(ana, [bruno])
    const enviada = await enviarTexto(ana, conversa, 'viu?')
    const daAna = await conectar(ana)
    await chamar('POST', '/mensagem/visualizar', { token: bruno.token, corpo: { conversa, mensagem: enviada.dados.id } })
    const aviso = await daAna.esperar((e) => e.tipo === 3)
    expect(aviso).toMatchObject({ grupo: conversa, mensagens: String(enviada.dados.id) })
  })

  test('status: os outros ficam sabendo quando o autor exclui a mensagem', async () => {
    const conversa = await criarConversa(ana, [bruno, carla])
    const enviada = await enviarTexto(ana, conversa, 'vou excluir')
    const [doBruno, daCarla] = [await conectar(bruno), await conectar(carla)]
    await chamar('DELETE', '/mensagem', { token: ana.token, consulta: { id: enviada.dados.id } })
    for (const socket of [doBruno, daCarla]) {
      expect(await socket.esperar((e) => e.tipo === 3)).toMatchObject({ grupo: conversa, mensagens: String(enviada.dados.id) })
    }
  })

  test('chamada: convidado é avisado, e as outras abas de quem atende param de tocar', async () => {
    const conversa = await criarConversa(ana, [bruno])
    const doBruno1 = await conectar(bruno)
    const doBruno2 = await conectar(bruno)
    const daCarla = await conectar(carla)
    const ligacao = await chamar('PUT', '/chamada/iniciar', { token: ana.token, corpo: { tipo: 1, usuarios: [{ id: ana.id }, { id: bruno.id }], conversa_id: conversa } })
    const id = ligacao.dados.id
    await doBruno1.esperar((e) => e.tipo === 51 && e.chamada_id === id && e.usuario_id === ana.id)
    await doBruno2.esperar((e) => e.tipo === 51 && e.chamada_id === id)
    await chamar('POST', '/chamada/entrar', { token: bruno.token, corpo: { id } })
    // O aviso de "entrou" vai também ao próprio Bruno, para a outra aba parar de tocar
    await doBruno2.esperar((e) => e.tipo === 54 && e.chamada_id === id && e.usuario_id === bruno.id)
    await daCarla.nadaChega((e) => e.chamada_id === id)
  })

  test('conversa nova: quem é adicionado recebe o aviso', async () => {
    const doBruno = await conectar(bruno)
    const conversa = await criarConversa(ana, [bruno])
    await doBruno.esperar((e) => e.tipo === 40 && e.conversa_id === conversa)
  })
})

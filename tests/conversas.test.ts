import { beforeAll, describe, expect, test } from 'bun:test'
import { chamar, criarConversa, enviarTexto, usuariosComuns, type UsuarioTeste } from './api.ts'

let ana: UsuarioTeste, bruno: UsuarioTeste, carla: UsuarioTeste
beforeAll(async () => ({ ana, bruno, carla } = await usuariosComuns()))

describe('conversas', () => {
  test('quem cria entra como membro e vê a conversa na lista', async () => {
    const conversa = await criarConversa(ana, [bruno])
    const { status, dados } = await chamar('GET', '/conversas', { token: ana.token })
    expect(status).toBe(200)
    expect(dados.map((c: { id: number }) => c.id)).toContain(conversa)
  })

  test('membro adicionado também vê; quem está fora não', async () => {
    const conversa = await criarConversa(ana, [bruno])
    const ids = async (u: UsuarioTeste) => (await chamar('GET', '/conversas', { token: u.token })).dados.map((c: { id: number }) => c.id)
    expect(await ids(bruno)).toContain(conversa)
    expect(await ids(carla)).not.toContain(conversa)
  })

  test('lista de membros só para quem participa; quem está fora recebe lista vazia', async () => {
    const conversa = await criarConversa(ana, [bruno])
    const membros = await chamar('GET', '/conversa/usuarios', { token: bruno.token, consulta: { conversa } })
    expect(membros.status).toBe(200)
    expect(membros.dados.map((m: { usuario_id: number }) => m.usuario_id).sort()).toEqual([ana.id, bruno.id].sort())
    const deFora = await chamar('GET', '/conversa/usuarios', { token: carla.token, consulta: { conversa } })
    expect(deFora.dados).toEqual([])
  })

  test('quem está fora não altera nem exclui a conversa', async () => {
    const conversa = await criarConversa(ana, [bruno])
    expect((await chamar('PATCH', '/conversa', { token: carla.token, corpo: { id: conversa, descricao: 'Invadida' } })).status).toBe(403)
    expect((await chamar('DELETE', '/conversa', { token: carla.token, consulta: { id: conversa } })).status).toBe(403)
  })
})

describe('fixar e arquivar valem só para o usuário', () => {
  test('arquivar para um não arquiva para o outro', async () => {
    const conversa = await criarConversa(ana, [bruno])
    const arquivar = await chamar('PATCH', '/conversa/arquivada', { token: ana.token, corpo: { conversa, arquivada: true } })
    expect(arquivar.status).toBe(200)
    const daLista = async (u: UsuarioTeste) =>
      (await chamar('GET', '/conversas', { token: u.token })).dados.find((c: { id: number }) => c.id === conversa)
    expect((await daLista(ana)).arquivada_em).not.toBeNull()
    expect((await daLista(bruno)).arquivada_em).toBeNull()
  })

  test('não arquiva conversa da qual não participa', async () => {
    const conversa = await criarConversa(ana, [bruno])
    const { status } = await chamar('PATCH', '/conversa/arquivada', { token: carla.token, corpo: { conversa, arquivada: true } })
    expect(status).toBe(403)
  })

  test('fixadas seguem a ordem enviada', async () => {
    const primeira = await criarConversa(ana, [bruno])
    const segunda = await criarConversa(ana, [carla])
    const { status } = await chamar('PATCH', '/conversa/fixadas', { token: ana.token, corpo: { conversas: [segunda, primeira] } })
    expect(status).toBe(200)
    const lista = (await chamar('GET', '/conversas', { token: ana.token })).dados as { id: number; fixada_ordem: number | null }[]
    const ordem = (id: number) => lista.find((c) => c.id === id)!.fixada_ordem!
    expect(ordem(segunda)).toBeLessThan(ordem(primeira))
  })
})

describe('digitando e gravando', () => {
  test('participante avisa que está digitando', async () => {
    const conversa = await criarConversa(ana, [bruno])
    expect((await chamar('POST', '/conversa/digitando', { token: bruno.token, corpo: { id: conversa } })).status).toBe(200)
  })

  test('quem está fora não avisa digitando nem gravando', async () => {
    const conversa = await criarConversa(ana, [bruno])
    expect((await chamar('POST', '/conversa/digitando', { token: carla.token, corpo: { id: conversa } })).status).toBe(403)
    expect((await chamar('POST', '/conversa/gravando', { token: carla.token, corpo: { id: conversa } })).status).toBe(403)
  })
})

describe('sair da conversa', () => {
  const vinculoDe = async (quem: UsuarioTeste, conversa: number, alvo: UsuarioTeste) =>
    ((await chamar('GET', '/conversa/usuarios', { token: quem.token, consulta: { conversa } })).dados as { id: number; usuario_id: number }[])
      .find((m) => m.usuario_id === alvo.id)!.id

  test('quem sai não envia mais mensagens', async () => {
    const conversa = await criarConversa(ana, [bruno])
    const vinculo = await vinculoDe(bruno, conversa, bruno)
    expect((await chamar('DELETE', '/conversa/usuario', { token: bruno.token, consulta: { id: vinculo } })).status).toBe(200)
    expect((await enviarTexto(bruno, conversa, 'ainda aqui?')).status).toBe(403)
  })

  test('um membro não remove outro', async () => {
    const conversa = await criarConversa(ana, [bruno])
    const vinculoDaAna = await vinculoDe(bruno, conversa, ana)
    expect((await chamar('DELETE', '/conversa/usuario', { token: bruno.token, consulta: { id: vinculoDaAna } })).status).toBe(403)
  })
})

describe('ids inválidos nas checagens de acesso', () => {
  test.each([
    ['GET', '/mensagens', { consulta: { conversa: 0, mensagemreferencia: 0, mensagensprevias: 1, mensagensseguintes: 0 } }],
    ['DELETE', '/conversa/usuario', { consulta: { id: 0 } }],
    ['DELETE', '/mensagem', { consulta: { id: 0 } }],
    ['DELETE', '/usuario/contato', { consulta: { id: 0 } }],
    ['PATCH', '/sip', { corpo: { id: 0, sip_user: 'x' } }],
  ] as const)('%s %s com id zero é 403', async (metodo, caminho, opcoes) => {
    expect((await chamar(metodo, caminho, { token: ana.token, ...opcoes })).status).toBe(403)
  })

  test('adicionar quem já é membro devolve o vínculo existente, sem erro', async () => {
    const conversa = await criarConversa(ana, [bruno])
    const { status, dados } = await chamar('PUT', '/conversa/usuario', { token: ana.token, corpo: { conversa_id: conversa, usuario_id: bruno.id } })
    expect(status).toBe(200)
    expect(dados).toMatchObject({ conversa_id: conversa, usuario_id: bruno.id })
  })
})

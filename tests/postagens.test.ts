import { beforeAll, describe, expect, test } from 'bun:test'
import { chamar, criarConversa, criarUsuario, enviarTexto, usuariosComuns, type UsuarioTeste } from './api.ts'

let ana: UsuarioTeste, bruno: UsuarioTeste, carla: UsuarioTeste
beforeAll(async () => ({ ana, bruno, carla } = await usuariosComuns()))

interface MensagemLista {
  id: number
  conteudos: { conteudo: string }[]
  postagem?: { titulo: string | null; respostas: number; nao_lidas: number; ultimas: { id: number; conteudos: { conteudo: string }[] }[] }
}

const listar = async (quem: UsuarioTeste, conversa: number) =>
  (await chamar('GET', '/mensagens', { token: quem.token, consulta: { conversa, mensagemreferencia: 0, mensagensprevias: 80, mensagensseguintes: 0 } })).dados as MensagemLista[]
const postar = (quem: UsuarioTeste, conversa: number, texto: string, titulo: string | null = null) => enviarTexto(quem, conversa, texto, { postagem: { titulo } })
const responder = (quem: UsuarioTeste, conversa: number, postagem: number, texto: string) => enviarTexto(quem, conversa, texto, { postagem_id: postagem })

describe('postagens', () => {
  test('a postagem leva título e as respostas ficam embaixo dela, fora do fluxo', async () => {
    const grupo = await criarConversa(ana, [bruno, carla])
    const { dados: postagem } = await postar(ana, grupo, 'Reunião amanhã às 9h', '  Aviso  ')
    for (const texto of ['Estarei lá', 'Eu também', 'Vou atrasar 10 min']) {
      expect((await responder(bruno, grupo, postagem.id, texto)).status).toBe(200)
    }
    await enviarTexto(carla, grupo, 'mensagem normal')

    const lista = await listar(carla, grupo)
    expect(lista.map((m) => m.conteudos[0]?.conteudo)).toEqual(['Reunião amanhã às 9h', 'mensagem normal'])
    const resumo = lista[0]!.postagem!
    expect(resumo.titulo).toBe('Aviso')
    expect(resumo.respostas).toBe(3)
    expect(resumo.nao_lidas).toBe(3)
    // As duas últimas, da mais antiga à mais nova
    expect(resumo.ultimas.map((r) => r.conteudos[0]!.conteudo)).toEqual(['Eu também', 'Vou atrasar 10 min'])

    const { dados: todas } = await chamar('GET', '/postagem/respostas', { token: carla.token, consulta: { id: postagem.id } })
    expect((todas as MensagemLista[]).map((r) => r.conteudos[0]!.conteudo)).toEqual(['Estarei lá', 'Eu também', 'Vou atrasar 10 min'])
  })

  test('visualizar a postagem marca as respostas como vistas', async () => {
    const grupo = await criarConversa(ana, [bruno, carla])
    const { dados: postagem } = await postar(ana, grupo, 'Pauta')
    await responder(bruno, grupo, postagem.id, 'ok')
    expect((await listar(ana, grupo))[0]!.postagem!.nao_lidas).toBe(1)
    const { dados } = await chamar('POST', '/postagem/visualizar', { token: ana.token, corpo: { postagem_id: postagem.id } })
    expect(dados).toEqual({ vistas: 1 })
    expect((await listar(ana, grupo))[0]!.postagem!.nao_lidas).toBe(0)
  })

  test('resposta vira atividade para quem postou e para quem já respondeu, apontando para a postagem', async () => {
    const grupo = await criarConversa(ana, [bruno, carla])
    const { dados: postagem } = await postar(ana, grupo, 'Quem topa pizza?')
    await responder(bruno, grupo, postagem.id, 'Eu!')
    await responder(carla, grupo, postagem.id, 'Eu também')
    const atividades = async (quem: UsuarioTeste) =>
      ((await chamar('GET', '/atividades', { token: quem.token, consulta: { antes: 0, limite: 50 } })).dados as { tipo: number; mensagem_id: number | null }[])
        .filter((a) => a.tipo === 2 && a.mensagem_id === postagem.id)
    expect(await atividades(ana)).toHaveLength(2)
    expect(await atividades(bruno)).toHaveLength(1)
    expect(await atividades(carla)).toHaveLength(0)
  })

  test('postagem só em grupo; resposta só a uma postagem da conversa, sem ser postagem nem agendada', async () => {
    const direta = await criarConversa(ana, [bruno])
    expect((await postar(ana, direta, 'oi')).status).toBe(400)
    const grupo = await criarConversa(ana, [bruno, carla])
    const { dados: comum } = await enviarTexto(ana, grupo, 'não é postagem')
    expect((await responder(bruno, grupo, comum.id, 'oi')).status).toBe(400)
    const { dados: postagem } = await postar(ana, grupo, 'Pauta')
    expect((await enviarTexto(bruno, grupo, 'x', { postagem_id: postagem.id, postagem: { titulo: null } })).status).toBe(400)
    const outroGrupo = await criarConversa(ana, [bruno, carla])
    expect((await responder(bruno, outroGrupo, postagem.id, 'oi')).status).toBe(400)
    const futuro = new Date(Date.now() + 3600_000).toISOString()
    expect((await enviarTexto(bruno, grupo, 'x', { postagem_id: postagem.id, visivel_em: futuro })).status).toBe(400)
  })

  test('quem está fora não vê as respostas nem marca como vistas', async () => {
    const grupo = await criarConversa(ana, [bruno, carla])
    const { dados: postagem } = await postar(ana, grupo, 'Pauta')
    const deFora = await criarUsuario('Fora da postagem')
    expect((await chamar('GET', '/postagem/respostas', { token: deFora.token, consulta: { id: postagem.id } })).status).toBe(403)
    expect((await chamar('POST', '/postagem/visualizar', { token: deFora.token, corpo: { postagem_id: postagem.id } })).status).toBe(403)
  })
})

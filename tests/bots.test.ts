import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { configuracao } from '../src/configuracao.ts'
import { esperarBots } from '../src/bots.ts'
import { chamar, criarConversa, criarUsuario, enviarTexto, noBanco, type UsuarioTeste } from './api.ts'

// Servidor no padrão da OpenAI de mentira: cada teste diz o que ele responde,
// pedido a pedido (as rodadas de ferramentas são pedidos seguidos)
type Pedido = { messages: { role: string; content: string | null; tool_call_id?: string }[]; tools?: { function: { name: string } }[] }
let respostas: ((pedido: Pedido) => Response)[] = []
const pedidos: Pedido[] = []
const ia = Bun.serve({
  port: 0,
  async fetch(req) {
    const pedido = await req.json() as Pedido
    pedidos.push(pedido)
    return (respostas.shift() ?? (() => texto('')))(pedido)
  },
})
const texto = (conteudo: string) => Response.json({ choices: [{ message: { content: conteudo } }] })
const ferramentas = (...chamadas: [string, object][]) => Response.json({
  choices: [{ message: { content: null, tool_calls: chamadas.map(([nome, argumentos], i) => ({ id: `c${i}`, type: 'function', function: { name: nome, arguments: JSON.stringify(argumentos) } })) } }],
})

const anterior = { ...configuracao.ia }
let gestor: UsuarioTeste, criador: UsuarioTeste, ana: UsuarioTeste
beforeAll(async () => {
  ;[gestor, criador, ana] = await Promise.all([criarUsuario('Gestor Bots'), criarUsuario('Criador Bots'), criarUsuario('Ana Bots')])
  // Fecha o modo aberto (alguém com "permissoes") e dá "bots" a quem cria
  await noBanco((sql) => sql`
    insert into permissao_usuario (usuario_id, permissao_id)
    select ${gestor.id}::int, id from permissao where codigo = 'permissoes'
     union all
    select ${criador.id}::int, id from permissao where codigo = 'bots'
        on conflict do nothing`)
})
beforeEach(() => {
  pedidos.length = 0
  respostas = []
  configuracao.ia = { url: `http://localhost:${ia.port}`, token: '', modelo: 'teste' }
})
afterAll(() => {
  configuracao.ia = anterior
  ia.stop(true)
})

async function criarBot(nome = 'Assistente', instrucoes = 'Você é educado e responde dúvidas sobre o setor de compras.') {
  const { status, dados } = await chamar('PUT', '/bot', { token: criador.token, corpo: { nome, instrucoes } })
  expect(status).toBe(200)
  return dados as { id: number; usuario_id: number; nome: string; login: string; permissoes: string[] }
}

const comoMembro = (id: number) => ({ id }) as UsuarioTeste

async function mensagensDe(conversa: number, autor: number) {
  return [...await noBanco((sql) => sql<{ id: number; tipo: number; conteudo: string; referencia: number | null; tipo_referencia: number | null; postagem_id: number | null }[]>`
    select m.id, mc.tipo, convert_from(mc.conteudo, 'utf-8') as conteudo, mr.destino_mensagem_id as referencia, mr.tipo as tipo_referencia, m.postagem_id
      from mensagem m
     inner join mensagem_conteudo mc on mc.mensagem_id = m.id
      left join mensagem_referencia mr on mr.origem_mensagem_id = m.id
     where m.conversa_id = ${conversa} and m.usuario_id = ${autor}
     order by m.id`)]
}

describe('cadastro de bots', () => {
  test('sem a permissão "bots" não cria (403); com IA desligada também não (400)', async () => {
    expect((await chamar('PUT', '/bot', { token: ana.token, corpo: { nome: 'X', instrucoes: 'y' } })).status).toBe(403)
    configuracao.ia = { url: '', token: '', modelo: '' }
    expect((await chamar('PUT', '/bot', { token: criador.token, corpo: { nome: 'X', instrucoes: 'y' } })).status).toBe(400)
  })

  test('cria um usuário bot com o básico liberado, que não entra pelo login e aparece marcado nos contatos', async () => {
    const bot = await criarBot('Atendente Ágil')
    expect(bot.login).toStartWith('bot-atendente-agil-')
    expect(bot.permissoes).toEqual(['emoji', 'responder', 'reagir'])
    const entrada = await chamar('POST', '/login', { corpo: { login: bot.login, senha: 'qualquer' } })
    expect(entrada.status).toBe(401)
    const contatos = (await chamar('GET', '/usuario/contatos', { token: ana.token })).dados as { id: number; bot: boolean }[]
    expect(contatos.find((c) => c.id === bot.usuario_id)!.bot).toBe(true)
    expect(contatos.find((c) => c.id === ana.id)!.bot).toBe(false)
  })

  test('quem criou lista e edita os seus; outro com "bots" não edita; quem tem "permissoes" edita todos', async () => {
    const bot = await criarBot()
    const outro = await criarUsuario('Outro Criador')
    await noBanco((sql) => sql`insert into permissao_usuario (usuario_id, permissao_id) select ${outro.id}, id from permissao where codigo = 'bots'`)
    expect(((await chamar('GET', '/bots', { token: criador.token })).dados as { id: number }[]).some((b) => b.id === bot.id)).toBe(true)
    expect((await chamar('GET', '/bots', { token: outro.token })).dados).toEqual([])
    expect((await chamar('PATCH', '/bot', { token: outro.token, corpo: { id: bot.id, nome: 'Roubado' } })).status).toBe(403)
    const editado = await chamar('PATCH', '/bot', { token: gestor.token, corpo: { id: bot.id, nome: 'Novo Nome', instrucoes: 'Outras instruções', ativo: false } })
    expect(editado.dados).toMatchObject({ nome: 'Novo Nome', instrucoes: 'Outras instruções', ativo: false })
    expect((await chamar('GET', '/bots', { token: ana.token })).status).toBe(403)
  })

  test('permissões do bot: quem criou só libera o que tem; quem tem "permissoes" libera qualquer uma', async () => {
    const bot = await criarBot()
    await noBanco((sql) => sql`delete from permissao_usuario where usuario_id = ${criador.id} and permissao_id = (select id from permissao where codigo = 'figurinha')`)
    const pedir = (quem: UsuarioTeste, permissoes: string[]) => chamar('PUT', '/bot/permissoes', { token: quem.token, corpo: { id: bot.id, permissoes } })
    expect((await pedir(criador, ['responder', 'figurinha'])).status).toBe(403)
    expect((await pedir(criador, ['parametros'])).status).toBe(400)
    expect((await pedir(criador, ['responder', 'arquivo'])).dados.permissoes).toEqual(['arquivo', 'responder'])
    expect((await pedir(gestor, ['responder', 'arquivo', 'figurinha'])).dados.permissoes).toEqual(['figurinha', 'arquivo', 'responder'])
    // Retirar pode, mesmo a que quem criou não tem
    expect((await pedir(criador, ['responder'])).dados.permissoes).toEqual(['responder'])
    await noBanco((sql) => sql`insert into permissao_usuario (usuario_id, permissao_id) select ${criador.id}, id from permissao where codigo = 'figurinha'`)
  })
})

describe('excluir bot', () => {
  test('sem histórico, o bot e o usuário são apagados de vez; outro com "bots" não exclui', async () => {
    const bot = await criarBot('Descartável')
    const outro = await criarUsuario('Outro Excluir')
    await noBanco((sql) => sql`insert into permissao_usuario (usuario_id, permissao_id) select ${outro.id}, id from permissao where codigo = 'bots'`)
    expect((await chamar('DELETE', '/bot', { token: outro.token, consulta: { id: bot.id } })).status).toBe(403)
    const { status, dados } = await chamar('DELETE', '/bot', { token: criador.token, consulta: { id: bot.id } })
    expect(status).toBe(200)
    expect(dados).toEqual({ id: bot.id, apagado: true })
    const [conta] = await noBanco((sql) => sql`select 1 from usuario where id = ${bot.usuario_id}`)
    expect(conta).toBeUndefined()
    expect((await chamar('DELETE', '/bot', { token: criador.token, consulta: { id: bot.id } })).status).toBe(404)
  })

  test('com histórico, as mensagens ficam; ele sai dos grupos, dos contatos e das telas e não responde mais', async () => {
    const bot = await criarBot('Veterano')
    const conversa = await criarConversa(ana, [comoMembro(bot.usuario_id)])
    const grupo = await criarConversa(ana, [comoMembro(bot.usuario_id), await criarUsuario('Colega Grupo')])
    respostas = [() => texto('Oi, Ana!')]
    await enviarTexto(ana, conversa, 'Oi')
    await esperarBots()
    const { dados } = await chamar('DELETE', '/bot', { token: gestor.token, consulta: { id: bot.id } })
    expect(dados).toEqual({ id: bot.id, apagado: false })
    expect((await mensagensDe(conversa, bot.usuario_id)).map((m) => m.conteudo)).toEqual(['Oi, Ana!'])
    // Na conversa direta continua (ela segue com o nome dele); do grupo sai
    const membros = await noBanco((sql) => sql<{ conversa_id: number }[]>`select conversa_id from conversa_usuario where usuario_id = ${bot.usuario_id}`)
    expect(membros.map((m) => m.conversa_id)).toEqual([conversa])
    expect(membros.some((m) => m.conversa_id === grupo)).toBe(false)
    const lista = (await chamar('GET', '/conversas', { token: ana.token })).dados as { id: number; nome: string }[]
    expect(lista.find((c) => c.id === conversa)!.nome).toBe('Veterano')
    const contatos = (await chamar('GET', '/usuario/contatos', { token: ana.token })).dados as { id: number }[]
    expect(contatos.some((c) => c.id === bot.usuario_id)).toBe(false)
    expect(((await chamar('GET', '/bots', { token: gestor.token })).dados as { id: number }[]).some((b) => b.id === bot.id)).toBe(false)
    expect((((await chamar('GET', '/permissoes', { token: gestor.token })).dados.usuarios) as { id: number }[]).some((u) => u.id === bot.usuario_id)).toBe(false)
    expect((await chamar('POST', '/login', { corpo: { login: bot.login, senha: 'x' } })).status).toBe(401)
    pedidos.length = 0
    await enviarTexto(ana, conversa, 'Ainda está aí?')
    await esperarBots()
    expect(pedidos).toHaveLength(0)
  })
})

describe('bot na conversa', () => {
  test('na conversa direta responde a toda mensagem, com as instruções e o histórico; marca como vista', async () => {
    const bot = await criarBot('Compras', 'Você ajuda com pedidos de compra.')
    const conversa = await criarConversa(ana, [comoMembro(bot.usuario_id)])
    respostas = [() => texto('Olá, Ana! Em que posso ajudar?')]
    const enviada = await enviarTexto(ana, conversa, 'Oi, preciso de uma cadeira')
    await esperarBots()
    expect(pedidos).toHaveLength(1)
    expect(pedidos[0]!.messages[0]!.content).toContain('Você ajuda com pedidos de compra.')
    expect(pedidos[0]!.messages[0]!.content).toContain('conversa direta com Ana Bots')
    expect(pedidos[0]!.messages[1]!.content).toContain(`[${enviada.dados.id}]`)
    expect(pedidos[0]!.messages[1]!.content).toContain('Ana Bots: Oi, preciso de uma cadeira')
    expect(pedidos[0]!.tools!.map((t) => t.function.name)).toEqual(['reagir', 'responder_mensagem', 'buscar_mensagens'])
    const doBot = await mensagensDe(conversa, bot.usuario_id)
    expect(doBot).toEqual([expect.objectContaining({ tipo: 1, conteudo: 'Olá, Ana! Em que posso ajudar?', referencia: null })])
    const [status] = await noBanco((sql) => sql<{ visualizada: Date | null }[]>`
      select visualizada from mensagem_status where mensagem_id = ${enviada.dados.id} and usuario_id = ${bot.usuario_id}`)
    expect(status!.visualizada).not.toBeNull()
  })

  test('no grupo, só quando mencionado ou quando respondem a ele; a resposta cita a mensagem', async () => {
    const bot = await criarBot('Ajudante')
    const outro = await criarUsuario('Bruno Bots')
    const grupo = await criarConversa(ana, [outro, comoMembro(bot.usuario_id)])
    await enviarTexto(ana, grupo, 'Bom dia, pessoal')
    await esperarBots()
    expect(pedidos).toHaveLength(0)

    respostas = [() => texto('Bom dia! Estou aqui.')]
    const mencao = await enviarTexto(ana, grupo, `@[Ajudante](${bot.usuario_id}) você está aí?`)
    await esperarBots()
    const [resposta] = await mensagensDe(grupo, bot.usuario_id)
    expect(resposta).toMatchObject({ conteudo: 'Bom dia! Estou aqui.', referencia: mencao.dados.id, tipo_referencia: 1 })

    respostas = [() => texto('De nada!')]
    await enviarTexto(outro, grupo, 'Obrigado', { mensagem_referencia: { tipo: 1, origem_mensagem_id: resposta!.id } })
    await esperarBots()
    expect((await mensagensDe(grupo, bot.usuario_id)).map((m) => m.conteudo)).toEqual(['Bom dia! Estou aqui.', 'De nada!'])
  })

  test('ferramentas: reage, recebe o erro da que não pode e termina sem texto', async () => {
    const bot = await criarBot()
    const conversa = await criarConversa(ana, [comoMembro(bot.usuario_id)])
    let gatilho = 0
    respostas = [
      () => ferramentas(['reagir', { mensagem_id: gatilho, emoji: '👍' }], ['enviar_figurinha', { figurinha: 'noto/joinha' }]),
      () => texto(''),
    ]
    gatilho = (await enviarTexto(ana, conversa, 'Fechado então')).dados.id
    await esperarBots()
    const [reacao] = await noBanco((sql) => sql<{ emoji: string }[]>`select emoji from reacao where mensagem_id = ${gatilho} and usuario_id = ${bot.usuario_id}`)
    expect(reacao!.emoji).toBe('👍')
    // A segunda rodada recebe o resultado de cada ferramenta
    const resultados = pedidos[1]!.messages.filter((m) => m.role === 'tool').map((m) => JSON.parse(m.content!))
    expect(resultados[0]).toEqual({ ok: true })
    expect(resultados[1].erro).toContain('figurinhas')
    expect(await mensagensDe(conversa, bot.usuario_id)).toEqual([])
  })

  test('sem a permissão de emoji, o texto vai sem os emojis; bot desligado não responde', async () => {
    const bot = await criarBot()
    await chamar('PUT', '/bot/permissoes', { token: criador.token, corpo: { id: bot.id, permissoes: ['responder'] } })
    const conversa = await criarConversa(ana, [comoMembro(bot.usuario_id)])
    respostas = [(pedido) => {
      expect(pedido.messages[0]!.content).toContain('Não escreva emojis')
      return texto('Feito 🎉 pode contar comigo')
    }]
    await enviarTexto(ana, conversa, 'Obrigada')
    await esperarBots()
    expect((await mensagensDe(conversa, bot.usuario_id)).map((m) => m.conteudo)).toEqual(['Feito pode contar comigo'])

    await chamar('PATCH', '/bot', { token: criador.token, corpo: { id: bot.id, ativo: false } })
    await enviarTexto(ana, conversa, 'Mais uma coisa')
    await esperarBots()
    expect(pedidos).toHaveLength(1)
  })

  test('bot não responde a outro bot', async () => {
    const [primeiro, segundo] = [await criarBot('Primeiro'), await criarBot('Segundo')]
    const grupo = await criarConversa(ana, [comoMembro(primeiro.usuario_id), comoMembro(segundo.usuario_id)])
    respostas = [() => texto(`@[Segundo](${segundo.usuario_id}) oi, colega`)]
    await enviarTexto(ana, grupo, `@[Primeiro](${primeiro.usuario_id}) chame o outro`)
    await esperarBots()
    expect(pedidos).toHaveLength(1)
    expect(await mensagensDe(grupo, segundo.usuario_id)).toEqual([])
  })

  test('depois de responder, termina na mesma rodada (as outras ferramentas dela rodam); o pedido tem limite de tokens', async () => {
    const bot = await criarBot()
    const conversa = await criarConversa(ana, [comoMembro(bot.usuario_id)])
    let gatilho = 0
    respostas = [
      () => ferramentas(['reagir', { mensagem_id: gatilho, emoji: '🎉' }], ['responder_mensagem', { mensagem_id: gatilho, texto: 'Parabéns!' }]),
      () => texto('Eu reagi e respondi à mensagem.'),
    ]
    gatilho = (await enviarTexto(ana, conversa, 'Fechamos o contrato')).dados.id
    await esperarBots()
    expect(pedidos).toHaveLength(1)
    expect((pedidos[0] as unknown as { max_tokens: number }).max_tokens).toBeGreaterThan(0)
    expect((await mensagensDe(conversa, bot.usuario_id)).map((m) => m.conteudo)).toEqual(['Parabéns!'])
    const [reacao] = await noBanco((sql) => sql<{ emoji: string }[]>`select emoji from reacao where mensagem_id = ${gatilho} and usuario_id = ${bot.usuario_id}`)
    expect(reacao!.emoji).toBe('🎉')
  })

  test('quando falha, avisa na conversa citando a mensagem que ficou sem resposta', async () => {
    const bot = await criarBot()
    const conversa = await criarConversa(ana, [comoMembro(bot.usuario_id)])
    respostas = [() => new Response('modelo carregando', { status: 503 })]
    const enviada = await enviarTexto(ana, conversa, 'Qual o prazo?')
    await esperarBots()
    const doBot = await mensagensDe(conversa, bot.usuario_id)
    expect(doBot).toHaveLength(1)
    expect(doBot[0]!.conteudo).toBe('Não consegui responder a esta mensagem: O servidor de IA respondeu 503: modelo carregando')
    expect(doBot[0]).toMatchObject({ referencia: enviada.dados.id, tipo_referencia: 1 })
  })

  test('servidor que não aceita ferramentas recebe o pedido sem elas e o bot responde em texto', async () => {
    const bot = await criarBot()
    const conversa = await criarConversa(ana, [comoMembro(bot.usuario_id)])
    respostas = [() => new Response('tools not supported', { status: 400 }), () => texto('Respondo só em texto.')]
    await enviarTexto(ana, conversa, 'Olá')
    await esperarBots()
    expect(pedidos[1]!.tools).toBeUndefined()
    expect((await mensagensDe(conversa, bot.usuario_id)).map((m) => m.conteudo)).toEqual(['Respondo só em texto.'])
  })
})

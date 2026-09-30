import { beforeAll, describe, expect, test } from 'bun:test'
import { chamar, criarConversa, enviarAnexo, noBanco, usuariosComuns, type UsuarioTeste } from './api.ts'

let ana: UsuarioTeste, bruno: UsuarioTeste, carla: UsuarioTeste
beforeAll(async () => ({ ana, bruno, carla } = await usuariosComuns()))

const unico = (texto: string) => `${texto} ${crypto.randomUUID()}`
const baixar = async (url: string) => (await fetch(url, { tls: { rejectUnauthorized: false } })).text()

async function anexarNaConversa(autor: UsuarioTeste, conversa: number, conteudo: string, tipo = 3, nome = 'arquivo.txt') {
  const { identificador } = await enviarAnexo(autor, conteudo, tipo, nome)
  await chamar('POST', '/anexo/confirmar', { token: autor.token, consulta: { identificador } })
  const mensagem = await chamar('PUT', '/mensagem', { token: autor.token, corpo: { conversa_id: conversa, conteudos: [{ ordem: 1, tipo, conteudo: identificador }] } })
  return { identificador, mensagem: mensagem.dados.id as number }
}

describe('envio e leitura', () => {
  test('envia pelo endereço assinado, confirma e baixa o mesmo conteúdo', async () => {
    const conteudo = unico('conteúdo do arquivo')
    const { identificador, pedido } = await enviarAnexo(ana, conteudo)
    expect(pedido.existe).toBe(false)
    expect(pedido.upload_url).toStartWith('https://localhost/storage/')
    const confirmacao = await chamar('POST', '/anexo/confirmar', { token: ana.token, consulta: { identificador } })
    expect(confirmacao.dados).toEqual({ confirmado: true, upload_status: 1 })
    const { dados } = await chamar('GET', '/anexo', { token: ana.token, consulta: { identificador } })
    expect(await baixar(dados.url)).toBe(conteudo)
  })

  test('o mesmo arquivo de novo é reaproveitado, sem novo envio', async () => {
    const conteudo = unico('repetido')
    const primeiro = await enviarAnexo(ana, conteudo)
    const segundo = await chamar('PUT', '/anexo', { token: bruno.token, corpo: { identificador: primeiro.identificador, tipo: 3, nome: 'x.txt', extensao: 'txt', tamanho: 10 } })
    expect(segundo.dados.existe).toBe(true)
    expect(String(segundo.dados.id)).toBe(String(primeiro.pedido.id))
  })

  test('anexo/existe informa o que já foi enviado', async () => {
    const { identificador } = await enviarAnexo(ana, unico('existe'))
    const sim = await chamar('GET', '/anexo/existe', { token: ana.token, consulta: { identificador } })
    expect(sim.dados).toMatchObject({ existe: true, identificador })
    const nao = await chamar('GET', '/anexo/existe', { token: ana.token, consulta: { identificador: 'f'.repeat(64) } })
    expect(nao.dados).toEqual({ existe: false })
  })

  test('sem o arquivo no MinIO, confirmar e pedir o endereço são recusados', async () => {
    const identificador = new Bun.CryptoHasher('sha256').update(unico('nunca enviado')).digest('hex')
    await chamar('PUT', '/anexo', { token: ana.token, corpo: { identificador, tipo: 3, nome: 'x.txt', extensao: 'txt', tamanho: 5 } })
    expect((await chamar('POST', '/anexo/confirmar', { token: ana.token, consulta: { identificador } })).status).toBe(400)
    const endereco = await chamar('GET', '/anexo', { token: ana.token, consulta: { identificador } })
    expect(endereco.status).toBe(400)
    expect(endereco.dados.error).toBe('Upload ainda não foi concluído')
  })

  test('upload marcado como falho não entrega endereço', async () => {
    const { identificador } = await enviarAnexo(ana, unico('falhou'))
    await noBanco((sql) => sql`update anexo set upload_status = 2 where identificador = ${identificador}`)
    const { status, dados } = await chamar('GET', '/anexo', { token: ana.token, consulta: { identificador } })
    expect(status).toBe(400)
    expect(dados.error).toBe('Upload falhou')
  })

  test('endereço de anexo sem confirmação é liberado quando o arquivo já está no MinIO', async () => {
    const { identificador } = await enviarAnexo(ana, unico('sem confirmar'))
    expect((await chamar('GET', '/anexo', { token: ana.token, consulta: { identificador } })).status).toBe(200)
    const [anexo] = await noBanco((sql) => sql<{ upload_status: number }[]>`select upload_status from anexo where identificador = ${identificador}`)
    expect(anexo?.upload_status).toBe(1)
  })

  // FALHA CONHECIDA: anexo inexistente e arquivo acima de 1 GiB lançam Error
  // comum (anexos.ts), e a API responde 500 em vez de 404 e 400.
  test.failing('anexo inexistente é 404 e arquivo grande demais é 400', async () => {
    expect((await chamar('GET', '/anexo', { token: ana.token, consulta: { identificador: 'e'.repeat(64) } })).status).toBe(404)
    const grande = await chamar('PUT', '/anexo', { token: ana.token, corpo: { identificador: 'd'.repeat(64), tipo: 3, nome: 'g.bin', extensao: 'bin', tamanho: 2 * 1024 ** 3 } })
    expect(grande.status).toBe(400)
  })
})

describe('lista de anexos', () => {
  const listar = (quem: UsuarioTeste, filtro: Record<string, string | number> = {}) =>
    chamar('GET', '/anexos', { token: quem.token, consulta: { conversa: 0, direcao: '', tipos: '', autor: 0, antes: 0, limite: 0, ...filtro } })
  const ids = (dados: { identificador: string }[]) => dados.map((a) => a.identificador)

  test('mostra os anexos das conversas do usuário, com endereço para baixar', async () => {
    const conversa = await criarConversa(ana, [bruno])
    const conteudo = unico('na lista')
    const { identificador } = await anexarNaConversa(ana, conversa, conteudo)
    const { dados } = await listar(bruno, { conversa })
    const item = dados.find((a: { identificador: string }) => a.identificador === identificador)
    expect(item).toMatchObject({ conversa_id: conversa, autor_id: ana.id, nome: 'arquivo.txt', tipo: 3 })
    expect(await baixar(item.url)).toBe(conteudo)
  })

  test('quem está fora não vê, nem filtrando pela conversa', async () => {
    const conversa = await criarConversa(ana, [bruno])
    const { identificador } = await anexarNaConversa(ana, conversa, unico('privado'))
    expect(ids((await listar(carla)).dados)).not.toContain(identificador)
    expect((await listar(carla, { conversa })).status).toBe(403)
  })

  test('filtra enviados e recebidos', async () => {
    const conversa = await criarConversa(ana, [bruno])
    const daAna = await anexarNaConversa(ana, conversa, unico('da ana'))
    const doBruno = await anexarNaConversa(bruno, conversa, unico('do bruno'))
    const enviados = ids((await listar(ana, { conversa, direcao: 'enviados' })).dados)
    const recebidos = ids((await listar(ana, { conversa, direcao: 'recebidos' })).dados)
    expect(enviados).toEqual([daAna.identificador])
    expect(recebidos).toEqual([doBruno.identificador])
  })

  test('filtra por tipo', async () => {
    const conversa = await criarConversa(ana, [bruno])
    const arquivo = await anexarNaConversa(ana, conversa, unico('arquivo'), 3)
    const imagem = await anexarNaConversa(ana, conversa, unico('imagem'), 2, 'foto.png')
    expect(ids((await listar(ana, { conversa, tipos: '2' })).dados)).toEqual([imagem.identificador])
    expect(ids((await listar(ana, { conversa, tipos: '3' })).dados)).toEqual([arquivo.identificador])
  })

  test('pagina pelo "antes" e respeita o limite', async () => {
    const conversa = await criarConversa(ana, [bruno])
    for (const n of [1, 2, 3]) await anexarNaConversa(ana, conversa, unico(`pagina ${n}`))
    const primeira = (await listar(ana, { conversa, limite: 2 })).dados
    expect(primeira).toHaveLength(2)
    const resto = (await listar(ana, { conversa, limite: 2, antes: primeira.at(-1).anexo_id })).dados
    expect(resto).toHaveLength(1)
  })

  test.each([
    [{ direcao: 'todos' }, 'Direção inválida'],
    [{ tipos: 'a' }, 'Tipo inválido'],
    [{ tipos: '6' }, 'Tipo não permitido'],
  ])('filtro inválido é 400 (%p)', async (filtro, mensagem) => {
    const { status, dados } = await listar(ana, filtro)
    expect(status).toBe(400)
    expect(dados.error).toContain(mensagem)
  })

  test('recebidos com o próprio usuário como autor é 400', async () => {
    const { status } = await listar(ana, { direcao: 'recebidos', autor: ana.id })
    expect(status).toBe(400)
  })

  test('anexo com upload pendente não aparece', async () => {
    const conversa = await criarConversa(ana, [bruno])
    const identificador = new Bun.CryptoHasher('sha256').update(unico('pendente')).digest('hex')
    await chamar('PUT', '/anexo', { token: ana.token, corpo: { identificador, tipo: 3, nome: 'p.txt', extensao: 'txt', tamanho: 3 } })
    await chamar('PUT', '/mensagem', { token: ana.token, corpo: { conversa_id: conversa, conteudos: [{ ordem: 1, tipo: 3, conteudo: identificador }] } })
    expect(ids((await listar(ana, { conversa })).dados)).not.toContain(identificador)
  })
})

describe('anexo nas mensagens', () => {
  test('a mensagem traz nome e extensão do anexo', async () => {
    const conversa = await criarConversa(ana, [bruno])
    const { identificador } = await anexarNaConversa(ana, conversa, unico('relatório'), 3, 'relatorio.pdf')
    const { dados } = await chamar('GET', '/mensagens', { token: bruno.token, consulta: { conversa, mensagemreferencia: 0, mensagensprevias: 10, mensagensseguintes: 0 } })
    expect(dados[0].conteudos[0]).toMatchObject({ tipo: 3, conteudo: identificador, nome: 'relatorio.pdf', extensao: 'pdf' })
  })
})

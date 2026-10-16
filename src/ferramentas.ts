import type { Sql } from './banco.ts'
import type { Corpo } from './esquemas.ts'
import { httpErrors } from './erros.ts'
import { CodigoPermissao, permissaoUsuario, validarPermissao } from './permissoes.ts'

// Ferramentas externas dos bots: APIs HTTP com JSON cadastradas pelo
// administrador (permissao "ferramentas") e ligadas bot a bot. O modelo chama
// pelo nome; o servidor monta o pedido (parametros na URL, na consulta ou no
// corpo) com os cabecalhos guardados, que nunca saem daqui.

export type TipoParametro = 'string' | 'number' | 'boolean'

export interface ParametroFerramenta {
  nome: string
  tipo: TipoParametro
  descricao: string
  obrigatorio: boolean
}

export interface FerramentaExterna {
  id: number
  nome: string
  descricao: string
  metodo: 'GET' | 'POST'
  url: string
  cabecalhos: Record<string, string>
  parametros: ParametroFerramenta[]
  ativo: boolean
}

// As do proprio chat: uma externa nao pode ter o mesmo nome
export const FERRAMENTAS_DO_CHAT = ['reagir', 'responder_mensagem', 'enviar_figurinha', 'encaminhar_mensagem', 'criar_votacao', 'buscar_mensagens', 'consultar_conhecimento']

const NOME = /^[a-z][a-z0-9_]{1,59}$/
const MARCADOR = /\{([a-z][a-z0-9_]*)\}/g
const TEMPO_LIMITE_MS = 20_000
const LIMITE_RESPOSTA = 8000

// Para a tela: dos cabecalhos so os nomes
function semSegredos({ cabecalhos, ...ferramenta }: FerramentaExterna) {
  return { ...ferramenta, cabecalhos: Object.keys(cabecalhos) }
}

async function linhas(sql: Sql, filtro: { id?: number; bot?: number } = {}) {
  return sql<FerramentaExterna[]>`
    select f.id, f.nome, f.descricao, f.metodo, f.url, f.cabecalhos, f.parametros, f.ativo
      from ferramenta f
     where true
       ${filtro.id ? sql`and f.id = ${filtro.id}` : sql``}
       ${filtro.bot ? sql`and f.ativo and exists (select 1 from bot_ferramenta bf inner join bot b on b.id = bf.bot_id where bf.ferramenta_id = f.id and b.usuario_id = ${filtro.bot})` : sql``}
     order by f.nome`
}

export async function listarFerramentas(sql: Sql, usuario: number) {
  await validarPermissao(sql, usuario, CodigoPermissao.Ferramentas)
  return (await linhas(sql)).map(semSegredos)
}

// Para escolher na tela do bot: quem cria bots ve so o nome e a descricao
export async function ferramentasDisponiveis(sql: Sql, usuario: number) {
  const pode = await Promise.all([CodigoPermissao.Bots, CodigoPermissao.Permissoes, CodigoPermissao.Ferramentas].map((codigo) => permissaoUsuario(sql, usuario, codigo)))
  if (!pode.some(Boolean)) {
    throw httpErrors.forbidden('Acesso negado!')
  }
  return sql<{ id: number; nome: string; descricao: string }[]>`
    select id, nome, descricao from ferramenta where ativo order by nome`
}

// As ligadas no bot, completas, para ele chamar
export function ferramentasDoBot(sql: Sql, botUsuario: number) {
  return linhas(sql, { bot: botUsuario })
}

async function conferir(sql: Sql, dados: { nome: string; descricao: string; url: string; parametros: ParametroFerramenta[] }, id = 0) {
  if (!NOME.test(dados.nome)) {
    throw httpErrors.badRequest('Nome inválido: use letras minúsculas, números e _ (ex.: consultar_conhecimento), começando por letra.')
  }
  if (FERRAMENTAS_DO_CHAT.includes(dados.nome)) {
    throw httpErrors.badRequest(`O nome ${dados.nome} é de uma ferramenta do próprio chat.`)
  }
  if (!dados.descricao.trim()) {
    throw httpErrors.badRequest('Descreva o que a ferramenta faz: é assim que a IA sabe quando usar.')
  }
  let url: URL
  try {
    url = new URL(dados.url.replace(MARCADOR, 'x'))
  } catch {
    throw httpErrors.badRequest('Endereço inválido.')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw httpErrors.badRequest('O endereço precisa começar com http:// ou https://.')
  }
  const nomes = dados.parametros.map((p) => p.nome)
  const invalido = nomes.find((nome) => !NOME.test(nome))
  if (invalido !== undefined) {
    throw httpErrors.badRequest(`Parâmetro com nome inválido: "${invalido}".`)
  }
  if (new Set(nomes).size !== nomes.length) {
    throw httpErrors.badRequest('Dois parâmetros com o mesmo nome.')
  }
  const semParametro = [...dados.url.matchAll(MARCADOR)].map((m) => m[1]!).find((nome) => !nomes.includes(nome))
  if (semParametro) {
    throw httpErrors.badRequest(`O endereço usa {${semParametro}}, que não está nos parâmetros.`)
  }
  const [existe] = await sql`select 1 from ferramenta where nome = ${dados.nome} and id <> ${id}`
  if (existe) {
    throw httpErrors.badRequest('Já existe uma ferramenta com esse nome.')
  }
}

// Cabecalho com valor vazio mantem o que estava salvo; os que nao vierem saem
function juntarCabecalhos(lista: { nome: string; valor?: string | null }[], salvos: Record<string, string> = {}) {
  const cabecalhos: Record<string, string> = {}
  for (const { nome, valor } of lista) {
    const limpo = nome.trim()
    if (!limpo) continue
    const novo = valor ?? ''
    if (novo) cabecalhos[limpo] = novo
    else if (salvos[limpo] !== undefined) cabecalhos[limpo] = salvos[limpo]
    else throw httpErrors.badRequest(`Informe o valor do cabeçalho ${limpo}.`)
  }
  return cabecalhos
}

function limparParametros(parametros: Corpo<'incluirFerramenta'>['parametros']): ParametroFerramenta[] {
  return parametros.map((p) => ({ nome: p.nome.trim(), tipo: p.tipo, descricao: p.descricao.trim(), obrigatorio: p.obrigatorio }))
}

export async function incluirFerramenta(sql: Sql, usuario: number, corpo: Corpo<'incluirFerramenta'>) {
  await validarPermissao(sql, usuario, CodigoPermissao.Ferramentas)
  const dados = { nome: corpo.nome.trim(), descricao: corpo.descricao.trim(), url: corpo.url.trim(), parametros: limparParametros(corpo.parametros) }
  await conferir(sql, dados)
  const cabecalhos = juntarCabecalhos(corpo.cabecalhos)
  const [inserida] = await sql<{ id: number }[]>`
    insert into ferramenta (nome, descricao, metodo, url, cabecalhos, parametros, ativo)
    values (${dados.nome}, ${dados.descricao}, ${corpo.metodo}, ${dados.url}, ${sql.json(cabecalhos)}, ${sql.json(dados.parametros as never)}, ${corpo.ativo ?? true})
    returning id`
  const [criada] = await linhas(sql, { id: inserida!.id })
  return semSegredos(criada!)
}

export async function alterarFerramenta(sql: Sql, usuario: number, corpo: Corpo<'alterarFerramenta'>) {
  await validarPermissao(sql, usuario, CodigoPermissao.Ferramentas)
  const [atual] = await linhas(sql, { id: corpo.id })
  if (!atual) {
    throw httpErrors.notFound('Ferramenta não encontrada!')
  }
  const dados = { nome: corpo.nome.trim(), descricao: corpo.descricao.trim(), url: corpo.url.trim(), parametros: limparParametros(corpo.parametros) }
  await conferir(sql, dados, corpo.id)
  const cabecalhos = juntarCabecalhos(corpo.cabecalhos, atual.cabecalhos)
  await sql`
    update ferramenta
       set nome = ${dados.nome}
         , descricao = ${dados.descricao}
         , metodo = ${corpo.metodo}
         , url = ${dados.url}
         , cabecalhos = ${sql.json(cabecalhos)}
         , parametros = ${sql.json(dados.parametros as never)}
         , ativo = ${corpo.ativo ?? atual.ativo}
     where id = ${corpo.id}`
  const [alterada] = await linhas(sql, { id: corpo.id })
  return semSegredos(alterada!)
}

export async function excluirFerramenta(sql: Sql, usuario: number, id: number) {
  await validarPermissao(sql, usuario, CodigoPermissao.Ferramentas)
  const [apagada] = await sql`delete from ferramenta where id = ${id} returning id`
  if (!apagada) {
    throw httpErrors.notFound('Ferramenta não encontrada!')
  }
  return { id }
}

// Chama como o bot chamaria, com os valores de exemplo da tela
export async function testarFerramenta(sql: Sql, usuario: number, corpo: Corpo<'testarFerramenta'>) {
  await validarPermissao(sql, usuario, CodigoPermissao.Ferramentas)
  const [ferramenta] = await linhas(sql, { id: corpo.id })
  if (!ferramenta) {
    throw httpErrors.notFound('Ferramenta não encontrada!')
  }
  const inicio = Date.now()
  try {
    const { status, resposta } = await chamarFerramenta(ferramenta, corpo.argumentos)
    return { ok: status >= 200 && status < 300, status, resposta, erro: '', milissegundos: Date.now() - inicio }
  } catch (erro) {
    return { ok: false, status: 0, resposta: '', erro: erro instanceof Error ? erro.message : String(erro), milissegundos: Date.now() - inicio }
  }
}

function valorDoTipo(parametro: ParametroFerramenta, valor: unknown) {
  if (parametro.tipo === 'number') {
    const numero = Number(valor)
    if (!Number.isFinite(numero)) throw new Error(`O parâmetro ${parametro.nome} precisa ser um número.`)
    return numero
  }
  if (parametro.tipo === 'boolean') return valor === true || valor === 'true'
  return String(valor)
}

// Monta e faz o pedido. Parametro marcado na URL ({nome}) vai nela; o resto, na
// consulta (GET) ou no corpo JSON (POST). Resposta JSON volta compacta, e tudo
// e cortado no limite, para nao lotar a conversa do modelo.
export async function chamarFerramenta(ferramenta: FerramentaExterna, argumentos: Record<string, unknown>) {
  const valores: Record<string, string | number | boolean> = {}
  for (const parametro of ferramenta.parametros) {
    const valor = argumentos[parametro.nome]
    if (valor === undefined || valor === null || valor === '') {
      if (parametro.obrigatorio) throw new Error(`Faltou o parâmetro ${parametro.nome}.`)
      continue
    }
    valores[parametro.nome] = valorDoTipo(parametro, valor)
  }
  const naUrl = new Set<string>()
  let endereco = ferramenta.url.replace(MARCADOR, (_, nome: string) => {
    naUrl.add(nome)
    return encodeURIComponent(String(valores[nome] ?? ''))
  })
  const resto = Object.fromEntries(Object.entries(valores).filter(([nome]) => !naUrl.has(nome)))
  if (ferramenta.metodo === 'GET' && Object.keys(resto).length) {
    const url = new URL(endereco)
    for (const [nome, valor] of Object.entries(resto)) url.searchParams.set(nome, String(valor))
    endereco = url.toString()
  }
  let resposta: Response
  try {
    resposta = await fetch(endereco, {
      method: ferramenta.metodo,
      headers: {
        Accept: 'application/json, text/plain;q=0.9, */*;q=0.5',
        ...(ferramenta.metodo === 'POST' ? { 'Content-Type': 'application/json' } : {}),
        ...ferramenta.cabecalhos,
      },
      ...(ferramenta.metodo === 'POST' ? { body: JSON.stringify(resto) } : {}),
      signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
    })
  } catch (erro) {
    const esgotado = erro instanceof Error && erro.name === 'TimeoutError'
    throw new Error(esgotado ? `A ferramenta ${ferramenta.nome} demorou demais para responder.` : `Não foi possível chamar a ferramenta ${ferramenta.nome} (${erro instanceof Error ? erro.message : erro}).`)
  }
  const texto = await resposta.text()
  let corpo = texto
  try {
    corpo = JSON.stringify(JSON.parse(texto))
  } catch {
    // Nao e JSON: vai o texto como veio
  }
  return { status: resposta.status, resposta: corpo.slice(0, LIMITE_RESPOSTA) }
}

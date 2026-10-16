import { randomUUID } from 'node:crypto'
import { comUsuario, type Sql } from './banco.ts'
import { configuracao } from './configuracao.ts'
import type { Corpo } from './esquemas.ts'
import { httpErrors } from './erros.ts'
import { gerarEmbeddings } from './ia.ts'
import { CodigoPermissao, permissaoUsuario, validarPermissao } from './permissoes.ts'

// Base de conhecimento dos bots (RAG). Cada base tem documentos (texto que a
// pagina extrai de .txt, .md, .pdf e .docx); o servidor quebra em trechos,
// gera os embeddings no servidor de IA e guarda os trechos com os vetores no
// Qdrant, numa colecao so, com a base e o documento no payload. O bot consulta
// as bases ligadas nele pela ferramenta consultar_conhecimento.

export const StatusDocumento = { Processando: 1, Pronto: 2, Erro: 3 } as const
export type StatusDocumento = (typeof StatusDocumento)[keyof typeof StatusDocumento]

const TAMANHO_TRECHO = 1000
const SOBRA_TRECHO = 150
const LOTE_EMBEDDINGS = 32
const LIMITE_TEXTO = 2_000_000
const TRECHOS_POR_BUSCA = 5

export function conhecimentoLigado() {
  return configuracao.ia.url.trim() !== '' && configuracao.iaModeloEmbeddings !== ''
}

// --- Qdrant (API HTTP) ---

async function qdrant<T = unknown>(metodo: string, caminho: string, corpo?: unknown): Promise<T> {
  let resposta: Response
  try {
    resposta = await fetch(`${configuracao.qdrant.url.replace(/\/+$/, '')}${caminho}`, {
      method: metodo,
      headers: { 'Content-Type': 'application/json' },
      ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }),
      signal: AbortSignal.timeout(30_000),
    })
  } catch (erro) {
    throw new Error(`Não foi possível falar com o Qdrant (${erro instanceof Error ? erro.message : erro}).`)
  }
  const dados = await resposta.json().catch(() => null) as { result?: T; status?: { error?: string } } | null
  if (!resposta.ok) {
    throw Object.assign(new Error(`O Qdrant respondeu ${resposta.status}${dados?.status?.error ? `: ${dados.status.error}` : ''}`), { status: resposta.status })
  }
  return dados?.result as T
}

const colecao = () => `/collections/${configuracao.qdrant.colecao}`

// Cria a colecao no tamanho dos vetores do modelo. Ja existindo com outro
// tamanho, o modelo de embeddings mudou: so reindexando tudo.
async function garantirColecao(dimensao: number) {
  try {
    const info = await qdrant<{ config: { params: { vectors: { size: number } } } }>('GET', colecao())
    if (info.config.params.vectors.size !== dimensao) {
      throw new Error('O modelo de embeddings mudou: use "Reindexar tudo" na base de conhecimento.')
    }
    return
  } catch (erro) {
    if ((erro as { status?: number }).status !== 404) throw erro
  }
  await qdrant('PUT', colecao(), { vectors: { size: dimensao, distance: 'Cosine' } })
  for (const campo of ['base_id', 'documento_id']) {
    await qdrant('PUT', `${colecao()}/index?wait=true`, { field_name: campo, field_schema: 'integer' })
  }
}

async function apagarPontos(campo: 'base_id' | 'documento_id', valor: number) {
  try {
    await qdrant('POST', `${colecao()}/points/delete?wait=true`, { filter: { must: [{ key: campo, match: { value: valor } }] } })
  } catch (erro) {
    // Sem a colecao, nao ha o que apagar
    if ((erro as { status?: number }).status !== 404) throw erro
  }
}

// --- Trechos ---

// Junta paragrafos ate o tamanho do trecho; paragrafo grande e cortado por
// frase (ou no tamanho, sem frase). Cada trecho comeca com o fim do anterior,
// para a ideia que atravessa o corte nao se perder.
export function dividirEmTrechos(texto: string, tamanho = TAMANHO_TRECHO, sobra = SOBRA_TRECHO): string[] {
  const pedacos: string[] = []
  for (const paragrafo of texto.replace(/\r\n?/g, '\n').split(/\n\s*\n/).map((p) => p.replace(/[ \t]+/g, ' ').trim()).filter(Boolean)) {
    if (paragrafo.length <= tamanho) {
      pedacos.push(paragrafo)
      continue
    }
    let atual = ''
    for (const frase of paragrafo.match(/[^.!?\n]+[.!?]*\s*/g) ?? [paragrafo]) {
      if (atual && (atual + frase).length > tamanho) {
        pedacos.push(atual.trim())
        atual = ''
      }
      if (frase.length > tamanho) {
        for (let i = 0; i < frase.length; i += tamanho) pedacos.push(frase.slice(i, i + tamanho).trim())
        continue
      }
      atual += frase
    }
    if (atual.trim()) pedacos.push(atual.trim())
  }
  const trechos: string[] = []
  let atual = ''
  for (const pedaco of pedacos) {
    if (atual && (atual.length + pedaco.length + 2) > tamanho) {
      trechos.push(atual)
      const fim = atual.slice(-sobra)
      atual = `${fim.slice(fim.indexOf(' ') + 1)}\n\n${pedaco}`
    } else {
      atual = atual ? `${atual}\n\n${pedaco}` : pedaco
    }
  }
  if (atual) trechos.push(atual)
  return trechos
}

// --- Indexacao em segundo plano ---

const emAndamento = new Set<Promise<void>>()

// Para os testes: espera as indexacoes em andamento
export async function esperarIndexacao() {
  while (emAndamento.size) {
    await Promise.all([...emAndamento])
  }
}

// Um documento por vez: poupa o servidor de IA e evita duas indexacoes criando
// a colecao ao mesmo tempo
let fila: Promise<void> = Promise.resolve()

function indexarDepois(documento: number) {
  const tarefa = fila.then(() => indexar(documento)).catch((erro) => console.error(`[CONHECIMENTO] Falha ao indexar o documento ${documento}:`, erro))
  fila = tarefa
  emAndamento.add(tarefa)
  void tarefa.finally(() => emAndamento.delete(tarefa))
}

async function indexar(id: number) {
  const [documento] = await comUsuario(0, (sql) => sql<{ base_id: number; nome: string; texto: string }[]>`
    select base_id, nome, texto from conhecimento_documento where id = ${id}`)
  if (!documento) return
  try {
    const trechos = dividirEmTrechos(documento.texto)
    await apagarPontos('documento_id', id)
    for (let inicio = 0; inicio < trechos.length; inicio += LOTE_EMBEDDINGS) {
      const lote = trechos.slice(inicio, inicio + LOTE_EMBEDDINGS)
      const vetores = await gerarEmbeddings(lote, { tipo: 'documento' })
      await garantirColecao(vetores[0]!.length)
      await qdrant('PUT', `${colecao()}/points?wait=true`, {
        points: lote.map((texto, i) => ({
          id: randomUUID(),
          vector: vetores[i],
          payload: { base_id: documento.base_id, documento_id: id, documento: documento.nome, ordem: inicio + i, texto },
        })),
      })
    }
    const [ainda] = await comUsuario(0, (sql) => sql`
      update conhecimento_documento set status = ${StatusDocumento.Pronto}, trechos = ${trechos.length}, erro = null where id = ${id} returning id`)
    // Excluido enquanto indexava: os trechos que entraram saem
    if (!ainda) await apagarPontos('documento_id', id)
  } catch (erro) {
    await comUsuario(0, (sql) => sql`
      update conhecimento_documento
         set status = ${StatusDocumento.Erro}, erro = ${erro instanceof Error ? erro.message : String(erro)}
       where id = ${id}`)
  }
}

// --- Busca ---

export interface TrechoEncontrado {
  documento: string
  texto: string
  nota: number
}

export async function buscarTrechos(bases: number[], pergunta: string, limite = TRECHOS_POR_BUSCA): Promise<TrechoEncontrado[]> {
  if (!bases.length || !pergunta.trim()) return []
  const [vetor] = await gerarEmbeddings([pergunta.trim()], { tempoLimiteMs: 60_000, tipo: 'pergunta' })
  let achados: { score: number; payload: { documento: string; texto: string } }[]
  try {
    achados = await qdrant('POST', `${colecao()}/points/search`, {
      vector: vetor,
      limit: limite,
      with_payload: true,
      filter: { must: [{ key: 'base_id', match: { any: bases } }] },
    })
  } catch (erro) {
    // Nada indexado ainda
    if ((erro as { status?: number }).status === 404) return []
    throw erro
  }
  return achados.map(({ score, payload }) => ({ documento: payload.documento, texto: payload.texto, nota: Math.round(score * 1000) / 1000 }))
}

// --- Rotas ---

async function validarAlguma(sql: Sql, usuario: number, codigos: CodigoPermissao[]) {
  const pode = await Promise.all(codigos.map((codigo) => permissaoUsuario(sql, usuario, codigo)))
  if (!pode.some(Boolean)) {
    throw httpErrors.forbidden('Acesso negado!')
  }
}

export async function listarBases(sql: Sql, usuario: number) {
  await validarPermissao(sql, usuario, CodigoPermissao.Conhecimento)
  return sql<{ id: number; nome: string; descricao: string; documentos: number; trechos: number }[]>`
    select b.id
         , b.nome
         , b.descricao
         , count(d.id)::int as documentos
         , coalesce(sum(d.trechos), 0)::int as trechos
      from conhecimento_base b
      left join conhecimento_documento d on d.base_id = b.id
     group by b.id
     order by lower(b.nome)`
}

// Para escolher na tela do bot
export async function basesDisponiveis(sql: Sql, usuario: number) {
  await validarAlguma(sql, usuario, [CodigoPermissao.Bots, CodigoPermissao.Permissoes, CodigoPermissao.Conhecimento])
  return sql<{ id: number; nome: string; descricao: string }[]>`
    select id, nome, descricao from conhecimento_base order by lower(nome)`
}

function nomeBase(nome: string) {
  const limpo = nome.trim()
  if (!limpo || limpo.length > 100) {
    throw httpErrors.badRequest('O nome da base deve ter entre 1 e 100 caracteres.')
  }
  return limpo
}

async function nomeLivre(sql: Sql, nome: string, id = 0) {
  const [existe] = await sql`select 1 from conhecimento_base where lower(nome) = lower(${nome}) and id <> ${id}`
  if (existe) {
    throw httpErrors.badRequest('Já existe uma base com esse nome.')
  }
}

export async function incluirBase(sql: Sql, usuario: number, corpo: Corpo<'incluirBase'>) {
  await validarPermissao(sql, usuario, CodigoPermissao.Conhecimento)
  const nome = nomeBase(corpo.nome)
  await nomeLivre(sql, nome)
  const [base] = await sql<{ id: number; nome: string; descricao: string }[]>`
    insert into conhecimento_base (nome, descricao) values (${nome}, ${corpo.descricao?.trim() ?? ''})
    returning id, nome, descricao`
  return { ...base!, documentos: 0, trechos: 0 }
}

export async function alterarBase(sql: Sql, usuario: number, corpo: Corpo<'alterarBase'>) {
  await validarPermissao(sql, usuario, CodigoPermissao.Conhecimento)
  const nome = nomeBase(corpo.nome)
  await nomeLivre(sql, nome, corpo.id)
  const [base] = await sql`update conhecimento_base set nome = ${nome}, descricao = ${corpo.descricao?.trim() ?? ''} where id = ${corpo.id} returning id`
  if (!base) {
    throw httpErrors.notFound('Base não encontrada!')
  }
  const [alterada] = (await listarBases(sql, usuario)).filter((b) => b.id === corpo.id)
  return alterada!
}

export async function excluirBase(sql: Sql, usuario: number, id: number) {
  await validarPermissao(sql, usuario, CodigoPermissao.Conhecimento)
  const [base] = await sql`delete from conhecimento_base where id = ${id} returning id`
  if (!base) {
    throw httpErrors.notFound('Base não encontrada!')
  }
  await apagarPontos('base_id', id)
  return { id }
}

export async function listarDocumentos(sql: Sql, usuario: number, base: number) {
  await validarPermissao(sql, usuario, CodigoPermissao.Conhecimento)
  return sql<{ id: number; base_id: number; nome: string; caracteres: number; trechos: number; status: StatusDocumento; erro: string | null; criado_em: Date }[]>`
    select id, base_id, nome, length(texto)::int as caracteres, trechos, status, erro, criado_em
      from conhecimento_documento
     where base_id = ${base}
     order by criado_em desc, id desc`
}

export async function incluirDocumento(sql: Sql, usuario: number, corpo: Corpo<'incluirDocumento'>) {
  await validarPermissao(sql, usuario, CodigoPermissao.Conhecimento)
  if (!conhecimentoLigado()) {
    throw httpErrors.badRequest('Base de conhecimento desligada: defina o modelo de embeddings nas configurações do sistema.')
  }
  const texto = corpo.texto.trim()
  if (!texto) {
    throw httpErrors.badRequest('O documento não tem texto.')
  }
  if (texto.length > LIMITE_TEXTO) {
    throw httpErrors.badRequest('Documento grande demais (limite de 2 milhões de caracteres).')
  }
  const [base] = await sql`select 1 from conhecimento_base where id = ${corpo.base_id}`
  if (!base) {
    throw httpErrors.notFound('Base não encontrada!')
  }
  const [documento] = await sql<{ id: number }[]>`
    insert into conhecimento_documento (base_id, nome, texto, status)
    values (${corpo.base_id}, ${corpo.nome.trim().slice(0, 255) || 'Documento'}, ${texto}, ${StatusDocumento.Processando})
    returning id`
  indexarDepois(documento!.id)
  const [criado] = (await listarDocumentos(sql, usuario, corpo.base_id)).filter((d) => d.id === documento!.id)
  return criado!
}

export async function excluirDocumento(sql: Sql, usuario: number, id: number) {
  await validarPermissao(sql, usuario, CodigoPermissao.Conhecimento)
  const [documento] = await sql`delete from conhecimento_documento where id = ${id} returning id`
  if (!documento) {
    throw httpErrors.notFound('Documento não encontrado!')
  }
  await apagarPontos('documento_id', id)
  return { id }
}

// Modelo de embeddings trocado: apaga a colecao e indexa tudo de novo
export async function reindexarTudo(sql: Sql, usuario: number) {
  await validarPermissao(sql, usuario, CodigoPermissao.Conhecimento)
  if (!conhecimentoLigado()) {
    throw httpErrors.badRequest('Base de conhecimento desligada: defina o modelo de embeddings nas configurações do sistema.')
  }
  try {
    await qdrant('DELETE', colecao())
  } catch (erro) {
    if ((erro as { status?: number }).status !== 404) throw erro
  }
  const documentos = await sql<{ id: number }[]>`
    update conhecimento_documento set status = ${StatusDocumento.Processando}, trechos = 0, erro = null returning id`
  for (const { id } of documentos) indexarDepois(id)
  return { documentos: documentos.length }
}

// "Testar busca" da tela: os trechos que o bot receberia
export async function testarBusca(sql: Sql, usuario: number, corpo: Corpo<'buscarConhecimento'>) {
  await validarPermissao(sql, usuario, CodigoPermissao.Conhecimento)
  return buscarTrechos(corpo.bases, corpo.pergunta, corpo.limite ?? TRECHOS_POR_BUSCA)
}

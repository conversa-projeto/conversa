import type { Sql } from './banco.ts'
import { validarAcessoConversa } from './autorizacao.ts'
import type { Corpo } from './esquemas.ts'
import { httpErrors } from './erros.ts'
import { carregarMensagens } from './mensagens.ts'
import { notificarPastas } from './websocket.ts'

// Pastas de mensagens nas conversas diretas. A pasta so marca: a mensagem
// continua no chat e pode estar em varias. Cada pessoa ve as proprias e as
// compartilhadas pela outra; na compartilhada os dois poem e tiram mensagens,
// mas so o dono renomeia, muda a cor, deixa de compartilhar e exclui.

const TAMANHO_NOME = 60
const LIMITE_PASTAS = 50
const MENSAGENS_POR_PAGINA = 50

interface PastaLinha {
  id: number
  conversa_id: number
  usuario_id: number
  nome: string
  cor: string
  compartilhada: boolean
}

export interface PastaResposta {
  id: number
  conversa_id: number
  dono_id: number
  nome: string
  cor: string
  compartilhada: boolean
  mensagens: number
}

function validarNome(nome: string) {
  const limpo = nome.trim()
  if (!limpo) {
    throw httpErrors.badRequest('Informe o nome da pasta.')
  }
  if (limpo.length > TAMANHO_NOME) {
    throw httpErrors.badRequest(`O nome da pasta pode ter até ${TAMANHO_NOME} caracteres.`)
  }
  return limpo
}

// Pasta que o usuario enxerga (a dele ou compartilhada) numa conversa de que ainda participa
async function lerPasta(sql: Sql, usuario: number, pasta: number): Promise<PastaLinha> {
  const [dados] = await sql<PastaLinha[]>`
    select id, conversa_id, usuario_id, nome, cor, compartilhada
      from pasta
     where id = ${pasta}
       and (usuario_id = ${usuario} or compartilhada)`
  if (!dados) {
    throw httpErrors.notFound('Pasta não encontrada!')
  }
  await validarAcessoConversa(sql, usuario, dados.conversa_id)
  return dados
}

async function lerPastaDoDono(sql: Sql, usuario: number, pasta: number) {
  const dados = await lerPasta(sql, usuario, pasta)
  if (dados.usuario_id !== usuario) {
    throw httpErrors.forbidden('Só quem criou a pasta pode mudá-la.')
  }
  return dados
}

// Quem enxerga a pasta atualiza a lista (e as marcas nas bolhas): o dono e,
// compartilhada (antes ou depois da mudança), a outra pessoa
async function avisar(sql: Sql, pasta: PastaLinha, compartilhada: boolean, extras: { mensagens?: number[]; acao?: 'incluir' | 'tirar' } = {}) {
  const destinos = compartilhada
    ? (await sql<{ usuario_id: number }[]>`select usuario_id from conversa_usuario where conversa_id = ${pasta.conversa_id}`).map((linha) => linha.usuario_id)
    : [pasta.usuario_id]
  for (const destino of new Set(destinos)) {
    notificarPastas(destino, pasta.conversa_id, pasta.id, extras)
  }
}

export async function listarPastas(sql: Sql, usuario: number, conversa: number): Promise<PastaResposta[]> {
  await validarAcessoConversa(sql, usuario, conversa)
  return sql<PastaResposta[]>`
    select p.id
         , p.conversa_id
         , p.usuario_id as dono_id
         , p.nome
         , p.cor
         , p.compartilhada
         , (select count(1)::int from pasta_mensagem pm where pm.pasta_id = p.id) as mensagens
      from pasta p
     where p.conversa_id = ${conversa}
       and (p.usuario_id = ${usuario} or p.compartilhada)
     order by lower(p.nome), p.id`
}

export async function incluirPasta(sql: Sql, usuario: number, corpo: Corpo<'incluirPasta'>) {
  await validarAcessoConversa(sql, usuario, corpo.conversa_id)
  const [conversa] = await sql<{ tipo: number }[]>`select tipo from conversa where id = ${corpo.conversa_id}`
  if (conversa?.tipo !== 1) {
    throw httpErrors.badRequest('Pastas só existem nas conversas diretas.')
  }
  const nome = validarNome(corpo.nome)
  const [contagem] = await sql<{ total: number }[]>`
    select count(1)::int as total from pasta where conversa_id = ${corpo.conversa_id} and usuario_id = ${usuario}`
  if ((contagem?.total ?? 0) >= LIMITE_PASTAS) {
    throw httpErrors.badRequest(`Cada pessoa pode ter até ${LIMITE_PASTAS} pastas por conversa.`)
  }
  const [nova] = await sql<PastaLinha[]>`
    insert into pasta (conversa_id, usuario_id, nome, cor, compartilhada)
    values (${corpo.conversa_id}, ${usuario}, ${nome}, ${corpo.cor ?? ''}, ${corpo.compartilhada ?? false})
    returning id, conversa_id, usuario_id, nome, cor, compartilhada`
  await avisar(sql, nova!, nova!.compartilhada)
  return resposta(nova!, 0)
}

export async function alterarPasta(sql: Sql, usuario: number, corpo: Corpo<'alterarPasta'>) {
  const atual = await lerPastaDoDono(sql, usuario, corpo.id)
  const nome = corpo.nome === undefined ? atual.nome : validarNome(corpo.nome)
  const [alterada] = await sql<PastaLinha[]>`
    update pasta
       set nome = ${nome}
         , cor = ${corpo.cor ?? atual.cor}
         , compartilhada = ${corpo.compartilhada ?? atual.compartilhada}
     where id = ${atual.id}
 returning id, conversa_id, usuario_id, nome, cor, compartilhada`
  await avisar(sql, alterada!, atual.compartilhada || alterada!.compartilhada)
  const [contagem] = await sql<{ total: number }[]>`select count(1)::int as total from pasta_mensagem where pasta_id = ${atual.id}`
  return resposta(alterada!, contagem?.total ?? 0)
}

export async function excluirPasta(sql: Sql, usuario: number, pasta: number) {
  const atual = await lerPastaDoDono(sql, usuario, pasta)
  await sql`delete from pasta where id = ${atual.id}`
  await avisar(sql, atual, atual.compartilhada)
  return { id: atual.id }
}

// Mensagens da conversa da pasta que o usuario enxerga (agendada de outra pessoa
// ainda nao saiu; resposta de postagem nao existe em conversa direta)
async function mensagensValidas(sql: Sql, usuario: number, conversa: number, mensagens: number[]) {
  const linhas = await sql<{ id: number }[]>`
    select m.id
      from mensagem m
     where m.id in ${sql(mensagens)}
       and m.conversa_id = ${conversa}
       and (m.usuario_id = ${usuario} or m.visivel_em is null or m.visivel_em <= now())`
  if (linhas.length !== new Set(mensagens).size) {
    throw httpErrors.badRequest('Alguma das mensagens não é desta conversa.')
  }
  return linhas.map((linha) => linha.id)
}

export async function incluirMensagensPasta(sql: Sql, usuario: number, corpo: Corpo<'mensagensPasta'>) {
  const pasta = await lerPasta(sql, usuario, corpo.pasta_id)
  const mensagens = await mensagensValidas(sql, usuario, pasta.conversa_id, corpo.mensagens)
  const incluidas = await sql<{ mensagem_id: number }[]>`
    insert into pasta_mensagem (pasta_id, mensagem_id)
    select ${pasta.id}, unnest(${sql.array(mensagens)}::int4[])
        on conflict (pasta_id, mensagem_id) do nothing
 returning mensagem_id`
  await avisar(sql, pasta, pasta.compartilhada, { mensagens, acao: 'incluir' })
  return { pasta_id: pasta.id, incluidas: incluidas.length }
}

export async function tirarMensagensPasta(sql: Sql, usuario: number, corpo: Corpo<'mensagensPasta'>) {
  const pasta = await lerPasta(sql, usuario, corpo.pasta_id)
  const tiradas = await sql<{ mensagem_id: number }[]>`
    delete from pasta_mensagem
     where pasta_id = ${pasta.id}
       and mensagem_id in ${sql(corpo.mensagens)}
 returning mensagem_id`
  await avisar(sql, pasta, pasta.compartilhada, { mensagens: corpo.mensagens, acao: 'tirar' })
  return { pasta_id: pasta.id, tiradas: tiradas.length }
}

// Mensagens da pasta, da mais antiga à mais nova, de 50 em 50; "antes" é o id
// da mais antiga já carregada (0 = as mais recentes)
export async function mensagensDaPasta(sql: Sql, usuario: number, pasta: number, antes: number) {
  const dados = await lerPasta(sql, usuario, pasta)
  const posicao = sql`((select coalesce(visivel_em, inserida) from mensagem where id = ${antes}), ${antes})`
  return carregarMensagens(sql, dados.conversa_id, usuario, sql`
    select id
      from ( select m.id
               from pasta_mensagem pm
              inner join mensagem m
                 on m.id = pm.mensagem_id
              where pm.pasta_id = ${dados.id}
                and (m.usuario_id = ${usuario} or m.visivel_em is null or m.visivel_em <= now())
                ${antes > 0 ? sql`and (coalesce(m.visivel_em, m.inserida), m.id) < ${posicao}` : sql``}
              order by coalesce(m.visivel_em, m.inserida) desc, m.id desc
              limit ${MENSAGENS_POR_PAGINA}
           ) as tbl`, false)
}

function resposta(pasta: PastaLinha, mensagens: number): PastaResposta {
  return {
    id: pasta.id,
    conversa_id: pasta.conversa_id,
    dono_id: pasta.usuario_id,
    nome: pasta.nome,
    cor: pasta.cor,
    compartilhada: pasta.compartilhada,
    mensagens,
  }
}

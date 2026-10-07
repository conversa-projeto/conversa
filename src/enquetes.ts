import { transacao, type Sql } from './banco.ts'
import { validarAcessoConversa } from './autorizacao.ts'
import type { Corpo } from './esquemas.ts'
import { httpErrors } from './erros.ts'
import { incluirMensagem } from './mensagens.ts'
import { notificarEnquete } from './websocket.ts'

// Votacao (enquete) em grupos. A mensagem leva so o id da enquete (conteudo
// tipo 8); pergunta, opcoes e votos sao lidos aqui, e cada voto avisa os
// membros para as bolhas abertas atualizarem na hora.

export async function criarEnquete(sql: Sql, usuario: number, corpo: Corpo<'criarEnquete'>) {
  await validarAcessoConversa(sql, usuario, corpo.conversa_id)
  const [conversa] = await sql<{ tipo: number }[]>`select tipo from conversa where id = ${corpo.conversa_id}`
  if (conversa?.tipo !== 2) {
    throw httpErrors.badRequest('Votação só pode ser criada em grupos.')
  }
  const pergunta = corpo.pergunta.trim()
  const opcoes = corpo.opcoes.map((opcao) => opcao.trim()).filter(Boolean)
  if (!pergunta) {
    throw httpErrors.badRequest('Informe a pergunta da votação.')
  }
  if (opcoes.length < 2) {
    throw httpErrors.badRequest('A votação precisa de pelo menos duas opções.')
  }
  if (new Set(opcoes.map((opcao) => opcao.toLowerCase())).size !== opcoes.length) {
    throw httpErrors.badRequest('As opções da votação não podem se repetir.')
  }

  const enquete = await transacao(sql, async () => {
    const [nova] = await sql<{ id: number }[]>`
      insert into enquete (conversa_id, pergunta, multipla) values (${corpo.conversa_id}, ${pergunta}, ${corpo.multipla}) returning id`
    for (const [indice, texto] of opcoes.entries()) {
      await sql`insert into enquete_opcao (enquete_id, ordem, texto) values (${nova!.id}, ${indice + 1}, ${texto})`
    }
    return nova!.id
  })

  const mensagem = await incluirMensagem(sql, usuario, {
    conversa_id: corpo.conversa_id,
    conteudos: [{ ordem: 1, tipo: 8, conteudo: String(enquete) }],
  }, true)
  await sql`update enquete set mensagem_id = ${mensagem.id} where id = ${enquete}`
  return { ...mensagem, enquete_id: enquete }
}

export interface OpcaoLinha {
  id: number
  texto: string
  votantes: { id: number; nome: string }[]
}

// Pergunta, opcoes com quem votou em cada uma e os votos de quem pergunta
export async function dadosEnquete(sql: Sql, usuario: number, enquete: number) {
  const [dados] = await sql<{ id: number; conversa_id: number; mensagem_id: number | null; pergunta: string; multipla: boolean; criado_por: number | null }[]>`
    select id, conversa_id, mensagem_id, pergunta, multipla, criado_por from enquete where id = ${enquete}`
  if (!dados) {
    throw httpErrors.notFound('Votação não encontrada!')
  }
  await validarAcessoConversa(sql, usuario, dados.conversa_id)
  const opcoes = await sql<OpcaoLinha[]>`
    select o.id
         , o.texto
         , coalesce(json_agg(json_build_object('id', u.id, 'nome', u.nome) order by v.criado_em)
                    filter (where v.id is not null), '[]') as votantes
      from enquete_opcao o
      left join enquete_voto v on v.opcao_id = o.id
      left join usuario u on u.id = v.usuario_id
     where o.enquete_id = ${enquete}
     group by o.id, o.texto, o.ordem
     order by o.ordem`
  const votantes = new Set(opcoes.flatMap((opcao) => opcao.votantes.map((v) => v.id)))
  return {
    ...dados,
    opcoes,
    total_votantes: votantes.size,
    meus_votos: opcoes.filter((opcao) => opcao.votantes.some((v) => v.id === usuario)).map((opcao) => opcao.id),
  }
}

// O voto do usuario passa a ser exatamente as opcoes enviadas: lista vazia tira
// o voto. Escolha unica aceita uma so.
export async function votarEnquete(sql: Sql, usuario: number, corpo: Corpo<'votarEnquete'>) {
  const [enquete] = await sql<{ conversa_id: number; multipla: boolean }[]>`
    select conversa_id, multipla from enquete where id = ${corpo.enquete_id}`
  if (!enquete) {
    throw httpErrors.notFound('Votação não encontrada!')
  }
  await validarAcessoConversa(sql, usuario, enquete.conversa_id)
  const escolhidas = [...new Set(corpo.opcoes)]
  if (!enquete.multipla && escolhidas.length > 1) {
    throw httpErrors.badRequest('Esta votação aceita uma opção só.')
  }
  if (escolhidas.length) {
    const [validas] = await sql<{ total: number }[]>`
      select count(1)::int as total from enquete_opcao where enquete_id = ${corpo.enquete_id} and id in ${sql(escolhidas)}`
    if (validas?.total !== escolhidas.length) {
      throw httpErrors.badRequest('Opção que não é desta votação.')
    }
  }

  await transacao(sql, async () => {
    await sql`delete from enquete_voto where enquete_id = ${corpo.enquete_id} and usuario_id = ${usuario}`
    for (const opcao of escolhidas) {
      await sql`insert into enquete_voto (enquete_id, opcao_id, usuario_id) values (${corpo.enquete_id}, ${opcao}, ${usuario})`
    }
  })

  // Todos os membros, inclusive as outras abas de quem votou
  const membros = await sql<{ usuario_id: number }[]>`
    select usuario_id from conversa_usuario where conversa_id = ${enquete.conversa_id}`
  for (const { usuario_id } of membros) {
    notificarEnquete(usuario_id, corpo.enquete_id, enquete.conversa_id)
  }
  return dadosEnquete(sql, usuario, corpo.enquete_id)
}

import type { Sql } from './banco.ts'
import type { Consulta } from './esquemas.ts'
import { comAvatarUrl } from './conversas.ts'
import { notificarAtividade } from './websocket.ts'

// Atividades do usuario (tabela atividade): gravadas quando o evento acontece e
// apagadas quando ele deixa de valer (reacao retirada, mensagem ocultada).
export const TipoAtividade = {
  Reacao: 1,
  Resposta: 2,
  Mencao: 3,
  ChamadaPerdida: 4,
} as const
export type TipoAtividade = (typeof TipoAtividade)[keyof typeof TipoAtividade]

export interface NovaAtividade {
  usuario_id: number
  tipo: TipoAtividade
  autor_id: number
  conversa_id?: number | null
  mensagem_id?: number | null
  chamada_id?: number | null
  emoji?: string | null
  // Mensagem agendada: aparece so quando ela sai
  criado_em?: Date | string | null
}

// Grava e avisa quem recebe. Ninguem recebe atividade do que ele mesmo fez.
// Chamada perdida repetida para a mesma pessoa e ignorada.
export async function registrarAtividades(sql: Sql, atividades: NovaAtividade[]) {
  const validas = atividades.filter((a) => a.usuario_id !== a.autor_id)
  for (const a of validas) {
    await sql`
      insert into atividade (usuario_id, tipo, autor_id, conversa_id, mensagem_id, chamada_id, emoji, criado_em)
      values (${a.usuario_id}, ${a.tipo}, ${a.autor_id}, ${a.conversa_id ?? null}, ${a.mensagem_id ?? null},
              ${a.chamada_id ?? null}, ${a.emoji ?? null}, coalesce(${a.criado_em ?? null}::timestamp, current_timestamp))
      on conflict (usuario_id, chamada_id) where tipo = 4 do nothing`
  }
  // Agendada ainda no futuro avisa quando sair (notificarMensagemAgendada)
  const agora = Date.now()
  const avisar = new Set(validas.filter((a) => !a.criado_em || new Date(a.criado_em).getTime() <= agora).map((a) => a.usuario_id))
  for (const usuario of avisar) {
    notificarAtividade(usuario)
  }
}

// Apaga as atividades ligadas a mensagem (mensagem ocultada ou apagada) e avisa
// quem as tinha, para o contador acompanhar
export async function apagarAtividadesMensagem(sql: Sql, mensagem: number) {
  const apagadas = await sql<{ usuario_id: number }[]>`
    delete from atividade where mensagem_id = ${mensagem} returning usuario_id`
  for (const usuario of new Set(apagadas.map((a) => a.usuario_id))) {
    notificarAtividade(usuario)
  }
}

// Mensagem agendada saiu: quem recebeu atividade dela fica sabendo agora
export async function avisarAtividadesMensagem(sql: Sql, mensagem: number) {
  const alvos = await sql<{ usuario_id: number }[]>`
    select distinct usuario_id from atividade where mensagem_id = ${mensagem}`
  for (const { usuario_id } of alvos) {
    notificarAtividade(usuario_id)
  }
}

export async function apagarAtividadeReacao(sql: Sql, mensagem: number, autor: number, emoji: string) {
  const apagadas = await sql<{ usuario_id: number }[]>`
    delete from atividade
     where tipo = ${TipoAtividade.Reacao}
       and mensagem_id = ${mensagem}
       and autor_id = ${autor}
       and emoji = ${emoji}
 returning usuario_id`
  for (const usuario of new Set(apagadas.map((a) => a.usuario_id))) {
    notificarAtividade(usuario)
  }
}

// Mencoes no texto, no formato @[Nome](id)
export function idsMencionados(texto: string): number[] {
  return [...new Set([...texto.matchAll(/@\[[^\]]+\]\((\d+)\)/g)].map((m) => Number(m[1])))]
}

interface AtividadeLinha {
  id: string
  tipo: TipoAtividade
  criado_em: Date
  nova: boolean
  autor_id: number
  autor_nome: string
  avatar_objeto: string | null
  conversa_id: number | null
  conversa_tipo: number | null
  conversa_descricao: string | null
  mensagem_id: number | null
  conteudo_tipo: number | null
  texto: string | null
  chamada_id: number | null
  chamada_tipo: number | null
  emoji: string | null
}

// Mais recentes primeiro, em paginas: antes e o id da ultima atividade da
// pagina anterior. So conversas de que o usuario ainda participa.
export async function atividades(sql: Sql, usuario: number, consulta: Consulta<'atividades'>) {
  const linhas = await sql<AtividadeLinha[]>`
    select a.id
         , a.tipo
         , a.criado_em
         , a.criado_em > coalesce(eu.atividades_vistas_em, '-infinity'::timestamp) as nova
         , a.autor_id
         , autor.nome as autor_nome
         , av.objeto as avatar_objeto
         , a.conversa_id
         , c.tipo as conversa_tipo
         , nullif(trim(c.descricao), '') as conversa_descricao
         , a.mensagem_id
         , primeiro.tipo as conteudo_tipo
         , texto.conteudo as texto
         , a.chamada_id
         , ch.tipo as chamada_tipo
         , a.emoji
      from atividade a
     inner join usuario eu on eu.id = a.usuario_id
     inner join usuario autor on autor.id = a.autor_id
      left join anexo av on av.id = autor.avatar_anexo_id
      left join conversa c on c.id = a.conversa_id
      left join chamada ch on ch.id = a.chamada_id
      left join lateral ( select mc.tipo
                            from mensagem_conteudo mc
                           where mc.mensagem_id = a.mensagem_id
                           order by mc.ordem
                           limit 1 ) as primeiro on true
      left join lateral ( select convert_from(mc.conteudo, 'UTF8') as conteudo
                            from mensagem_conteudo mc
                           where mc.mensagem_id = a.mensagem_id
                             and mc.tipo = 1
                           order by mc.ordem
                           limit 1 ) as texto on true
     where a.usuario_id = ${usuario}
       and a.criado_em <= current_timestamp
       and (a.conversa_id is null
            or exists (select 1 from conversa_usuario cu where cu.conversa_id = a.conversa_id and cu.usuario_id = ${usuario}))
       ${consulta.antes > 0
         ? sql`and (a.criado_em, a.id) < (select criado_em, id from atividade where id = ${consulta.antes} and usuario_id = ${usuario})`
         : sql``}
     order by a.criado_em desc, a.id desc
     limit ${consulta.limite}`
  return Promise.all(linhas.map(async (linha) => {
    const { avatar_url, ...resto } = await comAvatarUrl(linha)
    return { ...resto, id: Number(linha.id), texto: linha.texto ? resumir(linha.texto) : null, autor_avatar_url: avatar_url }
  }))
}

// Previa de uma linha: mencao vira @Nome, sem quebras, cortada
function resumir(texto: string) {
  const linha = texto.replace(/@\[([^\]]+)\]\(\d+\)/g, '@$1').replace(/\s+/g, ' ').trim()
  return linha.length > 120 ? `${linha.slice(0, 119)}…` : linha
}

export async function atividadesNovas(sql: Sql, usuario: number) {
  const [linha] = await sql<{ quantidade: number }[]>`
    select count(1)::int as quantidade
      from atividade a
     inner join usuario eu on eu.id = a.usuario_id
     where a.usuario_id = ${usuario}
       and a.criado_em <= current_timestamp
       and a.criado_em > coalesce(eu.atividades_vistas_em, '-infinity'::timestamp)`
  return { quantidade: linha?.quantidade ?? 0 }
}

export async function marcarAtividadesVistas(sql: Sql, usuario: number) {
  const [linha] = await sql<{ atividades_vistas_em: Date }[]>`
    update usuario set atividades_vistas_em = current_timestamp where id = ${usuario} returning atividades_vistas_em`
  return { vistas_em: linha!.atividades_vistas_em }
}

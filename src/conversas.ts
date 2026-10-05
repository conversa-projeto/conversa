import type { Sql } from './banco.ts'
import { validarAcessoConversa, validarRemocaoConversaUsuario } from './autorizacao.ts'
import { alterar, excluir, inserir } from './comum.ts'
import type { Corpo } from './esquemas.ts'
import { urlPublica } from './minio.ts'
import type { ConversaUsuario, TipoConversa } from './tabelas.ts'
import { notificarMembrosConversa } from './notificacoes.ts'
import { TipoMensagemSocket } from './websocket.ts'

// Troca avatar_objeto por avatar_url assinada, no fim do objeto.
export async function comAvatarUrl<T extends { avatar_objeto: string | null }>({ avatar_objeto, ...linha }: T): Promise<Omit<T, 'avatar_objeto'> & { avatar_url: string | null }> {
  return { ...linha, avatar_url: avatar_objeto ? await urlPublica('GET', avatar_objeto, 600) : null }
}

// Conversa na lista do usuario, com a ultima mensagem e o que falta ler
export interface ConversaLista {
  id: number
  descricao: string | null
  tipo: TipoConversa
  inserida: Date
  nome: string | null
  destinatario_id: number | null
  mensagem_id: number
  ultima_mensagem: Date | null
  ultima_mensagem_texto: string | null
  mensagens_sem_visualizar: number
  avatar_objeto: string | null
  fixada_ordem: number | null
  arquivada_em: Date | null
}

export interface MembroConversa {
  id: number
  usuario_id: number
  nome: string
  avatar_objeto: string | null
}

export async function incluirConversa(sql: Sql, usuario: number, corpo: Corpo<'incluirConversa'>) {
  const conversa = await inserir(sql, 'conversa', corpo, ['descricao', 'tipo'])
  // O criador entra como membro. criado_por vem do app.usuario_id no Postgres.
  await inserir(sql, 'conversa_usuario', { conversa_id: conversa.id, usuario_id: usuario }, ['conversa_id', 'usuario_id'])
  return conversa
}

export async function alterarConversa(sql: Sql, usuario: number, corpo: Corpo<'alterarConversa'>) {
  await validarAcessoConversa(sql, usuario, corpo.id)
  return alterar(sql, 'conversa', corpo.id, corpo, ['descricao'])
}

export async function excluirConversa(sql: Sql, usuario: number, conversa: number) {
  await validarAcessoConversa(sql, usuario, conversa)
  return excluir(sql, 'conversa', conversa)
}

export async function conversas(sql: Sql, usuario: number) {
  const linhas = await sql<ConversaLista[]>`
    with temp_conversa as
         ( select c.id
                , c.descricao
                , c.tipo
                , c.inserida
                , cu.fixada_ordem
                , cu.arquivada_em
             from
                ( select conversa_id
                       , min(fixada_ordem) as fixada_ordem
                       , max(arquivada_em) as arquivada_em
                    from conversa_usuario
                   where usuario_id = ${usuario}
                   group by conversa_id
                ) as cu
            inner
             join conversa c
               on c.id = cu.conversa_id
         )
  select tc.id
       , coalesce(nullif(trim(tc.descricao), ''), d.nome) as descricao
       , tc.tipo
       , tc.inserida
       , d.nome
       , d.destinatario_id
       , coalesce(tcm.mensagem_id, 0) as mensagem_id
       , tcm.ultima_mensagem
       , convert_from(tcm.ultima_mensagem_texto, 'utf-8') as ultima_mensagem_texto
       , cast(coalesce(mensagens_sem_visualizar, 0) as int) as mensagens_sem_visualizar
       , d.avatar_objeto
       , tc.fixada_ordem
       , tc.arquivada_em
    from temp_conversa tc
    left
    join
       ( select d.conversa_id
              , d.destinatario_id
              , u.nome
              , a.objeto as avatar_objeto
           from
              ( select distinct on (cu.conversa_id)
                       cu.conversa_id
                     , cu.usuario_id as destinatario_id
                  from temp_conversa tc
                 inner
                  join conversa_usuario cu
                    on cu.conversa_id = tc.id
                 where tc.tipo = 1 /* 1-Chat */
                 order
                    by cu.conversa_id
                     , case when cu.usuario_id = ${usuario} then 1 else 0 end
                     , cu.usuario_id
              ) d
          inner
           join usuario u
             on u.id = d.destinatario_id
           left
           join anexo as a
             on a.id = u.avatar_anexo_id
       ) as d
      on d.conversa_id = tc.id
    left
    join
       ( select *
           from
              ( select tcm.conversa_id
                     , tcm.mensagem_id as mensagem_id
                     , tcm.inserida as ultima_mensagem
                     , case
                       when tcm.excluida_em is not null then convert_to('Mensagem oculta', 'UTF8')
                       when mc.tipo = 1 then mc.conteudo
                       when mc.tipo = 2 then 'imagem'
                       when mc.tipo = 7 then 'figurinha'
                       else ''
                        end as ultima_mensagem_texto
                     , row_number() over(partition by tcm.conversa_id, tcm.mensagem_id order by mc.ordem) as rid_conteudo
                  from
                     ( select *
                         from
                            ( select tc.id as conversa_id
                                   , m.id as mensagem_id
                                   , coalesce(m.visivel_em, m.inserida) as inserida
                                   , m.excluida_em
                                   , row_number() over(partition by tc.id order by coalesce(m.visivel_em, m.inserida) desc) as rid
                                from temp_conversa tc
                               inner
                                join mensagem m
                                  on m.conversa_id = tc.id
                                 and (m.usuario_id = ${usuario} or m.visivel_em is null or m.visivel_em <= now())
                            ) as tcm
                        where tcm.rid = 1
                     ) as tcm
                 inner
                  join mensagem_conteudo mc
                    on mc.mensagem_id = tcm.mensagem_id
              ) as tcm
          where tcm.rid_conteudo = 1
       ) as tcm
      on tcm.conversa_id = tc.id
    left
    join
       ( select ms.conversa_id
              , count(1) as mensagens_sem_visualizar
           from conversa c
          inner
           join mensagem_status ms
             on ms.conversa_id = c.id
            and (ms.recebida is null or ms.visualizada is null)
            and ms.usuario_id = ${usuario}
          inner
           join mensagem m
             on m.id = ms.mensagem_id
            and (m.visivel_em is null or m.visivel_em <= now())
          group
             by ms.conversa_id
       ) as msg_count
      on msg_count.conversa_id = tc.id
   order
      by tcm.ultima_mensagem desc`
  return Promise.all(linhas.map(comAvatarUrl))
}

// Fixadas do usuário, na ordem em que devem aparecer. As que não estão na
// lista deixam de ser fixadas.
export async function ordenarFixadas(sql: Sql, usuario: number, conversas: number[]) {
  await sql`
    update conversa_usuario
       set fixada_ordem = array_position(${conversas}::int4[], conversa_id)
     where usuario_id = ${usuario}
       and (fixada_ordem is not null or conversa_id = any(${conversas}::int4[]))`
  return { conversas }
}

// Arquivada some da lista e não notifica; também deixa de ser fixada
export async function arquivarConversa(sql: Sql, usuario: number, conversa: number, arquivada: boolean) {
  await validarAcessoConversa(sql, usuario, conversa)
  await sql`
    update conversa_usuario
       set arquivada_em = ${arquivada ? sql`current_timestamp` : null}
         , fixada_ordem = case when ${arquivada} then null else fixada_ordem end
     where usuario_id = ${usuario}
       and conversa_id = ${conversa}`
  return { id: conversa, arquivada }
}

export async function membrosConversa(sql: Sql, usuario: number, conversa: number) {
  const linhas = await sql<MembroConversa[]>`
    select cu.id
         , cu.usuario_id
         , u.nome
         , a.objeto as avatar_objeto
      from conversa_usuario as cu
     inner join usuario as u
        on u.id = cu.usuario_id
      left join anexo as a
        on a.id = u.avatar_anexo_id
     where cu.conversa_id = ${conversa}
       and exists (select cu2.id
                     from conversa_usuario as cu2
                    where cu2.conversa_id = cu.conversa_id
                      and cu2.usuario_id = ${usuario})`
  return Promise.all(linhas.map(comAvatarUrl))
}

export async function incluirMembro(sql: Sql, usuario: number, corpo: Corpo<'incluirMembro'>) {
  await validarAcessoConversa(sql, usuario, corpo.conversa_id)
  // O criador ja entra ao criar a conversa, e o cliente tambem o inclui:
  // quem ja e membro volta como esta, sem erro de chave duplicada.
  const [existente] = await sql<ConversaUsuario[]>`
    select * from conversa_usuario where conversa_id = ${corpo.conversa_id} and usuario_id = ${corpo.usuario_id}`
  if (existente) {
    return existente
  }
  const membro = await inserir(sql, 'conversa_usuario', corpo, ['usuario_id', 'conversa_id'])
  await notificarMembrosConversa(sql, corpo.conversa_id, usuario, TipoMensagemSocket.ConversaNova)
  return membro
}

// Digitando e gravando: so quem participa avisa os demais membros.
export async function avisarAtividade(sql: Sql, usuario: number, conversa: number, tipo: TipoMensagemSocket) {
  await validarAcessoConversa(sql, usuario, conversa)
  await notificarMembrosConversa(sql, conversa, usuario, tipo)
}

export async function excluirMembro(sql: Sql, usuario: number, conversaUsuario: number) {
  await validarRemocaoConversaUsuario(sql, usuario, conversaUsuario)
  return excluir(sql, 'conversa_usuario', conversaUsuario)
}

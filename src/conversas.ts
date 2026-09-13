import type { Linha, Sql } from './banco.ts'
import { validarAcessoConversa, validarRemocaoConversaUsuario } from './autorizacao.ts'
import { alterar, excluir, inserir } from './comum.ts'
import { urlPublica } from './minio.ts'
import { notificarMembrosConversa } from './notificacoes.ts'
import { TipoMensagemSocket } from './websocket.ts'

// Troca avatar_objeto por avatar_url assinada, no fim do objeto.
export async function comAvatarUrl({ avatar_objeto, ...linha }: Linha): Promise<Linha> {
  return { ...linha, avatar_url: avatar_objeto ? await urlPublica('GET', avatar_objeto, 600) : null }
}

export async function incluirConversa(sql: Sql, usuario: number, corpo: Linha) {
  const conversa = await inserir(sql, 'conversa', corpo, ['descricao', 'tipo'])
  // O criador entra como membro. criado_por vem do app.usuario_id no Postgres.
  await inserir(sql, 'conversa_usuario', { conversa_id: conversa.id, usuario_id: usuario }, ['conversa_id', 'usuario_id'])
  return conversa
}

export async function alterarConversa(sql: Sql, usuario: number, corpo: Linha) {
  await validarAcessoConversa(sql, usuario, corpo.id)
  return alterar(sql, 'conversa', corpo.id, corpo, ['descricao'])
}

export async function excluirConversa(sql: Sql, usuario: number, conversa: number) {
  await validarAcessoConversa(sql, usuario, conversa)
  return excluir(sql, 'conversa', conversa)
}

export async function conversas(sql: Sql, usuario: number) {
  const linhas = await sql`
    with temp_conversa as
         ( select distinct c.id
                , c.descricao
                , c.tipo
                , c.inserida
             from
                ( select conversa_id
                    from conversa_usuario
                   where usuario_id = ${usuario}
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
                     , case mc.tipo
                       when 1 then mc.conteudo
                       when 2 then 'imagem'
                       else ''
                        end as ultima_mensagem_texto
                     , row_number() over(partition by tcm.conversa_id, tcm.mensagem_id order by mc.ordem) as rid_conteudo
                  from
                     ( select *
                         from
                            ( select tc.id as conversa_id
                                   , m.id as mensagem_id
                                   , coalesce(m.visivel_em, m.inserida) as inserida
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

export async function membrosConversa(sql: Sql, usuario: number, conversa: number) {
  const linhas = await sql`
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

export async function incluirMembro(sql: Sql, usuario: number, corpo: Linha) {
  await validarAcessoConversa(sql, usuario, corpo.conversa_id)
  // O criador ja entra ao criar a conversa, e o cliente tambem o inclui:
  // quem ja e membro volta como esta, sem erro de chave duplicada.
  const [existente] = await sql`
    select * from conversa_usuario where conversa_id = ${corpo.conversa_id} and usuario_id = ${corpo.usuario_id}`
  if (existente) {
    return existente
  }
  const membro = await inserir(sql, 'conversa_usuario', corpo, ['usuario_id', 'conversa_id'])
  await notificarMembrosConversa(sql, corpo.conversa_id, usuario, TipoMensagemSocket.ConversaNova)
  return membro
}

export async function excluirMembro(sql: Sql, usuario: number, conversaUsuario: number) {
  await validarRemocaoConversaUsuario(sql, usuario, conversaUsuario)
  return excluir(sql, 'conversa_usuario', conversaUsuario)
}

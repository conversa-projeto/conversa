-- Atividades: o que aconteceu com o usuario (reagiram a mensagem dele,
-- responderam, mencionaram, chamada perdida). Uma linha por evento, para quem
-- recebe, gravada quando o evento acontece: listar e contar as novas saem
-- direto do indice, sem cruzar mensagens, reacoes e chamadas.
-- tipo: 1-Reacao, 2-Resposta, 3-Mencao, 4-Chamada perdida
create table if not exists atividade
     ( id bigserial primary key
     , usuario_id int4 not null references usuario(id)
     , tipo int2 not null
     , autor_id int4 not null references usuario(id)
     , conversa_id int4 null references conversa(id)
     , mensagem_id int4 null references mensagem(id)
     , chamada_id int4 null references chamada(id)
     , emoji varchar(10) null
       -- Mensagem agendada: a data em que ela aparece
     , criado_em timestamp not null default current_timestamp
     );
create index if not exists ix_atividade_usuario on atividade(usuario_id, criado_em desc, id desc);
create index if not exists ix_atividade_mensagem on atividade(mensagem_id) where mensagem_id is not null;
-- Uma chamada perdida por pessoa, mesmo avisada por mais de um caminho
create unique index if not exists ux_atividade_chamada_perdida on atividade(usuario_id, chamada_id) where tipo = 4;

-- Ate quando o usuario ja viu as atividades: as mais novas contam como novas
alter table usuario add column if not exists atividades_vistas_em timestamp null;

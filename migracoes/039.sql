-- Confirmacao de leitura: quem envia pede, e cada destinatario marca que leu
alter table mensagem add column if not exists pede_confirmacao bool not null default false;
create table if not exists mensagem_confirmacao
     ( id serial primary key
     , mensagem_id int4 not null references mensagem(id)
     , usuario_id int4 not null references usuario(id)
     , confirmada_em timestamp not null default current_timestamp
     , constraint mensagem_confirmacao_unique unique (mensagem_id, usuario_id)
     );

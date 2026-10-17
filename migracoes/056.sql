-- Pastas de mensagens nas conversas diretas. Cada pessoa organiza as suas;
-- compartilhada, a outra pessoa da conversa tambem ve e poe ou tira mensagens
-- (so o dono renomeia, muda a cor, deixa de compartilhar e exclui). A mensagem
-- continua no chat: a pasta so marca, e a mesma mensagem pode estar em varias.
create table if not exists pasta
     ( id serial primary key
     , conversa_id int4 not null references conversa(id) on delete cascade
     , usuario_id int4 not null references usuario(id) on delete cascade
     , nome varchar(60) not null
     , cor varchar(20) not null default ''
     , compartilhada boolean not null default false
     , criado_em timestamp default current_timestamp
     , criado_por int default nullif(current_setting('app.usuario_id', true), '')::int references usuario(id)
     );

create index if not exists pasta_conversa_idx on pasta (conversa_id);

create table if not exists pasta_mensagem
     ( id serial primary key
     , pasta_id int4 not null references pasta(id) on delete cascade
     , mensagem_id int4 not null references mensagem(id) on delete cascade
     , criado_em timestamp default current_timestamp
     , criado_por int default nullif(current_setting('app.usuario_id', true), '')::int references usuario(id)
     , constraint pasta_mensagem_unique unique (pasta_id, mensagem_id)
     );

create index if not exists pasta_mensagem_mensagem_idx on pasta_mensagem (mensagem_id);

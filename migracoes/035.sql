-- Votacao (enquete) em grupos: a mensagem leva o conteudo tipo 8 com o id da
-- enquete; opcoes e votos ficam aqui e mudam sem mexer na mensagem.
create table if not exists enquete
     ( id serial primary key
     , conversa_id int4 not null references conversa(id)
     , mensagem_id int4 null references mensagem(id)
     , pergunta varchar(300) not null
     , multipla bool not null default false
     , criado_em timestamp default current_timestamp
     , criado_por int default nullif(current_setting('app.usuario_id', true), '')::int references usuario(id)
     );

create table if not exists enquete_opcao
     ( id serial primary key
     , enquete_id int4 not null references enquete(id)
     , ordem int2 not null
     , texto varchar(200) not null
     );
create index if not exists ix_enquete_opcao_enquete on enquete_opcao(enquete_id);

create table if not exists enquete_voto
     ( id serial primary key
     , enquete_id int4 not null references enquete(id)
     , opcao_id int4 not null references enquete_opcao(id)
     , usuario_id int4 not null references usuario(id)
     , criado_em timestamp default current_timestamp
     , constraint enquete_voto_unique unique (opcao_id, usuario_id)
     );
create index if not exists ix_enquete_voto_enquete on enquete_voto(enquete_id, usuario_id);

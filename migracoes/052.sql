-- Base de conhecimento dos bots (RAG). Aqui ficam as bases e os documentos,
-- com o texto inteiro (para reindexar quando o modelo de embeddings mudar);
-- os trechos com os vetores ficam no Qdrant. Status do documento:
-- 1-Processando, 2-Pronto, 3-Erro.
create table if not exists conhecimento_base
     ( id serial primary key
     , nome varchar(100) not null
     , descricao text not null default ''
     , criado_em timestamp default current_timestamp
     , criado_por int default nullif(current_setting('app.usuario_id', true), '')::int references usuario(id)
     , constraint conhecimento_base_nome_unique unique (nome)
     );

create table if not exists conhecimento_documento
     ( id serial primary key
     , base_id int4 not null references conhecimento_base(id) on delete cascade
     , nome varchar(255) not null
     , texto text not null
     , trechos int4 not null default 0
     , status int2 not null default 1
     , erro text null
     , criado_em timestamp default current_timestamp
     , criado_por int default nullif(current_setting('app.usuario_id', true), '')::int references usuario(id)
     );

create table if not exists bot_conhecimento
     ( id serial primary key
     , bot_id int4 not null references bot(id) on delete cascade
     , base_id int4 not null references conhecimento_base(id) on delete cascade
     , constraint bot_conhecimento_unique unique (bot_id, base_id)
     );

insert into permissao (codigo, descricao)
values ('conhecimento', 'Cuidar das bases de conhecimento dos bots')
    on conflict (codigo) do nothing;

-- Modelo de embeddings, no mesmo servidor de IA; vazio desliga a base
insert into parametros (nome, valor)
values ('ia_modelo_embeddings', '')
    on conflict (nome) do nothing;

-- Ferramentas externas dos bots: APIs HTTP com JSON que o administrador
-- cadastra e liga em cada bot. O modelo chama pelo nome, com os parametros
-- descritos; os cabecalhos (tokens) ficam so aqui, nunca voltam para a tela
-- nem para o modelo. parametros: [{nome, tipo, descricao, obrigatorio}].
create table if not exists ferramenta
     ( id serial primary key
     , nome varchar(60) not null
     , descricao text not null
     , metodo varchar(6) not null default 'GET'
     , url text not null
     , cabecalhos jsonb not null default '{}'
     , parametros jsonb not null default '[]'
     , ativo boolean not null default true
     , criado_em timestamp default current_timestamp
     , criado_por int default nullif(current_setting('app.usuario_id', true), '')::int references usuario(id)
     , constraint ferramenta_nome_unique unique (nome)
     , constraint ferramenta_metodo_check check (metodo in ('GET', 'POST'))
     );

create table if not exists bot_ferramenta
     ( id serial primary key
     , bot_id int4 not null references bot(id) on delete cascade
     , ferramenta_id int4 not null references ferramenta(id) on delete cascade
     , constraint bot_ferramenta_unique unique (bot_id, ferramenta_id)
     );

insert into permissao (codigo, descricao)
values ('ferramentas', 'Cadastrar as ferramentas externas dos bots')
    on conflict (codigo) do nothing;

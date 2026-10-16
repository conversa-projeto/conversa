-- Bots de IA: cada bot e um usuario comum (as permissoes de uso valem para ele
-- como para qualquer pessoa), com as instrucoes de personalidade e do que faz.
-- Nao entra pelo login; quem criou e quem tem "permissoes" editam.
create table if not exists bot
     ( id serial primary key
     , usuario_id int4 not null references usuario(id)
     , instrucoes text not null
     , ativo boolean not null default true
     , criado_em timestamp default current_timestamp
     , criado_por int default nullif(current_setting('app.usuario_id', true), '')::int references usuario(id)
     , constraint bot_usuario_unique unique (usuario_id)
     );

insert into permissao (codigo, descricao)
values ('bots', 'Criar bots de IA e editar os próprios')
    on conflict (codigo) do nothing;

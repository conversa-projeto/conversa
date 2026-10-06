-- Permissoes do sistema: o que pode ser liberado (permissao) e quem tem o que
-- (permissao_usuario). O codigo e o que o servidor confere em cada rota.
create table if not exists permissao
     ( id serial primary key
     , codigo varchar(50) not null unique
     , descricao varchar(200) not null
     );

insert into permissao (codigo, descricao)
values ('parametros', 'Ver e alterar as configurações do sistema')
     , ('permissoes', 'Conceder e retirar permissões dos usuários')
    on conflict (codigo) do nothing;

create table if not exists permissao_usuario
     ( id serial primary key
     , usuario_id int4 not null references usuario(id)
     , permissao_id int4 not null references permissao(id)
     , criado_em timestamp default current_timestamp
     , criado_por int default nullif(current_setting('app.usuario_id', true), '')::int references usuario(id)
     , constraint permissao_usuario_unique unique (usuario_id, permissao_id)
     );
create trigger trg_exclusao after delete on permissao_usuario for each row execute function auditoria.fn_exclusao();

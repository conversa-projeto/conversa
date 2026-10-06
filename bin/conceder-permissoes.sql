-- Concede todas as permissoes ao usuario informado. Serve para o primeiro
-- acesso, quando ainda ninguem pode conceder pela tela. Roda no container do
-- banco, em desenvolvimento e em producao:
--
--   docker exec -i postgres psql -U postgres -d conversa -v login=fulano < bin\conceder-permissoes.sql
insert into permissao_usuario (usuario_id, permissao_id)
select u.id, p.id
  from usuario u
 cross join permissao p
 where lower(u.login) = lower(:'login')
    on conflict (usuario_id, permissao_id) do nothing;

select u.login, p.codigo
  from permissao_usuario pu
 inner join usuario u on u.id = pu.usuario_id
 inner join permissao p on p.id = pu.permissao_id
 where lower(u.login) = lower(:'login')
 order by p.id;

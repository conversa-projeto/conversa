-- Cadastrar usuarios e mudar acessos passam a ser uma permissao so,
-- "permissoes" (Pessoas na tela): quem tinha "usuarios" ganha ela, e
-- "usuarios" deixa de existir.
insert into permissao_usuario (usuario_id, permissao_id)
select pu.usuario_id, (select id from permissao where codigo = 'permissoes')
  from permissao_usuario pu
 inner join permissao p on p.id = pu.permissao_id
 where p.codigo = 'usuarios'
    on conflict (usuario_id, permissao_id) do nothing;

delete from permissao_usuario where permissao_id in (select id from permissao where codigo = 'usuarios');
delete from permissao where codigo = 'usuarios';

update permissao
   set descricao = 'Cadastrar pessoas e bots e conceder e retirar permissões'
 where codigo = 'permissoes';

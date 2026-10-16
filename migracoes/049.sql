-- O perfil vira uma permissao por campo: "perfil" passa a ser so o nome, e o
-- e-mail (com o telefone) e o avatar ganham as suas. Quem podia mudar o perfil
-- continua podendo mudar os tres.
update permissao set codigo = 'nome', descricao = 'Alterar o próprio nome' where codigo = 'perfil';

insert into permissao (codigo, descricao, uso)
values ('email', 'Alterar o próprio e-mail e telefone', true)
     , ('avatar', 'Alterar o próprio avatar', true)
    on conflict (codigo) do nothing;

insert into permissao_usuario (usuario_id, permissao_id)
select pu.usuario_id, p.id
  from permissao_usuario pu
 inner join permissao n on n.id = pu.permissao_id and n.codigo = 'nome'
 cross join permissao p
 where p.codigo in ('email', 'avatar')
    on conflict (usuario_id, permissao_id) do nothing;

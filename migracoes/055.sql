-- Localizacao nas mensagens (conteudo tipo 9: um ponto ou um trajeto, em JSON).
-- Permissao de uso propria; quem ja tem conta fica com ela, os bots nao.
insert into permissao (codigo, descricao, uso)
values ('localizacao', 'Enviar localizações e trajetos', true)
    on conflict (codigo) do nothing;

insert into permissao_usuario (usuario_id, permissao_id)
select u.id, p.id
  from usuario u
 cross join permissao p
 where p.codigo = 'localizacao'
   and not exists (select 1 from bot b where b.usuario_id = u.id)
    on conflict (usuario_id, permissao_id) do nothing;

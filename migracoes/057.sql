-- Telefonia (SIP): so o administrador configura o ramal de cada pessoa, com a
-- permissao "sip". Quem ja cuida das pessoas (permissoes) ganha ela. O ramal
-- pode ter um TURN proprio do PABX (o coturn do Conversa so repassa ate o
-- MediaMTX); sem ele, a midia vai pelo STUN.
insert into permissao (codigo, descricao)
values ('sip', 'Configurar a telefonia (SIP) das pessoas')
    on conflict (codigo) do nothing;

insert into permissao_usuario (usuario_id, permissao_id)
select pu.usuario_id, (select id from permissao where codigo = 'sip')
  from permissao_usuario pu
 inner join permissao p on p.id = pu.permissao_id
 where p.codigo = 'permissoes'
    on conflict (usuario_id, permissao_id) do nothing;

alter table sip add column if not exists turn_server varchar(300);
alter table sip add column if not exists turn_user varchar(200);
alter table sip add column if not exists turn_password text;

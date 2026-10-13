-- Confirmacao de leitura com lista: so quem esta nela confirma. As mensagens
-- que ja pediam ficam com todos os destinatarios de entao.
create table if not exists mensagem_confirmacao_destinatario
     ( mensagem_id int4 not null references mensagem(id)
     , usuario_id int4 not null references usuario(id)
     , constraint mensagem_confirmacao_destinatario_pk primary key (mensagem_id, usuario_id)
     );
insert into mensagem_confirmacao_destinatario (mensagem_id, usuario_id)
select ms.mensagem_id, ms.usuario_id
  from mensagem_status ms
 inner join mensagem m on m.id = ms.mensagem_id
 where m.pede_confirmacao
on conflict do nothing;

-- mensagem_status: sem PK e sem índice; desduplica antes de criar a PK composta. 
delete from mensagem_status a 
 using mensagem_status b 
 where a.ctid < b.ctid 
   and a.conversa_id = b.conversa_id 
   and a.usuario_id  = b.usuario_id 
   and a.mensagem_id = b.mensagem_id; 
alter table mensagem_status 
  add constraint mensagem_status_pk primary key (conversa_id, usuario_id, mensagem_id); 
create index if not exists ix_mensagem_status_mensagem 
  on mensagem_status(mensagem_id); 
create index if not exists ix_mensagem_status_pendente 
  on mensagem_status(conversa_id, usuario_id) 
  where recebida is null or visualizada is null; 
-- conversa_usuario: único composto (cobre autorização) + índice por usuário para listas. 
delete from conversa_usuario a 
 using conversa_usuario b 
 where a.id < b.id 
   and a.conversa_id = b.conversa_id 
   and a.usuario_id  = b.usuario_id; 
create unique index if not exists ux_conversa_usuario_conv_user 
  on conversa_usuario(conversa_id, usuario_id); 
create index if not exists ix_conversa_usuario_usuario 
  on conversa_usuario(usuario_id); 
-- mensagem: filtro por conversa + paginação por id (DESC). 
create index if not exists ix_mensagem_conversa_id_desc 
  on mensagem(conversa_id, id desc); 
-- mensagem_conteudo: carga por mensagem_id. 
create index if not exists ix_mensagem_conteudo_mensagem 
  on mensagem_conteudo(mensagem_id); 
-- usuario: login case-insensitive (usado tanto no Login quanto no Cadastro). 
create unique index if not exists ux_usuario_login_lower 
  on usuario(lower(login)); 
-- chamada_usuario: listagem por usuário + status. 
create index if not exists ix_chamada_usuario_usuario_status 
  on chamada_usuario(usuario_id, status); 
-- mensagem_referencia: DELETE usa OR em destino — índice complementar ao composto existente. 
create index if not exists ix_mensagem_referencia_destino 
  on mensagem_referencia(destino_mensagem_id); 
-- dispositivo: push FCM (parcial). 
create index if not exists ix_dispositivo_usuario_ativo_fcm 
  on dispositivo(usuario_id) 
  where ativo = true and token_fcm is not null; 
-- anexo: substitui o parcial existente por um que sirva ao ORDER BY criado_em. 
drop index if exists ix_anexo_upload_status; 
create index if not exists ix_anexo_upload_pendente 
  on anexo(criado_em) where upload_status = 0; 
-- sip: 1 linha por usuário. 
create unique index if not exists ux_sip_usuario 
  on sip(usuario_id); 
-- usuario_contato: FK sem índice. 
create index if not exists ix_usuario_contato_usuario 
  on usuario_contato(usuario_id); 
-- reacao: índice redundante com o UNIQUE (mensagem_id, usuario_id, emoji). 
drop index if exists ix_reacao_mensagem; 

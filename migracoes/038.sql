-- Grupo com imagem ou emoji no lugar da primeira letra do nome
alter table conversa add column if not exists avatar_anexo_id int4 null references anexo(id);
alter table conversa add column if not exists emoji text null;

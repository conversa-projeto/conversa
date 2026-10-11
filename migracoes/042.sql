-- Postagens em grupo: a mensagem marcada como postagem (com titulo opcional)
-- recebe respostas, que ficam embaixo dela e fora do fluxo da conversa.
alter table mensagem add column if not exists postagem bool not null default false;
alter table mensagem add column if not exists postagem_titulo text null;
alter table mensagem add column if not exists postagem_id int4 null references mensagem(id);
create index if not exists ix_mensagem_postagem on mensagem(postagem_id) where postagem_id is not null;

-- Limpa possível estado parcial de tentativa anterior (idempotente): 
-- se visivel_em tiver sido criado como timestamptz, dá conflito de tipo em coalesce() dentro de índice 
-- (coalesce(timestamptz, timestamp) não é IMMUTABLE, e CREATE INDEX exige IMMUTABLE). 
drop index if exists ix_mensagem_conversa_visivel_desc; 
drop index if exists ix_mensagem_visivel_em_pendente; 
alter table mensagem drop column if exists visivel_em cascade; 
-- Coluna visivel_em como timestamp (SEM time zone) para combinar com inserida e permitir 
-- coalesce(visivel_em, inserida) IMMUTABLE. Servidor converte ISO-8601 para hora local antes de persistir, 
-- mesmo padrão de inserida (default current_timestamp). 
alter table mensagem add column visivel_em timestamp null; 
-- Parcial: só linhas agendadas entram; usado pelo TAgendadorMensagens. 
create index ix_mensagem_visivel_em_pendente 
  on mensagem(visivel_em) where visivel_em is not null; 
-- Complementa (não substitui) o ix_mensagem_conversa_id_desc da migration 20: serve para queries 
-- que ordenam por data efetiva (ex.: preview de Conversas). Paginação por id continua usando o outro. 
create index ix_mensagem_conversa_visivel_desc 
  on mensagem(conversa_id, coalesce(visivel_em, inserida) desc, id desc); 

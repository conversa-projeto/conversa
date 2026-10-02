-- Mensagem excluida continua na conversa, marcada: quem excluiu (o autor) e
-- quando. O conteudo fica guardado e quem participa da conversa ainda ve.
alter table mensagem add column if not exists excluida_em timestamp null;
alter table mensagem add column if not exists excluida_por int4 null references usuario(id);

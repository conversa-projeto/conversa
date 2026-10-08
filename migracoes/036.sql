-- Votacao com prazo: encerra_em e a data final (opcional, quem criou pode
-- mudar enquanto esta aberta); encerrada_em marca o encerramento antes do
-- prazo, por quem criou a votacao ou quem criou o grupo.
alter table enquete add column if not exists encerra_em timestamp null;
alter table enquete add column if not exists encerrada_em timestamp null;
alter table enquete add column if not exists encerrada_por int null references usuario(id);

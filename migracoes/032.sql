-- Chat da chamada: grupo criado na primeira mensagem enviada pelo chat da
-- chamada, com quem esteve nela. Quem entra depois passa a fazer parte.
alter table chamada add column if not exists conversa_chat_id int4 null references conversa(id);

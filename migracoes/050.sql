-- Bot excluido que ja conversou: o usuario fica (as mensagens e reacoes dele
-- continuam no historico, com o nome), mas sai das conversas, dos contatos e
-- das telas e nao responde mais. Bot sem historico e apagado de vez.
alter table bot add column if not exists excluido_em timestamp null;

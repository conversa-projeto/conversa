-- Servidor de embeddings proprio (host e porta diferentes da IA de conversa).
-- Endereco vazio usa o mesmo servidor da IA, com o token dela; preenchido, so
-- o token proprio vai para ele.
insert into parametros (nome, valor)
values ('ia_embeddings_url', '')
     , ('ia_embeddings_token', '')
    on conflict (nome) do nothing;

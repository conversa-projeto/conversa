-- Lista de conversas marca as que sao chat de uma chamada
create index if not exists chamada_conversa_chat_id_idx on chamada (conversa_chat_id) where conversa_chat_id is not null;

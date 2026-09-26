-- Por usuario: posicao entre as conversas fixadas (nula quando nao fixada) e
-- quando arquivou (arquivada nao aparece na lista nem notifica).
alter table conversa_usuario add column if not exists fixada_ordem int4 null;
alter table conversa_usuario add column if not exists arquivada_em timestamp null;

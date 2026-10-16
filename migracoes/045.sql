-- Dados de cada audio (uma linha por arquivo, pelo identificador do anexo): a
-- duracao e a intensidade, gravadas no envio, e a transcricao, quando pedida.
-- Era a anexo_transcricao; as colunas dela ganham o prefixo transcricao_ e o
-- status fica vazio enquanto ninguem pede (1-Processando, 2-Concluida, 3-Erro).
-- Intensidade: picos de 0 a 100 ao longo do audio, para desenhar a onda.
alter table anexo_transcricao rename to anexo_audio;
alter table anexo_audio rename constraint anexo_transcricao_pk to anexo_audio_pk;
alter table anexo_audio rename constraint anexo_transcricao_identificador_uk to anexo_audio_identificador_uk;
alter sequence anexo_transcricao_id_seq rename to anexo_audio_id_seq;
alter table anexo_audio rename column status to transcricao_status;
alter table anexo_audio rename column texto to transcricao;
alter table anexo_audio rename column idioma to transcricao_idioma;
alter table anexo_audio rename column job_id to transcricao_job_id;
alter table anexo_audio rename column erro to transcricao_erro;
alter table anexo_audio alter column transcricao_status drop not null;
alter table anexo_audio alter column transcricao_status drop default;
alter table anexo_audio add column duracao numeric(10, 2) null;
alter table anexo_audio add column intensidade int2[] null;

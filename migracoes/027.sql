-- Transcricao dos audios. Uma por anexo: o mesmo audio encaminhado para outra
-- conversa reaproveita a transcricao. Status: 1-Processando, 2-Concluida, 3-Erro.
create 
 table anexo_transcricao 
     ( id serial4 not null 
     , identificador varchar(64) not null 
     , status int4 not null default 1 
     , texto text null 
     , idioma varchar(10) null 
     , job_id varchar(100) null 
     , erro varchar(500) null 
     , criado_em timestamp default current_timestamp not null 
     , criado_por int4 null 
     , atualizado_em timestamp default current_timestamp not null 
     , constraint anexo_transcricao_pk primary key (id) 
     , constraint anexo_transcricao_identificador_uk unique (identificador) 
     ); 
-- Endereco do transcritor-api (vazio = transcricao desligada) e idioma padrao.
insert 
  into parametros 
     ( nome 
     , valor 
     ) 
values 
     ( 'transcritor_url' 
     , '' 
     ), 
     ( 'transcritor_idioma' 
     , 'pt' 
     ) 
    on conflict (nome) do nothing; 

alter table anexo add column objeto varchar(255); 
alter table anexo alter column tamanho type int8; 
create index anexo_identificador_idx on anexo(identificador); 

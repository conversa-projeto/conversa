alter table anexo add column upload_status int4 default 0 not null; 
update anexo set upload_status = 1; 
create index ix_anexo_upload_status on anexo(upload_status) where upload_status = 0; 

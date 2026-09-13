create 
 table reacao 
     ( id serial primary key 
     , mensagem_id int4 not null references mensagem(id) 
     , usuario_id int4 not null references usuario(id) 
     , emoji varchar(10) not null 
     , criado_em timestamp default current_timestamp 
     , criado_por int default nullif(current_setting('app.usuario_id', true), '')::int references usuario(id) 
     , constraint reacao_unique unique (mensagem_id, usuario_id, emoji) 
     ); 
create trigger trg_alteracao after update on reacao for each row execute function auditoria.fn_alteracao(); 
create trigger trg_exclusao after delete on reacao for each row execute function auditoria.fn_exclusao(); 
create index ix_reacao_mensagem on reacao(mensagem_id); 

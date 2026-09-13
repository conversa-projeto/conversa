create 
 table mensagem_referencia 
     ( id serial primary key 
     , tipo int4 not null /* 1-resposta; 2-encaminhada */ 
     , origem_mensagem_id int4 not null references mensagem(id) 
     , destino_mensagem_id int4 not null references mensagem(id) 
     , criado_em timestamp default current_timestamp 
     , criado_por int default nullif(current_setting('app.usuario_id', true), '')::int references usuario(id) 
     ); 
create trigger trg_alteracao after update on mensagem_referencia for each row execute function auditoria.fn_alteracao(); 
create trigger trg_exclusao after delete on mensagem_referencia for each row execute function auditoria.fn_exclusao(); 
create index ix_mensagem_referencia on mensagem_referencia(origem_mensagem_id, destino_mensagem_id); 
alter table public.mensagem drop constraint mensagem_resposta_mensagem_id_fkey; 
alter table public.mensagem drop column resposta_mensagem_id; 

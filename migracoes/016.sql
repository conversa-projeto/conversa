create 
 table sip 
     ( id serial primary key 
     , usuario_id integer not null references usuario(id) 
     , sip_user varchar(100) not null 
     , auth_user varchar(100) 
     , sip_password text not null 
     , display_name varchar(100) 
     , domain varchar(150) not null 
     , ws_server varchar(255) not null 
     , ativo boolean not null default true 
     , criado_em timestamp default current_timestamp 
     , criado_por int default nullif(current_setting('app.usuario_id', true), '')::int references usuario(id) 
     ); 
create trigger trg_alteracao after update on sip for each row execute function auditoria.fn_alteracao(); 
create trigger trg_exclusao after delete on sip for each row execute function auditoria.fn_exclusao(); 

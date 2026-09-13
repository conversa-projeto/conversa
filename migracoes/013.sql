create schema auditoria; 
create table auditoria.alteracao 
     ( id serial primary key 
     , tabela varchar(50) not null 
     , registro_id int not null 
     , campo varchar(50) not null 
     , valor_antigo text 
     , valor_novo text 
     , usuario_id int 
     , criado_em timestamp default current_timestamp 
     ); 
create index ix_alteracao_01 on auditoria.alteracao(tabela, registro_id); 
create table auditoria.exclusao 
     ( id serial primary key 
     , tabela varchar(50) not null 
     , registro_id int not null 
     , dados jsonb not null 
     , usuario_id int 
     , criado_em timestamp default current_timestamp 
     ); 
create index ix_exclusao_01 on auditoria.exclusao(tabela, registro_id); 
alter table parametros add column id serial primary key; 
alter table parametros add column criado_em timestamp default current_timestamp; 
alter table parametros add column criado_por int default nullif(current_setting('app.usuario_id', true), '')::int references usuario(id); 
alter table usuario add column criado_em timestamp default current_timestamp; 
alter table usuario add column criado_por int default nullif(current_setting('app.usuario_id', true), '')::int references usuario(id); 
alter table conversa add column criado_por int default nullif(current_setting('app.usuario_id', true), '')::int references usuario(id); 
alter table usuario_contato add column criado_em timestamp default current_timestamp; 
alter table usuario_contato add column criado_por int default nullif(current_setting('app.usuario_id', true), '')::int references usuario(id); 
alter table conversa_usuario add column criado_em timestamp default current_timestamp; 
alter table conversa_usuario add column criado_por int default nullif(current_setting('app.usuario_id', true), '')::int references usuario(id); 
alter table mensagem_conteudo add column criado_em timestamp default current_timestamp; 
alter table mensagem_conteudo add column criado_por int default nullif(current_setting('app.usuario_id', true), '')::int references usuario(id); 
alter table anexo add column criado_em timestamp default current_timestamp; 
alter table anexo add column criado_por int default nullif(current_setting('app.usuario_id', true), '')::int references usuario(id); 
alter table dispositivo add column criado_em timestamp default current_timestamp; 
alter table dispositivo add column criado_por int default nullif(current_setting('app.usuario_id', true), '')::int references usuario(id); 
alter table dispositivo_usuario add column criado_em timestamp default current_timestamp; 
alter table dispositivo_usuario add column criado_por int default nullif(current_setting('app.usuario_id', true), '')::int references usuario(id); 
create or replace function auditoria.fn_alteracao() returns trigger as $$ 
declare 
  v_old jsonb; 
  v_new jsonb; 
  v_key text; 
begin 
  v_old := row_to_json(OLD)::jsonb; 
  v_new := row_to_json(NEW)::jsonb; 
  for v_key in select jsonb_object_keys(v_old) 
  loop 
    if v_key not in ('id', 'senha', 'conteudo', 'criado_em', 'criado_por') 
       and v_old->v_key is distinct from v_new->v_key then 
      insert into auditoria.alteracao (tabela, registro_id, campo, valor_antigo, valor_novo, usuario_id) 
      values (TG_TABLE_NAME, OLD.id, v_key, v_old->>v_key, v_new->>v_key, nullif(current_setting('app.usuario_id', true), '')::int); 
    end if; 
  end loop; 
  return NEW; 
end; 
$$ language plpgsql; 
create or replace function auditoria.fn_exclusao() returns trigger as $$ 
begin 
  insert into auditoria.exclusao (tabela, registro_id, dados, usuario_id) 
  values (TG_TABLE_NAME, OLD.id, row_to_json(OLD)::jsonb - 'senha' - 'conteudo', nullif(current_setting('app.usuario_id', true), '')::int); 
  return OLD; 
end; 
$$ language plpgsql; 
create trigger trg_alteracao after update on usuario for each row execute function auditoria.fn_alteracao(); 
create trigger trg_alteracao after update on conversa for each row execute function auditoria.fn_alteracao(); 
create trigger trg_alteracao after update on usuario_contato for each row execute function auditoria.fn_alteracao(); 
create trigger trg_alteracao after update on conversa_usuario for each row execute function auditoria.fn_alteracao(); 
create trigger trg_alteracao after update on mensagem for each row execute function auditoria.fn_alteracao(); 
create trigger trg_alteracao after update on mensagem_conteudo for each row execute function auditoria.fn_alteracao(); 
create trigger trg_alteracao after update on anexo for each row execute function auditoria.fn_alteracao(); 
create trigger trg_alteracao after update on dispositivo for each row execute function auditoria.fn_alteracao(); 
create trigger trg_alteracao after update on dispositivo_usuario for each row execute function auditoria.fn_alteracao(); 
create trigger trg_alteracao after update on chamada for each row execute function auditoria.fn_alteracao(); 
create trigger trg_alteracao after update on chamada_usuario for each row execute function auditoria.fn_alteracao(); 
create trigger trg_alteracao after update on chamada_evento for each row execute function auditoria.fn_alteracao(); 
create trigger trg_alteracao after update on parametros for each row execute function auditoria.fn_alteracao(); 
create trigger trg_exclusao after delete on usuario for each row execute function auditoria.fn_exclusao(); 
create trigger trg_exclusao after delete on conversa for each row execute function auditoria.fn_exclusao(); 
create trigger trg_exclusao after delete on usuario_contato for each row execute function auditoria.fn_exclusao(); 
create trigger trg_exclusao after delete on conversa_usuario for each row execute function auditoria.fn_exclusao(); 
create trigger trg_exclusao after delete on mensagem for each row execute function auditoria.fn_exclusao(); 
create trigger trg_exclusao after delete on mensagem_conteudo for each row execute function auditoria.fn_exclusao(); 
create trigger trg_exclusao after delete on anexo for each row execute function auditoria.fn_exclusao(); 
create trigger trg_exclusao after delete on dispositivo for each row execute function auditoria.fn_exclusao(); 
create trigger trg_exclusao after delete on dispositivo_usuario for each row execute function auditoria.fn_exclusao(); 
create trigger trg_exclusao after delete on chamada for each row execute function auditoria.fn_exclusao(); 
create trigger trg_exclusao after delete on chamada_usuario for each row execute function auditoria.fn_exclusao(); 
create trigger trg_exclusao after delete on chamada_evento for each row execute function auditoria.fn_exclusao(); 
create trigger trg_exclusao after delete on parametros for each row execute function auditoria.fn_exclusao(); 

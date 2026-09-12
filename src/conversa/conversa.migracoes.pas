// Eduardo - 26/04/2023
unit conversa.migracoes;

interface

uses
  System.SysUtils,
  FireDAC.Comp.Client,
  Postgres,
  conversa.comum;

procedure Migracoes;

implementation

uses
  Data.DB;

const
  Versoes: Array[0..23] of String = (
    sl +'create '+
    sl +' table usuario  '+
    sl +'     ( id serial4 not null '+
    sl +'     , nome varchar(100) not null '+
    sl +'     , login varchar(50) not null '+
    sl +'     , email varchar(100) not null '+
    sl +'     , telefone varchar(50) null '+
    sl +'     , senha varchar(50) not null '+
    sl +'     , constraint usuario_email_unique unique (email) '+
    sl +'     , constraint usuario_pk primary key (id) '+
    sl +'     ); '+
    sl +'create '+
    sl +' table conversa  '+
    sl +'     ( id serial4 not null '+
    sl +'     , descricao varchar(100) null '+
    sl +'     , tipo int4 default 1 not null -- 1-chat; 2-grupo '+
    sl +'     , inserida timestamp default current_timestamp not null '+
    sl +'     , constraint conversa_pk primary key (id) '+
    sl +'     ); '+
    sl +'comment on column conversa.tipo is ''1-Chat; 2-Grupo''; '+
    sl +'create '+
    sl +' table usuario_contato  '+
    sl +'     ( id serial4 not null '+
    sl +'     , usuario_id int4 null '+
    sl +'     , relacionamento_id int4 null '+
    sl +'     , constraint usuario_contato_pk primary key (id) '+
    sl +'     , constraint usuario_contato_usuario_fk foreign key (usuario_id) references usuario(id) '+
    sl +'     , constraint usuario_contato_usuario_fk_1 foreign key (relacionamento_id) references usuario(id) '+
    sl +'     ); '+
    sl +'create '+
    sl +' table conversa_usuario  '+
    sl +'     ( id serial4 not null '+
    sl +'     , usuario_id int4 not null '+
    sl +'     , conversa_id int4 not null '+
    sl +'     , constraint conversa_usuario_pk primary key (id) '+
    sl +'     , constraint conversa_usuario_conversa_fk foreign key (conversa_id) references conversa(id) '+
    sl +'     , constraint conversa_usuario_usuario_fk foreign key (usuario_id) references usuario(id) '+
    sl +'     ); '+
    sl +'create '+
    sl +' table mensagem  '+
    sl +'     ( id serial4 not null '+
    sl +'     , usuario_id int4 not null '+
    sl +'     , conversa_id int4 not null '+
    sl +'     , inserida timestamp default current_timestamp not null '+
    sl +'     , alterada timestamp null '+
    sl +'     , constraint mensagem_pk primary key (id) '+
    sl +'     , constraint mensagem_conversa_fk foreign key (conversa_id) references conversa(id) '+
    sl +'     , constraint mensagem_usuario_fk foreign key (usuario_id) references usuario(id) '+
    sl +'     ); '+
    sl +'create '+
    sl +' table mensagem_conteudo  '+
    sl +'     ( id serial4 not null '+
    sl +'     , mensagem_id int4 not null '+
    sl +'     , ordem int4 not null '+
    sl +'     , tipo int4 not null '+
    sl +'     , conteudo bytea null '+
    sl +'     , constraint mensagem_conteudo_pk primary key (id) '+
    sl +'     , constraint mensagem_conteudo_mensagem_fk foreign key (mensagem_id) references mensagem(id) '+
    sl +'     ); '+
    sl +'create '+
    sl +' table mensagem_status '+
    sl +'     ( conversa_id int4 not null '+
    sl +'     , usuario_id int4 not null '+
    sl +'     , mensagem_id int4 not null '+
    sl +'     , recebida timestamp null '+
    sl +'     , visualizada timestamp null '+
    sl +'     , reproduzida timestamp null '+
    sl +'     , constraint mensagem_status_conversa_fk foreign key (conversa_id) references conversa(id) '+
    sl +'     , constraint mensagem_status_mensagem_fk foreign key (mensagem_id) references mensagem(id) '+
    sl +'     , constraint mensagem_status_usuario_fk foreign key (usuario_id) references usuario(id) '+
    sl +'     ); '+
    sl +'create '+
    sl +' table anexo '+
    sl +'     ( id serial4 not null '+
    sl +'     , identificador varchar(64) not null '+
    sl +'     , tipo int4 not null '+
    sl +'     , tamanho int4 not null '+
    sl +'     , constraint anexo_pk primary key (id) '+
    sl +'     ); ',

    sl +'alter table anexo add nome varchar(255) null; '+
    sl +'alter table anexo add extensao varchar(10) null; ',

    sl +'create '+
    sl +' table dispositivo '+
    sl +'     ( id serial4 not null '+
    sl +'     , nome varchar(50) not null '+
    sl +'     , modelo varchar(50) not null '+
    sl +'     , versao_so varchar(15) not null '+
    sl +'     , plataforma varchar(15) not null '+
    sl +'     , constraint dispositivo_pk primary key (id) '+
    sl +'     ); '+
    sl +'create '+
    sl +' table dispositivo_usuario '+
    sl +'     ( id serial4 not null '+
    sl +'     , dispositivo_id int4 not null '+
    sl +'     , usuario_id int4 not null '+
    sl +'     , online_em timestamp '+
    sl +'     , constraint dispositivo_usuario_pk primary key (id) '+
    sl +'     , constraint dispositivo_usuario_dispositivo_fk foreign key (dispositivo_id) references dispositivo(id) '+
    sl +'     , constraint dispositivo_usuario_usuario_fk foreign key (usuario_id) references usuario(id) '+
    sl +'     ); ',

    sl +'alter table dispositivo_usuario add token_fcm varchar(255); ',

    sl +'alter table dispositivo_usuario drop token_fcm; '+
    sl +'alter table dispositivo add token_fcm varchar(255); ',

    sl +'alter table parametros alter column valor type varchar(5000) using valor::varchar(5000); ',

    sl +'create '+
    sl +' table versao '+
    sl +'     ( id serial4 not null '+
    sl +'     , repositorio varchar(50) null '+
    sl +'     , projeto varchar(50) null '+
    sl +'     , nome varchar(50) null '+
    sl +'     , criada timestamp null '+
    sl +'     , descricao varchar(1000) null '+
    sl +'     , arquivo varchar(50) null '+
    sl +'     , url varchar(500) null '+
    sl +'     ); ',

    sl +'alter table dispositivo add usuario_id int4 not null; '+
    sl +'alter table dispositivo add constraint dispositivo_usuario_fk foreign key(usuario_id) references usuario(id);'+
    sl +'alter table dispositivo add ativo bool default true not null;',

    sl +'create '+
    sl +' table chamada  '+
    sl +'     ( id serial4 not null '+
    sl +'     , tipo int4 default 1 not null /* 1-Simples, 2-Grupo */'+
    sl +'     , status int4 default 1 not null /* 1-Iniciada, 2-Recusada, 3-Em Andamento, 4-Encerrada, 5-Perdida */'+
    sl +'     , iniciada timestamp null '+
    sl +'     , finalizada timestamp null '+
    sl +'     , conversa_id int4 null '+
    sl +'     , criado_em timestamp default current_timestamp not null '+
    sl +'     , criado_por int4 not null '+
    sl +'     , constraint chamada_pk primary key (id) '+
    sl +'     , constraint chamada_conversa_fk foreign key (conversa_id) references conversa(id) '+
    sl +'     , constraint chamada_criado_por_fk foreign key (criado_por) references usuario(id) '+
    sl +'     ); '+
    sl +'comment on column chamada.tipo is ''1-Simples, 2-Grupo''; '+
    sl +'comment on column chamada.status is ''1-Iniciada, 2-Recusada, 3-Em Andamento, 4-Encerrada, 5-Perdida''; '+
    sl +'create '+
    sl +' table chamada_usuario  '+
    sl +'     ( id serial4 not null '+
    sl +'     , chamada_id int4 not null '+
    sl +'     , usuario_id int4 not null '+
    sl +'     , status int4 default 1 not null /* 1-Pendente */ '+
    sl +'     , adicionado_por int4 not null '+
    sl +'     , adicionado_em timestamp default current_timestamp not null '+
    sl +'     , entrou_em timestamp '+
    sl +'     , saiu_em timestamp '+
    sl +'     , recusou_em timestamp '+
    sl +'     , constraint chamada_usuario_pk primary key (id) '+
    sl +'     , constraint chamada_usuario_chamada_fk foreign key (chamada_id) references chamada(id) '+
    sl +'     , constraint chamada_usuario_usuario_fk foreign key (usuario_id) references usuario(id) '+
    sl +'     , constraint chamada_usuario_adicionado_por_fk foreign key (adicionado_por) references usuario(id) '+
    sl +'     ); '+
    sl +'create index ix_chamada_usuario_01 on chamada_usuario(chamada_id, usuario_id) include(status); '+
    sl +'comment on column chamada_usuario.status is ''1-Pendente, 2-Entrou, 3-Saiu, 4-Recusou, 5-Desconectou''; '+
    sl +'create '+
    sl +' table chamada_evento  '+
    sl +'     ( id serial4 not null '+
    sl +'     , chamada_id int4 not null '+
    sl +'     , usuario_id int4 not null '+
    sl +'     , tipo int4 not null '+
    sl +'     , criado_em timestamp default current_timestamp not null '+
    sl +'     , criado_por int4 not null '+
    sl +'     , constraint chamada_evento_pk primary key (id) '+
    sl +'     , constraint chamada_evento_chamada_fk foreign key (chamada_id) references chamada(id) '+
    sl +'     , constraint chamada_evento_usuario_fk foreign key (usuario_id) references usuario(id) '+
    sl +'     , constraint chamada_evento_criado_por_fk foreign key (criado_por) references usuario(id) '+
    sl +'     ); '+
    sl +
    sl +'create index ix_chamada_evento_01 on chamada_evento(chamada_id, usuario_id) include(tipo); ',

    sl +'alter table usuario alter column senha type varchar(60) using senha::varchar(60); ',

    sl +'alter table anexo add column objeto varchar(255); '+
    sl +'alter table anexo alter column tamanho type int8; '+
    sl +'create index anexo_identificador_idx on anexo(identificador); ',

    sl +'insert '+
    sl +'  into parametros '+
    sl +'     ( nome '+
    sl +'     , valor '+
    sl +'     )  '+
    sl +'values '+
    sl +'     ( ''s3_endpoint'' '+
    sl +'     , ''https://localhost:4430/storage'' '+
    sl +'     ), '+
    sl +'     ( ''s3_accesskey'' '+
    sl +'     , ''admin'' '+
    sl +'     ), '+
    sl +'     ( ''s3_secretkey'' '+
    sl +'     , ''admin123'' '+
    sl +'     ), '+
    sl +'     ( ''s3_bucket'' '+
    sl +'     , ''chat'' '+
    sl +'     ); '+
    sl +'drop table versao; ',

    sl +'alter table usuario add column avatar_anexo_id int4 references anexo(id);',

    sl +'create schema auditoria; '+
    sl +'create table auditoria.alteracao '+
    sl +'     ( id serial primary key '+
    sl +'     , tabela varchar(50) not null '+
    sl +'     , registro_id int not null '+
    sl +'     , campo varchar(50) not null '+
    sl +'     , valor_antigo text '+
    sl +'     , valor_novo text '+
    sl +'     , usuario_id int '+
    sl +'     , criado_em timestamp default current_timestamp '+
    sl +'     ); '+
    sl +'create index ix_alteracao_01 on auditoria.alteracao(tabela, registro_id); '+
    sl +'create table auditoria.exclusao '+
    sl +'     ( id serial primary key '+
    sl +'     , tabela varchar(50) not null '+
    sl +'     , registro_id int not null '+
    sl +'     , dados jsonb not null '+
    sl +'     , usuario_id int '+
    sl +'     , criado_em timestamp default current_timestamp '+
    sl +'     ); '+
    sl +'create index ix_exclusao_01 on auditoria.exclusao(tabela, registro_id); '+
    sl +'alter table parametros add column id serial primary key; '+
    sl +'alter table parametros add column criado_em timestamp default current_timestamp; '+
    sl +'alter table parametros add column criado_por int default nullif(current_setting(''app.usuario_id'', true), '''')::int references usuario(id); '+
    sl +'alter table usuario add column criado_em timestamp default current_timestamp; '+
    sl +'alter table usuario add column criado_por int default nullif(current_setting(''app.usuario_id'', true), '''')::int references usuario(id); '+
    sl +'alter table conversa add column criado_por int default nullif(current_setting(''app.usuario_id'', true), '''')::int references usuario(id); '+
    sl +'alter table usuario_contato add column criado_em timestamp default current_timestamp; '+
    sl +'alter table usuario_contato add column criado_por int default nullif(current_setting(''app.usuario_id'', true), '''')::int references usuario(id); '+
    sl +'alter table conversa_usuario add column criado_em timestamp default current_timestamp; '+
    sl +'alter table conversa_usuario add column criado_por int default nullif(current_setting(''app.usuario_id'', true), '''')::int references usuario(id); '+
    sl +'alter table mensagem_conteudo add column criado_em timestamp default current_timestamp; '+
    sl +'alter table mensagem_conteudo add column criado_por int default nullif(current_setting(''app.usuario_id'', true), '''')::int references usuario(id); '+
    sl +'alter table anexo add column criado_em timestamp default current_timestamp; '+
    sl +'alter table anexo add column criado_por int default nullif(current_setting(''app.usuario_id'', true), '''')::int references usuario(id); '+
    sl +'alter table dispositivo add column criado_em timestamp default current_timestamp; '+
    sl +'alter table dispositivo add column criado_por int default nullif(current_setting(''app.usuario_id'', true), '''')::int references usuario(id); '+
    sl +'alter table dispositivo_usuario add column criado_em timestamp default current_timestamp; '+
    sl +'alter table dispositivo_usuario add column criado_por int default nullif(current_setting(''app.usuario_id'', true), '''')::int references usuario(id); '+
    sl +'create or replace function auditoria.fn_alteracao() returns trigger as $$ '+
    sl +'declare '+
    sl +'  v_old jsonb; '+
    sl +'  v_new jsonb; '+
    sl +'  v_key text; '+
    sl +'begin '+
    sl +'  v_old := row_to_json(OLD)::jsonb; '+
    sl +'  v_new := row_to_json(NEW)::jsonb; '+
    sl +'  for v_key in select jsonb_object_keys(v_old) '+
    sl +'  loop '+
    sl +'    if v_key not in (''id'', ''senha'', ''conteudo'', ''criado_em'', ''criado_por'') '+
    sl +'       and v_old->v_key is distinct from v_new->v_key then '+
    sl +'      insert into auditoria.alteracao (tabela, registro_id, campo, valor_antigo, valor_novo, usuario_id) '+
    sl +'      values (TG_TABLE_NAME, OLD.id, v_key, v_old->>v_key, v_new->>v_key, nullif(current_setting(''app.usuario_id'', true), '''')::int); '+
    sl +'    end if; '+
    sl +'  end loop; '+
    sl +'  return NEW; '+
    sl +'end; '+
    sl +'$$ language plpgsql; '+
    sl +'create or replace function auditoria.fn_exclusao() returns trigger as $$ '+
    sl +'begin '+
    sl +'  insert into auditoria.exclusao (tabela, registro_id, dados, usuario_id) '+
    sl +'  values (TG_TABLE_NAME, OLD.id, row_to_json(OLD)::jsonb - ''senha'' - ''conteudo'', nullif(current_setting(''app.usuario_id'', true), '''')::int); '+
    sl +'  return OLD; '+
    sl +'end; '+
    sl +'$$ language plpgsql; '+
    sl +'create trigger trg_alteracao after update on usuario for each row execute function auditoria.fn_alteracao(); '+
    sl +'create trigger trg_alteracao after update on conversa for each row execute function auditoria.fn_alteracao(); '+
    sl +'create trigger trg_alteracao after update on usuario_contato for each row execute function auditoria.fn_alteracao(); '+
    sl +'create trigger trg_alteracao after update on conversa_usuario for each row execute function auditoria.fn_alteracao(); '+
    sl +'create trigger trg_alteracao after update on mensagem for each row execute function auditoria.fn_alteracao(); '+
    sl +'create trigger trg_alteracao after update on mensagem_conteudo for each row execute function auditoria.fn_alteracao(); '+
    sl +'create trigger trg_alteracao after update on anexo for each row execute function auditoria.fn_alteracao(); '+
    sl +'create trigger trg_alteracao after update on dispositivo for each row execute function auditoria.fn_alteracao(); '+
    sl +'create trigger trg_alteracao after update on dispositivo_usuario for each row execute function auditoria.fn_alteracao(); '+
    sl +'create trigger trg_alteracao after update on chamada for each row execute function auditoria.fn_alteracao(); '+
    sl +'create trigger trg_alteracao after update on chamada_usuario for each row execute function auditoria.fn_alteracao(); '+
    sl +'create trigger trg_alteracao after update on chamada_evento for each row execute function auditoria.fn_alteracao(); '+
    sl +'create trigger trg_alteracao after update on parametros for each row execute function auditoria.fn_alteracao(); '+
    sl +'create trigger trg_exclusao after delete on usuario for each row execute function auditoria.fn_exclusao(); '+
    sl +'create trigger trg_exclusao after delete on conversa for each row execute function auditoria.fn_exclusao(); '+
    sl +'create trigger trg_exclusao after delete on usuario_contato for each row execute function auditoria.fn_exclusao(); '+
    sl +'create trigger trg_exclusao after delete on conversa_usuario for each row execute function auditoria.fn_exclusao(); '+
    sl +'create trigger trg_exclusao after delete on mensagem for each row execute function auditoria.fn_exclusao(); '+
    sl +'create trigger trg_exclusao after delete on mensagem_conteudo for each row execute function auditoria.fn_exclusao(); '+
    sl +'create trigger trg_exclusao after delete on anexo for each row execute function auditoria.fn_exclusao(); '+
    sl +'create trigger trg_exclusao after delete on dispositivo for each row execute function auditoria.fn_exclusao(); '+
    sl +'create trigger trg_exclusao after delete on dispositivo_usuario for each row execute function auditoria.fn_exclusao(); '+
    sl +'create trigger trg_exclusao after delete on chamada for each row execute function auditoria.fn_exclusao(); '+
    sl +'create trigger trg_exclusao after delete on chamada_usuario for each row execute function auditoria.fn_exclusao(); '+
    sl +'create trigger trg_exclusao after delete on chamada_evento for each row execute function auditoria.fn_exclusao(); '+
    sl +'create trigger trg_exclusao after delete on parametros for each row execute function auditoria.fn_exclusao(); ',

    sl +'alter table mensagem add column resposta_mensagem_id int4 references mensagem(id); ',

    sl +'insert '+
    sl +'  into parametros '+
    sl +'     ( nome '+
    sl +'     , valor '+
    sl +'     )  '+
    sl +'values '+
    sl +'     ( ''jwt_token'' '+
    sl +'     , ''S3RV1D0R_4P1_C0NV3R54'' '+
    sl +'     ), '+
    sl +'     ( ''fcm_project_id'' '+
    sl +'     , '''' '+
    sl +'     ), '+
    sl +'     ( ''fcm_client_email'' '+
    sl +'     , '''' '+
    sl +'     ), '+
    sl +'     ( ''fcm_private_key'' '+
    sl +'     , '''' '+
    sl +'     ) '+
    sl +'    on conflict (nome) do nothing; ',

    sl +'create '+
    sl +' table sip '+
    sl +'     ( id serial primary key '+
    sl +'     , usuario_id integer not null references usuario(id) '+
    sl +'     , sip_user varchar(100) not null '+
    sl +'     , auth_user varchar(100) '+
    sl +'     , sip_password text not null '+
    sl +'     , display_name varchar(100) '+
    sl +'     , domain varchar(150) not null '+
    sl +'     , ws_server varchar(255) not null '+
    sl +'     , ativo boolean not null default true '+
    sl +'     , criado_em timestamp default current_timestamp '+
    sl +'     , criado_por int default nullif(current_setting(''app.usuario_id'', true), '''')::int references usuario(id) '+
    sl +'     ); '+
    sl +'create trigger trg_alteracao after update on sip for each row execute function auditoria.fn_alteracao(); '+
    sl +'create trigger trg_exclusao after delete on sip for each row execute function auditoria.fn_exclusao(); ',

    sl +'create '+
    sl +' table mensagem_referencia '+
    sl +'     ( id serial primary key '+
    sl +'     , tipo int4 not null /* 1-resposta; 2-encaminhada */ '+
    sl +'     , origem_mensagem_id int4 not null references mensagem(id) '+
    sl +'     , destino_mensagem_id int4 not null references mensagem(id) '+
    sl +'     , criado_em timestamp default current_timestamp '+
    sl +'     , criado_por int default nullif(current_setting(''app.usuario_id'', true), '''')::int references usuario(id) '+
    sl +'     ); '+
    sl +'create trigger trg_alteracao after update on mensagem_referencia for each row execute function auditoria.fn_alteracao(); '+
    sl +'create trigger trg_exclusao after delete on mensagem_referencia for each row execute function auditoria.fn_exclusao(); '+
    sl +'create index ix_mensagem_referencia on mensagem_referencia(origem_mensagem_id, destino_mensagem_id); '+
    sl +'alter table public.mensagem drop constraint mensagem_resposta_mensagem_id_fkey; '+
    sl +'alter table public.mensagem drop column resposta_mensagem_id; ',

    sl +'create '+
    sl +' table reacao '+
    sl +'     ( id serial primary key '+
    sl +'     , mensagem_id int4 not null references mensagem(id) '+
    sl +'     , usuario_id int4 not null references usuario(id) '+
    sl +'     , emoji varchar(10) not null '+
    sl +'     , criado_em timestamp default current_timestamp '+
    sl +'     , criado_por int default nullif(current_setting(''app.usuario_id'', true), '''')::int references usuario(id) '+
    sl +'     , constraint reacao_unique unique (mensagem_id, usuario_id, emoji) '+
    sl +'     ); '+
    sl +'create trigger trg_alteracao after update on reacao for each row execute function auditoria.fn_alteracao(); '+
    sl +'create trigger trg_exclusao after delete on reacao for each row execute function auditoria.fn_exclusao(); '+
    sl +'create index ix_reacao_mensagem on reacao(mensagem_id); '

    // 19 - Upload verification status
   ,sl +'alter table anexo add column upload_status int4 default 0 not null; '+
    sl +'update anexo set upload_status = 1; '+
    sl +'create index ix_anexo_upload_status on anexo(upload_status) where upload_status = 0; '

    // 20 - Índices de performance e integridade (cobertura de FKs e caminhos críticos)
   ,sl +'-- mensagem_status: sem PK e sem índice; desduplica antes de criar a PK composta. '+
    sl +'delete from mensagem_status a '+
    sl +' using mensagem_status b '+
    sl +' where a.ctid < b.ctid '+
    sl +'   and a.conversa_id = b.conversa_id '+
    sl +'   and a.usuario_id  = b.usuario_id '+
    sl +'   and a.mensagem_id = b.mensagem_id; '+
    sl +'alter table mensagem_status '+
    sl +'  add constraint mensagem_status_pk primary key (conversa_id, usuario_id, mensagem_id); '+
    sl +'create index if not exists ix_mensagem_status_mensagem '+
    sl +'  on mensagem_status(mensagem_id); '+
    sl +'create index if not exists ix_mensagem_status_pendente '+
    sl +'  on mensagem_status(conversa_id, usuario_id) '+
    sl +'  where recebida is null or visualizada is null; '+

    sl +'-- conversa_usuario: único composto (cobre autorização) + índice por usuário para listas. '+
    sl +'delete from conversa_usuario a '+
    sl +' using conversa_usuario b '+
    sl +' where a.id < b.id '+
    sl +'   and a.conversa_id = b.conversa_id '+
    sl +'   and a.usuario_id  = b.usuario_id; '+
    sl +'create unique index if not exists ux_conversa_usuario_conv_user '+
    sl +'  on conversa_usuario(conversa_id, usuario_id); '+
    sl +'create index if not exists ix_conversa_usuario_usuario '+
    sl +'  on conversa_usuario(usuario_id); '+

    sl +'-- mensagem: filtro por conversa + paginação por id (DESC). '+
    sl +'create index if not exists ix_mensagem_conversa_id_desc '+
    sl +'  on mensagem(conversa_id, id desc); '+

    sl +'-- mensagem_conteudo: carga por mensagem_id. '+
    sl +'create index if not exists ix_mensagem_conteudo_mensagem '+
    sl +'  on mensagem_conteudo(mensagem_id); '+

    sl +'-- usuario: login case-insensitive (usado tanto no Login quanto no Cadastro). '+
    sl +'create unique index if not exists ux_usuario_login_lower '+
    sl +'  on usuario(lower(login)); '+

    sl +'-- chamada_usuario: listagem por usuário + status. '+
    sl +'create index if not exists ix_chamada_usuario_usuario_status '+
    sl +'  on chamada_usuario(usuario_id, status); '+

    sl +'-- mensagem_referencia: DELETE usa OR em destino — índice complementar ao composto existente. '+
    sl +'create index if not exists ix_mensagem_referencia_destino '+
    sl +'  on mensagem_referencia(destino_mensagem_id); '+

    sl +'-- dispositivo: push FCM (parcial). '+
    sl +'create index if not exists ix_dispositivo_usuario_ativo_fcm '+
    sl +'  on dispositivo(usuario_id) '+
    sl +'  where ativo = true and token_fcm is not null; '+

    sl +'-- anexo: substitui o parcial existente por um que sirva ao ORDER BY criado_em. '+
    sl +'drop index if exists ix_anexo_upload_status; '+
    sl +'create index if not exists ix_anexo_upload_pendente '+
    sl +'  on anexo(criado_em) where upload_status = 0; '+

    sl +'-- sip: 1 linha por usuário. '+
    sl +'create unique index if not exists ux_sip_usuario '+
    sl +'  on sip(usuario_id); '+

    sl +'-- usuario_contato: FK sem índice. '+
    sl +'create index if not exists ix_usuario_contato_usuario '+
    sl +'  on usuario_contato(usuario_id); '+

    sl +'-- reacao: índice redundante com o UNIQUE (mensagem_id, usuario_id, emoji). '+
    sl +'drop index if exists ix_reacao_mensagem; '

    // 21 - Agendamento de mensagens (visivel_em) + índice de ordenação por data efetiva
   ,sl +'-- Limpa possível estado parcial de tentativa anterior (idempotente): '+
    sl +'-- se visivel_em tiver sido criado como timestamptz, dá conflito de tipo em coalesce() dentro de índice '+
    sl +'-- (coalesce(timestamptz, timestamp) não é IMMUTABLE, e CREATE INDEX exige IMMUTABLE). '+
    sl +'drop index if exists ix_mensagem_conversa_visivel_desc; '+
    sl +'drop index if exists ix_mensagem_visivel_em_pendente; '+
    sl +'alter table mensagem drop column if exists visivel_em cascade; '+

    sl +'-- Coluna visivel_em como timestamp (SEM time zone) para combinar com inserida e permitir '+
    sl +'-- coalesce(visivel_em, inserida) IMMUTABLE. Servidor converte ISO-8601 para hora local antes de persistir, '+
    sl +'-- mesmo padrão de inserida (default current_timestamp). '+
    sl +'alter table mensagem add column visivel_em timestamp null; '+

    sl +'-- Parcial: só linhas agendadas entram; usado pelo TAgendadorMensagens. '+
    sl +'create index ix_mensagem_visivel_em_pendente '+
    sl +'  on mensagem(visivel_em) where visivel_em is not null; '+

    sl +'-- Complementa (não substitui) o ix_mensagem_conversa_id_desc da migration 20: serve para queries '+
    sl +'-- que ordenam por data efetiva (ex.: preview de Conversas). Paginação por id continua usando o outro. '+
    sl +'create index ix_mensagem_conversa_visivel_desc '+
    sl +'  on mensagem(conversa_id, coalesce(visivel_em, inserida) desc, id desc); '

    // 22 - visivel_em volta para timestamptz; comparação segura entre TZs diferentes na sessão do Postgres.
    // Ao manter `inserida` como timestamp (sem TZ), coalesce(timestamptz, timestamp) não é IMMUTABLE,
    // então o índice composto ix_mensagem_conversa_visivel_desc é removido — ordem por coalesce faz sort em memória.
   ,sl +'drop index if exists ix_mensagem_conversa_visivel_desc; '+
    sl +'drop index if exists ix_mensagem_visivel_em_pendente; '+

    sl +'-- Converte existentes tratando-os como "hora local da sessão atual" — que é onde Pascal os escreveu '+
    sl +'-- na versão anterior da coluna (timestamp sem TZ). '+
    sl +'alter table mensagem '+
    sl +'  alter column visivel_em type timestamptz '+
    sl +'  using case when visivel_em is null then null '+
    sl +'             else visivel_em at time zone current_setting(''TimeZone'') '+
    sl +'        end; '+

    sl +'create index ix_mensagem_visivel_em_pendente '+
    sl +'  on mensagem(visivel_em) where visivel_em is not null; '

    // 23 - Parametros do servidor TURN (coturn). Usados por GET /api/ice para
    // emitir credenciais temporarias de relay WebRTC.
    // turn_url vazio desliga o TURN: o cliente recebe lista vazia e usa o
    // caminho direto, exatamente como antes desta migration.
   ,sl +'insert '+
    sl +'  into parametros '+
    sl +'     ( nome '+
    sl +'     , valor '+
    sl +'     ) '+
    sl +'values '+
    sl +'     ( ''turn_url'' '+
    sl +'     , '''' '+
    sl +'     ), '+
    sl +'     ( ''turn_secret'' '+
    sl +'     , '''' '+
    sl +'     ), '+
    sl +'     ( ''turn_forcar_relay'' '+
    sl +'     , ''1'' '+
    sl +'     ) '+
    sl +'    on conflict (nome) do nothing; '
  );

procedure Migracoes;
var
  Pool: IConnection;
  Qry: TFDQuery;
  iVersaoAtual: Integer;
  sSQL: String;
  I: Integer;
begin
  Pool := TPool.Instance;

  Pool.Connection.ExecSQL(
    sl +'create '+
    sl +' table if not exists parametros  '+
    sl +'     ( nome varchar(50) not null '+
    sl +'     , valor varchar(500) not null '+
    sl +'     , constraint parametros_nome_key unique (nome) '+
    sl +'     ); '
  );

  Qry := TFDQuery.Create(nil);
  try
    Qry.Connection := Pool.Connection;
    Qry.Open(
      sl +'select cast(valor as int) as versao '+
      sl +'  from parametros '+
      sl +' where nome = ''versao'' '
    );

    if Qry.IsEmpty then
    begin
      iVersaoAtual := -1;
      Pool.Connection.ExecSQL(
        sl +'insert '+
        sl +'  into parametros '+
        sl +'     ( nome '+
        sl +'     , valor '+
        sl +'     ) '+
        sl +'values '+
        sl +'     ( ''versao'' '+
        sl +'     , ''-1'' '+
        sl +'     ); '
      );
    end
    else
      iVersaoAtual := Qry.FieldByName('versao').AsInteger
  finally
    FreeAndNil(Qry)
  end;

  sSQL := EmptyStr;
  for I := Succ(iVersaoAtual) to High(Versoes) do
    sSQL := sSQL + Versoes[I];

  if not sSQL.IsEmpty then
  begin
    sSQL := sSQL +
    sl +'update parametros '+
    sl +'   set valor = '+ High(Versoes).ToString.QuotedString +
    sl +' where nome  = ''versao'' ';

    TPool.Instance.Connection.ExecSQL(sSQL);
  end;
end;

end.

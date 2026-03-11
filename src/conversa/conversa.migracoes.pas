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
  Versoes: Array[0..13] of String = (
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
    sl +'     , ''https://127.0.0.1:9000'' '+
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

    // Auditoria
    sl +'create schema auditoria; '+

    // Tabela de alterações (UPDATE - uma linha por campo alterado)
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

    // Tabela de exclusões (DELETE - JSON do registro completo)
    sl +'create table auditoria.exclusao '+
    sl +'     ( id serial primary key '+
    sl +'     , tabela varchar(50) not null '+
    sl +'     , registro_id int not null '+
    sl +'     , dados jsonb not null '+
    sl +'     , usuario_id int '+
    sl +'     , criado_em timestamp default current_timestamp '+
    sl +'     ); '+
    sl +'create index ix_exclusao_01 on auditoria.exclusao(tabela, registro_id); '+

    // Adicionar id na tabela parametros
    sl +'alter table parametros add column id serial primary key; '+
    sl +'alter table parametros add column criado_em timestamp default current_timestamp; '+
    sl +'alter table parametros add column criado_por int default nullif(current_setting(''app.usuario_id'', true), '''')::int references usuario(id); '+

    // Adicionar criado_em e criado_por nas tabelas que não possuem
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

    // Função de auditoria para UPDATE
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

    // Função de auditoria para DELETE
    sl +'create or replace function auditoria.fn_exclusao() returns trigger as $$ '+
    sl +'begin '+
    sl +'  insert into auditoria.exclusao (tabela, registro_id, dados, usuario_id) '+
    sl +'  values (TG_TABLE_NAME, OLD.id, row_to_json(OLD)::jsonb - ''senha'' - ''conteudo'', nullif(current_setting(''app.usuario_id'', true), '''')::int); '+
    sl +'  return OLD; '+
    sl +'end; '+
    sl +'$$ language plpgsql; '+

    // Triggers de UPDATE
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

    // Triggers de DELETE
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
    sl +'create trigger trg_exclusao after delete on parametros for each row execute function auditoria.fn_exclusao(); '
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

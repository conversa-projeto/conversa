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
  Versoes: Array[0..8] of String = (
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
    sl +
    sl +'create '+
    sl +' table conversa  '+
    sl +'     ( id serial4 not null '+
    sl +'     , descricao varchar(100) null '+
    sl +'     , tipo int4 default 1 not null -- 1-chat; 2-grupo '+
    sl +'     , inserida timestamp default current_timestamp not null '+
    sl +'     , constraint conversa_pk primary key (id) '+
    sl +'     ); '+
    sl +
    sl +'comment on column conversa.tipo is ''1-Chat; 2-Grupo''; '+
    sl +
    sl +'create '+
    sl +' table usuario_contato  '+
    sl +'     ( id serial4 not null '+
    sl +'     , usuario_id int4 null '+
    sl +'     , relacionamento_id int4 null '+
    sl +'     , constraint usuario_contato_pk primary key (id) '+
    sl +'     , constraint usuario_contato_usuario_fk foreign key (usuario_id) references usuario(id) '+
    sl +'     , constraint usuario_contato_usuario_fk_1 foreign key (relacionamento_id) references usuario(id) '+
    sl +'     ); '+
    sl +
    sl +'create '+
    sl +' table conversa_usuario  '+
    sl +'     ( id serial4 not null '+
    sl +'     , usuario_id int4 not null '+
    sl +'     , conversa_id int4 not null '+
    sl +'     , constraint conversa_usuario_pk primary key (id) '+
    sl +'     , constraint conversa_usuario_conversa_fk foreign key (conversa_id) references conversa(id) '+
    sl +'     , constraint conversa_usuario_usuario_fk foreign key (usuario_id) references usuario(id) '+
    sl +'     ); '+
    sl +
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
    sl +
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
    sl +
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
    sl +
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
    sl +
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
    sl +'     , iniciada timestamp default current_timestamp not null '+
    sl +'     , finalizada timestamp null '+
    sl +'     , conversa_id int4 null '+
    sl +'     , constraint chamada_pk primary key (id) '+
    sl +'     , constraint chamada_conversa_fk foreign key (conversa_id) references conversa(id) '+
    sl +'     ); '+
    sl +
    sl +'create '+
    sl +' table chamada_usuario  '+
    sl +'     ( id serial4 not null '+
    sl +'     , chamada_id int4 not null '+
    sl +'     , usuario_id int4 not null '+
    sl +'     , status int4 default 1 not null /* 1-Adicionado */ '+
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
    sl +
    sl +'create index ix_chamada_usuario_01 on chamada_usuario(chamada_id, usuario_id) include(status); '+
    sl +
    sl +'comment on column chamada_usuario.status is ''1-Pendente, 2-Entrou, 3-Saiu, 4-Recusou, 5-Desconectou''; '+
    sl +
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
    sl +'create index ix_chamada_evento_01 on chamada_evento(chamada_id, usuario_id) include(tipo) ;'+

    sl
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

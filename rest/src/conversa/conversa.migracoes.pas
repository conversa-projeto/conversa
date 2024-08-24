// Eduardo - 26/04/2023
unit conversa.migracoes;

interface

uses
  System.SysUtils,
  FireDAC.Comp.Client,
  Postgres,
  conversa.comum;

procedure Migracoes(iVersao: Integer);

implementation

uses
  Data.DB;

const v0 =
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
  sl +'comment on column public.conversa.tipo is ''1-Chat; 2-Grupo''; '+
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
  sl +'     , inserida timestamp default current_timestamp not null'+
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
  sl +'     ); '+
  sl +
  sl +'update parametros '+
  sl +'   set valor = ''0'' '+
  sl +' where nome  = ''versao'' ';

procedure Migracoes(iVersao: Integer);
var
  Pool: IConnection;
  Qry: TFDQuery;
  iVersaoAtual: Integer;
  sSQL: String;
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
  if iVersaoAtual < 0 then
    sSQL := sSQL + v0;

  if not sSQL.IsEmpty then
    TPool.Instance.Connection.ExecSQL(sSQL);
end;

end.

// Eduardo - 26/04/2023
unit conversa.migracoes;

interface

uses
  System.SysUtils,
  FireDAC.Comp.Client,
  SQLite,
  conversa.comum;

procedure Migracoes(iVersao: Integer);

implementation

uses
  Data.DB;

const v0 =
  sl +'create '+
  sl +' table if not exists usuario '+
  sl +'     ( id integer primary key autoincrement '+
  sl +'     , nome text not null '+
  sl +'     , user text null '+
  sl +'     , email text not null unique '+
  sl +'     , telefone text null '+
  sl +'     , senha text not null '+
  sl +'     ); '+
  sl +'create '+
  sl +' table if not exists usuario_contato '+
  sl +'     ( id integer primary key autoincrement '+
  sl +'     , usuario_id integer not null '+
  sl +'     , relacionamento_id integer not null '+
  sl +'     , foreign key (usuario_id) references usuario(id) '+
  sl +'     , foreign key (relacionamento_id) references usuario(id) '+
  sl +'     ); '+
  sl +'create '+
  sl +' table if not exists conversa '+
  sl +'     ( id integer primary key autoincrement '+
  sl +'     , descricao text not null '+
  sl +'     ); '+
  sl +'create '+
  sl +' table if not exists conversa_usuario '+
  sl +'     ( id integer primary key autoincrement '+
  sl +'     , usuario_id integer not null '+
  sl +'     , conversa_id integer not null '+
  sl +'     , foreign key (usuario_id) references usuario(id) '+
  sl +'     , foreign key (conversa_id) references conversa(id) '+
  sl +'     ); '+
  sl +'create '+
  sl +' table if not exists mensagem '+
  sl +'     ( id integer primary key autoincrement '+
  sl +'     , usuario_id integer not null '+
  sl +'     , conversa_id integer not null '+
  sl +'     , inserida text not null '+
  sl +'     , alterada text null '+
  sl +'     , conteudo text not null '+
  sl +'     , foreign key (usuario_id) references usuario(id) '+
  sl +'     , foreign key (conversa_id) references conversa(id) '+
  sl +'     ); '+
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
    sl +' table if not exists parametros '+
    sl +'     ( nome text not null unique '+
    sl +'     , valor text not null '+
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

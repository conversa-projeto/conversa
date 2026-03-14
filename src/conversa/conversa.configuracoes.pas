// Eduardo - 11/06/2024
unit conversa.configuracoes;

interface

uses
  System.SysUtils,
  FireDAC.Comp.Client,
  Data.DB,
  Postgres,
  FCMNotification,
  Minio.Presign;

type
  TConfiguracao = record
    PGParams: TPGParams;
    JWTKEY: String;
    FCM: TFCMConfig;
    BcryptPepper: String;
    S3: TMinioConfig;
    class procedure LoadFromEnvironment; static;
    class procedure LoadFromDataBase; static;
  end;

var
  Configuracao: TConfiguracao;

implementation

const
  sl = sLineBreak;

{ TConfiguracao }

class procedure TConfiguracao.LoadFromEnvironment;
begin
  try
    Configuracao                        := Default(TConfiguracao);
    Configuracao.PGParams.DriverID      := GetEnvironmentVariable('CONVERSA_DRIVERID');
    Configuracao.PGParams.Server        := GetEnvironmentVariable('CONVERSA_SERVER');
    Configuracao.PGParams.MetaDefSchema := GetEnvironmentVariable('CONVERSA_METADEFSCHEMA');
    Configuracao.PGParams.Database      := GetEnvironmentVariable('CONVERSA_DATABASE');
    Configuracao.PGParams.UserName      := GetEnvironmentVariable('CONVERSA_USERNAME');
    Configuracao.PGParams.Password      := GetEnvironmentVariable('CONVERSA_PASSWORD');
    Configuracao.BcryptPepper           := GetEnvironmentVariable('CONVERSA_BCRYPT_PEPPER');
  except on E: Exception do
    begin
      E.Message := 'Erro ao carregar as configurações das variáveis de ambiente! ☠️ - '+ E.Message;
      raise;
    end;
  end;
end;

function GerarSQLParametros(const Campos: array of string): string;
var
  i: Integer;
  sl: string;
  sSelectMax: string;
  sSelectCase: string;
  sWhere: string;
begin
  sl := sLineBreak;

  for i := Low(Campos) to High(Campos) do
  begin
    if i > Low(Campos) then
    begin
      sSelectMax  := sSelectMax  + '     , ';
      sSelectCase := sSelectCase + '            , ';
      sWhere      := sWhere + ', ';
    end;

    sSelectMax := sSelectMax +'max('+ Campos[i] +') as '+ Campos[i] + sl;

    sSelectCase := sSelectCase +
      'case nome '+
      sl +'  when '''+ Campos[i] +''' then valor ' +
      sl +'  else null '+
      sl +'end as '+ Campos[i] +
      sl;

    sWhere := sWhere + '''' + Campos[i] + '''';
  end;

  Result := 'select '+ sSelectMax +' from '+
    sl +'( select '+ sSelectCase +
    sl +'     from parametros '+
    sl +'    where nome in ('+ sWhere +')' +
    sl +') as t';
end;

class procedure TConfiguracao.LoadFromDataBase;
var
  Pool: IConnection;
  Qry: TFDQuery;
  I: Integer;
begin
  try
    Pool := TPool.Instance;
    Qry := TFDQuery.Create(nil);
    try
      Qry.Connection := Pool.Connection;
      Qry.Open(
        GerarSQLParametros([
          'jwt_token',
          'fcm_project_id',
          'fcm_client_email',
          'fcm_private_key',
          's3_endpoint',
          's3_accesskey',
          's3_secretkey',
          's3_bucket'
        ])
      );

      for I := 0 to Pred(Qry.FieldCount) do
        if Qry.Fields[I].IsNull then
          raise Exception.Create('"'+ Qry.Fields[I].FieldName +'" não configurado nos parâmetros!');

      Configuracao.JWTKEY          := Qry.FieldByName('jwt_token').AsString;

      Configuracao.FCM             := Default(TFCMConfig);
      Configuracao.FCM.ProjectID   := Qry.FieldByName('fcm_project_id').AsString;
      Configuracao.FCM.ClientEmail := Qry.FieldByName('fcm_client_email').AsString;
      Configuracao.FCM.PrivateKey  := Qry.FieldByName('fcm_private_key').AsString;

      Configuracao.S3.Endpoint  := Qry.FieldByName('s3_endpoint').AsString;
      Configuracao.S3.AccessKey := Qry.FieldByName('s3_accesskey').AsString;
      Configuracao.S3.SecretKey := Qry.FieldByName('s3_secretkey').AsString;
      Configuracao.S3.Bucket    := Qry.FieldByName('s3_bucket').AsString;

      if Configuracao.JWTKEY.Equals('S3RV1D0R_4P1_C0NV3R54') then
        Writeln('⚠  Parâmetro "jwt_token" inseguro! Corrija antes de colocar em produção!');

      if Configuracao.FCM.ProjectID.Trim.IsEmpty or Configuracao.FCM.ClientEmail.Trim.IsEmpty or Configuracao.FCM.PrivateKey.Trim.IsEmpty then
        Writeln('⚠  Parâmetros "fcm_project_id", "fcm_client_email" e "fcm_private_key" vazios! FCM não vão funcionar!');


      if Configuracao.S3.Endpoint.Contains('127.0.0.1') or Configuracao.S3.Endpoint.Contains('localhost') then
        Writeln('⚠  Parâmetro "s3_endpoint" deve apontar para o IP do servidor atual! Corrija para funcionar em outras máquinas!');

      if Configuracao.S3.AccessKey.Contains('admin') or Configuracao.S3.SecretKey.Contains('admin') then
        Writeln('⚠  Parâmetros "s3_accesskey" e "s3_secretkey" inseguros! Corrija antes de colocar em produção!');

      if Configuracao.S3.Bucket.Trim.IsEmpty then
        Writeln('⚠  Parâmetro "s3_bucket" vazio! Anexos não vão funcionar!');

      Writeln;
    finally
      FreeAndNil(Qry);
    end;
  except on E: Exception do
    begin
      E.Message := 'Erro ao carregar as configurações do banco! ☠️ - '+ E.Message;
      raise;
    end;
  end;
end;

end.

// Eduardo - 11/06/2024
unit conversa.configuracoes;

interface

uses
  System.SysUtils,
  FireDAC.Comp.Client,
  Data.DB,
  Postgres,
  FCMNotification;

type
  TConfiguracao = record
    Porta: Word;
    PGParams: TPGParams;
    LocalAnexos: String;
    JWTKEY: String;
    FCM: TFCMConfig;
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
    Configuracao.Porta                  := GetEnvironmentVariable('CONVERSA_PORTA').ToInteger;
    Configuracao.PGParams.DriverID      := GetEnvironmentVariable('CONVERSA_DRIVERID');
    Configuracao.PGParams.Server        := GetEnvironmentVariable('CONVERSA_SERVER');
    Configuracao.PGParams.MetaDefSchema := GetEnvironmentVariable('CONVERSA_METADEFSCHEMA');
    Configuracao.PGParams.Database      := GetEnvironmentVariable('CONVERSA_DATABASE');
    Configuracao.PGParams.UserName      := GetEnvironmentVariable('CONVERSA_USERNAME');
    Configuracao.PGParams.Password      := GetEnvironmentVariable('CONVERSA_PASSWORD');
  except on E: Exception do
    begin
      E.Message := 'Erro ao carregar as configurações das variáveis de ambiente! ☠️ - '+ E.Message;
      raise;
    end;
  end;
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
        sl +'select max(local_anexos) as local_anexos '+
        sl +'     , max(jwt_token) as jwt_token '+
        sl +'     , max(fcm_project_id) as fcm_project_id '+
        sl +'     , max(fcm_client_email) as fcm_client_email '+
        sl +'     , max(fcm_private_key) as fcm_private_key '+
        sl +'  from  '+
        sl +'     ( select case nome '+
        sl +'              when ''local_anexos'' then valor '+
        sl +'              else null '+
        sl +'               end as local_anexos '+
        sl +'            , case nome '+
        sl +'              when ''jwt_token'' then valor '+
        sl +'              else null '+
        sl +'               end as jwt_token '+
        sl +'            , case nome '+
        sl +'              when ''fcm_project_id'' then valor '+
        sl +'              else null '+
        sl +'               end as fcm_project_id '+
        sl +'            , case nome '+
        sl +'              when ''fcm_client_email'' then valor '+
        sl +'              else null '+
        sl +'               end as fcm_client_email '+
        sl +'            , case nome '+
        sl +'              when ''fcm_private_key'' then valor '+
        sl +'              else null '+
        sl +'               end as fcm_private_key '+
        sl +'         from parametros '+
        sl +'        where nome in (''local_anexos'', ''jwt_token'', ''fcm_project_id'', ''fcm_client_email'', ''fcm_private_key'') '+
        sl +'     ) as t '
      );

      for I := 0 to Pred(Qry.FieldCount) do
        if Qry.Fields[I].IsNull then
          raise Exception.Create('"'+ Qry.Fields[I].FieldName +'" não configurado nos parâmetros!');

      Configuracao.LocalAnexos     := Qry.FieldByName('local_anexos').AsString;
      Configuracao.JWTKEY          := Qry.FieldByName('jwt_token').AsString;
      Configuracao.FCM             := Default(TFCMConfig);
      Configuracao.FCM.ProjectID   := Qry.FieldByName('fcm_project_id').AsString;
      Configuracao.FCM.ClientEmail := Qry.FieldByName('fcm_client_email').AsString;
      Configuracao.FCM.PrivateKey  := Qry.FieldByName('fcm_private_key').AsString;
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

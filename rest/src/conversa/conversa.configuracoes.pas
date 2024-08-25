// Eduardo - 11/06/2024
unit conversa.configuracoes;

interface

uses
  System.SysUtils,
  Postgres,
  Conversa.AES;

type
  TConfiguracao = record
    Porta: Word;
    PGParams: TPGParams;
    LocalAnexos: String;
    class procedure LoadFromEnvironment; static;
  end;

var
  Configuracao: TConfiguracao;

implementation

{ TConfiguracao }

class procedure TConfiguracao.LoadFromEnvironment;
var
  sKey: String;
begin
  try
    sKey := GetEnvironmentVariable('CONVERSA_KEY');
    if sKey.Trim.IsEmpty then
      raise Exception.Create('Variável de ambiente 🔑 "CONVERSA_KEY" não definida!');

    Configuracao                        := Default(TConfiguracao);
    Configuracao.Porta                  := GetEnvironmentVariable('CONVERSA_PORTA').ToInteger;
    Configuracao.LocalAnexos            := GetEnvironmentVariable('CONVERSA_LOCALANEXOS');
    Configuracao.PGParams.DriverID      := GetEnvironmentVariable('CONVERSA_DRIVERID');
    Configuracao.PGParams.Server        := GetEnvironmentVariable('CONVERSA_SERVER');
    Configuracao.PGParams.MetaDefSchema := GetEnvironmentVariable('CONVERSA_METADEFSCHEMA');
    Configuracao.PGParams.Database      := GetEnvironmentVariable('CONVERSA_DATABASE');
    Configuracao.PGParams.UserName      := GetEnvironmentVariable('CONVERSA_USERNAME');
    Configuracao.PGParams.Password      := Decrypt(sKey, GetEnvironmentVariable('CONVERSA_PASSWORD'));
  except on E: Exception do
    begin
      E.Message := 'Erro ao carregar as configurações! ☠️ - '+ E.Message;
      raise;
    end;
  end;
end;

end.

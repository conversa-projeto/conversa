// Eduardo - 11/06/2024
unit conversa.configuracoes;

interface

uses
  System.SysUtils,
  Postgres;

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
begin
  try
    Configuracao                        := Default(TConfiguracao);
    Configuracao.Porta                  := GetEnvironmentVariable('CONVERSA_PORTA').ToInteger;
    Configuracao.LocalAnexos            := GetEnvironmentVariable('CONVERSA_LOCALANEXOS');
    Configuracao.PGParams.DriverID      := GetEnvironmentVariable('CONVERSA_DRIVERID');
    Configuracao.PGParams.Server        := GetEnvironmentVariable('CONVERSA_SERVER');
    Configuracao.PGParams.MetaDefSchema := GetEnvironmentVariable('CONVERSA_METADEFSCHEMA');
    Configuracao.PGParams.Database      := GetEnvironmentVariable('CONVERSA_DATABASE');
    Configuracao.PGParams.UserName      := GetEnvironmentVariable('CONVERSA_USERNAME');
    Configuracao.PGParams.Password      := GetEnvironmentVariable('CONVERSA_PASSWORD');
  except on E: Exception do
    begin
      E.Message := 'Erro ao carregar as configurações! ☠️ - '+ E.Message;
      raise;
    end;
  end;
end;

end.

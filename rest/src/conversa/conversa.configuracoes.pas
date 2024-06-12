// Eduardo - 11/06/2024
unit conversa.configuracoes;

interface

uses
  System.Classes,
  System.SysUtils,
  System.IOUtils,
  System.JSON.Serializers,
  Postgres,
  Conversa.AES;

type
  TConfiguracao = record
    Porta: Word;
    PGParams: TPGParams;
    LocalAnexos: String;
    class procedure LoadFromFile(sArquivo: String); static;
  end;

var
  Configuracao: TConfiguracao;

implementation

{ TConfiguracao }

class procedure TConfiguracao.LoadFromFile(sArquivo: String);
var
  ss: TStringStream;
  js: TJsonSerializer;
begin
  if not TFile.Exists(sArquivo) then
    raise Exception.Create('Arquivo de configurações "'+ sArquivo +'" não encontrado! 👎');

  try
    ss := TStringStream.Create;
    try
      ss.LoadFromFile(sArquivo);
      js := TJsonSerializer.Create;
      try
        Configuracao := js.Deserialize<TConfiguracao>(ss.DataString);
        Configuracao.PGParams.Password := Decrypt(Configuracao.PGParams.Password);
      finally
        js.Free;
      end;
    finally
      ss.Free;
    end;
  except on E: Exception do
    begin
      E.Message := 'Erro ao carregar as configurações! ☠️ - '+ E.Message;
      raise;
    end;
  end;
end;

end.

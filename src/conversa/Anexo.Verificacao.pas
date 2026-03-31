// Eduardo - 30/03/2026
unit Anexo.Verificacao;

interface

uses
  System.SysUtils,
  System.Classes,
  System.SyncObjs,
  Minio;

type
  TAnexoVerificacao = class
  private
    FThread: TThread;
    FEvent: TEvent;
    FStop: Int64;
    FConfig: TMinioConfig;
    procedure Execute;
    procedure VerificarPendentes;
  public
    class procedure Start(Config: TMinioConfig);
    class procedure Stop;
  end;

implementation

uses
  Data.DB,
  FireDAC.Comp.Client,
  Postgres,
  conversa.comum;

const
  INTERVALO_SEGUNDOS = 120;
  TIMEOUT_MINUTOS = 15;

var
  FInstance: TAnexoVerificacao;

{ TAnexoVerificacao }

class procedure TAnexoVerificacao.Start(Config: TMinioConfig);
begin
  if Assigned(FInstance) then
    Exit;
  FInstance := TAnexoVerificacao.Create;
  FInstance.FConfig := Config;
  FInstance.FEvent := TEvent.Create(nil, False, False, '');
  FInstance.FStop := 0;
  FInstance.FThread := TThread.CreateAnonymousThread(FInstance.Execute);
  FInstance.FThread.FreeOnTerminate := False;
  FInstance.FThread.Start;
  Writeln('Verificacao de anexos iniciada');
end;

class procedure TAnexoVerificacao.Stop;
begin
  if not Assigned(FInstance) then
    Exit;
  TInterlocked.Add(FInstance.FStop, 1);
  FInstance.FEvent.SetEvent;
  FInstance.FThread.WaitFor;
  FInstance.FThread.Free;
  FInstance.FEvent.Free;
  FreeAndNil(FInstance);
end;

procedure TAnexoVerificacao.Execute;
var
  I: Integer;
begin
  while TInterlocked.Read(FStop) = 0 do
  begin
    try
      VerificarPendentes;
    except on E: Exception do
      Writeln('Erro na verificacao de anexos: ', E.Message);
    end;

    // Aguarda o intervalo em incrementos de 100ms para permitir shutdown rapido
    for I := 1 to INTERVALO_SEGUNDOS * 10 do
    begin
      if TInterlocked.Read(FStop) <> 0 then
        Exit;
      FEvent.WaitFor(100);
    end;
  end;
end;

procedure TAnexoVerificacao.VerificarPendentes;
var
  Pool: IConnection;
  Qry: TFDQuery;
  ID: Integer;
  Objeto: String;
  Existe: Boolean;
  MinutosDesdeUpload: Double;
begin
  Pool := TPool.Instance;
  Qry := TFDQuery.Create(nil);
  try
    Qry.Connection := Pool.Connection;
    Qry.Open(
      sl +'select a.id '+
      sl +'     , a.objeto '+
      sl +'     , extract(epoch from (current_timestamp - a.criado_em)) / 60.0 as minutos '+
      sl +'  from anexo as a '+
      sl +' where a.upload_status = 0 '+
      sl +'   and a.criado_em < current_timestamp - interval ''1 minute'' '+
      sl +' order by a.criado_em '+
      sl +' limit 50 '
    );
    while not Qry.Eof do
    begin
      if TInterlocked.Read(FStop) <> 0 then
        Exit;

      ID := Qry.FieldByName('id').AsInteger;
      Objeto := Qry.FieldByName('objeto').AsString;
      MinutosDesdeUpload := Qry.FieldByName('minutos').AsFloat;

      Existe := TMinioHeadObject.Exists(FConfig, Objeto, 'us-east-1');

      if Existe then
        Pool.Connection.ExecSQL(
          sl +'update anexo '+
          sl +'   set upload_status = 1 '+
          sl +' where id = '+ ID.ToString
        )
      else
      if MinutosDesdeUpload > TIMEOUT_MINUTOS then
        Pool.Connection.ExecSQL(
          sl +'update anexo '+
          sl +'   set upload_status = 2 '+
          sl +' where id = '+ ID.ToString
        );

      Qry.Next;
    end;
  finally
    FreeAndNil(Qry);
  end;
end;

end.

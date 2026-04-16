// Eduardo - 02/03/2024
// Baixe "Version 12.22" (Win x86-64) de https://www.enterprisedb.com/download-postgresql-binaries
// Copie as dll's da pasta: postgresql-12.22-1-windows-x64-binaries.zip\pgsql\bin
// Baixe também o OpenSSL de: https://github.com/IndySockets/OpenSSL-Binaries/blob/master/openssl-1.0.2u-x64_86-win64.zip
// Copie as dll's para a pasta da aplicação
unit Postgres;

interface

uses
  System.SysUtils,
  FireDAC.Phys.PG,
  FireDAC.Phys.PGDef,
  FireDAC.ConsoleUI.Wait,
  FireDAC.Comp.Client,
  FireDAC.Stan.Def,
  FireDAC.Stan.Pool,
  FireDAC.DApt,
  FireDAC.Stan.Async;

type
  IConnection = interface
    ['{E816A391-0309-4471-A4C3-3FF4C5090EEC}']
    function Connection: TFDConnection;
  end;

  TPGParams = record
    DriverID: String;
    Server: String;
    Port: Word;          // opcional; 0 = porta padrão do PostgreSQL (5432)
    Database: String;
    UserName: String;
    Password: String;
    MetaDefSchema: String;
  end;

  TPool = class
  private
    class var FManager: TFDManager;
    class var FDefName: String;
  public
    class procedure Start(APGParams: TPGParams; iMaxConnections: Integer = 50; iMaxIdleTimeout: Integer = 30);
    class procedure Stop;
    class function Instance: IConnection;
    class procedure SetUsuarioID(iID: Integer);
  end;

implementation

threadvar
  _PoolUsuarioID: Integer;

type
  TPooledConnection = class(TInterfacedObject, IConnection)
  private
    FFDCon: TFDConnection;
  public
    constructor Create;
    destructor Destroy; override;
    function Connection: TFDConnection;
  end;

{ TPool }

class procedure TPool.Start(APGParams: TPGParams; iMaxConnections: Integer = 50; iMaxIdleTimeout: Integer = 30);
begin
  if Assigned(FManager) then
    raise Exception.Create('Pool já iniciado!');

  if iMaxIdleTimeout < 5 then
    raise Exception.Create('Tempo mínimo de conexão é 5 segundos!');

  if iMaxConnections < 1 then
    raise Exception.Create('Quantidade mínima de conexões é 1!');

  FDefName := 'PGPool';
  FManager := TFDManager.Create(nil);
  FManager.Active := False;

  with FManager.ConnectionDefs.AddConnectionDef do
  begin
    Name := FDefName;
    with TFDPhysPGConnectionDefParams(Params) do
    begin
      DriverID := APGParams.DriverID;
      Server := APGParams.Server;
      if APGParams.Port > 0 then
        Port := APGParams.Port;
      Database := APGParams.Database;
      UserName := APGParams.UserName;
      Password := APGParams.Password;
      if not APGParams.MetaDefSchema.IsEmpty then
        MetaDefSchema := APGParams.MetaDefSchema;
      Pooled := True;
      PoolMaximumItems   := iMaxConnections;
      PoolCleanupTimeout := iMaxIdleTimeout * 1000;
      PoolExpireTimeout  := iMaxIdleTimeout * 1000;
    end;
    Apply;
  end;

  FManager.Active := True;
end;

class procedure TPool.Stop;
begin
  if not Assigned(FManager) then
    Exit;

  FManager.Active := False;
  FreeAndNil(FManager);
  FDefName := '';
end;

class function TPool.Instance: IConnection;
begin
  if not Assigned(FManager) then
    raise Exception.Create('Pool não iniciado!');

  Result := TPooledConnection.Create;
end;

class procedure TPool.SetUsuarioID(iID: Integer);
begin
  _PoolUsuarioID := iID;
end;

{ TPooledConnection }

constructor TPooledConnection.Create;
begin
  inherited Create;
  FFDCon := TFDConnection.Create(nil);
  try
    FFDCon.ConnectionDefName := TPool.FDefName;
    FFDCon.ResourceOptions.MacroCreate := False;
    FFDCon.ResourceOptions.MacroExpand := False;
    FFDCon.LoginPrompt := False;
    FFDCon.Open;

    // Propaga o id do usuário autenticado para o GUC app.usuario_id do PG.
    // Usado por:
    //   - auditoria.fn_alteracao / fn_exclusao (triggers)
    //   - defaults criado_por em várias tabelas (conversa, sip, usuario, ...)
    // Resetamos para string vazia quando não há usuário, evitando vazamento
    // entre requisições que reutilizam a mesma conexão física do pool.
    if _PoolUsuarioID > 0 then
      FFDCon.ExecSQLScalar('SELECT set_config(''app.usuario_id'', ''' + IntToStr(_PoolUsuarioID) + ''', false)')
    else
      FFDCon.ExecSQLScalar('SELECT set_config(''app.usuario_id'', '''', false)');
  except
    FreeAndNil(FFDCon);
    raise;
  end;
end;

destructor TPooledConnection.Destroy;
begin
  if Assigned(FFDCon) then
  begin
    FFDCon.Close; // Devolve a conexão física ao pool nativo do FireDAC.
    FreeAndNil(FFDCon);
  end;
  inherited;
end;

function TPooledConnection.Connection: TFDConnection;
begin
  Result := FFDCon;
end;

end.

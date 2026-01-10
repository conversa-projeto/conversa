// Eduardo - 14/08/2025
unit tcp;

interface

uses
  System.SysUtils,
  System.Classes,
  System.Threading,
  System.SyncObjs,
  System.Generics.Collections,
  IdContext,
  IdTCPServer,
  IdTCPClient,
  Thread.Queue;

type
  TOnClientReceive = procedure(const Data: TBytes) of object;
  TOnServerReceive = procedure(const iClient: Int64; const Data: TBytes) of object;
  TOnClientDisconnect = procedure(const iClient: Int64) of object;
  TOnError = procedure(const sError: String) of object;

  TTCPServer = class(TIdTCPServer)
  private
    type
      TClientData = class
    strict private
      FID: Int64;
      FLastPing: TDateTime;
    public
      constructor Create(const AID: Int64);
      procedure UpdateLastPing;
      function SecondsSinceLastPing: Integer;
      property ID: Int64 read FID;
    end;
  private
    FOnServerReceive: TOnServerReceive;
    FOnClientDisconnect: TOnClientDisconnect;
    FOnError: TOnError;
    FClientCounter: Int64;
    FTimeoutThread: TThread;
    FTimeoutSeconds: Integer;
    FControle: Int64;
    procedure Execute(AContext: TIdContext);
    procedure Connect(AContext: TIdContext);
    procedure Disconnect(AContext: TIdContext);
    procedure CheckClientTimeouts;
    function GetClients: TArray<Integer>;
  public
    constructor Create(const APort: Word; const ATimeoutSeconds: Integer = 10);
    destructor Destroy; override;
    procedure Send(const iClient: Int64; const Data: TBytes);
    procedure UpdateClientPing(const iClient: Int64);
    property Clients: TArray<Integer> read GetClients;
    property OnServerReceive: TOnServerReceive read FOnServerReceive write FOnServerReceive;
    property OnClientDisconnect: TOnClientDisconnect read FOnClientDisconnect write FOnClientDisconnect;
    property OnError: TOnError read FOnError write FOnError;
  end;

  TTCPClient = class(TIdTCPClient)
  private
    FTask: ITask;
    FControle: Int64;
    FOnClientReceive: TOnClientReceive;
    FOnError: TOnError;
    procedure Execute;
  public
    constructor Create(const AHost: String; const APort: Word);
    destructor Destroy; override;
    procedure Send(const Data: TBytes);
    property OnClientReceive: TOnClientReceive read FOnClientReceive write FOnClientReceive;
    property OnError: TOnError read FOnError write FOnError;
  end;

implementation

uses
  System.NetEncoding,
  System.DateUtils,
  IdIOHandler,
  IdGlobal;

function IntToBytes(const Value: Integer): TBytes;
begin
  SetLength(Result, SizeOf(Value));
  Move(Value, Result[0], SizeOf(Value));
end;

function BytesToInt(const Bytes: TBytes): Integer;
begin
  if Length(Bytes) <> 4 then
    raise Exception.Create('Invalid byte array size. Expected 4 bytes.');
  Move(Bytes[0], Result, SizeOf(Result));
end;

function ReadIOHandler(const io: TIdIOHandler; var Data: TBytes): Boolean;
var
  iSize: Integer;
  aData: TIdBytes;
  HeaderBytes: TBytes;
begin
  Result := True;
  io.CheckForDataOnSource(10);

  if io.InputBuffer.Size < 4 then
    Exit(False);

  SetLength(HeaderBytes, 4);
  HeaderBytes[0] := io.InputBuffer.PeekByte(0);
  HeaderBytes[1] := io.InputBuffer.PeekByte(1);
  HeaderBytes[2] := io.InputBuffer.PeekByte(2);
  HeaderBytes[3] := io.InputBuffer.PeekByte(3);
  iSize := BytesToInt(HeaderBytes);

  if iSize <= 0 then
  begin
    Data := [];
    io.InputBuffer.Clear;
    Exit(True);
  end;

  if io.InputBuffer.Size < (4 + iSize) then
    Exit(False);

  io.InputBuffer.Remove(4);
  SetLength(aData, iSize);
  io.ReadBytes(aData, iSize, False);
  Data := TBytes(aData);
end;

procedure WriteIOHandler(const io: TIdIOHandler; const Data: TBytes);
var
  aData: TBytes;
begin
  aData := IntToBytes(Length(Data)) + TBytes(Data);
  io.Write(TIdBytes(aData));
end;

procedure SafeCallOnError(const OnError: TOnError; const ErrorMsg: String);
begin
  if Assigned(OnError) then
    TThreadQueue.Add(
      procedure
      begin
        try
          OnError(ErrorMsg);
        except
        end;
      end
    );
end;

{ TTCPClient }

constructor TTCPClient.Create(const AHost: String; const APort: Word);
begin
  inherited Create;

  if AHost.IsEmpty then
    raise Exception.Create('Informe o host!');

  if APort <= 0 then
    raise Exception.Create('Informe a porta!');

  Host := AHost;
  Port := APort;
  ConnectTimeout := 1000;
  FControle := 0;
  FTask := TTask.Run(Execute);
end;

destructor TTCPClient.Destroy;
begin
  TInterlocked.Increment(FControle);
  TTask.WaitForAll(FTask);
  inherited;
end;

procedure TTCPClient.Execute;
var
  Data: TBytes;
begin
  while TInterlocked.Read(FControle) = 0 do
  try
    if not Assigned(OnClientReceive) then
    begin
      Sleep(100);
      Continue;
    end;

    if not Self.Connected then
      Self.Connect;

    if ReadIOHandler(Self.IOHandler, Data) then
      TThreadQueue.Add(
        procedure
        begin
          try
            OnClientReceive(Data);
          except on E: Exception do
            SafeCallOnError(OnError, E.Message);
          end;
        end
      );
  except on E: Exception do
    SafeCallOnError(OnError, E.Message);
  end;
end;

procedure TTCPClient.Send(const Data: TBytes);
begin
  WriteIOHandler(IOHandler, Data);
end;

{ TTCPServer }

constructor TTCPServer.Create(const APort: Word; const ATimeoutSeconds: Integer = 10);
begin
  inherited Create;

  if APort <= 0 then
    raise Exception.Create('Informe a porta!');

  FClientCounter := 0;
  FControle := 0;
  FTimeoutSeconds := ATimeoutSeconds;
  DefaultPort := APort;
  OnConnect := Connect;
  OnDisconnect := Disconnect;
  OnExecute := Execute;
  Active := True;

  if FTimeoutSeconds > 0 then
  begin
    FTimeoutThread := TThread.CreateAnonymousThread(CheckClientTimeouts);
    FTimeoutThread.FreeOnTerminate := False;
    FTimeoutThread.Start;
  end;
end;

destructor TTCPServer.Destroy;
begin
  TInterlocked.Increment(FControle);
  Active := False;
  if Assigned(FTimeoutThread) then
  begin
    FTimeoutThread.WaitFor;
    FTimeoutThread.Free;
  end;
  inherited;
end;

procedure TTCPServer.CheckClientTimeouts;
var
  List: TList<TIdContext>;
  ClientData: TClientData;
  ToDisconnect: TList<TIdContext>;
begin
  while TInterlocked.Read(FControle) = 0 do
  begin
    Sleep(1000);
    if TInterlocked.Read(FControle) <> 0 then
      Break;

    ToDisconnect := TList<TIdContext>.Create;
    try
      List := TList<TIdContext>(Contexts.LockList);
      try
        for var Item in List do
        begin
          if not Item.Connection.Connected then
            Continue;

          ClientData := TClientData(Item.Data);
          if not Assigned(ClientData) then
            Continue;

          if ClientData.SecondsSinceLastPing > FTimeoutSeconds then
            ToDisconnect.Add(Item);
        end;
      finally
        Contexts.UnlockList;
      end;

      for var Item in ToDisconnect do
      try
        Item.Connection.Disconnect;
      except
      end;
    finally
      ToDisconnect.Free;
    end;
  end;
end;

procedure TTCPServer.Execute(AContext: TIdContext);
var
  Data: TBytes;
  ClientData: TClientData;
begin
  if not AContext.Connection.Connected then
    Exit;

  ClientData := TClientData(AContext.Data);
  if not Assigned(ClientData) then
    Exit;

  if ReadIOHandler(AContext.Connection.IOHandler, Data) and Assigned(OnServerReceive) then
  try
    TThreadQueue.Add(
      procedure
      begin
        try
          OnServerReceive(TClientData(AContext.Data).ID, Data);
        except on E: Exception do
          SafeCallOnError(OnError, E.Message);
        end;
      end
    );
  except on E: Exception do
    SafeCallOnError(OnError, E.Message);
  end;
end;

procedure TTCPServer.Connect(AContext: TIdContext);
begin
  if not Assigned(AContext.Data) then
    AContext.Data := TClientData.Create(TInterlocked.Increment(FClientCounter));
end;

procedure TTCPServer.Disconnect(AContext: TIdContext);
var
  ClientData: TClientData;
begin
  ClientData := TClientData(AContext.Data);
  if Assigned(ClientData) and Assigned(OnClientDisconnect) then
    TThreadQueue.Add(
      procedure
      begin
        try
          OnClientDisconnect(ClientData.ID);
        except
        end;
      end
    );
end;

procedure TTCPServer.UpdateClientPing(const iClient: Int64);
var
  List: TList<TIdContext>;
  ClientData: TClientData;
begin
  List := TList<TIdContext>(Contexts.LockList);
  try
    for var Item in List do
    begin
      ClientData := TClientData(Item.Data);
      if Assigned(ClientData) and (ClientData.ID = iClient) then
      begin
        ClientData.UpdateLastPing;
        Break;
      end;
    end;
  finally
    Contexts.UnlockList;
  end;
end;

procedure TTCPServer.Send(const iClient: Int64; const Data: TBytes);
var
  List: TList<TIdContext>;
  ClientData: TClientData;
begin
  List := TList<TIdContext>(Contexts.LockList);
  try
    for var Item in List do
    try
      if not Item.Connection.Connected then
        Continue;

      ClientData := TClientData(Item.Data);
      if not Assigned(ClientData) then
        Continue;

      if (iClient <= 0) or (ClientData.ID = iClient) then
        WriteIOHandler(Item.Connection.IOHandler, Data);
    except on E: Exception do
      SafeCallOnError(OnError, E.Message);
    end;
  finally
    Contexts.UnlockList;
  end;
end;

function TTCPServer.GetClients: TArray<Integer>;
var
  List: TList<TIdContext>;
  ClientData: TClientData;
begin
  Result := [];
  List := TList<TIdContext>(Contexts.LockList);
  try
    for var Item in List do
    try
      if not Item.Connection.Connected then
        Continue;

      ClientData := TClientData(Item.Data);
      if not Assigned(ClientData) then
        Continue;

      Result := Result + [ClientData.ID];
    except on E: Exception do
      SafeCallOnError(OnError, E.Message);
    end;
  finally
    Contexts.UnlockList;
  end;
end;

{ TTCPServer.TClientData }

constructor TTCPServer.TClientData.Create(const AID: Int64);
begin
  inherited Create;
  FID := AID;
  FLastPing := Now;
end;

procedure TTCPServer.TClientData.UpdateLastPing;
begin
  FLastPing := Now;
end;

function TTCPServer.TClientData.SecondsSinceLastPing: Integer;
begin
  Result := SecondsBetween(Now, FLastPing);
end;

end.

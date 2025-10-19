// Eduardo - 24/09/2025
unit conversa.chamada;

interface

uses
  System.Classes,
  System.SysUtils,
  System.Generics.Collections,
  System.DateUtils,
  tcp;

type
  TAudio = record
    Criado: TDateTime;
    Chamada: Integer;
    Remetente: Int64;
    Participantes: TArray<Int64>;
    Dados: TBytes;
  end;

  TChamada = class
  private
    Servidor: TTCPServer;
    MapaClientes: TDictionary<Integer, Int64>; // Mapa do cliente do banco para o cliente TCP
    Chamadas: TDictionary<Integer,  TList<Integer>>; // Lista de chamadas com id's do banco da chamada e dos clientes
    procedure OnServerReceive(const ClientID: Int64; const Data: TBytes);
    procedure DisconnectClient(const ClientID: Int64);
    function ObtemIDCliente(ClientID: Int64): Integer;
  public
    constructor Create(const iPort: Integer);
    destructor Destroy; override;
    procedure AdicionarCliente(Chamada, Cliente: Integer);
    procedure RemoverCliente(Chamada, Cliente: Integer);
    procedure RemoverChamada(Chamada: Integer);
    class procedure Start(const iPort: Integer);
    class procedure Stop;
    class function Instance: TChamada;
  end;

implementation

var
  FInstance: TChamada;

{ TChamada }

class procedure TChamada.Start(const iPort: Integer);
begin
  FInstance := TChamada.Create(iPort);
end;

class procedure TChamada.Stop;
begin
  FInstance.Free;
end;

class function TChamada.Instance: TChamada;
begin
  Result := FInstance;
end;

constructor TChamada.Create(const iPort: Integer);
begin
  MapaClientes := TDictionary<Integer, Int64>.Create;
  Chamadas := TDictionary<Integer,  TList<Integer>>.Create;
  Servidor := TTCPServer.Create(iPort);
  Servidor.OnServerReceive := OnServerReceive;
  Servidor.OnClientDisconnect := DisconnectClient;
end;

destructor TChamada.Destroy;
begin
  Servidor.Free;
  MapaClientes.Free;
  for var Lista in Chamadas.Values do
    Lista.Free;
  Chamadas.Free;
  inherited;
end;

procedure TChamada.AdicionarCliente(Chamada, Cliente: Integer);
var
  Clientes: TList<Integer>;
begin
  if Chamadas.TryGetValue(Chamada, Clientes) then
  begin
    if not Clientes.Contains(Cliente) then
    begin
      Clientes.Add(Cliente);
      Chamadas.AddOrSetValue(Chamada, Clientes);
    end;
  end
  else
  begin
    Clientes := TList<Integer>.Create;
    Clientes.Add(Cliente);
    Chamadas.Add(Chamada, Clientes);
  end;
end;

procedure TChamada.RemoverCliente(Chamada, Cliente: Integer);
var
  Clientes: TList<Integer>;
begin
  if Chamadas.TryGetValue(Chamada, Clientes) then
  begin
    if Clientes.Contains(Cliente) then
      Clientes.Remove(Cliente);
    if Clientes.Count = 0 then
    begin
      Clientes.Free;
      Chamadas.Remove(Chamada);
    end;
  end;
end;

procedure TChamada.RemoverChamada(Chamada: Integer);
begin
  if Chamadas.ContainsKey(Chamada) then
    Chamadas.ExtractPair(Chamada).Value.Free;
end;

function TChamada.ObtemIDCliente(ClientID: Int64): Integer;
begin
  Result := -1;
  for var Item in MapaClientes do
    if Item.Value = ClientID then
      Exit(Item.Key);
end;

function BytesToInt(const Bytes: TBytes): Integer;
begin
  if Length(Bytes) <> 4 then
    raise Exception.Create('Invalid byte array size. Expected 4 bytes.');
  Move(Bytes[0], Result, SizeOf(Result));
end;

function IntToBytes(const Value: Integer): TBytes;
begin
  SetLength(Result, SizeOf(Value));
  Move(Value, Result[0], SizeOf(Value));
end;

procedure TChamada.OnServerReceive(const ClientID: Int64; const Data: TBytes);
var
  Clientes: TList<Integer>;
  iIDTCP: Int64;
  iRemetente: Integer;
  iChamada: Integer;
  Cliente: Integer;
  bNaChamada: Boolean;
begin
  case Data[0] of
    0: // Registrar
    begin
      // Recebe o c�digo do cliente
      if Length(Data) = 5 then
        MapaClientes.AddOrSetValue(BytesToInt(Copy(Data, 1, 4)), ClientID);
    end;
    1: // Audio
    begin
      // Recebe o c�digo da chamada
      iChamada := BytesToInt(Copy(Data, 1, 4));
      if not Chamadas.TryGetValue(iChamada, Clientes) then
        Exit;

      // Obtem o ID do cliente remetente
      iRemetente := ObtemIDCliente(ClientID);

      // Valida se o cliente est� na chamada
      bNaChamada := False;
      for Cliente in Clientes do
      begin
        // Se � ele mesmo, n�o envia
        if Cliente = iRemetente then
        begin
          bNaChamada := True;
          Break;
        end;
      end;

      // Um cliente n�o pode enviar audio em uma chamada que n�o est�
      if not bNaChamada then
        Exit;

      // Percorre todos os clientes da chamada enviando os dados
      for Cliente in Clientes do
      begin
        // Se � ele mesmo, n�o envia
        if Cliente = iRemetente then
          Continue;

        // Obtem o ID para enviar
        if MapaClientes.TryGetValue(Cliente, iIDTCP) then
          Servidor.Send(iIDTCP, IntToBytes(ClientID) + Copy(Data, 1));
      end;
    end;
  end;
end;

procedure TChamada.DisconnectClient(const ClientID: Int64);
var
  Chamada: TList<Integer>;
  Cliente: Integer;
begin
  // Percorre todas as chamadas removendo o cliente da lista
  Cliente := ObtemIDCliente(ClientID);
  for Chamada in Chamadas.Values do
    Chamada.Remove(Cliente);

  // Avisar que o cliente desconectou para o websocket
end;

end.


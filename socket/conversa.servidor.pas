unit conversa.servidor;

interface

uses
  System.SysUtils,
  System.Types,
  System.UITypes,
  System.Classes,
  System.Variants,
  IdBaseComponent,
  IdComponent,
  IdUDPBase,
  IdUDPServer,
  IdGlobal,
  IdSocketHandle,
  System.Generics.Collections,
  IdContext,
  IdCustomTCPServer,
  IdTCPServer,
  IdIOHandler,
  System.JSON,
  {$IFDEF LINUX}
  Posix.Unistd,
  {$ENDIF}
  conversa.tipos;

type
  TServidor = class
  private
    FChamadas: TArray<TChamada>;
    UDPServer: TIdUDPServer;
    TCPServer: TIdTCPServer;
    procedure UDPServerRead(AThread: TIdUDPListenerThread; const AData: TIdBytes; ABinding: TIdSocketHandle);
    procedure TCPServerExecute(AContext: TIdContext);
    procedure TCPDisconnect(AContext: TIdContext);
    procedure Registrar(AContext: TIdContext; Bytes: TIdBytes);
    procedure AtribuirUDP(AContext: TIdContext; Bytes: TIdBytes);
    procedure IniciarChamada(AContext: TIdContext; Bytes: TIdBytes);
    procedure CancelarChamada(AContext: TIdContext; Bytes: TIdBytes);
    procedure AtenderChamada(AContext: TIdContext; Bytes: TIdBytes);
    procedure FinalizarChamada(AContext: TIdContext; Bytes: TIdBytes);
    procedure FinalizarTodasChamadas(AContext: TIdContext; Bytes: TIdBytes);
    procedure ChamadasAtivas(AContext: TIdContext; Bytes: TIdBytes);
    procedure EnviarParaCliente(Context: TIdContext; Method: TMethod; Bytes: TIdBytes);
    procedure RecusarChamada(AContext: TIdContext; Bytes: TIdBytes);
    procedure AtribuirIdentificador(AContext: TIdContext; Bytes: TIdBytes);
  public
    constructor Create;
    destructor Destroy; override;
    procedure Start;
    property Chamadas: TArray<TChamada> read FChamadas;
  end;

implementation

const
  PORTA_UPD = 49000;
  PORTA_TCP = 490;

constructor TServidor.Create;
begin
  UDPServer := TIdUDPServer.Create(nil);
  TCPServer := TIdTCPServer.Create(nil);

  UDPServer.OnUDPRead := UDPServerRead;
  UDPServer.ThreadedEvent := True;
  with UDPServer.Bindings.Add do
  begin
    IP := '0.0.0.0';
    Port := PORTA_UPD;
  end;

  TCPServer.DefaultPort := PORTA_TCP;
  TCPServer.OnExecute := TCPServerExecute;
  TCPServer.OnDisconnect := TCPDisconnect;
end;

destructor TServidor.Destroy;
begin
  FreeAndNil(UDPServer);
  FreeAndNil(TCPServer);
  inherited;
end;

procedure TServidor.EnviarParaCliente(Context: TIdContext; Method: TMethod; Bytes: TIdBytes);
begin
  Context.Connection.IOHandler.Write(Byte(Method));
  Context.Connection.IOHandler.Write(Integer(Length(Bytes)));
  Context.Connection.IOHandler.Write(Bytes);
end;

procedure TServidor.Registrar(AContext: TIdContext; Bytes: TIdBytes);
var
  Lista: TIdContextList;
  Context: TIdContext;
  ID: Integer;
  I: Integer;
begin
  if Assigned(AContext.Data) then
    raise Exception.Create('Conex�o j� iniciada!');

  ID := TSerializer<Integer>.DeBytes(Bytes);

  // Desconecta ponta anterior
  Lista := TCPServer.Contexts.LockList;
  try
    for Context in Lista do
    try
      if Context = AContext then
        Continue;

      if not Assigned(Context.Data) then
        Continue;

      if TSessao(Context.Data).Ponta.ID = ID then
        Context.Connection.Disconnect;
    except
    end;
  finally
    TCPServer.Contexts.UnlockList;
  end;

  // Atribui a ponta para sess�o atual
  AContext.Data := TSessao.Create;
  TSessao(AContext.Data).Ponta := Default(TPonta);
  TSessao(AContext.Data).Ponta.ID := ID;

  // Retomar chamada
  for I := 0 to Pred(Length(FChamadas)) do
    if FChamadas[I].Remetente.ID = ID then
      EnviarParaCliente(AContext, TMethod.RetomarChamada, TSerializer<Integer>.ParaBytes(FChamadas[I].Destinatario.ID))
    else
    if FChamadas[I].Destinatario.ID = ID then
      EnviarParaCliente(AContext, TMethod.RetomarChamada, TSerializer<Integer>.ParaBytes(FChamadas[I].Remetente.ID));
end;

procedure TServidor.AtribuirIdentificador(AContext: TIdContext; Bytes: TIdBytes);
begin
  TSessao(AContext.Data).Ponta.Identificador := TSerializer<String>.DeBytes(Bytes);
end;

procedure TServidor.AtribuirUDP(AContext: TIdContext; Bytes: TIdBytes);
var
  I: Integer;
  UDP: TUDP;
  ID: Integer;
begin
  UDP := Bytes;
  ID := TSessao(AContext.Data).Ponta.ID;

  // Atribui UDP
  TSessao(AContext.Data).Ponta.UDP := UDP;

  for I := 0 to Pred(Length(FChamadas)) do
    if FChamadas[I].Remetente.ID = ID then
      FChamadas[I].Remetente.UDP := UDP
    else
    if FChamadas[I].Destinatario.ID = ID then
      FChamadas[I].Destinatario.UDP := UDP;
end;

procedure TServidor.IniciarChamada(AContext: TIdContext; Bytes: TIdBytes);
var
  ID: Integer;
  Lista: TIdContextList;
  Context: TIdContext;
  bFind: Boolean;
begin
  // Obtem o ID do destinat�rio
  ID := TSerializer<Integer>.DeBytes(Bytes);

  // Localiza o destinat�rio
  bFind := False;
  Lista := TCPServer.Contexts.LockList;
  try
    for Context in Lista do
    try
      if Context = AContext then
        Continue;

      if not Assigned(Context.Data) then
        Continue;

      if TSessao(Context.Data).Ponta.ID <> ID then
        Continue;

      // Avisa a ponta que ela est� recebendo uma chamada
      bFind := True;
      EnviarParaCliente(Context, TMethod.ReceberChamada, TSerializer<TPonta>.ParaBytes(TSessao(AContext.Data).Ponta));
    except
    end;

    // Informar ao remetende que o destinat�rio est� offline
    if not bFind then
      raise Exception.Create('Destinat�rio: '+ ID.ToString +' desconectado!');
  finally
    TCPServer.Contexts.UnlockList;
  end;
end;

procedure TServidor.CancelarChamada(AContext: TIdContext; Bytes: TIdBytes);
var
  ID: Integer;
  Lista: TIdContextList;
  Context: TIdContext;
begin
  // Obtem o ID do destinat�rio
  ID := TSerializer<Integer>.DeBytes(Bytes);

  // Localiza o destinat�rio
  Lista := TCPServer.Contexts.LockList;
  try
    for Context in Lista do
    try
      if Context = AContext then
        Continue;

      if not Assigned(Context.Data) then
        Continue;

      if TSessao(Context.Data).Ponta.ID <> ID then
        Continue;

      // Avisa a ponta que a chamada foi cancelada
      EnviarParaCliente(Context, TMethod.CancelarChamada, []);
    except
    end;
  finally
    TCPServer.Contexts.UnlockList;
  end;
end;

procedure TServidor.AtenderChamada(AContext: TIdContext; Bytes: TIdBytes);
var
  Chamada: TChamada;
  Lista: TIdContextList;
  Context: TIdContext;
begin
  // Cria a chamada
  Chamada := Default(TChamada);
  Chamada.Remetente.ID := TSerializer<Integer>.DeBytes(Bytes);
  Chamada.Destinatario := TSessao(AContext.Data).Ponta;

  // Avisa ao remetente que a chamada foi atendida
  Lista := TCPServer.Contexts.LockList;
  try
    for Context in Lista do
    try
      if Context = AContext then
        Continue;

      if not Assigned(Context.Data) then
        Continue;

      if TSessao(Context.Data).Ponta.ID = Chamada.Remetente.ID then
      begin
        EnviarParaCliente(Context, TMethod.AtenderChamada, TSerializer<Integer>.ParaBytes(Chamada.Destinatario.ID));
        Break;
      end;
    except
    end;
  finally
    TCPServer.Contexts.UnlockList;
  end;

  // Adiciona a chamada na lista de chamadas ativas
  FChamadas := FChamadas + [Chamada];
end;

procedure TServidor.RecusarChamada(AContext: TIdContext; Bytes: TIdBytes);
var
  Lista: TIdContextList;
  Context: TIdContext;
  ID: Integer;
begin
  ID := TSerializer<Integer>.DeBytes(Bytes);

  // Avisa a ponta que iniciou a chamada que ela foi recusada
  Lista := TCPServer.Contexts.LockList;
  try
    for Context in Lista do
    try
      if Context = AContext then
        Continue;

      if not Assigned(Context.Data) then
        Continue;

      if (TSessao(Context.Data).Ponta.ID = ID) then
      begin
        EnviarParaCliente(Context, TMethod.RecusarChamada, []);
        Break;
      end;
    except
    end;
  finally
    TCPServer.Contexts.UnlockList;
  end;
end;

procedure TServidor.FinalizarChamada(AContext: TIdContext; Bytes: TIdBytes);
var
  ID: Integer;
  I: Integer;
  Lista: TIdContextList;
  Context: TIdContext;
  Chamada: TChamada;
  EncerrarChamadas: TArray<TChamada>;
  ChamdasAtivas: TArray<TChamada>;
begin
  ID := TSerializer<Integer>.DeBytes(Bytes);

  EncerrarChamadas := [];
  ChamdasAtivas := [];

  // Obtem as chamadas ativas da ponta
  for I := 0 to Pred(Length(FChamadas)) do
    if (FChamadas[I].Remetente.ID = ID) or (FChamadas[I].Destinatario.ID = ID) then
      EncerrarChamadas := EncerrarChamadas + [FChamadas[I]]
    else
      ChamdasAtivas := ChamdasAtivas + [FChamadas[I]];

  if Length(EncerrarChamadas) = 0 then
    Exit;

  // Avisa a todas as pontas que a chamada foi finalizada
  Lista := TCPServer.Contexts.LockList;
  try
    for Context in Lista do
    try
      if not Assigned(Context.Data) then
        Continue;

      // Percorre avisando as pontas que a chamada foi encerrada
      for Chamada in EncerrarChamadas do
        if (TSessao(Context.Data).Ponta.ID = Chamada.Remetente.ID) or (TSessao(Context.Data).Ponta.ID = Chamada.Destinatario.ID) then
          EnviarParaCliente(Context, TMethod.FinalizarChamada, []);
    except
    end;
  finally
    TCPServer.Contexts.UnlockList;
  end;

  // Atualiza lista de chamadas ativas
  FChamadas := ChamdasAtivas;
end;

procedure TServidor.ChamadasAtivas(AContext: TIdContext; Bytes: TIdBytes);
begin
  EnviarParaCliente(AContext, TMethod.ChamadasAtivas, TSerializer<TArray<TChamada>>.ParaBytes(FChamadas));
end;

procedure TServidor.FinalizarTodasChamadas(AContext: TIdContext; Bytes: TIdBytes);
var
  Lista: TIdContextList;
  Context: TIdContext;
  Chamada: TChamada;
begin
  // Avisa a todos remetentes e destinat�rios que a chamada foi encerrada
  Lista := TCPServer.Contexts.LockList;
  try
    for Chamada in FChamadas do
    begin
      for Context in Lista do
      try
        if Context = AContext then
          Continue;

        if not Assigned(Context.Data) then
          Continue;

        if (TSessao(Context.Data).Ponta.ID = Chamada.Remetente.ID) or (TSessao(Context.Data).Ponta.ID = Chamada.Destinatario.ID) then
          EnviarParaCliente(Context, TMethod.FinalizarChamada, []);
      except
      end;
    end;
  finally
    TCPServer.Contexts.UnlockList;
  end;

  // Limpa a lista
  FChamadas := [];
end;

procedure TServidor.TCPServerExecute(AContext: TIdContext);
var
  Metodo: TMethod;
  Tamanho: Integer;
  Bytes: TIdBytes;
begin
  // Verifica se desconectou
  AContext.Connection.IOHandler.CheckForDisconnect;

  // Espera receber os dados
  AContext.Connection.IOHandler.CheckForDataOnSource(10);

  // Verifica se tem dados
  if AContext.Connection.IOHandler.InputBufferIsEmpty then
    Exit;

  // L� os dados recebidos
  Metodo := TMethod(AContext.Connection.IOHandler.ReadByte);
  Tamanho := AContext.Connection.IOHandler.ReadInt32;
  if Tamanho > 0 then
    AContext.Connection.IOHandler.ReadBytes(Bytes, Tamanho)
  else
    Bytes := [];

  // Direciona para o m�todo
  try
    case Metodo of
      TMethod.Registrar: Registrar(AContext, Bytes);
      TMethod.AtribuirIdentificador: AtribuirIdentificador(AContext, Bytes);
      TMethod.AtribuirUDP: AtribuirUDP(AContext, Bytes);
      TMethod.IniciarChamada: IniciarChamada(AContext, Bytes);
      TMethod.CancelarChamada: CancelarChamada(AContext, Bytes);
      TMethod.AtenderChamada: AtenderChamada(AContext, Bytes);
      TMethod.RecusarChamada: RecusarChamada(AContext, Bytes);
      TMethod.FinalizarChamada: FinalizarChamada(AContext, Bytes);
      TMethod.ChamadasAtivas: ChamadasAtivas(AContext, Bytes);
      TMethod.FinalizarTodasChamadas: FinalizarTodasChamadas(AContext, Bytes);
    end;
  except on E: Exception do
    try
      EnviarParaCliente(AContext, TMethod.Erro, TErro.Create(E.Message));
    except
    end;
  end;
end;

procedure TServidor.TCPDisconnect(AContext: TIdContext);
begin
  if not Assigned(AContext.Data) then
    Exit;

  // Desconex�o de uma ponta
end;

procedure TServidor.UDPServerRead(AThread: TIdUDPListenerThread; const AData: TIdBytes; ABinding: TIdSocketHandle);
var
  Chamada: TChamada;
  UDP: TUDP;
begin
  // Se n�o veio nada.. � para retornar os dados da conex�o UDP atual
  if Length(AData) = 0 then
  begin
    UDP := Default(TUDP);
    UDP.IP := ABinding.PeerIP;
    UDP.Porta := ABinding.PeerPort;
    UDPServer.Binding.SendTo(ABinding.PeerIP, ABinding.PeerPort, UDP);
  end
  else // Retransmiss�o de dados
  begin
    for Chamada in FChamadas do
    begin
      // Se recebeu dados do remetende, repassa para o destinat�rio
      if (Chamada.Remetente.UDP.IP = ABinding.PeerIP) and (Chamada.Remetente.UDP.Porta = ABinding.PeerPort) then
      begin
        UDPServer.Binding.SendTo(Chamada.Destinatario.UDP.IP, Chamada.Destinatario.UDP.Porta, AData);
        Break;
      end
      else // Se recebeu dados do destinat�rio, repassa para o remetente
      if (Chamada.Destinatario.UDP.IP = ABinding.PeerIP) and (Chamada.Destinatario.UDP.Porta = ABinding.PeerPort) then
      begin
        UDPServer.Binding.SendTo(Chamada.Remetente.UDP.IP, Chamada.Remetente.UDP.Porta, AData);
        Break;
      end;
    end;
  end;
end;

procedure TServidor.Start;
begin
  UDPServer.Active := True;
  TCPServer.Active := True;
end;

end.


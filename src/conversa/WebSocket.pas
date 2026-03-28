// Eduardo - 31/07/2025
unit WebSocket;

interface

uses
  System.SysUtils,
  System.JSON,
  IdContext,
  Bird.Socket.Connection;

{$SCOPEDENUMS ON}

type
  TBirdSocketConnectionHack = class
  private
    FIdContext: TIdContext; // Mesmo layout de memória
  end;

  TSocketMessageType = (
    Erro,
    Login,
    NovaMensagem,
    AtualizacaoStatusMensagem,
    Digitando,
    GravandoAudio,
    ReacaoMensagem = 7,
    ConversaNova = 40, // Nova conversa
    ChamadaRecebida = 51, // Usuário inicia uma chamada
    ChamadaFinalizada = 52, // Usuário que criou, cancela a chamada antes mesmo de algum usuário entrar ou finaliza a chamada de modo forçado
    UsuarioRecusou = 53,
    UsuarioEntrou = 54,
    UsuarioSaiu = 55,
    VideoAtivado = 56,
    StatusUsuario = 60
  );

  TWebSocket = record
  private
    class procedure Enviar(const sUsuario: String; const oJSON: TJSONObject); static;
  public
    class procedure Iniciar(const iPort: Integer; const sJWTKey: String); static;
    class procedure Parar; static;
    class procedure NovaMensagem(const sUsuario, sTitulo, sMensagem: String); static;
    class procedure AtualizarStatusMensagem(const sUsuario: String; const iGrupo: Integer; const sMensagens: String); static;

    class function UsuarioConectado(const sUsuario: String): Boolean; static;
    class procedure ConversaNotificar(const Conversa, Remetente, Destinatario: Integer; const Msg: TSocketMessageType); static;
    class procedure ReacaoNotificar(const Conversa, Mensagem, Remetente, Destinatario: Integer; const Emoji, Acao: String); static;
    class procedure ChamadaNotificar(const Chamada, Remetente, Destinatario: Integer; const Msg: TSocketMessageType); static;
    class procedure StatusUsuarioNotificar(const UsuarioAlvo, UsuarioMudou: Integer; const Online: Boolean); static;
    class procedure NotificarContatosStatus(const UsuarioId: Integer; const Online: Boolean); static;
  end;

  TWSUser = class
    ID: String;
  end;

implementation

uses
  System.Classes,
  System.Generics.Collections,
  Data.DB,
  FireDAC.Comp.Client,
  Bird.Socket,
  IdSSLOpenSSL,
  JOSE.Context,
  JOSE.Core.JWT,
  JOSE.Consumer,
  Postgres;

var
  FWebSocket: TBirdSocket;
  FJWTKey: String;

function ContarConexoesUsuario(const sUsuario: String): Integer;
var
  Birds: TList<TBirdSocketConnection>;
  Bird: TBirdSocketConnection;
  Data: TObject;
  Context: TIdContext;
begin
  Result := 0;
  if sUsuario.IsEmpty then
    Exit;

  FWebSocket.Contexts.LockList;
  Birds := FWebSocket.Birds.LockList;
  try
    for Bird in Birds do
    begin
      Context := TBirdSocketConnectionHack(Bird).FIdContext;
      if not Assigned(Context) then
        Continue;
      Data := Context.Data;
      if Assigned(Data) and (Data is TWSUser) and (TWSUser(Data).ID = sUsuario) then
        Inc(Result);
    end;
  finally
    FWebSocket.Birds.UnLockList;
    FWebSocket.Contexts.UnlockList;
  end;
end;

procedure Execute(const ABird: TBirdSocketConnection);
var
  sMensagem: String;
  oJSON: TJSONObject;
  oErro: TJSONObject;
  User: TWSUser;
  LJWT: TJOSEContext;
  LBuilder: IJOSEConsumerBuilder;
  Context: TIdContext;
begin
  sMensagem := ABird.WaitMessage;
  if sMensagem.Trim.IsEmpty then
    Exit;

  oJSON := TJSONObject.ParseJSONValue(sMensagem) as TJSONObject;
  try
    if not Assigned(oJSON) or (oJSON.FindValue('tipo') = nil) then
    begin
      oErro := TJSONObject.Create;
      try
        oErro.AddPair('tipo', 9);
        if not Assigned(oJSON) then
          oErro.AddPair('message', 'Erro ao ler os dados do WebSocket: JSON inválido!')
        else
          oErro.AddPair('message', 'Erro ao ler os dados do WebSocket: Par "tipo" não encontrado!');
        ABird.Send(oErro.ToJSON);
      finally
        oErro.Free;
      end;
      Exit;
    end;

    case TSocketMessageType(oJSON.GetValue<Integer>('tipo')) of
      TSocketMessageType.Login:
      begin
        LJWT := TJOSEContext.Create(oJSON.GetValue<String>('token'), TJWTClaims);
        try
          LBuilder := TJOSEConsumerBuilder.NewConsumer;
          LBuilder.SetVerificationKey(FJWTKey);
          LBuilder.SetSkipVerificationKeyValidation;
          LBuilder.SetExpectedAudience(False, []);
          LBuilder.SetRequireExpirationTime;
          LBuilder.SetRequireIssuedAt;
          LBuilder.SetRequireSubject;

          try
            LBuilder.Build.ProcessContext(LJWT);
          except on E: Exception do
            begin
              oErro := TJSONObject.Create;
              try
                oErro.AddPair('tipo', Integer(TSocketMessageType.Erro));
                oErro.AddPair('message', E.Message);
                ABird.Send(oErro.ToJSON);
              finally
                oErro.Free;
              end;
              Exit;
            end;
          end;

          User := TWSUser.Create;
          User.ID := LJWT.GetClaims.Subject;

          FWebSocket.Contexts.LockList;
          try
            // Acessa o campo FIdContext protegido da outra classe mapeando a mesma posição na classe hack
            Context := TBirdSocketConnectionHack(ABird).FIdContext;
            if Assigned(Context) and not Assigned(Context.Data) then
              Context.Data := User;
          finally
            FWebSocket.Contexts.UnlockList;
          end;

          // Notificar contatos que o usuário ficou online (só na primeira conexão)
          if ContarConexoesUsuario(User.ID) <= 1 then
            TWebSocket.NotificarContatosStatus(User.ID.ToInteger, True);
        finally
          LJWT.Free;
        end;
      end;
    end;
  finally
    oJSON.Free;
  end;
end;

procedure Disconnect(const ABird: TBirdSocketConnection);
var
  Context: TIdContext;
  Data: TObject;
  UserId: Integer;
  sUserId: String;
begin
  Context := TBirdSocketConnectionHack(ABird).FIdContext;
  if not Assigned(Context) then
    Exit;

  Data := Context.Data;
  if not Assigned(Data) or not (Data is TWSUser) then
    Exit;

  sUserId := TWSUser(Data).ID;
  UserId := StrToIntDef(sUserId, 0);

  // Só notifica offline se esta é a última conexão do usuário
  // (ContarConexoesUsuario conta incluindo esta que ainda está na lista)
  if (UserId > 0) and (ContarConexoesUsuario(sUserId) <= 1) then
    TWebSocket.NotificarContatosStatus(UserId, False);
end;

class procedure TWebSocket.Iniciar(const iPort: Integer; const sJWTKey: String);
begin
  FJWTKey := sJWTKey;
  FWebSocket := TBirdSocket.Create(iPort);
  FWebSocket.Active := True;
  FWebSocket.AddEventListener(TEventType.EXECUTE, Execute);
  FWebSocket.AddEventListener(TEventType.DISCONNECT, Disconnect);
end;

class procedure TWebSocket.Enviar(const sUsuario: String; const oJSON: TJSONObject);
var
  Birds : TList<TBirdSocketConnection>;
  Bird: TBirdSocketConnection;
  Data: TObject;
  Context: TIdContext;
begin
  if sUsuario.IsEmpty or not Assigned(oJSON) then
    Exit;

  FWebSocket.Contexts.LockList;
  Birds := FWebSocket.Birds.LockList;
  try
    for Bird in Birds do
    begin
      // Acessa o campo FIdContext protegido da outra classe mapeando a mesma posição na classe hack
      Context := TBirdSocketConnectionHack(Bird).FIdContext;
      if not Assigned(Context) then
        Continue;

      Data := Context.Data;

      if not Assigned(Data) or not (Data is TWSUser) or (TWSUser(Data).ID <> sUsuario) then
        Continue;

      Bird.Send(oJSON.ToJSON);
    end;
  finally
    FWebSocket.Birds.UnLockList;
    FWebSocket.Contexts.UnlockList;
  end;
end;

class function TWebSocket.UsuarioConectado(const sUsuario: String): Boolean;
var
  Birds: TList<TBirdSocketConnection>;
  Bird: TBirdSocketConnection;
  Data: TObject;
  Context: TIdContext;
begin
  Result := False;
  if sUsuario.IsEmpty then
    Exit;

  FWebSocket.Contexts.LockList;
  Birds := FWebSocket.Birds.LockList;
  try
    for Bird in Birds do
    begin
      Context := TBirdSocketConnectionHack(Bird).FIdContext;
      if not Assigned(Context) then
        Continue;

      Data := Context.Data;

      if Assigned(Data) and (Data is TWSUser) and (TWSUser(Data).ID = sUsuario) then
        Exit(True);
    end;
  finally
    FWebSocket.Birds.UnLockList;
    FWebSocket.Contexts.UnlockList;
  end;
end;

class procedure TWebSocket.NovaMensagem(const sUsuario, sTitulo, sMensagem: String);
var
  oJSON: TJSONObject;
begin
  oJSON := TJSONObject.Create;
  try
    oJSON.AddPair('tipo', Integer(TSocketMessageType.NovaMensagem));
    oJSON.AddPair('titulo', sTitulo);
    oJSON.AddPair('mensagem', sMensagem);
    TWebSocket.Enviar(sUsuario, oJSON);
  finally
    oJSON.Free;
  end;
end;

class procedure TWebSocket.AtualizarStatusMensagem(const sUsuario: String; const iGrupo: Integer; const sMensagens: String);
var
  oJSON: TJSONObject;
begin
  oJSON := TJSONObject.Create;
  try
    oJSON.AddPair('tipo', Integer(TSocketMessageType.AtualizacaoStatusMensagem));
    oJSON.AddPair('grupo', iGrupo);
    oJSON.AddPair('mensagens', sMensagens);
    TWebSocket.Enviar(sUsuario, oJSON);
  finally
    oJSON.Free;
  end;
end;

class procedure TWebSocket.ConversaNotificar(const Conversa, Remetente, Destinatario: Integer; const Msg: TSocketMessageType);
var
  jo: TJSONObject;
begin
  jo := TJSONObject.Create;
  try
    jo.AddPair('tipo', Integer(Msg));
    jo.AddPair('conversa_id', Conversa);
    jo.AddPair('usuario_id', Remetente);
    TWebSocket.Enviar(Destinatario.ToString, jo);
  finally
    jo.Free;
  end;
end;

class procedure TWebSocket.ReacaoNotificar(const Conversa, Mensagem, Remetente, Destinatario: Integer; const Emoji, Acao: String);
var
  jo: TJSONObject;
begin
  jo := TJSONObject.Create;
  try
    jo.AddPair('tipo', Integer(TSocketMessageType.ReacaoMensagem));
    jo.AddPair('conversa_id', Conversa);
    jo.AddPair('mensagem_id', Mensagem);
    jo.AddPair('usuario_id', Remetente);
    jo.AddPair('emoji', Emoji);
    jo.AddPair('acao', Acao);
    TWebSocket.Enviar(Destinatario.ToString, jo);
  finally
    jo.Free;
  end;
end;

class procedure TWebSocket.ChamadaNotificar(const Chamada, Remetente, Destinatario: Integer; const Msg: TSocketMessageType);
var
  jo: TJSONObject;
begin
  jo := TJSONObject.Create;
  try
    jo.AddPair('tipo', Integer(Msg));
    jo.AddPair('chamada_id', Chamada);
    jo.AddPair('usuario_id', Remetente);
    TWebSocket.Enviar(Destinatario.ToString, jo);
  finally
    jo.Free;
  end;
end;

class procedure TWebSocket.StatusUsuarioNotificar(const UsuarioAlvo, UsuarioMudou: Integer; const Online: Boolean);
var
  jo: TJSONObject;
begin
  jo := TJSONObject.Create;
  try
    jo.AddPair('tipo', Integer(TSocketMessageType.StatusUsuario));
    jo.AddPair('usuario_id', UsuarioMudou);
    jo.AddPair('online', TJSONBool.Create(Online));
    TWebSocket.Enviar(UsuarioAlvo.ToString, jo);
  finally
    jo.Free;
  end;
end;

class procedure TWebSocket.NotificarContatosStatus(const UsuarioId: Integer; const Online: Boolean);
var
  Pool: IConnection;
  Qry: TFDQuery;
begin
  Pool := TPool.Instance;
  Qry := TFDQuery.Create(nil);
  try
    Qry.Connection := Pool.Connection;
    // Busca todos os usuários que compartilham conversas diretas (tipo=1) com o usuário
    Qry.Open(
      'select distinct cu2.usuario_id '+
      '  from conversa_usuario cu1 '+
      ' inner join conversa c on c.id = cu1.conversa_id and c.tipo = 1 '+
      ' inner join conversa_usuario cu2 on cu2.conversa_id = cu1.conversa_id and cu2.usuario_id <> cu1.usuario_id '+
      ' where cu1.usuario_id = '+ UsuarioId.ToString
    );

    if Qry.IsEmpty then
      Exit;

    Qry.FetchAll;
    Qry.First;
    while not Qry.Eof do
    try
      TWebSocket.StatusUsuarioNotificar(Qry.FieldByName('usuario_id').AsInteger, UsuarioId, Online);
    finally
      Qry.Next;
    end;
  finally
    FreeAndNil(Qry);
  end;
end;

class procedure TWebSocket.Parar;
begin
  FWebSocket.Free;
end;

end.

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
    NovaMensagem = 20,
    AtualizacaoStatusMensagem = 21,
    ConversaNova = 40, // Nova conversa
    ChamadaRecebida = 51, // Usuário inicia uma chamada
    ChamadaFinalizada = 52, // Usuário que criou, cancela a chamada antes mesmo de algum usuário entrar ou finaliza a chamada de modo forçado
    UsuarioRecusou = 53,
    UsuarioEntrou = 54,
    UsuarioSaiu = 55
  );

  TWebSocket = record
  private
    class procedure Enviar(const sUsuario: String; const oJSON: TJSONObject); static;
  public
    class procedure Iniciar(const iPort: Integer; const sJWTKey: String); static;
    class procedure Parar; static;
    class procedure NovaMensagem(const oJSON: TJSONObject); static;
    class procedure AtualizarStatusMensagem(const sUsuario: String; const iGrupo: Integer; const sMensagens: String); static;

    class procedure ConversaNotificar(const Conversa, Remetente, Destinatario: Integer; const Msg: TSocketMessageType); static;
    class procedure ChamadaNotificar(const Chamada, Remetente, Destinatario: Integer; const Msg: TSocketMessageType); static;
  end;

  TWSUser = class
    ID: String;
  end;

implementation

uses
  System.Classes,
  System.Generics.Collections,
  Bird.Socket,
  JOSE.Context,
  JOSE.Core.JWT,
  JOSE.Consumer;

var
  FWebSocket: TBirdSocket;
  FJWTKey: String;

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
        finally
          LJWT.Free;
        end;
      end;
    end;
  finally
    oJSON.Free;
  end;
end;

class procedure TWebSocket.Iniciar(const iPort: Integer; const sJWTKey: String);
begin
  FJWTKey := sJWTKey;
  FWebSocket := TBirdSocket.Create(iPort);
  FWebSocket.AddEventListener(TEventType.EXECUTE, Execute);
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

class procedure TWebSocket.NovaMensagem(const oJSON: TJSONObject);
begin
  try
    oJSON.AddPair('tipo', Integer(TSocketMessageType.NovaMensagem));
    TWebSocket.Enviar(oJSON.GetValue<String>('destinatario_id'), oJSON);
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

class procedure TWebSocket.Parar;
begin
  FWebSocket.Free;
end;

end.

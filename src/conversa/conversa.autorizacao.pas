// Eduardo - 16/04/2026
unit conversa.autorizacao;

interface

procedure ValidarAcessoConversa(IDUsuario, IDConversa: Integer);
procedure ValidarRemocaoConversaUsuario(IDUsuario, IDConversaUsuario: Integer);
procedure ValidarAutoriaMensagem(IDUsuario, IDMensagem: Integer);
procedure ValidarContatoUsuario(IDUsuario, IDUsuarioContato: Integer);
procedure ValidarSIPUsuario(IDUsuario, IDSIP: Integer);
procedure ValidarSenhaAtual(IDUsuario: Integer; const SenhaAtual: String);

implementation

uses
  System.SysUtils,
  System.StrUtils,
  System.JSON,
  FireDAC.Comp.Client,
  Data.DB,
  Horse,
  Postgres,
  Bcrypt,
  conversa.comum,
  conversa.configuracoes;

const
  sl = sLineBreak;

procedure RaiseForbidden;
begin
  raise EHorseException.New.Status(THTTPStatus.Forbidden).Error('Acesso negado!');
end;

function ExisteRegistro(const ASQL: String): Boolean;
var
  Pool: IConnection;
  Qry: TFDQuery;
begin
  Pool := TPool.Instance;
  Qry := TFDQuery.Create(nil);
  try
    Qry.Connection := Pool.Connection;
    Qry.Open(ASQL);
    Result := not Qry.IsEmpty;
  finally
    FreeAndNil(Qry);
  end;
end;

procedure ValidarAcessoConversa(IDUsuario, IDConversa: Integer);
begin
  if (IDUsuario <= 0) or (IDConversa <= 0) then
    RaiseForbidden;

  if not ExisteRegistro(
    sl +'select 1 '+
    sl +'  from conversa_usuario '+
    sl +' where conversa_id = '+ IDConversa.ToString +
    sl +'   and usuario_id  = '+ IDUsuario.ToString
  ) then
    RaiseForbidden;
end;

procedure ValidarRemocaoConversaUsuario(IDUsuario, IDConversaUsuario: Integer);
begin
  if (IDUsuario <= 0) or (IDConversaUsuario <= 0) then
    RaiseForbidden;

  // Regra v1: só auto-remoção. Admin de grupo via conversa.criado_por fica como follow-up.
  if not ExisteRegistro(
    sl +'select 1 '+
    sl +'  from conversa_usuario '+
    sl +' where id          = '+ IDConversaUsuario.ToString +
    sl +'   and usuario_id  = '+ IDUsuario.ToString
  ) then
    RaiseForbidden;
end;

procedure ValidarAutoriaMensagem(IDUsuario, IDMensagem: Integer);
begin
  if (IDUsuario <= 0) or (IDMensagem <= 0) then
    RaiseForbidden;

  if not ExisteRegistro(
    sl +'select 1 '+
    sl +'  from mensagem '+
    sl +' where id          = '+ IDMensagem.ToString +
    sl +'   and usuario_id  = '+ IDUsuario.ToString
  ) then
    RaiseForbidden;
end;

procedure ValidarContatoUsuario(IDUsuario, IDUsuarioContato: Integer);
begin
  if (IDUsuario <= 0) or (IDUsuarioContato <= 0) then
    RaiseForbidden;

  if not ExisteRegistro(
    sl +'select 1 '+
    sl +'  from usuario_contato '+
    sl +' where id          = '+ IDUsuarioContato.ToString +
    sl +'   and usuario_id  = '+ IDUsuario.ToString
  ) then
    RaiseForbidden;
end;

procedure ValidarSIPUsuario(IDUsuario, IDSIP: Integer);
begin
  if (IDUsuario <= 0) or (IDSIP <= 0) then
    RaiseForbidden;

  if not ExisteRegistro(
    sl +'select 1 '+
    sl +'  from sip '+
    sl +' where id          = '+ IDSIP.ToString +
    sl +'   and usuario_id  = '+ IDUsuario.ToString
  ) then
    RaiseForbidden;
end;

procedure ValidarSenhaAtual(IDUsuario: Integer; const SenhaAtual: String);
var
  oUsuario: TJSONObject;
  sHashArmazenado: String;
  sSenhaComPepper: String;
  bRehash: Boolean;
  bSenhaValida: Boolean;
begin
  if IDUsuario <= 0 then
    raise EHorseException.New.Status(THTTPStatus.Unauthorized).Error('Senha atual incorreta!');

  oUsuario := OpenKey(
    sl +'select senha '+
    sl +'  from usuario '+
    sl +' where id = '+ IDUsuario.ToString
  );
  try
    if oUsuario.Count = 0 then
      raise EHorseException.New.Status(THTTPStatus.Unauthorized).Error('Senha atual incorreta!');

    sHashArmazenado := oUsuario.GetValue<String>('senha');
    sSenhaComPepper := LeftStr(SenhaAtual + Configuracao.BcryptPepper, 72);

    if sHashArmazenado.Length = 60 then
      // Hash bcrypt padrão
      bSenhaValida := TBCrypt.CheckPassword(sSenhaComPepper, sHashArmazenado, bRehash)
    else
      // Fallback legado: senha armazenada em texto puro (ver Login em conversa.api.pas)
      bSenhaValida := SenhaAtual = sHashArmazenado;

    if not bSenhaValida then
      raise EHorseException.New.Status(THTTPStatus.Unauthorized).Error('Senha atual incorreta!');
  finally
    oUsuario.Free;
  end;
end;

end.

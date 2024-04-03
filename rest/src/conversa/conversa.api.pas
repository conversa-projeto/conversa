// Eduardo - 30/03/2023
unit conversa.api;

interface

uses
  System.SysUtils,
  System.Classes,
  System.JSON,
  System.DateUtils,
  System.StrUtils,
  System.Generics.Collections,
  System.NetEncoding,
  System.Hash,
  System.IOUtils,
  Data.DB,
  FireDAC.Comp.Client,
  Horse,
  Postgres,
  conversa.comum;

type
  TConversa = class
    class function Login(oAutenticacao: TJSONObject): TJSONObject;
    class function UsuarioIncluir(oUsuario: TJSONObject): TJSONObject;
    class function UsuarioAlterar(oUsuario: TJSONObject): TJSONObject;
    class function UsuarioExcluir(Usuario: Integer): TJSONObject;
    class function UsuarioContatoIncluir(Usuario: Integer; oUsuarioContato: TJSONObject): TJSONObject;
    class function UsuarioContatoExcluir(UsuarioContato: Integer): TJSONObject;
    class function UsuarioContatos(Usuario: Integer): TJSONArray; 
    class function ConversaIncluir(oConversa: TJSONObject): TJSONObject;
    class function ConversaAlterar(oConversa: TJSONObject): TJSONObject;
    class function ConversaExcluir(Conversa: Integer): TJSONObject;
    class function Conversas(Usuario: Integer): TJSONArray;
    class function ConversaUsuarioIncluir(oConversaUsuario: TJSONObject): TJSONObject;
    class function ConversaUsuarioExcluir(ConversaUsuario: Integer): TJSONObject;
    class function MensagemIncluir(Usuario: Integer; oMensagem: TJSONObject): TJSONObject;
    class function MensagemAlterar(oMensagem: TJSONObject): TJSONObject;
    class function MensagemExcluir(Mensagem: Integer): TJSONObject;
    class function Mensagens(Conversa: Integer): TJSONArray;
    class function AnexoIncluir(Usuario: Integer; Tipo: Integer; Dados: TStringStream): TJSONObject;
    class function Anexo(Usuario: Integer; Identificador: String): TStringStream;
  end;

implementation

class function TConversa.Login(oAutenticacao: TJSONObject): TJSONObject;
begin
  CamposObrigatorios(oAutenticacao, ['login', 'senha']);

  Result := OpenKey(
    sl +'select id '+
    sl +'     , nome '+
    sl +'     , email '+
    sl +'     , telefone '+
    sl +'  from usuario '+
    sl +' where login = '+ Qt(oAutenticacao.GetValue<String>('login')) +
    sl +'   and senha = '+ Qt(oAutenticacao.GetValue<String>('senha'))
  );

  if Result.Count = 0 then
    FreeAndNil(Result);

  if not Assigned(Result) then
    raise EHorseException.New.Status(THTTPStatus.Unauthorized).Error('Acesso negado!');
end;

class function TConversa.UsuarioIncluir(oUsuario: TJSONObject): TJSONObject;
begin
  CamposObrigatorios(oUsuario, ['nome', 'email', 'senha']);
  Result := InsertJSON('usuario', oUsuario);
end;

class function TConversa.UsuarioAlterar(oUsuario: TJSONObject): TJSONObject;
begin
  Result := UpdateJSON('usuario', oUsuario);
end;

class function TConversa.UsuarioExcluir(Usuario: Integer): TJSONObject;
begin
  Result := Delete('usuario', Usuario);
end;

class function TConversa.UsuarioContatoIncluir(Usuario: Integer; oUsuarioContato: TJSONObject): TJSONObject;
begin
  if (oUsuarioContato.Count <> 1) or not Assigned(oUsuarioContato.FindValue('relacionamento_id')) then
    raise EHorseException.New.Status(THTTPStatus.BadRequest).Error('Só é permitido inserir o contato relacionado!');

  oUsuarioContato.AddPair('usuario_id', TJSONNumber.Create(Usuario));
  Result := InsertJSON('usuario_contato', oUsuarioContato);
end;

class function TConversa.UsuarioContatoExcluir(UsuarioContato: Integer): TJSONObject;
begin
  Result := Delete('usuario_contato', UsuarioContato);
end;

class function TConversa.UsuarioContatos(Usuario: Integer): TJSONArray;
begin
  Result := Open(
    sl +'select u.id '+
    sl +'     , u.nome '+
    sl +'     , u.login '+
    sl +'     , u.email '+
    sl +'     , u.telefone '+
    sl +'     , u.senha '+
    sl +'  from usuario as u '+
    sl +' where u.id <> '+ Usuario.ToString +
    sl +' order '+
    sl +'    by u.id '
  );
end;

class function TConversa.ConversaIncluir(oConversa: TJSONObject): TJSONObject;
begin
  Result := InsertJSON('conversa', oConversa);
end;

class function TConversa.ConversaAlterar(oConversa: TJSONObject): TJSONObject;
begin
  CamposObrigatorios(oConversa, ['descricao']);
  Result := UpdateJSON('conversa', oConversa);
end;

class function TConversa.ConversaExcluir(Conversa: Integer): TJSONObject;
begin
  Result := Delete('conversa', Conversa);
end;

class function TConversa.Conversas(Usuario: Integer): TJSONArray;
begin
  Result := Open(
    sl +'select c.id '+
    sl +'     , case when c.descricao is null then string_agg(substring(trim(u.nome) from ''^([^ ]+)''), '', '') else c.descricao end as descricao '+
    sl +'     , ( select max(inserida) '+
    sl +'           from mensagem as m '+
    sl +'          where m.conversa_id = c.id '+
    sl +'       ) as ultima_mensagem '+
    sl +'  from conversa as c '+
    sl +' inner '+
    sl +'  join conversa_usuario as cu '+
    sl +'    on cu.conversa_id = c.id '+
    sl +' inner '+
    sl +'  join usuario as u '+
    sl +'    on u.id = cu.usuario_id '+
    sl +' where u.id <> '+ Usuario.ToString +
    sl +'   and c.id in ( select cu.conversa_id '+
    sl +'                   from conversa_usuario as cu '+
    sl +'                  where cu.usuario_id = '+ Usuario.ToString +
    sl +'               ) '+
    sl +' group '+
    sl +'    by c.id '+
    sl +'     , c.descricao '+
    sl +' order '+
    sl +'    by ultima_mensagem'
  );
end;

class function TConversa.ConversaUsuarioIncluir(oConversaUsuario: TJSONObject): TJSONObject;
begin
  CamposObrigatorios(oConversaUsuario, ['usuario_id', 'conversa_id']);
  Result := InsertJSON('conversa_usuario', oConversaUsuario);
end;

class function TConversa.ConversaUsuarioExcluir(ConversaUsuario: Integer): TJSONObject;
begin
  Result := Delete('conversa_usuario', ConversaUsuario);
end;

class function TConversa.MensagemIncluir(Usuario: Integer; oMensagem: TJSONObject): TJSONObject;
begin
//  CamposObrigatorios(oMensagem, ['conversa_id', 'conteudo']);
//
//  if Assigned(oMensagem.FindValue('usuario_id')) then
//    raise EHorseException.New.Status(THTTPStatus.BadRequest).Error('Não pode ser definido o usuário ao incluir uma mensagem!');
//  if Assigned(oMensagem.FindValue('inserida')) then
//    raise EHorseException.New.Status(THTTPStatus.BadRequest).Error('Não pode ser definida a data de inclusão da mensagem!');
//
//  oMensagem.AddPair('usuario_id', TJSONNumber.Create(Usuario));
//  oMensagem.AddPair('inserida', DateToISO8601(Now));
//
//  Result := InsertJSON('mensagem', oMensagem);

// Se o tipo de mensagem for texto
end;

class function TConversa.MensagemAlterar(oMensagem: TJSONObject): TJSONObject;
begin
//  if (oMensagem.Count <> 1) or not Assigned(oMensagem.FindValue('conteudo')) then
//    raise EHorseException.New.Status(THTTPStatus.BadRequest).Error('Só é permitido alterar o conteúdo da mensagem!');
//
//  Result := UpdateJSON('mensagem', oMensagem);
end;

class function TConversa.MensagemExcluir(Mensagem: Integer): TJSONObject;
var
  oConteudo: TJSONObject;
begin
  oConteudo := Delete('mensagem_conteudo', Mensagem, 'mensagem_id');
  Result := Delete('mensagem', Mensagem);
  Result.AddPair('conteudo', oConteudo);
end;

class function TConversa.Anexo(Usuario: Integer; Identificador: String): TStringStream;
var
  Pool: IConnection;
  Qry: TFDQuery;
begin
  Pool := TPool.Instance;
  Qry := TFDQuery.Create(nil);
  try
    Qry.Connection := Pool.Connection;
    Qry.Open(
      sl +'select a.id '+
      sl +'     , a.identificador '+
      sl +'     , a.tipo '+
      sl +'     , a.tamanho '+
      sl +'     , a.arquivo '+
      sl +'  from anexo as a '+
      sl +' where a.identificador = '+ Qt(Identificador)
    );

    if Qry.IsEmpty then
      raise Exception.Create('Anexo não encontrado!');

    Result := TStringStream.Create;
    Result.LoadFromFile(Qry.FieldByName('arquivo').AsString);
  finally
    FreeAndNil(Qry);
  end;
end;

class function TConversa.AnexoIncluir(Usuario: Integer; Tipo: Integer; Dados: TStringStream): TJSONObject;
var
  iID: Integer;
  sIdentificador: String;
  sLocal: String;
  Pool: IConnection;
  Qry: TFDQuery;
begin
  sIdentificador := THashSHA2.GetHashString(Dados);

  Pool := TPool.Instance;
  Qry := TFDQuery.Create(nil);
  try
    Qry.Connection := Pool.Connection;
    Qry.Open(
      sl +'select a.id '+
      sl +'  from anexo as a '+
      sl +' where a.identificador = '+ Qt(sIdentificador)
    );

    if not Qry.IsEmpty then
    begin
      Result := OpenKey(
        sl +'select a.id '+
        sl +'     , a.identificador '+
        sl +'     , a.tipo '+
        sl +'     , a.tamanho '+
        sl +'  from anexo as a '+
        sl +' where a.id = '+ Qry.FieldByName('id').AsString
      );
      Exit;
    end;
  finally
    FreeAndNil(Qry);
  end;

  sLocal := ExtractFilePath(ParamStr(0)) +'anexos';

  if not TDirectory.Exists(sLocal) then
    TDirectory.CreateDirectory(sLocal);

  Dados.SaveToFile(sLocal + PathDelim + sIdentificador);

  iID := TPool.Instance.Connection.ExecSQLScalar(
    sl +'insert '+
    sl +'  into anexo '+
    sl +'     ( identificador '+
    sl +'     , tipo '+
    sl +'     , tamanho '+
    sl +'     , arquivo '+
    sl +'     ) '+
    sl +'values '+
    sl +'     ( '+ Qt(sIdentificador) +
    sl +'     , '+ Tipo.ToString +
    sl +'     , '+ Dados.Size.ToString +
    sl +'     , '+ Qt(sLocal + PathDelim + sIdentificador) +
    sl +'     ) '+
    sl +
    sl +'returning id; '
  );

  Result := OpenKey(
    sl +'select a.id '+
    sl +'     , a.identificador '+
    sl +'     , a.tipo '+
    sl +'     , a.tamanho '+
    sl +'  from anexo as a '+
    sl +' where a.id = '+ iID.ToString
  );
end;

function HexToBytes(const Hex: string): TBytes;
var
  I: Integer;
begin
  SetLength(Result, Length(Hex) div 2);
  for I := 1 to Length(Hex) div 2 do
    Result[I - 1] := StrToInt('$'+ Copy(Hex, 2 * I - 1, 2));
end;

function DecodeHex(const HexStr: string): string;
var
  DecodedBytes: TBytes;
  AnsiStr: AnsiString;
begin
  // Remova o prefixo '\\x' se estiver presente
  if HexStr.StartsWith('\x') then
    DecodedBytes := HexToBytes(Copy(HexStr, 3, Length(HexStr) - 2))
  else
    DecodedBytes := HexToBytes(HexStr);

  // Decodifique os bytes em uma string Ansi
  SetString(AnsiStr, PAnsiChar(@DecodedBytes[0]), Length(DecodedBytes));
  Result := String(AnsiStr);
end;

class function TConversa.Mensagens(Conversa: Integer): TJSONArray;
var
  Pool: IConnection;
  Qry: TFDQuery;
begin
  Pool := TPool.Instance;
  Qry := TFDQuery.Create(nil);
  try
    Qry.Connection := Pool.Connection;
    Qry.Open(
      sl +'select jsonb_agg( '+
      sl +'         jsonb_build_object( ''id'', m.id '+
      sl +'                           , ''remetente_id'', m.usuario_id '+
      sl +'                           , ''remetente'', substring(trim(u.nome) from ''^([^ ]+)'') '+
      sl +'                           , ''conversa_id'', m.conversa_id '+
      sl +'                           , ''inserida'', m.inserida '+
      sl +'                           , ''alterada'', m.alterada '+
      sl +'                           , ''conteudos'', mc.conteudos '+
      sl +'                           ) '+
      sl +'       ) as resultado '+
      sl +'  from mensagem as m '+
      sl +' inner  '+
      sl +'  join usuario as u  '+
      sl +'    on u.id = m.usuario_id  '+
      sl +'  left '+
      sl +'  join '+
      sl +'     ( select mensagem_id '+
      sl +'            , jsonb_agg( '+
      sl +'                jsonb_build_object( ''id'', id '+
      sl +'                                  , ''ordem'', ordem '+
      sl +'                                  , ''tipo'', tipo '+
      sl +'                                  , ''conteudo'', conteudo '+
      sl +'                                  ) '+
      sl +'              ) as conteudos '+
      sl +'         from mensagem_conteudo '+
      sl +'        group  '+
      sl +'           by mensagem_id '+
      sl +'     ) as mc '+
      sl +'    on mc.mensagem_id = m.id '+
      sl +' where m.conversa_id = '+ Conversa.ToString
    );
    Result := TJSONObject.ParseJSONValue(Qry.FieldByName('resultado').AsString) as TJSONArray;
  finally
    FreeAndNil(Qry);
  end;
end;

end.

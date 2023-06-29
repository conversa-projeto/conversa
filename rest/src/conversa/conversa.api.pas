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
  Data.DB,
  FireDAC.Comp.Client,
  Horse,
  SQLite,
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
  end;

implementation

class function TConversa.Login(oAutenticacao: TJSONObject): TJSONObject;
begin
  CamposObrigatorios(oAutenticacao, ['email', 'senha']);

  Result := OpenKey(
    sl +'select id '+
    sl +'     , nome '+
    sl +'     , email '+
    sl +'     , telefone '+
    sl +'  from usuario '+
    sl +' where email = '+ Qt(oAutenticacao.GetValue<String>('email')) +
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
    sl +'     , u.user '+
    sl +'     , u.email '+
    sl +'     , u.telefone '+
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
    sl +'     , ifnull(c.descricao, group_concat(u.nome, '', '')) as descricao '+
    sl +'     , ( select max(datetime(inserida)) '+
    sl +'           from mensagem as m '+
    sl +'          where m.conversa_id = c.id '+
    sl +'       ) as "ultima_mensagem::datetime" '+
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
    sl +'    by "ultima_mensagem::datetime" desc '
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
  CamposObrigatorios(oMensagem, ['conversa_id', 'conteudo']);

  if Assigned(oMensagem.FindValue('usuario_id')) then
    raise EHorseException.New.Status(THTTPStatus.BadRequest).Error('Não pode ser definido o usuário ao incluir uma mensagem!');
  if Assigned(oMensagem.FindValue('inserida')) then
    raise EHorseException.New.Status(THTTPStatus.BadRequest).Error('Não pode ser definida a data de inclusão da mensagem!');

  oMensagem.AddPair('usuario_id', TJSONNumber.Create(Usuario));
  oMensagem.AddPair('inserida', DateToISO8601(Now));

  Result := InsertJSON('mensagem', oMensagem);
end;

class function TConversa.MensagemAlterar(oMensagem: TJSONObject): TJSONObject;
begin
  if (oMensagem.Count <> 1) or not Assigned(oMensagem.FindValue('conteudo')) then
    raise EHorseException.New.Status(THTTPStatus.BadRequest).Error('Só é permitido alterar o conteúdo da mensagem!');

  Result := UpdateJSON('mensagem', oMensagem);
end;

class function TConversa.MensagemExcluir(Mensagem: Integer): TJSONObject;
begin
  Result := Delete('mensagem', Mensagem);
end;

class function TConversa.Mensagens(Conversa: Integer): TJSONArray;
begin
  Result := Open(
    sl +'select m.id '+
    sl +'     , u.nome as remetente '+
    sl +'     , m.inserida as "inserida::datetime" '+
    sl +'     , m.alterada as "alterada::datetime" '+
    sl +'     , m.conteudo '+
    sl +'  from mensagem as m '+
    sl +' inner '+
    sl +'  join usuario as u '+
    sl +'    on u.id = m.usuario_id '+
    sl +' where m.conversa_id = '+ Conversa.ToString +
    sl +' order '+
    sl +'    by m.inserida desc '
  );
end;

end.

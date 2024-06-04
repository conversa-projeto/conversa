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
    class function MensagemExcluir(Mensagem: Integer): TJSONObject;
    class function Mensagens(Conversa, UltimaMensagem: Integer): TJSONArray;
    class function AnexoExiste(Identificador: String): TJSONObject;
    class function AnexoIncluir(Usuario: Integer; Tipo: Integer; Dados: TStringStream): TJSONObject;
    class function Anexo(Usuario: Integer; Identificador: String): TStringStream;
    class function NovasMensagens(Usuario, UltimaMensagem: Integer): TJSONArray;
  end;

implementation

const
  PASTA_ANEXO = 'anexos';

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
var
  Item: TJSONValue;
  pJSON: TJSONPair;
  oConteudo: TJSONObject;
begin
  CamposObrigatorios(oMensagem, ['conversa_id', 'conteudos']);

  oMensagem.AddPair('usuario_id', TJSONNumber.Create(Usuario));
  oMensagem.AddPair('inserida', DateToISO8601(Now));

  pJSON := oMensagem.RemovePair('conteudos');
  try
    Result := InsertJSON('mensagem', oMensagem);

    // Insere os conteudos
    for Item in pJSON.JsonValue as TJSONArray do
    begin
      oConteudo := TJSONObject.Create;
      oConteudo.AddPair('mensagem_id', Result.GetValue<Integer>('id'));
      oConteudo.AddPair('ordem', Item.GetValue<Integer>('ordem'));
      oConteudo.AddPair('tipo', Item.GetValue<Integer>('tipo'));
      oConteudo.AddPair('conteudo', Item.GetValue<String>('conteudo'));
      InsertJSON('mensagem_conteudo', oConteudo);
    end;
  finally
    FreeAndNil(pJSON);
  end;
end;

class function TConversa.MensagemExcluir(Mensagem: Integer): TJSONObject;
var
  oConteudo: TJSONObject;
begin
  oConteudo := Delete('mensagem_conteudo', Mensagem, 'mensagem_id');
  Result := Delete('mensagem', Mensagem);
  Result.AddPair('conteudo', oConteudo);
end;

class function TConversa.AnexoExiste(Identificador: String): TJSONObject;
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
      sl +'  from anexo as a '+
      sl +' where a.identificador = '+ Qt(Identificador)
    );

    Result := TJSONObject.Create;
    Result.AddPair('existe', TJSONBool.Create(not Qry.IsEmpty and TFile.Exists(ExtractFilePath(ParamStr(0)) + PASTA_ANEXO + PathDelim + Qry.FieldByName('identificador').AsString)));
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
  if not Assigned(Dados) then
    raise Exception.Create('Sem dados na requisição! Verifique se tipo de conteúdo é Content-Type: application/octet-stream');

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

  sLocal := ExtractFilePath(ParamStr(0)) + PASTA_ANEXO;

  if not TDirectory.Exists(sLocal) then
    TDirectory.CreateDirectory(sLocal);

  Dados.SaveToFile(sLocal + PathDelim + sIdentificador);

  iID := TPool.Instance.Connection.ExecSQLScalar(
    sl +'insert '+
    sl +'  into anexo '+
    sl +'     ( identificador '+
    sl +'     , tipo '+
    sl +'     , tamanho '+
    sl +'     ) '+
    sl +'values '+
    sl +'     ( '+ Qt(sIdentificador) +
    sl +'     , '+ Tipo.ToString +
    sl +'     , '+ Dados.Size.ToString +
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
      sl +'  from anexo as a '+
      sl +' where a.identificador = '+ Qt(Identificador)
    );

    if Qry.IsEmpty then
      raise Exception.Create('Anexo não encontrado!');

    Result := TStringStream.Create;
    Result.LoadFromFile(ExtractFilePath(ParamStr(0)) + PASTA_ANEXO + PathDelim + Qry.FieldByName('identificador').AsString);
  finally
    FreeAndNil(Qry);
  end;
end;

class function TConversa.Mensagens(Conversa, UltimaMensagem: Integer): TJSONArray;
var
  Pool: IConnection;
  Mensagem: TFDQuery;
  Conteudo: TFDQuery;
  oMensagem: TJSONObject;
  aConteudos: TJSONArray;
  oConteudo: TJSONObject;
begin
  Pool := TPool.Instance;
  Mensagem := TFDQuery.Create(nil);
  Conteudo := TFDQuery.Create(nil);
  try
    Mensagem.Connection := Pool.Connection;
    Conteudo.Connection := Pool.Connection;

    Mensagem.Open(
      sl +'select m.id '+
      sl +'     , m.usuario_id as remetente_id '+
      sl +'     , substring(trim(u.nome) from ''^([^ ]+)'') as remetente '+
      sl +'     , m.conversa_id '+
      sl +'     , m.inserida '+
      sl +'     , m.alterada '+
      sl +'  from mensagem as m '+
      sl +' inner  '+
      sl +'  join usuario as u  '+
      sl +'    on u.id = m.usuario_id  '+
      sl +' where m.conversa_id = '+ Conversa.ToString +
      sl +'   and m.id > '+ UltimaMensagem.ToString +
      sl +' order '+
      sl +'    by m.id '
    );

    Result := TJSONArray.Create;

    Mensagem.First;
    while not Mensagem.Eof do
    begin
      oMensagem := TJSONObject.Create;
      Result.Add(oMensagem);
      oMensagem.AddPair('id', Mensagem.FieldByName('id').AsInteger);
      oMensagem.AddPair('remetente_id', Mensagem.FieldByName('remetente_id').AsInteger);
      oMensagem.AddPair('remetente', Mensagem.FieldByName('remetente').AsString);
      oMensagem.AddPair('conversa_id', Mensagem.FieldByName('conversa_id').AsInteger);
      oMensagem.AddPair('inserida', DateToISO8601(Mensagem.FieldByName('inserida').AsDateTime));
      oMensagem.AddPair('alterada', DateToISO8601(Mensagem.FieldByName('alterada').AsDateTime));

      aConteudos := TJSONArray.Create;
      oMensagem.AddPair('conteudos', aConteudos);

      Conteudo.Open(
        sl +'select id '+
        sl +'     , ordem '+
        sl +'     , tipo '+
        sl +'     , convert_from(conteudo, ''utf-8'') as conteudo '+
        sl +'  from mensagem_conteudo '+
        sl +' where mensagem_id = '+ Mensagem.FieldByName('id').AsString +
        sl +' order '+
        sl +'    by ordem '
      );
      Conteudo.First;
      while not Conteudo.Eof do
      begin
        oConteudo := TJSONObject.Create;
        aConteudos.Add(oConteudo);
        oConteudo.AddPair('id', Conteudo.FieldByName('id').AsInteger);
        oConteudo.AddPair('tipo', Conteudo.FieldByName('tipo').AsInteger);
        oConteudo.AddPair('ordem', Conteudo.FieldByName('ordem').AsInteger);
        oConteudo.AddPair('conteudo', Conteudo.FieldByName('conteudo').AsString);
        Conteudo.Next;
      end;
      Mensagem.Next;
    end;
  finally
    FreeAndNil(Mensagem);
  end;
end;

class function TConversa.NovasMensagens(Usuario, UltimaMensagem: Integer): TJSONArray;
begin
  Result := Open(
    sl +'select m.conversa_id '+
    sl +'  from conversa_usuario as cu '+
    sl +' inner '+
    sl +'  join mensagem as m '+
    sl +'    on m.conversa_id = cu.id '+
    sl +' where cu.usuario_id = '+ Usuario.ToString +
    sl +'   and m.id > '+ UltimaMensagem.ToString +
    sl +' group '+
    sl +'    by m.conversa_id '
  );
end;

end.

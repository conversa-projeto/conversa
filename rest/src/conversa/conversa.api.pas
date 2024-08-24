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
  System.Math,
  Data.DB,
  FireDAC.Comp.Client,
  Horse,
  Postgres,
  conversa.comum,
  conversa.configuracoes;

type
  TConversa = class
    class function Status: TJSONObject;
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
    class function Mensagens(Conversa, Usuario, MensagemReferencia, MensagensPrevias, MensagensSeguintes: Integer): TJSONArray;
    class function Pesquisar(Usuario: Integer; Texto: String): TJSONArray;
    class function GetMensagens(Conversa, Usuario: Integer; Script: String; MarcarComoRecebida: Boolean): TJSONArray;
    class function MensagemVisualizada(Conversa, Mensagem, Usuario: Integer): TJSONObject;
    class function MensagemStatus(Conversa, Usuario: Integer; Mensagem: String): TJSONArray;
    class function AnexoExiste(Identificador: String): TJSONObject;
    class function AnexoIncluir(Usuario: Integer; Tipo: Integer; Dados: TStringStream): TJSONObject;
    class function Anexo(Usuario: Integer; Identificador: String): TStringStream;
    class function NovasMensagens(Usuario, UltimaMensagem: Integer): TJSONArray;
    class function ChamadaIncluir(joParam: TJSONObject): TJSONObject;
    class function ChamadaEventoIncluir(joParam: TJSONObject): TJSONObject;
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
    sl +'   drop table if exists temp_conversa; '+
    sl +' create temp table temp_conversa as '+
    sl +' select c.id '+
    sl +'      , c.descricao '+
    sl +'      , c.tipo '+
    sl +'      , c.inserida '+
    sl +'   from '+
    sl +'      ( select conversa_id '+
    sl +'          from conversa_usuario '+
    sl +'         where usuario_id = '+ Usuario.ToString +
    sl +'      ) as cu '+
    sl +'  inner '+
    sl +'   join conversa c '+
    sl +'     on c.id = cu.conversa_id; '+
    sl +
    sl +' select tc.id '+
    sl +'      , case when tc.descricao is null then substring(trim(d.nome) from ''^([^ ]+)'') else tc.descricao end as descricao '+
    sl +'      , tc.tipo '+
    sl +'      , tc.inserida '+
    sl +'      , d.nome '+
    sl +'      , d.destinatario_id '+
    sl +'      , coalesce(tcm.mensagem_id, 0) as mensagem_id '+
    sl +'      , tcm.ultima_mensagem '+
    sl +'      , convert_from(tcm.ultima_mensagem_texto, ''utf-8'') as ultima_mensagem_texto '+
    sl +'      , coalesce(mensagens_sem_visualizar, 0) as mensagens_sem_visualizar '+
    sl +'   from temp_conversa tc '+
    sl +'   left '+
    sl +'   join '+
    sl +'      ( select d.conversa_id '+
    sl +'             , d.destinatario_id '+
    sl +'             , u.nome '+
    sl +'          from '+
    sl +'             ( select cu.conversa_id '+
    sl +'                    , cu.usuario_id as destinatario_id '+
    sl +'                 from temp_conversa tc '+
    sl +'                inner '+
    sl +'                 join conversa_usuario cu '+
    sl +'                   on cu.conversa_id = tc.id '+
    sl +'                  and cu.usuario_id <> '+ Usuario.ToString +
    sl +'                group '+
    sl +'                   by cu.conversa_id '+
    sl +'                    , cu.usuario_id '+
    sl +'               having count(1) = 1 '+
    sl +'             ) d '+
    sl +'         inner '+
    sl +'          join usuario u '+
    sl +'            on u.id = d.destinatario_id '+
    sl +'      ) as d '+
    sl +'     on d.conversa_id = tc.id '+
    sl +'   left '+
    sl +'   join '+
    sl +'      ( select * '+
    sl +'          from '+
    sl +'             ( select tcm.conversa_id '+
    sl +'                    , tcm.mensagem_id as mensagem_id '+
    sl +'                    , tcm.inserida as ultima_mensagem '+
    sl +'                    , case mc.tipo '+
    sl +'                      when 1 then mc.conteudo '+
    sl +'                      when 2 then ''imagem'' '+
    sl +'                      else '''' '+
    sl +'                       end as ultima_mensagem_texto '+
    sl +'                    , row_number() over(partition by tcm.conversa_id, tcm.mensagem_id order by mc.ordem) as rid_conteudo '+
    sl +'                 from '+
    sl +'                    ( select * '+
    sl +'                        from '+
    sl +'                           ( select tc.id as conversa_id '+
    sl +'                                  , m.id as mensagem_id '+
    sl +'                                  , m.inserida '+
    sl +'                                  , row_number() over(partition by tc.id order by m.inserida desc) as rid '+
    sl +'                               from temp_conversa tc '+
    sl +'                              inner '+
    sl +'                               join mensagem m '+
    sl +'                                 on m.conversa_id = tc.id '+
    sl +'                           ) as tcm '+
    sl +'                       where tcm.rid = 1 '+
    sl +'                    ) as tcm '+
    sl +'                inner '+
    sl +'                 join mensagem_conteudo mc '+
    sl +'                   on mc.mensagem_id  = tcm.mensagem_id '+
    sl +'             ) as tcm '+
    sl +'         where tcm.rid_conteudo = 1 '+
    sl +'      ) as tcm '+
    sl +'     on tcm.conversa_id = tc.id '+
    sl +'   left '+
    sl +'   join '+
    sl +'      ( select ms.conversa_id '+
    sl +'             , count(1) as mensagens_sem_visualizar '+
    sl +'          from conversa c '+
    sl +'         inner '+
    sl +'          join mensagem_status ms '+
    sl +'            on ms.conversa_id = c.id '+
    sl +'           and (ms.recebida is null or ms.visualizada is null) '+
    sl +'           and ms.usuario_id = '+ Usuario.ToString +
    sl +'         group '+
    sl +'            by ms.conversa_id '+
    sl +'      ) as msg_count '+
    sl +'     on msg_count.conversa_id = tc.id '+
    sl +'  order '+
    sl +'     by tcm.ultima_mensagem desc '
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

    TPool.Instance.Connection.ExecSQL(
      sl +' insert '+
      sl +'   into mensagem_status '+
      sl +'      ( conversa_id  '+
      sl +'      , usuario_id  '+
      sl +'      , mensagem_id '+
      sl +'      ) '+
      sl +' select cu.conversa_id  '+
      sl +'      , cu.usuario_id  '+
      sl +'      , m.id '+
      sl +'   from mensagem m '+
      sl +'  inner '+
      sl +'   join conversa_usuario cu '+
      sl +'     on cu.conversa_id = m.conversa_id  '+
      sl +'    and cu.usuario_id <> '+ Usuario.ToString +
      sl +'  where m.id = '+ Result.GetValue<String>('id')
    );

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
    Result.AddPair('existe', TJSONBool.Create(not Qry.IsEmpty and TFile.Exists(IncludeTrailingPathDelimiter(Configuracao.LocalAnexos) + Qry.FieldByName('identificador').AsString)));
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

  sLocal := IncludeTrailingPathDelimiter(Configuracao.LocalAnexos);

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
    Result.LoadFromFile(IncludeTrailingPathDelimiter(Configuracao.LocalAnexos) + Qry.FieldByName('identificador').AsString);
  finally
    FreeAndNil(Qry);
  end;
end;

class function TConversa.Mensagens(Conversa, Usuario, MensagemReferencia, MensagensPrevias, MensagensSeguintes: Integer): TJSONArray;
var
  Script: String;
begin
  // Validação apenas para alertar de erro de chamada!
  Assert(MensagemReferencia >= 0, 'MensagemReferencia inválida!');
  Assert(MensagensPrevias >= 0, 'MensagensPrevias inválido!');
  Assert(MensagensPrevias <= 1000, 'MensagensPrevias acima do limite permitido!');
  Assert(MensagensSeguintes >= 0, 'MensagensSeguintes inválido!');
  Assert(MensagensSeguintes <= 1000, 'MensagensSeguintes acima do limite permitido!');

  Script := EmptyStr;

  // Se vai obter apenas 1 Mensagem
  if (MensagensPrevias = 0) and (MensagensSeguintes = 0) then
  begin
    if MensagemReferencia > 0 then
      Script := sl +'                        and m.id = '+ MensagemReferencia.ToString;

    Script :=
    sl +'              /* Apenas a mensagem solicitada */ '+
    sl +'              select id '+
    sl +'                from '+
    sl +'                   ( select id '+
    sl +'                       from mensagem m '+
    sl +'                      where m.conversa_id = '+ Conversa.ToString +
    Script +
    sl +'                      order '+
    sl +'                         by id desc '+
    sl +'                      limit 1'+
    sl +'                   ) as tbl '
  end
  else
  begin
    // Se vai obter menssagens Anteriores
    if MensagensPrevias > 0 then
    begin
      Script := Script +
      sl +'              /* Retorna mensagens anterioes */ '+
      sl +'              select id '+
      sl +'                from '+
      sl +'                   ( select id '+
      sl +'                       from mensagem m '+
      sl +'                      where m.conversa_id = '+ Conversa.ToString +
      IfThen(MensagemReferencia > 0,
      sl +'                        and m.id <= '+ MensagemReferencia.ToString)+
      sl +'                      order '+
      sl +'                         by id desc '+
      sl +'                      limit '+ MensagensPrevias.ToString +
      sl +'                   ) as tbl ';
    end;

    // Se vai obter menssagens Posteriores
    if MensagensSeguintes > 0 then
    begin
      if not Script.Trim.IsEmpty then
        Script := Script + sl +'               union ';

      Script := Script +
      sl +'              /* Retorna mensagens posteriores */ '+
      sl +'              select id '+
      sl +'                from '+
      sl +'                   ( select id '+
      sl +'                       from mensagem m '+
      sl +'                      where m.conversa_id = '+ Conversa.ToString +
      IfThen(MensagemReferencia > 0,
      sl +'                        and m.id >= '+ MensagemReferencia.ToString)+
      sl +'                      order '+
      sl +'                         by id '+
      sl +'                      limit '+ MensagensSeguintes.ToString +
      sl +'                   ) as tbl '
    end;
  end;

  Result := GetMensagens(Conversa, Usuario, Script, True);
end;

class function TConversa.Pesquisar(Usuario: Integer; Texto: String): TJSONArray;
var
  Script: String;
begin
  // Validação apenas para alertar de erro de chamada!
  Assert(Usuario > 0, 'Usuário inválido!');
  Assert(not Texto.Trim.IsEmpty, 'Texto inválido!');
  Texto := '%'+ Texto.Replace(' ', ' ').Replace(' ', '%') +'%';

  Script :=
  sl +'              /* Retorna mensagens posteriores */ '+
  sl +'              select id '+
  sl +'                from '+
  sl +'                   ( select m.id '+
  sl +'                       from mensagem m '+
  sl +'                      inner '+
  sl +'                       join '+
  sl +'                          ( select conversa_id '+
  sl +'                              from conversa_usuario '+
  sl +'                             where usuario_id = '+ Usuario.ToString +
  sl +'                          ) as c '+
  sl +'                         on c.conversa_id = m.conversa_id '+
  sl +'                      inner '+
  sl +'                       join mensagem_conteudo mc '+
  sl +'                         on mc.mensagem_id = m.id '+
  sl +'                        and mc.tipo = 1 /* 1-Texto */ '+
  sl +'                        and mc.conteudo like '+ Texto.QuotedString +
  sl +'                      order '+
  sl +'                         by m.id '+
  sl +'                   ) as tbl ';

  Result := GetMensagens(0, Usuario, Script, False);
end;

class function TConversa.GetMensagens(Conversa, Usuario: Integer; Script: String; MarcarComoRecebida: Boolean): TJSONArray;
var
  Pool: IConnection;
  Mensagem: TFDQuery;
  QryAux: TFDQuery;
  oMensagem: TJSONObject;
  aConteudos: TJSONArray;
  oConteudo: TJSONObject;
begin
  Pool := TPool.Instance;
  Mensagem := TFDQuery.Create(nil);
  QryAux := TFDQuery.Create(nil);
  try
    Mensagem.Connection := Pool.Connection;
    QryAux.Connection := Pool.Connection;

    Mensagem.Open(
      sl +'select * '+
      sl +'  from '+
      sl +'     ( '+
      sl +'select m.id '+
      sl +'     , m.usuario_id as remetente_id '+
      sl +'     , substring(trim(u.nome) from ''^([^ ]+)'') as remetente '+
      sl +'     , m.conversa_id '+
      sl +'     , m.inserida '+
      sl +'     , m.alterada '+
      sl +'  from '+
      sl +'     ( select m.* '+
      sl +'         from '+
      sl +'            ( '+
      sl + Script +
      sl +'            ) as tm '+
      sl +'        inner '+
      sl +'         join mensagem m '+
      sl +'           on m.id = tm.id '+
      sl +'     ) as m'+
      sl +' inner  '+
      sl +'  join usuario as u  '+
      sl +'    on u.id = m.usuario_id  '+
      sl +' order '+
      sl +'    by m.id desc '+
      sl +' limit 100 '+
      sl +'     ) as tbl '+
      sl +' order '+
      sl +'    by id '
    );

    Result := TJSONArray.Create;

    if MarcarComoRecebida then
      QryAux.Connection.ExecSQL(
        sl +' update mensagem_status '+
        sl +'    set recebida = now() '+
        sl +'  where conversa_id = '+ Conversa.ToString +
        sl +'    and usuario_id  = '+ Usuario.ToString +
        sl +'    and recebida is null '
      );

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



      QryAux.Open(
        sl +' select mensagem_id '+
        sl +'      , sum(case when recebida is null then 0 else 1 end) as recebida '+
        sl +'      , sum(case when visualizada is null then 0 else 1 end) as visualizada '+
        sl +'      , sum(case when reproduzida is null then 0 else 1 end) as reproduzida '+
        sl +'      , count(1) total '+
        sl +'   from mensagem_status ms '+
        sl +'  where ms.mensagem_id = '+ Mensagem.FieldByName('id').AsString +
        IfThen(Mensagem.FieldByName('remetente_id').AsInteger <> Usuario,
        sl +'    and ms.usuario_id = '+ Usuario.ToString)+
        sl +'  group '+
        sl +'     by mensagem_id '
      );
      oMensagem.AddPair('recebida', QryAux.FieldByName('recebida').AsInteger = QryAux.FieldByName('total').AsInteger);
      oMensagem.AddPair('visualizada', QryAux.FieldByName('visualizada').AsInteger = QryAux.FieldByName('total').AsInteger);
      oMensagem.AddPair('reproduzida', QryAux.FieldByName('reproduzida').AsInteger = QryAux.FieldByName('total').AsInteger);

      aConteudos := TJSONArray.Create;
      oMensagem.AddPair('conteudos', aConteudos);

      QryAux.Open(
        sl +'select id '+
        sl +'     , ordem '+
        sl +'     , tipo '+
        sl +'     , convert_from(conteudo, ''utf-8'') as conteudo '+
        sl +'  from mensagem_conteudo '+
        sl +' where mensagem_id = '+ Mensagem.FieldByName('id').AsString +
        sl +' order '+
        sl +'    by ordem '
      );
      QryAux.First;
      while not QryAux.Eof do
      begin
        oConteudo := TJSONObject.Create;
        aConteudos.Add(oConteudo);
        oConteudo.AddPair('id', QryAux.FieldByName('id').AsInteger);
        oConteudo.AddPair('tipo', QryAux.FieldByName('tipo').AsInteger);
        oConteudo.AddPair('ordem', QryAux.FieldByName('ordem').AsInteger);
        oConteudo.AddPair('conteudo', QryAux.FieldByName('conteudo').AsString);
        QryAux.Next;
      end;
      Mensagem.Next;
    end;
  finally
    FreeAndNil(QryAux);
    FreeAndNil(Mensagem);
  end;
end;

class function TConversa.MensagemVisualizada(Conversa, Mensagem, Usuario: Integer): TJSONObject;
begin
  TPool.Instance.Connection.ExecSQL(
    sl +' update mensagem_status '+
    sl +'    set visualizada = now() '+
    sl +'  where conversa_id = '+ Conversa.ToString +
    sl +'    and mensagem_id = '+ Mensagem.ToString +
    sl +'    and usuario_id  = '+ Usuario.ToString +
    sl +'    and visualizada is null '
  );
  Result := TJSONObject.Create.AddPair('sucesso', True);
end;

class function TConversa.MensagemStatus(Conversa, Usuario: Integer; Mensagem: String): TJSONArray;
begin
  Result := TJSONArray.Create;
  with TFDQuery.Create(nil) do
  try
    Connection := TPool.Instance.Connection;
    Open(
      sl +' select mensagem_id '+
      sl +'      , sum(case when recebida is null then 0 else 1 end) as recebida '+
      sl +'      , sum(case when visualizada is null then 0 else 1 end) as visualizada '+
      sl +'      , sum(case when reproduzida is null then 0 else 1 end) as reproduzida '+
      sl +'      , count(1) total '+
      sl +'   from mensagem_status ms '+
      sl +'  where ms.conversa_id = '+ Conversa.ToString +
      sl +'    and ms.mensagem_id in('+ Mensagem +') '+
      sl +'  group '+
      sl +'     by mensagem_id '+
      sl +'  order '+
      sl +'     by mensagem_id '
    );
    FetchAll;
    First;
    while not Eof do
    try
      Result.Add(
        TJSONObject.Create
          .AddPair('mensagem_id', FieldByName('mensagem_id').AsInteger)
          .AddPair('recebida', FieldByName('recebida').AsInteger = FieldByName('total').AsInteger)
          .AddPair('visualizada', FieldByName('visualizada').AsInteger = FieldByName('total').AsInteger)
          .AddPair('reproduzida', FieldByName('reproduzida').AsInteger = FieldByName('total').AsInteger)
      );
    finally
      Next;
    end;
  finally
    Free;
  end;
end;

class function TConversa.NovasMensagens(Usuario, UltimaMensagem: Integer): TJSONArray;
begin
  Result := Open(
    sl +'select m.conversa_id '+
    sl +'     , max(m.id) as mensagem_id '+
    sl +'  from mensagem as m '+
    sl +' inner '+
    sl +'  join conversa_usuario as cu '+
    sl +'    on cu.conversa_id = m.conversa_id '+
    sl +'   and cu.usuario_id <> m.usuario_id '+
    sl +' where cu.usuario_id = '+ Usuario.ToString +
    sl +'   and m.id> '+ UltimaMensagem.ToString +
    sl +' group '+
    sl +'    by m.conversa_id '
  );
end;

class function TConversa.Status: TJSONObject;
begin
  Result := TJSONObject.Create.AddPair('ativo', True);
end;

class function TConversa.ChamadaIncluir(joParam: TJSONObject): TJSONObject;
var
  iID: Integer;
begin
  CamposObrigatorios(joParam, ['fromuser_id', 'touser_id']);

  iID := TPool.Instance.Connection.ExecSQLScalar(
    sl +'insert '+
    sl +'  into chamada '+
    sl +'     ( iniciada_por '+
    sl +'     ) '+
    sl +'values '+
    sl +'     ( '+ joParam.GetValue<String>('fromuser_id') +
    sl +'     ) '+
    sl +
    sl +'returning id; '
  );
  TPool.Instance.Connection.ExecSQL(
    sl +'insert '+
    sl +'  into chamada_usuario '+
    sl +'     ( chamada_id '+
    sl +'     , usuario_id '+
    sl +'     ) '+
    sl +'values '+
    sl +'     ( '+ iID.ToString +
    sl +'     , '+ joParam.GetValue<String>('fromuser_id') +
    sl +'     ), '+
    sl +'     ( '+ iID.ToString +
    sl +'     , '+ joParam.GetValue<String>('touser_id') +
    sl +'     ) '
  );
  TPool.Instance.Connection.ExecSQL(
    sl +'insert '+
    sl +'  into chamada_evento '+
    sl +'     ( chamada_id '+
    sl +'     , usuario_id '+
    sl +'     , evento_tipo_id '+
    sl +'     ) '+
    sl +'values '+
    sl +'     ( '+ iID.ToString +
    sl +'     , '+ joParam.GetValue<String>('fromuser_id') +
    sl +'     , 1 '+
    sl +'     ) '
  );

  Result := TJSONObject.Create.AddPair('id', iID);
end;

class function TConversa.ChamadaEventoIncluir(joParam: TJSONObject): TJSONObject;
begin
  CamposObrigatorios(joParam, ['chamada_id', 'usuario_id', 'evento_tipo_id']);
  Result := InsertJSON('chamada_evento', joParam);
end;

end.

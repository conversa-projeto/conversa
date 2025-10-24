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
  conversa.configuracoes,
  conversa.chamada,
  FCMNotification,
  Thread.Queue,
  WebSocket;

type
  TConversa = record
  private
    class procedure ValidarChamada(Usuario, Chamada: Integer); static;
    class procedure EnviarNotificacao(Usuario, Conversa: Integer; sConteudo: String); static;
    class procedure AtualizaMensagemSocket(const Usuario, Conversa: Integer; const Mensagens: String); static;
    class procedure ChamadaNotificar(const Chamada, Usuario: Integer; Msg: TSocketMessageType); static;
    class procedure AtualizarStatusChamada(const Chamada: Integer; const Status: Integer = 0); static;
    class function InternalChamadaDados(Chamada: Integer): TJSONObject; static;
    class procedure ConversaNotificar(const Conversa, Usuario: Integer; Msg: TSocketMessageType); static;
  public
    class function Status: TJSONObject; static;
    class function ConsultarVersao(sRepositorio, sProjeto: String): TJSONObject; static;
    class function DownloadVersao(sRepositorio, sProjeto, sVersao, sArquivo: String): TStringStream; static;
    class function Login(oAutenticacao: TJSONObject): TJSONObject; static;
    class function DispositivoAlterar(Usuario: Integer; oDispositivo: TJSONObject): TJSONObject; static;
    class function DispositivoUsuarioIncluir(Usuario, Dispositivo: Integer): TJSONObject; static;
    class function UsuarioIncluir(oUsuario: TJSONObject): TJSONObject; static;
    class function UsuarioAlterar(oUsuario: TJSONObject): TJSONObject; static;
    class function UsuarioExcluir(Usuario: Integer): TJSONObject; static;
    class function UsuarioContatoIncluir(Usuario, Relacionamento: Integer): TJSONObject; static;
    class function UsuarioContatoExcluir(Usuario, UsuarioContato: Integer): TJSONObject; static;
    class function UsuarioContatos(Usuario: Integer): TJSONArray; static;
    class function ConversaIncluir(Usuario: Integer; oConversa: TJSONObject): TJSONObject; static;
    class function ConversaAlterar(Usuario: Integer; oConversa: TJSONObject): TJSONObject; static;
    class function ConversaExcluir(Usuario: Integer; Conversa: Integer): TJSONObject; static;
    class function Conversas(Usuario: Integer): TJSONArray; static;
    class function ConversaUsuarioIncluir(Usuario: Integer; oConversaUsuario: TJSONObject): TJSONObject; static;
    class function ConversaUsuarioExcluir(Usuario: Integer; ConversaUsuario: Integer): TJSONObject; static;
    class function MensagemIncluir(Usuario: Integer; oMensagem: TJSONObject): TJSONObject; static;
    class function MensagemExcluir(Usuario, Mensagem: Integer): TJSONObject; static;
    class function Mensagens(Conversa, Usuario, MensagemReferencia, MensagensPrevias, MensagensSeguintes: Integer): TJSONArray; static;
    class function Pesquisar(Usuario: Integer; Texto: String): TJSONArray; static;
    class function GetMensagens(Conversa, Usuario: Integer; Script: String; MarcarComoRecebida: Boolean): TJSONArray; static;
    class function MensagemVisualizada(Conversa, Mensagem, Usuario: Integer): TJSONObject; static;
    class function MensagemStatus(Conversa, Usuario: Integer; Mensagem: String): TJSONArray; static;
    class function AnexoExiste(Identificador: String): TJSONObject; static;
    class function AnexoIncluir(Tipo: Integer; Nome, Extensao: String; Dados: TStringStream): TJSONObject; static;
    class function Anexo(Identificador: String): TStringStream; static;
    class function NovasMensagens(Usuario, UltimaMensagem: Integer): TJSONArray; static;

    class function ChamadaIniciar(Usuario: Integer; joParam: TJSONObject): TJSONObject; static;
    class function ChamadaCancelar(Usuario: Integer; joParam: TJSONObject): TJSONObject; static;
    class function ChamadaRecusar(Usuario: Integer; joParam: TJSONObject): TJSONObject; static;
    class function ChamadaEntrar(Usuario: Integer; joParam: TJSONObject): TJSONObject; static;
    class function ChamadaSair(Usuario: Integer; joParam: TJSONObject): TJSONObject; static;
    class function ChamadaFinalizar(Usuario: Integer; joParam: TJSONObject): TJSONObject; static;
    class function ChamadaDados(Usuario: Integer; Chamada: Integer): TJSONObject; static;
    class function ChamadaEventoIncluir(Usuario: Integer; joParam: TJSONObject): TJSONObject; static;
  end;

implementation

class function TConversa.Status: TJSONObject;
begin
  Result := TJSONObject.Create.AddPair('ativo', True);
end;

class function TConversa.ConsultarVersao(sRepositorio, sProjeto: String): TJSONObject;
var
  oJSON: TJSONObject;
begin
  oJSON := OpenKey(
    sl +'select nome '+
    sl +'     , criada '+
    sl +'     , descricao '+
    sl +'     , arquivo '+
    sl +'     , url '+
    sl +'  from versao '+
    sl +' where repositorio = '+ sRepositorio.QuotedString +
    sl +'   and projeto = '+ sProjeto.QuotedString +
    sl +' order '+
    sl +'    by id desc '+
    sl +' limit 1 '
  );
  try
    Result := TJSONObject.Create
      .AddPair('name', oJSON.GetValue<String>('nome'))
      .AddPair('created_at', oJSON.GetValue<String>('criada'))
      .AddPair('body', oJSON.GetValue<String>('descricao'))
      .AddPair('assets',
        TJSONArray.Create
          .Add(TJSONObject.Create
            .AddPair('name', oJSON.GetValue<String>('arquivo'))
            .AddPair('browser_download_url', oJSON.GetValue<String>('url'))
          )
      );
  finally
    FreeAndNil(oJSON);
  end;
end;

class function TConversa.DownloadVersao(sRepositorio, sProjeto, sVersao, sArquivo: String): TStringStream;
begin
  Result := TStringStream.Create;
  Result.LoadFromFile(
    IncludeTrailingPathDelimiter(Configuracao.LocalVersoes) +
    sRepositorio + PathDelim +
    sProjeto + PathDelim +
    'releases'+ PathDelim +
    'download'+ PathDelim +
    sVersao + PathDelim +
    sArquivo
  );
end;

class function TConversa.Login(oAutenticacao: TJSONObject): TJSONObject;
var
  iDispositivoId: Integer;
  oDispositivo: TJSONObject;
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
  begin
    FreeAndNil(Result);
    raise EHorseException.New.Status(THTTPStatus.Unauthorized).Error('Acesso negado!');
  end;

  iDispositivoId := oAutenticacao.GetValue<Integer>('dispositivo_id', -1);
  if iDispositivoId > 0 then
    Result.AddPair(
      'dispositivo',
      OpenKey(
        sl +' select id '+
        sl +'      , nome '+
        sl +'      , modelo '+
        sl +'      , versao_so '+
        sl +'      , plataforma '+
        sl +'      , ativo '+
        sl +'   from dispositivo '+
        sl +'  where id = '+ iDispositivoId.ToString
      )
    );

  if not Assigned(Result.GetValue<TJSONObject>('dispositivo', nil)) then
  begin
    oDispositivo := TJSONObject.Create;
    try
      oDispositivo.AddPair('nome', 'desconhecido');
      oDispositivo.AddPair('modelo', 'desconhecido');
      oDispositivo.AddPair('versao_so', 'desconhecido');
      oDispositivo.AddPair('plataforma', 'desconhecido');
      oDispositivo.AddPair('usuario_id', Result.GetValue<Integer>('id'));
      Result.AddPair('dispositivo', InsertJSON('dispositivo', oDispositivo));
    finally
      FreeAndNil(oDispositivo);
    end;
  end;

  if not Result.GetValue<Boolean>('dispositivo.ativo', False) then
    raise EHorseException.New.Status(THTTPStatus.Unauthorized).Error('Seção Encerrada!');
end;

class function TConversa.DispositivoAlterar(Usuario: Integer; oDispositivo: TJSONObject): TJSONObject;
var
  sCampos: String;
  sValor: String;
  Par: TJSONPair;
  iID: Integer;
begin
  CamposObrigatorios(oDispositivo, ['id']);
  sCampos := EmptyStr;
  for Par in oDispositivo do
  begin
    if Par.JsonString.Value.Equals('id') then
    begin
      iID := TJSONNumber(Par.JsonValue).AsInt;
      Continue;
    end;

    if Par.JsonValue is TJSONNull then
      sValor := 'null'
    else
    if Par.JsonValue is TJSONNumber then
      sValor := Par.JsonValue.Value
    else
    if Par.JsonValue is TJSONString then
      sValor := Qt(Par.JsonValue.Value);

    sCampos := sCampos + IfThen(not sCampos.IsEmpty, ',') + Par.JsonString.Value +' = '+ sValor;
  end;

  if sCampos.Trim.IsEmpty then
    Exit(TJSONObject(oDispositivo.Clone));

  TPool.Instance.Connection.ExecSQL(
    sl +'update dispositivo '+
    sl +'   set '+ sCampos +
    sl +' where id = '+ iID.ToString +';'
  );

  Result := OpenKey(
    sl +'select * '+
    sl +'  from dispositivo'+
    sl +' where id = '+ iID.ToString
  );
end;

class function TConversa.DispositivoUsuarioIncluir(Usuario, Dispositivo: Integer): TJSONObject;
var
  oDispositivoUsuario: TJSONObject;
begin
  oDispositivoUsuario := TJSONObject.Create;
  try
    oDispositivoUsuario.AddPair('usuario_id', Usuario);
    oDispositivoUsuario.AddPair('dispositivo_id', Dispositivo);
    Result := InsertJSON('dispositivo_usuario', oDispositivoUsuario);
  finally
    FreeAndNil(oDispositivoUsuario);
  end;
end;

class function TConversa.UsuarioIncluir(oUsuario: TJSONObject): TJSONObject;
begin
  CamposObrigatorios(oUsuario, ['nome', 'login', 'email', 'senha']);
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

class function TConversa.UsuarioContatoIncluir(Usuario, Relacionamento: Integer): TJSONObject;
var
  oUsuarioContato: TJSONObject;
begin
  oUsuarioContato := TJSONObject.Create;
  try
    oUsuarioContato.AddPair('usuario_id', Usuario);
    oUsuarioContato.AddPair('relacionamento_id', Relacionamento);
    Result := InsertJSON('usuario_contato', oUsuarioContato);
  finally
    FreeAndNil(oUsuarioContato);
  end;
end;

class function TConversa.UsuarioContatoExcluir(Usuario, UsuarioContato: Integer): TJSONObject;
begin
  {TODO -oEduardo -cSegurança : não pode deletar contato de outro usuário, adicionar validação}
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
    sl +'  from usuario as u '+
    sl +' where u.id <> '+ Usuario.ToString +
    sl +' order '+
    sl +'    by u.id '
  );
end;

class procedure TConversa.ConversaNotificar(const Conversa, Usuario: Integer; Msg: TSocketMessageType);
var
  Pool: IConnection;
  Qry: TFDQuery;
begin
  Pool := TPool.Instance;
  Qry := TFDQuery.Create(nil);
  try
    Qry.Connection := Pool.Connection;
    Qry.Open(
      sl +'select c.id '+
      sl +'     , u.usuario_id '+
      sl +'  from conversa as c '+
      sl +' inner '+
      sl +'  join conversa_usuario u '+
      sl +'    on u.conversa_id = c.id '+
      sl +'   and u.usuario_id <> '+ Usuario.ToString +
      sl +' where c.id = '+ Conversa.ToString
    );

    if Qry.IsEmpty then
      Exit;

    Qry.FetchAll;
    Qry.First;
    while not Qry.Eof do
    try
      TWebSocket.ConversaNotificar(Conversa, Usuario, Qry.FieldByName('usuario_id').AsInteger, Msg);
    finally
      Qry.Next;
    end;
  finally
    FreeAndNil(Qry);
  end;
end;

class function TConversa.ConversaIncluir(Usuario: Integer; oConversa: TJSONObject): TJSONObject;
begin
  {TODO -oEduardo -cSegurança : não pode incluir conversa para outro usuário, adicionar validação}
  {TODO -oDaniel -cSegurança : O usuário que está criando, será adicionado como proprietário do chat}
  {TODO -oDaniel -cSegurança : Se for chat comum, deve informar o destinatário}
  Result := InsertJSON('conversa', oConversa);
end;

class function TConversa.ConversaAlterar(Usuario: Integer; oConversa: TJSONObject): TJSONObject;
begin
  {TODO -oEduardo -cSegurança : não pode alterar conversa de outro usuário, adicionar validação}
  CamposObrigatorios(oConversa, ['descricao']);
  Result := UpdateJSON('conversa', oConversa);
end;

class function TConversa.ConversaExcluir(Usuario: Integer; Conversa: Integer): TJSONObject;
begin
  {TODO -oEduardo -cSegurança : não pode excluir conversa de outro usuário, adicionar validação}
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
    sl +'      , coalesce(nullif(trim(tc.descricao), ''''), d.nome) as descricao '+
    sl +'      , tc.tipo '+
    sl +'      , tc.inserida '+
    sl +'      , d.nome '+
    sl +'      , d.destinatario_id '+
    sl +'      , coalesce(tcm.mensagem_id, 0) as mensagem_id '+
    sl +'      , tcm.ultima_mensagem '+
    sl +'      , convert_from(tcm.ultima_mensagem_texto, ''utf-8'') as ultima_mensagem_texto '+
    sl +'      , cast(coalesce(mensagens_sem_visualizar, 0) as int) as mensagens_sem_visualizar '+
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
    sl +'                where tc.tipo = 1 /* 1-Chat */ '+
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

class function TConversa.ConversaUsuarioIncluir(Usuario: Integer; oConversaUsuario: TJSONObject): TJSONObject;
begin
  {TODO -oEduardo -cSegurança : não pode incluir usuario em uma conversa de outro usuário, adicionar validação}
  {TODO -oDaniel -cSegurança : Não pode incluir usuário se não tiver permissão}
  {TODO -oDaniel -cSegurança : Não pode incluir usuário em um chat comum (1:1)}
  CamposObrigatorios(oConversaUsuario, ['usuario_id', 'conversa_id']);
  Result := InsertJSON('conversa_usuario', oConversaUsuario);
  ConversaNotificar(oConversaUsuario.GetValue<Integer>('conversa_id', 0), Usuario, TSocketMessageType.ConversaNova);
end;

class function TConversa.ConversaUsuarioExcluir(Usuario, ConversaUsuario: Integer): TJSONObject;
begin
  {TODO -oEduardo -cSegurança : não pode excluir usuario de uma conversa de outro usuário, adicionar validação}
  Result := Delete('conversa_usuario', ConversaUsuario);
end;

procedure EnviaNotificacoes(const AUsuarioID: Integer; const ATokenDispositivo, ATitulo, AMensagem: String; ADadosExtras: TJSONObject = nil);
begin
  TWebSocket.NovaMensagem(AUsuarioID.ToString, ATitulo, AMensagem);

  // Desabilitado envio de mensagens FCM por enquanto
  Exit;

  if not ATokenDispositivo.IsEmpty then
    TThreadQueue.Add(
      procedure
      begin
        FCM.EnviarNotificacao(ATokenDispositivo, ATitulo, AMensagem, ADadosExtras);
      end
    );
end;

class procedure TConversa.EnviarNotificacao(Usuario, Conversa: Integer; sConteudo: String);
var
  Pool: IConnection;
  Qry: TFDQuery;
begin
  Pool := TPool.Instance;
  Qry := TFDQuery.Create(nil);
  try
    Qry.Connection := Pool.Connection;
    Qry.Open(
      sl +'select distinct '+
      sl +'       cu.usuario_id '+
      sl +'  from conversa_usuario as cu '+
      sl +' inner '+
      sl +'  join usuario as u '+
      sl +'    on u.id = '+ Usuario.ToString +
      sl +' where cu.conversa_id = '+ Conversa.ToString +
      sl +'   and cu.usuario_id <> '+ Usuario.ToString
    );
    Qry.First;
    while not Qry.Eof do
    begin
      {TODO -oDaniel -cFCM : Corrigir notificação de FCM}
      EnviaNotificacoes(Qry.FieldByName('usuario_id').AsInteger, '', '', sConteudo);
      Qry.Next;
    end;
  finally
    FreeAndNil(Qry);
  end;
end;

class function TConversa.MensagemIncluir(Usuario: Integer; oMensagem: TJSONObject): TJSONObject;
var
  Item: TJSONValue;
  pJSON: TJSONPair;
  oConteudo: TJSONObject;
  sNotificacao: String;
begin
  {TODO -oDaniel -cSegurança : Validar usuário e conversa}
  CamposObrigatorios(oMensagem, ['conversa_id', 'conteudos']);
  oMensagem.AddPair('usuario_id', TJSONNumber.Create(Usuario));

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

      case Item.GetValue<Integer>('tipo') of
        1: sNotificacao := sNotificacao +' '+ Item.GetValue<String>('conteudo');
        2: sNotificacao := sNotificacao +' imagem';
        3: sNotificacao := sNotificacao +' arquivo';
      end
    end;

    sNotificacao := sNotificacao.Trim.Replace(' ', ' | ');
  finally
    FreeAndNil(pJSON);
  end;

  EnviarNotificacao(Usuario, oMensagem.GetValue<Integer>('conversa_id'), sNotificacao);
end;

class function TConversa.MensagemExcluir(Usuario, Mensagem: Integer): TJSONObject;
var
  oConteudo: TJSONObject;
begin
  {TODO -oEduardo -cSegurança : não pode excluir mensagem de outro usuário, adicionar validação}
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

class function TConversa.AnexoIncluir(Tipo: Integer; Nome, Extensao: String; Dados: TStringStream): TJSONObject;
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
    sl +'     , nome '+
    sl +'     , extensao '+
    sl +'     ) '+
    sl +'values '+
    sl +'     ( '+ Qt(sIdentificador) +
    sl +'     , '+ Tipo.ToString +
    sl +'     , '+ Dados.Size.ToString +
    sl +'     , '+ IfThen(Nome.Trim.IsEmpty, 'null', Qt(Nome)) +
    sl +'     , '+ IfThen(Extensao.Trim.IsEmpty, 'null', Qt(Extensao)) +
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

class function TConversa.Anexo(Identificador: String): TStringStream;
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
  {TODO -oEduardo -cSegurança : não pode retornar mensagem de conversa que o usuário não está, adicionar validação}

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
  Qry: TFDQuery;
  QryAux: TFDQuery;
  oMensagem: TJSONObject;
  aConteudos: TJSONArray;
  oConteudo: TJSONObject;
  sMensagens: String;
begin
  Pool := TPool.Instance;
  Mensagem := TFDQuery.Create(nil);
  Qry := TFDQuery.Create(nil);
  QryAux := TFDQuery.Create(nil);
  try
    Mensagem.Connection := Pool.Connection;
    Qry.Connection := Pool.Connection;
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
    Mensagem.FetchAll;

    Result := TJSONArray.Create;

    if MarcarComoRecebida then
    begin
      sMensagens := EmptyStr;
      Qry.Open(
        sl +' update mensagem_status '+
        sl +'    set recebida = now() '+
        sl +'  where conversa_id = '+ Conversa.ToString +
        sl +'    and usuario_id  = '+ Usuario.ToString +
        sl +'    and recebida is null '+
        sl +'returning mensagem_id '
      );
      Qry.FetchAll;
      Qry.First;
      while not Qry.Eof do
      begin
        sMensagens := sMensagens + Qry.FieldByName('mensagem_id').AsString +' ';
        Qry.Next;
      end;

      sMensagens := sMensagens.Trim.Replace(' ', ',');

      if not sMensagens.IsEmpty then
        AtualizaMensagemSocket(Usuario, Conversa, sMensagens);
    end;

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
        sl +'     , conteudo '+
        sl +'     , nome '+
        sl +'     , extensao '+
        sl +'  from '+
        sl +'     ( /* Retorna conteúdo de texto */ '+
        sl +'       select id '+
        sl +'            , ordem '+
        sl +'            , tipo '+
        sl +'            , convert_from(conteudo, ''utf-8'') as conteudo '+
        sl +'            , null as nome '+
        sl +'            , null as extensao '+
        sl +'         from mensagem_conteudo '+
        sl +'        where mensagem_id = '+ Mensagem.FieldByName('id').AsString +
        sl +'          and tipo = 1 /* 1-Texto */ '+
        sl +
        sl +'        union '+
        sl +
        sl +'       /* Retorna arquivos */ '+
        sl +'       select tbl.id '+
        sl +'            , tbl.ordem '+
        sl +'            , tbl.tipo '+
        sl +'            , tbl.conteudo '+
        sl +'            , a.nome '+
        sl +'            , a.extensao '+
        sl +'         from '+
        sl +'            ( '+
        sl +'              select id '+
        sl +'                   , ordem '+
        sl +'                   , tipo '+
        sl +'                   , convert_from(conteudo, ''utf-8'') as conteudo '+
        sl +'                from mensagem_conteudo '+
        sl +'               where mensagem_id = '+ Mensagem.FieldByName('id').AsString +
        sl +'                 and tipo in(2, 3, 4) /* 2-Imagem, 3-Arquivo, 4-Mensagem de Audio */ '+
        sl +'            ) as tbl '+
        sl +'        inner '+
        sl +'         join anexo a '+
        sl +'           on a.identificador = tbl.conteudo '+
        sl +'     ) as tbl '+
        sl +' order '+
        sl +'    by ordem '
      );
      QryAux.FetchAll;
      QryAux.First;
      while not QryAux.Eof do
      begin
        oConteudo := TJSONObject.Create;
        aConteudos.Add(oConteudo);
        oConteudo.AddPair('id', QryAux.FieldByName('id').AsInteger);
        oConteudo.AddPair('tipo', QryAux.FieldByName('tipo').AsInteger);
        oConteudo.AddPair('ordem', QryAux.FieldByName('ordem').AsInteger);
        oConteudo.AddPair('conteudo', QryAux.FieldByName('conteudo').AsString);
        oConteudo.AddPair('nome', QryAux.FieldByName('nome').AsString);
        oConteudo.AddPair('extensao', QryAux.FieldByName('extensao').AsString);
        QryAux.Next;
      end;
      Mensagem.Next;
    end;
  finally
    FreeAndNil(Qry);
    FreeAndNil(QryAux);
    FreeAndNil(Mensagem);
  end;
end;

class function TConversa.MensagemVisualizada(Conversa, Mensagem, Usuario: Integer): TJSONObject;
begin
  {TODO -oEduardo -cSegurança : não pode marcar como visualizada mensagem de outro o usuário, adicionar validação}
  TPool.Instance.Connection.ExecSQL(
    sl +' update mensagem_status '+
    sl +'    set visualizada = now() '+
    sl +'  where conversa_id = '+ Conversa.ToString +
    sl +'    and mensagem_id = '+ Mensagem.ToString +
    sl +'    and usuario_id  = '+ Usuario.ToString +
    sl +'    and visualizada is null '
  );
  Result := TJSONObject.Create.AddPair('sucesso', True);

  AtualizaMensagemSocket(Usuario, Conversa, Mensagem.ToString);
end;

class function TConversa.MensagemStatus(Conversa, Usuario: Integer; Mensagem: String): TJSONArray;
begin
  {TODO -oEduardo -cSegurança : não pode retornar status de mensagem de outro o usuário, adicionar validação}
  Result := TJSONArray.Create;
  with TFDQuery.Create(nil) do
  try
    Connection := TPool.Instance.Connection;
    Open(
      sl +' select conversa_id '+
      sl +'      , mensagem_id '+
      sl +'      , sum(case when recebida is null then 0 else 1 end) as recebida '+
      sl +'      , sum(case when visualizada is null then 0 else 1 end) as visualizada '+
      sl +'      , sum(case when reproduzida is null then 0 else 1 end) as reproduzida '+
      sl +'      , count(*) total '+
      sl +'   from mensagem_status ms '+
      sl +'  where ms.conversa_id = '+ Conversa.ToString +
      sl +'    and ms.mensagem_id in ('+ Mensagem +') '+
      sl +'  group '+
      sl +'     by conversa_id '+
      sl +'      , mensagem_id '+
      sl +'  order '+
      sl +'     by mensagem_id '
    );
    FetchAll;
    First;
    while not Eof do
    try
      Result.Add(
        TJSONObject.Create
          .AddPair('conversa_id', FieldByName('conversa_id').AsInteger)
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

class procedure TConversa.ValidarChamada(Usuario, Chamada: Integer);
var
  Pool: IConnection;
  Qry: TFDQuery;
begin
  if Chamada = 0 then
    raise Exception.Create('Chamada não encontrada!');

  Pool := TPool.Instance;
  Qry := TFDQuery.Create(nil);
  try
    Qry.Connection := Pool.Connection;
    Qry.Open(
      sl +'select c.id '+
      sl +'  from chamada as c '+
      sl +' inner '+
      sl +'  join chamada_usuario u '+
      sl +'    on u.chamada_id = c.id '+
      sl +'   and u.usuario_id = '+ Usuario.ToString +
      sl +' where c.id = '+ Chamada.ToString
    );

    if Qry.IsEmpty then
      raise Exception.Create('Chamada não encontrada!');
  finally
    FreeAndNil(Qry);
  end;
end;

class procedure TConversa.ChamadaNotificar(const Chamada, Usuario: Integer; Msg: TSocketMessageType);
var
  Pool: IConnection;
  Qry: TFDQuery;
begin
  Pool := TPool.Instance;
  Qry := TFDQuery.Create(nil);
  try
    Qry.Connection := Pool.Connection;
    Qry.Open(
      sl +'select c.id '+
      sl +'     , u.usuario_id '+
      sl +'  from chamada as c '+
      sl +' inner '+
      sl +'  join chamada_usuario u '+
      sl +'    on u.chamada_id = c.id '+
      sl +'   and u.usuario_id <> '+ Usuario.ToString +
      sl +' where c.id = '+ Chamada.ToString
    );

    if Qry.IsEmpty then
      raise Exception.Create('Chamada não encontrada!');

    Qry.FetchAll;
    Qry.First;
    while not Qry.Eof do
    try
      TWebSocket.ChamadaNotificar(Chamada, Usuario, Qry.FieldByName('usuario_id').AsInteger, Msg);
    finally
      Qry.Next;
    end;
  finally
    FreeAndNil(Qry);
  end;
end;

class function TConversa.ChamadaIniciar(Usuario: Integer; joParam: TJSONObject): TJSONObject;
var
  iID: Integer;
  jvUsuario: TJSONValue;
begin
  // Apenas para gerar um id
  iID := TPool.Instance.Connection.ExecSQLScalar(
    sl +' insert '+
    sl +'   into chamada '+
    sl +'      ( tipo '+
    sl +'      , criado_por '+
    sl +'      ) '+
    sl +' values '+
    sl +'      ( '+ joParam.GetValue<Integer>('tipo', IfThen(joParam.GetValue<TJSONArray>('usuarios').Count = 2, 1, 2)).ToString +
    sl +'      , '+ Usuario.ToString +
    sl +'      ) '+
    sl +
    sl +'returning id; '
  );

  TPool.Instance.Connection.ExecSQL(
    sl +'insert '+
    sl +'  into chamada_evento '+
    sl +'     ( chamada_id '+
    sl +'     , usuario_id '+
    sl +'     , tipo '+
    sl +'     , criado_por '+
    sl +'     ) '+
    sl +'values '+
    sl +'     ( '+ iID.ToString +
    sl +'     , '+ Usuario.ToString +
    sl +'     , 1 /* 1-Chamada Iniciada */ '+
    sl +'     , '+ Usuario.ToString +
    sl +'     ); '
  );

  for jvUsuario in joParam.GetValue<TJSONArray>('usuarios') do
  begin
    TPool.Instance.Connection.ExecSQL(
      sl +'insert '+
      sl +'  into chamada_usuario '+
      sl +'     ( chamada_id '+
      sl +'     , usuario_id '+
      sl +'     , adicionado_por '+
      sl +'     , status '+
      sl +'     ) '+
      sl +'values '+
      sl +'     ( '+ iID.ToString +
      sl +'     , '+ jvUsuario.GetValue<String>('id') +
      sl +'     , '+ Usuario.ToString +
      IfThen(jvUsuario.GetValue<Integer>('id') <> Usuario,
      sl +'     , 1 /* 1-Pendente */ '{ Usuário Convidado },
      sl +'     , 3 /* 3-Entrou */ '{ Usuário Que iniciou a chamada}) +
      sl +'     ); '+
      sl +
      sl +'insert '+
      sl +'  into chamada_evento '+
      sl +'     ( chamada_id '+
      sl +'     , usuario_id '+
      sl +'     , tipo '+
      sl +'     , criado_por '+
      sl +'     ) '+
      sl +'values '+
      sl +'     ( '+ iID.ToString +
      sl +'     , '+ jvUsuario.GetValue<String>('id') +
      IfThen(jvUsuario.GetValue<Integer>('id') <> Usuario,
      sl +'     , 3 /* 3-Usuário Convidado */ '{ Usuário Convidado },
      sl +'     , 5 /* 5-Entrou */ '{ Usuário Que iniciou a chamada}) +
      sl +'     , '+ Usuario.ToString +
      sl +'     ); '
    );

    // Adiciona usuarios na chamada TCP
    TChamada.Instance.AdicionarCliente(iID, jvUsuario.GetValue<Integer>('id'));
  end;
  Result := InternalChamadaDados(iID);

  ChamadaNotificar(iID, Usuario, TSocketMessageType.ChamadaRecebida);
end;

class function TConversa.ChamadaCancelar(Usuario: Integer; joParam: TJSONObject): TJSONObject;
begin
  Result := TJSONObject.Create.AddPair('id', joParam.GetValue<Integer>('id', 0));
  ValidarChamada(Usuario, joParam.GetValue<Integer>('id', 0));

  TPool.Instance.Connection.ExecSQL(
    sl +'insert '+
    sl +'  into chamada_evento '+
    sl +'     ( chamada_id '+
    sl +'     , usuario_id '+
    sl +'     , tipo '+
    sl +'     , criado_por '+
    sl +'     ) '+
    sl +'values '+
    sl +'     ( '+ joParam.GetValue<String>('id') +
    sl +'     , '+ Usuario.ToString +
    sl +'     , 2 /* 2-Chamada Cancelada */ '+
    sl +'     , '+ Usuario.ToString +
    sl +'     ) '
  );

  AtualizarStatusChamada(joParam.GetValue<Integer>('id', 0), 6); // 6-Cancelada

  ChamadaNotificar(joParam.GetValue<Integer>('id'), Usuario, TSocketMessageType.ChamadaFinalizada);
end;

class function TConversa.ChamadaRecusar(Usuario: Integer; joParam: TJSONObject): TJSONObject;
begin
  Result := TJSONObject.Create.AddPair('id', joParam.GetValue<Integer>('id', 0));
  ValidarChamada(Usuario, joParam.GetValue<Integer>('id', 0));

  TPool.Instance.Connection.ExecSQL(
    sl +'update chamada_usuario '+
    sl +'   set status = 2 /* 2-Recusou */'+
    sl +' where chamada_id = '+ joParam.GetValue<String>('id') +
    sl +'   and usuario_id = '+ Usuario.ToString +
    sl +'   and entrou_em is null; '+
    sl +
    sl +'insert '+
    sl +'  into chamada_evento '+
    sl +'     ( chamada_id '+
    sl +'     , usuario_id '+
    sl +'     , tipo '+
    sl +'     , criado_por '+
    sl +'     ) '+
    sl +'values '+
    sl +'     ( '+ joParam.GetValue<String>('id') +
    sl +'     , '+ Usuario.ToString +
    sl +'     , 4 /* 4-Usuário Recusou */ '+
    sl +'     , '+ Usuario.ToString +
    sl +'     ); '+
    sl +
    sl +'update chamada '+
    sl +'   set status = 2 /* 2-Recusada */ '+
    sl +' where id = 151 '+
    sl +'   and exists( '+
    sl +'         select * '+
    sl +'           from '+
    sl +'              ( select count(1) as usuarios '+
    sl +'                     , sum(case when cu.status = 2 then 1 else 0 end) recusaram '+
    sl +'                  from chamada c  '+
    sl +'                 inner '+
    sl +'                  join chamada_usuario cu '+
    sl +'                    on cu.chamada_id  = c.id '+
    sl +'                 where c.id = 151 '+
    sl +'              ) as t '+
    sl +'          where usuarios - 1 = recusaram '+
    sl +'       ); '

  );

  AtualizarStatusChamada(joParam.GetValue<Integer>('id', 0));

  ChamadaNotificar(joParam.GetValue<Integer>('id'), Usuario, TSocketMessageType.UsuarioRecusou);
end;

class function TConversa.ChamadaEntrar(Usuario: Integer; joParam: TJSONObject): TJSONObject;
begin
  Result := TJSONObject.Create.AddPair('id', joParam.GetValue<Integer>('id', 0));
  ValidarChamada(Usuario, joParam.GetValue<Integer>('id', 0));
  TPool.Instance.Connection.ExecSQL(
    sl +'update chamada_usuario '+
    sl +'   set status = 3 /* 3-Entrou */'+
    sl +' where chamada_id = '+ joParam.GetValue<String>('id') +
    sl +'   and usuario_id = '+ Usuario.ToString +
    sl +'   and entrou_em is null; '+
    sl +
    sl +'insert '+
    sl +'  into chamada_evento '+
    sl +'     ( chamada_id '+
    sl +'     , usuario_id '+
    sl +'     , tipo '+
    sl +'     , criado_por '+
    sl +'     ) '+
    sl +'values '+
    sl +'     ( '+ joParam.GetValue<String>('id') +
    sl +'     , '+ Usuario.ToString +
    sl +'     , 5 /* 5-Usuário Entrou */ '+
    sl +'     , '+ Usuario.ToString +
    sl +'     ) '
  );

  AtualizarStatusChamada(joParam.GetValue<Integer>('id', 0));

  ChamadaNotificar(joParam.GetValue<Integer>('id'), Usuario, TSocketMessageType.UsuarioEntrou);
end;

class function TConversa.ChamadaSair(Usuario: Integer; joParam: TJSONObject): TJSONObject;
begin
  Result := TJSONObject.Create.AddPair('id', joParam.GetValue<Integer>('id', 0));
  ValidarChamada(Usuario, joParam.GetValue<Integer>('id', 0));

  TPool.Instance.Connection.ExecSQL(
    sl +'update chamada_usuario '+
    sl +'   set status = 4 /* 4-Saiu */'+
    sl +' where chamada_id = '+ joParam.GetValue<String>('id') +
    sl +'   and usuario_id = '+ Usuario.ToString +';'+
    sl +
    sl +'insert '+
    sl +'  into chamada_evento '+
    sl +'     ( chamada_id '+
    sl +'     , usuario_id '+
    sl +'     , tipo '+
    sl +'     , criado_por '+
    sl +'     ) '+
    sl +'values '+
    sl +'     ( '+ joParam.GetValue<String>('id') +
    sl +'     , '+ Usuario.ToString +
    sl +'     , 6 /* 6-Usuário Saiu */ '+
    sl +'     , '+ Usuario.ToString +
    sl +'     ); '
  );

  AtualizarStatusChamada(joParam.GetValue<Integer>('id', 0));

  ChamadaNotificar(joParam.GetValue<Integer>('id'), Usuario, TSocketMessageType.UsuarioSaiu);
end;

class function TConversa.ChamadaFinalizar(Usuario: Integer; joParam: TJSONObject): TJSONObject;
begin
  Result := TJSONObject.Create.AddPair('id', joParam.GetValue<Integer>('id', 0));
  ValidarChamada(Usuario, joParam.GetValue<Integer>('id', 0));

  TPool.Instance.Connection.ExecSQL(
    sl +'insert '+
    sl +'  into chamada_evento '+
    sl +'     ( chamada_id '+
    sl +'     , usuario_id '+
    sl +'     , tipo '+
    sl +'     , criado_por '+
    sl +'     ) '+
    sl +'values '+
    sl +'     ( '+ joParam.GetValue<String>('id') +
    sl +'     , '+ Usuario.ToString +
    sl +'     , 7 /* 7-Chamada Finalizada */ '+
    sl +'     , '+ Usuario.ToString +
    sl +'     ) '
  );

  AtualizarStatusChamada(joParam.GetValue<Integer>('id', 0), 4); // 4-Encerrada

  ChamadaNotificar(joParam.GetValue<Integer>('id'), Usuario, TSocketMessageType.ChamadaFinalizada);

  // Remove a chamada TCP
  TChamada.Instance.RemoverChamada(joParam.GetValue<Integer>('id'));
end;

class function TConversa.ChamadaDados(Usuario, Chamada: Integer): TJSONObject;
begin
  ValidarChamada(Usuario, Chamada);
  Result := InternalChamadaDados(Chamada);
end;

class function TConversa.InternalChamadaDados(Chamada: Integer): TJSONObject;
begin
  Result := OpenKey(
    sl +' select id '+
    sl +'      , iniciada '+
    sl +'      , finalizada '+
    sl +'      , tipo '+
    sl +'      , status '+
    sl +'      , criado_em '+
    sl +'      , criado_por '+
    sl +'   from chamada '+
    sl +'  where id = '+ Chamada.ToString
  );
  Result.AddPair(
    'usuarios',
    Open(
      sl +' select cu.usuario_id '+
      sl +'      , u.nome as usuario_nome '+
      sl +'      , cu.status '+
      sl +'      , cu.adicionado_por '+
      sl +'      , u_add.nome as adicionado_por_nome '+
      sl +'      , cu.adicionado_em '+
      sl +'      , cu.entrou_em '+
      sl +'      , cu.saiu_em '+
      sl +'      , cu.recusou_em '+
      sl +'   from '+
      sl +'      ( select cu.usuario_id '+
      sl +'             , cu.status '+
      sl +'             , info.adicionado_por '+
      sl +'             , info.adicionado_em '+
      sl +'             , info.entrou_em '+
      sl +'             , info.saiu_em '+
      sl +'             , info.recusou_em '+
      sl +'          from '+
      sl +'             ( select usuario_id '+
      sl +'                    , status '+
      sl +'                 from chamada_usuario '+
      sl +'                where chamada_id = '+ Chamada.ToString +
      sl +'             ) as cu '+
      sl +'          left '+
      sl +'          join '+
      sl +'             ( select ce.usuario_id '+
      sl +'                    , max(case when ce.tipo in(1, 3) then criado_por else null end) as adicionado_por '+
      sl +'                    , max(case when ce.tipo in(1, 3) then criado_em else null end) as adicionado_em '+
      sl +'                    , max(case when ce.tipo = 4 then criado_em else null end) as recusou_em '+
      sl +'                    , max(case when ce.tipo = 5 then criado_em else null end) as entrou_em '+
      sl +'                    , max(case when ce.tipo = 6 then criado_em else null end) as saiu_em '+
      sl +'                 from '+
      sl +'                    ( select * '+
      sl +'                        from '+
      sl +'                           ( select usuario_id '+
      sl +'                                  , criado_por '+
      sl +'                                  , criado_em '+
      sl +'                                  , tipo '+
      sl +'                                  , row_number() over(partition by usuario_id, tipo order by criado_em desc) as rid '+
      sl +'                               from chamada_evento ce '+
      sl +'                              where ce.chamada_id = '+ Chamada.ToString +
      sl +'                                and ce.tipo in(1, 3, 4, 5, 6) '+
      sl +'                           ) as ce '+
      sl +'                       where ce.rid = 1 /* Apenas o último evento de cada tipo */'+
      sl +'                    ) as ce '+
      sl +'                group '+
      sl +'                   by ce.usuario_id '+
      sl +'             ) as info '+
      sl +'            on info.usuario_id = cu.usuario_id '+
      sl +'      ) as cu '+
      sl +'  inner '+
      sl +'   join usuario u '+
      sl +'     on u.id = cu.usuario_id  '+
      sl +'  inner '+
      sl +'   join usuario u_add '+
      sl +'     on u_add.id = cu.adicionado_por '
    )
  );
end;

class procedure TConversa.AtualizarStatusChamada(const Chamada: Integer; const Status: Integer = 0);
begin
  if Status > 0 then
    TPool.Instance.Connection.ExecSQL(
      sl +'update chamada '+
      sl +'   set status = '+ Status.ToString +
      IfThen(Status = 4,
      sl +'     , finalizada = current_timestamp ') +
      sl +' where id = '+ Chamada.ToString +
      sl +'   and status <> '+ Status.ToString
    )
  else
    TPool.Instance.Connection.ExecSQL(
      sl +'update chamada '+
      sl +'   set status = novo_status '+
      sl +'     , iniciada   = case when iniciada is null and novo_status = 3 then current_timestamp else iniciada end '+
      sl +'     , finalizada = case when novo_status = 4 then current_timestamp else finalizada end '+
      sl +'  from '+
      sl +'     ( select * '+
      sl +'         from '+
      sl +'            ( select id '+
      sl +'                   , status '+
      sl +'                   , case '+
      sl +'                     when tipo = 1 and u_recusou > 0 then 2 /* 1-Simples | 2-Recusada */ '+
      sl +'                     when tipo = 1 and u_saiu > 0 then 4 /* 1-Simples | 4-Encerrada */ '+
      sl +'                     when tipo = 1 and u_entrou = usuarios then 3 /* 1-Simples | 3-Em Andamento */ '+
      sl +'                     when tipo = 2 and u_recusou = usuarios - 1 then 2 /* 2-Grupo | 2-Recusada */ '+
      sl +'                     when tipo = 2 and u_saiu = usuarios - 1 then 4 /* 2-Grupo | 4-Encerrada */ '+
      sl +'                     when tipo = 2 and u_entrou > 0 then 3 /* 2-Grupo | 3-Em Andamento */ '+
      sl +'                     else 0 /* 0-Desconhecido */ '+
      sl +'                     end as novo_status '+
      sl +'                from '+
      sl +'                   ( select c.id '+
      sl +'                          , c.tipo '+
      sl +'                          , c.status '+
      sl +'                          , count(1) as usuarios '+
      sl +'                          , sum(case when cu.status = 1 then 1 else 0 end) as u_pendentes '+
      sl +'                          , sum(case when cu.status = 2 then 1 else 0 end) as u_recusou '+
      sl +'                          , sum(case when cu.status = 3 then 1 else 0 end) as u_entrou '+
      sl +'                          , sum(case when cu.status = 4 then 1 else 0 end) as u_saiu '+
      sl +'                          , sum(case when cu.status = 5 then 1 else 0 end) as u_desconectou '+
      sl +'                       from chamada c '+
      sl +'                      inner '+
      sl +'                       join chamada_usuario cu '+
      sl +'                         on cu.chamada_id = c.id '+
      sl +'                      where c.id = '+ Chamada.ToString +
      sl +'                        and c.status in(1, 3) '+
      sl +'                      group '+
      sl +'                         by c.id '+
      sl +'                          , c.status '+
      sl +'                          , c.tipo '+
      sl +'                   ) as t '+
      sl +'            ) as t '+
      sl +'        where status <> novo_status '+
      sl +'     ) c '+
      sl +' where c.id  = chamada.id '+
      sl +'   and c.novo_status <> chamada.status '+
      sl +'   and c.novo_status <> 0 '+
      sl +'   and c.id = '+ Chamada.ToString +
      sl +'   and c.status in(1, 3); '
    );
end;

class function TConversa.ChamadaEventoIncluir(Usuario: Integer; joParam: TJSONObject): TJSONObject;
begin
  CamposObrigatorios(joParam, ['chamada_id', 'usuario_id', 'evento_tipo_id']);
  Result := InsertJSON('chamada_evento', joParam);
end;

class procedure TConversa.AtualizaMensagemSocket(const Usuario, Conversa: Integer; const Mensagens: String);
var
  Pool: IConnection;
  Qry: TFDQuery;
begin
  // Notifica os usuários da conversa que a mensagem foi atualizada
  Pool := TPool.Instance;
  Qry := TFDQuery.Create(nil);
  try
    Qry.Connection := Pool.Connection;
    Qry.Open(
      sl +'select usuario_id '+
      sl +'  from conversa_usuario '+
      sl +' where conversa_id = '+ Conversa.ToString +
      sl +'   and usuario_id <> '+ Usuario.ToString
    );
    Qry.First;
    while not Qry.Eof do
    begin
      TWebSocket.AtualizarStatusMensagem(Qry.FieldByName('usuario_id').AsString, Conversa, Mensagens);
      Qry.Next;
    end;
  finally
    FreeAndNil(Qry);
  end;
end;

end.

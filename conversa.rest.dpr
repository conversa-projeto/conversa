// Eduardo - 30/03/2023
program conversa.rest;

{$APPTYPE CONSOLE}

{$R *.res}

uses
  {$IF DEFINED(MSWINDOWS)}
  Winapi.Windows,
  {$ENDIF }
  System.SysUtils,
  System.Classes,
  System.JSON,
  System.Math,
  System.DateUtils,
  Horse,
  Horse.Jhonson,
  Horse.HandleException,
  Horse.CORS,
  Horse.OctetStream,
  Horse.JWT,
  IdSSLOpenSSL,
  JOSE.Core.JWT,
  JOSE.Core.Builder,
  JOSE.Types.Bytes,
  conversa.api in 'src\conversa\conversa.api.pas',
  conversa.migracoes in 'src\conversa\conversa.migracoes.pas',
  Postgres in 'src\conversa\Postgres.pas',
  conversa.comum in 'src\conversa\conversa.comum.pas',
  conversa.autorizacao in 'src\conversa\conversa.autorizacao.pas',
  conversa.configuracoes in 'src\conversa\conversa.configuracoes.pas',
  FCMNotification in 'src\conversa\FCMNotification.pas',
  Thread.Queue in 'src\conversa\Thread.Queue.pas',
  WebSocket in 'src\conversa\WebSocket.pas',
  Anexo.Verificacao in 'src\conversa\Anexo.Verificacao.pas';

function Conteudo(Req: THorseRequest): TJSONObject;
begin
  Result := Req.Body<TJSONObject>;
  if not Assigned(Result) then
    EHorseException.New.Status(THTTPStatus.BadRequest).Error('Erro ao obter o conteúdo da requisição!');
end;

const
  sl = sLineBreak;
begin
  {$IF DEFINED(MSWINDOWS)}
  // Habilita caracteres UTF8 no terminal
  SetConsoleOutputCP(CP_UTF8);
  {$ENDIF}

  ReportMemoryLeaksOnShutdown := True;
  try
    TConfiguracao.LoadFromEnvironment;

    TPool.Start(Configuracao.PGParams);
    try
      try
        Migracoes;
      except on E: Exception do
        begin
          E.Message := 'Erro ao executar as migrações no banco de dados 😵 - '+ E.Message;
          raise;
        end;
      end;

      TConfiguracao.LoadFromDataBase;

      THorse
        .Use(Jhonson)
        .Use(OctetStream)
        .Use(HandleException)
        .Use(CORS)
        .Use(
          HorseJWT(
            Configuracao.JWTKEY,
            THorseJWTConfig.New
              .SessionClass(TJWTClaims)
              .SkipRoutes([
                '/api/login',
                '/api/cadastro'
              ])
          )
        );

      THorse.Use(
        procedure(Req: THorseRequest; Res: THorseResponse; Next: TProc)
        var
          Claims: TJWTClaims;
        begin
          try
            Claims := Req.Session<TJWTClaims>;
            if Assigned(Claims) then
              TPool.SetUsuarioID(Claims.Subject.ToInteger);
          except
            TPool.SetUsuarioID(0);
          end;
          Next;
        end
      );

      THorse.Post(
        '/api/login',
        procedure(Req: THorseRequest; Res: THorseResponse)
        var
          LJWT: TJWT;
          Resposta: TJSONObject;
        begin
          Resposta := TConversa.Login(Conteudo(Req));
          if not Assigned(Resposta) then
            Exit;

          LJWT := TJWT.Create;
          try
            LJWT.Claims.Subject    := Resposta.GetValue<String>('id');
            LJWT.Claims.Issuer     := 'conversa.login';
            LJWT.Claims.IssuedAt   := Now;
            LJWT.Claims.Expiration := IncHour(Now, 12);
            Resposta.AddPair('token', TJOSE.SHA256CompactToken(Configuracao.JWTKEY, LJWT).AsString);
          finally
            FreeAndNil(LJWT);
          end;

          Res.Send<TJSONObject>(Resposta);
        end
      );

      THorse.Post(
        '/api/alterar-senha',
        procedure(Req: THorseRequest; Res: THorseResponse)
        begin
          TConversa.AlterarSenha(Req.Session<TJWTClaims>.Subject.ToInteger, Conteudo(Req));
          Res.Send<TJSONObject>(TJSONObject.Create);
        end
      );

      THorse.Patch(
        '/api/dispositivo',
        procedure(Req: THorseRequest; Res: THorseResponse)
        begin
          Res.Send<TJSONObject>(TConversa.DispositivoAlterar(Req.Session<TJWTClaims>.Subject.ToInteger, Conteudo(Req)));
        end
      );

      THorse.Put(
        '/api/dispositivo/usuario',
        procedure(Req: THorseRequest; Res: THorseResponse)
        begin
          Req.Query.Field('dispositivo_id').Required(True);
          Res.Send<TJSONObject>(TConversa.DispositivoUsuarioIncluir(Req.Session<TJWTClaims>.Subject.ToInteger, Req.Query.Field('dispositivo_id').AsInteger));
        end
      );

      THorse.Put(
        '/api/usuario',
        procedure(Req: THorseRequest; Res: THorseResponse)
        begin
          Res.Send<TJSONObject>(TConversa.UsuarioIncluir(Conteudo(Req)));
        end
      );

      THorse.Patch(
        '/api/usuario',
        procedure(Req: THorseRequest; Res: THorseResponse)
        begin
          Res.Send<TJSONObject>(TConversa.UsuarioAlterar(Conteudo(Req)));
        end
      );

      THorse.Delete(
        '/api/usuario',
        procedure(Req: THorseRequest; Res: THorseResponse)
        begin
          Req.Query.Field('id').Required(True);
          Res.Send<TJSONObject>(TConversa.UsuarioExcluir(Req.Query.Field('id').AsInteger));
        end
      );

      THorse.Put(
        '/api/usuario/contato',
        procedure(Req: THorseRequest; Res: THorseResponse)
        begin
          Req.Query.Field('relacionamento_id').Required(True);
          Res.Send<TJSONObject>(TConversa.UsuarioContatoIncluir(Req.Session<TJWTClaims>.Subject.ToInteger, Req.Query.Field('relacionamento_id').AsInteger));
        end
      );

      THorse.Delete(
        '/api/usuario/contato',
        procedure(Req: THorseRequest; Res: THorseResponse)
        begin
          Req.Query.Field('id').Required(True);
          Res.Send<TJSONObject>(TConversa.UsuarioContatoExcluir(Req.Session<TJWTClaims>.Subject.ToInteger, Req.Query.Field('id').AsInteger));
        end
      );

      THorse.Get(
        '/api/usuario/contatos',
        procedure(Req: THorseRequest; Res: THorseResponse)
        begin
          Res.Send<TJSONArray>(TConversa.UsuarioContatos(Req.Session<TJWTClaims>.Subject.ToInteger));
        end
      );

      THorse.Get(
        '/api/contatos/online',
        procedure(Req: THorseRequest; Res: THorseResponse)
        begin
          Res.Send<TJSONArray>(TConversa.ContatosOnline(Req.Session<TJWTClaims>.Subject.ToInteger));
        end
      );

      THorse.Put(
        '/api/conversa',
        procedure(Req: THorseRequest; Res: THorseResponse)
        begin
          Res.Send<TJSONObject>(TConversa.ConversaIncluir(Req.Session<TJWTClaims>.Subject.ToInteger, Conteudo(Req)));
        end
      );

      THorse.Patch(
        '/api/conversa',
        procedure(Req: THorseRequest; Res: THorseResponse)
        begin
          Res.Send<TJSONObject>(TConversa.ConversaAlterar(Req.Session<TJWTClaims>.Subject.ToInteger, Conteudo(Req)));
        end
      );

      THorse.Delete(
        '/api/conversa',
        procedure(Req: THorseRequest; Res: THorseResponse)
        begin
          Req.Query.Field('id').Required(True);
          Res.Send<TJSONObject>(TConversa.ConversaExcluir(Req.Session<TJWTClaims>.Subject.ToInteger, Req.Query.Field('id').AsInteger));
        end
      );

      THorse.Get(
        '/api/conversas',
        procedure(Req: THorseRequest; Res: THorseResponse)
        begin
          Res.Send<TJSONArray>(TConversa.Conversas(Req.Session<TJWTClaims>.Subject.ToInteger));
        end
      );

      THorse.Get(
        '/api/conversa/usuarios',
        procedure(Req: THorseRequest; Res: THorseResponse)
        begin
          Req.Query.Field('conversa').Required(True);
          Res.Send<TJSONArray>(TConversa.ConversaUsuarios(Req.Session<TJWTClaims>.Subject.ToInteger, Req.Query.Field('conversa').AsInteger));
        end
      );

      THorse.Put(
        '/api/conversa/usuario',
        procedure(Req: THorseRequest; Res: THorseResponse)
        begin
          Res.Send<TJSONObject>(TConversa.ConversaUsuarioIncluir(Req.Session<TJWTClaims>.Subject.ToInteger, Conteudo(Req)));
        end
      );

      THorse.Delete(
        '/api/conversa/usuario',
        procedure(Req: THorseRequest; Res: THorseResponse)
        begin
          Req.Query.Field('id').Required(True);
          Res.Send<TJSONObject>(TConversa.ConversaUsuarioExcluir(Req.Session<TJWTClaims>.Subject.ToInteger, Req.Query.Field('id').AsInteger));
        end
      );

      THorse.Post(
        '/api/conversa/digitando',
        procedure(Req: THorseRequest; Res: THorseResponse)
        begin
          if not Assigned(Conteudo(Req).FindValue('id')) then
            EHorseException.New.Status(THTTPStatus.BadRequest).Error('ID da conversa não informado!');
          TConversa.ConversaDigitando(Req.Session<TJWTClaims>.Subject.ToInteger, Conteudo(Req).GetValue<Integer>('id'));
          Res.Send<TJSONObject>(TJSONObject.Create);
        end
      );

      THorse.Post(
        '/api/conversa/gravando',
        procedure(Req: THorseRequest; Res: THorseResponse)
        begin
          if not Assigned(Conteudo(Req).FindValue('id')) then
            EHorseException.New.Status(THTTPStatus.BadRequest).Error('ID da conversa não informado!');
          TConversa.ConversaGravando(Req.Session<TJWTClaims>.Subject.ToInteger, Conteudo(Req).GetValue<Integer>('id'));
          Res.Send<TJSONObject>(TJSONObject.Create);
        end
      );

      THorse.Put(
        '/api/mensagem',
        procedure(Req: THorseRequest; Res: THorseResponse)
        begin
          Res.Send<TJSONObject>(TConversa.MensagemIncluir(Req.Session<TJWTClaims>.Subject.ToInteger, Conteudo(Req)));
        end
      );

      THorse.Delete(
        '/api/mensagem',
        procedure(Req: THorseRequest; Res: THorseResponse)
        begin
          Req.Query.Field('id').Required(True);
          Res.Send<TJSONObject>(TConversa.MensagemExcluir(Req.Session<TJWTClaims>.Subject.ToInteger, Req.Query.Field('id').AsInteger));
        end
      );

      THorse.Get(
        '/api/anexo/existe',
        procedure(Req: THorseRequest; Res: THorseResponse)
        begin
          Req.Query.Field('identificador').Required(True);
          Res.Send<TJSONObject>(TConversa.AnexoExiste(Req.Query.Field('identificador').AsString));
        end
      );

      THorse.Get(
        '/api/anexo',
        procedure(Req: THorseRequest; Res: THorseResponse)
        begin
          Req.Query.Field('identificador').Required(True);
          Res.Send<TJSONObject>(TConversa.Anexo(Req.Query.Field('identificador').AsString));
        end
      );

      THorse.Put(
        '/api/anexo',
        procedure(Req: THorseRequest; Res: THorseResponse)
        begin
          Res.Send<TJSONObject>(
            TConversa.AnexoIncluir(
              Req.Body<TJSONObject>.GetValue<String>('identificador'),
              Req.Body<TJSONObject>.GetValue<Integer>('tipo'),
              Req.Body<TJSONObject>.GetValue<String>('nome'),
              Req.Body<TJSONObject>.GetValue<String>('extensao'),
              Req.Body<TJSONObject>.GetValue<Int64>('tamanho')
            )
          );
        end
      );

      THorse.Post(
        '/api/anexo/confirmar',
        procedure(Req: THorseRequest; Res: THorseResponse)
        begin
          Req.Query.Field('identificador').Required(True);
          Res.Send<TJSONObject>(TConversa.AnexoConfirmarUpload(Req.Query.Field('identificador').AsString));
        end
      );

      THorse.Get(
        '/api/mensagens',
        procedure(Req: THorseRequest; Res: THorseResponse)
        begin
          Req.Query.Field('conversa').Required(True);
          Res.Send<TJSONArray>(
            TConversa.Mensagens(
              Req.Query.Field('conversa').AsInteger,
              Req.Session<TJWTClaims>.Subject.ToInteger,
              Req.Query.Field('mensagemreferencia').AsInteger,
              Req.Query.Field('mensagensprevias').AsInteger,
              Req.Query.Field('mensagensseguintes').AsInteger
          ));
        end
      );

      THorse.Post(
        '/api/mensagem/visualizar',
        procedure(Req: THorseRequest; Res: THorseResponse)
        begin
          Res.Send<TJSONObject>(TConversa.MensagemVisualizada(Req.Session<TJWTClaims>.Subject.ToInteger, Conteudo(Req)));
        end
      );

      THorse.Post(
        '/api/mensagem/reproduzir',
        procedure(Req: THorseRequest; Res: THorseResponse)
        begin
          Res.Send<TJSONObject>(TConversa.MensagemReproduzida(Req.Session<TJWTClaims>.Subject.ToInteger, Conteudo(Req)));
        end
      );

      THorse.Get(
        '/api/mensagem/status',
        procedure(Req: THorseRequest; Res: THorseResponse)
        begin
          Req.Query.Field('conversa').Required(True);
          Req.Query.Field('mensagem').Required(True);
          Res.Send<TJSONArray>(
            TConversa.MensagemStatus(
              Req.Query.Field('conversa').AsInteger,
              Req.Session<TJWTClaims>.Subject.ToInteger,
              Req.Query.Field('mensagem').AsString
            )
          );
        end
      );

      THorse.Get(
        '/api/mensagens/novas',
        procedure(Req: THorseRequest; Res: THorseResponse)
        begin
          Res.Send<TJSONArray>(TConversa.NovasMensagens(Req.Session<TJWTClaims>.Subject.ToInteger, Req.Query.Field('ultima').AsInteger));
        end
      );

      THorse.Put(
        '/api/chamada/iniciar',
        procedure(Req: THorseRequest; Res: THorseResponse)
        begin
          Res.Send<TJSONObject>(TConversa.ChamadaIniciar(Req.Session<TJWTClaims>.Subject.ToInteger, Conteudo(Req)));
        end
      );

      THorse.Post(
        '/api/chamada/cancelar',
        procedure(Req: THorseRequest; Res: THorseResponse)
        begin
          Res.Send<TJSONObject>(TConversa.ChamadaCancelar(Req.Session<TJWTClaims>.Subject.ToInteger, Conteudo(Req)));
        end
      );

      THorse.Post(
        '/api/chamada/entrar',
        procedure(Req: THorseRequest; Res: THorseResponse)
        begin
          Res.Send<TJSONObject>(TConversa.ChamadaEntrar(Req.Session<TJWTClaims>.Subject.ToInteger, Conteudo(Req)));
        end
      );

      THorse.Post(
        '/api/chamada/recusar',
        procedure(Req: THorseRequest; Res: THorseResponse)
        begin
          Res.Send<TJSONObject>(TConversa.ChamadaRecusar(Req.Session<TJWTClaims>.Subject.ToInteger, Conteudo(Req)));
        end
      );

      THorse.Post(
        '/api/chamada/sair',
        procedure(Req: THorseRequest; Res: THorseResponse)
        begin
          Res.Send<TJSONObject>(TConversa.ChamadaSair(Req.Session<TJWTClaims>.Subject.ToInteger, Conteudo(Req)));
        end
      );

      THorse.Put(
        '/api/chamada/usuario',
        procedure(Req: THorseRequest; Res: THorseResponse)
        begin
          Res.Send<TJSONObject>(TConversa.ChamadaUsuario(Req.Session<TJWTClaims>.Subject.ToInteger, Conteudo(Req)));
        end
      );

      THorse.Post(
        '/api/chamada/finalizar',
        procedure(Req: THorseRequest; Res: THorseResponse)
        begin
          Res.Send<TJSONObject>(TConversa.ChamadaFinalizar(Req.Session<TJWTClaims>.Subject.ToInteger, Conteudo(Req)));
        end
      );

      THorse.Get(
        '/api/chamada/dados',
        procedure(Req: THorseRequest; Res: THorseResponse)
        begin
          Res.Send<TJSONObject>(TConversa.ChamadaDados(Req.Session<TJWTClaims>.Subject.ToInteger, Req.Query.Field('id').AsInteger));
        end
      );

      THorse.Get(
        '/api/chamadas/pendentes',
        procedure(Req: THorseRequest; Res: THorseResponse)
        begin
          Res.Send<TJSONArray>(TConversa.ChamadasPendentes(Req.Session<TJWTClaims>.Subject.ToInteger));
        end
      );

      THorse.Get(
        '/api/chamadas',
        procedure(Req: THorseRequest; Res: THorseResponse)
        begin
          Res.Send<TJSONArray>(TConversa.Chamadas(
            Req.Session<TJWTClaims>.Subject.ToInteger,
            Req.Query.Field('participante').AsInteger,
            Req.Query.Field('de').AsString,
            Req.Query.Field('ate').AsString
          ));
        end
      );

      THorse.Post('/api/chamada/video',
        procedure(Req: THorseRequest; Res: THorseResponse)
        begin
          if not Assigned(Conteudo(Req).FindValue('id')) then
            EHorseException.New.Status(THTTPStatus.BadRequest).Error('ID da chamada não informado!');
          TConversa.ChamadaVideo(Req.Session<TJWTClaims>.Subject.ToInteger, Conteudo(Req).GetValue<Integer>('id'));
          Res.Send<TJSONObject>(TJSONObject.Create);
        end
      );

      THorse.Get(
        '/api/pesquisar',
        procedure(Req: THorseRequest; Res: THorseResponse)
        begin
          Req.Query.Field('usuario').Required(True);
          Res.Send<TJSONArray>(
            TConversa.Pesquisar(
              Req.Query.Field('conversa').AsInteger,
              Req.Query.Field('usuario').AsInteger,
              Req.Query.Field('texto').AsString
          ));
        end
      );

      THorse.Get(
        '/api/sip',
        procedure(Req: THorseRequest; Res: THorseResponse)
        begin
          Res.Send<TJSONObject>(TConversa.SIP(Req.Session<TJWTClaims>.Subject.ToInteger));
        end
      );

      THorse.Put(
        '/api/sip',
        procedure(Req: THorseRequest; Res: THorseResponse)
        begin
          Res.Send<TJSONObject>(TConversa.SIPIncluir(Req.Session<TJWTClaims>.Subject.ToInteger, Conteudo(Req)));
        end
      );

      THorse.Patch(
        '/api/sip',
        procedure(Req: THorseRequest; Res: THorseResponse)
        begin
          Res.Send<TJSONObject>(TConversa.SIPAlterar(Req.Session<TJWTClaims>.Subject.ToInteger, Conteudo(Req)));
        end
      );

      THorse.Put(
        '/api/mensagem/reacao',
        procedure(Req: THorseRequest; Res: THorseResponse)
        begin
          Res.Send<TJSONObject>(TConversa.ReacaoAlternar(Req.Session<TJWTClaims>.Subject.ToInteger, Conteudo(Req)));
        end
      );

      TWebSocket.Iniciar(9090, Configuracao.JWTKEY);
      try
        TThreadQueue.Create;
        try
          TThreadQueue.OnError(
            procedure(sMessage: String)
            begin
              Writeln(sMessage);
            end
          );

          TAnexoVerificacao.Start(Configuracao.S3);
          try
            FCM := TFCMNotification.Create(Configuracao.FCM);
            try
              THorse.Listen(
                8080,
                procedure
                begin
                  Writeln('Servidor iniciado 🚀');
                end
              );
            finally
              FreeAndNil(FCM);
            end;
          finally
            TAnexoVerificacao.Stop;
          end;
        finally
          TThreadQueue.Destroy;
        end;
      finally
        TWebSocket.Parar;
      end;
    finally
      TPool.Stop;
    end;
  except on E: Exception do
    begin
      Writeln(E.ClassName, ': ', E.Message);
      Readln;
    end;
  end;
end.

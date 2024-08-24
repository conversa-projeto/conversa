// Eduardo - 30/03/2023
program conversa.rest;

{$APPTYPE CONSOLE}

{$R *.res}

uses
  System.SysUtils,
  System.Classes,
  System.JSON,
  Winapi.Windows,
  Horse,
  Horse.Jhonson,
  Horse.HandleException,
  Horse.CORS,
  Horse.OctetStream,
  System.Math,
  conversa.api in 'src\conversa\conversa.api.pas',
  conversa.migracoes in 'src\conversa\conversa.migracoes.pas',
  Postgres in 'src\conversa\Postgres.pas',
  conversa.comum in 'src\conversa\conversa.comum.pas',
  conversa.configuracoes in 'src\conversa\conversa.configuracoes.pas',
  Conversa.WMI in 'src\conversa\Conversa.WMI.pas';

function Conteudo(Req: THorseRequest): TJSONObject;
begin
  Result := Req.Body<TJSONObject>;
  if not Assigned(Result) then
    EHorseException.New.Status(THTTPStatus.BadRequest).Error('Erro ao obter o conteúdo da requisição!');
end;

const
  sl = sLineBreak;
begin
  // Habilita caracteres UTF8 no terminal
  SetConsoleOutputCP(CP_UTF8);

  ReportMemoryLeaksOnShutdown := True;
  try
    TConfiguracao.LoadFromFile('conversa.json');

    THorse
      .Use(Jhonson)
      .Use(OctetStream)
      .Use(HandleException)
      .Use(CORS);

    TPool.Start(Configuracao.PGParams);
    try
      try
        Migracoes(0);
      except on E: Exception do
        begin
          E.Message := 'Erro ao executar as migrações no banco de dados 😵 - '+ E.Message;
          raise;
        end;
      end;

      // uid = ID do usuário logado no sistema, será obtido posteriormente usando bearer token
      // deve ser usado para validar as operações impedindo acesso a informações indevidas de outros usuárioss

      THorse.Get(
        '/status',
        procedure(Req: THorseRequest; Res: THorseResponse)
        begin
          Res.Send<TJSONObject>(TConversa.Status);
        end
      );

      THorse.Post(
        '/login',
        procedure(Req: THorseRequest; Res: THorseResponse)
        begin
          Res.Send<TJSONObject>(TConversa.Login(Conteudo(Req)));
        end
      );

      THorse.Put(
        '/usuario',
        procedure(Req: THorseRequest; Res: THorseResponse)
        begin
          Req.Headers.Field('uid').Required(True);
          Res.Send<TJSONObject>(TConversa.UsuarioIncluir(Conteudo(Req)));
        end
      );

      THorse.Patch(
        '/usuario',
        procedure(Req: THorseRequest; Res: THorseResponse)
        begin
          Req.Headers.Field('uid').Required(True);
          Res.Send<TJSONObject>(TConversa.UsuarioAlterar(Conteudo(Req)));
        end
      );

      THorse.Delete(
        '/usuario',
        procedure(Req: THorseRequest; Res: THorseResponse)
        begin
          Req.Headers.Field('uid').Required(True);
          Req.Query.Field('id').Required(True);
          Res.Send<TJSONObject>(TConversa.UsuarioExcluir(Req.Query.Field('id').AsInteger));
        end
      );

      THorse.Put(
        '/usuario/contato',
        procedure(Req: THorseRequest; Res: THorseResponse)
        begin
          Req.Headers.Field('uid').Required(True);
          Res.Send<TJSONObject>(TConversa.UsuarioContatoIncluir(Req.Headers.Field('uid').AsInteger, Conteudo(Req)));
        end
      );

      THorse.Delete(
        '/usuario/contato',
        procedure(Req: THorseRequest; Res: THorseResponse)
        begin
          Req.Headers.Field('uid').Required(True);
          Req.Query.Field('id').Required(True);
          Res.Send<TJSONObject>(TConversa.UsuarioContatoExcluir(Req.Query.Field('id').AsInteger));
        end
      );

      THorse.Get(
        '/usuario/contatos',
        procedure(Req: THorseRequest; Res: THorseResponse)
        begin
          Req.Headers.Field('uid').Required(True);
          Res.Send<TJSONArray>(TConversa.UsuarioContatos(Req.Headers.Field('uid').AsInteger));
        end
      );

      THorse.Put(
        '/conversa',
        procedure(Req: THorseRequest; Res: THorseResponse)
        begin
          Req.Headers.Field('uid').Required(True);
          Res.Send<TJSONObject>(TConversa.ConversaIncluir(Conteudo(Req)));
        end
      );

      THorse.Patch(
        '/conversa',
        procedure(Req: THorseRequest; Res: THorseResponse)
        begin
          Req.Headers.Field('uid').Required(True);
          Res.Send<TJSONObject>(TConversa.ConversaAlterar(Conteudo(Req)));
        end
      );

      THorse.Delete(
        '/conversa',
        procedure(Req: THorseRequest; Res: THorseResponse)
        begin
          Req.Headers.Field('uid').Required(True);
          Req.Query.Field('id').Required(True);
          Res.Send<TJSONObject>(TConversa.ConversaExcluir(Req.Query.Field('id').AsInteger));
        end
      );

      THorse.Get(
        '/conversas',
        procedure(Req: THorseRequest; Res: THorseResponse)
        begin
          Req.Headers.Field('uid').Required(True);
          Res.Send<TJSONArray>(TConversa.Conversas(Req.Headers.Field('uid').AsInteger));
        end
      );

      THorse.Put(
        '/conversa/usuario',
        procedure(Req: THorseRequest; Res: THorseResponse)
        begin
          Req.Headers.Field('uid').Required(True);
          Res.Send<TJSONObject>(TConversa.ConversaUsuarioIncluir(Conteudo(Req)));
        end
      );

      THorse.Delete(
        '/conversa/usuario',
        procedure(Req: THorseRequest; Res: THorseResponse)
        begin
          Req.Headers.Field('uid').Required(True);
          Req.Query.Field('id').Required(True);
          Res.Send<TJSONObject>(TConversa.ConversaUsuarioExcluir(Req.Query.Field('id').AsInteger));
        end
      );

      THorse.Put(
        '/mensagem',
        procedure(Req: THorseRequest; Res: THorseResponse)
        begin
          Req.Headers.Field('uid').Required(True);
          Res.Send<TJSONObject>(TConversa.MensagemIncluir(Req.Headers.Field('uid').AsInteger, Conteudo(Req)));
        end
      );

      THorse.Delete(
        '/mensagem',
        procedure(Req: THorseRequest; Res: THorseResponse)
        begin
          Req.Headers.Field('uid').Required(True);
          Req.Query.Field('id').Required(True);
          Res.Send<TJSONObject>(TConversa.MensagemExcluir(Req.Query.Field('id').AsInteger));
        end
      );

      THorse.Get(
        '/anexo/existe',
        procedure(Req: THorseRequest; Res: THorseResponse)
        begin
          Req.Headers.Field('identificador').Required(True);
          Res.Send<TJSONObject>(TConversa.AnexoExiste(Req.Query.Field('identificador').AsString));
        end
      );

      THorse.Get(
        '/anexo',
        procedure(Req: THorseRequest; Res: THorseResponse)
        begin
          Req.Headers.Field('uid').Required(True);
          Req.Headers.Field('identificador').Required(True);
          Res.Send<TStringStream>(TConversa.Anexo(Req.Headers.Field('uid').AsInteger, Req.Query.Field('identificador').AsString));
        end
      );

      THorse.Put(
        '/anexo',
        procedure(Req: THorseRequest; Res: THorseResponse)
        begin
          Req.Headers.Field('uid').Required(True);
          Res.Send<TJSONObject>(TConversa.AnexoIncluir(Req.Headers.Field('uid').AsInteger, Req.Query.Field('tipo').AsInteger, Req.Body<TStringStream>));
        end
      );

      THorse.Get(
        '/mensagens',
        procedure(Req: THorseRequest; Res: THorseResponse)
        begin
          Req.Headers.Field('uid').Required(True);
          Req.Query.Field('conversa').Required(True);
          Req.Query.Field('usuario').Required(True);
          Res.Send<TJSONArray>(
            TConversa.Mensagens(
              Req.Query.Field('conversa').AsInteger,
              Req.Query.Field('usuario').AsInteger,
              Req.Query.Field('mensagemreferencia').AsInteger,
              IfThen(Req.Query.Field('mensagensprevias').AsInteger > 0, Req.Query.Field('mensagensprevias').AsInteger, Req.Query.Field('offsetanterior').AsInteger),
              IfThen(Req.Query.Field('mensagensseguintes').AsInteger > 0, Req.Query.Field('mensagensseguintes').AsInteger, Req.Query.Field('offsetposterior').AsInteger)
          ));
        end
      );

      THorse.Get(
        '/mensagem/visualizar',
        procedure(Req: THorseRequest; Res: THorseResponse)
        begin
          Req.Headers.Field('uid').Required(True);
          Req.Query.Field('conversa').Required(True);
          Req.Query.Field('mensagem').Required(True);
          Req.Query.Field('usuario').Required(True);
          Res.Send<TJSONObject>(TConversa.MensagemVisualizada(Req.Query.Field('conversa').AsInteger, Req.Query.Field('mensagem').AsInteger, Req.Query.Field('usuario').AsInteger));
        end
      );

      THorse.Get(
        '/mensagem/status',
        procedure(Req: THorseRequest; Res: THorseResponse)
        begin
          Req.Headers.Field('uid').Required(True);
          Req.Query.Field('conversa').Required(True);
          Req.Query.Field('mensagem').Required(True);
          Req.Query.Field('usuario').Required(True);
          Res.Send<TJSONArray>(TConversa.MensagemStatus(Req.Query.Field('conversa').AsInteger, Req.Query.Field('usuario').AsInteger, Req.Query.Field('mensagem').AsString));
        end
      );

      THorse.Get(
        '/mensagens/novas',
        procedure(Req: THorseRequest; Res: THorseResponse)
        begin
          Req.Headers.Field('uid').Required(True);
          Res.Send<TJSONArray>(TConversa.NovasMensagens(Req.Headers.Field('uid').AsInteger, Req.Query.Field('ultima').AsInteger));
        end
      );
      
      THorse.Put(
        '/chamada',
        procedure(Req: THorseRequest; Res: THorseResponse)
        begin
          Req.Headers.Field('uid').Required(True);
          Res.Send<TJSONObject>(TConversa.ChamadaIncluir(Conteudo(Req)));
        end
      );

      THorse.Put(
        '/chamadaevento',
        procedure(Req: THorseRequest; Res: THorseResponse)
        begin
          Req.Headers.Field('uid').Required(True);
          Res.Send<TJSONObject>(TConversa.ChamadaIncluir(Conteudo(Req)));
        end
      );

      THorse.Get(
        '/pesquisar',
        procedure(Req: THorseRequest; Res: THorseResponse)
        begin
          Req.Headers.Field('uid').Required(True);
          Req.Query.Field('usuario').Required(True);
          Res.Send<TJSONArray>(
            TConversa.Pesquisar(
              Req.Query.Field('usuario').AsInteger,
              Req.Query.Field('texto').AsString
          ));
        end
      );

      Writeln('Servidor iniciado na porta: '+ Configuracao.Porta.ToString +' 🚀');
      THorse.Listen(Configuracao.Porta);
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

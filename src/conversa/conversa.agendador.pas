// Eduardo - 19/04/2026
// Worker que notifica mensagens agendadas assim que amadurecem (visivel_em <= now()).
// Roda a cada 60s dentro do processo do servidor.
unit conversa.agendador;

interface

uses
  System.Classes,
  System.SysUtils,
  System.SyncObjs,
  System.Generics.Collections,
  System.DateUtils;

type
  TAgendadorMensagens = class(TThread)
  private
    class var FInstancia: TAgendadorMensagens;
    FEventoParada: TEvent;
    FNotificadas: TDictionary<Integer, TDateTime>;
    procedure ProcessarAmadurecidas;
    procedure LimparExpiradas;
  protected
    procedure Execute; override;
  public
    constructor Create;
    destructor Destroy; override;
    procedure Parar;

    class procedure Iniciar; static;
    class procedure Finalizar; static;
  end;

implementation

uses
  FireDAC.Comp.Client,
  Postgres,
  conversa.api;

const
  // Período do loop.
  IntervaloLoop = 60 * 1000; // 60s

  // Tempo de retenção na lista em memória — precisa ser > IntervaloLoop para evitar dupla notificação
  // entre ticks. Também define a janela em que uma mensagem "já notificada" é lembrada após restart
  // (entradas expiram naturalmente).
  TTLMemoria = 10 * 60 / SecsPerDay; // 10 minutos em TDateTime

  // Janela para trás da consulta: só consideramos mensagens cujo visivel_em está no passado recente.
  // Acima disso presumimos que foram notificadas por uma instância anterior ou estão perdidas — não
  // ressuscitamos notificações muito antigas após downtime longo.
  FenceMinutosPassado = 10;

{ TAgendadorMensagens }

constructor TAgendadorMensagens.Create;
begin
  inherited Create(True); // suspensa; Start explícito
  FreeOnTerminate := False;
  FEventoParada := TEvent.Create(nil, True, False, '');
  FNotificadas := TDictionary<Integer, TDateTime>.Create;
end;

destructor TAgendadorMensagens.Destroy;
begin
  FreeAndNil(FNotificadas);
  FreeAndNil(FEventoParada);
  inherited;
end;

procedure TAgendadorMensagens.Parar;
begin
  Terminate;
  if Assigned(FEventoParada) then
    FEventoParada.SetEvent;
end;

procedure TAgendadorMensagens.Execute;
begin
  NameThreadForDebugging('AgendadorMensagens');
  while not Terminated do
  begin
    try
      ProcessarAmadurecidas;
      LimparExpiradas;
    except
      on E: Exception do
        // Nunca deixa a thread morrer; só loga em stderr.
        Writeln(ErrOutput, '[AgendadorMensagens] ', E.ClassName, ': ', E.Message);
    end;

    if FEventoParada.WaitFor(IntervaloLoop) = wrSignaled then
      Break;
  end;
end;

procedure TAgendadorMensagens.ProcessarAmadurecidas;
var
  Pool: IConnection;
  Qry: TFDQuery;
  iMensagemID: Integer;
  Pendentes: TList<Integer>;
begin
  Pendentes := TList<Integer>.Create;
  try
    Pool := TPool.Instance;
    Qry := TFDQuery.Create(nil);
    try
      Qry.Connection := Pool.Connection;
      Qry.Open(
        ' select id '+
        '   from mensagem '+
        '  where visivel_em is not null '+
        '    and visivel_em <= now() '+
        '    and visivel_em >= now() - interval '''+ FenceMinutosPassado.ToString +' minutes'' '+
        '  order by visivel_em '
      );
      Qry.FetchAll;
      Qry.First;
      while not Qry.Eof do
      begin
        iMensagemID := Qry.FieldByName('id').AsInteger;
        if not FNotificadas.ContainsKey(iMensagemID) then
          Pendentes.Add(iMensagemID);
        Qry.Next;
      end;
    finally
      FreeAndNil(Qry);
    end;

    // Liberar conexão antes de notificar (notificação não precisa do pool).
    Pool := nil;

    for iMensagemID in Pendentes do
    begin
      try
        TConversa.NotificarMensagemAgendada(iMensagemID);
        FNotificadas.AddOrSetValue(iMensagemID, Now);
      except
        on E: Exception do
          Writeln(ErrOutput, '[AgendadorMensagens] Falha notificando mensagem ',
            iMensagemID, ': ', E.ClassName, ' - ', E.Message);
      end;
    end;
  finally
    FreeAndNil(Pendentes);
  end;
end;

procedure TAgendadorMensagens.LimparExpiradas;
var
  Limite: TDateTime;
  Par: TPair<Integer, TDateTime>;
  Remover: TList<Integer>;
begin
  Limite := Now - TTLMemoria;
  Remover := TList<Integer>.Create;
  try
    for Par in FNotificadas do
      if Par.Value < Limite then
        Remover.Add(Par.Key);
    for var ID in Remover do
      FNotificadas.Remove(ID);
  finally
    FreeAndNil(Remover);
  end;
end;

class procedure TAgendadorMensagens.Iniciar;
begin
  if Assigned(FInstancia) then
    Exit;
  FInstancia := TAgendadorMensagens.Create;
  FInstancia.Start;
end;

class procedure TAgendadorMensagens.Finalizar;
begin
  if not Assigned(FInstancia) then
    Exit;
  FInstancia.Parar;
  FInstancia.WaitFor;
  FreeAndNil(FInstancia);
end;

initialization

finalization
  TAgendadorMensagens.Finalizar;

end.

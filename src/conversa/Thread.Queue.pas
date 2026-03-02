// Eduardo/DeepSeek - 21/05/2025
unit Thread.Queue;

interface

uses
  System.Classes,
  System.SysUtils,
  System.Generics.Collections,
  System.SyncObjs;

type
  TThreadQueue = class
  private
    FThread: TThread;
    FQueue: TThreadedQueue<TProc>;
    FEvent: TEvent;
    FStop: Int64;
    FError: TProc<String>;
    procedure Execute;
    constructor Create(Dummy: Integer); overload;
  public
    class procedure Create; overload;
    class procedure Destroy; reintroduce;
    class procedure OnError(AError: TProc<String>);
    class procedure Add(const ATask: TProc);
  end;

implementation

var
  FInstance: TThreadQueue;

{ TThreadQueue }

constructor TThreadQueue.Create(Dummy: Integer);
begin
  inherited Create;
end;

class procedure TThreadQueue.Create;
begin
  if Assigned(FInstance) then
    Exit;
  FInstance := TThreadQueue.Create(0);
  FInstance.FQueue := TThreadedQueue<TProc>.Create(100, 1000, 100);
  FInstance.FEvent := TEvent.Create(nil, False, False, '');
  FInstance.FStop := 0;
  FInstance.FThread := TThread.CreateAnonymousThread(FInstance.Execute);
  FInstance.FThread.FreeOnTerminate := False;
  FInstance.FThread.Start;
end;

class procedure TThreadQueue.Destroy;
begin
  if not Assigned(FInstance) then
    Exit;
  TInterlocked.Add(FInstance.FStop, 1);
  FInstance.FEvent.SetEvent;
  FInstance.FThread.WaitFor;
  FInstance.FThread.Free;
  FInstance.FQueue.Free;
  FInstance.FEvent.Free;
  FreeAndNil(FInstance);
end;

class procedure TThreadQueue.OnError(AError: TProc<String>);
begin
  FInstance.FError := AError;
end;

class procedure TThreadQueue.Add(const ATask: TProc);
begin
  if Assigned(ATask) then
  begin
    FInstance.FQueue.PushItem(ATask);
    FInstance.FEvent.SetEvent;
  end;
end;

procedure TThreadQueue.Execute;
var
  Tarefa: TProc;
  WaitResult: TWaitResult;
begin
  while TInterlocked.Read(FStop) = 0 do
  begin
    WaitResult := FEvent.WaitFor(100);

    if TInterlocked.Read(FStop) <> 0 then
      Break;

    if WaitResult = wrSignaled then
      FEvent.ResetEvent;

    while (FQueue.PopItem(Tarefa) = wrSignaled) and (TInterlocked.Read(FStop) = 0) do
    try
      Tarefa();
    except on E: Exception do
      if Assigned(FError) then
      try
        FError(E.Message);
      except
      end;
    end;
  end;
end;

end.

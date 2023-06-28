program conversa.socket;

{$APPTYPE CONSOLE}

{$R *.res}

uses
  System.SysUtils,
  conversa.tipos in 'conversa.tipos.pas',
  conversa.servidor in 'conversa.servidor.pas';

begin
  {$IFDEF LINUX}
  if fork() <> 0 then
    Exit;
  {$ENDIF}
  try
    with TServidor.Create do
    try
      Start;
      while True do
        Sleep(100);
    finally
      Free;
    end;
  except on E: Exception do
    Writeln(E.ClassName, ': ', E.Message);
  end;
end.

program cript;

{$APPTYPE CONSOLE}

{$R *.res}

uses
  System.SysUtils,
  Conversa.AES;

var
  sTipo: String;
  sTemp: String;
begin
  try
    Writeln('Informe "c" para criptografar e "d" para descriptografar');
    Readln(sTipo);
    if sTipo.ToLower.Equals('c') then
    begin
      Writeln('Informe o texto que será criptografado');
      Readln(sTemp);
      sTemp := Encrypt(sTemp);
    end
    else
    if sTipo.ToLower.Equals('d') then
    begin
      Writeln('Informe o texto que será descriptografado');
      Readln(sTemp);
      sTemp := Decrypt(sTemp);
    end;
  except on E: Exception do
    sTemp := E.Message;
  end;
  Writeln(sTemp);
  Readln;
end.

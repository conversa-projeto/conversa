unit Conversa.AES;

interface

function Encrypt(const Value: String): String;
function Decrypt(const Value: String): String;

implementation

uses
  System.SysUtils,
  System.NetEncoding,
  Prism.Crypto.AES;
var
  IV: TBytes;
  MotherBoardSerial: String;

function GetMotherBoardSerial: String;
var
  a, b, c, d: LongWord;
begin
  asm
    push EAX
    push EBX
    push ECX
    push EDX

    mov eax, 1
    db $0F, $A2
    mov a, EAX
    mov b, EBX
    mov c, ECX
    mov d, EDX

    pop EDX
    pop ECX
    pop EBX
    pop EAX
  end;
  Result := inttohex(a, 8) + inttohex(b, 8) + inttohex(c, 8) + inttohex(d, 8);
end;

function Encrypt(const Value: String): String;
var
  Salt: String;
  ValueBytes, Key: TBytes;
begin
  IV := TEncoding.UTF8.GetBytes('1234567890123456'); // 16 bytes
  MotherBoardSerial := GetMotherBoardSerial;

  if Value.Trim.IsEmpty then
    Exit(Value);

  Salt := TGUID.NewGuid.ToString.Trim(['{', '}', ' ', '-']);
  Key  := TEncoding.UTF8.GetBytes(MotherBoardSerial + Salt);
  ValueBytes := TEncoding.UTF8.GetBytes(Value);
  Result := TNetEncoding.Base64String.Encode(Salt +':'+ TNetEncoding.Base64.EncodeBytesToString(TAES.Encrypt(ValueBytes, Key, 256, IV, cmCBC, pmPKCS7)));
end;

function Decrypt(const Value: String): String;
var
  ValueDecode: String;
  Salt: String;
  ValueBytes, Key: TBytes;
begin
  IV := TEncoding.UTF8.GetBytes('1234567890123456'); // 16 bytes
  MotherBoardSerial := GetMotherBoardSerial;

  if Value.Trim.IsEmpty then
    Exit(Value);

  ValueDecode := TNetEncoding.Base64String.Decode(Value);
  Salt := ValueDecode.Split([':'])[0];
  Key  := TEncoding.UTF8.GetBytes(MotherBoardSerial + Salt);
  ValueBytes := TNetEncoding.Base64.DecodeStringToBytes(ValueDecode.Substring(Salt.Length + 1));
  Result := TEncoding.UTF8.GetString(TAES.Decrypt(ValueBytes, Key, 256, IV, cmCBC, pmPKCS7));
end;

end.

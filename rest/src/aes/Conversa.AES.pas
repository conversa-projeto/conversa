unit Conversa.AES;

interface

function Encrypt(const PrivateKey, Value: String): String;
function Decrypt(const PrivateKey, Value: String): String;

implementation

uses
  System.SysUtils,
  System.NetEncoding,
  Prism.Crypto.AES;

var
  IV: TBytes;

function Encrypt(const PrivateKey, Value: String): String;
var
  Salt: String;
  ValueBytes: TBytes;
  Key: TBytes;
begin
  IV := TEncoding.UTF8.GetBytes('1234567890123456'); // 16 bytes

  if Value.Trim.IsEmpty then
    Exit(Value);

  Salt := TGUID.NewGuid.ToString.Trim(['{', '}', ' ', '-']);
  Key  := TEncoding.UTF8.GetBytes(PrivateKey + Salt);
  ValueBytes := TEncoding.UTF8.GetBytes(Value);
  Result := TNetEncoding.Base64String.Encode(Salt +':'+ TNetEncoding.Base64.EncodeBytesToString(TAES.Encrypt(ValueBytes, Key, 256, IV, cmCBC, pmPKCS7)));
end;

function Decrypt(const PrivateKey, Value: String): String;
var
  ValueDecode: String;
  Salt: String;
  ValueBytes: TBytes;
  Key: TBytes;
begin
  IV := TEncoding.UTF8.GetBytes('1234567890123456'); // 16 bytes

  if Value.Trim.IsEmpty then
    Exit(Value);

  ValueDecode := TNetEncoding.Base64String.Decode(Value);
  Salt := ValueDecode.Split([':'])[0];
  Key  := TEncoding.UTF8.GetBytes(PrivateKey + Salt);
  ValueBytes := TNetEncoding.Base64.DecodeStringToBytes(ValueDecode.Substring(Salt.Length + 1));
  Result := TEncoding.UTF8.GetString(TAES.Decrypt(ValueBytes, Key, 256, IV, cmCBC, pmPKCS7));
end;

end.

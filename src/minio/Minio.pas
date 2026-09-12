// Eduardo - 07/03/2026
unit Minio;

interface

uses
  System.SysUtils,
  System.Classes,
  System.Net.HttpClient,
  System.Hash,
  System.DateUtils,
  System.NetEncoding;

type
  TMinioConfig = record
    Endpoint: String;
    AccessKey: String;
    SecretKey: String;
    Bucket: String;
  end;

  TMinioPresign = class
  private
    class function HmacSHA256(Key: TBytes; Data: String): TBytes;
    class function HexEncode(Bytes: TBytes): String;
    class function GetSignatureKey(Key, DateStamp, Region, Service: String): TBytes;
  public
    class function PresignedURL(Method: String; Config: TMinioConfig; ObjectKey, Region: String; Expires: Integer): String;
  end;

  TMinioHeadObject = class
  public
    class function Exists(Config: TMinioConfig; ObjectKey, Region: String): Boolean;
  end;

  TMinioBucket = class
  public
    // Status HTTP do HEAD no bucket: 200 existe, 404 nao existe, 403 credencial
    // recusada. 0 quando nao houve resposta, com o motivo em Error.
    class function HeadStatus(Config: TMinioConfig; Region: String; out Error: String): Integer;
    // Cria o bucket. True se criou ou se ele ja existia.
    class function MakeBucket(Config: TMinioConfig; Region: String; out Error: String): Boolean;
  end;

implementation

class function TMinioPresign.HexEncode(Bytes: TBytes): String;
begin
  Result := THash.DigestAsString(Bytes);
end;

class function TMinioPresign.HmacSHA256(Key: TBytes; Data: String): TBytes;
begin
  Result := THashSHA2.GetHMACAsBytes(Data, Key, SHA256);
end;

class function TMinioPresign.GetSignatureKey(Key, DateStamp, Region, Service: String): TBytes;
var
  kDate,
  kRegion,
  kService,
  kSigning: TBytes;
begin
  kDate := HmacSHA256(BytesOf('AWS4'+Key), DateStamp);
  kRegion := HmacSHA256(kDate, Region);
  kService := HmacSHA256(kRegion, Service);
  kSigning := HmacSHA256(kService, 'aws4_request');
  Result := kSigning;
end;

class function TMinioPresign.PresignedURL(Method: String; Config: TMinioConfig; ObjectKey, Region: String; Expires: Integer): String;
var
  Endpoint: String;
  Host: String;
  HostAndPath: String;
  PathPrefix: String;
  SlashPos: Integer;
  CanonicalURI: String;
  CanonicalQuery: String;
  CanonicalHeaders: String;
  SignedHeaders: String;
  PayloadHash: String;
  CanonicalRequest: String;
  StringToSign: String;
  Algorithm: String;
  CredentialScope: String;
  DateStamp: String;
  AmzDate: String;
  SigningKey: TBytes;
  Signature: String;
  UTCNow: TDateTime;
begin
  Endpoint := Trim(Config.Endpoint);
  if Endpoint.IsEmpty then
    raise Exception.Create('MinIO endpoint não informado.');

  // força https para evitar Mixed Content no browser
  if Endpoint.StartsWith('http://', True) then
    Endpoint := 'https://' + Copy(Endpoint, Length('http://') + 1, MaxInt)
  else if not Endpoint.StartsWith('https://', True) then
    Endpoint := 'https://' + Endpoint;

  Endpoint := Endpoint.TrimRight(['/']);

  // Separa host:porta do path prefix
  // Ex: https://192.168.100.5:4430/storage → Host=192.168.100.5:4430, PathPrefix=/storage
  // Ex: https://127.0.0.1:9000             → Host=127.0.0.1:9000,     PathPrefix=
  HostAndPath := Endpoint.Replace('https://', '').Replace('http://', '');
  SlashPos := Pos('/', HostAndPath);
  if SlashPos > 0 then
  begin
    Host := Copy(HostAndPath, 1, SlashPos - 1);
    PathPrefix := Copy(HostAndPath, SlashPos, MaxInt).TrimRight(['/']);
  end
  else
  begin
    Host := HostAndPath;
    PathPrefix := '';
  end;

  // CanonicalURI é o path que o MinIO realmente recebe (sem path prefix do nginx)
  CanonicalURI := '/' + Config.Bucket + '/' + ObjectKey;

  UTCNow := TTimeZone.Local.ToUniversalTime(Now);
  DateStamp := FormatDateTime('yyyymmdd', UTCNow);
  AmzDate := FormatDateTime('yyyymmdd"T"hhnnss"Z"', UTCNow);

  Algorithm := 'AWS4-HMAC-SHA256';
  CredentialScope := DateStamp + '/' + Region + '/s3/aws4_request';
  SignedHeaders := 'host';
  CanonicalHeaders := 'host:' + Host + #10;
  PayloadHash := 'UNSIGNED-PAYLOAD';

  CanonicalQuery :=
    'X-Amz-Algorithm=' + Algorithm +
    '&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD' +
    '&X-Amz-Credential=' + TNetEncoding.URL.Encode(Config.AccessKey + '/' + CredentialScope) +
    '&X-Amz-Date=' + AmzDate +
    '&X-Amz-Expires=' + Expires.ToString +
    '&X-Amz-SignedHeaders=' + SignedHeaders;

  CanonicalRequest :=
    Method + #10 +
    CanonicalURI + #10 +
    CanonicalQuery + #10 +
    CanonicalHeaders + #10 +
    SignedHeaders + #10 +
    PayloadHash;

  StringToSign :=
    Algorithm + #10 +
    AmzDate + #10 +
    CredentialScope + #10 +
    LowerCase(THashSHA2.GetHashString(CanonicalRequest));

  SigningKey := GetSignatureKey(Config.SecretKey, DateStamp, Region, 's3');
  Signature := LowerCase(HexEncode(HmacSHA256(SigningKey, StringToSign)));

  // URL pública: inclui o path prefix para o browser acessar via nginx
  // Ex: https://host:4430/storage/chat/key?... (nginx strip /storage/, MinIO recebe /chat/key)
  Result := 'https://' + Host + PathPrefix + CanonicalURI + '?' + CanonicalQuery + '&X-Amz-Signature=' + Signature;
end;

class function TMinioHeadObject.Exists(Config: TMinioConfig; ObjectKey, Region: String): Boolean;
var
  HTTP: THTTPClient;
  Response: IHTTPResponse;
begin
  HTTP := THTTPClient.Create;
  try
    HTTP.ConnectionTimeout := 5000;
    HTTP.ResponseTimeout := 10000;
    try
      Response := HTTP.Head(TMinioPresign.PresignedURL('HEAD', Config, ObjectKey, Region, 60));
      Result := Response.StatusCode = 200;
    except
      Result := False;
    end;
  finally
    HTTP.Free;
  end;
end;

{ TMinioBucket }

class function TMinioBucket.HeadStatus(Config: TMinioConfig; Region: String; out Error: String): Integer;
var
  HTTP: THTTPClient;
begin
  Error := '';
  HTTP := THTTPClient.Create;
  try
    HTTP.ConnectionTimeout := 5000;
    HTTP.ResponseTimeout := 10000;
    try
      // ObjectKey vazio gera /<bucket>/, que o MinIO trata como o proprio bucket
      Result := HTTP.Head(TMinioPresign.PresignedURL('HEAD', Config, '', Region, 60)).StatusCode;
    except on E: Exception do
      begin
        Result := 0;
        Error := E.Message;
      end;
    end;
  finally
    HTTP.Free;
  end;
end;

class function TMinioBucket.MakeBucket(Config: TMinioConfig; Region: String; out Error: String): Boolean;
var
  HTTP: THTTPClient;
  Body: TMemoryStream;
  StatusCode: Integer;
begin
  Error := '';
  HTTP := THTTPClient.Create;
  Body := TMemoryStream.Create;
  try
    HTTP.ConnectionTimeout := 5000;
    HTTP.ResponseTimeout := 10000;
    try
      StatusCode := HTTP.Put(TMinioPresign.PresignedURL('PUT', Config, '', Region, 60), Body).StatusCode;
      // 409: o bucket passou a existir entre a verificacao e a criacao
      Result := (StatusCode = 200) or (StatusCode = 409);
      if not Result then
        Error := 'HTTP ' + StatusCode.ToString;
    except on E: Exception do
      begin
        Result := False;
        Error := E.Message;
      end;
    end;
  finally
    Body.Free;
    HTTP.Free;
  end;
end;

end.

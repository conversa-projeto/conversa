// Eduardo - 07/03/2026
unit Minio.Presign;

interface

uses
  System.SysUtils,
  System.Classes,
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

  Host := Endpoint.Replace('https://', '').Replace('http://', '');
  Host := Host.TrimRight(['/']);

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

  Result := Endpoint + CanonicalURI + '?' + CanonicalQuery + '&X-Amz-Signature=' + Signature;
end;

end.

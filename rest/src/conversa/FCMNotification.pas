// Eduardo & DeepSeek - 18/04/2025
unit FCMNotification;

interface

uses
  System.SysUtils,
  System.Classes,
  System.JSON,
  IdHTTP,
  IdSSLOpenSSL,
  IdURI,
  System.NetEncoding,
  JOSE.Core.JWT,
  JOSE.Core.Builder,
  JOSE.Core.JWK,
  JOSE.Core.JWS,
  JOSE.Core.JWA,
  JOSE.Types.JSON;

type
  TFCMConfig = record
    ProjectID: String;
    ClientEmail: String;
    PrivateKey: String;
  end;

  TFCMNotification = class
  private
    FProjectID: string;
    FPrivateKey: string;
    FClientEmail: string;
    FTokenAcesso: string;
    FTokenExpiration: TDateTime;
    FHttp: TIdHTTP;
    FSSLHandler: TIdSSLIOHandlerSocketOpenSSL;
    procedure ConfigurarHTTP;
    function GerarJWT: string;
    function ObterTokenAcesso: string;
    function IsTokenValido: Boolean;
  public
    constructor Create(const Config: TFCMConfig);
    destructor Destroy; override;
    procedure EnviarNotificacao(const ATokenDispositivo, ATitulo, AMensagem: string; ADadosExtras: TJSONObject = nil);
  end;

var
  FCM: TFCMNotification;

implementation

uses
  System.DateUtils,
  System.Net.HttpClient,
  System.StrUtils,
  System.IOUtils;

const
  GOOGLE_AUTH_URL = 'https://oauth2.googleapis.com/token';
  FCM_API_URL = 'https://fcm.googleapis.com/v1/projects/%s/messages:send';

{ TFCMNotification }

constructor TFCMNotification.Create(const Config: TFCMConfig);
begin
  FProjectID   := Config.ProjectID;
  FPrivateKey  := Config.PrivateKey.Replace('\n', sLineBreak);
  FClientEmail := Config.ClientEmail;

  ConfigurarHTTP;
end;

destructor TFCMNotification.Destroy;
begin
  FreeAndNil(FHttp);
  FreeAndNil(FSSLHandler);
  inherited;
end;

procedure TFCMNotification.ConfigurarHTTP;
begin
  FSSLHandler := TIdSSLIOHandlerSocketOpenSSL.Create(nil);
  FSSLHandler.SSLOptions.SSLVersions := [sslvTLSv1_2];
  
  FHttp := TIdHTTP.Create(nil);
  FHttp.IOHandler := FSSLHandler;
  FHttp.Request.ContentType := 'application/json';
  FHttp.Request.CharSet := 'utf-8';
  FHttp.HTTPOptions := [hoKeepOrigProtocol];
end;

function TFCMNotification.GerarJWT: string;
var
  LJWT: TJWT;
  LSigner: TJWS;
  LKey: TJWK;
begin
  LJWT := TJWT.Create(TJWTClaims);
  try
    // Configurar claims
    LJWT.Claims.Issuer := FClientEmail;
    LJWT.Claims.Audience := GOOGLE_AUTH_URL;
    LJWT.Claims.IssuedAt := Now;
    LJWT.Claims.Expiration := IncHour(Now, 1);
    LJWT.Claims.SetClaimOfType<string>('scope', 'https://www.googleapis.com/auth/firebase.messaging');

    // Criar signer com algoritmo RS256
    LSigner := TJWS.Create(LJWT);
    LKey := TJWK.Create(FPrivateKey);
    try
      LSigner.Sign(LKey, TJOSEAlgorithmId.RS256);
      Result := LSigner.CompactToken;
    finally
      LKey.Free;
      LSigner.Free;
    end;
  finally
    LJWT.Free;
  end;
end;

function TFCMNotification.ObterTokenAcesso: string;
var
  LParams: TStringList;
  LResponse: string;
  LJSON: TJSONObject;
begin
  if IsTokenValido then
    Exit(FTokenAcesso);
    
  LParams := TStringList.Create;
  try
    LParams.Add('grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer');
    LParams.Add('assertion=' + GerarJWT);
    
    FHttp.Request.ContentType := 'application/x-www-form-urlencoded';
    LResponse := FHttp.Post(GOOGLE_AUTH_URL, LParams);
    
    LJSON := TJSONObject.ParseJSONValue(LResponse) as TJSONObject;
    try
      if not Assigned(LJSON) then
        raise Exception.Create('Falha ao obter token de acesso: '+ LResponse);

      FTokenAcesso := LJSON.GetValue('access_token').Value;
      FTokenExpiration := IncSecond(Now, StrToIntDef(LJSON.GetValue('expires_in').Value, 3600));
      Result := FTokenAcesso;
    finally
      LJSON.Free;
    end;
  finally
    LParams.Free;
  end;
end;

function TFCMNotification.IsTokenValido: Boolean;
begin
  Result := not FTokenAcesso.IsEmpty and (Now < FTokenExpiration);
end;

procedure TFCMNotification.EnviarNotificacao(const ATokenDispositivo, ATitulo, AMensagem: string; ADadosExtras: TJSONObject = nil);
var
  LURL: string;
  LRequest, LMessage, LNotification: TJSONObject;
  LRequestBody: TStringStream;
begin
  if not IsTokenValido then
    ObterTokenAcesso;
    
  LURL := Format(FCM_API_URL, [FProjectID]);
  
  LRequest := TJSONObject.Create;
  LMessage := TJSONObject.Create;
  LNotification := TJSONObject.Create;
  try
    LNotification.AddPair('title', ATitulo);
    LNotification.AddPair('body', AMensagem);

    LMessage.AddPair('token', ATokenDispositivo);
    LMessage.AddPair('notification', LNotification);

    if Assigned(ADadosExtras) then
      LMessage.AddPair('data', ADadosExtras);

    LRequest.AddPair('message', LMessage);

    FHttp.Request.CustomHeaders.Clear;
    FHttp.Request.CustomHeaders.AddValue('Authorization', 'Bearer '+ FTokenAcesso);
    FHttp.Request.ContentType := 'application/json';

    LRequestBody := TStringStream.Create(LRequest.ToString, TEncoding.UTF8);
    try
      FHttp.Post(LURL, LRequestBody);
    finally
      LRequestBody.Free;
    end;
  finally
    LRequest.Free;
  end;
end;

end.
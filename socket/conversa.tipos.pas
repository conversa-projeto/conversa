unit conversa.tipos;

interface

uses
  System.SysUtils,
  System.JSON.Serializers,
  IdGlobal;

{$SCOPEDENUMS ON}

type
  TMethod = (Erro, Registrar, AtribuirIdentificador, AtribuirUDP, IniciarChamada, CancelarChamada, ReceberChamada, AtenderChamada, RetomarChamada, RecusarChamada, FinalizarChamada, ChamadasAtivas, FinalizarTodasChamadas);

  TSerializer<T> = class
    class function ParaBytes(const Value: T): TIdBytes;
    class function DeBytes(const Value: TIdBytes): T;
  end;

  TErro = record
    Mensagem: string;
  public
    constructor Create(sMensagem: String);
    class operator Implicit(const Value: TErro): TIdBytes;
    class operator Implicit(const Value: TIdBytes): TErro;
  end;

  TUDP = record
    IP: String;
    Porta: Integer;
  public
    class operator Implicit(const Value: TUDP): TIdBytes;
    class operator Implicit(const Value: TIdBytes): TUDP;
  end;

  TPonta = record
    ID: Integer;
    UDP: TUDP;
    Identificador: String;
  public
    class operator Implicit(const Value: TPonta): TIdBytes;
    class operator Implicit(const Value: TIdBytes): TPonta;
  end;

  TSessao = class
    Ponta: TPonta;
  end;

  TChamada = record
    Remetente: TPonta;
    Destinatario: TPonta;
  public
    class operator Implicit(const Value: TChamada): TIdBytes;
    class operator Implicit(const Value: TIdBytes): TChamada;
  end;

implementation

{ TSerializer<T> }

class function TSerializer<T>.ParaBytes(const Value: T): TIdBytes;
var
  js: TJsonSerializer;
begin
  js := TJsonSerializer.Create;
  try
    Result := IndyTextEncoding_UTF8.GetBytes(js.Serialize<T>(Value));
  finally
    FreeAndNil(js);
  end;
end;

class function TSerializer<T>.DeBytes(const Value: TIdBytes): T;
var
  js: TJsonSerializer;
begin
  js := TJsonSerializer.Create;
  try
    Result := js.Deserialize<T>(IndyTextEncoding_UTF8.GetString(Value));
  finally
    FreeAndNil(js);
  end;
end;

{ TPonta }

class operator TPonta.Implicit(const Value: TIdBytes): TPonta;
begin
  Result := TSerializer<TPonta>.DeBytes(Value);
end;

class operator TPonta.Implicit(const Value: TPonta): TIdBytes;
begin
  Result := TSerializer<TPonta>.ParaBytes(Value);
end;

{ TChamada }

class operator TChamada.Implicit(const Value: TIdBytes): TChamada;
begin
  Result := TSerializer<TChamada>.DeBytes(Value);
end;

class operator TChamada.Implicit(const Value: TChamada): TIdBytes;
begin
  Result := TSerializer<TChamada>.ParaBytes(Value);
end;

{ TErro }

constructor TErro.Create(sMensagem: String);
begin
  Mensagem := sMensagem;
end;

class operator TErro.Implicit(const Value: TIdBytes): TErro;
begin
  Result := TSerializer<TErro>.DeBytes(Value);
end;

class operator TErro.Implicit(const Value: TErro): TIdBytes;
begin
  Result := TSerializer<TErro>.ParaBytes(Value);
end;

{ TUDP }

class operator TUDP.Implicit(const Value: TIdBytes): TUDP;
begin
  Result := TSerializer<TUDP>.DeBytes(Value);
end;

class operator TUDP.Implicit(const Value: TUDP): TIdBytes;
begin
  Result := TSerializer<TUDP>.ParaBytes(Value);
end;

end.

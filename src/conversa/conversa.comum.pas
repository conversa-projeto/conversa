// Eduardo - 26/04/2023
unit conversa.comum;

interface

uses
  System.SysUtils,
  System.StrUtils,
  System.DateUtils,
  System.JSON,
  FireDAC.Comp.Client,
  Postgres;

const
  sl = sLineBreak;

function Qt(const Texto: String): String;
function OpenKey(const ASQL: String): TJSONObject;
function Open(const ASQL: String): TJSONArray;
function InsertJSON(sTabela: String; oJSON: TJSONObject): TJSONObject;
function UpdateJSON(sTabela: String; oJSON: TJSONObject): TJSONObject;
function Delete(sTabela: String; iID: Integer; sField: String = 'id'): TJSONObject;
procedure CamposObrigatorios(oJSON: TJSONObject; aCamposObrigatorios: TArray<String>);

implementation

uses
  Data.DB,
  Horse;

function Qt(const Texto: String): String;
begin
  Result := QuotedStr(Texto);
end;

function OpenKey(const ASQL: String): TJSONObject;
var
  Pool: IConnection;
  Qry: TFDQuery;
  I: Integer;
begin
  Result := TJSONObject.Create;
  Pool := TPool.Instance;
  Qry := TFDQuery.Create(nil);
  try
    Qry.Connection := Pool.Connection;
    Qry.Open(ASQL);
    if Qry.IsEmpty then
      Exit;
    Qry.First;
    for I := 0 to Pred(Qry.FieldCount) do
    begin
      if Qry.Fields[I].IsNull then
        Result.AddPair(Qry.Fields[I].FieldName, TJSONNull.Create)
      else
      if Qry.Fields[I] is TIntegerField then
        Result.AddPair(Qry.Fields[I].FieldName, TJSONNumber.Create(Qry.Fields[I].AsInteger))
      else
      if Qry.Fields[I] is TNumericField then
        Result.AddPair(Qry.Fields[I].FieldName, TJSONNumber.Create(Qry.Fields[I].AsExtended))
      else
      if (Qry.Fields[I] is TDateTimeField) or (Qry.Fields[I] is TSQLTimeStampField) then
        Result.AddPair(Qry.Fields[I].FieldName, DateToISO8601(Qry.Fields[I].AsDateTime))
      else
        Result.AddPair(Qry.Fields[I].FieldName, Qry.Fields[I].AsString);
    end;
  finally
    FreeAndNil(Qry);
  end;
end;

function Open(const ASQL: String): TJSONArray;
var
  Pool: IConnection;
  Qry: TFDQuery;
  oRow: TJSONObject;
  I: Integer;
begin
  Result := TJSONArray.Create;
  Pool := TPool.Instance;
  Qry := TFDQuery.Create(nil);
  try
    Qry.Connection := Pool.Connection;
    Qry.Open(ASQL);
    Qry.First;
    while not Qry.Eof do
    begin
      oRow := TJSONObject.Create;
      Result.Add(oRow);
      for I := 0 to Pred(Qry.FieldCount) do
      begin
        if Qry.Fields[I].IsNull then
          oRow.AddPair(Qry.Fields[I].FieldName, TJSONNull.Create)
        else
        if Qry.Fields[I] is TIntegerField then
          oRow.AddPair(Qry.Fields[I].FieldName, TJSONNumber.Create(Qry.Fields[I].AsInteger))
        else
        if Qry.Fields[I] is TNumericField then
          oRow.AddPair(Qry.Fields[I].FieldName, TJSONNumber.Create(Qry.Fields[I].AsExtended))
        else
        if (Qry.Fields[I] is TDateTimeField) or (Qry.Fields[I] is TSQLTimeStampField) then
          oRow.AddPair(Qry.Fields[I].FieldName, DateToISO8601(Qry.Fields[I].AsDateTime))
        else
          oRow.AddPair(Qry.Fields[I].FieldName, Qry.Fields[I].AsString);
      end;
      Qry.Next;
    end;
  finally
    FreeAndNil(Qry);
  end;
end;

function InsertJSON(sTabela: String; oJSON: TJSONObject): TJSONObject;
var
  sCampo: String;
  sCampos: String;
  sValor: String;
  sValores: String;
  Par: TJSONPair;
  iID: Integer;
begin
  if Assigned(oJSON.FindValue('id')) then
    raise EHorseException.New.Status(THTTPStatus.BadRequest).Error('Campo "id" não permitido na inserção!');

  for Par in oJSON do
  begin
    sCampo := Par.JsonString.Value;

    if Par.JsonValue is TJSONNull then
      sValor := 'null'
    else
    if Par.JsonValue is TJSONNumber then
      sValor := Par.JsonValue.Value
    else
    if Par.JsonValue is TJSONString then
      sValor := Qt(Par.JsonValue.Value);

    sCampos := sCampos + IfThen(not sCampos.IsEmpty, ',') + sCampo;
    sValores := sValores + IfThen(not sValores.IsEmpty, ',') + sValor;
  end;

  iID := TPool.Instance.Connection.ExecSQLScalar(
    sl +'insert '+
    sl +'  into '+ sTabela +
    sl +'     ( '+ sCampos +
    sl +'     ) '+
    sl +'values '+
    sl +'     ( '+ sValores.Replace('\', '\\') +
    sl +'     ) '+
    sl +
    sl +'returning id; '
  );

  Result := OpenKey(
    sl +'select * '+
    sl +'  from '+ sTabela +
    sl +' where id = '+ iID.ToString
  );
end;

function UpdateJSON(sTabela: String; oJSON: TJSONObject): TJSONObject;
var
  sCampos: String;
  sValor: String;
  Par: TJSONPair;
  iID: Integer;
begin
  if not Assigned(oJSON.FindValue('id')) then
    raise EHorseException.New.Status(THTTPStatus.BadRequest).Error('Campo "id" obrigatório para alteração!');

  for Par in oJSON do
  begin
    if Par.JsonString.Value.Equals('id') then
    begin
      iID := TJSONNumber(Par.JsonValue).AsInt;
      Continue;
    end;

    if Par.JsonValue is TJSONNull then
      sValor := 'null'
    else
    if Par.JsonValue is TJSONNumber then
      sValor := Par.JsonValue.Value
    else
    if Par.JsonValue is TJSONString then
      sValor := Qt(Par.JsonValue.Value);

    sCampos := sCampos + IfThen(not sCampos.IsEmpty, ',') + Par.JsonString.Value +' = '+ sValor;
  end;

  Result := OpenKey(
    sl +'update '+ sTabela +
    sl +'   set '+ sCampos +
    sl +' where id = '+ iID.ToString +';'+
    sl +
    sl +'select * '+
    sl +'  from '+ sTabela +
    sl +' where id = '+ iID.ToString
  );
end;

function Delete(sTabela: String; iID: Integer; sField: String = 'id'): TJSONObject;
begin
  Result := OpenKey(
    sl +'select * '+
    sl +'  from '+ sTabela +
    sl +' where '+ sField +' = '+ iID.ToString
  );

  TPool.Instance.Connection.ExecSQL(
    sl +'delete '+
    sl +'  from '+ sTabela +
    sl +' where '+ sField +' = '+ iID.ToString
  );
end;

procedure CamposObrigatorios(oJSON: TJSONObject; aCamposObrigatorios: TArray<String>);
var
  sCampo: String;
begin
  for sCampo in aCamposObrigatorios do
    if not Assigned(oJSON.FindValue(sCampo)) then
      raise EHorseException.New.Status(THTTPStatus.BadRequest).Error('Campo "'+ sCampo +'" é obrigatório e não foi informado!');
end;

end.

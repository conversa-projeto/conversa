# Gera um par usuario/senha temporario para o coturn, no formato que a opcao
# use-auth-secret espera. Serve para testar o relay antes de existir qualquer
# codigo no backend. O endpoint em Delphi fara exatamente este calculo.
#
# Uso:
#   powershell -File gerar-credencial.ps1 -Segredo "o mesmo static-auth-secret"

param(
    [Parameter(Mandatory = $true)]
    [string]$Segredo,

    [int]$ValidadeSegundos = 3600
)

$expira  = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds() + $ValidadeSegundos
$usuario = "${expira}:teste"

$hmac = New-Object System.Security.Cryptography.HMACSHA1
$hmac.Key = [Text.Encoding]::UTF8.GetBytes($Segredo)
$senha = [Convert]::ToBase64String($hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes($usuario)))

Write-Host ""
Write-Host "username:   $usuario"
Write-Host "credential: $senha"
Write-Host "valido ate: $([DateTimeOffset]::FromUnixTimeSeconds($expira).ToLocalTime())"
Write-Host ""
Write-Host "Teste em https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/"
Write-Host "URI: turns:SUA-MAQUINA.SEU-TAILNET.ts.net:8443?transport=tcp"
Write-Host "Deve aparecer pelo menos um candidato do tipo relay."
Write-Host ""

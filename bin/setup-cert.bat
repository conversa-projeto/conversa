@echo off
echo.
echo  ============================================
echo   Conversa - Gerar Certificado HTTPS Local
echo  ============================================
echo.

:: Verifica se mkcert já está instalado
where mkcert >nul 2>&1
if errorlevel 1 (
  echo mkcert nao encontrado. Baixando...
  echo.

  :: Baixa mkcert direto da release do GitHub
  powershell -Command "Invoke-WebRequest -Uri 'https://github.com/FiloSottile/mkcert/releases/download/v1.4.4/mkcert-v1.4.4-windows-amd64.exe' -OutFile 'mkcert.exe'"

  if not exist mkcert.exe (
    echo [ERRO] Falha ao baixar mkcert.
    echo Baixe manualmente em: https://github.com/FiloSottile/mkcert/releases
    pause
    exit /b 1
  )
  set MKCERT=mkcert.exe
) else (
  set MKCERT=mkcert
)

:: Pega o IP local
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /i "IPv4"') do (
  set LOCAL_IP=%%a
  goto :found
)
:found
set LOCAL_IP=%LOCAL_IP: =%

echo IP detectado automaticamente: %LOCAL_IP%
echo.
set /p CONFIRM_IP="Este IP esta correto? (S para sim, ou digite o IP correto): "

if /i not "%CONFIRM_IP%"=="S" (
  if not "%CONFIRM_IP%"=="" set LOCAL_IP=%CONFIRM_IP%
)

echo.
echo Usando IP: %LOCAL_IP%
echo.

:: Instala a CA raiz no sistema (necessário para o navegador confiar)
echo [1/2] Instalando autoridade certificadora local...
%MKCERT% -install

:: Cria pasta cert e gera os certificados
if not exist cert mkdir cert
cd cert

echo.
echo [2/2] Gerando certificado para localhost e %LOCAL_IP%...
..\%MKCERT% -key-file key.pem -cert-file cert.pem localhost 127.0.0.1 %LOCAL_IP%

cd ..

echo.
echo  -------------------------------------------------------
echo   Certificado gerado em ./cert/
echo.
echo   IMPORTANTE: Nos outros computadores da rede voce
echo   precisa aceitar o aviso de seguranca do navegador:
echo   Clique em "Avancado" e depois "Continuar assim mesmo"
echo.
echo   Para confiar automaticamente nos outros PCs, copie
echo   o arquivo rootCA.pem do mkcert e instale como
echo   autoridade confiavel no navegador deles.
echo  -------------------------------------------------------
echo.
pause

@echo off
echo.
echo  ============================================
echo   Conversa - Rede Local (HTTPS)
echo  ============================================
echo.

:: Verifica servidor Delphi
if not exist conversa.rest.exe (
  echo [ERRO] conversa.rest.exe nao encontrado.
  echo Compile o projeto antes de executar este script!
  echo.
  pause
  exit /b 1
)

:: Verifica certificado
if not exist cert\key.pem (
  echo [ERRO] Certificado nao encontrado.
  echo Execute setup-cert.bat primeiro!
  echo.
  pause
  exit /b 1
)

echo [1/2] Iniciando MediaMTX...
start "MediaMTX" cmd /k "mediamtx.exe || (echo MediaMTX nao encontrado nesta pasta & pause)"

timeout /t 2 /nobreak >nul

echo [2/2] Iniciando servidor Conversa (HTTPS)...
echo.
echo  -------------------------------------------------------
echo.
echo   Na primeira vez o navegador vai alertar sobre o
echo   certificado. Clique em "Avancado" e depois em
echo   "Continuar assim mesmo".
echo.
echo  -------------------------------------------------------
echo.

conversa.rest.exe

pause

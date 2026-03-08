@echo off
setlocal

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

:: Verifica Nginx
if not exist nginx\nginx.exe (
  echo [ERRO] nginx\nginx.exe nao encontrado.
  echo.
  pause
  exit /b 1
)

echo [0/4] Parando processos antigos (se existirem)...

:: Tenta parar Nginx de forma graciosa
nginx\nginx.exe -s quit >nul 2>nul

:: Forca parada se ainda estiver rodando
taskkill /F /IM nginx.exe >nul 2>nul
taskkill /F /IM mediamtx.exe >nul 2>nul
taskkill /F /IM conversa.rest.exe >nul 2>nul

timeout /t 1 /nobreak >nul

echo [1/4] Validando configuracao do Nginx...
pushd nginx
nginx.exe -t
if errorlevel 1 (
  popd
  echo [ERRO] Configuracao do Nginx invalida.
  echo.
  pause
  exit /b 1
)
popd

echo [2/4] Iniciando Nginx...
start "Nginx" cmd /k "cd /d nginx && nginx.exe || (echo Falha ao iniciar Nginx & pause)"

timeout /t 1 /nobreak >nul

echo [3/4] Iniciando MediaMTX...
start "MediaMTX" cmd /k "cd /d mediamtx && mediamtx.exe mediamtx.yml || (echo Erro ao iniciar MediaMTX & pause)"

timeout /t 2 /nobreak >nul

echo [4/4] Iniciando servidor Conversa (HTTPS)...
echo.
echo  -------------------------------------------------------
echo   Na primeira vez o navegador pode alertar sobre
echo   certificado. Clique em "Avancado" e continue.
echo  -------------------------------------------------------
echo.

conversa.rest.exe

pause
endlocal

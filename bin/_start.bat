@echo off
set "BASE=%~dp0"
set "BASE=%BASE:~0,-1%"

rem Uso:
rem   _start.bat            desenvolvimento: a pagina vem do Vite (npm run dev)
rem   _start.bat producao   producao: o nginx do compose entrega bin\web

rem O nginx.exe e o mediamtx.exe foram substituidos pelos containers.
taskkill /F /IM nginx.exe >nul 2>&1
taskkill /F /IM mediamtx.exe >nul 2>&1

if /I "%~1"=="producao" (
  docker compose -f "%BASE%\..\docker-compose.yml" --profile producao up -d
) else (
  docker compose -f "%BASE%\..\docker-compose.yml" up -d
)
timeout /t 1 >nul

taskkill /F /IM conversa.rest.exe >nul 2>&1
wt -w 0 new-tab -d "%BASE%" cmd /k conversa.rest.exe
timeout /t 1 >nul

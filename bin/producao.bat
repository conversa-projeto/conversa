@echo off
set "BASE=%~dp0"
set "BASE=%BASE:~0,-1%"

rem Sobe o ambiente de producao: nginx na porta 80, atras da borda, entregando
rem bin\web. Reconstroi a imagem da API com o codigo atual.

set "CONVERSA_MODO=producao"
set "CONVERSA_PORTA=80"
docker compose -f "%BASE%\..\docker-compose.yml" up -d --build

echo.
pause

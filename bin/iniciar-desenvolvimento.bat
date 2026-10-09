@echo off
setlocal
set "BASE=%~dp0"
set "BASE=%BASE:~0,-1%"

rem Sobe o ambiente de desenvolvimento completo sem precisar do VS Code:
rem backend (API, banco, nginx...), container "dev" e o Vite. No fim abre
rem https://localhost. Pode rodar de novo quando quiser: reinicia o Vite.
rem O VS Code continua funcionando igual, no mesmo container.

cd /d "%BASE%\.."

docker info > nul 2>&1
if errorlevel 1 (
  echo.
  echo  O Docker Desktop nao esta aberto. Abra e rode de novo.
  echo.
  pause
  exit /b 1
)

echo  Subindo o backend...
docker compose up -d --build
if errorlevel 1 goto erro

echo  Subindo o container de desenvolvimento...
docker compose -f .devcontainer\docker-compose.yml up -d --build
if errorlevel 1 goto erro

rem Maquina nova: node_modules do container vazio. Na primeira vez instala tudo.
docker exec dev test -x /git/conversa-web/node_modules/.bin/vite
if not errorlevel 1 goto atualizar

echo  Primeira vez neste computador: instalando dependencias, leva alguns minutos...
docker exec -u root dev sh -c "chown -R bun:bun /git/conversa/node_modules /git/conversa-web/node_modules"
if errorlevel 1 goto erro
docker exec -u bun dev sh -c "git config --global --add safe.directory '*' && git config --global core.autocrlf true && cd /git/conversa && bun install --frozen-lockfile && cd /git/conversa-web && bun install --frozen-lockfile"
if errorlevel 1 goto erro
goto vite

:atualizar
rem Pega bibliotecas novas da API e da pagina, se algum package.json mudou
rem (a API roda no container "api", mas a checagem de tipos da pagina e os
rem testes da API no container "dev" usam o node_modules daqui).
echo  Conferindo dependencias...
rem node_modules antigo, do npm, pode ter pastas de outro dono.
docker exec -u root dev sh -c "chown -R bun:bun /git/conversa/node_modules /git/conversa-web/node_modules"
if errorlevel 1 goto erro
docker exec -u bun dev sh -c "cd /git/conversa && bun install --frozen-lockfile && cd /git/conversa-web && bun install --frozen-lockfile"
if errorlevel 1 goto erro

:vite
echo  Iniciando o Vite...
docker exec -d -u bun dev sh -c "pkill -f '[n]ode_modules/.bin/vite'; sleep 1; cd /git/conversa-web && bun run dev > /tmp/vite.log 2>&1"
if errorlevel 1 goto erro

echo  Aguardando https://localhost responder...
set /a TENTATIVAS=0
:esperar
set "STATUS="
for /f %%s in ('%SystemRoot%\System32\curl.exe -sk -m 5 -o nul -w "%%{http_code}" https://localhost/') do set "STATUS=%%s"
if "%STATUS%"=="200" goto pronto
set /a TENTATIVAS+=1
if %TENTATIVAS% GEQ 60 goto semresposta
rem Espera 2 segundos (ping funciona mesmo sem janela de console)
ping -n 3 127.0.0.1 > nul
goto esperar

:pronto
start "" https://localhost
echo.
echo  Ambiente de desenvolvimento no ar: https://localhost
echo  Pode fechar esta janela; tudo continua rodando.
echo.
echo  Log do Vite: docker exec dev tail -f /tmp/vite.log
echo  Log da API:  docker compose logs -f api
echo.
pause
exit /b 0

:semresposta
echo.
echo  O https://localhost nao respondeu em 2 minutos. Veja o log do Vite:
echo    docker exec dev tail -n 50 /tmp/vite.log
echo.
pause
exit /b 1

:erro
echo.
echo  Algo deu errado. Veja a mensagem acima.
echo.
pause
exit /b 1

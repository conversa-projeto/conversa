@echo off
set "BASE=%~dp0"
set "BASE=%BASE:~0,-1%"

rem Sobe o ambiente de desenvolvimento em segundo plano: nginx com HTTPS na 443,
rem pagina do Vite (npm run dev no Dev Container) e API reiniciando sozinha a cada
rem arquivo salvo. Carrega o docker-compose.override.yml automaticamente.
rem Nao precisa ficar aberto. Rode de novo depois de mudar o package.json.

cd /d "%BASE%\.."
docker compose up -d --build

echo.
echo  Ambiente de desenvolvimento no ar. Pode fechar esta janela.
echo  Log da API: docker compose logs -f api
echo.
pause

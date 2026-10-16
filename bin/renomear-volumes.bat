@echo off
set "BASE=%~dp0"
set "BASE=%BASE:~0,-1%"

rem Passa os volumes antigos (pgdata e minio, dos setup-*.bat) para os nomes
rem padronizados do docker-compose.yml: conversa-postgres e conversa-minio.
rem Remove os containers (down sem -v: os volumes ficam), copia os dados,
rem confere a copia (quantidade de arquivos e bytes) e so entao apaga o
rem volume antigo. Volume novo que ja tem dados nao e tocado, e o antigo
rem fica: pode ser um banco criado ao subir a versao nova antes deste script.

docker compose -f "%BASE%\..\docker-compose.yml" down || goto :erro

call :copiar pgdata conversa-postgres || goto :erro
call :copiar minio conversa-minio || goto :erro

echo.
echo Pronto. Suba de novo com o desenvolvimento.bat ou o producao.bat.
pause
exit /b 0

rem Saidas do sh: 0 copiado e conferido, 2 volume novo ja tinha dados,
rem 1 falhou (copia ou conferencia)
:copiar
docker volume inspect %1 >nul 2>&1 || (echo %1 nao existe: nada a copiar. & exit /b 0)
docker volume create %2 >nul || exit /b 1
docker run --rm -v %1:/de:ro -v %2:/para alpine sh -c "if [ -n \"$(ls -A /para)\" ]; then exit 2; fi; cp -a /de/. /para/ || exit 1; a=$(find /de -type f | wc -l); b=$(find /para -type f | wc -l); x=$(find /de -type f -exec stat -c %%s {} + | awk '{s+=$1} END {print s+0}'); y=$(find /para -type f -exec stat -c %%s {} + | awk '{s+=$1} END {print s+0}'); echo \"%1: $a arquivos, $x bytes; %2: $b arquivos, $y bytes\"; [ \"$a\" = \"$b\" ] && [ \"$x\" = \"$y\" ] || exit 1"
if errorlevel 3 exit /b 1
if errorlevel 2 (echo %2 ja tem dados: nao copiado, e %1 fica para voce conferir. & exit /b 0)
if errorlevel 1 (echo A copia de %1 para %2 nao confere: %1 fica. & exit /b 1)
docker volume rm %1 >nul || exit /b 1
echo %1 copiado para %2 e apagado.
exit /b 0

:erro
echo.
echo Falhou: nenhum volume antigo foi apagado sem copia conferida. Confira a mensagem acima.
pause
exit /b 1

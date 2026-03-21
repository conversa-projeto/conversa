@echo off
setlocal

echo [1/5] Parando/removendo container antigo (se existir)...
docker rm -f minio >nul 2>nul

echo [2/5] Iniciando MinIO nas portas internas 9000/9001...
docker run --detach --restart always --name minio -p 9000:9000 -p 9001:9001 -v minio:/data -e MINIO_ROOT_USER=admin -e MINIO_ROOT_PASSWORD=admin123 quay.io/minio/minio server /data --console-address ":9001"

if errorlevel 1 (
  echo [ERRO] Falha ao iniciar MinIO.
  pause
  exit /b 1
)

echo [3/5] Aguardando subir...
timeout /t 5 /nobreak >nul

echo [4/5] Configurando alias mc...
docker exec minio mc alias set local http://127.0.0.1:9000 admin admin123
if errorlevel 1 (
  echo [ERRO] Falha ao configurar alias.
  pause
  exit /b 1
)

echo [5/5] Criando bucket chat (se nao existir)...
docker exec minio mc mb --ignore-existing local/chat
if errorlevel 1 (
  echo [ERRO] Falha ao criar bucket.
  pause
  exit /b 1
)

echo.
echo MinIO pronto:
echo - S3:       http://127.0.0.1:9000
echo - Console:  http://127.0.0.1:9001
echo - Publico:  https://SEU_HOST/storage/
echo.
pause
endlocal

docker run -d --name minio -p 9000:9000 -p 9001:9001 -e MINIO_ROOT_USER=admin -e MINIO_ROOT_PASSWORD=admin123 quay.io/minio/minio server /data --console-address ":9001"

timeout /t 5

docker exec minio mc alias set local http://127.0.0.1:9000 admin admin123

docker exec minio mc mb local/chat

pause
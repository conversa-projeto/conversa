docker volume create pgdata
docker run --detach --restart always --name postgres -p 5432:5432 -v pgdata:/var/lib/postgresql/data --env POSTGRES_PASSWORD=root --env TZ=UTC postgres:15-alpine

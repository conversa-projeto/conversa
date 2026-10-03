# --- Desenvolvimento: Bun com o codigo-fonte ---
# Usado pelo docker-compose.override.yml, que monta src e migracoes da pasta
# do Windows e reinicia a API a cada arquivo salvo.
FROM oven/bun:1-alpine AS desenvolvimento

WORKDIR /app
ENV NODE_ENV=production TZ=UTC

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY migracoes ./migracoes
COPY src ./src

# Volumes do pepper e das gravacoes. Criadas aqui para os volumes nascerem com
# dono bun (uid 1000, o mesmo do MediaMTX).
RUN mkdir /dados /gravacoes && chown bun:bun /dados /gravacoes

EXPOSE 8080
USER bun

# O Bun executa TypeScript direto, sem etapa de build.
CMD ["bun", "src/servidor.ts"]

# --- Compilacao: a API inteira vira um executavel ---
FROM desenvolvimento AS compilacao

RUN bun build src/servidor.ts --compile --minify --sourcemap --outfile /tmp/conversa-api

# --- Producao: so o executavel e as migracoes, sem Bun e sem node_modules ---
FROM alpine:3.22 AS producao

# O executavel do Bun para Alpine depende da biblioteca C++ do sistema.
RUN apk add --no-cache libstdc++ libgcc \
 && addgroup -g 1000 conversa \
 && adduser -D -u 1000 -G conversa conversa \
 && mkdir /dados /gravacoes \
 && chown conversa:conversa /dados /gravacoes

WORKDIR /app
ENV NODE_ENV=production TZ=UTC

COPY --from=compilacao /tmp/conversa-api ./conversa-api
COPY migracoes ./migracoes

EXPOSE 8080
USER conversa

CMD ["./conversa-api"]

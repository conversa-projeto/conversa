# MediaMTX com a pasta das gravacoes ja pertencendo ao uid 1000, o mesmo do
# MediaMTX e da API. O volume conversa-gravacoes nasce com esse dono. A imagem
# oficial nao tem shell, entao a pasta vem pronta de outra etapa.
FROM alpine:3.22 AS pasta
RUN mkdir /gravacoes

FROM bluenviron/mediamtx:1.16.2
COPY --from=pasta --chown=1000:1000 /gravacoes /gravacoes

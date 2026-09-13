FROM node:24-alpine

WORKDIR /app
ENV NODE_ENV=production TZ=UTC

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY migracoes ./migracoes
COPY src ./src

# Volume do pepper. Criada aqui para o volume nascer com dono node.
RUN mkdir /dados && chown node:node /dados

EXPOSE 8080
USER node

# O Node 24 executa TypeScript direto, sem etapa de build.
CMD ["node", "src/servidor.ts"]

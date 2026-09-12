# Conversa - Guia de Setup

Aplicativo de mensagens com chat, chamadas de voz/video (WebRTC) e compartilhamento de arquivos.

## Arquitetura

```
Navegador
   │
   ▼
Vite (desenvolvimento) ou nginx do compose (producao)
   │
   ├── /           → Frontend SPA
   ├── /api/       → Backend Delphi (:8080)
   ├── /ws/        → WebSocket (:9090)
   ├── /storage/   → MinIO S3 (:9000)
   └── /webrtc/    → MediaMTX WebRTC (:8889)
```

Em desenvolvimento o Vite do `conversa-web` serve a pagina com recarregamento instantaneo e faz os repasses. Em producao o nginx roda no `docker-compose.yml` e entrega os arquivos compilados de `bin/web`. As rotas sao as mesmas nos dois.

## Repositorios

| Repositorio | Descricao |
|-------------|-----------|
| `conversa` (este) | Backend Delphi + Docker Compose + configs |
| `conversa-web` (irmao) | Frontend Vue.js (deve estar na mesma pasta pai) |

Estrutura esperada:

```
git/
├── conversa/          ← este repositorio
└── conversa-web/      ← frontend Vue.js
```

---

## Desenvolvimento Local

### Pre-requisitos

- [Delphi](https://www.embarcadero.com/products/delphi) (compilar o backend)
- [Node.js](https://nodejs.org/) >= 18 (frontend)
- [Docker](https://www.docker.com/) (PostgreSQL, MinIO, coturn e MediaMTX)
- Windows (scripts .bat)

### 1. Servicos Docker

```bat
docker compose up -d
```

Sobe, a partir do `docker-compose.yml` na raiz deste repositorio:

| Servico | Funcao | Porta |
|---------|--------|-------|
| `postgres` | PostgreSQL 15 | `127.0.0.1:5432` |
| `minio` | Armazenamento S3 e console | `127.0.0.1:9000`, `127.0.0.1:9001` |
| `coturn` | Retransmissor TURN das chamadas | `3478` TCP |
| `mediamtx` | Servidor WebRTC das chamadas | `127.0.0.1:8889` |

Os dados ficam nos volumes `pgdata` e `minio`. O `docker compose down` para os servicos sem apagar os dados.

O nginx tambem esta no compose, mas so sobe em producao, com `--profile producao`. Em desenvolvimento ele nao e necessario.

coturn e MediaMTX rodam na rede `conversa-rtc` com IPs fixos, `172.30.0.10` e `172.30.0.20`. Nao mude os IPs sem mudar tambem a regra `denied-peer-ip` em `bin/coturn/turnserver.conf`: o coturn so aceita retransmitir para o MediaMTX.

### 2. Senhas dos servicos (opcional)

Sem configuracao, valem as senhas padrao: PostgreSQL `root`, MinIO `admin` / `admin123`. Para trocar, crie um arquivo `.env` ao lado do `docker-compose.yml`:

```ini
POSTGRES_PASSWORD=...
MINIO_ROOT_USER=...
MINIO_ROOT_PASSWORD=...
```

Se trocar as do MinIO, atualize tambem `s3_accesskey` e `s3_secretkey` na tabela `parametros`.

### 3. Certificado HTTPS local

```bat
cd bin
setup-cert.bat
```

Instala a CA local do `mkcert` no Windows e gera um primeiro certificado para `localhost` e o IP da sua maquina. Rode uma unica vez por maquina.

Depois disso o `npm run dev` do frontend mantem o certificado: ele gera um novo com o `mkcert.exe` desta pasta sempre que o atual faltar, estiver perto de vencer ou nao cobrir algum IP da maquina.

### 4. Variaveis de ambiente

Configure as variaveis abaixo no sistema ou no ambiente do Delphi:

| Variavel | Descricao | Exemplo |
|----------|-----------|---------|
| `CONVERSA_DRIVERID` | Driver do banco | `PG` |
| `CONVERSA_SERVER` | Host do PostgreSQL | `localhost` |
| `CONVERSA_METADEFSCHEMA` | Schema | `public` |
| `CONVERSA_DATABASE` | Nome do banco | `conversa` |
| `CONVERSA_USERNAME` | Usuario do banco | `postgres` |
| `CONVERSA_PASSWORD` | Senha do banco | `root` |
| `CONVERSA_BCRYPT_PEPPER` | Salt para senhas | (gere um valor aleatorio) |

### 5. Compilar o backend

Abra `conversa.rest.dproj` no Delphi e compile (F9). O executavel sera gerado em `bin/conversa.rest.exe`.

Na primeira execucao, o backend cria as tabelas automaticamente (migracoes).

A cada inicializacao o backend tambem verifica o bucket do MinIO informado em `s3_bucket` e cria se ele nao existir. Se o MinIO estiver inacessivel ou recusar as credenciais, o console mostra um aviso com o motivo.

### 6. Configurar parametros no banco

Apos a primeira execucao, ajuste os parametros na tabela `parametros`:

```sql
-- Endpoint do MinIO (ajuste o IP/host conforme seu ambiente)
UPDATE parametros SET valor = 'https://192.168.100.6:4430/storage' WHERE nome = 's3_endpoint';

-- Troque as credenciais padrao (IMPORTANTE para producao)
UPDATE parametros SET valor = 'SUA_CHAVE_JWT_SEGURA' WHERE nome = 'jwt_token';
UPDATE parametros SET valor = 'seu_access_key' WHERE nome = 's3_accesskey';
UPDATE parametros SET valor = 'sua_secret_key' WHERE nome = 's3_secretkey';

-- TURN das chamadas. turn_secret e o static-auth-secret de bin/coturn/turnserver.conf
UPDATE parametros SET valor = 'turn:192.168.100.6:3478?transport=tcp' WHERE nome = 'turn_url';
UPDATE parametros SET valor = 'MESMO_VALOR_DO_TURNSERVER_CONF' WHERE nome = 'turn_secret';
```

Com `turn_url` vazio o TURN fica desligado e as chamadas so funcionam em redes que permitam UDP direto. Com `turn_forcar_relay` igual a `1`, que e o padrao, toda a midia passa pelo coturn por TCP.

### 7. Frontend

```bash
cd conversa-web
npm install
npm run dev
```

O Vite sobe em HTTPS na porta 4430, com o certificado de `bin/cert`, e faz os repasses para backend, MinIO e MediaMTX. O certificado e gerado ou renovado automaticamente. Sem a CA do mkcert instalada, ele para pedindo o `setup-cert.bat`.

### 8. Iniciar tudo

```bat
cd bin
_start.bat
```

Isso executa `docker compose up -d` e inicia o backend numa aba do Windows Terminal. O frontend e o `npm run dev` do passo anterior.

### 9. Acessar

Abra no navegador: `https://192.168.100.6:4430`

(substitua pelo IP da sua maquina)

---

## Producao

### Arquitetura em producao

```
Internet
   │
   ▼
nginx EXTERNO (IP publico, porta 443, SSL)
   │  proxy_pass http://IP_INTERNO:80
   ▼
nginx INTERNO (container do compose, porta 80, sem SSL)
   │
   ├── /           → SPA (bin/web/)
   ├── /api/       → Backend (:8080)
   ├── /ws/        → WebSocket (:9090)
   ├── /storage/   → MinIO (:9000)
   └── /webrtc/    → MediaMTX (:8889)
```

### 1. Build do frontend

```bash
cd conversa-web
npm run build
```

Copie o conteudo de `dist/` para `conversa/bin/web/`:

```bash
rm -rf ../conversa/bin/web/*
cp -r dist/* ../conversa/bin/web/
```

### 2. Configurar parametros no banco

```sql
UPDATE parametros SET valor = 'https://conversa.igerp.com/storage' WHERE nome = 's3_endpoint';
```

### 3. Iniciar servicos

```bat
cd bin
_start.bat producao
```

Isso sobe o compose com o perfil `producao`, que inclui o nginx, e inicia o backend. O nginx interno escuta na porta 80 (sem SSL), com a configuracao de `bin/nginx-docker/nginx.conf`. O nginx externo (gerenciado pela equipe de infra) termina o SSL e repassa para ca.

O nginx interno so enxerga o IP real dos clientes pelo cabecalho `X-Forwarded-For` que o nginx externo envia. Acessos diretos a porta 80, sem passar pela borda, aparecem com o IP do gateway do Docker.

As chamadas de audio e video precisam de um segundo encaminhamento: a porta TCP do TURN. Peca ao responsavel pela borda uma porta TCP publica com TLS terminado la e repassada para `IP_DA_MAQUINA_INTERNA:3478`, e grave o endereco em `turn_url`, por exemplo `turns:conversa.igerp.com:8443?transport=tcp`. Sem isso o chat funciona, mas as chamadas nao conectam fora da rede local.

### 4. Configuracao do nginx externo

Passe para o responsavel pelo nginx de producao:

```nginx
server {
    listen 443 ssl;
    server_name conversa.igerp.com;

    ssl_certificate     /caminho/cert.pem;
    ssl_certificate_key /caminho/key.pem;

    client_max_body_size 1024m;

    location / {
        proxy_pass http://IP_DA_MAQUINA_INTERNA:80;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
```

### 5. Checklist de seguranca

- [ ] Alterar `jwt_token` no banco (padrao: `S3RV1D0R_4P1_C0NV3R54`)
- [ ] Alterar credenciais MinIO (padrao: `admin/admin123`) no `.env` e na tabela `parametros`
- [ ] Alterar senha do PostgreSQL (padrao: `root`) no `.env` e em `CONVERSA_PASSWORD`
- [ ] Gerar um novo `static-auth-secret` em `bin/coturn/turnserver.conf` e copiar para `turn_secret`
- [ ] Atualizar `s3_endpoint` para o dominio publico
- [ ] Configurar `CONVERSA_BCRYPT_PEPPER` com valor forte
- [ ] Configurar FCM (parametros `fcm_project_id`, `fcm_client_email`, `fcm_private_key`)

---

## Estrutura de pastas

```
conversa/
├── bin/
│   ├── conversa.rest.exe      # Backend compilado
│   ├── web/                   # Frontend compilado (SPA)
│   ├── nginx-docker/nginx.conf  # Configuracao do nginx de producao
│   ├── mediamtx/
│   │   ├── mediamtx.docker.yml  # Configuracao do MediaMTX usada pelo compose
│   │   └── mediamtx.yml         # Configuracao antiga, para rodar o .exe fora do Docker
│   ├── coturn/
│   │   ├── turnserver.conf      # Configuracao do coturn
│   │   └── gerar-credencial.ps1 # Gera credencial TURN de teste
│   ├── cert/                  # Certificados SSL (local)
│   ├── _start.bat             # Inicia todos os servicos
│   └── setup-cert.bat         # Gera certificado local
├── src/                       # Codigo fonte Delphi
├── docker-compose.yml         # PostgreSQL, MinIO, coturn, MediaMTX e nginx
├── conversa.rest.dpr          # Projeto principal Delphi
└── SETUP.md                   # Este arquivo
```

## Portas dos servicos

| Servico | Porta | Rota |
|---------|-------|------|
| Backend (API) | 8080 | `/api/` |
| WebSocket | 9090 | `/ws/` |
| MinIO S3 | 9000 | `/storage/` |
| MinIO Console | 9001 | - |
| MediaMTX WebRTC | 8889 | `/webrtc/` |
| PostgreSQL | 5432 | - |
| coturn TURN | 3478 TCP | - |
| Vite (dev) | 4430 | ponto de entrada dev |
| nginx (prod) | 80 | ponto de entrada prod |

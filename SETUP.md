# Conversa - Guia de Setup

Aplicativo de mensagens com chat, chamadas de voz/video (WebRTC) e compartilhamento de arquivos.

## Arquitetura

```
Navegador
   │
   ▼
nginx (proxy reverso)
   │
   ├── /           → Frontend SPA (arquivos estaticos)
   ├── /api/       → Backend Delphi (:8080)
   ├── /ws/        → WebSocket (:9090)
   ├── /storage/   → MinIO S3 (:9000)
   └── /webrtc/    → MediaMTX WebRTC (:8889)
```

## Repositorios

| Repositorio | Descricao |
|-------------|-----------|
| `conversa` (este) | Backend Delphi + nginx + configs |
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
- [Docker](https://www.docker.com/) (PostgreSQL e MinIO)
- Windows (scripts .bat)

### 1. PostgreSQL

```bat
cd bin
setup-postgres.bat
```

Isso cria um container Docker com PostgreSQL 15 na porta 5432 (senha: `root`).

### 2. MinIO (armazenamento de arquivos)

```bat
cd bin
setup-minio.bat
```

Cria um container Docker com MinIO nas portas 9000 (S3) e 9001 (console).

### 3. Certificado HTTPS local

```bat
cd bin
setup-cert.bat
```

Gera certificados autoassinados com `mkcert` para `localhost` e o IP da sua maquina.

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

### 6. Configurar parametros no banco

Apos a primeira execucao, ajuste os parametros na tabela `parametros`:

```sql
-- Endpoint do MinIO (ajuste o IP/host conforme seu ambiente)
UPDATE parametros SET valor = 'https://192.168.100.6:4430/storage' WHERE nome = 's3_endpoint';

-- Troque as credenciais padrao (IMPORTANTE para producao)
UPDATE parametros SET valor = 'SUA_CHAVE_JWT_SEGURA' WHERE nome = 'jwt_token';
UPDATE parametros SET valor = 'seu_access_key' WHERE nome = 's3_accesskey';
UPDATE parametros SET valor = 'sua_secret_key' WHERE nome = 's3_secretkey';
```

### 7. Frontend

```bash
cd conversa-web
npm install
npm run dev
```

O Vite sobe na porta 5173. Voce nao acessa diretamente - use o nginx.

### 8. Iniciar tudo

```bat
cd bin
_start.bat
```

Isso inicia nginx, MediaMTX e o backend em abas separadas do Windows Terminal.

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
nginx INTERNO (sua maquina, porta 80, sem SSL)
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
_start.bat
```

O nginx interno escuta na porta 80 (sem SSL). O nginx externo (gerenciado pela equipe de infra) termina o SSL e repassa para ca.

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
- [ ] Alterar credenciais MinIO (padrao: `admin/admin123`)
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
│   ├── nginx/conf/nginx.conf  # Configuracao do nginx
│   ├── mediamtx/mediamtx.yml  # Configuracao do MediaMTX
│   ├── cert/                  # Certificados SSL (local)
│   ├── _start.bat             # Inicia todos os servicos
│   ├── setup-cert.bat         # Gera certificado local
│   ├── setup-minio.bat        # Configura MinIO via Docker
│   └── setup-postgres.bat     # Configura PostgreSQL via Docker
├── src/                       # Codigo fonte Delphi
├── conversa.rest.dpr          # Projeto principal Delphi
└── SETUP.md                   # Este arquivo
```

## Portas dos servicos

| Servico | Porta | Rota nginx |
|---------|-------|------------|
| Backend (API) | 8080 | `/api/` |
| WebSocket | 9090 | `/ws/` |
| MinIO S3 | 9000 | `/storage/` |
| MinIO Console | 9001 | - |
| MediaMTX WebRTC | 8889 | `/webrtc/` |
| nginx (dev) | 4430 | ponto de entrada dev |
| nginx (prod) | 80 | ponto de entrada prod |
| Vite (dev) | 5173 | acessado via nginx |

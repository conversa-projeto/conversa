# Conversa - Setup

Os dois repositorios precisam estar lado a lado:

```
git/
├── conversa/        ← API, Docker e scripts
└── conversa-web/    ← pagina
```

Desenvolvimento e producao usam o mesmo nginx, com as mesmas rotas. A diferenca: em desenvolvimento ele tem o certificado HTTPS e pega a pagina do Vite; em producao o certificado fica na borda e ele entrega a pagina compilada.

---

## Desenvolvimento

### Precisa ter

- Docker Desktop aberto
- VS Code com a extensao **Dev Containers**

### Primeira vez

1. **Certificado HTTPS:** duplo-clique em `bin\setup-cert.bat` e digite o IP da sua maquina.
2. **Backend:** duplo-clique em `bin\desenvolvimento.bat`. Ele sobe tudo em segundo plano; quando aparecer "Ambiente de desenvolvimento no ar", pode fechar a janela.
3. **VS Code:** abra a pasta `conversa`, aperte `F1` e escolha **Dev Containers: Reopen in Container**. Na primeira vez demora alguns minutos. Quando ele conecta, o Vite sobe sozinho numa aba de terminal.
4. **Acesse:** `https://SEU_IP`. Na propria maquina, `https://localhost` tambem funciona.

Nao ha nada para configurar: banco, pepper das senhas, chave dos logins, credenciais do MinIO e segredo do TURN sao criados sozinhos na primeira subida. Anexos e chamadas usam o mesmo endereco que voce abriu no navegador.

### Dia a dia

Abrir a pasta `conversa` no VS Code. Ele ja abre no container e sobe o Vite sozinho.

Os containers voltam sozinhos quando o Docker Desktop abre, e a API reinicia sozinha a cada arquivo salvo em `src` ou `migracoes`. Rode o `bin\desenvolvimento.bat` de novo so depois de mudar o `package.json` da API ou se tiver parado tudo.

Se o IP da maquina mudar, rode de novo o `setup-cert.bat` e depois `docker restart nginx`.

### Parar

Fechar o VS Code para o Vite. Para parar os containers, `docker compose down` na pasta `conversa`. Os dados continuam salvos.

---

## Producao

### Precisa ter

- Docker na maquina do servidor
- Um nginx de borda com HTTPS repassando para `IP_DA_MAQUINA:80` (configuracao abaixo)
- Uma porta TCP publica na borda, com TLS, repassada para `IP_DA_MAQUINA:3478`, para as chamadas

### Passos

1. **Pagina compilada:** no terminal do Dev Container, gere o build e copie para `bin/web`:

   ```bash
   cd /git/conversa-web && npm run build && rm -rf /git/conversa/bin/web/* && cp -r dist/* /git/conversa/bin/web/
   ```

2. **Porta das chamadas:** crie um arquivo `.env` na pasta `conversa` com a porta TCP publica da borda:

   ```ini
   CONVERSA_TURN_PORTA=8443
   ```

3. **Subir:** duplo-clique em `bin\producao.bat`. Sobe tudo, com o nginx na porta 80.

4. **Backup:** inclua os volumes `pgdata` (banco), `minio` (anexos) e `conversa-dados` (pepper das senhas, credenciais do MinIO e segredo do TURN). Sem o `conversa-dados`, nenhum login confere.

### nginx de borda

Passe para o responsavel pela borda:

```nginx
server {
    listen 443 ssl;
    server_name SEU_DOMINIO;

    ssl_certificate     /caminho/cert.pem;
    ssl_certificate_key /caminho/key.pem;

    client_max_body_size 1024m;

    location / {
        proxy_pass http://IP_DA_MAQUINA:80;
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

A porta das chamadas (a mesma do `CONVERSA_TURN_PORTA`) precisa de TLS terminado na borda e repasse TCP para `IP_DA_MAQUINA:3478`.

---

## Consultas uteis

Rode num terminal na pasta `conversa`.

| Para | Comando |
|------|---------|
| Ver o log da API | `docker compose logs -f api` |
| Conectar um cliente ao banco | `127.0.0.1:5433`, usuario `postgres`, banco `conversa` (a 5432 fica livre para um PostgreSQL da maquina) |
| Usuario e senha do console do MinIO (`http://localhost:9001`) | `docker exec minio cat /dados/minio-usuario /dados/minio-senha` |
| Parar tudo sem apagar dados | `docker compose down` |

## Transcricao de audio

As mensagens de audio ganham um botao **Transcrever**. O texto fica salvo na tabela `anexo_transcricao` e aparece abaixo do player para todos da conversa. Quem faz a transcricao e o [transcritor-api](../transcritor-api), sempre com um unico falante.

Fica desligada ate informar o endereco do transcritor. Com ele rodando na mesma maquina (porta 8000), entre no banco (`docker exec -it postgres psql -U postgres -d conversa`) e rode:

```sql
update parametros set valor = 'http://host.docker.internal:8000' where nome = 'transcritor_url';
update parametros set valor = 'pt' where nome = 'transcritor_idioma';  -- idioma padrao
```

Depois reinicie a API: `docker restart api`.

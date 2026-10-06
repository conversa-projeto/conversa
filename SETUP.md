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

Sem o VS Code: duplo-clique em `bin\iniciar-desenvolvimento.bat`. Ele sobe o backend, o container de desenvolvimento e o Vite, instala as dependencias se for a primeira vez e abre `https://localhost` quando estiver pronto.

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
   cd /git/conversa-web && bun run build && rm -rf /git/conversa/bin/web/* && cp -r dist/* /git/conversa/bin/web/
   ```

2. **Porta das chamadas:** crie um arquivo `.env` na pasta `conversa` com a porta TCP publica da borda:

   ```ini
   CONVERSA_TURN_PORTA=8443
   ```

3. **Subir:** duplo-clique em `bin\producao.bat`. Sobe tudo, com o nginx na porta 80.

4. **Backup:** inclua os volumes `pgdata` (banco), `minio` (anexos) e `conversa-dados` (pepper das senhas, credenciais do MinIO e segredo do TURN). Sem o `conversa-dados`, nenhum login confere. Se as gravacoes das chamadas precisarem de copia, inclua tambem o `conversa-gravacoes` (veja [Gravacao das chamadas](#gravacao-das-chamadas)).

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

## Testes

Com o Docker no ar, rode na pasta `conversa`:

```bash
bun run test
```

Com o relatorio de cobertura, que falha se algum arquivo ficar abaixo do minimo do `bunfig.toml`:

```bash
bun run test:cobertura
```

Os testes chamam as rotas da API sem subir o servidor, e o WebSocket numa porta livre, com clientes de verdade. O que eles usam:

- **Banco:** `conversa_teste`, no mesmo PostgreSQL (`127.0.0.1:5433`), apagado e recriado com as migracoes a cada execucao. O banco `conversa` nunca e tocado. Se a senha do PostgreSQL nao for a padrao, informe em `POSTGRES_PASSWORD`.
- **MinIO:** o do Docker, com o bucket `conversa-teste`, criado no inicio e apagado no fim. As credenciais sao lidas do container por `docker exec` (ou informadas em `CONVERSA_TESTE_MINIO_USUARIO` e `CONVERSA_TESTE_MINIO_SENHA`). Os envios passam pelo nginx, como no navegador.
- **Pasta de dados:** uma pasta temporaria no lugar do volume `/dados`, pela variavel `CONVERSA_DADOS`. O pepper e gerado nela.
- **Push:** o envio ao Firebase e trocado por um falso, que so registra.
- **Transcricao:** um transcritor falso, subido pelo proprio teste.

Levam cerca de 40 segundos. O hash das senhas usa o custo minimo do bcrypt nos testes (`tests/preparar.ts`); com o de producao levariam uns 3 minutos.

Testes marcados com `test.failing` sao falhas conhecidas da API, com a explicacao no comentario: passam enquanto o problema existe e passam a acusar quando ele for corrigido, lembrando de tirar a marca.

## Configuracoes e permissoes

Os parametros do sistema (Firebase, TURN, transcricao, dias das gravacoes) se mudam no app, em **Configuracoes > Sistema**, e valem ao salvar, sem reiniciar a API. Quem pode mexer e definido em **Configuracoes > Acessos**: cada usuario recebe ou nao as permissoes `parametros` (aba Sistema) e `permissoes` (aba Acessos). Sem nenhuma delas, as abas nem aparecem, e a API recusa (403).

Numa instalacao nova, enquanto ninguem tem a permissao `permissoes`, **todos os usuarios tem todas as permissoes** (modo aberto, com aviso na aba Acessos). Logo depois de instalar, entre com o seu usuario, abra **Configuracoes > Acessos** e marque as duas permissoes para voce: o modo aberto acaba na hora. Ate la, qualquer um que se cadastrar pode mexer nas configuracoes.

A API nao deixa tirar a permissao `permissoes` de quem e o ultimo a te-la, entao o modo aberto nao volta sem querer. Se ainda assim ninguem conseguir entrar em Acessos, conceda todas pelo banco, na pasta deste repositorio:

```bat
docker exec -i postgres psql -U postgres -d conversa -v login=fulano < bin\conceder-permissoes.sql
```

## Transcricao de audio

As mensagens de audio ganham um botao **Transcrever**. O texto fica salvo na tabela `anexo_transcricao` e aparece abaixo do player para todos da conversa. Quem faz a transcricao e a versao Windows do [transcritor-api](../transcritor-api/windows), na GPU, sem separacao por falante.

Instale pelo `instalar.bat` da pasta `transcritor-api\windows` e suba com:

```bat
iniciar.bat -Endereco 0.0.0.0
```

O `-Endereco 0.0.0.0` e obrigatorio: sem ele o transcritor so aceita conexoes da propria maquina, e a API, dentro do Docker, nao chega nele. A porta padrao e a 8000 (`-Porta` troca).

Fica desligada ate informar o endereco do transcritor em **Configuracoes > Sistema**. Com ele rodando na mesma maquina, o endereco e `http://host.docker.internal:8000`, e o idioma padrao, `pt`.

## Gravacao das chamadas

Toda chamada e gravada para auditoria: audio e video (camera ou tela) de cada participante, num arquivo proprio. O app nao mostra as gravacoes e nao avisa os participantes.

- Quem grava e o MediaMTX, pelo qual passa a midia de todos (`bin/mediamtx/mediamtx.docker.yml`, caminhos `call-*`). O navegador nao consegue evitar a gravacao.
- Os arquivos ficam no volume `conversa-gravacoes`, em `/gravacoes/call-<chamada>-u-<usuario>/<data e hora>.mp4` (fMP4, um arquivo por hora de chamada). O usuario e o `id` da tabela `usuario` e a chamada o `id` da tabela `chamada`.
- O video sai em H264 (ou VP9, em navegador sem H264). VP8, o padrao dos navegadores, nao e gravado pelo MediaMTX.
- A API apaga, a cada hora, as gravacoes mais antigas que o parametro `gravacao_dias` (padrao 90; 0 guarda para sempre), que se muda em **Configuracoes > Sistema**.

Para ouvir uma gravacao, copie o arquivo do volume e abra em qualquer player (VLC, navegador):

```bat
docker run --rm -v conversa-gravacoes:/g -v "%cd%":/saida alpine cp -r /g/call-42-u-7 /saida
```

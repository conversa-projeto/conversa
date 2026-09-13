# Conversa - Servidor

O Conversa é um serviço de mensagens instantâneas aberto. Os usuários podem enviar mensagens e trocar fotos, vídeos, áudios e arquivos de qualquer tipo, além de fazer chamadas de voz e vídeo. Também permite uso empresarial com gerenciamento de acessos de usuários.

Este repositório contém a API em Node com Fastify e PostgreSQL, e toda a infraestrutura em Docker Compose: banco, armazenamento de arquivos, servidor WebRTC, retransmissor TURN e o nginx de produção. O guia completo de instalação está em [SETUP.md](./SETUP.md).

## Início rápido

```bash
docker compose watch
```

Sobe todos os serviços e reinicia a API a cada arquivo salvo em `src/`. O pepper das senhas é gerado na primeira execução e fica em `/dados/pepper`, no volume `conversa-dados`.

## Ecossistema
- <img src="https://cdn-icons-png.flaticon.com/512/9168/9168253.png" width="20" height="20" style="float:left;"> [Servidor](https://github.com/conversa-projeto/conversa)
- <img src="https://cdn-icons-png.flaticon.com/512/270/270780.png" width="20" height="20" style="float:left;"> [Cliente - Android - FMX](https://github.com/conversa-projeto/conversa-android-fmx)
- <img src="https://cdn-icons-png.flaticon.com/512/906/906308.png" width="20" height="20" style="float:left;"> [Cliente - Windows - FMX](https://github.com/conversa-projeto/conversa-windows-fmx)

## 💻 Contribuíntes de Código

<a href="https://github.com/conversa-projeto/conversa/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=conversa-projeto/conversa" />
</a>

## ⚠️ Licença

`Conversa` é um software gratuito e de código aberto licenciado sob a [MIT License](./LICENSE).

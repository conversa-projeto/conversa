# Container de desenvolvimento: Bun, git (para o VS Code) e sudo/pkill (usados
# pelo devcontainer.json e pelo bin\iniciar-desenvolvimento.bat). O usuario
# bun tem uid 1000, o mesmo dono dos volumes de node_modules.
FROM oven/bun:1

RUN apt-get update \
 && apt-get install -y --no-install-recommends git sudo procps ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && echo 'bun ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/bun

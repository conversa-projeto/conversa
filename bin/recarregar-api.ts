// Desenvolvimento: roda a API e reinicia quando algum arquivo de src ou
// migracoes muda. Confere por polling, porque a pasta vem do Windows e nao
// avisa as mudancas para dentro do container (por isso nao da para usar o
// bun --watch). Usado pelo docker-compose.override.yml; em producao a API roda
// direto.
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { Subprocess } from 'bun'

const PASTAS = ['src', 'migracoes']

let api: Subprocess
let reiniciando = false

function assinatura(): string {
  let resultado = ''
  for (const pasta of PASTAS) {
    for (const nome of readdirSync(pasta, { recursive: true, encoding: 'utf8' })) {
      const caminho = join(pasta, nome)
      const info = statSync(caminho, { throwIfNoEntry: false })
      if (info?.isFile()) {
        resultado += `${caminho}:${info.mtimeMs}:${info.size};`
      }
    }
  }
  return resultado
}

function iniciar(): void {
  reiniciando = false
  api = Bun.spawn([process.execPath, 'src/servidor.ts'], { stdio: ['inherit', 'inherit', 'inherit'] })
}

const rodando = (): boolean => api.exitCode === null && api.signalCode === null

let atual = assinatura()
iniciar()

setInterval(() => {
  const nova = assinatura()
  if (nova === atual || reiniciando) {
    return
  }
  atual = nova
  console.log('\n↻ Arquivo alterado, reiniciando a API...\n')
  if (!rodando()) {
    iniciar()
    return
  }
  reiniciando = true
  void api.exited.then(iniciar)
  api.kill('SIGTERM')
}, 1000)

for (const sinal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sinal, () => {
    if (!rodando()) {
      process.exit(0)
    }
    void api.exited.then(() => process.exit(0))
    api.kill(sinal)
  })
}

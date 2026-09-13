// Desenvolvimento: roda a API e reinicia quando algum arquivo de src ou
// migracoes muda. Confere por polling, porque a pasta vem do Windows e nao
// avisa as mudancas para dentro do container. Usado pelo
// docker-compose.override.yml; em producao a API roda direto.
import { spawn } from 'node:child_process'
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const PASTAS = ['src', 'migracoes']

let api
let reiniciando = false

function assinatura() {
  let resultado = ''
  for (const pasta of PASTAS) {
    for (const nome of readdirSync(pasta, { recursive: true })) {
      const caminho = join(pasta, nome)
      const info = statSync(caminho, { throwIfNoEntry: false })
      if (info?.isFile()) {
        resultado += `${caminho}:${info.mtimeMs}:${info.size};`
      }
    }
  }
  return resultado
}

function iniciar() {
  reiniciando = false
  api = spawn(process.execPath, ['src/servidor.ts'], { stdio: 'inherit' })
}

let atual = assinatura()
iniciar()

setInterval(() => {
  const nova = assinatura()
  if (nova === atual || reiniciando) {
    return
  }
  atual = nova
  console.log('\n↻ Arquivo alterado, reiniciando a API...\n')
  if (api.exitCode !== null || api.signalCode !== null) {
    iniciar()
    return
  }
  reiniciando = true
  api.once('exit', iniciar)
  api.kill('SIGTERM')
}, 1000)

for (const sinal of ['SIGTERM', 'SIGINT']) {
  process.on(sinal, () => {
    if (api.exitCode !== null || api.signalCode !== null) {
      process.exit(0)
    }
    api.once('exit', () => process.exit(0))
    api.kill(sinal)
  })
}

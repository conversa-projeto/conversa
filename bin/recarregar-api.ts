// Desenvolvimento: roda a API e reinicia quando algum arquivo de src ou
// migracoes muda. Confere por polling, porque a pasta vem do Windows e nao
// avisa as mudancas para dentro do container (por isso nao da para usar o
// bun --watch). Usado pelo docker-compose.override.yml; em producao a API roda
// direto.
//
// Se a API cair sozinha (por exemplo, o banco ainda subindo quando o Docker
// inicia, porque o restart: always ignora o depends_on), sobe de novo depois
// de alguns segundos. Se a pasta do Windows falhar na leitura (OneDrive
// sincronizando), ignora aquela conferencia e tenta na proxima.
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { Subprocess } from 'bun'

const PASTAS = ['src', 'migracoes']

let api: Subprocess
let reiniciando = false

function assinatura(): string | null {
  let resultado = ''
  try {
    for (const pasta of PASTAS) {
      for (const nome of readdirSync(pasta, { recursive: true, encoding: 'utf8' })) {
        const caminho = join(pasta, nome)
        const info = statSync(caminho, { throwIfNoEntry: false })
        if (info?.isFile()) {
          resultado += `${caminho}:${info.mtimeMs}:${info.size};`
        }
      }
    }
  } catch (erro) {
    console.error('⚠  Falha ao ler as pastas, tentando de novo:', erro instanceof Error ? erro.message : erro)
    return null
  }
  return resultado
}

let encerrando = false

function iniciar(): void {
  reiniciando = false
  const processo = Bun.spawn([process.execPath, 'src/servidor.ts'], { stdio: ['inherit', 'inherit', 'inherit'] })
  api = processo
  void processo.exited.then(() => {
    if (api !== processo || reiniciando || encerrando) {
      return
    }
    console.log('\n↻ A API parou, subindo de novo em 3 segundos...\n')
    setTimeout(() => {
      if (api === processo && !reiniciando && !encerrando) {
        iniciar()
      }
    }, 3000)
  })
}

const rodando = (): boolean => api.exitCode === null && api.signalCode === null

let atual = assinatura()
iniciar()

setInterval(() => {
  const nova = assinatura()
  if (nova === null || nova === atual || reiniciando) {
    return
  }
  if (atual === null) {
    atual = nova
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
    encerrando = true
    if (!rodando()) {
      process.exit(0)
    }
    void api.exited.then(() => process.exit(0))
    api.kill(sinal)
  })
}

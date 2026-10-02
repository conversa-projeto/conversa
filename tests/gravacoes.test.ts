import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apagarGravacoesVencidas } from '../src/gravacoes.ts'
import { noBanco } from './api.ts'

const DIA = 24 * 60 * 60 * 1000
const agora = Date.parse('2026-10-01T12:00:00Z')
let pasta: string

// Arquivo gravado pelo MediaMTX, com a data da última escrita
function gravacao(caminho: string, diasAtras: number) {
  const arquivo = join(pasta, caminho)
  mkdirSync(join(arquivo, '..'), { recursive: true })
  writeFileSync(arquivo, 'mp4')
  const quando = new Date(agora - diasAtras * DIA)
  utimesSync(arquivo, quando, quando)
  return arquivo
}

beforeEach(() => (pasta = mkdtempSync(join(tmpdir(), 'conversa-gravacoes-'))))
afterEach(() => rmSync(pasta, { recursive: true, force: true }))

describe('limpeza das gravações das chamadas', () => {
  test('apaga as mais antigas que o prazo e as pastas que ficam vazias', async () => {
    const velha = gravacao('call-1-u-7/2026-06-01_10-00-00-000000.mp4', 91)
    const nova = gravacao('call-1-u-7/2026-09-30_10-00-00-000000.mp4', 1)
    const chamadaVelha = gravacao('call-2-u-8/2026-05-01_10-00-00-000000.mp4', 150)
    const noLimite = gravacao('call-3-u-9/2026-07-03_12-00-00-000000.mp4', 89.9)
    expect(await apagarGravacoesVencidas(pasta, 90, agora)).toBe(2)
    expect(existsSync(velha)).toBe(false)
    expect(existsSync(nova)).toBe(true)
    expect(existsSync(noLimite)).toBe(true)
    expect(existsSync(chamadaVelha)).toBe(false)
    expect(existsSync(join(pasta, 'call-2-u-8'))).toBe(false)
    expect(existsSync(join(pasta, 'call-1-u-7'))).toBe(true)
    // A pasta das gravações continua, mesmo vazia
    expect(await apagarGravacoesVencidas(pasta, 1, agora + 400 * DIA)).toBe(2)
    expect(existsSync(pasta)).toBe(true)
  })

  test('0 dias guarda para sempre', async () => {
    const velha = gravacao('call-1-u-7/antiga.mp4', 5000)
    expect(await apagarGravacoesVencidas(pasta, 0, agora)).toBe(0)
    expect(existsSync(velha)).toBe(true)
  })

  test('pasta que ainda não existe (nada gravado) não é erro', async () => {
    expect(await apagarGravacoesVencidas(join(pasta, 'nao-existe'), 90, agora)).toBe(0)
  })

  test('migração cria o parâmetro com 90 dias', async () => {
    const [linha] = await noBanco((sql) => sql<{ valor: string }[]>`select valor from parametros where nome = 'gravacao_dias'`)
    expect(linha?.valor).toBe('90')
  })
})

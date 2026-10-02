import { readdir, rm, rmdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

const DIA_MS = 24 * 60 * 60 * 1000

// Apaga as gravacoes das chamadas mais antigas que o prazo, pela data da ultima
// escrita do arquivo, e as pastas que ficarem vazias. A pasta de cada chamada
// e criada pelo MediaMTX (call-<chamada>-u-<usuario>). Devolve quantos
// arquivos apagou. Pasta inexistente (MediaMTX ainda sem gravar) nao e erro.
export async function apagarGravacoesVencidas(pasta: string, dias: number, agora = Date.now()): Promise<number> {
  if (dias <= 0) return 0
  const limite = agora - dias * DIA_MS
  return apagarDentro(pasta, limite, true)
}

async function apagarDentro(pasta: string, limite: number, raiz: boolean): Promise<number> {
  let entradas
  try {
    entradas = await readdir(pasta, { withFileTypes: true })
  } catch (erro) {
    if ((erro as NodeJS.ErrnoException).code === 'ENOENT') return 0
    throw erro
  }
  let apagados = 0
  for (const entrada of entradas) {
    const caminho = join(pasta, entrada.name)
    if (entrada.isDirectory()) {
      apagados += await apagarDentro(caminho, limite, false)
    } else if ((await stat(caminho)).mtimeMs < limite) {
      await rm(caminho)
      apagados++
    }
  }
  if (!raiz && (await readdir(pasta)).length === 0) await rmdir(pasta)
  return apagados
}

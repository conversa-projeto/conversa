import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { comUsuario, executarScript } from './banco.ts'

// Pasta migracoes ao lado de onde a API roda (/app no Docker). Nao sai do
// import.meta.url porque no binario compilado ele aponta para dentro do executavel.
const PASTA = join(process.cwd(), 'migracoes')

// Cada arquivo NNN.sql e uma versao. A versao aplicada fica em parametros.versao.
// As pendentes rodam juntas num unico script.
export async function executarMigracoes() {
  await executarScript(
    `create table if not exists parametros
          ( nome varchar(50) not null
          , valor varchar(500) not null
          , constraint parametros_nome_key unique (nome)
          );`,
  )

  const versaoAtual = await comUsuario(0, async (sql) => {
    const [registro] = await sql<{ versao: number }[]>`select cast(valor as int) as versao from parametros where nome = 'versao'`
    if (registro) {
      return registro.versao
    }
    await sql`insert into parametros (nome, valor) values ('versao', '-1')`
    return -1
  })

  const arquivos = readdirSync(PASTA).filter((nome) => /^\d{3}\.sql$/.test(nome)).sort()
  const ultimaVersao = arquivos.length - 1
  const pendentes = arquivos.slice(versaoAtual + 1)
  if (!pendentes.length) {
    return
  }

  const script = pendentes.map((nome) => readFileSync(join(PASTA, nome), 'utf8')).join('\n')
  await executarScript(`${script}\nupdate parametros set valor = '${ultimaVersao}' where nome = 'versao';`)
  console.log(`Migrações aplicadas até a versão ${ultimaVersao}`)
}

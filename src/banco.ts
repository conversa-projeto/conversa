import postgres from 'postgres'
import type { ConfigBanco } from './configuracao.ts'

export type Sql = postgres.Sql<any>
export type Linha = Record<string, any>
export type Fragmento = postgres.PendingQuery<any>

let sql: Sql

export function iniciarBanco(config: ConfigBanco) {
  sql = postgres({
    host: config.host,
    port: config.port,
    database: config.database,
    username: config.user,
    password: config.password,
    max: 50,
    idle_timeout: 30,
    // Sessao sempre em UTC, independente do servidor Postgres. Evita que
    // visivel_em das mensagens agendadas seja comparado em fusos diferentes.
    connection: { TimeZone: 'UTC' },
    // Avisos como "relation already exists, skipping" das migracoes nao sao erro.
    onnotice: () => {},
    // Conversoes para o JSON sair no mesmo formato de antes.
    types: {
      int8Numero: { to: 20, from: [20], serialize: (v: number) => String(v), parse: (v: string) => Number(v) },
      numericNumero: { to: 1700, from: [1700], serialize: (v: number) => String(v), parse: (v: string) => Number(v) },
      // timestamp sem fuso: como a sessao roda em UTC, o valor gravado ja esta em UTC.
      timestampUtc: { to: 1114, from: [1114], serialize: (v: string) => v, parse: (v: string) => new Date(`${v.replace(' ', 'T')}Z`) },
      // bytea: o unico uso e o conteudo das mensagens, gravado como texto UTF-8.
      byteaTexto: { to: 17, from: [17], serialize: (v: string) => v, parse: (v: string) => Buffer.from(v.slice(2), 'hex').toString('utf8') },
    },
  })
}

// Cria o banco da aplicacao se ele ainda nao existir, conectando no banco
// padrao "postgres", que todo servidor tem.
export async function garantirBanco(config: ConfigBanco) {
  const servidor = postgres({ host: config.host, port: config.port, database: 'postgres', username: config.user, password: config.password, max: 1, onnotice: () => {} })
  try {
    const [existe] = await servidor`select 1 from pg_database where datname = ${config.database}`
    if (!existe) {
      await servidor`create database ${servidor(config.database)}`
      console.log(`ℹ  Banco "${config.database}" criado.`)
    }
  } finally {
    await servidor.end()
  }
}

export async function encerrarBanco() {
  await sql?.end({ timeout: 5 })
}

// Script com varios comandos e sem parametros, usado pelas migracoes.
export async function executarScript(script: string) {
  await sql.unsafe(script)
}

// Executa em nome de um usuario, numa conexao reservada durante toda a operacao.
// app.usuario_id alimenta os triggers de auditoria e os defaults de criado_por.
// Vazio quando nao ha usuario, para nao herdar o de outra requisicao.
export async function comUsuario<T>(usuarioId: number, operacao: (sql: Sql) => Promise<T>): Promise<T> {
  const reservada = await sql.reserve()
  try {
    await reservada`select set_config('app.usuario_id', ${usuarioId > 0 ? String(usuarioId) : ''}, false)`
    return await operacao(reservada)
  } finally {
    reservada.release()
  }
}

// Conexao reservada nao tem sql.begin, entao a transacao e aberta a mao.
export async function transacao<T>(sql: Sql, operacao: () => Promise<T>): Promise<T> {
  await sql`begin`
  try {
    const resultado = await operacao()
    await sql`commit`
    return resultado
  } catch (erro) {
    await sql`rollback`
    throw erro
  }
}

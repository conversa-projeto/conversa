import type { SerializableParameter } from 'postgres'
import type { Sql } from './banco.ts'
import type { Tabelas } from './tabelas.ts'

type Coluna<N extends keyof Tabelas> = keyof Tabelas[N] & string

// Valores para gravar: so colunas da tabela, com qualquer valor que o
// postgres.js aceite (uma data pode ir como texto ISO, por exemplo).
type Dados<N extends keyof Tabelas> = { readonly [C in Coluna<N>]?: SerializableParameter }

// Colunas permitidas que vieram preenchidas. Nomes de coluna nunca vem do
// cliente direto para o SQL: campos fora da lista sao ignorados.
const presentes = <N extends keyof Tabelas>(dados: Dados<N>, colunas: readonly Coluna<N>[]): string[] =>
  colunas.filter((coluna) => dados[coluna] !== undefined)

// Os helpers do postgres.js (sql(tabela), sql(dados, ...campos)) nao resolvem
// a sobrecarga com tipos genericos: aqui ja se sabe que tabela e colunas sao
// validas, e eles recebem os tipos concretos.
const valores = <N extends keyof Tabelas>(dados: Dados<N>): Partial<Record<string, SerializableParameter>> => dados

export async function inserir<N extends keyof Tabelas>(sql: Sql, tabela: N, dados: Dados<N>, colunas: readonly Coluna<N>[]): Promise<Tabelas[N]> {
  const campos = presentes(dados, colunas)
  const [linha] = campos.length
    ? await sql<Tabelas[N][]>`insert into ${sql(String(tabela))} ${sql(valores(dados), ...campos)} returning *`
    : await sql<Tabelas[N][]>`insert into ${sql(String(tabela))} default values returning *`
  if (!linha) {
    throw new Error(`Falha ao inserir em ${tabela}`)
  }
  return linha
}

// Sem nada para alterar devolve a linha como esta; linha inexistente, objeto vazio.
export async function alterar<N extends keyof Tabelas>(sql: Sql, tabela: N, id: number, dados: Dados<N>, colunas: readonly Coluna<N>[]): Promise<Tabelas[N] | Record<string, never>> {
  const campos = presentes(dados, colunas)
  const [linha] = campos.length
    ? await sql<Tabelas[N][]>`update ${sql(String(tabela))} set ${sql(valores(dados), ...campos)} where id = ${id} returning *`
    : await sql<Tabelas[N][]>`select * from ${sql(String(tabela))} where id = ${id}`
  return linha ?? {}
}

export async function excluir<N extends keyof Tabelas>(sql: Sql, tabela: N, id: number, campo: Coluna<N> | 'id' = 'id'): Promise<Tabelas[N] | Record<string, never>> {
  const [linha] = await sql<Tabelas[N][]>`delete from ${sql(String(tabela))} where ${sql(String(campo))} = ${id} returning *`
  return linha ?? {}
}

// Tira a senha do usuario antes de devolver ao cliente.
export function semSenha<T extends object>(usuario: T): Omit<T, 'senha'> {
  const { senha: _senha, ...resto } = usuario as T & { senha?: unknown }
  return resto
}

// ISO-8601 sem fuso e tratado como UTC.
export function dataIso(valor: string): Date | undefined {
  const texto = valor.trim()
  const comFuso = /(Z|[+-]\d{2}:?\d{2})$/i.test(texto) ? texto : `${texto}Z`
  const data = new Date(comFuso)
  return Number.isNaN(data.getTime()) ? undefined : data
}

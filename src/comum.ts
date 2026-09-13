import type { Linha, Sql } from './banco.ts'

// Colunas permitidas que vieram preenchidas. Nomes de coluna nunca vem do
// cliente direto para o SQL: campos fora da lista sao ignorados.
const presentes = (dados: Linha, colunas: readonly string[]) => colunas.filter((coluna) => dados[coluna] !== undefined)

export async function inserir(sql: Sql, tabela: string, dados: Linha, colunas: readonly string[]): Promise<Linha> {
  const campos = presentes(dados, colunas)
  const [linha] = campos.length
    ? await sql`insert into ${sql(tabela)} ${sql(dados, ...campos)} returning *`
    : await sql`insert into ${sql(tabela)} default values returning *`
  return linha
}

export async function alterar(sql: Sql, tabela: string, id: number, dados: Linha, colunas: readonly string[]): Promise<Linha> {
  const campos = presentes(dados, colunas)
  const [linha] = campos.length
    ? await sql`update ${sql(tabela)} set ${sql(dados, ...campos)} where id = ${id} returning *`
    : await sql`select * from ${sql(tabela)} where id = ${id}`
  return linha ?? {}
}

export async function excluir(sql: Sql, tabela: string, id: number, campo = 'id'): Promise<Linha> {
  const [linha] = await sql`delete from ${sql(tabela)} where ${sql(campo)} = ${id} returning *`
  return linha ?? {}
}

// ISO-8601 sem fuso e tratado como UTC.
export function dataIso(valor: string): Date | undefined {
  const texto = valor.trim()
  const comFuso = /(Z|[+-]\d{2}:?\d{2})$/i.test(texto) ? texto : `${texto}Z`
  const data = new Date(comFuso)
  return Number.isNaN(data.getTime()) ? undefined : data
}

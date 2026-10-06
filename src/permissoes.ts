import type { Sql } from './banco.ts'
import type { Consulta, Corpo } from './esquemas.ts'
import { httpErrors } from './erros.ts'

// Codigos da tabela permissao (migracao 034). Permissao nova entra la e aqui.
export const CodigoPermissao = {
  Parametros: 'parametros',
  Permissoes: 'permissoes',
} as const
export type CodigoPermissao = (typeof CodigoPermissao)[keyof typeof CodigoPermissao]

// Instalacao nova: enquanto ninguem pode gerenciar as permissoes, todos tem
// todas, para quem instalou entrar pela tela e marcar quem cuida disso. A
// primeira permissao "permissoes" concedida encerra o modo aberto.
export async function modoAberto(sql: Sql) {
  const [linha] = await sql`
    select 1
      from permissao_usuario pu
     inner join permissao p on p.id = pu.permissao_id
     where p.codigo = ${CodigoPermissao.Permissoes}
     limit 1`
  return !linha
}

export async function validarPermissao(sql: Sql, usuario: number, codigo: CodigoPermissao) {
  if (await modoAberto(sql)) {
    return
  }
  const [linha] = await sql`
    select 1
      from permissao_usuario pu
     inner join permissao p on p.id = pu.permissao_id
     where pu.usuario_id = ${usuario}
       and p.codigo = ${codigo}`
  if (!linha) {
    throw httpErrors.forbidden('Acesso negado!')
  }
}

// Codigos que o proprio usuario tem: a pagina mostra so as telas permitidas
export async function minhasPermissoes(sql: Sql, usuario: number): Promise<string[]> {
  if (await modoAberto(sql)) {
    const todas = await sql<{ codigo: string }[]>`select codigo from permissao order by id`
    return todas.map((linha) => linha.codigo)
  }
  const linhas = await sql<{ codigo: string }[]>`
    select p.codigo
      from permissao_usuario pu
     inner join permissao p on p.id = pu.permissao_id
     where pu.usuario_id = ${usuario}
     order by p.id`
  return linhas.map((linha) => linha.codigo)
}

// Permissoes que existem e quem tem cada uma, para a tela de acessos
export async function listarPermissoes(sql: Sql, usuario: number) {
  await validarPermissao(sql, usuario, CodigoPermissao.Permissoes)
  const permissoes = await sql<{ codigo: string; descricao: string }[]>`
    select codigo, descricao from permissao order by id`
  const usuarios = await sql<{ id: number; nome: string; login: string; permissoes: string[] }[]>`
    select u.id
         , u.nome
         , u.login
         , coalesce(array_agg(p.codigo order by p.id) filter (where p.codigo is not null), '{}') as permissoes
      from usuario u
      left join permissao_usuario pu on pu.usuario_id = u.id
      left join permissao p on p.id = pu.permissao_id
     group by u.id, u.nome, u.login
     order by lower(u.nome), u.id`
  return { permissoes, usuarios, modo_aberto: await modoAberto(sql) }
}

async function idPermissao(sql: Sql, codigo: string) {
  const [permissao] = await sql<{ id: number }[]>`select id from permissao where codigo = ${codigo}`
  if (!permissao) {
    throw httpErrors.notFound('Permissão não encontrada!')
  }
  return permissao.id
}

export async function concederPermissao(sql: Sql, usuario: number, corpo: Corpo<'permissaoUsuario'>) {
  await validarPermissao(sql, usuario, CodigoPermissao.Permissoes)
  const permissao = await idPermissao(sql, corpo.codigo)
  const [alvo] = await sql`select 1 from usuario where id = ${corpo.usuario_id}`
  if (!alvo) {
    throw httpErrors.notFound('Usuário não encontrado!')
  }
  await sql`
    insert into permissao_usuario (usuario_id, permissao_id)
    values (${corpo.usuario_id}, ${permissao})
    on conflict (usuario_id, permissao_id) do nothing`
  return { usuario_id: corpo.usuario_id, codigo: corpo.codigo }
}

// Sempre fica alguem que pode gerenciar as permissoes: sem isso, so mexendo
// direto no banco para conceder de novo
export async function retirarPermissao(sql: Sql, usuario: number, consulta: Consulta<'permissaoUsuario'>) {
  await validarPermissao(sql, usuario, CodigoPermissao.Permissoes)
  const permissao = await idPermissao(sql, consulta.codigo)
  if (consulta.codigo === CodigoPermissao.Permissoes) {
    const [outros] = await sql<{ total: number }[]>`
      select count(1)::int as total
        from permissao_usuario
       where permissao_id = ${permissao}
         and usuario_id <> ${consulta.usuario_id}`
    if (!outros?.total) {
      throw httpErrors.badRequest('Ao menos uma pessoa precisa poder gerenciar as permissões.')
    }
  }
  await sql`delete from permissao_usuario where usuario_id = ${consulta.usuario_id} and permissao_id = ${permissao}`
  return { usuario_id: consulta.usuario_id, codigo: consulta.codigo }
}

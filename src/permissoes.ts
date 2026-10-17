import type { Sql } from './banco.ts'
import type { Consulta, Corpo } from './esquemas.ts'
import { httpErrors } from './erros.ts'
import { espacoPorUsuario } from './anexos.ts'

// Codigos da tabela permissao (migracao 034). Permissao nova entra la e aqui.
export const CodigoPermissao = {
  Parametros: 'parametros',
  Permissoes: 'permissoes',
  // Criar bots de IA (migracao 047)
  Bots: 'bots',
  // Cadastrar as ferramentas externas dos bots (migracao 051)
  Ferramentas: 'ferramentas',
  // Cuidar das bases de conhecimento dos bots (migracao 052)
  Conhecimento: 'conhecimento',
  // De uso do app (permissao.uso), migracao 046
  Emoji: 'emoji',
  Figurinha: 'figurinha',
  Imagem: 'imagem',
  Video: 'video',
  Audio: 'audio',
  Arquivo: 'arquivo',
  Responder: 'responder',
  Encaminhar: 'encaminhar',
  Reagir: 'reagir',
  Postagem: 'postagem',
  Votacao: 'votacao',
  Confirmacao: 'confirmacao',
  Agendar: 'agendar',
  Grupo: 'grupo',
  ChamadaAudio: 'chamada_audio',
  ChamadaVideo: 'chamada_video',
  CompartilharTela: 'compartilhar_tela',
  Telefonia: 'telefonia',
  // Migracao 048. Cores e configuracoes de chamada ficam no navegador: so a pagina confere
  Ocultar: 'ocultar',
  // Migracao 049: o perfil, campo a campo (o telefone vai com o e-mail)
  Nome: 'nome',
  Email: 'email',
  Avatar: 'avatar',
  Senha: 'senha',
  Privacidade: 'privacidade',
  Cores: 'cores',
  ConfigChamadas: 'config_chamadas',
  // Migracao 055: localizacao e trajeto (conteudo tipo 9)
  Localizacao: 'localizacao',
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
  await validarPermissoes(sql, usuario, [codigo])
}

// Descricao vai na mensagem: quem foi barrado sabe o que lhe falta
export async function validarPermissoes(sql: Sql, usuario: number, codigos: CodigoPermissao[]) {
  if (!codigos.length || await modoAberto(sql)) {
    return
  }
  const [faltando] = await sql<{ codigo: string; descricao: string; uso: boolean }[]>`
    select p.codigo, p.descricao, p.uso
      from permissao p
     where p.codigo in ${sql([...new Set(codigos)])}
       and not exists (select 1 from permissao_usuario pu where pu.permissao_id = p.id and pu.usuario_id = ${usuario})
     order by p.id
     limit 1`
  if (faltando) {
    throw httpErrors.forbidden(faltando.uso ? `Você não tem permissão para: ${faltando.descricao.toLowerCase()}.` : 'Acesso negado!')
  }
}

export async function permissaoUsuario(sql: Sql, usuario: number, codigo: CodigoPermissao) {
  return (await minhasPermissoes(sql, usuario)).includes(codigo)
}

// Troca as permissoes da conta pela lista (cadastro pelo administrador). Bot
// so recebe as de uso.
export async function conferirListaPermissoes(sql: Sql, codigos: string[], bot: boolean) {
  const existentes = await sql<{ codigo: string; uso: boolean }[]>`select codigo, uso from permissao`
  const desconhecida = codigos.find((codigo) => !existentes.some((p) => p.codigo === codigo))
  if (desconhecida) {
    throw httpErrors.badRequest(`Permissão inválida: ${desconhecida}`)
  }
  const administracao = bot && codigos.find((codigo) => !existentes.find((p) => p.codigo === codigo)!.uso)
  if (administracao) {
    throw httpErrors.badRequest('Bot só recebe permissões de uso.')
  }
}

export async function definirPermissoesConta(sql: Sql, conta: number, codigos: string[]) {
  await sql`delete from permissao_usuario where usuario_id = ${conta}`
  if (codigos.length) {
    await sql`
      insert into permissao_usuario (usuario_id, permissao_id)
      select ${conta}, id from permissao where codigo in ${sql([...new Set(codigos)])}`
  }
}

// Conta nova pode tudo no chat; o administrador restringe depois
export async function concederPermissoesUso(sql: Sql, usuario: number) {
  await sql`
    insert into permissao_usuario (usuario_id, permissao_id)
    select ${usuario}, id from permissao where uso
        on conflict (usuario_id, permissao_id) do nothing`
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
  const permissoes = await sql<{ codigo: string; descricao: string; uso: boolean }[]>`
    select codigo, descricao, uso from permissao order by id`
  const usuarios = await sql<{ id: number; nome: string; login: string; criado_em: Date | null; bot: boolean; permissoes: string[] }[]>`
    select u.id
         , u.nome
         , u.login
         , u.criado_em
         , exists (select 1 from bot b where b.usuario_id = u.id) as bot
         , coalesce(array_agg(p.codigo order by p.id) filter (where p.codigo is not null), '{}') as permissoes
      from usuario u
      left join permissao_usuario pu on pu.usuario_id = u.id
      left join permissao p on p.id = pu.permissao_id
     where not exists (select 1 from bot b where b.usuario_id = u.id and b.excluido_em is not null)
     group by u.id, u.nome, u.login, u.criado_em
     order by lower(u.nome), u.id`
  const espaco = await espacoPorUsuario(sql)
  return {
    permissoes,
    usuarios: usuarios.map((linha) => ({ ...linha, espaco: espaco.get(linha.id) ?? 0 })),
    modo_aberto: await modoAberto(sql),
  }
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
  // Quem administra nao tira os proprios acessos: outra pessoa precisa fazer
  if (consulta.usuario_id === usuario) {
    throw httpErrors.badRequest('Você não pode retirar as próprias permissões.')
  }
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

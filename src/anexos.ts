import type { Sql } from './banco.ts'
import { validarAcessoConversa } from './autorizacao.ts'
import type { Consulta, Corpo } from './esquemas.ts'
import { httpErrors } from './erros.ts'
import { objetoExiste, urlPublica } from './minio.ts'

// Status do upload: 0-Pendente, 1-Concluido, 2-Falhou
interface AnexoObjeto {
  objeto: string
  upload_status: number
}

interface AnexoLista {
  anexo_id: number
  identificador: string
  nome: string | null
  extensao: string | null
  tamanho: number
  anexo_objeto: string | null
  criado_em: Date | null
  tipo: number
  mensagem_id: number
  conversa_id: number
  conversa_descricao: string | null
  autor_id: number
  autor_nome: string
}


const TAMANHO_MAXIMO = 1024 * 1024 * 1024 // 1 GiB
const TIPOS_ANEXO = [2, 3, 4, 5] // 2-Imagem; 3-Arquivo; 4-Audio; 5-Gravacao de audio

export async function anexoExiste(sql: Sql, identificador: string) {
  const [anexo] = await sql<{ id: number; identificador: string; tipo: number; tamanho: number; upload_status: number }[]>`
    select a.id, a.identificador, a.tipo, a.tamanho, a.upload_status
      from anexo as a
     where a.identificador = ${identificador}`
  return anexo ? { existe: true, ...anexo } : { existe: false }
}

export async function urlAnexo(sql: Sql, identificador: string) {
  const [anexo] = await sql<AnexoObjeto[]>`select objeto, upload_status from anexo where identificador = ${identificador}`
  if (!anexo) {
    throw new Error('Anexo não encontrado')
  }
  if (anexo.upload_status === 0) {
    if (!await objetoExiste(anexo.objeto)) {
      throw httpErrors.badRequest('Upload ainda não foi concluído')
    }
    await sql`update anexo set upload_status = 1 where identificador = ${identificador}`
  }
  if (anexo.upload_status === 2) {
    throw httpErrors.badRequest('Upload falhou')
  }
  return { url: await urlPublica('GET', anexo.objeto, 600) }
}

export async function incluirAnexo(sql: Sql, corpo: Corpo<'incluirAnexo'>) {
  if (corpo.tamanho > TAMANHO_MAXIMO) {
    throw new Error('Arquivo muito grande!')
  }

  const [existente] = await sql<{ id: number; objeto: string }[]>`select id, objeto from anexo where identificador = ${corpo.identificador}`
  if (existente) {
    return { existe: true, id: String(existente.id), upload_url: await urlPublica('GET', existente.objeto, 600) }
  }

  const agora = new Date()
  const data = `${agora.getFullYear()}/${String(agora.getMonth() + 1).padStart(2, '0')}/${String(agora.getDate()).padStart(2, '0')}`
  const objeto = `conversa/${data}/${corpo.identificador}`

  const [inserido] = await sql<{ id: number }[]>`
    insert into anexo (identificador, tipo, tamanho, nome, extensao, objeto)
    values (${corpo.identificador}, ${corpo.tipo}, ${corpo.tamanho}, ${corpo.nome?.trim() ? corpo.nome : null}, ${corpo.extensao?.trim() ? corpo.extensao : null}, ${objeto})
    returning id`

  if (!inserido) {
    throw new Error('Falha ao incluir o anexo')
  }
  return { existe: false, id: inserido.id, upload_url: await urlPublica('PUT', objeto, 300), upload_status: 0 }
}

export async function confirmarUpload(sql: Sql, identificador: string) {
  const [anexo] = await sql<AnexoObjeto[]>`select objeto, upload_status from anexo where identificador = ${identificador}`
  if (!anexo) {
    throw new Error('Anexo não encontrado')
  }
  if (anexo.upload_status !== 1) {
    if (!await objetoExiste(anexo.objeto)) {
      throw httpErrors.badRequest('Arquivo não encontrado no armazenamento')
    }
    await sql`update anexo set upload_status = 1 where identificador = ${identificador}`
  }
  return { confirmado: true, upload_status: 1 }
}

export async function anexos(sql: Sql, usuario: number, filtro: Consulta<'anexos'>) {
  const limite = filtro.limite <= 0 ? 50 : Math.min(filtro.limite, 200)

  const direcao = String(filtro.direcao).trim().toLowerCase()
  if (direcao && direcao !== 'enviados' && direcao !== 'recebidos') {
    throw httpErrors.badRequest('Direção inválida (use enviados, recebidos ou vazio).')
  }

  let tipos = TIPOS_ANEXO
  if (String(filtro.tipos).trim()) {
    tipos = String(filtro.tipos).split(',').map((parte) => {
      const tipo = Number(parte.trim())
      if (!Number.isInteger(tipo)) throw httpErrors.badRequest(`Tipo inválido: ${parte}`)
      if (!TIPOS_ANEXO.includes(tipo)) throw httpErrors.badRequest(`Tipo não permitido: ${tipo}`)
      return tipo
    })
  }

  if (filtro.conversa > 0) {
    await validarAcessoConversa(sql, usuario, filtro.conversa)
  }

  // enviados: autor e o usuario. recebidos: autor e outro, opcionalmente um especifico.
  if (direcao === 'recebidos' && filtro.autor > 0 && filtro.autor === usuario) {
    throw httpErrors.badRequest('Filtro de autor incompatível com direção "recebidos".')
  }
  const nenhum = sql``
  const filtroAutor = direcao === 'enviados'
    ? sql`and m.usuario_id = ${usuario}`
    : direcao === 'recebidos'
      ? sql`and m.usuario_id <> ${usuario} ${filtro.autor > 0 ? sql`and m.usuario_id = ${filtro.autor}` : nenhum}`
      : filtro.autor > 0 ? sql`and m.usuario_id = ${filtro.autor}` : nenhum

  const linhas = await sql<AnexoLista[]>`
    select a.id              as anexo_id
         , a.identificador
         , a.nome
         , a.extensao
         , a.tamanho
         , a.objeto          as anexo_objeto
         , a.criado_em
         , mc.tipo
         , mc.mensagem_id
         , m.conversa_id
         , c.descricao       as conversa_descricao
         , m.usuario_id      as autor_id
         , u.nome            as autor_nome
      from mensagem_conteudo mc
     inner join anexo a
        on a.identificador = convert_from(mc.conteudo, 'utf-8')
     inner join mensagem m
        on m.id = mc.mensagem_id
     inner join conversa c
        on c.id = m.conversa_id
     inner join usuario u
        on u.id = m.usuario_id
     inner join conversa_usuario cu
        on cu.conversa_id = m.conversa_id
       and cu.usuario_id = ${usuario}
     where mc.tipo in ${sql(tipos)}
       and a.upload_status = 1
       and (m.usuario_id = ${usuario} or m.visivel_em is null or m.visivel_em <= now())
       ${filtro.conversa > 0 ? sql`and m.conversa_id = ${filtro.conversa}` : nenhum}
       ${filtroAutor}
       ${filtro.antes > 0 ? sql`and a.id < ${filtro.antes}` : nenhum}
     order by a.id desc
     limit ${limite}`

  return Promise.all(linhas.map(async ({ anexo_objeto, ...linha }) => ({
    ...linha,
    url: anexo_objeto ? await urlPublica('GET', anexo_objeto, 600) : null,
  })))
}

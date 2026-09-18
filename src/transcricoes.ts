import sensible from '@fastify/sensible'
import { comUsuario, type Linha, type Sql } from './banco.ts'
import { configuracao } from './configuracao.ts'
import { lerObjeto } from './minio.ts'

const { httpErrors } = sensible

// Status da transcricao: 1-Processando, 2-Concluida, 3-Erro
const PROCESSANDO = 1
const CONCLUIDA = 2
const ERRO = 3

// Transcricao em processamento ha mais tempo que isso e tida como perdida (a
// API reiniciou no meio, por exemplo) e pode ser pedida de novo.
const LIMITE_PROCESSANDO_MIN = 30
const INTERVALO_CONSULTA_MS = 2000

const espera = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// So transcreve audio (tipos 4 e 5) de uma conversa da qual o usuario participa.
async function anexoDeAudio(sql: Sql, usuario: number, identificador: string) {
  const [anexo] = await sql`
    select a.objeto, a.extensao
      from anexo a
     where a.identificador = ${identificador}
       and exists ( select 1
                      from mensagem_conteudo mc
                     inner join mensagem m
                        on m.id = mc.mensagem_id
                     inner join conversa_usuario cu
                        on cu.conversa_id = m.conversa_id
                       and cu.usuario_id = ${usuario}
                     where mc.tipo in (4, 5)
                       and convert_from(mc.conteudo, 'utf-8') = a.identificador )`
  if (!anexo) {
    throw httpErrors.forbidden('Acesso negado!')
  }
  return anexo as { objeto: string; extensao: string | null }
}

function resposta(linha?: Linha) {
  return linha
    ? { status: linha.status as number, texto: linha.texto ?? '', erro: linha.erro ?? '' }
    : { status: 0, texto: '', erro: '' }
}

export async function obterTranscricao(sql: Sql, usuario: number, identificador: string) {
  await anexoDeAudio(sql, usuario, identificador)
  const [linha] = await sql`select status, texto, erro from anexo_transcricao where identificador = ${identificador}`
  return resposta(linha)
}

export async function transcrever(sql: Sql, usuario: number, identificador: string) {
  const anexo = await anexoDeAudio(sql, usuario, identificador)
  if (!configuracao.transcritorUrl.trim()) {
    throw httpErrors.badRequest('Transcrição não configurada: defina o parâmetro transcritor_url.')
  }

  const [atual] = await sql`
    select status, texto, erro
         , extract(epoch from (current_timestamp - atualizado_em)) / 60 as minutos
      from anexo_transcricao
     where identificador = ${identificador}`
  if (atual && (atual.status === CONCLUIDA || (atual.status === PROCESSANDO && atual.minutos < LIMITE_PROCESSANDO_MIN))) {
    return resposta(atual)
  }

  const idioma = configuracao.transcritorIdioma.trim() || null
  await sql`
    insert into anexo_transcricao (identificador, status, idioma, criado_por)
    values (${identificador}, ${PROCESSANDO}, ${idioma}, ${usuario})
    on conflict (identificador) do update
       set status = ${PROCESSANDO}
         , texto = null
         , erro = null
         , job_id = null
         , idioma = excluded.idioma
         , atualizado_em = current_timestamp`

  // Roda em segundo plano: o cliente acompanha por GET /api/anexo/transcricao.
  void processar(identificador, anexo, idioma)
  return { status: PROCESSANDO, texto: '', erro: '' }
}

async function processar(identificador: string, anexo: { objeto: string; extensao: string | null }, idioma: string | null) {
  const base = configuracao.transcritorUrl.trim().replace(/\/+$/, '')
  const inicio = Date.now()
  try {
    const audio = await lerObjeto(anexo.objeto)

    // Sempre um unico falante: sem separacao por falante e sem alinhamento por
    // palavra, que so atrasam o resultado de um audio de conversa.
    const formulario = new FormData()
    formulario.append('file', new Blob([new Uint8Array(audio)]), `audio.${anexo.extensao || 'bin'}`)
    if (idioma) formulario.append('language', idioma)
    formulario.append('diarization', 'false')
    formulario.append('alignment', 'false')
    formulario.append('num_speakers', '1')

    const criado = await fetch(`${base}/jobs`, { method: 'POST', body: formulario })
    if (!criado.ok) {
      throw new Error(`transcritor respondeu ${criado.status}: ${await criado.text()}`)
    }
    let tarefa = await criado.json() as { job_id: string; status: string; error?: string }
    await comUsuario(0, (s) => s`update anexo_transcricao set job_id = ${tarefa.job_id} where identificador = ${identificador}`)

    while (tarefa.status !== 'done' && tarefa.status !== 'error') {
      if (Date.now() - inicio > LIMITE_PROCESSANDO_MIN * 60_000) {
        throw new Error('tempo limite de transcrição esgotado')
      }
      await espera(INTERVALO_CONSULTA_MS)
      const consulta = await fetch(`${base}/jobs/${tarefa.job_id}`)
      if (!consulta.ok) {
        throw new Error(`transcritor respondeu ${consulta.status}: ${await consulta.text()}`)
      }
      tarefa = await consulta.json()
    }
    if (tarefa.status === 'error') {
      throw new Error(tarefa.error || 'erro no transcritor')
    }

    const download = await fetch(`${base}/jobs/${tarefa.job_id}/download?formato=txt`)
    if (!download.ok) {
      throw new Error(`transcritor respondeu ${download.status}: ${await download.text()}`)
    }
    const texto = (await download.text()).trim()
    await comUsuario(0, (s) => s`
      update anexo_transcricao
         set status = ${CONCLUIDA}, texto = ${texto}, erro = null, atualizado_em = current_timestamp
       where identificador = ${identificador}`)
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : String(erro)
    console.error('[Transcricao] falha', identificador, mensagem)
    await comUsuario(0, (s) => s`
      update anexo_transcricao
         set status = ${ERRO}, erro = ${mensagem.slice(0, 500)}, atualizado_em = current_timestamp
       where identificador = ${identificador}`).catch(() => {})
  }
}

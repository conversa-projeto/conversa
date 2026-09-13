import type { FastifyInstance } from 'fastify'
import { AsyncTask, SimpleIntervalJob } from 'toad-scheduler'
import { comUsuario } from './banco.ts'
import { notificarMensagemAgendada } from './mensagens.ts'
import { objetoExiste } from './minio.ts'

// Mensagem notificada fica lembrada por 10 minutos, mais que o intervalo, para
// nao notificar duas vezes. A consulta tambem so olha os ultimos 10 minutos:
// agendadas mais antigas, de um periodo com o servidor parado, nao sao reenviadas.
const MEMORIA_NOTIFICADAS = 10 * 60 * 1000
const JANELA_MINUTOS = 10
const TIMEOUT_UPLOAD_MINUTOS = 15

const notificadas = new Map<number, number>()

async function notificarAgendadas() {
  await comUsuario(0, async (sql) => {
    const maduras = await sql<{ id: number }[]>`
      select id
        from mensagem
       where visivel_em is not null
         and visivel_em <= now()
         and visivel_em >= now() - make_interval(mins => ${JANELA_MINUTOS})
       order by visivel_em`
    for (const { id } of maduras) {
      if (notificadas.has(id)) {
        continue
      }
      try {
        await notificarMensagemAgendada(sql, id)
        notificadas.set(id, Date.now())
      } catch (erro) {
        console.error('[AgendadorMensagens] Falha notificando mensagem', id, erro)
      }
    }
  })

  const limite = Date.now() - MEMORIA_NOTIFICADAS
  for (const [id, quando] of notificadas) {
    if (quando < limite) {
      notificadas.delete(id)
    }
  }
}

// Confirma uploads que o cliente nao confirmou. Depois de 15 minutos sem o
// arquivo no MinIO, marca como falho.
async function verificarAnexosPendentes() {
  await comUsuario(0, async (sql) => {
    const pendentes = await sql<{ id: number; objeto: string; minutos: number }[]>`
      select a.id
           , a.objeto
           , extract(epoch from (current_timestamp - a.criado_em)) / 60.0 as minutos
        from anexo as a
       where a.upload_status = 0
         and a.criado_em < current_timestamp - interval '1 minute'
       order by a.criado_em
       limit 50`
    for (const anexo of pendentes) {
      if (await objetoExiste(anexo.objeto)) {
        await sql`update anexo set upload_status = 1 where id = ${anexo.id}`
      } else if (anexo.minutos > TIMEOUT_UPLOAD_MINUTOS) {
        await sql`update anexo set upload_status = 2 where id = ${anexo.id}`
      }
    }
  })
}

// Executa ao iniciar e depois no intervalo, sem sobrepor execucoes.
function tarefa(id: string, segundos: number, executar: () => Promise<void>) {
  return new SimpleIntervalJob(
    { seconds: segundos, runImmediately: true },
    new AsyncTask(id, executar, (erro) => console.error(`[${id}]`, erro)),
    { id, preventOverrun: true },
  )
}

export function registrarTarefas(app: FastifyInstance) {
  app.scheduler.addSimpleIntervalJob(tarefa('AgendadorMensagens', 60, notificarAgendadas))
  app.scheduler.addSimpleIntervalJob(tarefa('VerificacaoAnexos', 120, verificarAnexosPendentes))
}

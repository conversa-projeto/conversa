import { cert, initializeApp, type App } from 'firebase-admin/app'
import { getMessaging } from 'firebase-admin/messaging'
import { configuracao } from './configuracao.ts'

let aplicativo: App | undefined

// Inicializado no primeiro envio, com a conta de servico da tabela parametros.
function obterAplicativo() {
  if (!aplicativo) {
    const { projectId, clientEmail, privateKey } = configuracao.fcm
    aplicativo = initializeApp({
      // A chave vem com \n literais no lugar das quebras de linha.
      credential: cert({ projectId, clientEmail, privateKey: privateKey.replaceAll('\\n', '\n') }),
    }, 'conversa')
  }
  return aplicativo
}

export async function enviarPush(tokenDispositivo: string, titulo: string, mensagem: string) {
  await getMessaging(obterAplicativo()).send({
    token: tokenDispositivo,
    notification: { title: titulo, body: mensagem },
  })
}

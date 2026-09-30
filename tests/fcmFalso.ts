// Pushes que a API mandaria ao Firebase, registrados pelo envio falso que o
// preparar.ts coloca no lugar do firebase-admin.
export interface PushEnviado {
  token: string
  data: { titulo: string; mensagem: string; conversa: string }
}

export const pushEnviados: PushEnviado[] = []

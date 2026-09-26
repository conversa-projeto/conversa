// Erro com status HTTP. O tratador de erros do servidor responde
// { error: mensagem } com esse status; qualquer outro erro vira 500.
export class ErroHttp extends Error {
  readonly status: number

  constructor(status: number, mensagem: string) {
    super(mensagem)
    this.name = 'ErroHttp'
    this.status = status
  }
}

export const httpErrors = {
  badRequest: (mensagem: string) => new ErroHttp(400, mensagem),
  unauthorized: (mensagem: string) => new ErroHttp(401, mensagem),
  forbidden: (mensagem: string) => new ErroHttp(403, mensagem),
  notFound: (mensagem: string) => new ErroHttp(404, mensagem),
  conflict: (mensagem: string) => new ErroHttp(409, mensagem),
}

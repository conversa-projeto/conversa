import { jwt } from '@elysiajs/jwt'
import { httpErrors } from './erros.ts'

// Token de login: sub e o id do usuario, valido por 12 horas. Assinado com o
// parametro jwt_token, entao so pode ser criado depois de carregar os parametros.
export const criarToken = (segredo: string) => jwt({ name: 'jwt', secret: segredo, exp: '12h' })

export type Token = ReturnType<typeof criarToken>

type VerificarJwt = (token?: string) => Promise<false | { sub?: string; exp?: number; iat?: number }>

// Confere o token e devolve o id do usuario. Token vencido, adulterado ou sem
// os campos de um login vira 401.
export async function usuarioDoToken(verificar: VerificarJwt, token: string | undefined): Promise<number> {
  if (!token) {
    throw httpErrors.unauthorized('Token não informado')
  }
  const dados = await verificar(token)
  const usuario = dados ? Number(dados.sub) : NaN
  if (!dados || !dados.exp || !dados.iat || !Number.isInteger(usuario) || usuario <= 0) {
    throw httpErrors.unauthorized('Token inválido ou expirado')
  }
  return usuario
}

// Token do cabecalho Authorization: Bearer <token>
export function tokenDoCabecalho(autorizacao: string | undefined): string | undefined {
  const [tipo, token] = autorizacao?.split(' ') ?? []
  return tipo?.toLowerCase() === 'bearer' ? token : undefined
}

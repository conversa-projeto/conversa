import { configuracao } from './configuracao.ts'

const CUSTO = 15

// O pepper entra antes do corte em 72, que e o limite do bcrypt. Mesma regra da
// API anterior, para os hashes ja gravados continuarem conferindo: corta em 72
// caracteres e depois em 72 bytes, onde o bcrypt parava. Sem o corte em bytes, o
// Bun.password resumiria a senha longa com SHA-512 e o hash nao conferiria.
function comPepper(senha: string): Uint8Array {
  return new TextEncoder().encode((senha + configuracao.bcryptPepper).slice(0, 72)).slice(0, 72)
}

export const gerarHash = (senha: string): Promise<string> =>
  Bun.password.hash(comPepper(senha), { algorithm: 'bcrypt', cost: CUSTO })

export const conferirSenha = (senha: string, hash: string): Promise<boolean> =>
  Bun.password.verify(comPepper(senha), hash)

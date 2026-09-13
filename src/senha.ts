import bcrypt from 'bcrypt'
import { configuracao } from './configuracao.ts'

const CUSTO = 15

// O pepper entra antes do corte em 72, que e o limite do bcrypt. Mesma regra da
// API anterior, para os hashes ja gravados continuarem conferindo.
const comPepper = (senha: string) => (senha + configuracao.bcryptPepper).slice(0, 72)

export const gerarHash = (senha: string) => bcrypt.hash(comPepper(senha), CUSTO)

export const conferirSenha = (senha: string, hash: string) => bcrypt.compare(comPepper(senha), hash)

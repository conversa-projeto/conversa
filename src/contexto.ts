import { AsyncLocalStorage } from 'node:async_hooks'

// Endereco que o navegador usou para chamar a API, como https://192.168.0.10,
// guardado durante a requisicao. As URLs do MinIO e do TURN sao montadas com
// ele, entao funcionam por IP, localhost ou dominio sem configurar nada.
const origem = new AsyncLocalStorage<string>()

// O Host e o X-Forwarded-Proto chegam repassados pelo nginx (ou pelo Vite).
export function comOrigemPublica<T>(requisicao: Request, executar: () => T): T {
  const [protocolo = 'https'] = (requisicao.headers.get('x-forwarded-proto') ?? 'https').split(',').map((parte) => parte.trim())
  return origem.run(`${protocolo}://${requisicao.headers.get('host') ?? ''}`, executar)
}

export function origemPublica(): string | undefined {
  return origem.getStore()
}

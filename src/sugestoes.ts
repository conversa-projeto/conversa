import { validarAcessoConversa } from './autorizacao.ts'
import type { Sql } from './banco.ts'
import type { Corpo } from './esquemas.ts'
import { httpErrors } from './erros.ts'
import { completar, iaConfigurada } from './ia.ts'

// Sugestao para o campo de mensagem, como no editor de codigo: a IA continua o
// que a pessoa esta digitando, pelo contexto da conversa. Tem de ser rapida
// (o modelo responde sem "pensar" e com poucas palavras).

const MENSAGENS_DE_CONTEXTO = 20
const LIMITE_POR_MENSAGEM = 300
// O fim do que foi digitado, que a IA repete e continua; o resto vai so como contexto
const TAMANHO_FIM = 120
const LIMITE_SUGESTAO = 120
const TEMPO_LIMITE_MS = 10_000

const INSTRUCOES = `Você ajuda a escrever mensagens num chat de trabalho, em português do Brasil.
Continue a mensagem que a pessoa está digitando, de forma natural e coerente com a conversa, com poucas palavras (até 15).
Responda com o trecho final digitado copiado do jeito que está, letra por letra, e logo depois a continuação, numa linha só.
Exemplo: trecho "Vou mandar o relat" → resposta "Vou mandar o relatório amanhã cedo."
Não use aspas, não explique, não comece outra mensagem.`

export async function sugerirTexto(sql: Sql, usuario: number, corpo: Corpo<'sugerirTexto'>, sinal?: AbortSignal) {
  await validarAcessoConversa(sql, usuario, corpo.conversa_id)
  if (!iaConfigurada()) {
    throw httpErrors.badRequest('IA não configurada: defina o endereço e o modelo nas configurações do sistema.')
  }
  const digitado = corpo.texto
  if (!digitado.trim()) {
    return { sugestao: '' }
  }

  const contexto = await sql<{ autor: string; texto: string; meu: boolean }[]>`
    select *
      from ( select substring(trim(u.nome) from '^([^ ]+)') as autor
                  , convert_from(mc.conteudo, 'utf-8') as texto
                  , m.usuario_id = ${usuario} as meu
                  , coalesce(m.visivel_em, m.inserida) as quando
                  , m.id
               from mensagem m
              inner join usuario u on u.id = m.usuario_id
              inner join mensagem_conteudo mc on mc.mensagem_id = m.id and mc.tipo = 1
              where m.conversa_id = ${corpo.conversa_id}
                and m.excluida_em is null
                and (m.usuario_id = ${usuario} or m.visivel_em is null or m.visivel_em <= now())
              order by quando desc, m.id desc, mc.ordem
              limit ${MENSAGENS_DE_CONTEXTO}
           ) as ultimas
     order by quando, id`
  const [eu] = await sql<{ nome: string }[]>`select substring(trim(nome) from '^([^ ]+)') as nome from usuario where id = ${usuario}`

  const { inicio, fim } = separarFim(digitado)
  const conversa = contexto
    .map(({ autor, texto, meu }) => `${meu ? `${autor} (você)` : autor}: ${limparTexto(texto).slice(0, LIMITE_POR_MENSAGEM)}`)
    .join('\n')
  const pedido = [
    conversa ? `Conversa (mais antigas primeiro):\n${conversa}` : 'Conversa ainda sem mensagens.',
    `${eu?.nome ?? 'A pessoa'} (você) está digitando.`,
    inicio ? `Começo da mensagem: ${inicio}` : '',
    `Trecho final digitado até agora: ${fim}`,
  ].filter(Boolean).join('\n\n')

  try {
    const resposta = await completar([
      { role: 'system', content: INSTRUCOES },
      { role: 'user', content: pedido },
    ], { semRaciocinio: true, maxTokens: Math.ceil(fim.length / 2) + 40, tempoLimiteMs: TEMPO_LIMITE_MS, sinal })
    return { sugestao: continuacao(fim, resposta) }
  } catch (erro) {
    // Sugestao que falha so nao aparece; o motivo fica no log
    if (!sinal?.aborted) console.warn('[IA] Sugestão falhou:', erro instanceof Error ? erro.message : erro)
    return { sugestao: '' }
  }
}

// Mencao @[Nome](id) vira @Nome; quebras de linha viram espaco
function limparTexto(texto: string) {
  return texto.replace(/@\[([^\]]+)\]\(\d+\)/g, '@$1').replace(/\s+/g, ' ').trim()
}

// O fim a repetir comeca numa palavra inteira, para a IA nao ter de repetir meia palavra do inicio
export function separarFim(digitado: string) {
  const texto = limparTexto(digitado) + (/\s$/.test(digitado) ? ' ' : '')
  if (texto.length <= TAMANHO_FIM) return { inicio: '', fim: texto }
  let corte = texto.indexOf(' ', texto.length - TAMANHO_FIM)
  if (corte < 0) corte = texto.length - TAMANHO_FIM
  return { inicio: texto.slice(0, corte).trim(), fim: texto.slice(corte + 1) }
}

// O que vem depois do trecho repetido: so a primeira linha, sem aspas no fim,
// cortada numa palavra. Se a IA nao repetiu o trecho, nao ha como encaixar.
export function continuacao(fim: string, resposta: string) {
  const completa = (resposta.split('\n').find((linha) => linha.trim()) ?? '').replace(/^["“']+/, '')
  const semEspacoFinal = fim.trimEnd()
  let resto: string
  if (completa.startsWith(semEspacoFinal)) {
    resto = completa.slice(semEspacoFinal.length)
  } else if (completa.toLowerCase().startsWith(semEspacoFinal.toLowerCase())) {
    resto = completa.slice(semEspacoFinal.length)
  } else {
    return ''
  }
  // Quem terminou com espaco nao recebe outro
  if (fim !== semEspacoFinal) resto = resto.replace(/^\s+/, '')
  resto = resto.replace(/["”']+\s*$/, '').replace(/\s+$/, '')
  if (resto.length > LIMITE_SUGESTAO) {
    const corte = resto.lastIndexOf(' ', LIMITE_SUGESTAO)
    resto = resto.slice(0, corte > 0 ? corte : LIMITE_SUGESTAO)
  }
  return resto.trim() ? resto : ''
}

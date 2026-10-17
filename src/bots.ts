import { randomUUID } from 'node:crypto'
import { comUsuario, transacao, type Sql } from './banco.ts'
import { validarAcessoConversa } from './autorizacao.ts'
import { idsMencionados } from './atividades.ts'
import { avisarAtividade } from './conversas.ts'
import { criarEnquete } from './enquetes.ts'
import type { Corpo } from './esquemas.ts'
import { httpErrors } from './erros.ts'
import { completarComFerramentas, iaConfigurada, type Ferramenta, type MensagemComFerramentas } from './ia.ts'
import { alternarReacao, incluirMensagem, marcarStatus } from './mensagens.ts'
import { CodigoPermissao, minhasPermissoes, permissaoUsuario, validarPermissao } from './permissoes.ts'
import { descreverConteudo } from './resumos.ts'
import { gerarHash } from './senha.ts'
import { buscarTrechos, conhecimentoLigado } from './conhecimento.ts'
import { chamarFerramenta, ferramentasDoBot as ferramentasExternasDoBot, type FerramentaExterna } from './ferramentas.ts'
import { inserir } from './comum.ts'
import { notificarContatos, TipoMensagemSocket } from './websocket.ts'

// Bots de IA. Cada bot e um usuario comum: o que ele faz no chat passa pelas
// mesmas rotinas (e as mesmas permissoes de uso) de uma pessoa. Responde na
// conversa direta com ele, quando mencionado num grupo e quando respondem a
// uma mensagem dele. O texto que o modelo devolve vira a mensagem do bot; as
// ferramentas fazem o resto (reagir, figurinha, responder uma mensagem...).

// Conta nova de bot: so o basico; quem criou libera o resto
const PERMISSOES_INICIAIS = [CodigoPermissao.Emoji, CodigoPermissao.Responder, CodigoPermissao.Reagir]
const LIMITE_NOME = 60
const LIMITE_INSTRUCOES = 8000

// --- Cadastro ---

export interface BotLinha {
  id: number
  usuario_id: number
  nome: string
  login: string
  instrucoes: string
  ativo: boolean
  criado_por: number | null
  criado_por_nome: string | null
  permissoes: string[]
  // Ferramentas externas ligadas no bot (ids)
  ferramentas: number[]
  // Bases de conhecimento que ele consulta (ids)
  bases: number[]
}

// Quem tem "permissoes" cuida de todos os bots; quem tem "bots", dos que criou
async function cuidaDeTodos(sql: Sql, usuario: number) {
  return permissaoUsuario(sql, usuario, CodigoPermissao.Permissoes)
}

async function linhasBots(sql: Sql, filtro: { id?: number; criadoPor?: number }) {
  return sql<BotLinha[]>`
    select b.id
         , b.usuario_id
         , u.nome
         , u.login
         , b.instrucoes
         , b.ativo
         , b.criado_por
         , c.nome as criado_por_nome
         , coalesce(array_agg(p.codigo order by p.id) filter (where p.codigo is not null), '{}') as permissoes
         , coalesce((select array_agg(bf.ferramenta_id order by bf.ferramenta_id) from bot_ferramenta bf where bf.bot_id = b.id), '{}') as ferramentas
         , coalesce((select array_agg(bc.base_id order by bc.base_id) from bot_conhecimento bc where bc.bot_id = b.id), '{}') as bases
      from bot b
     inner join usuario u on u.id = b.usuario_id
      left join usuario c on c.id = b.criado_por
      left join permissao_usuario pu on pu.usuario_id = b.usuario_id
      left join permissao p on p.id = pu.permissao_id and p.uso
     where b.excluido_em is null
       ${filtro.id ? sql`and b.id = ${filtro.id}` : sql``}
       ${filtro.criadoPor ? sql`and b.criado_por = ${filtro.criadoPor}` : sql``}
     group by b.id, u.nome, u.login, c.nome
     order by lower(u.nome), b.id`
}

export async function listarBots(sql: Sql, usuario: number) {
  if (await cuidaDeTodos(sql, usuario)) {
    return linhasBots(sql, {})
  }
  await validarPermissao(sql, usuario, CodigoPermissao.Bots)
  return linhasBots(sql, { criadoPor: usuario })
}

async function botDeQuemCuida(sql: Sql, usuario: number, id: number) {
  const [bot] = await linhasBots(sql, { id })
  if (!bot) {
    throw httpErrors.notFound('Bot não encontrado!')
  }
  if (!(await cuidaDeTodos(sql, usuario))) {
    await validarPermissao(sql, usuario, CodigoPermissao.Bots)
    if (bot.criado_por !== usuario) {
      throw httpErrors.forbidden('Só quem criou o bot o edita.')
    }
  }
  return bot
}

function nomeValido(nome: string) {
  const limpo = nome.trim()
  if (!limpo || limpo.length > LIMITE_NOME) {
    throw httpErrors.badRequest(`O nome do bot deve ter entre 1 e ${LIMITE_NOME} caracteres.`)
  }
  return limpo
}

function instrucoesValidas(instrucoes: string) {
  const limpas = instrucoes.trim()
  if (!limpas || limpas.length > LIMITE_INSTRUCOES) {
    throw httpErrors.badRequest(`As instruções do bot devem ter entre 1 e ${LIMITE_INSTRUCOES} caracteres.`)
  }
  return limpas
}

export async function criarBot(sql: Sql, usuario: number, corpo: Corpo<'criarBot'>) {
  await validarPermissao(sql, usuario, CodigoPermissao.Bots)
  return incluirBot(sql, usuario, corpo.nome, corpo.instrucoes)
}

// Tambem pelo cadastro de usuarios do administrador (permissao "usuarios")
export async function incluirBot(sql: Sql, usuario: number, nomePedido: string, instrucoesPedidas: string) {
  if (!iaConfigurada()) {
    throw httpErrors.badRequest('IA não configurada: defina o endereço e o modelo nas configurações do sistema.')
  }
  const nome = nomeValido(nomePedido)
  const instrucoes = instrucoesValidas(instrucoesPedidas)
  const slug = nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'bot'
  const login = `bot-${slug}-${randomUUID().slice(0, 6)}`
  // Senha que ninguem sabe: o login de bot e recusado de qualquer jeito
  const senha = await gerarHash(randomUUID())
  const meus = await minhasPermissoes(sql, usuario)
  const id = await transacao(sql, async () => {
    const conta = await inserir(sql, 'usuario', { nome, login, email: `${login}@bot.conversa`, senha }, ['nome', 'login', 'email', 'senha'])
    const [bot] = await sql<{ id: number }[]>`insert into bot (usuario_id, instrucoes) values (${conta.id}, ${instrucoes}) returning id`
    const iniciais = PERMISSOES_INICIAIS.filter((codigo) => meus.includes(codigo))
    if (iniciais.length) {
      await sql`
        insert into permissao_usuario (usuario_id, permissao_id)
        select ${conta.id}, id from permissao where codigo in ${sql(iniciais)}`
    }
    return bot!.id
  })
  const [bot] = await linhasBots(sql, { id })
  notificarContatos()
  return bot!
}

export async function alterarBot(sql: Sql, usuario: number, corpo: Corpo<'alterarBot'>) {
  const bot = await botDeQuemCuida(sql, usuario, corpo.id)
  const nome = corpo.nome === undefined ? undefined : nomeValido(corpo.nome)
  const instrucoes = corpo.instrucoes === undefined ? undefined : instrucoesValidas(corpo.instrucoes)
  await transacao(sql, async () => {
    if (nome !== undefined) await sql`update usuario set nome = ${nome} where id = ${bot.usuario_id}`
    if (instrucoes !== undefined) await sql`update bot set instrucoes = ${instrucoes} where id = ${bot.id}`
    if (corpo.ativo !== undefined) await sql`update bot set ativo = ${corpo.ativo} where id = ${bot.id}`
  })
  if (nome !== undefined) notificarContatos()
  const [alterado] = await linhasBots(sql, { id: bot.id })
  return alterado!
}

// Troca as permissoes de uso do bot pela lista. Quem cuida de todos libera
// qualquer uma; quem criou, so as que ele mesmo tem.
// Troca as bases de conhecimento que o bot consulta pela lista
export async function definirConhecimentoBot(sql: Sql, usuario: number, corpo: Corpo<'conhecimentoBot'>) {
  const bot = await botDeQuemCuida(sql, usuario, corpo.id)
  const pedidas = [...new Set(corpo.bases)]
  if (pedidas.length) {
    const existentes = await sql<{ id: number }[]>`select id from conhecimento_base where id in ${sql(pedidas)}`
    if (existentes.length !== pedidas.length) {
      throw httpErrors.badRequest('Base de conhecimento não encontrada.')
    }
  }
  await transacao(sql, async () => {
    await sql`delete from bot_conhecimento where bot_id = ${bot.id}`
    for (const base of pedidas) {
      await sql`insert into bot_conhecimento (bot_id, base_id) values (${bot.id}, ${base})`
    }
  })
  const [alterado] = await linhasBots(sql, { id: bot.id })
  return alterado!
}

// Troca as ferramentas externas do bot pela lista
export async function definirFerramentasBot(sql: Sql, usuario: number, corpo: Corpo<'ferramentasBot'>) {
  const bot = await botDeQuemCuida(sql, usuario, corpo.id)
  const pedidas = [...new Set(corpo.ferramentas)]
  if (pedidas.length) {
    const existentes = await sql<{ id: number }[]>`select id from ferramenta where id in ${sql(pedidas)}`
    if (existentes.length !== pedidas.length) {
      throw httpErrors.badRequest('Ferramenta não encontrada.')
    }
  }
  await transacao(sql, async () => {
    await sql`delete from bot_ferramenta where bot_id = ${bot.id}`
    for (const ferramenta of pedidas) {
      await sql`insert into bot_ferramenta (bot_id, ferramenta_id) values (${bot.id}, ${ferramenta})`
    }
  })
  const [alterado] = await linhasBots(sql, { id: bot.id })
  return alterado!
}

export async function definirPermissoesBot(sql: Sql, usuario: number, corpo: Corpo<'permissoesBot'>) {
  const bot = await botDeQuemCuida(sql, usuario, corpo.id)
  const uso = (await sql<{ codigo: string }[]>`select codigo from permissao where uso`).map((linha) => linha.codigo)
  const pedidas = [...new Set(corpo.permissoes)]
  const desconhecida = pedidas.find((codigo) => !uso.includes(codigo))
  if (desconhecida) {
    throw httpErrors.badRequest(`Permissão de uso inválida: ${desconhecida}`)
  }
  if (!(await cuidaDeTodos(sql, usuario))) {
    const meus = await minhasPermissoes(sql, usuario)
    const novaSemTer = pedidas.find((codigo) => !bot.permissoes.includes(codigo) && !meus.includes(codigo))
    if (novaSemTer) {
      throw httpErrors.forbidden('Você só libera para o bot o que você mesmo pode fazer.')
    }
  }
  await transacao(sql, async () => {
    await sql`
      delete from permissao_usuario
       where usuario_id = ${bot.usuario_id}
         and permissao_id in (select id from permissao where uso ${pedidas.length ? sql`and codigo not in ${sql(pedidas)}` : sql``})`
    if (pedidas.length) {
      await sql`
        insert into permissao_usuario (usuario_id, permissao_id)
        select ${bot.usuario_id}, id from permissao where codigo in ${sql(pedidas)}
            on conflict (usuario_id, permissao_id) do nothing`
    }
  })
  const [alterado] = await linhasBots(sql, { id: bot.id })
  return alterado!
}

// Sai dos grupos e perde as permissoes. Sem historico, o bot e o
// usuario sao apagados de vez; com historico (mensagens, reacoes...), o usuario
// fica, para o que ele escreveu continuar com o nome, e o bot fica marcado como
// excluido: some dos contatos e das telas e nao responde mais.
export async function excluirBot(sql: Sql, usuario: number, id: number) {
  const bot = await botDeQuemCuida(sql, usuario, id)
  const apagado = await transacao(sql, async () => {
    // A caixa de entrada do bot (status de entrega e atividades) e dele: sai junto
    await sql`delete from mensagem_status where usuario_id = ${bot.usuario_id}`
    await sql`delete from atividade where usuario_id = ${bot.usuario_id}`
    // Sai dos grupos. Das conversas diretas so sai se for apagado de vez: com
    // historico, a conversa continua com o nome dele (sem ele, mostraria o da pessoa)
    await sql`
      delete from conversa_usuario
       where usuario_id = ${bot.usuario_id}
         and conversa_id in (select id from conversa where tipo <> 1)`
    await sql`delete from permissao_usuario where usuario_id = ${bot.usuario_id}`
    await sql`savepoint apagar_bot`
    try {
      await sql`delete from conversa_usuario where usuario_id = ${bot.usuario_id}`
      await sql`delete from bot where id = ${bot.id}`
      await sql`delete from usuario where id = ${bot.usuario_id}`
      return true
    } catch (erro) {
      if ((erro as { code?: string }).code !== '23503') throw erro
      await sql`rollback to savepoint apagar_bot`
      await sql`update bot set excluido_em = now(), ativo = false where id = ${bot.id}`
      return false
    }
  })
  notificarContatos()
  return { id: bot.id, apagado }
}

export async function ehBot(sql: Sql, usuario: number) {
  const [linha] = await sql`select 1 from bot where usuario_id = ${usuario}`
  return !!linha
}

// --- Quando o bot age ---

interface BotAtivo {
  usuario_id: number
}

// Chamado depois de cada mensagem que sai (na hora ou agendada que amadureceu).
// Nao espera o bot: a resposta vem em segundo plano.
export function aoNovaMensagem(conversa: number, mensagem: number, autor: number) {
  if (!iaConfigurada()) return
  const busca = comUsuario(0, (sql) => botsChamados(sql, conversa, mensagem, autor))
    .then((bots) => bots.forEach((bot) => agendar(bot, conversa, mensagem)))
    .catch((erro) => console.error('[BOT] Falha ao ver se algum bot foi chamado:', erro))
  emAndamento.add(busca)
  void busca.finally(() => emAndamento.delete(busca))
}

async function botsChamados(sql: Sql, conversa: number, mensagem: number, autor: number): Promise<BotAtivo[]> {
  // Bot nao responde a bot: dois deles no mesmo grupo nao conversam sem fim
  if (await ehBot(sql, autor)) return []
  const bots = await sql<BotAtivo[]>`
    select b.usuario_id
      from bot b
     inner join conversa_usuario cu on cu.usuario_id = b.usuario_id and cu.conversa_id = ${conversa}
     where b.ativo and b.excluido_em is null`
  if (!bots.length) return []
  const [dados] = await sql<{ tipo: number; respondido: number | null; textos: string | null }[]>`
    select c.tipo
         , (select o.usuario_id
              from mensagem_referencia mr
             inner join mensagem o on o.id = mr.destino_mensagem_id
             where mr.origem_mensagem_id = ${mensagem} and mr.tipo = 1) as respondido
         , (select string_agg(convert_from(mc.conteudo, 'utf-8'), E'\n')
              from mensagem_conteudo mc
             where mc.mensagem_id = ${mensagem} and mc.tipo = 1) as textos
      from conversa c
     where c.id = ${conversa}`
  if (!dados) return []
  const mencionados = idsMencionados(dados.textos ?? '')
  return bots.filter((bot) => dados.tipo === 1 || mencionados.includes(bot.usuario_id) || dados.respondido === bot.usuario_id)
}

// Um bot por vez em cada conversa: mensagens que chegam enquanto ele pensa
// viram uma resposta so, a da mais nova
const filas = new Map<string, { pendente: number | null }>()
const emAndamento = new Set<Promise<void>>()

function agendar(bot: BotAtivo, conversa: number, mensagem: number) {
  const chave = `${bot.usuario_id}:${conversa}`
  const fila = filas.get(chave)
  if (fila) {
    fila.pendente = mensagem
    return
  }
  const estado = { pendente: null as number | null }
  filas.set(chave, estado)
  const tarefa = (async () => {
    let atual: number | null = mensagem
    try {
      while (atual) {
        await responder(bot.usuario_id, conversa, atual).catch((erro) => console.error(`[BOT] O bot ${bot.usuario_id} falhou ao responder:`, erro))
        atual = estado.pendente
        estado.pendente = null
      }
    } finally {
      filas.delete(chave)
    }
  })()
  emAndamento.add(tarefa)
  void tarefa.finally(() => emAndamento.delete(tarefa))
}

// Para os testes: espera os bots terminarem o que estao fazendo
export async function esperarBots() {
  while (emAndamento.size) {
    await Promise.all([...emAndamento])
  }
}

// --- O que o bot ve ---

const LIMITE_HISTORICO = 30
const LIMITE_POR_MENSAGEM = 1500
const RODADAS = 5
const INTERVALO_DIGITANDO_MS = 3000
const LIMITE_MOTIVO_FALHA = 300
// Cada pedido do bot ao modelo: modelo local que "pensa" pode gerar sem parar
const TEMPO_LIMITE_PEDIDO_MS = 2 * 60 * 1000
const LIMITE_TOKENS = 2000

interface Contexto {
  nome: string
  instrucoes: string
  permissoes: string[]
  tipoConversa: number
  conversaNome: string
  membros: { id: number; nome: string }[]
  conversas: { id: number; nome: string }[]
  historico: string
  externas: FerramentaExterna[]
  // Bases de conhecimento ligadas (com a IA de embeddings configurada)
  bases: { id: number; nome: string; descricao: string }[]
  gatilho: { id: number; autor: string; postagem_id: number | null }
}

interface LinhaHistorico {
  id: number
  usuario_id: number
  autor: string
  quando: Date
  respondendo: number | null
  tipo: number
  conteudo: string | null
  anexo: string | null
  transcricao: string | null
  pergunta: string | null
}

async function carregarContexto(sql: Sql, bot: number, conversa: number, mensagem: number): Promise<Contexto | null> {
  const [dados] = await sql<{ nome: string; instrucoes: string; ativo: boolean; tipo: number; descricao: string | null }[]>`
    select u.nome, b.instrucoes, b.ativo, c.tipo, c.descricao
      from bot b
     inner join usuario u on u.id = b.usuario_id
     cross join conversa c
     where b.usuario_id = ${bot} and c.id = ${conversa}`
  const [gatilho] = await sql<{ id: number; autor: string; postagem_id: number | null }[]>`
    select m.id, u.nome as autor, m.postagem_id
      from mensagem m
     inner join usuario u on u.id = m.usuario_id
     where m.id = ${mensagem} and m.conversa_id = ${conversa} and m.excluida_em is null`
  if (!dados?.ativo || !gatilho) return null

  const membros = await sql<{ id: number; nome: string }[]>`
    select u.id, u.nome
      from conversa_usuario cu
     inner join usuario u on u.id = cu.usuario_id
     where cu.conversa_id = ${conversa}
     order by lower(u.nome)`
  const conversas = await sql<{ id: number; nome: string }[]>`
    select c.id
         , coalesce(nullif(c.descricao, ''), (select u.nome
                                                from conversa_usuario o
                                               inner join usuario u on u.id = o.usuario_id
                                               where o.conversa_id = c.id and o.usuario_id <> ${bot}
                                               limit 1), 'Conversa') as nome
      from conversa_usuario cu
     inner join conversa c on c.id = cu.conversa_id
     where cu.usuario_id = ${bot}
     order by c.id desc
     limit 30`
  // Resposta de postagem: o bot ve a postagem e as respostas; fora dela, o fluxo do chat
  const daPostagem = gatilho.postagem_id
    ? sql`and (m.id = ${gatilho.postagem_id} or m.postagem_id = ${gatilho.postagem_id})`
    : sql`and m.postagem_id is null`
  const quando = sql`coalesce(m.visivel_em, m.inserida)`
  const linhas = await sql<LinhaHistorico[]>`
    with escolhidas as
         ( select m.id
             from mensagem m
            where m.conversa_id = ${conversa}
              and m.excluida_em is null
              and (m.visivel_em is null or m.visivel_em <= now())
              ${daPostagem}
            order by ${quando} desc, m.id desc
            limit ${LIMITE_HISTORICO}
         )
  select m.id
       , m.usuario_id
       , u.nome as autor
       , ${quando} as quando
       , mr.destino_mensagem_id as respondendo
       , mc.tipo
       , convert_from(mc.conteudo, 'utf-8') as conteudo
       , a.nome as anexo
       , t.transcricao
       , e.pergunta
    from escolhidas es
   inner join mensagem m on m.id = es.id
   inner join usuario u on u.id = m.usuario_id
   inner join mensagem_conteudo mc on mc.mensagem_id = m.id
    left join mensagem_referencia mr on mr.origem_mensagem_id = m.id and mr.tipo = 1
    left join anexo a on mc.tipo in (2, 3, 4, 5) and a.identificador = convert_from(mc.conteudo, 'utf-8')
    left join anexo_audio t on mc.tipo in (4, 5) and t.identificador = convert_from(mc.conteudo, 'utf-8') and t.transcricao_status = 2
    left join enquete e on mc.tipo = 8 and e.id::text = convert_from(mc.conteudo, 'utf-8')
   order by ${quando}, m.id, mc.ordem`

  const outro = membros.find((membro) => membro.id !== bot)
  return {
    nome: dados.nome,
    instrucoes: dados.instrucoes,
    permissoes: await minhasPermissoes(sql, bot),
    tipoConversa: dados.tipo,
    conversaNome: dados.tipo === 1 ? `conversa direta com ${outro?.nome ?? 'uma pessoa'}` : `grupo "${dados.descricao ?? ''}"`,
    membros,
    conversas,
    historico: montarHistorico(linhas, bot),
    externas: await ferramentasExternasDoBot(sql, bot),
    bases: conhecimentoLigado()
      ? await sql<{ id: number; nome: string; descricao: string }[]>`
          select cb.id, cb.nome, cb.descricao
            from bot_conhecimento bc
           inner join bot b on b.id = bc.bot_id
           inner join conhecimento_base cb on cb.id = bc.base_id
           where b.usuario_id = ${bot}
           order by cb.nome`
      : [],
    gatilho,
  }
}

// "[12] 09/10 14:32 Ana (respondendo [10]): texto". A mencao fica como
// @[Nome](id), o formato que o bot usa para mencionar.
function montarHistorico(linhas: LinhaHistorico[], bot: number) {
  const porMensagem = new Map<number, { cabecalho: string; partes: string[] }>()
  for (const linha of linhas) {
    let mensagem = porMensagem.get(linha.id)
    if (!mensagem) {
      const data = new Date(linha.quando).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(',', '')
      const autor = linha.usuario_id === bot ? `${linha.autor} (você)` : linha.autor
      mensagem = { cabecalho: `[${linha.id}] ${data} ${autor}${linha.respondendo ? ` (respondendo [${linha.respondendo}])` : ''}:`, partes: [] }
      porMensagem.set(linha.id, mensagem)
    }
    const parte = linha.tipo === 1
      ? (linha.conteudo ?? '').replace(/\s+/g, ' ').trim()
      : linha.tipo === 7 ? `[figurinha: ${nomeFigurinha(linha.conteudo ?? '')}]` : descreverConteudo(linha)
    if (parte) mensagem.partes.push(parte)
  }
  return [...porMensagem.entries()]
    .filter(([, { partes }]) => partes.length)
    .map(([, { cabecalho, partes }]) => `${cabecalho} ${partes.join(' ').slice(0, LIMITE_POR_MENSAGEM)}`)
    .join('\n')
}

// --- Figurinhas: o pacote Noto, o mesmo do seletor da pagina
// (conversa-web/src/utils/figurinhasNoto.ts) ---

const FIGURINHAS: [string, string][] = [
  ['noto/chorando-de-rir', 'Chorando de rir'], ['noto/rolando-de-rir', 'Rolando de rir'], ['noto/sorriso', 'Sorriso'], ['noto/ufa', 'Ufa'],
  ['noto/piscadinha', 'Piscadinha'], ['noto/apaixonado', 'Apaixonado'], ['noto/cheio-de-amor', 'Cheio de amor'], ['noto/beijinho', 'Beijinho'],
  ['noto/legal', 'Legal'], ['noto/deslumbrado', 'Deslumbrado'], ['noto/festejando', 'Festejando'], ['noto/abraco', 'Abraço'], ['noto/ops', 'Ops'],
  ['noto/pensando', 'Pensando'], ['noto/desconfiado', 'Desconfiado'], ['noto/revirando-os-olhos', 'Revirando os olhos'],
  ['noto/de-cabeca-para-baixo', 'De cabeça para baixo'], ['noto/envergonhado', 'Envergonhado'], ['noto/por-favorzinho', 'Por favorzinho'],
  ['noto/triste', 'Triste'], ['noto/chorando', 'Chorando'], ['noto/bravo', 'Bravo'], ['noto/assustado', 'Assustado'],
  ['noto/cabeca-explodindo', 'Cabeça explodindo'], ['noto/bocejando', 'Bocejando'], ['noto/dormindo', 'Dormindo'], ['noto/doente', 'Doente'],
  ['noto/morri', 'Morri'], ['noto/palhaco', 'Palhaço'], ['noto/fantasma', 'Fantasma'], ['noto/joinha', 'Joinha'], ['noto/negativo', 'Negativo'],
  ['noto/palmas', 'Palmas'], ['noto/aleluia', 'Aleluia'], ['noto/por-favor', 'Por favor'], ['noto/tchau', 'Tchau'], ['noto/forca', 'Força'],
  ['noto/combinado', 'Combinado'], ['noto/paz', 'Paz'], ['noto/de-olho', 'De olho'], ['noto/coracao', 'Coração'],
  ['noto/coracao-partido', 'Coração partido'], ['noto/fogo', 'Fogo'], ['noto/cem', 'Cem'], ['noto/brilhos', 'Brilhos'], ['noto/festa', 'Festa'],
  ['noto/confete', 'Confete'], ['noto/presente', 'Presente'], ['noto/bolo', 'Bolo'], ['noto/foguete', 'Foguete'], ['noto/ideia', 'Ideia'],
  ['noto/raio', 'Raio'], ['noto/arco-iris', 'Arco-íris'], ['noto/cafe', 'Café'], ['noto/brinde', 'Brinde'],
]

function nomeFigurinha(id: string) {
  return FIGURINHAS.find(([chave]) => chave === id)?.[1] ?? 'figurinha'
}

// --- Ferramentas: cada uma so aparece com a permissao, e o servidor confere de novo ---

const inteiro = { type: 'integer' }
const texto = { type: 'string' }

function ferramentasDoBot(contexto: Contexto): Ferramenta[] {
  const pode = (codigo: string) => contexto.permissoes.includes(codigo)
  const lista: (Ferramenta | false)[] = [
    pode(CodigoPermissao.Reagir) && {
      type: 'function',
      function: {
        name: 'reagir',
        description: 'Reage a uma mensagem com um emoji (como 👍, ❤️, 😂). Use quando uma reação basta ou para acompanhar a resposta.',
        parameters: { type: 'object', properties: { mensagem_id: inteiro, emoji: texto }, required: ['mensagem_id', 'emoji'] },
      },
    },
    pode(CodigoPermissao.Responder) && {
      type: 'function',
      function: {
        name: 'responder_mensagem',
        description: 'Envia um texto como resposta a uma mensagem específica (aparece citando ela). Para responder à mensagem que te chamou, basta escrever a resposta normalmente.',
        parameters: { type: 'object', properties: { mensagem_id: inteiro, texto }, required: ['mensagem_id', 'texto'] },
      },
    },
    pode(CodigoPermissao.Figurinha) && {
      type: 'function',
      function: {
        name: 'enviar_figurinha',
        description: `Envia uma figurinha animada. Opções: ${FIGURINHAS.map(([id, nome]) => `${id} (${nome})`).join(', ')}.`,
        parameters: { type: 'object', properties: { figurinha: { type: 'string', enum: FIGURINHAS.map(([id]) => id) } }, required: ['figurinha'] },
      },
    },
    pode(CodigoPermissao.Encaminhar) && {
      type: 'function',
      function: {
        name: 'encaminhar_mensagem',
        description: 'Encaminha uma mensagem desta conversa para outra conversa em que você está.',
        parameters: { type: 'object', properties: { mensagem_id: inteiro, conversa_id: inteiro }, required: ['mensagem_id', 'conversa_id'] },
      },
    },
    pode(CodigoPermissao.Votacao) && contexto.tipoConversa === 2 && {
      type: 'function',
      function: {
        name: 'criar_votacao',
        description: 'Cria uma votação no grupo.',
        parameters: {
          type: 'object',
          properties: { pergunta: texto, opcoes: { type: 'array', items: texto, minItems: 2, maxItems: 12 }, multipla: { type: 'boolean', description: 'Se cada pessoa pode escolher mais de uma opção' } },
          required: ['pergunta', 'opcoes'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'buscar_mensagens',
        description: 'Procura mensagens antigas desta conversa que contenham o texto.',
        parameters: { type: 'object', properties: { texto }, required: ['texto'] },
      },
    },
  ]
  // Base de conhecimento: com mais de uma, o modelo pode escolher qual
  const conhecimento: Ferramenta[] = contexto.bases.length
    ? [ferramentaConhecimento(contexto.bases)]
    : []
  // As externas ligadas no bot, com os parametros cadastrados
  const externas: Ferramenta[] = contexto.externas.map((externa) => ({
    type: 'function',
    function: {
      name: externa.nome,
      description: externa.descricao,
      parameters: {
        type: 'object',
        properties: Object.fromEntries(externa.parametros.map((p) => [p.nome, { type: p.tipo, ...(p.descricao ? { description: p.descricao } : {}) }])),
        required: externa.parametros.filter((p) => p.obrigatorio).map((p) => p.nome),
      },
    },
  }))
  return [...lista.filter((ferramenta): ferramenta is Ferramenta => !!ferramenta), ...conhecimento, ...externas]
}

// A ferramenta da base de conhecimento, como o modelo a recebe: a descricao
// cita as bases ligadas no bot; com mais de uma, ele pode escolher qual
export function ferramentaConhecimento(bases: { nome: string; descricao: string }[]): Ferramenta {
  return {
    type: 'function',
    function: {
      name: 'consultar_conhecimento',
      description: `Procura na base de conhecimento (${bases.map((b) => `${b.nome}${b.descricao ? `: ${b.descricao}` : ''}`).join('; ')}) os trechos de documentos que respondem à pergunta.`,
      parameters: {
        type: 'object',
        properties: {
          pergunta: { type: 'string', description: 'O que procurar, em poucas palavras' },
          ...(bases.length > 1 ? { base: { type: 'string', enum: bases.map((b) => b.nome), description: 'Em qual base procurar (sem ela, em todas)' } } : {}),
        },
        required: ['pergunta'],
      },
    },
  }
}

// Para a tela de ferramentas: as embutidas, so para ver como e uma
// configuracao de verdade. A definicao e a que o modelo recebe, montada com
// as bases que existem (ou duas de exemplo, sem nenhuma)
export async function ferramentasEmbutidas(sql: Sql, usuario: number) {
  await validarPermissao(sql, usuario, CodigoPermissao.Ferramentas)
  const existentes = await sql<{ nome: string; descricao: string }[]>`select nome, descricao from conhecimento_base order by lower(nome)`
  const bases = existentes.length ? existentes : [{ nome: 'RH', descricao: 'Políticas de férias e benefícios' }, { nome: 'Suporte', descricao: 'Manuais dos sistemas' }]
  const definicao = ferramentaConhecimento(bases)
  return [{
    nome: definicao.function.name,
    descricao: definicao.function.description,
    origem: 'Interna: busca no Qdrant os trechos das bases ligadas ao bot (IA › Conhecimento). Não chama endereço externo e não tem cabeçalhos.',
    parametros: [
      { nome: 'pergunta', tipo: 'string' as const, descricao: 'O que procurar, em poucas palavras', obrigatorio: true },
      { nome: 'base', tipo: 'string' as const, descricao: 'Em qual base procurar (sem ela, em todas). Só aparece quando o bot tem mais de uma base, com os nomes delas', obrigatorio: false },
    ],
    definicao,
  }]
}

const NOMES_PERMISSAO: Record<string, string> = {
  [CodigoPermissao.Emoji]: 'usar emojis no texto',
  [CodigoPermissao.Figurinha]: 'enviar figurinhas',
  [CodigoPermissao.Responder]: 'responder citando mensagens',
  [CodigoPermissao.Encaminhar]: 'encaminhar mensagens',
  [CodigoPermissao.Reagir]: 'reagir às mensagens',
  [CodigoPermissao.Votacao]: 'criar votações',
}

function instrucoesDoSistema(contexto: Contexto) {
  const naoPode = Object.entries(NOMES_PERMISSAO).filter(([codigo]) => !contexto.permissoes.includes(codigo)).map(([, nome]) => nome)
  const linhas = [
    `Você é ${contexto.nome}, um bot no Conversa, um chat de trabalho. Fale em português do Brasil, a não ser que as instruções abaixo digam outra coisa.`,
    '',
    'Instruções de quem te criou (sua personalidade e o que você faz):',
    '"""',
    contexto.instrucoes,
    '"""',
    '',
    'Como funciona:',
    '- Você recebe as mensagens recentes da conversa, cada uma com o número entre colchetes, e atende à mensagem que te chamou.',
    '- O texto que você escrever é enviado na conversa como mensagem sua. Se não houver o que dizer (por exemplo, só reagiu), responda com texto vazio.',
    '- As ferramentas fazem o que uma pessoa faz no chat. Use quando fizer sentido, sem anunciar que vai usar.',
    '- Para mencionar alguém, escreva @[Nome](id), com o nome e o id da lista de participantes.',
    '- Seja breve, como numa conversa de chat.',
    ...(naoPode.length ? [`- Você não tem permissão para: ${naoPode.join(', ')}.`] : []),
    ...(contexto.permissoes.includes(CodigoPermissao.Emoji) ? [] : ['- Não escreva emojis no texto.']),
    ...(contexto.bases.length
      ? ['- Para dúvidas sobre o que está nos documentos, use consultar_conhecimento e responda com base nos trechos, dizendo de qual documento veio; se não estiver lá, diga que não sabe.']
      : []),
    ...(contexto.externas.length
      ? [`- Para informações de fora do chat, use as ferramentas ${contexto.externas.map((f) => f.nome).join(', ')} e responda com base no que elas devolverem, sem inventar.`]
      : []),
    '',
    `Conversa: ${contexto.conversaNome}.`,
    `Participantes: ${contexto.membros.map((membro) => `${membro.nome} (id ${membro.id})`).join(', ')}.`,
    ...(contexto.permissoes.includes(CodigoPermissao.Encaminhar) && contexto.conversas.length
      ? [`Conversas em que você está (para encaminhar): ${contexto.conversas.map((c) => `${c.nome} (id ${c.id})`).join(', ')}.`]
      : []),
    `Agora: ${new Date().toLocaleString('pt-BR')}.`,
  ]
  return linhas.join('\n')
}

// --- A resposta ---

const EMOJI = /[\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}️‍]/gu

async function responder(bot: number, conversa: number, mensagem: number) {
  const contexto = await comUsuario(bot, async (sql) => {
    const carregado = await carregarContexto(sql, bot, conversa, mensagem)
    if (carregado) await marcarStatus(sql, bot, { conversa, mensagem }, 'visualizada').catch(() => {})
    return carregado
  })
  if (!contexto) return

  const digitando = () => comUsuario(bot, (sql) => avisarAtividade(sql, bot, conversa, TipoMensagemSocket.Digitando)).catch(() => {})
  void digitando()
  const relogio = setInterval(() => void digitando(), INTERVALO_DIGITANDO_MS)
  const estado = { enviou: false }
  try {
    const ferramentas = ferramentasDoBot(contexto)
    const conversaDoModelo: MensagemComFerramentas[] = [
      { role: 'system', content: instrucoesDoSistema(contexto) },
      {
        role: 'user',
        content: `Mensagens recentes (a mais nova por último):\n${contexto.historico}\n\nAtenda à mensagem [${contexto.gatilho.id}] de ${contexto.gatilho.autor}.`,
      },
    ]
    for (let rodada = 0; rodada < RODADAS; rodada++) {
      const resposta = await completarComFerramentas(conversaDoModelo, rodada < RODADAS - 1 ? ferramentas : [], {
        tempoLimiteMs: TEMPO_LIMITE_PEDIDO_MS,
        maxTokens: LIMITE_TOKENS,
      })
      if (!resposta.chamadas.length) {
        const final = resposta.texto.trim()
        if (final && !estado.enviou) await enviarTexto(bot, conversa, contexto, final, contexto.tipoConversa === 1 ? null : contexto.gatilho.id)
        return
      }
      conversaDoModelo.push({ role: 'assistant', content: resposta.texto || null, tool_calls: resposta.chamadas })
      for (const chamada of resposta.chamadas) {
        const resultado = await executar(bot, conversa, contexto, chamada.function.name, chamada.function.arguments, estado)
        conversaDoModelo.push({ role: 'tool', tool_call_id: chamada.id, content: JSON.stringify(resultado) })
      }
      // Já respondeu: termina aqui. Outra rodada só atrasaria (e o modelo
      // costuma devolver um texto sobre o que fez, que não é para enviar)
      if (estado.enviou) return
    }
  } catch (erro) {
    console.error(`[BOT] O bot ${bot} falhou ao responder:`, erro)
    // Quem já recebeu a resposta não precisa saber de uma falha depois dela
    if (!estado.enviou) await avisarFalha(bot, conversa, contexto, erro)
  } finally {
    clearInterval(relogio)
  }
}

// Quem chamou o bot fica sabendo que ele falhou (servidor de IA fora do ar,
// demora demais...), na conversa, citando a mensagem que ficou sem resposta
async function avisarFalha(bot: number, conversa: number, contexto: Contexto, erro: unknown) {
  const motivo = (erro instanceof Error ? erro.message : String(erro)).replace(/\s+/g, ' ').trim().slice(0, LIMITE_MOTIVO_FALHA)
  const texto = `Não consegui responder a esta mensagem${motivo ? `: ${motivo}` : '.'}`
  await enviarTexto(bot, conversa, contexto, texto, contexto.gatilho.id)
    .catch((falha) => console.error(`[BOT] O bot ${bot} também não conseguiu avisar a falha:`, falha))
}

type Resultado = { ok: true; [campo: string]: unknown } | { erro: string }

async function executar(bot: number, conversa: number, contexto: Contexto, nome: string, argumentosJson: string, estado: { enviou: boolean }): Promise<Resultado> {
  let argumentos: Record<string, unknown>
  try {
    argumentos = JSON.parse(argumentosJson || '{}') as Record<string, unknown>
  } catch {
    return { erro: 'Argumentos inválidos (JSON).' }
  }
  const numero = (campo: string) => Number(argumentos[campo])
  const textoDe = (campo: string) => String(argumentos[campo] ?? '').trim()
  try {
    switch (nome) {
      case 'reagir':
        return await comUsuario(bot, async (sql) => {
          await validarMensagemDaConversa(sql, numero('mensagem_id'), conversa)
          const [existe] = await sql`select 1 from reacao where mensagem_id = ${numero('mensagem_id')} and usuario_id = ${bot} and emoji = ${textoDe('emoji')}`
          // Reagir de novo com o mesmo emoji tiraria a reação: so acrescenta
          if (!existe) await alternarReacao(sql, bot, { mensagem_id: numero('mensagem_id'), emoji: textoDe('emoji') })
          return { ok: true as const }
        })
      case 'responder_mensagem': {
        await comUsuario(bot, (sql) => validarMensagemDaConversa(sql, numero('mensagem_id'), conversa))
        await enviarTexto(bot, conversa, contexto, textoDe('texto'), numero('mensagem_id'))
        estado.enviou = true
        return { ok: true }
      }
      case 'enviar_figurinha': {
        const figurinha = textoDe('figurinha')
        if (!FIGURINHAS.some(([id]) => id === figurinha)) return { erro: 'Figurinha que não existe.' }
        await enviar(bot, conversa, contexto, [{ ordem: 1, tipo: 7, conteudo: figurinha }], null)
        return { ok: true }
      }
      case 'encaminhar_mensagem':
        return await comUsuario(bot, async (sql) => {
          await validarMensagemDaConversa(sql, numero('mensagem_id'), conversa)
          await validarAcessoConversa(sql, bot, numero('conversa_id'))
          const conteudos = await sql<{ ordem: number; tipo: number; conteudo: string | null }[]>`
            select ordem, tipo, convert_from(conteudo, 'utf-8') as conteudo
              from mensagem_conteudo where mensagem_id = ${numero('mensagem_id')} order by ordem`
          await incluirMensagem(sql, bot, {
            conversa_id: numero('conversa_id'),
            conteudos,
            mensagem_referencia: { tipo: 2, origem_mensagem_id: numero('mensagem_id') },
          })
          return { ok: true as const }
        })
      case 'criar_votacao':
        return await comUsuario(bot, async (sql) => {
          const opcoes = Array.isArray(argumentos.opcoes) ? argumentos.opcoes.map((opcao) => String(opcao).trim()).filter(Boolean) : []
          const enquete = await criarEnquete(sql, bot, { conversa_id: conversa, pergunta: textoDe('pergunta'), opcoes, multipla: argumentos.multipla === true, encerra_em: null })
          estado.enviou = true
          return { ok: true as const, votacao: enquete }
        })
      case 'buscar_mensagens':
        return await comUsuario(bot, async (sql) => {
          const busca = textoDe('texto')
          if (!busca) return { erro: 'Texto vazio.' }
          const achadas = await sql<{ id: number; autor: string; texto: string }[]>`
            select m.id, u.nome as autor, left(convert_from(mc.conteudo, 'utf-8'), 300) as texto
              from mensagem m
             inner join usuario u on u.id = m.usuario_id
             inner join mensagem_conteudo mc on mc.mensagem_id = m.id and mc.tipo = 1
             where m.conversa_id = ${conversa}
               and m.excluida_em is null
               and (m.visivel_em is null or m.visivel_em <= now())
               and convert_from(mc.conteudo, 'utf-8') ilike ${`%${busca.replace(/[%_\\]/g, '\\$&')}%`}
             order by m.id desc
             limit 15`
          return { ok: true as const, mensagens: achadas }
        })
      case 'consultar_conhecimento': {
        const escolhida = contexto.bases.find((b) => b.nome === textoDe('base'))
        const trechos = await buscarTrechos(escolhida ? [escolhida.id] : contexto.bases.map((b) => b.id), textoDe('pergunta'))
        return { ok: true, trechos: trechos.map(({ documento, texto }) => ({ documento, texto })) }
      }
      default: {
        const externa = contexto.externas.find((f) => f.nome === nome)
        if (!externa) return { erro: `Ferramenta desconhecida: ${nome}` }
        const { status, resposta } = await chamarFerramenta(externa, argumentos)
        return status >= 200 && status < 300 ? { ok: true, resposta } : { erro: `A ferramenta respondeu ${status}: ${resposta.slice(0, 500)}` }
      }
    }
  } catch (erro) {
    return { erro: erro instanceof Error ? erro.message : String(erro) }
  }
}

async function validarMensagemDaConversa(sql: Sql, mensagem: number, conversa: number) {
  const [linha] = await sql`select 1 from mensagem where id = ${mensagem} and conversa_id = ${conversa} and excluida_em is null`
  if (!linha) {
    throw httpErrors.notFound(`A mensagem [${mensagem}] não está nesta conversa.`)
  }
}

// Texto com emoji sem a permissao: vai sem os emojis, em vez de nao ir
async function enviarTexto(bot: number, conversa: number, contexto: Contexto, conteudo: string, respondendo: number | null) {
  const texto = contexto.permissoes.includes(CodigoPermissao.Emoji) ? conteudo : conteudo.replace(EMOJI, '').replace(/[ \t]{2,}/g, ' ').trim()
  if (!texto) return
  await enviar(bot, conversa, contexto, [{ ordem: 1, tipo: 1, conteudo: texto }], respondendo)
}

// Sem a permissao de responder, a resposta vai sem citar a mensagem
async function enviar(bot: number, conversa: number, contexto: Contexto, conteudos: Corpo<'incluirMensagem'>['conteudos'], respondendo: number | null) {
  const cita = respondendo && contexto.permissoes.includes(CodigoPermissao.Responder)
  await comUsuario(bot, (sql) => incluirMensagem(sql, bot, {
    conversa_id: conversa,
    conteudos,
    ...(cita ? { mensagem_referencia: { tipo: 1, origem_mensagem_id: respondendo } } : {}),
    ...(contexto.gatilho.postagem_id ? { postagem_id: contexto.gatilho.postagem_id } : {}),
  }))
}

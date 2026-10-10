// Schemas de validacao das rotas (TypeBox, o validador do Elysia). A requisicao
// fora deles e rejeitada com 400 antes do handler, e a consulta ja chega
// convertida, como ?conversa=5 virando numero. Os mesmos schemas dao o tipo do
// corpo e da consulta de cada rota, a documentacao OpenAPI e os tipos do
// cliente (Eden) na pagina.
import { t, type Static, type TSchema } from 'elysia'

const inteiro = t.Integer()
const texto = t.String()
const opcional = <T extends TSchema>(esquema: T) => t.Optional(esquema)
const ouNulo = <T extends TSchema>(esquema: T) => t.Optional(t.Nullable(esquema))
const inteiroPadraoZero = t.Integer({ default: 0 })
const textoPadraoVazio = t.String({ default: '' })
const paginacao = t.Integer({ default: 0, minimum: 0, maximum: 1000 })

const soId = t.Object({ id: inteiro })

const camposSip = {
  sip_user: texto,
  auth_user: ouNulo(texto),
  sip_password: texto,
  display_name: ouNulo(texto),
  domain: texto,
  ws_server: texto,
  ativo: opcional(t.Boolean()),
}

export const esquemas = {
  login: { body: t.Object({ login: texto, senha: texto, dispositivo_id: ouNulo(inteiro) }) },
  alterarSenha: { body: t.Object({ senha_atual: texto, senha: texto }) },
  alterarDispositivo: {
    body: t.Object({ id: inteiro, nome: opcional(texto), modelo: opcional(texto), versao_so: opcional(texto), plataforma: opcional(texto), token_fcm: ouNulo(texto) }),
  },
  incluirDispositivoUsuario: { query: t.Object({ dispositivo_id: inteiro }) },

  incluirUsuario: { body: t.Object({ nome: texto, login: texto, email: texto, telefone: ouNulo(texto), senha: texto }) },
  alterarUsuario: { body: t.Object({ id: inteiro, nome: opcional(texto), email: opcional(texto), telefone: ouNulo(texto), avatar_anexo_id: ouNulo(inteiro), mostrar_visto_em: opcional(t.Boolean()), mostrar_na_conversa: opcional(t.Boolean()), aparecer_offline: opcional(t.Boolean()) }) },
  presentesConversa: { query: t.Object({ conversa: inteiro }) },
  incluirContato: { query: t.Object({ relacionamento_id: inteiro }) },

  idNaConsulta: { query: soId },
  idNoCorpo: { body: soId },

  incluirConversa: { body: t.Object({ descricao: ouNulo(texto), tipo: opcional(inteiro) }) },
  alterarConversa: { body: t.Object({ id: inteiro, descricao: opcional(texto), avatar_anexo_id: ouNulo(inteiro), emoji: ouNulo(texto) }) },
  membrosConversa: { query: t.Object({ conversa: inteiro }) },
  ordenarFixadas: { body: t.Object({ conversas: t.Array(inteiro) }) },
  arquivarConversa: { body: t.Object({ conversa: inteiro, arquivada: t.Boolean() }) },
  incluirMembro: { body: t.Object({ usuario_id: inteiro, conversa_id: inteiro }) },

  incluirMensagem: {
    body: t.Object({
      conversa_id: inteiro,
      visivel_em: ouNulo(texto),
      conteudos: t.Array(t.Object({ ordem: inteiro, tipo: inteiro, conteudo: t.Nullable(texto) })),
      mensagem_referencia: ouNulo(t.Object({ tipo: inteiro, origem_mensagem_id: inteiro })),
      pede_confirmacao: opcional(t.Boolean()),
    }),
  },
  mensagens: {
    query: t.Object({
      conversa: inteiro,
      mensagemreferencia: t.Integer({ default: 0, minimum: 0 }),
      mensagensprevias: paginacao,
      mensagensseguintes: paginacao,
    }),
  },
  marcarStatus: { body: t.Object({ conversa: inteiro, mensagem: inteiro }) },
  statusMensagens: { query: t.Object({ conversa: inteiro, mensagem: texto }) },
  novasMensagens: { query: t.Object({ desde: textoPadraoVazio }) },
  pesquisar: { query: t.Object({ conversa: inteiroPadraoZero, texto: textoPadraoVazio }) },
  reacao: { body: t.Object({ mensagem_id: inteiro, emoji: texto }) },
  confirmarLeitura: { body: t.Object({ mensagem_id: inteiro }) },

  identificador: { query: t.Object({ identificador: texto }) },
  transcricao: { body: t.Object({ identificador: texto }) },
  incluirAnexo: { body: t.Object({ identificador: texto, tipo: inteiro, nome: ouNulo(texto), extensao: ouNulo(texto), tamanho: inteiro }) },
  anexos: {
    query: t.Object({
      conversa: inteiroPadraoZero,
      autor: inteiroPadraoZero,
      direcao: textoPadraoVazio,
      tipos: textoPadraoVazio,
      antes: inteiroPadraoZero,
      limite: inteiroPadraoZero,
    }),
  },

  iniciarChamada: { body: t.Object({ tipo: opcional(inteiro), conversa_id: ouNulo(inteiro), usuarios: t.Array(t.Object({ id: inteiro })) }) },
  adicionarUsuarioChamada: { body: t.Object({ chamada_id: inteiro, usuario_id: inteiro }) },
  recusarChamada: { body: t.Object({ id: inteiro, nao_atendeu: opcional(t.Boolean()) }) },
  criarEnquete: {
    body: t.Object({
      conversa_id: inteiro,
      pergunta: t.String({ maxLength: 300 }),
      opcoes: t.Array(t.String({ maxLength: 200 }), { minItems: 2, maxItems: 12 }),
      multipla: t.Boolean(),
      encerra_em: ouNulo(texto),
    }),
  },
  votarEnquete: { body: t.Object({ enquete_id: inteiro, opcoes: t.Array(inteiro, { maxItems: 12 }) }) },
  encerrarEnquete: { body: t.Object({ enquete_id: inteiro }) },
  prazoEnquete: { body: t.Object({ enquete_id: inteiro, encerra_em: t.Nullable(texto) }) },
  permissaoUsuario: {
    body: t.Object({ usuario_id: inteiro, codigo: texto }),
    query: t.Object({ usuario_id: inteiro, codigo: texto }),
  },
  alterarParametros: {
    body: t.Object({
      fcm_project_id: opcional(texto),
      fcm_client_email: opcional(texto),
      fcm_private_key: opcional(texto),
      turn_forcar_relay: opcional(t.Boolean()),
      transcritor_url: opcional(texto),
      transcritor_idioma: opcional(texto),
      gravacao_dias: opcional(t.Integer({ minimum: 0, maximum: 36500 })),
      ia_url: opcional(texto),
      ia_token: opcional(texto),
      ia_modelo: opcional(texto),
    }),
  },
  testarIa: { body: t.Object({ url: texto, modelo: texto, token: opcional(texto) }) },
  pedirResumo: { body: t.Object({ conversa_id: inteiro, periodo: t.Union([t.Literal('24h'), t.Literal('7d'), t.Literal('30d'), t.Literal('recentes')]) }) },
  consultarResumo: { query: t.Object({ id: texto }) },
  atividades: { query: t.Object({ antes: inteiroPadraoZero, limite: t.Integer({ default: 30, minimum: 1, maximum: 100 }) }) },

  historicoChamadas: { query: t.Object({ participante: inteiroPadraoZero, de: textoPadraoVazio, ate: textoPadraoVazio }) },

  incluirSip: { body: t.Object(camposSip) },
  alterarSip: {
    body: t.Object({
      id: inteiro,
      sip_user: opcional(texto),
      auth_user: ouNulo(texto),
      sip_password: opcional(texto),
      display_name: ouNulo(texto),
      domain: opcional(texto),
      ws_server: opcional(texto),
      ativo: opcional(t.Boolean()),
    }),
  },
}

type Esquemas = typeof esquemas

// Corpo e consulta ja validados de cada rota, por nome do schema
export type Corpo<N extends keyof Esquemas> = Esquemas[N] extends { body: infer B extends TSchema } ? Static<B> : never
export type Consulta<N extends keyof Esquemas> = Esquemas[N] extends { query: infer Q extends TSchema } ? Static<Q> : never

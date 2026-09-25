// Schemas de validacao das rotas. O Fastify rejeita a requisicao com 400 antes
// do handler e ja converte os tipos da query string, como ?conversa=5.

const inteiro = { type: 'integer' }
const texto = { type: 'string' }
const inteiroOuNulo = { type: ['integer', 'null'] }
const textoOuNulo = { type: ['string', 'null'] }
const booleano = { type: 'boolean' }
const inteiroPadraoZero = { type: 'integer', default: 0 }
const textoPadraoVazio = { type: 'string', default: '' }

const objeto = (obrigatorios: string[], propriedades: Record<string, object> = {}) =>
  ({ type: 'object', required: obrigatorios, properties: propriedades })

const soId = objeto(['id'], { id: inteiro })
const paginacao = { type: 'integer', default: 0, minimum: 0, maximum: 1000 }

const camposSip = {
  sip_user: texto,
  auth_user: textoOuNulo,
  sip_password: texto,
  display_name: textoOuNulo,
  domain: texto,
  ws_server: texto,
  ativo: booleano,
}

export const esquemas = {
  login: { body: objeto(['login', 'senha'], { login: texto, senha: texto, dispositivo_id: inteiroOuNulo }) },
  alterarSenha: { body: objeto(['senha_atual', 'senha'], { senha_atual: texto, senha: texto }) },
  alterarDispositivo: { body: objeto(['id'], { id: inteiro, nome: texto, modelo: texto, versao_so: texto, plataforma: texto, token_fcm: textoOuNulo }) },
  incluirDispositivoUsuario: { querystring: objeto(['dispositivo_id'], { dispositivo_id: inteiro }) },

  incluirUsuario: { body: objeto(['nome', 'login', 'email', 'senha'], { nome: texto, login: texto, email: texto, telefone: textoOuNulo, senha: texto }) },
  alterarUsuario: { body: objeto(['id'], { id: inteiro, nome: texto, email: texto, telefone: textoOuNulo, avatar_anexo_id: inteiroOuNulo }) },
  incluirContato: { querystring: objeto(['relacionamento_id'], { relacionamento_id: inteiro }) },

  idNaConsulta: { querystring: soId },
  idNoCorpo: { body: soId },

  incluirConversa: { body: objeto([], { descricao: textoOuNulo, tipo: inteiro }) },
  alterarConversa: { body: objeto(['id', 'descricao'], { id: inteiro, descricao: texto }) },
  membrosConversa: { querystring: objeto(['conversa'], { conversa: inteiro }) },
  incluirMembro: { body: objeto(['usuario_id', 'conversa_id'], { usuario_id: inteiro, conversa_id: inteiro }) },

  incluirMensagem: {
    body: objeto(['conversa_id', 'conteudos'], {
      conversa_id: inteiro,
      visivel_em: textoOuNulo,
      conteudos: { type: 'array', items: objeto(['ordem', 'tipo', 'conteudo'], { ordem: inteiro, tipo: inteiro, conteudo: textoOuNulo }) },
      mensagem_referencia: { ...objeto(['tipo', 'origem_mensagem_id'], { tipo: inteiro, origem_mensagem_id: inteiro }), type: ['object', 'null'] },
    }),
  },
  mensagens: {
    querystring: objeto(['conversa'], {
      conversa: inteiro,
      mensagemreferencia: { ...inteiroPadraoZero, minimum: 0 },
      mensagensprevias: paginacao,
      mensagensseguintes: paginacao,
    }),
  },
  marcarStatus: { body: objeto(['conversa', 'mensagem'], { conversa: inteiro, mensagem: inteiro }) },
  statusMensagens: { querystring: objeto(['conversa', 'mensagem'], { conversa: inteiro, mensagem: texto }) },
  novasMensagens: { querystring: objeto([], { desde: textoPadraoVazio }) },
  pesquisar: { querystring: objeto([], { conversa: inteiroPadraoZero, texto: textoPadraoVazio }) },
  reacao: { body: objeto(['mensagem_id', 'emoji'], { mensagem_id: inteiro, emoji: texto }) },

  identificador: { querystring: objeto(['identificador'], { identificador: texto }) },
  transcricao: { body: objeto(['identificador'], { identificador: texto }) },
  incluirAnexo: { body: objeto(['identificador', 'tipo', 'tamanho'], { identificador: texto, tipo: inteiro, nome: textoOuNulo, extensao: textoOuNulo, tamanho: inteiro }) },
  anexos: {
    querystring: objeto([], {
      conversa: inteiroPadraoZero,
      autor: inteiroPadraoZero,
      direcao: textoPadraoVazio,
      tipos: textoPadraoVazio,
      antes: inteiroPadraoZero,
      limite: inteiroPadraoZero,
    }),
  },

  iniciarChamada: { body: objeto(['usuarios'], { tipo: inteiro, conversa_id: inteiroOuNulo, usuarios: { type: 'array', items: objeto(['id'], { id: inteiro }) } }) },
  adicionarUsuarioChamada: { body: objeto(['chamada_id', 'usuario_id'], { chamada_id: inteiro, usuario_id: inteiro }) },
  historicoChamadas: { querystring: objeto([], { participante: inteiroPadraoZero, de: textoPadraoVazio, ate: textoPadraoVazio }) },

  incluirSip: { body: objeto(['sip_user', 'sip_password', 'domain', 'ws_server'], camposSip) },
  alterarSip: { body: objeto(['id'], { id: inteiro, ...camposSip }) },
}

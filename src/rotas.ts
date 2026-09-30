import { Elysia } from 'elysia'
import { tokenDoCabecalho, usuarioDoToken, type Token } from './autenticacao.ts'
import { comUsuario, type Sql } from './banco.ts'
import { comOrigemPublica } from './contexto.ts'
import { esquemas } from './esquemas.ts'
import { TipoMensagemSocket } from './websocket.ts'
import * as anexos from './anexos.ts'
import * as chamadas from './chamadas.ts'
import * as conversas from './conversas.ts'
import * as mensagens from './mensagens.ts'
import * as sip from './sip.ts'
import * as transcricoes from './transcricoes.ts'
import * as usuarios from './usuarios.ts'

// Executa em nome do usuario do token, numa conexao com app.usuario_id definido
// e com o endereco publico da requisicao guardado para as URLs do MinIO.
function comoUsuario<T>(contexto: { request: Request; usuario: number }, operacao: (sql: Sql, usuario: number) => Promise<T>) {
  const { request, usuario } = contexto
  return comOrigemPublica(request, () => comUsuario(usuario, (sql) => operacao(sql, usuario)))
}

// Todas as rotas da API, em /api. Ficam numa cadeia so para o Elysia (e o
// cliente Eden da pagina) conhecer o tipo de cada uma.
export function criarRotas(token: Token) {
  return new Elysia({ prefix: '/api' })
    .use(token)

    // --- Publicas: login e cadastro ---

    .post('/login', async ({ body, jwt }) => {
      const resposta = await comUsuario(0, (sql) => usuarios.login(sql, body))
      return { ...resposta, token: await jwt.sign({ sub: String(resposta.id), iss: 'conversa.login', iat: true }) }
    }, esquemas.login)

    .put('/usuario', ({ body }) => comUsuario(0, (sql) => usuarios.incluirUsuario(sql, body)), esquemas.incluirUsuario)

    // --- Daqui em diante exigem o token ---

    .resolve(async ({ jwt, headers }) => ({ usuario: await usuarioDoToken(jwt.verify, tokenDoCabecalho(headers.authorization)) }))

    // --- Usuario ---

    .post('/alterar-senha', async (c) => {
      await comoUsuario(c, (sql, usuario) => usuarios.alterarSenha(sql, usuario, c.body))
      return {}
    }, esquemas.alterarSenha)

    .patch('/dispositivo', (c) => comoUsuario(c, (sql) => usuarios.alterarDispositivo(sql, c.body)), esquemas.alterarDispositivo)

    .put('/dispositivo/usuario', (c) =>
      comoUsuario(c, (sql, usuario) => usuarios.incluirDispositivoUsuario(sql, usuario, c.query.dispositivo_id)), esquemas.incluirDispositivoUsuario)

    .patch('/usuario', (c) => comoUsuario(c, (sql, usuario) => usuarios.alterarUsuario(sql, usuario, c.body)), esquemas.alterarUsuario)

    .delete('/usuario', (c) => comoUsuario(c, (sql, usuario) => usuarios.excluirUsuario(sql, usuario, c.query.id)), esquemas.idNaConsulta)

    .put('/usuario/contato', (c) =>
      comoUsuario(c, (sql, usuario) => usuarios.incluirContato(sql, usuario, c.query.relacionamento_id)), esquemas.incluirContato)

    .delete('/usuario/contato', (c) => comoUsuario(c, (sql, usuario) => usuarios.excluirContato(sql, usuario, c.query.id)), esquemas.idNaConsulta)

    .get('/usuario/contatos', (c) => comoUsuario(c, (sql) => usuarios.contatos(sql)))

    .get('/contatos/online', (c) => comoUsuario(c, (sql, usuario) => usuarios.contatosOnline(sql, usuario)))

    // --- Conversas ---

    .put('/conversa', (c) => comoUsuario(c, (sql, usuario) => conversas.incluirConversa(sql, usuario, c.body)), esquemas.incluirConversa)

    .patch('/conversa', (c) => comoUsuario(c, (sql, usuario) => conversas.alterarConversa(sql, usuario, c.body)), esquemas.alterarConversa)

    .delete('/conversa', (c) => comoUsuario(c, (sql, usuario) => conversas.excluirConversa(sql, usuario, c.query.id)), esquemas.idNaConsulta)

    .get('/conversas', (c) => comoUsuario(c, (sql, usuario) => conversas.conversas(sql, usuario)))

    .patch('/conversa/fixadas', (c) =>
      comoUsuario(c, (sql, usuario) => conversas.ordenarFixadas(sql, usuario, c.body.conversas)), esquemas.ordenarFixadas)

    .patch('/conversa/arquivada', (c) =>
      comoUsuario(c, (sql, usuario) => conversas.arquivarConversa(sql, usuario, c.body.conversa, c.body.arquivada)), esquemas.arquivarConversa)

    .get('/conversa/usuarios', (c) =>
      comoUsuario(c, (sql, usuario) => conversas.membrosConversa(sql, usuario, c.query.conversa)), esquemas.membrosConversa)

    .put('/conversa/usuario', (c) => comoUsuario(c, (sql, usuario) => conversas.incluirMembro(sql, usuario, c.body)), esquemas.incluirMembro)

    .delete('/conversa/usuario', (c) => comoUsuario(c, (sql, usuario) => conversas.excluirMembro(sql, usuario, c.query.id)), esquemas.idNaConsulta)

    .post('/conversa/digitando', async (c) => {
      await comoUsuario(c, (sql, usuario) => conversas.avisarAtividade(sql, usuario, c.body.id, TipoMensagemSocket.Digitando))
      return {}
    }, esquemas.idNoCorpo)

    .post('/conversa/gravando', async (c) => {
      await comoUsuario(c, (sql, usuario) => conversas.avisarAtividade(sql, usuario, c.body.id, TipoMensagemSocket.GravandoAudio))
      return {}
    }, esquemas.idNoCorpo)

    // --- Mensagens ---

    .put('/mensagem', (c) => comoUsuario(c, (sql, usuario) => mensagens.incluirMensagem(sql, usuario, c.body)), esquemas.incluirMensagem)

    .delete('/mensagem', (c) => comoUsuario(c, (sql, usuario) => mensagens.excluirMensagem(sql, usuario, c.query.id)), esquemas.idNaConsulta)

    .get('/mensagens', (c) => comoUsuario(c, (sql, usuario) => mensagens.mensagens(
      sql, c.query.conversa, usuario, c.query.mensagemreferencia, c.query.mensagensprevias, c.query.mensagensseguintes)), esquemas.mensagens)

    .post('/mensagem/visualizar', (c) =>
      comoUsuario(c, (sql, usuario) => mensagens.marcarStatus(sql, usuario, c.body, 'visualizada')), esquemas.marcarStatus)

    .post('/mensagem/reproduzir', (c) =>
      comoUsuario(c, (sql, usuario) => mensagens.marcarStatus(sql, usuario, c.body, 'reproduzida')), esquemas.marcarStatus)

    .get('/mensagem/status', (c) =>
      comoUsuario(c, (sql, usuario) => mensagens.statusMensagens(sql, c.query.conversa, usuario, c.query.mensagem)), esquemas.statusMensagens)

    .get('/mensagem/status/detalhe', (c) =>
      comoUsuario(c, (sql, usuario) => mensagens.detalheStatusMensagem(sql, usuario, c.query.id)), esquemas.idNaConsulta)

    .get('/mensagens/novas', (c) =>
      comoUsuario(c, (sql, usuario) => mensagens.novasMensagens(sql, usuario, c.query.desde)), esquemas.novasMensagens)

    // A pesquisa sempre usa o usuario do token, nunca o parametro "usuario".
    .get('/pesquisar', (c) =>
      comoUsuario(c, (sql, usuario) => mensagens.pesquisar(sql, c.query.conversa, usuario, c.query.texto)), esquemas.pesquisar)

    .put('/mensagem/reacao', (c) => comoUsuario(c, (sql, usuario) => mensagens.alternarReacao(sql, usuario, c.body)), esquemas.reacao)

    // --- Anexos ---

    .get('/anexo/existe', (c) => comoUsuario(c, (sql) => anexos.anexoExiste(sql, c.query.identificador)), esquemas.identificador)

    .get('/anexo', (c) => comoUsuario(c, (sql) => anexos.urlAnexo(sql, c.query.identificador)), esquemas.identificador)

    .put('/anexo', (c) => comoUsuario(c, (sql) => anexos.incluirAnexo(sql, c.body)), esquemas.incluirAnexo)

    .post('/anexo/confirmar', (c) => comoUsuario(c, (sql) => anexos.confirmarUpload(sql, c.query.identificador)), esquemas.identificador)

    .get('/anexos', (c) => comoUsuario(c, (sql, usuario) => anexos.anexos(sql, usuario, c.query)), esquemas.anexos)

    // --- Transcricao de audio ---

    .get('/anexo/transcricao', (c) =>
      comoUsuario(c, (sql, usuario) => transcricoes.obterTranscricao(sql, usuario, c.query.identificador)), esquemas.identificador)

    .put('/anexo/transcricao', (c) =>
      comoUsuario(c, (sql, usuario) => transcricoes.transcrever(sql, usuario, c.body.identificador)), esquemas.transcricao)

    // --- Chamadas ---

    .put('/chamada/iniciar', (c) => comoUsuario(c, (sql, usuario) => chamadas.iniciarChamada(sql, usuario, c.body)), esquemas.iniciarChamada)

    .post('/chamada/cancelar', (c) => comoUsuario(c, (sql, usuario) => chamadas.cancelarChamada(sql, usuario, c.body.id)), esquemas.idNoCorpo)

    .post('/chamada/entrar', (c) => comoUsuario(c, (sql, usuario) => chamadas.entrarChamada(sql, usuario, c.body.id)), esquemas.idNoCorpo)

    .post('/chamada/recusar', (c) => comoUsuario(c, (sql, usuario) => chamadas.recusarChamada(sql, usuario, c.body.id)), esquemas.idNoCorpo)

    .post('/chamada/sair', (c) => comoUsuario(c, (sql, usuario) => chamadas.sairChamada(sql, usuario, c.body.id)), esquemas.idNoCorpo)

    .put('/chamada/usuario', (c) =>
      comoUsuario(c, (sql, usuario) => chamadas.adicionarUsuarioChamada(sql, usuario, c.body)), esquemas.adicionarUsuarioChamada)

    .post('/chamada/finalizar', (c) => comoUsuario(c, (sql, usuario) => chamadas.finalizarChamada(sql, usuario, c.body.id)), esquemas.idNoCorpo)

    .get('/chamada/dados', (c) => comoUsuario(c, (sql, usuario) => chamadas.dadosChamadaUsuario(sql, usuario, c.query.id)), esquemas.idNaConsulta)

    .get('/chamadas/pendentes', (c) => comoUsuario(c, (sql, usuario) => chamadas.chamadasPendentes(sql, usuario)))

    .get('/chamadas', (c) => comoUsuario(c, (sql, usuario) => chamadas.historicoChamadas(sql, usuario, c.query)), esquemas.historicoChamadas)

    .post('/chamada/video', async (c) => {
      await comoUsuario(c, (sql, usuario) => chamadas.ativarVideo(sql, usuario, c.body.id))
      return {}
    }, esquemas.idNoCorpo)

    .get('/ice', (c) => comOrigemPublica(c.request, () => chamadas.servidoresIce(c.usuario)))

    // --- SIP ---

    .get('/sip', (c) => comoUsuario(c, (sql, usuario) => sip.sip(sql, usuario)))

    .put('/sip', (c) => comoUsuario(c, (sql, usuario) => sip.incluirSip(sql, usuario, c.body)), esquemas.incluirSip)

    .patch('/sip', (c) => comoUsuario(c, (sql, usuario) => sip.alterarSip(sql, usuario, c.body)), esquemas.alterarSip)
}

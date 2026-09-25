import type { FastifyInstance, FastifyRequest } from 'fastify'
import { comUsuario, type Linha, type Sql } from './banco.ts'
import { esquemas } from './esquemas.ts'
import { notificarMembrosConversa } from './notificacoes.ts'
import { TipoMensagemSocket } from './websocket.ts'
import * as anexos from './anexos.ts'
import * as chamadas from './chamadas.ts'
import * as conversas from './conversas.ts'
import * as mensagens from './mensagens.ts'
import * as sip from './sip.ts'
import * as transcricoes from './transcricoes.ts'
import * as usuarios from './usuarios.ts'

const usuarioDe = (req: FastifyRequest) => Number((req.user as { sub: string }).sub)

// Executa em nome do usuario do token, numa conexao com app.usuario_id definido.
function comoUsuario<T>(req: FastifyRequest, operacao: (sql: Sql, usuario: number, corpo: Linha, consulta: Linha) => Promise<T>) {
  const usuario = usuarioDe(req)
  return comUsuario(usuario, (sql) => operacao(sql, usuario, req.body as Linha, req.query as Linha))
}

export async function registrarRotas(app: FastifyInstance) {
  // --- Autenticacao e usuario ---

  app.post('/api/login', { schema: esquemas.login }, async (req) => {
    const resposta = await comUsuario(0, (sql) => usuarios.login(sql, req.body as Linha))
    resposta.token = app.jwt.sign({ sub: String(resposta.id), iss: 'conversa.login' }, { expiresIn: '12h' })
    return resposta
  })

  app.post('/api/alterar-senha', { schema: esquemas.alterarSenha }, async (req) => {
    await comoUsuario(req, (sql, usuario, corpo) => usuarios.alterarSenha(sql, usuario, corpo))
    return {}
  })

  app.patch('/api/dispositivo', { schema: esquemas.alterarDispositivo }, (req) =>
    comoUsuario(req, (sql, _, corpo) => usuarios.alterarDispositivo(sql, corpo)))

  app.put('/api/dispositivo/usuario', { schema: esquemas.incluirDispositivoUsuario }, (req) =>
    comoUsuario(req, (sql, usuario, _, consulta) => usuarios.incluirDispositivoUsuario(sql, usuario, consulta.dispositivo_id)))

  // Cadastro publico: nao exige token.
  app.put('/api/usuario', { schema: esquemas.incluirUsuario }, (req) =>
    comUsuario(0, (sql) => usuarios.incluirUsuario(sql, req.body as Linha)))

  app.patch('/api/usuario', { schema: esquemas.alterarUsuario }, (req) =>
    comoUsuario(req, (sql, usuario, corpo) => usuarios.alterarUsuario(sql, usuario, corpo)))

  app.delete('/api/usuario', { schema: esquemas.idNaConsulta }, (req) =>
    comoUsuario(req, (sql, usuario, _, consulta) => usuarios.excluirUsuario(sql, usuario, consulta.id)))

  app.put('/api/usuario/contato', { schema: esquemas.incluirContato }, (req) =>
    comoUsuario(req, (sql, usuario, _, consulta) => usuarios.incluirContato(sql, usuario, consulta.relacionamento_id)))

  app.delete('/api/usuario/contato', { schema: esquemas.idNaConsulta }, (req) =>
    comoUsuario(req, (sql, usuario, _, consulta) => usuarios.excluirContato(sql, usuario, consulta.id)))

  app.get('/api/usuario/contatos', (req) => comoUsuario(req, (sql) => usuarios.contatos(sql)))

  app.get('/api/contatos/online', (req) => comoUsuario(req, (sql, usuario) => usuarios.contatosOnline(sql, usuario)))

  // --- Conversas ---

  app.put('/api/conversa', { schema: esquemas.incluirConversa }, (req) =>
    comoUsuario(req, (sql, usuario, corpo) => conversas.incluirConversa(sql, usuario, corpo)))

  app.patch('/api/conversa', { schema: esquemas.alterarConversa }, (req) =>
    comoUsuario(req, (sql, usuario, corpo) => conversas.alterarConversa(sql, usuario, corpo)))

  app.delete('/api/conversa', { schema: esquemas.idNaConsulta }, (req) =>
    comoUsuario(req, (sql, usuario, _, consulta) => conversas.excluirConversa(sql, usuario, consulta.id)))

  app.get('/api/conversas', (req) => comoUsuario(req, (sql, usuario) => conversas.conversas(sql, usuario)))

  app.get('/api/conversa/usuarios', { schema: esquemas.membrosConversa }, (req) =>
    comoUsuario(req, (sql, usuario, _, consulta) => conversas.membrosConversa(sql, usuario, consulta.conversa)))

  app.put('/api/conversa/usuario', { schema: esquemas.incluirMembro }, (req) =>
    comoUsuario(req, (sql, usuario, corpo) => conversas.incluirMembro(sql, usuario, corpo)))

  app.delete('/api/conversa/usuario', { schema: esquemas.idNaConsulta }, (req) =>
    comoUsuario(req, (sql, usuario, _, consulta) => conversas.excluirMembro(sql, usuario, consulta.id)))

  app.post('/api/conversa/digitando', { schema: esquemas.idNoCorpo }, async (req) => {
    await comoUsuario(req, (sql, usuario, corpo) => notificarMembrosConversa(sql, corpo.id, usuario, TipoMensagemSocket.Digitando))
    return {}
  })

  app.post('/api/conversa/gravando', { schema: esquemas.idNoCorpo }, async (req) => {
    await comoUsuario(req, (sql, usuario, corpo) => notificarMembrosConversa(sql, corpo.id, usuario, TipoMensagemSocket.GravandoAudio))
    return {}
  })

  // --- Mensagens ---

  app.put('/api/mensagem', { schema: esquemas.incluirMensagem }, (req) =>
    comoUsuario(req, (sql, usuario, corpo) => mensagens.incluirMensagem(sql, usuario, corpo)))

  app.delete('/api/mensagem', { schema: esquemas.idNaConsulta }, (req) =>
    comoUsuario(req, (sql, usuario, _, consulta) => mensagens.excluirMensagem(sql, usuario, consulta.id)))

  app.get('/api/mensagens', { schema: esquemas.mensagens }, (req) =>
    comoUsuario(req, (sql, usuario, _, consulta) => mensagens.mensagens(
      sql, consulta.conversa, usuario, consulta.mensagemreferencia, consulta.mensagensprevias, consulta.mensagensseguintes)))

  app.post('/api/mensagem/visualizar', { schema: esquemas.marcarStatus }, (req) =>
    comoUsuario(req, (sql, usuario, corpo) => mensagens.marcarStatus(sql, usuario, corpo, 'visualizada')))

  app.post('/api/mensagem/reproduzir', { schema: esquemas.marcarStatus }, (req) =>
    comoUsuario(req, (sql, usuario, corpo) => mensagens.marcarStatus(sql, usuario, corpo, 'reproduzida')))

  app.get('/api/mensagem/status', { schema: esquemas.statusMensagens }, (req) =>
    comoUsuario(req, (sql, usuario, _, consulta) => mensagens.statusMensagens(sql, consulta.conversa, usuario, consulta.mensagem)))

  app.get('/api/mensagem/status/detalhe', { schema: esquemas.idNaConsulta }, (req) =>
    comoUsuario(req, (sql, usuario, _, consulta) => mensagens.detalheStatusMensagem(sql, usuario, consulta.id)))

  app.get('/api/mensagens/novas', { schema: esquemas.novasMensagens }, (req) =>
    comoUsuario(req, (sql, usuario, _, consulta) => mensagens.novasMensagens(sql, usuario, consulta.desde)))

  // A pesquisa sempre usa o usuario do token, nunca o parametro "usuario".
  app.get('/api/pesquisar', { schema: esquemas.pesquisar }, (req) =>
    comoUsuario(req, (sql, usuario, _, consulta) => mensagens.pesquisar(sql, consulta.conversa, usuario, consulta.texto)))

  app.put('/api/mensagem/reacao', { schema: esquemas.reacao }, (req) =>
    comoUsuario(req, (sql, usuario, corpo) => mensagens.alternarReacao(sql, usuario, corpo)))

  // --- Anexos ---

  app.get('/api/anexo/existe', { schema: esquemas.identificador }, (req) =>
    comoUsuario(req, (sql, _, __, consulta) => anexos.anexoExiste(sql, consulta.identificador)))

  app.get('/api/anexo', { schema: esquemas.identificador }, (req) =>
    comoUsuario(req, (sql, _, __, consulta) => anexos.urlAnexo(sql, consulta.identificador)))

  app.put('/api/anexo', { schema: esquemas.incluirAnexo }, (req) =>
    comoUsuario(req, (sql, _, corpo) => anexos.incluirAnexo(sql, corpo)))

  app.post('/api/anexo/confirmar', { schema: esquemas.identificador }, (req) =>
    comoUsuario(req, (sql, _, __, consulta) => anexos.confirmarUpload(sql, consulta.identificador)))

  app.get('/api/anexos', { schema: esquemas.anexos }, (req) =>
    comoUsuario(req, (sql, usuario, _, consulta) => anexos.anexos(sql, usuario, consulta)))

  // --- Transcricao de audio ---

  app.get('/api/anexo/transcricao', { schema: esquemas.identificador }, (req) =>
    comoUsuario(req, (sql, usuario, _, consulta) => transcricoes.obterTranscricao(sql, usuario, consulta.identificador)))

  app.put('/api/anexo/transcricao', { schema: esquemas.transcricao }, (req) =>
    comoUsuario(req, (sql, usuario, corpo) => transcricoes.transcrever(sql, usuario, corpo.identificador)))

  // --- Chamadas ---

  app.put('/api/chamada/iniciar', { schema: esquemas.iniciarChamada }, (req) =>
    comoUsuario(req, (sql, usuario, corpo) => chamadas.iniciarChamada(sql, usuario, corpo)))

  app.post('/api/chamada/cancelar', { schema: esquemas.idNoCorpo }, (req) =>
    comoUsuario(req, (sql, usuario, corpo) => chamadas.cancelarChamada(sql, usuario, corpo.id)))

  app.post('/api/chamada/entrar', { schema: esquemas.idNoCorpo }, (req) =>
    comoUsuario(req, (sql, usuario, corpo) => chamadas.entrarChamada(sql, usuario, corpo.id)))

  app.post('/api/chamada/recusar', { schema: esquemas.idNoCorpo }, (req) =>
    comoUsuario(req, (sql, usuario, corpo) => chamadas.recusarChamada(sql, usuario, corpo.id)))

  app.post('/api/chamada/sair', { schema: esquemas.idNoCorpo }, (req) =>
    comoUsuario(req, (sql, usuario, corpo) => chamadas.sairChamada(sql, usuario, corpo.id)))

  app.put('/api/chamada/usuario', { schema: esquemas.adicionarUsuarioChamada }, (req) =>
    comoUsuario(req, (sql, usuario, corpo) => chamadas.adicionarUsuarioChamada(sql, usuario, corpo)))

  app.post('/api/chamada/finalizar', { schema: esquemas.idNoCorpo }, (req) =>
    comoUsuario(req, (sql, usuario, corpo) => chamadas.finalizarChamada(sql, usuario, corpo.id)))

  app.get('/api/chamada/dados', { schema: esquemas.idNaConsulta }, (req) =>
    comoUsuario(req, (sql, usuario, _, consulta) => chamadas.dadosChamadaUsuario(sql, usuario, consulta.id)))

  app.get('/api/chamadas/pendentes', (req) => comoUsuario(req, (sql, usuario) => chamadas.chamadasPendentes(sql, usuario)))

  app.get('/api/chamadas', { schema: esquemas.historicoChamadas }, (req) =>
    comoUsuario(req, (sql, usuario, _, consulta) => chamadas.historicoChamadas(sql, usuario, consulta)))

  app.post('/api/chamada/video', { schema: esquemas.idNoCorpo }, async (req) => {
    await comoUsuario(req, (sql, usuario, corpo) => chamadas.ativarVideo(sql, usuario, corpo.id))
    return {}
  })

  app.get('/api/ice', async (req) => chamadas.servidoresIce(usuarioDe(req)))

  // --- SIP ---

  app.get('/api/sip', (req) => comoUsuario(req, (sql, usuario) => sip.sip(sql, usuario)))

  app.put('/api/sip', { schema: esquemas.incluirSip }, (req) =>
    comoUsuario(req, (sql, usuario, corpo) => sip.incluirSip(sql, usuario, corpo)))

  app.patch('/api/sip', { schema: esquemas.alterarSip }, (req) =>
    comoUsuario(req, (sql, usuario, corpo) => sip.alterarSip(sql, usuario, corpo)))
}

// Linhas das tabelas como o postgres.js entrega, com as conversoes de banco.ts:
// timestamp vira Date, int8 vira number e bytea vira texto.

// Valores das colunas de tipo e status, os mesmos que a pagina usa
export type TipoConversa = 1 | 2 // 1-Direta, 2-Grupo
export type TipoConteudo = 1 | 2 | 3 | 4 | 5 | 6 // 1-Texto, 2-Imagem, 3-Arquivo, 4-Audio, 5-Gravacao de audio, 6-Chamada
export type TipoChamada = 1 | 2 // 1-Audio, 2-Video
export type StatusChamada = 1 | 2 | 3 | 4 | 5 | 6 // 1-Pendente, 2-Recusada, 3-Em andamento, 4-Encerrada, 5-Desconectada, 6-Cancelada
export type StatusUsuarioChamada = 1 | 2 | 3 | 4 | 5 // 1-Pendente, 2-Recusou, 3-Entrou, 4-Saiu, 5-Desconectou
export type StatusTranscricao = 0 | 1 | 2 | 3 // 0-Nenhuma, 1-Processando, 2-Concluida, 3-Erro

export interface Usuario {
  id: number
  nome: string
  login: string
  email: string
  telefone: string | null
  senha: string
  avatar_anexo_id: number | null
  criado_em: Date | null
  criado_por: number | null
}

export interface Dispositivo {
  id: number
  nome: string
  modelo: string
  versao_so: string
  plataforma: string
  token_fcm: string | null
  usuario_id: number
  ativo: boolean
  criado_em: Date | null
  criado_por: number | null
}

export interface DispositivoUsuario {
  id: number
  dispositivo_id: number
  usuario_id: number
  online_em: Date | null
  criado_em: Date | null
  criado_por: number | null
}

export interface UsuarioContato {
  id: number
  usuario_id: number | null
  relacionamento_id: number | null
  criado_em: Date | null
  criado_por: number | null
}

export interface Conversa {
  id: number
  descricao: string | null
  tipo: TipoConversa
  inserida: Date
  criado_por: number | null
}

export interface ConversaUsuario {
  id: number
  usuario_id: number
  conversa_id: number
  criado_em: Date | null
  criado_por: number | null
  fixada_ordem: number | null
  arquivada_em: Date | null
}

export interface Mensagem {
  id: number
  usuario_id: number
  conversa_id: number
  inserida: Date
  alterada: Date | null
  visivel_em: Date | null
}

export interface MensagemConteudo {
  id: number
  mensagem_id: number
  ordem: number
  tipo: TipoConteudo
  conteudo: string | null
  criado_em: Date | null
  criado_por: number | null
}

export interface MensagemReferencia {
  id: number
  tipo: number
  origem_mensagem_id: number
  destino_mensagem_id: number
  criado_em: Date | null
  criado_por: number | null
}

export interface Sip {
  id: number
  usuario_id: number
  sip_user: string
  auth_user: string | null
  sip_password: string
  display_name: string | null
  domain: string
  ws_server: string
  ativo: boolean
  criado_em: Date | null
  criado_por: number | null
}

// Tabelas usadas pelos helpers genericos de comum.ts
export interface Tabelas {
  usuario: Usuario
  dispositivo: Dispositivo
  dispositivo_usuario: DispositivoUsuario
  usuario_contato: UsuarioContato
  conversa: Conversa
  conversa_usuario: ConversaUsuario
  mensagem: Mensagem
  mensagem_conteudo: MensagemConteudo
  mensagem_referencia: MensagemReferencia
  sip: Sip
}

-- Permissoes de uso do app (o que cada pessoa pode fazer no chat), ao lado das
-- de administracao. uso separa as duas na tela de acessos. Quem ja tem conta
-- fica com todas as de uso; conta nova ganha todas no cadastro.
alter table permissao add column if not exists uso boolean not null default false;

insert into permissao (codigo, descricao, uso)
values ('emoji', 'Enviar emojis no texto das mensagens', true)
     , ('figurinha', 'Enviar figurinhas', true)
     , ('imagem', 'Enviar imagens', true)
     , ('video', 'Enviar vídeos', true)
     , ('audio', 'Enviar áudios e gravações de voz', true)
     , ('arquivo', 'Enviar arquivos (documentos e outros)', true)
     , ('responder', 'Responder mensagens', true)
     , ('encaminhar', 'Encaminhar mensagens', true)
     , ('reagir', 'Reagir às mensagens com emoji', true)
     , ('postagem', 'Fazer postagens em grupos', true)
     , ('votacao', 'Criar votações em grupos', true)
     , ('confirmacao', 'Pedir confirmação de leitura', true)
     , ('agendar', 'Agendar mensagens', true)
     , ('grupo', 'Criar grupos', true)
     , ('chamada_audio', 'Fazer chamadas de áudio', true)
     , ('chamada_video', 'Fazer chamadas de vídeo e ligar o vídeo na chamada', true)
     , ('compartilhar_tela', 'Compartilhar a tela nas chamadas', true)
     , ('telefonia', 'Usar a telefonia (SIP)', true)
    on conflict (codigo) do nothing;

insert into permissao_usuario (usuario_id, permissao_id)
select u.id, p.id
  from usuario u
 cross join permissao p
 where p.uso
    on conflict (usuario_id, permissao_id) do nothing;

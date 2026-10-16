-- Mais permissoes de uso (ocultar mensagem e as telas de configuracao de cada
-- um), a de administracao para cadastrar usuarios e bots, e o parametro que
-- abre ou fecha o cadastro pela tela de login (1-aberto, 0-so o administrador cadastra).
insert into permissao (codigo, descricao, uso)
values ('ocultar', 'Ocultar as próprias mensagens', true)
     , ('perfil', 'Alterar o próprio nome, e-mail, telefone e avatar', true)
     , ('senha', 'Trocar a própria senha', true)
     , ('privacidade', 'Alterar as opções de privacidade', true)
     , ('cores', 'Mudar as cores do app', true)
     , ('config_chamadas', 'Mudar as configurações de chamada (áudio, vídeo e tela)', true)
    on conflict (codigo) do nothing;

insert into permissao (codigo, descricao)
values ('usuarios', 'Cadastrar usuários e bots')
    on conflict (codigo) do nothing;

-- Quem ja tem conta fica com as novas; os bots, nao (comecam so com o basico)
insert into permissao_usuario (usuario_id, permissao_id)
select u.id, p.id
  from usuario u
 cross join permissao p
 where p.codigo in ('ocultar', 'perfil', 'senha', 'privacidade', 'cores', 'config_chamadas')
   and not exists (select 1 from bot b where b.usuario_id = u.id)
    on conflict (usuario_id, permissao_id) do nothing;

insert into parametros (nome, valor)
values ('cadastro_aberto', '1')
    on conflict (nome) do nothing;

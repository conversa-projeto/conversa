-- Atividade pendente ate ser concluida: sozinha (confirmar a leitura pedida,
-- ver a reacao na mensagem, ler a resposta ou mencao, abrir a chamada perdida)
-- ou a mao. As que o usuario ja tinha visto na tela de atividades entram
-- concluidas.
alter table atividade add column if not exists concluida_em timestamp null;
update atividade a
   set concluida_em = u.atividades_vistas_em
  from usuario u
 where u.id = a.usuario_id
   and a.concluida_em is null
   and a.criado_em <= u.atividades_vistas_em;

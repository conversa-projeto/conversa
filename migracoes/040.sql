-- Presenca: quando o usuario esteve ativo pela ultima vez e o que ele mostra
-- aos outros (visto por ultimo, a conversa aberta, ou aparecer sempre offline)
alter table usuario add column if not exists visto_em timestamp null;
alter table usuario add column if not exists mostrar_visto_em bool not null default true;
alter table usuario add column if not exists mostrar_na_conversa bool not null default true;
alter table usuario add column if not exists aparecer_offline bool not null default false;

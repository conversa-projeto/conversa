drop index if exists ix_mensagem_conversa_visivel_desc; 
drop index if exists ix_mensagem_visivel_em_pendente; 
-- Converte existentes tratando-os como "hora local da sessão atual" — que é onde Pascal os escreveu 
-- na versão anterior da coluna (timestamp sem TZ). 
alter table mensagem 
  alter column visivel_em type timestamptz 
  using case when visivel_em is null then null 
             else visivel_em at time zone current_setting('TimeZone') 
        end; 
create index ix_mensagem_visivel_em_pendente 
  on mensagem(visivel_em) where visivel_em is not null; 

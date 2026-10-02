-- Dias que as gravacoes das chamadas (auditoria) ficam guardadas. A API apaga
-- as mais antigas a cada hora; 0 guarda para sempre.
insert 
  into parametros 
     ( nome 
     , valor 
     ) 
values 
     ( 'gravacao_dias' 
     , '90' 
     ) 
    on conflict (nome) do nothing; 

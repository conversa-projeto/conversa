insert 
  into parametros 
     ( nome 
     , valor 
     ) 
values 
     ( 'turn_url' 
     , '' 
     ), 
     ( 'turn_secret' 
     , '' 
     ), 
     ( 'turn_forcar_relay' 
     , '1' 
     ) 
    on conflict (nome) do nothing; 

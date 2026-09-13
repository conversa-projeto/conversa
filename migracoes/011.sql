insert 
  into parametros 
     ( nome 
     , valor 
     )  
values 
     ( 's3_endpoint' 
     , 'https://localhost:4430/storage' 
     ), 
     ( 's3_accesskey' 
     , 'admin' 
     ), 
     ( 's3_secretkey' 
     , 'admin123' 
     ), 
     ( 's3_bucket' 
     , 'chat' 
     ); 
drop table versao; 

insert 
  into parametros 
     ( nome 
     , valor 
     )  
values 
     ( 'jwt_token' 
     , 'S3RV1D0R_4P1_C0NV3R54' 
     ), 
     ( 'fcm_project_id' 
     , '' 
     ), 
     ( 'fcm_client_email' 
     , '' 
     ), 
     ( 'fcm_private_key' 
     , '' 
     ) 
    on conflict (nome) do nothing; 

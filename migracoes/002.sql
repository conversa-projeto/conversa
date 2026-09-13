create 
 table dispositivo 
     ( id serial4 not null 
     , nome varchar(50) not null 
     , modelo varchar(50) not null 
     , versao_so varchar(15) not null 
     , plataforma varchar(15) not null 
     , constraint dispositivo_pk primary key (id) 
     ); 
create 
 table dispositivo_usuario 
     ( id serial4 not null 
     , dispositivo_id int4 not null 
     , usuario_id int4 not null 
     , online_em timestamp 
     , constraint dispositivo_usuario_pk primary key (id) 
     , constraint dispositivo_usuario_dispositivo_fk foreign key (dispositivo_id) references dispositivo(id) 
     , constraint dispositivo_usuario_usuario_fk foreign key (usuario_id) references usuario(id) 
     ); 

create 
 table chamada  
     ( id serial4 not null 
     , tipo int4 default 1 not null /* 1-Simples, 2-Grupo */
     , status int4 default 1 not null /* 1-Iniciada, 2-Recusada, 3-Em Andamento, 4-Encerrada, 5-Perdida */
     , iniciada timestamp null 
     , finalizada timestamp null 
     , conversa_id int4 null 
     , criado_em timestamp default current_timestamp not null 
     , criado_por int4 not null 
     , constraint chamada_pk primary key (id) 
     , constraint chamada_conversa_fk foreign key (conversa_id) references conversa(id) 
     , constraint chamada_criado_por_fk foreign key (criado_por) references usuario(id) 
     ); 
comment on column chamada.tipo is '1-Simples, 2-Grupo'; 
comment on column chamada.status is '1-Iniciada, 2-Recusada, 3-Em Andamento, 4-Encerrada, 5-Perdida'; 
create 
 table chamada_usuario  
     ( id serial4 not null 
     , chamada_id int4 not null 
     , usuario_id int4 not null 
     , status int4 default 1 not null /* 1-Pendente */ 
     , adicionado_por int4 not null 
     , adicionado_em timestamp default current_timestamp not null 
     , entrou_em timestamp 
     , saiu_em timestamp 
     , recusou_em timestamp 
     , constraint chamada_usuario_pk primary key (id) 
     , constraint chamada_usuario_chamada_fk foreign key (chamada_id) references chamada(id) 
     , constraint chamada_usuario_usuario_fk foreign key (usuario_id) references usuario(id) 
     , constraint chamada_usuario_adicionado_por_fk foreign key (adicionado_por) references usuario(id) 
     ); 
create index ix_chamada_usuario_01 on chamada_usuario(chamada_id, usuario_id) include(status); 
comment on column chamada_usuario.status is '1-Pendente, 2-Entrou, 3-Saiu, 4-Recusou, 5-Desconectou'; 
create 
 table chamada_evento  
     ( id serial4 not null 
     , chamada_id int4 not null 
     , usuario_id int4 not null 
     , tipo int4 not null 
     , criado_em timestamp default current_timestamp not null 
     , criado_por int4 not null 
     , constraint chamada_evento_pk primary key (id) 
     , constraint chamada_evento_chamada_fk foreign key (chamada_id) references chamada(id) 
     , constraint chamada_evento_usuario_fk foreign key (usuario_id) references usuario(id) 
     , constraint chamada_evento_criado_por_fk foreign key (criado_por) references usuario(id) 
     ); 

create index ix_chamada_evento_01 on chamada_evento(chamada_id, usuario_id) include(tipo); 

create 
 table usuario  
     ( id serial4 not null 
     , nome varchar(100) not null 
     , login varchar(50) not null 
     , email varchar(100) not null 
     , telefone varchar(50) null 
     , senha varchar(50) not null 
     , constraint usuario_email_unique unique (email) 
     , constraint usuario_pk primary key (id) 
     ); 
create 
 table conversa  
     ( id serial4 not null 
     , descricao varchar(100) null 
     , tipo int4 default 1 not null -- 1-chat; 2-grupo 
     , inserida timestamp default current_timestamp not null 
     , constraint conversa_pk primary key (id) 
     ); 
comment on column conversa.tipo is '1-Chat; 2-Grupo'; 
create 
 table usuario_contato  
     ( id serial4 not null 
     , usuario_id int4 null 
     , relacionamento_id int4 null 
     , constraint usuario_contato_pk primary key (id) 
     , constraint usuario_contato_usuario_fk foreign key (usuario_id) references usuario(id) 
     , constraint usuario_contato_usuario_fk_1 foreign key (relacionamento_id) references usuario(id) 
     ); 
create 
 table conversa_usuario  
     ( id serial4 not null 
     , usuario_id int4 not null 
     , conversa_id int4 not null 
     , constraint conversa_usuario_pk primary key (id) 
     , constraint conversa_usuario_conversa_fk foreign key (conversa_id) references conversa(id) 
     , constraint conversa_usuario_usuario_fk foreign key (usuario_id) references usuario(id) 
     ); 
create 
 table mensagem  
     ( id serial4 not null 
     , usuario_id int4 not null 
     , conversa_id int4 not null 
     , inserida timestamp default current_timestamp not null 
     , alterada timestamp null 
     , constraint mensagem_pk primary key (id) 
     , constraint mensagem_conversa_fk foreign key (conversa_id) references conversa(id) 
     , constraint mensagem_usuario_fk foreign key (usuario_id) references usuario(id) 
     ); 
create 
 table mensagem_conteudo  
     ( id serial4 not null 
     , mensagem_id int4 not null 
     , ordem int4 not null 
     , tipo int4 not null 
     , conteudo bytea null 
     , constraint mensagem_conteudo_pk primary key (id) 
     , constraint mensagem_conteudo_mensagem_fk foreign key (mensagem_id) references mensagem(id) 
     ); 
create 
 table mensagem_status 
     ( conversa_id int4 not null 
     , usuario_id int4 not null 
     , mensagem_id int4 not null 
     , recebida timestamp null 
     , visualizada timestamp null 
     , reproduzida timestamp null 
     , constraint mensagem_status_conversa_fk foreign key (conversa_id) references conversa(id) 
     , constraint mensagem_status_mensagem_fk foreign key (mensagem_id) references mensagem(id) 
     , constraint mensagem_status_usuario_fk foreign key (usuario_id) references usuario(id) 
     ); 
create 
 table anexo 
     ( id serial4 not null 
     , identificador varchar(64) not null 
     , tipo int4 not null 
     , tamanho int4 not null 
     , constraint anexo_pk primary key (id) 
     ); 

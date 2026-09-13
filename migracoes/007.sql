alter table dispositivo add usuario_id int4 not null; 
alter table dispositivo add constraint dispositivo_usuario_fk foreign key(usuario_id) references usuario(id);
alter table dispositivo add ativo bool default true not null;

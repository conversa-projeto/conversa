-- Servidor de IA no padrao da OpenAI (/v1/chat/completions): vLLM, Ollama ou
-- OpenAI. Sem endereco e modelo, os recursos de IA (resumo da conversa) ficam
-- desligados.
insert
  into parametros
     ( nome
     , valor
     )
values
     ( 'ia_url', '' )
     , ( 'ia_token', '' )
     , ( 'ia_modelo', '' )
    on conflict (nome) do nothing;

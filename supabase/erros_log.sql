-- ============================================================================
-- iNotário · Log de erros das Edge Functions (diagnóstico)
-- ============================================================================

create table if not exists public.erros_log (
  id             uuid primary key default gen_random_uuid(),
  codigo         text not null,                  -- código curto mostrado ao usuário (E-XXXX)
  contexto       text not null,                  -- função/etapa onde ocorreu (ex.: artemis-chat)
  mensagem       text,                           -- mensagem do erro
  detalhe        jsonb,                          -- provedor, modelo, status, stack, payload resumido
  solicitacao_id uuid,
  user_id        uuid,
  status_http    int,
  created_at     timestamptz not null default now()
);
create index if not exists idx_erros_log_created on public.erros_log(created_at desc);
create index if not exists idx_erros_log_contexto on public.erros_log(contexto, created_at desc);

alter table public.erros_log enable row level security;

-- Leitura: equipe do cartório (se houver solicitação vinculada) ou admin da plataforma.
drop policy if exists p_erros_admin on public.erros_log;
create policy p_erros_admin on public.erros_log for select
  using (
    public.is_admin_plataforma()
    or (solicitacao_id is not null and exists (
      select 1 from public.solicitacoes s where s.id = solicitacao_id and public.is_equipe(s.cartorio_id)
    ))
  );
-- A escrita é feita pelas funções via service role (ignora RLS).

notify pgrst, 'reload schema';
-- Consulta rápida dos últimos erros:
--   select created_at, codigo, contexto, mensagem, detalhe->>'provedor' as provedor,
--          detalhe->>'modelo' as modelo, status_http
--   from public.erros_log order by created_at desc limit 50;
-- ============================================================================

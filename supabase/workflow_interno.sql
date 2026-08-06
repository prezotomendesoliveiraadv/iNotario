-- ============================================================================
-- iNotário · Workflow interno do cartório (papéis, complexidade, financeiro,
-- aprovação por competência e documentos de saída para custódia/WhatsApp).
-- Pré-requisitos: schema.sql (+ demais migrations).
-- OBS.: as três primeiras linhas ampliam o enum de papéis. Se o editor acusar
-- erro de transação, rode-as isoladamente primeiro e depois o restante.
-- ============================================================================

alter type papel_usuario add value if not exists 'tabeliao_substituto';
alter type papel_usuario add value if not exists 'financeiro';
alter type papel_usuario add value if not exists 'tabeliao_oficial';

-- ---- Campos de workflow na solicitação ----
alter table public.solicitacoes add column if not exists complexidade text;                    -- baixa | media | alta
alter table public.solicitacoes add column if not exists financeiro_status text not null default 'nao_aplicavel'; -- nao_aplicavel | pendente | validado
alter table public.solicitacoes add column if not exists emolumentos numeric(12,2);
alter table public.solicitacoes add column if not exists impostos numeric(12,2);
alter table public.solicitacoes add column if not exists financeiro_obs text;
alter table public.solicitacoes add column if not exists aprovado_por uuid references auth.users(id);
alter table public.solicitacoes add column if not exists aprovado_em timestamptz;

-- ---- Documentos de saída (rascunho editável e final aprovado) ----
create table if not exists public.saidas (
  id             uuid primary key default gen_random_uuid(),
  solicitacao_id uuid not null references public.solicitacoes(id) on delete cascade,
  tipo           text not null default 'rascunho',   -- rascunho | final
  formato        text not null default 'pdf',         -- doc | pdf
  storage_path   text not null,
  versao         int  not null default 1,
  gerado_por     uuid references auth.users(id) default auth.uid(),
  created_at     timestamptz not null default now()
);
create index if not exists idx_saidas_solic on public.saidas(solicitacao_id, created_at desc);

alter table public.saidas enable row level security;
drop policy if exists p_saidas_equipe on public.saidas;
create policy p_saidas_equipe on public.saidas for all
  using (exists (select 1 from public.solicitacoes s where s.id = solicitacao_id and public.is_equipe(s.cartorio_id)))
  with check (exists (select 1 from public.solicitacoes s where s.id = solicitacao_id and public.is_equipe(s.cartorio_id)));

-- ---- Bucket privado para as saídas ----
do $$
begin
  insert into storage.buckets (id, name, public) values ('saidas','saidas',false) on conflict (id) do nothing;
exception when others then raise notice 'Crie o bucket "saidas" (privado) no painel. (%)', sqlerrm; end $$;

do $$
begin
  drop policy if exists p_saidas_rw on storage.objects;
  create policy p_saidas_rw on storage.objects for all to authenticated
    using (bucket_id = 'saidas') with check (bucket_id = 'saidas');
exception when others then raise notice 'Crie a policy de storage do bucket "saidas". (%)', sqlerrm; end $$;

notify pgrst, 'reload schema';
-- ============================================================================
-- Papéis (profiles.papel): escrevente | tabeliao_substituto | financeiro |
-- tabeliao_oficial  (o antigo 'tabeliao' continua valendo como oficial).
-- Ex.: update public.profiles set papel='financeiro' where id=(select id from auth.users where email='fin@cartorio.com');
-- ============================================================================

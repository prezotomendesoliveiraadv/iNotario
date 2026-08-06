-- ============================================================================
-- iNotário · Tarifador por ato + faturamento mensal + administração da plataforma
-- Pré-requisitos: schema.sql e workflow_interno.sql.
-- OBS.: a primeira linha amplia o enum de papéis; se o editor acusar erro de
-- transação, rode-a isolada primeiro e depois o restante.
-- ============================================================================

alter type papel_usuario add value if not exists 'admin_plataforma';

-- Marco de cobrança: quando o ato foi efetivado (status -> concluida)
alter table public.solicitacoes add column if not exists concluida_em timestamptz;
create index if not exists idx_solic_concluida on public.solicitacoes(cartorio_id, concluida_em);

-- Quem é admin da plataforma (fornecedor do app)
create or replace function public.is_admin_plataforma()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and papel = 'admin_plataforma');
$$;

-- ---- Plano contratado por cartório ----
create table if not exists public.planos (
  cartorio_id      uuid primary key references public.cartorios(id) on delete cascade,
  valor_fixo       numeric(12,2) not null default 0,     -- mensalidade fixa (contrato)
  valor_ato        numeric(12,2) not null default 0,     -- valor variável por ato efetivado
  tabeliao_oficial text,
  contato_email    text,
  contato_fone     text,
  email_master     text,                                  -- login master do cartório (senha via auth)
  validade         date,                                  -- validade da assinatura de acesso
  ativo            boolean not null default true,
  obs              text,
  atualizado_em    timestamptz not null default now()
);

alter table public.planos enable row level security;
drop policy if exists p_planos_admin on public.planos;
create policy p_planos_admin on public.planos for all
  using (public.is_admin_plataforma()) with check (public.is_admin_plataforma());
drop policy if exists p_planos_cartorio_ler on public.planos;
create policy p_planos_cartorio_ler on public.planos for select
  using (public.is_equipe(cartorio_id));

-- ---- Faturas mensais ----
create table if not exists public.faturas (
  id             uuid primary key default gen_random_uuid(),
  cartorio_id    uuid not null references public.cartorios(id) on delete cascade,
  competencia    text not null,                          -- 'AAAA-MM'
  qtd_atos       int not null default 0,
  valor_fixo     numeric(12,2) not null default 0,
  valor_variavel numeric(12,2) not null default 0,
  valor_total    numeric(12,2) not null default 0,
  status         text not null default 'fechada',        -- aberta | fechada | paga
  detalhes       jsonb,                                   -- extrato: lista de atos cobrados
  gerada_em      timestamptz not null default now(),
  paga_em        timestamptz,
  unique (cartorio_id, competencia)
);

alter table public.faturas enable row level security;
drop policy if exists p_faturas_admin on public.faturas;
create policy p_faturas_admin on public.faturas for all
  using (public.is_admin_plataforma()) with check (public.is_admin_plataforma());
drop policy if exists p_faturas_cartorio_ler on public.faturas;
create policy p_faturas_cartorio_ler on public.faturas for select
  using (public.is_equipe(cartorio_id));

-- Admin da plataforma pode listar cartórios
drop policy if exists p_cartorios_admin on public.cartorios;
create policy p_cartorios_admin on public.cartorios for select
  using (public.is_admin_plataforma());

notify pgrst, 'reload schema';
-- ============================================================================
-- Para tornar um usuário administrador da plataforma (fornecedor):
--   update public.profiles set papel='admin_plataforma'
--   where id = (select id from auth.users where email = 'ADMIN@SUAEMPRESA.COM');
-- ============================================================================

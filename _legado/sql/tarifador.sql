-- ============================================================================
-- iNotário · Tarifador e faturamento (contratos, faturas, extrato de uso)
-- Pré-requisitos: schema.sql + workflow_interno.sql.
-- OBS.: a 1ª linha amplia o enum de papéis; se o editor acusar erro de
-- transação, rode-a isolada primeiro e depois o restante.
-- ============================================================================

alter type papel_usuario add value if not exists 'admin_plataforma';

-- Momento em que o ato foi EFETIVADO (base da cobrança variável)
alter table public.solicitacoes add column if not exists concluida_em timestamptz;

create or replace function public.tg_marcar_conclusao() returns trigger
language plpgsql as $$
begin
  if new.status = 'concluida' and (old.status is distinct from 'concluida') then
    new.concluida_em := coalesce(new.concluida_em, now());
  end if;
  return new;
end $$;
drop trigger if exists trg_marcar_conclusao on public.solicitacoes;
create trigger trg_marcar_conclusao before update on public.solicitacoes
  for each row execute function public.tg_marcar_conclusao();

-- ---- Contrato da plataforma com o cartório (1:1) ----
create table if not exists public.contratos (
  id                 uuid primary key default gen_random_uuid(),
  cartorio_id        uuid not null unique references public.cartorios(id) on delete cascade,
  mensalidade_fixa   numeric(12,2) not null default 0,
  valor_por_ato      numeric(12,2) not null default 0,
  moeda              text not null default 'BRL',
  vigencia_inicio    date,
  vigencia_fim       date,                          -- validade da assinatura de acesso
  status             text not null default 'ativo', -- ativo | suspenso | cancelado
  tabeliao_oficial   text,
  cnpj               text,
  contato_nome       text,
  contato_email      text,
  contato_telefone   text,
  usuario_master     uuid references auth.users(id),
  observacoes        text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- ---- Faturas mensais (fixo + variável por atos efetivados) ----
create table if not exists public.faturas (
  id              uuid primary key default gen_random_uuid(),
  cartorio_id     uuid not null references public.cartorios(id) on delete cascade,
  competencia     text not null,                    -- 'AAAA-MM'
  qtd_atos        int not null default 0,
  valor_por_ato   numeric(12,2) not null default 0,
  valor_variavel  numeric(12,2) not null default 0,
  valor_fixo      numeric(12,2) not null default 0,
  valor_total     numeric(12,2) not null default 0,
  status          text not null default 'aberta',   -- aberta | fechada | paga
  gerada_em       timestamptz not null default now(),
  paga_em         timestamptz,
  unique (cartorio_id, competencia)
);
create index if not exists idx_faturas_cartorio on public.faturas(cartorio_id, competencia desc);

-- ---- RLS: o cartório LÊ o próprio contrato e faturas; escrita só via
-- ---- service role (função da plataforma). Admin da plataforma lê tudo. ----
alter table public.contratos enable row level security;
alter table public.faturas   enable row level security;

drop policy if exists p_contratos_leitura on public.contratos;
create policy p_contratos_leitura on public.contratos for select
  using (public.is_equipe(cartorio_id) or public.current_papel() = 'admin_plataforma');

drop policy if exists p_faturas_leitura on public.faturas;
create policy p_faturas_leitura on public.faturas for select
  using (public.is_equipe(cartorio_id) or public.current_papel() = 'admin_plataforma');

notify pgrst, 'reload schema';
-- ============================================================================
-- Para nomear o ADMIN DA PLATAFORMA (equipe iAdvoga):
--   update public.profiles set papel='admin_plataforma'
--   where id = (select id from auth.users where email='admin@iadvoga.com');
-- ============================================================================

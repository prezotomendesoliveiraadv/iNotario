-- ============================================================================
-- iNotário · Schema Supabase (PostgreSQL)
-- Plataforma de IA notarial para criação e qualificação de escrituras públicas
-- ----------------------------------------------------------------------------
-- Cole este arquivo inteiro no Supabase: SQL Editor > New query > Run.
-- Idempotente o suficiente para reexecução em ambiente novo.
-- ============================================================================

create extension if not exists pgcrypto with schema extensions;

-- ----------------------------------------------------------------------------
-- ENUMS
-- ----------------------------------------------------------------------------
do $$ begin
  create type papel_usuario as enum ('tabeliao', 'escrevente', 'cliente');
exception when duplicate_object then null; end $$;

do $$ begin
  create type status_solicitacao as enum (
    'rascunho',        -- cliente ainda preenchendo
    'recebida',        -- enviada ao cartório
    'em_elaboracao',   -- escrevente trabalhando / minuta provisória
    'em_revisao',      -- aguardando conferência do tabelião
    'aprovada',        -- minuta definitiva pronta para assinatura
    'concluida',       -- ato lavrado/assinado
    'cancelada'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type tipo_minuta as enum ('provisoria', 'definitiva');
exception when duplicate_object then null; end $$;

-- ----------------------------------------------------------------------------
-- TABELAS
-- ----------------------------------------------------------------------------
create table if not exists public.cartorios (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null,
  cns         text,                       -- Código Nacional de Serventia
  comarca     text,
  uf          text,
  created_at  timestamptz not null default now()
);

-- Perfis vinculados ao auth.users do Supabase
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  cartorio_id  uuid references public.cartorios(id) on delete set null,
  nome         text not null default '',
  papel        papel_usuario not null default 'cliente',
  created_at   timestamptz not null default now()
);

-- Catálogo de tipos de ato com schema dinâmico de campos e template da minuta
create table if not exists public.tipos_ato (
  id            uuid primary key default gen_random_uuid(),
  slug          text unique not null,
  nome          text not null,
  descricao     text,
  papeis        text[] not null default '{}',   -- ex.: {Outorgante Vendedor, Outorgado Comprador}
  schema_campos jsonb not null default '[]',     -- [{key,label,type,required,options?}]
  template      text not null default '',        -- texto com {{placeholders}}
  ativo         boolean not null default true,
  created_at    timestamptz not null default now()
);

-- Demandas/solicitações (o que aparece no dashboard)
create table if not exists public.solicitacoes (
  id            uuid primary key default gen_random_uuid(),
  cartorio_id   uuid not null references public.cartorios(id) on delete cascade,
  tipo_ato_id   uuid not null references public.tipos_ato(id),
  protocolo     text unique,
  status        status_solicitacao not null default 'recebida',
  titulo        text,
  cliente_id    uuid references auth.users(id),   -- parte/solicitante
  responsavel_id uuid references auth.users(id),  -- escrevente do cartório
  criado_por    uuid references auth.users(id) default auth.uid(),
  dados         jsonb not null default '{}',      -- valores dos schema_campos
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_solic_cartorio on public.solicitacoes(cartorio_id);
create index if not exists idx_solic_status   on public.solicitacoes(status);

-- Partes da escritura
create table if not exists public.partes (
  id              uuid primary key default gen_random_uuid(),
  solicitacao_id  uuid not null references public.solicitacoes(id) on delete cascade,
  papel           text not null,            -- ex.: Outorgante Vendedor
  nome            text not null,
  cpf_cnpj        text,
  dados           jsonb not null default '{}',  -- estado civil, regime, endereço, etc.
  created_at      timestamptz not null default now()
);

create index if not exists idx_partes_solic on public.partes(solicitacao_id);

-- Minutas versionadas (provisória -> definitiva)
create table if not exists public.minutas (
  id              uuid primary key default gen_random_uuid(),
  solicitacao_id  uuid not null references public.solicitacoes(id) on delete cascade,
  versao          int not null,
  tipo            tipo_minuta not null default 'provisoria',
  conteudo        text not null,
  hash            text not null,                 -- sha256 do conteúdo
  qualificacao    jsonb not null default '[]',   -- parecer Artemis: [{item,status,fundamento}]
  criado_por      uuid references auth.users(id) default auth.uid(),
  created_at      timestamptz not null default now(),
  unique (solicitacao_id, versao)
);

create index if not exists idx_minutas_solic on public.minutas(solicitacao_id);

-- Cadeia de custódia: log append-only, encadeado por hash
create table if not exists public.custodia_log (
  id              bigint generated always as identity primary key,
  solicitacao_id  uuid not null references public.solicitacoes(id) on delete cascade,
  minuta_id       uuid references public.minutas(id) on delete set null,
  ator_id         uuid references auth.users(id),
  acao            text not null,                 -- ex.: minuta_gerada, status_alterado
  detalhe         jsonb not null default '{}',
  hash_anterior   text,
  hash_atual      text not null,
  created_at      timestamptz not null default now()
);

create index if not exists idx_custodia_solic on public.custodia_log(solicitacao_id, id);

-- ----------------------------------------------------------------------------
-- FUNÇÕES AUXILIARES
-- ----------------------------------------------------------------------------

-- Cartório do usuário autenticado (security definer p/ uso em policies)
create or replace function public.current_cartorio_id()
returns uuid language sql stable security definer set search_path = public as $$
  select cartorio_id from public.profiles where id = auth.uid();
$$;

create or replace function public.current_papel()
returns papel_usuario language sql stable security definer set search_path = public as $$
  select papel from public.profiles where id = auth.uid();
$$;

-- updated_at automático
create or replace function public.tg_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- Geração de protocolo: AAAA/NNNNNN
create sequence if not exists public.seq_protocolo;

create or replace function public.tg_gerar_protocolo()
returns trigger language plpgsql as $$
begin
  if new.protocolo is null then
    new.protocolo := to_char(now(), 'YYYY') || '/' ||
                     lpad(nextval('public.seq_protocolo')::text, 6, '0');
  end if;
  return new;
end $$;

-- Núcleo da cadeia de custódia: insere registro encadeado por hash
create or replace function public.registrar_custodia(
  p_solicitacao uuid,
  p_minuta      uuid,
  p_acao        text,
  p_detalhe     jsonb
) returns void language plpgsql security definer set search_path = public, extensions as $$
declare
  v_prev text;
  v_payload text;
  v_hash text;
begin
  select hash_atual into v_prev
  from public.custodia_log
  where solicitacao_id = p_solicitacao
  order by id desc
  limit 1;

  v_payload := coalesce(v_prev, '') || '|' || p_acao || '|' ||
               coalesce(auth.uid()::text, 'sistema') || '|' ||
               coalesce(p_detalhe::text, '{}') || '|' || now()::text;

  v_hash := encode(extensions.digest(v_payload, 'sha256'), 'hex');

  insert into public.custodia_log
    (solicitacao_id, minuta_id, ator_id, acao, detalhe, hash_anterior, hash_atual)
  values
    (p_solicitacao, p_minuta, auth.uid(), p_acao, coalesce(p_detalhe,'{}'::jsonb), v_prev, v_hash);
end $$;

-- Triggers de custódia
create or replace function public.tg_custodia_solicitacao()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (tg_op = 'INSERT') then
    perform public.registrar_custodia(new.id, null, 'solicitacao_criada',
      jsonb_build_object('status', new.status, 'protocolo', new.protocolo));
  elsif (tg_op = 'UPDATE') then
    if new.status is distinct from old.status then
      perform public.registrar_custodia(new.id, null, 'status_alterado',
        jsonb_build_object('de', old.status, 'para', new.status));
    end if;
    if new.dados is distinct from old.dados then
      perform public.registrar_custodia(new.id, null, 'dados_atualizados', '{}'::jsonb);
    end if;
  end if;
  return new;
end $$;

create or replace function public.tg_custodia_minuta()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.registrar_custodia(new.solicitacao_id, new.id, 'minuta_gerada',
    jsonb_build_object('versao', new.versao, 'tipo', new.tipo, 'hash', new.hash));
  return new;
end $$;

-- ----------------------------------------------------------------------------
-- TRIGGERS
-- ----------------------------------------------------------------------------
drop trigger if exists trg_solic_updated on public.solicitacoes;
create trigger trg_solic_updated before update on public.solicitacoes
  for each row execute function public.tg_set_updated_at();

drop trigger if exists trg_solic_protocolo on public.solicitacoes;
create trigger trg_solic_protocolo before insert on public.solicitacoes
  for each row execute function public.tg_gerar_protocolo();

drop trigger if exists trg_solic_custodia on public.solicitacoes;
create trigger trg_solic_custodia after insert or update on public.solicitacoes
  for each row execute function public.tg_custodia_solicitacao();

drop trigger if exists trg_minuta_custodia on public.minutas;
create trigger trg_minuta_custodia after insert on public.minutas
  for each row execute function public.tg_custodia_minuta();

-- Cria profile automaticamente quando um usuário se cadastra
create or replace function public.tg_handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, nome, papel)
  values (new.id, coalesce(new.raw_user_meta_data->>'nome', ''), 'cliente')
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists trg_on_auth_user_created on auth.users;
create trigger trg_on_auth_user_created after insert on auth.users
  for each row execute function public.tg_handle_new_user();

-- ----------------------------------------------------------------------------
-- ROW LEVEL SECURITY
-- ----------------------------------------------------------------------------
alter table public.cartorios     enable row level security;
alter table public.profiles      enable row level security;
alter table public.tipos_ato     enable row level security;
alter table public.solicitacoes  enable row level security;
alter table public.partes        enable row level security;
alter table public.minutas       enable row level security;
alter table public.custodia_log  enable row level security;

-- profiles: cada um lê/edita o próprio; equipe do cartório lê colegas
drop policy if exists p_profiles_self on public.profiles;
create policy p_profiles_self on public.profiles
  for select using (
    id = auth.uid()
    or (cartorio_id is not null and cartorio_id = public.current_cartorio_id())
  );
drop policy if exists p_profiles_upd on public.profiles;
create policy p_profiles_upd on public.profiles
  for update using (id = auth.uid());

-- cartorios: membros do cartório leem o seu
drop policy if exists p_cartorios_read on public.cartorios;
create policy p_cartorios_read on public.cartorios
  for select using (id = public.current_cartorio_id());

-- tipos_ato: leitura para qualquer autenticado
drop policy if exists p_tipos_read on public.tipos_ato;
create policy p_tipos_read on public.tipos_ato
  for select using (auth.role() = 'authenticated');

-- Helper: usuário é equipe do cartório da solicitação?
create or replace function public.is_equipe(p_cartorio uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_cartorio = public.current_cartorio_id()
         and public.current_papel() in ('tabeliao','escrevente');
$$;

-- solicitacoes: equipe do cartório vê tudo; cliente vê as suas
drop policy if exists p_solic_select on public.solicitacoes;
create policy p_solic_select on public.solicitacoes
  for select using (
    public.is_equipe(cartorio_id)
    or cliente_id = auth.uid()
    or criado_por = auth.uid()
  );

drop policy if exists p_solic_insert on public.solicitacoes;
create policy p_solic_insert on public.solicitacoes
  for insert with check (
    criado_por = auth.uid()
    and (public.is_equipe(cartorio_id) or cliente_id = auth.uid() or cliente_id is null)
  );

drop policy if exists p_solic_update on public.solicitacoes;
create policy p_solic_update on public.solicitacoes
  for update using (
    public.is_equipe(cartorio_id) or criado_por = auth.uid()
  );

-- partes / minutas / custodia: seguem a solicitação
drop policy if exists p_partes_all on public.partes;
create policy p_partes_all on public.partes
  for all using (
    exists (select 1 from public.solicitacoes s where s.id = solicitacao_id
            and (public.is_equipe(s.cartorio_id) or s.cliente_id = auth.uid() or s.criado_por = auth.uid()))
  ) with check (
    exists (select 1 from public.solicitacoes s where s.id = solicitacao_id
            and (public.is_equipe(s.cartorio_id) or s.cliente_id = auth.uid() or s.criado_por = auth.uid()))
  );

drop policy if exists p_minutas_select on public.minutas;
create policy p_minutas_select on public.minutas
  for select using (
    exists (select 1 from public.solicitacoes s where s.id = solicitacao_id
            and (public.is_equipe(s.cartorio_id) or s.cliente_id = auth.uid() or s.criado_por = auth.uid()))
  );
drop policy if exists p_minutas_insert on public.minutas;
create policy p_minutas_insert on public.minutas
  for insert with check (
    exists (select 1 from public.solicitacoes s where s.id = solicitacao_id
            and (public.is_equipe(s.cartorio_id) or s.criado_por = auth.uid()))
  );

drop policy if exists p_custodia_select on public.custodia_log;
create policy p_custodia_select on public.custodia_log
  for select using (
    exists (select 1 from public.solicitacoes s where s.id = solicitacao_id
            and (public.is_equipe(s.cartorio_id) or s.cliente_id = auth.uid() or s.criado_por = auth.uid()))
  );
-- inserts no log são feitos por funções security definer; sem policy de insert direto.

-- ----------------------------------------------------------------------------
-- SEED · tipos de ato (templates ilustrativos — NÃO são modelos jurídicos finais)
-- ----------------------------------------------------------------------------
insert into public.tipos_ato (slug, nome, descricao, papeis, schema_campos, template)
values
(
  'compra-venda-imovel',
  'Escritura de Compra e Venda de Imóvel',
  'Transmissão onerosa de bem imóvel entre vendedor e comprador.',
  array['Outorgante Vendedor','Outorgado Comprador'],
  '[
    {"key":"imovel_descricao","label":"Descrição do imóvel","type":"textarea","required":true},
    {"key":"imovel_matricula","label":"Matrícula","type":"text","required":true},
    {"key":"imovel_cartorio_ri","label":"Cartório de Registro de Imóveis","type":"text","required":true},
    {"key":"valor","label":"Valor (R$)","type":"number","required":true},
    {"key":"forma_pagamento","label":"Forma de pagamento","type":"select","required":true,"options":["À vista","Financiamento","Dação em pagamento","Parcelado"]},
    {"key":"itbi_pago","label":"ITBI recolhido?","type":"select","required":true,"options":["Sim","Não"]}
  ]'::jsonb,
  'ESCRITURA PÚBLICA DE COMPRA E VENDA

SAIBAM quantos esta virem que, perante mim, Tabelião, compareceram as partes entre si justas e contratadas, a saber:

OUTORGANTE VENDEDOR: {{parte:Outorgante Vendedor}}.
OUTORGADO COMPRADOR: {{parte:Outorgado Comprador}}.

E, pelo Outorgante Vendedor, me foi dito que é legítimo proprietário do imóvel assim descrito: {{imovel_descricao}}, objeto da matrícula nº {{imovel_matricula}} do {{imovel_cartorio_ri}}.

Que, pela presente escritura e na melhor forma de direito, VENDE ao Outorgado Comprador o imóvel acima, pelo preço certo e ajustado de R$ {{valor}}, na forma "{{forma_pagamento}}", dando ao comprador plena quitação.

Recolhimento de ITBI: {{itbi_pago}}.

Pelo Outorgado Comprador foi dito que aceita esta escritura nos seus expressos termos.

[Encerramento, leitura e assinaturas — lavrado eletronicamente nos termos do CNN/CNJ e da plataforma e-Notariado.]'
),
(
  'doacao',
  'Escritura de Doação',
  'Transferência gratuita de bens do doador ao donatário.',
  array['Doador','Donatário'],
  '[
    {"key":"bem_descricao","label":"Descrição do bem doado","type":"textarea","required":true},
    {"key":"valor","label":"Valor atribuído (R$)","type":"number","required":true},
    {"key":"reserva_usufruto","label":"Há reserva de usufruto?","type":"select","required":true,"options":["Sim","Não"]},
    {"key":"clausulas","label":"Cláusulas (inalienabilidade, impenhorabilidade...)","type":"textarea","required":false}
  ]'::jsonb,
  'ESCRITURA PÚBLICA DE DOAÇÃO

Compareceram as partes:
DOADOR: {{parte:Doador}}.
DONATÁRIO: {{parte:Donatário}}.

Pelo Doador foi dito que DOA ao Donatário, que aceita, o seguinte bem: {{bem_descricao}}, ao qual se atribui o valor de R$ {{valor}}.
Reserva de usufruto: {{reserva_usufruto}}.
Cláusulas: {{clausulas}}.

[Encerramento, leitura e assinaturas — lavrado eletronicamente nos termos do CNN/CNJ.]'
),
(
  'procuracao',
  'Procuração Pública',
  'Outorga de poderes de representação do outorgante ao procurador.',
  array['Outorgante','Outorgado (Procurador)'],
  '[
    {"key":"poderes","label":"Poderes outorgados","type":"textarea","required":true},
    {"key":"finalidade","label":"Finalidade específica","type":"text","required":false},
    {"key":"prazo","label":"Prazo de validade","type":"text","required":false}
  ]'::jsonb,
  'PROCURAÇÃO PÚBLICA

OUTORGANTE: {{parte:Outorgante}}.
OUTORGADO (PROCURADOR): {{parte:Outorgado (Procurador)}}.

Pelo Outorgante foi dito que nomeia e constitui seu bastante procurador o Outorgado, a quem confere os poderes para: {{poderes}}.
Finalidade: {{finalidade}}. Prazo: {{prazo}}.

[Encerramento, leitura e assinaturas — lavrado eletronicamente nos termos do CNN/CNJ.]'
)
on conflict (slug) do nothing;

-- ============================================================================
-- FIM DO SCHEMA
-- Próximo passo: crie usuários no Auth e vincule-os a um cartório executando,
-- no SQL Editor (substituindo o e-mail), o bloco abaixo:
--
--   insert into public.cartorios (nome, cns, comarca, uf)
--   values ('1º Tabelionato de Notas — Campinas', '000000', 'Campinas', 'SP')
--   returning id;
--
--   update public.profiles set papel = 'tabeliao',
--     cartorio_id = (select id from public.cartorios limit 1)
--   where id = (select id from auth.users where email = 'voce@exemplo.com');
-- ============================================================================

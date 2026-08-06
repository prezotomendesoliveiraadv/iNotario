-- ============================================================================
-- iNotário · Acervo + Portal do Cliente + Triagem  (VERSÃO CORRIGIDA)
-- Reordenado: TABELAS primeiro, STORAGE por último (tolerante a permissão).
-- Idempotente — pode ser executado novamente sem problemas.
-- Cole tudo no SQL Editor do Supabase e clique em RUN.
-- ============================================================================

create extension if not exists pgcrypto with schema extensions;

-- ----------------------------------------------------------------------------
-- ENUM
-- ----------------------------------------------------------------------------
do $$ begin
  create type categoria_acervo as enum ('modelo', 'jurisprudencia', 'orientacao', 'outro');
exception when duplicate_object then null; end $$;

-- ----------------------------------------------------------------------------
-- 1) ACERVO
-- ----------------------------------------------------------------------------
create table if not exists public.acervo (
  id             uuid primary key default gen_random_uuid(),
  cartorio_id    uuid not null references public.cartorios(id) on delete cascade,
  categoria      categoria_acervo not null default 'outro',
  tipo_ato_slug  text,
  titulo         text not null,
  tema           text[] not null default '{}',
  descricao      text,
  storage_path   text,
  mime           text,
  tamanho        bigint,
  conteudo_texto text,
  criado_por     uuid references auth.users(id) default auth.uid(),
  created_at     timestamptz not null default now()
);
create index if not exists idx_acervo_cartorio on public.acervo(cartorio_id);
create index if not exists idx_acervo_categoria on public.acervo(categoria);
create index if not exists idx_acervo_tema on public.acervo using gin(tema);

alter table public.acervo enable row level security;
drop policy if exists p_acervo_all on public.acervo;
create policy p_acervo_all on public.acervo for all
  using (public.is_equipe(cartorio_id)) with check (public.is_equipe(cartorio_id));

-- ----------------------------------------------------------------------------
-- 2) ACESSO DO CLIENTE (link tokenizado)
-- ----------------------------------------------------------------------------
create table if not exists public.acesso_cliente (
  id              uuid primary key default gen_random_uuid(),
  solicitacao_id  uuid not null references public.solicitacoes(id) on delete cascade,
  token           text unique not null default encode(extensions.gen_random_bytes(24), 'hex'),
  email_cliente   text,
  expira_em       timestamptz not null default (now() + interval '14 days'),
  lgpd_aceite     boolean not null default false,
  lgpd_aceite_em  timestamptz,
  lgpd_versao     text,
  devolvido_em    timestamptz,
  created_at      timestamptz not null default now()
);
create index if not exists idx_acesso_solic on public.acesso_cliente(solicitacao_id);

alter table public.acesso_cliente enable row level security;
drop policy if exists p_acesso_equipe on public.acesso_cliente;
create policy p_acesso_equipe on public.acesso_cliente for all
  using (exists (select 1 from public.solicitacoes s where s.id = solicitacao_id and public.is_equipe(s.cartorio_id)))
  with check (exists (select 1 from public.solicitacoes s where s.id = solicitacao_id and public.is_equipe(s.cartorio_id)));

-- ----------------------------------------------------------------------------
-- 3) UPLOADS DO CLIENTE
-- ----------------------------------------------------------------------------
create table if not exists public.cliente_uploads (
  id              uuid primary key default gen_random_uuid(),
  solicitacao_id  uuid not null references public.solicitacoes(id) on delete cascade,
  acesso_id       uuid references public.acesso_cliente(id) on delete set null,
  tipo_doc        text not null default 'outro',
  nome_arquivo    text not null,
  storage_path    text not null,
  mime            text,
  tamanho         bigint,
  enviado_em      timestamptz not null default now()
);
create index if not exists idx_cliup_solic on public.cliente_uploads(solicitacao_id);

alter table public.cliente_uploads enable row level security;
drop policy if exists p_cliup_equipe on public.cliente_uploads;
create policy p_cliup_equipe on public.cliente_uploads for select
  using (exists (select 1 from public.solicitacoes s where s.id = solicitacao_id and public.is_equipe(s.cartorio_id)));

-- ----------------------------------------------------------------------------
-- 4) TRIAGEM
-- ----------------------------------------------------------------------------
create table if not exists public.triagem (
  id              uuid primary key default gen_random_uuid(),
  solicitacao_id  uuid not null references public.solicitacoes(id) on delete cascade,
  resultado       jsonb not null default '{}',
  criado_por      uuid references auth.users(id) default auth.uid(),
  created_at      timestamptz not null default now()
);
create index if not exists idx_triagem_solic on public.triagem(solicitacao_id, created_at desc);

alter table public.triagem enable row level security;
drop policy if exists p_triagem_read on public.triagem;
create policy p_triagem_read on public.triagem for select
  using (exists (select 1 from public.solicitacoes s where s.id = solicitacao_id and public.is_equipe(s.cartorio_id)));

-- ----------------------------------------------------------------------------
-- 5) FUNÇÃO DE LEITURA DO PORTAL (valida token; expõe o mínimo)
-- ----------------------------------------------------------------------------
create or replace function public.portal_dados(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ac record; v_sol record; v_tipo record;
begin
  select * into v_ac from public.acesso_cliente where token = p_token;
  if v_ac is null or v_ac.expira_em < now() then
    return jsonb_build_object('erro', 'Link inválido ou expirado.');
  end if;
  select * into v_sol from public.solicitacoes where id = v_ac.solicitacao_id;
  select * into v_tipo from public.tipos_ato where id = v_sol.tipo_ato_id;
  return jsonb_build_object(
    'ok', true, 'protocolo', v_sol.protocolo, 'status', v_sol.status,
    'lgpd_aceite', v_ac.lgpd_aceite,
    'tipo_ato', jsonb_build_object('nome', v_tipo.nome, 'descricao', v_tipo.descricao,
                                   'papeis', v_tipo.papeis, 'schema_campos', v_tipo.schema_campos),
    'dados', v_sol.dados
  );
end $$;

revoke all on function public.portal_dados(text) from public, anon, authenticated;
grant execute on function public.portal_dados(text) to service_role;

-- ----------------------------------------------------------------------------
-- 6) STORAGE (por último; tolerante a falta de permissão via SQL)
-- ----------------------------------------------------------------------------
do $$
begin
  insert into storage.buckets (id, name, public)
  values ('acervo','acervo',false), ('cliente-uploads','cliente-uploads',false)
  on conflict (id) do nothing;
exception when others then
  raise notice 'Não foi possível criar os buckets via SQL (%). Crie-os no painel: Storage > New bucket (acervo e cliente-uploads, ambos privados).', sqlerrm;
end $$;

do $$
begin
  drop policy if exists p_acervo_rw on storage.objects;
  create policy p_acervo_rw on storage.objects for all to authenticated
    using (bucket_id = 'acervo') with check (bucket_id = 'acervo');
  drop policy if exists p_cliup_read on storage.objects;
  create policy p_cliup_read on storage.objects for select to authenticated
    using (bucket_id = 'cliente-uploads');
exception when others then
  raise notice 'Não foi possível criar policies em storage.objects via SQL (%). Crie-as no painel: Storage > Policies.', sqlerrm;
end $$;

-- ----------------------------------------------------------------------------
-- 7) Recarrega o cache do PostgREST (resolve "Could not find the table ...")
-- ----------------------------------------------------------------------------
notify pgrst, 'reload schema';

-- ============================================================================
-- FIM. Confirme com:  select to_regclass('public.acervo');   (deve retornar 'acervo')
-- ============================================================================

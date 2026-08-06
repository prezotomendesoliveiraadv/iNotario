-- ============================================================================
-- iNotário · Melhorias: múltiplas partes, WhatsApp interno, modelo padrão,
--                       consulta jurídica e busca interna
-- Pré-requisitos: schema.sql, acervo_portal_fix.sql, workflow_fluxo.sql
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) PARTES: ordenação e busca (um ato pode ter N partes por papel)
-- ---------------------------------------------------------------------------
alter table public.partes add column if not exists ordem int not null default 0;

-- Busca por nome/CPF de qualquer parte (filtro interno)
create index if not exists idx_partes_nome on public.partes (lower(nome));
create index if not exists idx_partes_doc  on public.partes (regexp_replace(coalesce(cpf_cnpj,''), '\D', '', 'g'));

-- ---------------------------------------------------------------------------
-- 2) ACERVO: modelo padrão por tipo de ato
-- ---------------------------------------------------------------------------
alter table public.acervo add column if not exists padrao boolean not null default false;

-- Só um modelo padrão por tipo de ato, por cartório
create unique index if not exists idx_acervo_padrao_unico
  on public.acervo (cartorio_id, tipo_ato_slug)
  where padrao and categoria = 'modelo';

-- Ao marcar um modelo como padrão, desmarca o anterior do mesmo tipo
create or replace function public.acervo_padrao_unico() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.padrao and new.categoria = 'modelo' then
    update public.acervo set padrao = false
    where cartorio_id = new.cartorio_id
      and tipo_ato_slug is not distinct from new.tipo_ato_slug
      and categoria = 'modelo'
      and id <> new.id
      and padrao;
  end if;
  return new;
end $$;

drop trigger if exists trg_acervo_padrao on public.acervo;
create trigger trg_acervo_padrao before insert or update of padrao on public.acervo
  for each row execute function public.acervo_padrao_unico();

-- ---------------------------------------------------------------------------
-- 3) CONSULTA JURÍDICA: pareceres da IA sobre o acervo + legislação notarial
-- ---------------------------------------------------------------------------
create table if not exists public.consultas_juridicas (
  id             uuid primary key default gen_random_uuid(),
  cartorio_id    uuid not null references public.cartorios(id) on delete cascade,
  solicitacao_id uuid references public.solicitacoes(id) on delete set null,
  autor          uuid references auth.users(id) default auth.uid(),
  pergunta       text not null,
  parecer        text,
  fundamentos    jsonb not null default '[]',   -- [{norma, dispositivo, aplicacao}]
  fontes_acervo  jsonb not null default '[]',   -- [{id, titulo, categoria}]
  ressalvas      text,
  created_at     timestamptz not null default now()
);
create index if not exists idx_cj_cartorio on public.consultas_juridicas(cartorio_id, created_at desc);
create index if not exists idx_cj_solic on public.consultas_juridicas(solicitacao_id, created_at desc);

alter table public.consultas_juridicas enable row level security;
drop policy if exists p_cj_equipe on public.consultas_juridicas;
create policy p_cj_equipe on public.consultas_juridicas for all
  using (public.is_equipe(cartorio_id)) with check (public.is_equipe(cartorio_id));

-- ---------------------------------------------------------------------------
-- 4) BUSCA INTERNA: protocolo, nome ou CPF de qualquer parte, e status
-- ---------------------------------------------------------------------------
create or replace function public.buscar_solicitacoes(
  p_cartorio uuid,
  p_termo    text default null,
  p_status   text default null,
  p_limite   int  default 50
)
returns table (
  id uuid, protocolo text, titulo text, status text, etapa text,
  responsavel_papel text, complexidade text, exigencia_atual text,
  tipo_nome text, partes_nomes text, created_at timestamptz, updated_at timestamptz
)
language sql stable security definer set search_path = public as $$
  with termo as (
    select nullif(btrim(coalesce(p_termo,'')), '') as t
  ), so as (
    select numeros from (select regexp_replace(coalesce((select t from termo),''), '\D', '', 'g') as numeros) x
  )
  select s.id, s.protocolo, s.titulo, s.status::text, s.etapa, s.responsavel_papel,
         s.complexidade, s.exigencia_atual,
         ta.nome as tipo_nome,
         (select string_agg(p.nome, ', ' order by p.ordem, p.created_at)
            from public.partes p where p.solicitacao_id = s.id) as partes_nomes,
         s.created_at, s.updated_at
  from public.solicitacoes s
  left join public.tipos_ato ta on ta.id = s.tipo_ato_id
  where s.cartorio_id = p_cartorio
    and public.is_equipe(s.cartorio_id)
    and (p_status is null or p_status = '' or s.status::text = p_status)
    and (
      (select t from termo) is null
      or s.protocolo ilike '%' || (select t from termo) || '%'
      or s.titulo    ilike '%' || (select t from termo) || '%'
      or ta.nome     ilike '%' || (select t from termo) || '%'
      or exists (
        select 1 from public.partes p
        where p.solicitacao_id = s.id
          and (
            p.nome ilike '%' || (select t from termo) || '%'
            or (
              length((select numeros from so)) >= 3
              and regexp_replace(coalesce(p.cpf_cnpj,''), '\D', '', 'g') like '%' || (select numeros from so) || '%'
            )
          )
      )
    )
  order by s.updated_at desc
  limit greatest(1, least(coalesce(p_limite, 50), 200));
$$;

notify pgrst, 'reload schema';
-- ============================================================================

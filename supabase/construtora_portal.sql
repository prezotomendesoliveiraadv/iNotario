-- ============================================================================
-- iNotário · Portal da construtora
--   0) CORREÇÃO: is_equipe não reconhecia os papéis criados depois do schema
--   1) Usuários da construtora (nova classe de acesso, fora do cartório)
--   2) Validação jurídica da construtora — gate ORTOGONAL, como o financeiro
--   3) Agendamento da assinatura com o comprador
--   4) Painéis (interno por construtora e externo da construtora)
-- Pré-requisitos: schema.sql → ... → construtoras.sql
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0) CORREÇÃO DE RLS
-- O enum papel_usuario ganhou tabeliao_substituto, financeiro e tabeliao_oficial
-- em migrations posteriores, mas is_equipe continuou aceitando apenas
-- ('tabeliao','escrevente') — ou seja, três papéis do fluxo ficavam sem acesso.
-- ---------------------------------------------------------------------------
create or replace function public.is_equipe(p_cartorio uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_cartorio is not null
     and p_cartorio = public.current_cartorio_id()
     and public.current_papel() in (
       'tabeliao', 'escrevente', 'tabeliao_substituto', 'financeiro', 'tabeliao_oficial'
     );
$$;

-- ---------------------------------------------------------------------------
-- 1) USUÁRIOS DA CONSTRUTORA
-- Não são equipe do cartório e não têm cartorio_id: enxergam apenas os atos
-- dos empreendimentos da própria construtora.
-- ---------------------------------------------------------------------------
do $$ begin
  alter type papel_usuario add value if not exists 'construtora';
exception when others then null; end $$;

create table if not exists public.construtora_usuarios (
  id             uuid primary key default gen_random_uuid(),
  construtora_id uuid not null references public.construtoras(id) on delete cascade,
  user_id        uuid not null references auth.users(id) on delete cascade,
  nome           text,
  email          text,
  papel_construtora text not null default 'juridico',  -- juridico (decide) | gestor (acompanha)
  ativo          boolean not null default true,
  criado_por     uuid references auth.users(id) default auth.uid(),
  created_at     timestamptz not null default now(),
  unique (construtora_id, user_id)
);
create index if not exists idx_cu_user on public.construtora_usuarios(user_id) where ativo;

-- O usuário logado pertence a esta construtora?
create or replace function public.is_construtora(p_construtora uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.construtora_usuarios cu
    where cu.construtora_id = p_construtora and cu.user_id = auth.uid() and cu.ativo
  );
$$;

-- Construtoras do usuário logado (normalmente uma)
create or replace function public.minhas_construtoras()
returns setof uuid language sql stable security definer set search_path = public as $$
  select construtora_id from public.construtora_usuarios
  where user_id = auth.uid() and ativo;
$$;

-- O usuário logado é da construtora vendedora deste ato?
create or replace function public.is_construtora_da_solicitacao(p_solicitacao uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.solicitacoes s
    join public.empreendimentos e on e.id = s.empreendimento_id
    where s.id = p_solicitacao and public.is_construtora(e.construtora_id)
  );
$$;

-- Só o jurídico decide; o gestor apenas acompanha.
create or replace function public.pode_validar_construtora(p_solicitacao uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.solicitacoes s
    join public.empreendimentos e on e.id = s.empreendimento_id
    join public.construtora_usuarios cu on cu.construtora_id = e.construtora_id
    where s.id = p_solicitacao and cu.user_id = auth.uid() and cu.ativo
      and cu.papel_construtora = 'juridico'
  );
$$;

-- ---------------------------------------------------------------------------
-- 2) VALIDAÇÃO JURÍDICA — gate ortogonal (espelha financeiro_status)
--    nao_aplicavel | pendente | enviada | aprovada | ressalvas | reprovada
-- ---------------------------------------------------------------------------
alter table public.solicitacoes add column if not exists validacao_construtora text
  not null default 'nao_aplicavel';
alter table public.solicitacoes add column if not exists validacao_enviada_em timestamptz;
alter table public.solicitacoes add column if not exists validacao_decidida_em timestamptz;

-- Rodadas de análise: trilha de auditoria de quem decidiu o quê e quando
create table if not exists public.validacoes_construtora (
  id             uuid primary key default gen_random_uuid(),
  solicitacao_id uuid not null references public.solicitacoes(id) on delete cascade,
  minuta_id      uuid references public.minutas(id) on delete set null,
  rodada         int not null default 1,
  acao           text not null,             -- enviada | aprovada | ressalvas | reprovada | reenviada
  decidido_por   uuid references auth.users(id) default auth.uid(),
  autor_nome     text,
  observacoes    text,
  created_at     timestamptz not null default now()
);
create index if not exists idx_val_solic on public.validacoes_construtora(solicitacao_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 3) AGENDAMENTO DA ASSINATURA (liberado após a aprovação da construtora)
-- ---------------------------------------------------------------------------
alter table public.solicitacoes add column if not exists assinatura_em timestamptz;
alter table public.solicitacoes add column if not exists assinatura_local text;
alter table public.solicitacoes add column if not exists assinatura_status text
  not null default 'nao_agendada';           -- nao_agendada | agendada | realizada | remarcada
create index if not exists idx_solic_assinatura on public.solicitacoes(assinatura_em)
  where assinatura_em is not null;

-- ---------------------------------------------------------------------------
-- 4) RLS DO PORTAL DA CONSTRUTORA
--    Leitura restrita ao próprio universo; escrita apenas na decisão jurídica.
-- ---------------------------------------------------------------------------
alter table public.construtora_usuarios   enable row level security;
alter table public.validacoes_construtora enable row level security;

-- Vínculos: a equipe do cartório administra; o próprio usuário se vê.
drop policy if exists p_cu_equipe on public.construtora_usuarios;
create policy p_cu_equipe on public.construtora_usuarios for all
  using (exists (select 1 from public.construtoras c
                 where c.id = construtora_id and public.is_equipe(c.cartorio_id)))
  with check (exists (select 1 from public.construtoras c
                 where c.id = construtora_id and public.is_equipe(c.cartorio_id)));

drop policy if exists p_cu_proprio on public.construtora_usuarios;
create policy p_cu_proprio on public.construtora_usuarios for select
  using (user_id = auth.uid());

-- Construtora: enxerga o próprio cadastro (sem documentos societários de outras)
drop policy if exists p_construtoras_portal on public.construtoras;
create policy p_construtoras_portal on public.construtoras for select
  using (public.is_construtora(id));

-- Empreendimentos da própria construtora
drop policy if exists p_empreendimentos_portal on public.empreendimentos;
create policy p_empreendimentos_portal on public.empreendimentos for select
  using (public.is_construtora(construtora_id));

-- Solicitações dos seus empreendimentos
drop policy if exists p_solic_construtora on public.solicitacoes;
create policy p_solic_construtora on public.solicitacoes for select
  using (
    empreendimento_id is not null
    and exists (select 1 from public.empreendimentos e
                where e.id = empreendimento_id and public.is_construtora(e.construtora_id))
  );

-- Minutas dos seus atos: leitura apenas (a construtora valida, não edita)
drop policy if exists p_minutas_construtora on public.minutas;
create policy p_minutas_construtora on public.minutas for select
  using (public.is_construtora_da_solicitacao(solicitacao_id));

-- Partes do ato (é a vendedora: conhece o comprador da própria unidade)
drop policy if exists p_partes_construtora on public.partes;
create policy p_partes_construtora on public.partes for select
  using (public.is_construtora_da_solicitacao(solicitacao_id));

-- Histórico de validação: lê quem é do cartório ou da construtora;
-- escreve apenas o jurídico da construtora.
drop policy if exists p_val_leitura on public.validacoes_construtora;
create policy p_val_leitura on public.validacoes_construtora for select
  using (
    public.is_construtora_da_solicitacao(solicitacao_id)
    or exists (select 1 from public.solicitacoes s
               where s.id = solicitacao_id and public.is_equipe(s.cartorio_id))
  );

drop policy if exists p_val_escrita_cartorio on public.validacoes_construtora;
create policy p_val_escrita_cartorio on public.validacoes_construtora for insert
  with check (exists (select 1 from public.solicitacoes s
                      where s.id = solicitacao_id and public.is_equipe(s.cartorio_id)));

drop policy if exists p_val_escrita_juridico on public.validacoes_construtora;
create policy p_val_escrita_juridico on public.validacoes_construtora for insert
  with check (public.pode_validar_construtora(solicitacao_id));

-- ---------------------------------------------------------------------------
-- 5) AÇÕES DO FLUXO
-- ---------------------------------------------------------------------------

-- Cartório envia a minuta para a validação da construtora
create or replace function public.enviar_para_construtora(
  p_solicitacao uuid, p_observacoes text default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cart uuid; v_minuta uuid; v_rodada int;
begin
  select cartorio_id into v_cart from public.solicitacoes where id = p_solicitacao;
  if not public.is_equipe(v_cart) then
    return jsonb_build_object('ok', false, 'erro', 'Sem competência para enviar.');
  end if;
  if not exists (select 1 from public.solicitacoes s
                 where s.id = p_solicitacao and s.empreendimento_id is not null) then
    return jsonb_build_object('ok', false, 'erro', 'O ato não está vinculado a um empreendimento.');
  end if;

  select id into v_minuta from public.minutas
  where solicitacao_id = p_solicitacao order by versao desc limit 1;
  if v_minuta is null then
    return jsonb_build_object('ok', false, 'erro', 'Gere a minuta antes de enviar para validação.');
  end if;

  select coalesce(max(rodada), 0) + 1 into v_rodada
  from public.validacoes_construtora where solicitacao_id = p_solicitacao;

  update public.solicitacoes
     set validacao_construtora = 'enviada', validacao_enviada_em = now()
   where id = p_solicitacao;

  insert into public.validacoes_construtora (solicitacao_id, minuta_id, rodada, acao, observacoes)
  values (p_solicitacao, v_minuta, v_rodada, case when v_rodada = 1 then 'enviada' else 'reenviada' end, p_observacoes);

  return jsonb_build_object('ok', true, 'rodada', v_rodada, 'minuta_id', v_minuta);
end $$;

-- Jurídico da construtora decide
create or replace function public.decidir_validacao_construtora(
  p_solicitacao uuid, p_decisao text, p_observacoes text default null, p_autor_nome text default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_rodada int;
begin
  if p_decisao not in ('aprovada', 'ressalvas', 'reprovada') then
    return jsonb_build_object('ok', false, 'erro', 'Decisão inválida.');
  end if;
  if not public.pode_validar_construtora(p_solicitacao) then
    return jsonb_build_object('ok', false, 'erro', 'Apenas o jurídico da construtora pode decidir.');
  end if;
  if p_decisao <> 'aprovada' and coalesce(btrim(p_observacoes), '') = '' then
    return jsonb_build_object('ok', false, 'erro', 'Descreva as ressalvas para o cartório.');
  end if;

  select coalesce(max(rodada), 1) into v_rodada
  from public.validacoes_construtora where solicitacao_id = p_solicitacao;

  update public.solicitacoes
     set validacao_construtora = p_decisao, validacao_decidida_em = now()
   where id = p_solicitacao;

  insert into public.validacoes_construtora
    (solicitacao_id, rodada, acao, observacoes, autor_nome)
  values (p_solicitacao, v_rodada, p_decisao, p_observacoes, p_autor_nome);

  return jsonb_build_object('ok', true, 'decisao', p_decisao, 'rodada', v_rodada);
end $$;

-- Cartório agenda a assinatura (só depois da aprovação, quando houver construtora)
create or replace function public.agendar_assinatura(
  p_solicitacao uuid, p_quando timestamptz, p_local text default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cart uuid; v_val text; v_empr uuid; v_ja timestamptz;
begin
  select cartorio_id, validacao_construtora, empreendimento_id, assinatura_em
    into v_cart, v_val, v_empr, v_ja
  from public.solicitacoes where id = p_solicitacao;

  if not public.is_equipe(v_cart) then
    return jsonb_build_object('ok', false, 'erro', 'Sem competência para agendar.');
  end if;
  if v_empr is not null and v_val <> 'aprovada' then
    return jsonb_build_object('ok', false, 'erro',
      'A construtora ainda não aprovou a minuta — o agendamento fica bloqueado.');
  end if;

  update public.solicitacoes
     set assinatura_em = p_quando, assinatura_local = p_local,
         assinatura_status = case when v_ja is null then 'agendada' else 'remarcada' end
   where id = p_solicitacao;

  return jsonb_build_object('ok', true,
    'status', case when v_ja is null then 'agendada' else 'remarcada' end);
end $$;

-- ---------------------------------------------------------------------------
-- 6) PAINÉIS
-- ---------------------------------------------------------------------------

-- Interno: uma linha por empreendimento, com o funil do fluxo
create or replace function public.painel_construtoras(
  p_cartorio uuid, p_construtora uuid default null
)
returns table (
  construtora_id uuid, construtora text,
  empreendimento_id uuid, empreendimento text, total_unidades int,
  atos_total bigint, em_elaboracao bigint, aguardando_construtora bigint,
  com_ressalvas bigint, aprovadas bigint, agendadas bigint, concluidas bigint,
  proxima_assinatura timestamptz
)
language sql stable security definer set search_path = public as $$
  select c.id, c.razao_social, e.id, e.nome, e.total_unidades,
         count(s.id) filter (where s.status <> 'cancelada'),
         count(s.id) filter (where s.etapa in ('elaboracao','financeiro','aprovacao')
                               and s.validacao_construtora in ('nao_aplicavel','pendente')),
         count(s.id) filter (where s.validacao_construtora = 'enviada'),
         count(s.id) filter (where s.validacao_construtora in ('ressalvas','reprovada')),
         count(s.id) filter (where s.validacao_construtora = 'aprovada'),
         count(s.id) filter (where s.assinatura_status in ('agendada','remarcada')),
         count(s.id) filter (where s.etapa = 'concluida'),
         min(s.assinatura_em) filter (where s.assinatura_em >= now())
  from public.construtoras c
  join public.empreendimentos e on e.construtora_id = c.id
  left join public.solicitacoes s on s.empreendimento_id = e.id
  where c.cartorio_id = p_cartorio
    and public.is_equipe(p_cartorio)
    and (p_construtora is null or c.id = p_construtora)
  group by c.id, c.razao_social, e.id, e.nome, e.total_unidades
  order by c.razao_social, e.nome;
$$;

-- Externo: os atos que a construtora pode ver, com o que interessa a ela
create or replace function public.painel_da_construtora(p_construtora uuid)
returns table (
  solicitacao_id uuid, protocolo text, empreendimento text, unidade text,
  comprador text, etapa text, validacao text, minuta_versao int,
  enviada_em timestamptz, decidida_em timestamptz,
  assinatura_em timestamptz, assinatura_local text, assinatura_status text
)
language sql stable security definer set search_path = public as $$
  select s.id, s.protocolo, e.nome, s.unidade,
         (select string_agg(p.nome, ', ' order by p.ordem)
            from public.partes p
           where p.solicitacao_id = s.id and p.papel ilike '%comprador%'),
         s.etapa, s.validacao_construtora,
         (select max(m.versao) from public.minutas m where m.solicitacao_id = s.id),
         s.validacao_enviada_em, s.validacao_decidida_em,
         s.assinatura_em, s.assinatura_local, s.assinatura_status
  from public.solicitacoes s
  join public.empreendimentos e on e.id = s.empreendimento_id
  where e.construtora_id = p_construtora
    and public.is_construtora(p_construtora)
    and s.status <> 'cancelada'
  order by
    case s.validacao_construtora when 'enviada' then 0 when 'ressalvas' then 1 else 2 end,
    s.assinatura_em nulls last, s.updated_at desc;
$$;

notify pgrst, 'reload schema';
-- ============================================================================

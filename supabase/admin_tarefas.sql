-- ============================================================================
-- iNotário · Administração de usuários e fluxo de tarefas
--   1) Hierarquia: admin da plataforma → admin do cartório → usuários
--   2) Grupos de usuários, nível de acesso e validade
--   3) Tarefas designadas entre usuários, vinculadas ao protocolo
-- Pré-requisitos: schema.sql → ... → construtora_portal.sql
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) PAPEL DE ADMINISTRADOR DO CARTÓRIO
-- ---------------------------------------------------------------------------
do $$ begin
  alter type papel_usuario add value if not exists 'admin_cartorio';
exception when others then null; end $$;

do $$ begin
  alter type papel_usuario add value if not exists 'conferente';
exception when others then null; end $$;

-- ---------------------------------------------------------------------------
-- 2) GRUPOS DE USUÁRIOS
-- O grupo é organizacional; o papel continua sendo a COMPETÊNCIA no fluxo
-- (que é matéria legal) e o nível é o alcance ADMINISTRATIVO. São coisas
-- distintas de propósito: um conferente e um escrevente podem ter a mesma
-- competência de etapa e alcances administrativos diferentes.
-- ---------------------------------------------------------------------------
create table if not exists public.grupos_usuarios (
  id           uuid primary key default gen_random_uuid(),
  cartorio_id  uuid not null references public.cartorios(id) on delete cascade,
  nome         text not null,
  slug         text not null,
  papel_padrao papel_usuario not null default 'escrevente',
  nivel_padrao int not null default 2,          -- 1 consulta · 2 operação · 3 supervisão · 4 administração
  descricao    text,
  ativo        boolean not null default true,
  created_at   timestamptz not null default now(),
  unique (cartorio_id, slug)
);
create index if not exists idx_grupos_cart on public.grupos_usuarios(cartorio_id, ativo);

-- ---------------------------------------------------------------------------
-- 3) PERFIL: grupo, nível, validade e situação
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists grupo_id uuid
  references public.grupos_usuarios(id) on delete set null;
alter table public.profiles add column if not exists nivel_acesso int not null default 2;
alter table public.profiles add column if not exists acesso_ate date;         -- null = sem prazo
alter table public.profiles add column if not exists ativo boolean not null default true;
alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists observacoes text;
create index if not exists idx_profiles_cart on public.profiles(cartorio_id, ativo);

-- O acesso do usuário logado está vigente?
create or replace function public.acesso_vigente()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select p.ativo and (p.acesso_ate is null or p.acesso_ate >= current_date)
       from public.profiles p where p.id = auth.uid()),
    false);
$$;

-- Nível de acesso do usuário logado
create or replace function public.meu_nivel()
returns int language sql stable security definer set search_path = public as $$
  select coalesce((select nivel_acesso from public.profiles where id = auth.uid()), 0);
$$;

-- ---------------------------------------------------------------------------
-- 4) is_equipe passa a exigir acesso VIGENTE
-- Assim, desativar um usuário ou vencer a data limite corta o acesso em todas
-- as tabelas de uma vez — sem precisar mexer em cada política.
-- ---------------------------------------------------------------------------
create or replace function public.is_equipe(p_cartorio uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_cartorio is not null
     and p_cartorio = public.current_cartorio_id()
     and public.acesso_vigente()
     and public.current_papel() in (
       'tabeliao', 'escrevente', 'tabeliao_substituto', 'financeiro',
       'tabeliao_oficial', 'conferente', 'admin_cartorio'
     );
$$;

-- Administrador do próprio cartório
create or replace function public.is_admin_cartorio(p_cartorio uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_cartorio is not null
     and p_cartorio = public.current_cartorio_id()
     and public.acesso_vigente()
     and (public.current_papel() = 'admin_cartorio'
          or public.current_papel() in ('tabeliao', 'tabeliao_oficial'));
$$;

-- ---------------------------------------------------------------------------
-- 5) RLS: administração de usuários do cartório
-- ---------------------------------------------------------------------------
alter table public.grupos_usuarios enable row level security;

drop policy if exists p_grupos_leitura on public.grupos_usuarios;
create policy p_grupos_leitura on public.grupos_usuarios for select
  using (public.is_equipe(cartorio_id));

drop policy if exists p_grupos_admin on public.grupos_usuarios;
create policy p_grupos_admin on public.grupos_usuarios for all
  using (public.is_admin_cartorio(cartorio_id) or public.is_admin_plataforma())
  with check (public.is_admin_cartorio(cartorio_id) or public.is_admin_plataforma());

-- Perfis: a equipe enxerga os colegas; só o admin do cartório altera
drop policy if exists p_profiles_equipe on public.profiles;
create policy p_profiles_equipe on public.profiles for select
  using (id = auth.uid() or public.is_equipe(cartorio_id) or public.is_admin_plataforma());

drop policy if exists p_profiles_admin on public.profiles;
create policy p_profiles_admin on public.profiles for update
  using (public.is_admin_cartorio(cartorio_id) or public.is_admin_plataforma())
  with check (public.is_admin_cartorio(cartorio_id) or public.is_admin_plataforma());

-- ---------------------------------------------------------------------------
-- 6) GRUPOS PADRÃO — semeados por cartório
-- ---------------------------------------------------------------------------
insert into public.grupos_usuarios (cartorio_id, nome, slug, papel_padrao, nivel_padrao, descricao)
select c.id, g.nome, g.slug, g.papel::papel_usuario, g.nivel, g.descricao
from public.cartorios c
cross join (values
  ('Escreventes',          'escreventes',     'escrevente',          2, 'Elaboram minutas, lançam valores e entregam o ato ao cliente.'),
  ('Analistas financeiros','financeiro',      'financeiro',          2, 'Conferem e validam emolumentos e impostos.'),
  ('Conferentes',          'conferentes',     'conferente',          2, 'Revisam documentos e dados antes da aprovação; não aprovam atos.'),
  ('Tabeliães substitutos','tab-substitutos', 'tabeliao_substituto', 3, 'Aprovam atos de baixa e média complexidade.'),
  ('Tabeliães oficiais',   'tab-oficiais',    'tabeliao_oficial',    4, 'Detêm a fé pública; aprovam qualquer complexidade e administram o cartório.')
) as g(nome, slug, papel, nivel, descricao)
where not exists (
  select 1 from public.grupos_usuarios x where x.cartorio_id = c.id and x.slug = g.slug
);

-- ---------------------------------------------------------------------------
-- 7) TAREFAS DESIGNADAS ENTRE USUÁRIOS
-- Complementa o fluxo de etapas: a etapa diz DE QUEM é a vez (competência);
-- a tarefa diz O QUE precisa ser feito, POR QUEM e ATÉ QUANDO.
-- ---------------------------------------------------------------------------
create table if not exists public.tarefas (
  id             uuid primary key default gen_random_uuid(),
  cartorio_id    uuid not null references public.cartorios(id) on delete cascade,
  solicitacao_id uuid references public.solicitacoes(id) on delete cascade,
  titulo         text not null,
  descricao      text,
  designada_por  uuid references auth.users(id) default auth.uid(),
  designada_para uuid not null references auth.users(id) on delete cascade,
  prazo          date,
  prioridade     text not null default 'normal',   -- baixa | normal | alta
  status         text not null default 'pendente', -- pendente | em_andamento | concluida | cancelada
  concluida_em   timestamptz,
  concluida_por  uuid references auth.users(id),
  resultado      text,
  origem_tarefa  uuid references public.tarefas(id) on delete set null,  -- encadeamento
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_tarefas_para on public.tarefas(designada_para, status, prazo);
create index if not exists idx_tarefas_solic on public.tarefas(solicitacao_id, created_at desc);
create index if not exists idx_tarefas_cart on public.tarefas(cartorio_id, status);

-- Histórico da tarefa
create table if not exists public.tarefa_eventos (
  id          uuid primary key default gen_random_uuid(),
  tarefa_id   uuid not null references public.tarefas(id) on delete cascade,
  ator        uuid references auth.users(id) default auth.uid(),
  ator_nome   text,
  acao        text not null,        -- criada | reatribuida | iniciada | concluida | cancelada | comentario
  de_usuario  uuid references auth.users(id),
  para_usuario uuid references auth.users(id),
  observacao  text,
  created_at  timestamptz not null default now()
);
create index if not exists idx_tar_ev on public.tarefa_eventos(tarefa_id, created_at desc);

alter table public.tarefas        enable row level security;
alter table public.tarefa_eventos enable row level security;

drop policy if exists p_tarefas_equipe on public.tarefas;
create policy p_tarefas_equipe on public.tarefas for all
  using (public.is_equipe(cartorio_id)) with check (public.is_equipe(cartorio_id));

drop policy if exists p_tar_ev on public.tarefa_eventos;
create policy p_tar_ev on public.tarefa_eventos for all
  using (exists (select 1 from public.tarefas t where t.id = tarefa_id and public.is_equipe(t.cartorio_id)))
  with check (exists (select 1 from public.tarefas t where t.id = tarefa_id and public.is_equipe(t.cartorio_id)));

-- ---------------------------------------------------------------------------
-- 8) AÇÕES DE TAREFA
-- ---------------------------------------------------------------------------
create or replace function public.criar_tarefa(
  p_para uuid, p_titulo text, p_descricao text default null,
  p_solicitacao uuid default null, p_prazo date default null,
  p_prioridade text default 'normal', p_origem uuid default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cart uuid; v_id uuid; v_nome text; v_dest_ok boolean;
begin
  select cartorio_id into v_cart from public.profiles where id = auth.uid();
  if v_cart is null or not public.is_equipe(v_cart) then
    return jsonb_build_object('ok', false, 'erro', 'Sem acesso vigente ao cartório.');
  end if;
  if coalesce(btrim(p_titulo), '') = '' then
    return jsonb_build_object('ok', false, 'erro', 'Descreva a tarefa.');
  end if;

  -- destinatário precisa ser da mesma casa e estar vigente
  select (p.cartorio_id = v_cart and p.ativo and (p.acesso_ate is null or p.acesso_ate >= current_date))
    into v_dest_ok from public.profiles p where p.id = p_para;
  if not coalesce(v_dest_ok, false) then
    return jsonb_build_object('ok', false, 'erro', 'Destinatário inválido ou sem acesso vigente.');
  end if;

  insert into public.tarefas (cartorio_id, solicitacao_id, titulo, descricao,
                              designada_para, prazo, prioridade, origem_tarefa)
  values (v_cart, p_solicitacao, btrim(p_titulo), p_descricao, p_para, p_prazo,
          coalesce(p_prioridade, 'normal'), p_origem)
  returning id into v_id;

  select nome into v_nome from public.profiles where id = auth.uid();
  insert into public.tarefa_eventos (tarefa_id, ator_nome, acao, para_usuario, observacao)
  values (v_id, v_nome, 'criada', p_para, p_descricao);

  return jsonb_build_object('ok', true, 'tarefa_id', v_id);
end $$;

-- Concluir e, opcionalmente, passar a bola ao próximo do fluxo
create or replace function public.concluir_tarefa(
  p_tarefa uuid, p_resultado text default null,
  p_proximo uuid default null, p_proximo_titulo text default null,
  p_proximo_prazo date default null, p_proximo_descricao text default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_t public.tarefas%rowtype; v_nome text; v_nova jsonb;
begin
  select * into v_t from public.tarefas where id = p_tarefa;
  if not found then return jsonb_build_object('ok', false, 'erro', 'Tarefa não encontrada.'); end if;
  if not public.is_equipe(v_t.cartorio_id) then
    return jsonb_build_object('ok', false, 'erro', 'Sem acesso.');
  end if;
  if v_t.status = 'concluida' then
    return jsonb_build_object('ok', false, 'erro', 'Esta tarefa já foi concluída.');
  end if;

  update public.tarefas
     set status = 'concluida', concluida_em = now(), concluida_por = auth.uid(),
         resultado = p_resultado, updated_at = now()
   where id = p_tarefa;

  select nome into v_nome from public.profiles where id = auth.uid();
  insert into public.tarefa_eventos (tarefa_id, ator_nome, acao, observacao)
  values (p_tarefa, v_nome, 'concluida', p_resultado);

  if p_proximo is not null then
    v_nova := public.criar_tarefa(
      p_proximo,
      coalesce(nullif(btrim(p_proximo_titulo), ''), v_t.titulo),
      p_proximo_descricao, v_t.solicitacao_id, p_proximo_prazo, v_t.prioridade, p_tarefa);
    return jsonb_build_object('ok', true, 'proxima', v_nova);
  end if;

  return jsonb_build_object('ok', true);
end $$;

-- Reatribuir sem concluir
create or replace function public.reatribuir_tarefa(
  p_tarefa uuid, p_para uuid, p_observacao text default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_t public.tarefas%rowtype; v_nome text;
begin
  select * into v_t from public.tarefas where id = p_tarefa;
  if not found or not public.is_equipe(v_t.cartorio_id) then
    return jsonb_build_object('ok', false, 'erro', 'Tarefa não encontrada ou sem acesso.');
  end if;
  update public.tarefas set designada_para = p_para, updated_at = now() where id = p_tarefa;
  select nome into v_nome from public.profiles where id = auth.uid();
  insert into public.tarefa_eventos (tarefa_id, ator_nome, acao, de_usuario, para_usuario, observacao)
  values (p_tarefa, v_nome, 'reatribuida', v_t.designada_para, p_para, p_observacao);
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------------
-- 9) CONSULTAS
-- ---------------------------------------------------------------------------
create or replace function public.minhas_tarefas(p_status text default 'abertas')
returns table (
  id uuid, titulo text, descricao text, prazo date, prioridade text, status text,
  solicitacao_id uuid, protocolo text, designada_por_nome text, created_at timestamptz,
  dias_para_prazo int
)
language sql stable security definer set search_path = public as $$
  select t.id, t.titulo, t.descricao, t.prazo, t.prioridade, t.status,
         t.solicitacao_id, s.protocolo,
         (select nome from public.profiles where id = t.designada_por),
         t.created_at,
         case when t.prazo is null then null else (t.prazo - current_date)::int end
  from public.tarefas t
  left join public.solicitacoes s on s.id = t.solicitacao_id
  where t.designada_para = auth.uid()
    and public.is_equipe(t.cartorio_id)
    and (p_status = 'todas'
         or (p_status = 'abertas' and t.status in ('pendente','em_andamento'))
         or t.status = p_status)
  order by
    case t.prioridade when 'alta' then 0 when 'normal' then 1 else 2 end,
    t.prazo nulls last, t.created_at;
$$;

-- Equipe do cartório, para escolher o destinatário
create or replace function public.equipe_do_cartorio()
returns table (id uuid, nome text, papel text, grupo text, nivel int, vigente boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.nome, p.papel::text, g.nome, p.nivel_acesso,
         (p.ativo and (p.acesso_ate is null or p.acesso_ate >= current_date))
  from public.profiles p
  left join public.grupos_usuarios g on g.id = p.grupo_id
  where p.cartorio_id = public.current_cartorio_id()
    and public.is_equipe(p.cartorio_id)
    and p.papel::text not in ('cliente', 'construtora', 'admin_plataforma')
  order by p.nome;
$$;

notify pgrst, 'reload schema';
-- ============================================================================

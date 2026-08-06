-- ============================================================================
-- iNotário · UMA fonte de verdade para "hoje"
--
-- PROBLEMA: o banco do Supabase roda em UTC. As funções usavam current_date,
-- enquanto a interface mostra a data no fuso civil do cartório. Entre 21h e
-- meia-noite (horário de Brasília) o banco já está no dia seguinte — e então:
--   · tarefa com prazo para hoje aparecia como ATRASADA;
--   · certidão que vence hoje aparecia como VENCIDA;
--   · acesso com data limite de hoje era cortado horas antes;
--   · o cockpit mostrava um dia e os cálculos usavam outro.
--
-- SOLUÇÃO: data_cartorio() passa a ser a única referência de dia civil, e a
-- interface busca essa data do servidor em vez do relógio do aparelho.
-- ============================================================================

create table if not exists public.config_sistema (
  chave text primary key,
  valor text not null,
  atualizado_em timestamptz not null default now()
);

insert into public.config_sistema (chave, valor)
values ('timezone', 'America/Sao_Paulo')
on conflict (chave) do nothing;

alter table public.config_sistema enable row level security;
drop policy if exists p_config_leitura on public.config_sistema;
create policy p_config_leitura on public.config_sistema for select using (true);
drop policy if exists p_config_admin on public.config_sistema;
create policy p_config_admin on public.config_sistema for all
  using (public.is_admin_plataforma()) with check (public.is_admin_plataforma());

create or replace function public.tz_cartorio()
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select valor from public.config_sistema where chave = 'timezone'), 'America/Sao_Paulo');
$$;

-- Dia civil do cartório (substitui current_date em TODAS as regras de negócio)
create or replace function public.data_cartorio()
returns date language sql stable security definer set search_path = public as $$
  select (now() at time zone public.tz_cartorio())::date;
$$;

-- Instante atual, para exibição
create or replace function public.agora_cartorio()
returns timestamptz language sql stable as $$ select now(); $$;

-- ---------------------------------------------------------------------------
-- Reescrita das funções que comparavam datas em UTC
-- ---------------------------------------------------------------------------

-- Vigência de certidões e procurações
create or replace function public.vencimentos_solicitacao(
  p_solicitacao uuid, p_janela_dias int default 10
)
returns table (
  origem text, descricao text, validade date, dias_restantes int, situacao text
)
language sql stable security definer set search_path = public as $$
  with hoje as (select public.data_cartorio() as d), base as (
    select 'documento'::text as origem,
           coalesce(d.nome_arquivo, d.tipo) as descricao, d.validade
    from public.documentos d
    where d.solicitacao_id = p_solicitacao and d.validade is not null
    union all
    select 'procuracao'::text,
           'Procuração de ' || r.nome || ' (' || c.razao_social || ')', r.procuracao_validade
    from public.solicitacoes s
    join public.empreendimentos e on e.id = s.empreendimento_id
    join public.construtoras c on c.id = e.construtora_id
    join public.construtora_representantes r on r.construtora_id = c.id and r.ativo
    where s.id = p_solicitacao and r.procuracao_validade is not null
    union all
    select 'certidao_construtora'::text,
           cc.tipo || coalesce(' nº ' || cc.numero, '') || ' (' || c.razao_social || ')', cc.validade
    from public.solicitacoes s
    join public.empreendimentos e on e.id = s.empreendimento_id
    join public.construtoras c on c.id = e.construtora_id
    join public.construtora_certidoes cc on cc.construtora_id = c.id
    where s.id = p_solicitacao and cc.validade is not null
  )
  select b.origem, b.descricao, b.validade,
         (b.validade - h.d)::int,
         case when b.validade < h.d then 'vencido'
              when b.validade - h.d <= greatest(coalesce(p_janela_dias,10), 0) then 'vence_em_breve'
              else 'vigente' end
  from base b cross join hoje h
  order by b.validade;
$$;

-- Acesso vigente
create or replace function public.acesso_vigente()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select p.ativo and (p.acesso_ate is null or p.acesso_ate >= public.data_cartorio())
       from public.profiles p where p.id = auth.uid()),
    false);
$$;

-- Tarefas: prazo calculado no dia civil do cartório
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
         case when t.prazo is null then null else (t.prazo - public.data_cartorio())::int end
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

-- Equipe do cartório
create or replace function public.equipe_do_cartorio()
returns table (id uuid, nome text, papel text, grupo text, nivel int, vigente boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.nome, p.papel::text, g.nome, p.nivel_acesso,
         (p.ativo and (p.acesso_ate is null or p.acesso_ate >= public.data_cartorio()))
  from public.profiles p
  left join public.grupos_usuarios g on g.id = p.grupo_id
  where p.cartorio_id = public.current_cartorio_id()
    and public.is_equipe(p.cartorio_id)
    and p.papel::text not in ('cliente', 'construtora', 'admin_plataforma')
  order by p.nome;
$$;

-- Criação de tarefa: validade do destinatário
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

  select (p.cartorio_id = v_cart and p.ativo
          and (p.acesso_ate is null or p.acesso_ate >= public.data_cartorio()))
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

-- ---------------------------------------------------------------------------
-- Quem decidiu a validação da construtora (item: identificar para conversa)
-- Preenche o nome do autor quando não vier informado.
-- ---------------------------------------------------------------------------
create or replace function public.decidir_validacao_construtora(
  p_solicitacao uuid, p_decisao text, p_observacoes text default null, p_autor_nome text default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_rodada int; v_nome text; v_email text;
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

  select cu.nome, cu.email into v_nome, v_email
  from public.construtora_usuarios cu where cu.user_id = auth.uid() and cu.ativo limit 1;

  select coalesce(max(rodada), 1) into v_rodada
  from public.validacoes_construtora where solicitacao_id = p_solicitacao;

  update public.solicitacoes
     set validacao_construtora = p_decisao, validacao_decidida_em = now()
   where id = p_solicitacao;

  insert into public.validacoes_construtora
    (solicitacao_id, rodada, acao, observacoes, autor_nome)
  values (p_solicitacao, v_rodada, p_decisao, p_observacoes,
          coalesce(nullif(btrim(p_autor_nome), ''), v_nome, v_email, 'jurídico da construtora'));

  return jsonb_build_object('ok', true, 'decisao', p_decisao, 'rodada', v_rodada,
                            'autor', coalesce(v_nome, v_email));
end $$;

-- Painel interno passa a mostrar QUEM decidiu por último
create or replace function public.painel_da_construtora(p_construtora uuid)
returns table (
  solicitacao_id uuid, protocolo text, empreendimento text, unidade text,
  comprador text, etapa text, validacao text, minuta_versao int,
  enviada_em timestamptz, decidida_em timestamptz, decidida_por text,
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
         (select v.autor_nome from public.validacoes_construtora v
           where v.solicitacao_id = s.id and v.acao in ('aprovada','ressalvas','reprovada')
           order by v.created_at desc limit 1),
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

-- Painel interno do cartório: acrescenta quem decidiu por último em cada empreendimento
create or replace function public.decisores_construtora(p_cartorio uuid, p_construtora uuid default null)
returns table (
  solicitacao_id uuid, protocolo text, empreendimento text, unidade text,
  validacao text, decidida_em timestamptz, decidida_por text, observacoes text
)
language sql stable security definer set search_path = public as $$
  select s.id, s.protocolo, e.nome, s.unidade,
         s.validacao_construtora, s.validacao_decidida_em,
         v.autor_nome, v.observacoes
  from public.solicitacoes s
  join public.empreendimentos e on e.id = s.empreendimento_id
  join public.construtoras c on c.id = e.construtora_id
  left join lateral (
    select vv.autor_nome, vv.observacoes from public.validacoes_construtora vv
    where vv.solicitacao_id = s.id and vv.acao in ('aprovada','ressalvas','reprovada')
    order by vv.created_at desc limit 1
  ) v on true
  where s.cartorio_id = p_cartorio and public.is_equipe(p_cartorio)
    and s.validacao_construtora <> 'nao_aplicavel'
    and (p_construtora is null or c.id = p_construtora)
  order by s.validacao_decidida_em desc nulls last;
$$;

notify pgrst, 'reload schema';

-- ============================================================================
-- iNotário · Agenda de assinaturas
-- Pré-requisitos: construtora_portal.sql (assinatura_em, validacao_construtora)
-- ============================================================================

create or replace function public.agenda_assinaturas(
  p_cartorio uuid, p_de date default null, p_ate date default null
)
returns table (
  solicitacao_id uuid, protocolo text, tipo_ato text,
  quando timestamptz, local text, situacao text,
  empreendimento text, unidade text, construtora text,
  partes text, contato_nome text, contato_whatsapp text,
  minuta_id uuid, minuta_versao int, minuta_aprovada boolean,
  validacao text, etapa text
)
language sql stable security definer set search_path = public as $$
  select s.id, s.protocolo, ta.nome,
         s.assinatura_em, s.assinatura_local, s.assinatura_status,
         e.nome, s.unidade, c.razao_social,
         (select string_agg(p.papel || ': ' || p.nome, ' · ' order by p.ordem)
            from public.partes p where p.solicitacao_id = s.id),
         s.contato_nome, s.contato_whatsapp,
         m.id, m.versao,
         (s.empreendimento_id is null or s.validacao_construtora = 'aprovada'),
         s.validacao_construtora, s.etapa
  from public.solicitacoes s
  left join public.tipos_ato ta on ta.id = s.tipo_ato_id
  left join public.empreendimentos e on e.id = s.empreendimento_id
  left join public.construtoras c on c.id = e.construtora_id
  left join lateral (
    select mm.id, mm.versao from public.minutas mm
    where mm.solicitacao_id = s.id order by mm.versao desc limit 1
  ) m on true
  where s.cartorio_id = p_cartorio
    and public.is_equipe(p_cartorio)
    and s.assinatura_em is not null
    and s.status <> 'cancelada'
    and (p_de  is null or s.assinatura_em >= p_de::timestamptz)
    and (p_ate is null or s.assinatura_em <  (p_ate + 1)::timestamptz)
  order by s.assinatura_em;
$$;

-- Atos prontos para agendar (aprovados e ainda sem data)
create or replace function public.prontos_para_agendar(p_cartorio uuid)
returns table (
  solicitacao_id uuid, protocolo text, tipo_ato text,
  empreendimento text, unidade text, partes text, etapa text, aprovada_em timestamptz
)
language sql stable security definer set search_path = public as $$
  select s.id, s.protocolo, ta.nome, e.nome, s.unidade,
         (select string_agg(p.nome, ', ' order by p.ordem)
            from public.partes p where p.solicitacao_id = s.id),
         s.etapa, s.validacao_decidida_em
  from public.solicitacoes s
  left join public.tipos_ato ta on ta.id = s.tipo_ato_id
  left join public.empreendimentos e on e.id = s.empreendimento_id
  where s.cartorio_id = p_cartorio
    and public.is_equipe(p_cartorio)
    and s.assinatura_em is null
    and s.status <> 'cancelada'
    and s.etapa in ('aprovacao', 'finalizacao')
    and (s.empreendimento_id is null or s.validacao_construtora = 'aprovada')
  order by s.validacao_decidida_em nulls last, s.updated_at desc;
$$;

notify pgrst, 'reload schema';

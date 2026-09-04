-- ============================================================================
-- iNotário · 23ª migration — procuradores no ato e comprovante de endereço
--
-- Rodar DEPOIS de prontidao.sql. Idempotente.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) COMPROVANTE DE ENDEREÇO VINCULADO A UMA PARTE (item 4)
--
-- O comprovante é de uma pessoa, não do ato: dois compradores podem anexar
-- dois comprovantes diferentes. Sem o vínculo explícito, o sistema teria de
-- adivinhar de quem é o endereço — e adivinhar endereço em escritura é errar.
-- ----------------------------------------------------------------------------
alter table public.documentos add column if not exists parte_id uuid references public.partes(id) on delete set null;

comment on column public.documentos.parte_id is
  'Parte a que este documento se refere. Usado no comprovante de endereço e nos documentos pessoais.';

create index if not exists idx_documentos_parte on public.documentos(parte_id) where parte_id is not null;

-- ----------------------------------------------------------------------------
-- 2) PROCURADORES E SÓCIOS NO ATO (item 3)
--
-- Quando o ato é venda de construtora, quem assina pela vendedora precisa
-- aparecer NA TELA DO ATO — com os poderes que efetivamente tem e as
-- restrições que os limitam. Hoje isso vive no cadastro da construtora, a três
-- cliques de distância, e o escrevente lavra sem ver.
-- ----------------------------------------------------------------------------
create or replace function public.representantes_do_ato(p_solicitacao uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  with s as (
    select sol.id, sol.cartorio_id, e.construtora_id, c.razao_social, c.cnpj,
           c.contrato_social_lido
    from public.solicitacoes sol
    left join public.empreendimentos e on e.id = sol.empreendimento_id
    left join public.construtoras c on c.id = e.construtora_id
    where sol.id = p_solicitacao and public.is_equipe(sol.cartorio_id)
  )
  select jsonb_build_object(
    'construtora', (select razao_social from s),
    'cnpj', (select cnpj from s),
    'poderes_contrato_social', (select contrato_social_lido->'poderes' from s),
    'representantes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id,
        'nome', r.nome,
        'cpf', r.cpf,
        'cargo', r.cargo,
        'origem', r.origem,
        'forma', r.poderes_forma,
        'poderes', coalesce(
          case when r.procuracao_lida ? 'poderes' then r.procuracao_lida->'poderes' end,
          case when nullif(btrim(coalesce(r.procuracao_poderes,'')),'') is not null
               then to_jsonb(string_to_array(r.procuracao_poderes, ';')) end,
          '[]'::jsonb),
        'restricoes', coalesce(r.procuracao_lida->'restricoes', '[]'::jsonb),
        'pode_alienar', r.procuracao_lida->'pode_alienar_imoveis',
        'pode_garantia', r.procuracao_lida->'pode_dar_garantia',
        'pode_substabelecer', r.procuracao_lida->'pode_substabelecer',
        'limite_valor', r.procuracao_lida->>'limite_valor',
        'procuracao_validade', r.procuracao_validade,
        -- Vencida na data de hoje: o ato não pode ser assinado por ela.
        'procuracao_vencida', (r.procuracao_validade is not null and r.procuracao_validade < current_date),
        'tem_procuracao', (r.procuracao_path is not null),
        'lida_em', r.procuracao_lida_em)
        order by r.nome)
      from public.construtora_representantes r, s
      where r.construtora_id = s.construtora_id and r.ativo), '[]'::jsonb)
  )
  from s;
$$;

comment on function public.representantes_do_ato(uuid) is
  'Quem pode assinar pela construtora neste ato, com poderes, restrições e validade da procuração.';

-- ----------------------------------------------------------------------------
-- 3) A PRONTIDÃO PASSA A OLHAR OS PODERES
--
-- Procuração vencida de quem assina é impedimento, e o semáforo precisa dizer
-- isso antes de a minuta ir para leitura.
-- ----------------------------------------------------------------------------
create or replace function public.prontidao_poderes(p_solicitacao uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  with r as (select public.representantes_do_ato(p_solicitacao) as d)
  select coalesce(jsonb_agg(jsonb_build_object(
    'gravidade', 'impeditivo',
    'item', format('Procuração vencida — %s', x->>'nome'),
    'detalhe', format('Validade %s. Quem assina pela vendedora precisa de procuração vigente.',
                      to_char((x->>'procuracao_validade')::date, 'DD/MM/YYYY')))), '[]'::jsonb)
  from r, jsonb_array_elements(coalesce(r.d->'representantes', '[]'::jsonb)) x
  where coalesce((x->>'procuracao_vencida')::boolean, false);
$$;

notify pgrst, 'reload schema';

-- ============================================================================
-- iNotário · 21ª migration — cláusulas do contrato no painel definitivo
--
-- Rodar DEPOIS de painel_definitivo.sql. Idempotente.
--
-- A leitura do compromisso já extraía alienação fiduciária, rescisão,
-- arrependimento e afins em `clausulas_relevantes`. Isso parava no card de
-- resumo: não chegava ao painel definitivo nem à minuta.
--
-- Aqui elas passam a ser transcritas — e, o que importa mais, ligadas ao
-- ACERVO DE CLÁUSULAS do cartório. A IA identifica o tema; a redação vem do
-- texto que o cartório aprovou. Deixar a IA redigir cláusula de alienação
-- fiduciária por conta própria é exatamente o que o espelho do modelo existe
-- para impedir.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Cláusulas contratuais identificadas, com a decisão do escrevente
-- ----------------------------------------------------------------------------
alter table public.solicitacoes add column if not exists clausulas_contrato jsonb not null default '[]';

comment on column public.solicitacoes.clausulas_contrato is
  'Cláusulas relevantes lidas do contrato: [{tema, resumo, trecho, pertinente, clausula_id}]. '
  '`pertinente` é decisão do escrevente — nem tudo que está no compromisso vai para a escritura.';

-- ----------------------------------------------------------------------------
-- 2) De-para entre o tema lido e a cláusula do acervo
--
-- Preenchido por slug: o cartório cadastra a cláusula de alienação fiduciária
-- com slug 'alienacao-fiduciaria' e o vínculo acontece sozinho. Quando não
-- houver correspondência, a tela avisa em vez de inventar redação.
-- ----------------------------------------------------------------------------
create or replace function public.slug_do_tema(p_tema text)
returns text language sql immutable as $$
  select case
    when p_tema is null then null
    when p_tema ~* 'fiduci'                        then 'alienacao-fiduciaria'
    when p_tema ~* 'hipotec'                       then 'garantia-hipotecaria'
    when p_tema ~* 'rescis|resolu[çc][aã]o'        then 'rescisao'
    when p_tema ~* 'reten[çc]'                     then 'retencao'
    when p_tema ~* 'arrepend'                      then 'direito-de-arrependimento'
    when p_tema ~* 'arras|sinal'                   then 'arras'
    when p_tema ~* 'condi[çc][aã]o resolutiva'     then 'condicao-resolutiva'
    when p_tema ~* 'retrovenda'                    then 'retrovenda'
    when p_tema ~* 'revers[aã]o'                   then 'reversao'
    when p_tema ~* 'cess[aã]o'                     then 'cessao'
    when p_tema ~* 'multa'                         then 'multa'
    when p_tema ~* 'toler[aâ]ncia|atraso|entrega'  then 'tolerancia-de-entrega'
    when p_tema ~* 'corre[çc][aã]o|reajust'        then 'correcao-monetaria'
    else null
  end;
$$;

comment on function public.slug_do_tema(text) is
  'Tema lido do contrato → slug da cláusula no acervo. Cadastre a cláusula com este slug para o vínculo automático.';

-- ----------------------------------------------------------------------------
-- 3) Transcrever as cláusulas do contrato para o painel definitivo
--
-- Preserva a decisão já tomada: cláusula que o escrevente marcou (ou desmarcou)
-- não volta ao estado inicial só porque o documento foi relido.
-- ----------------------------------------------------------------------------
create or replace function public.aplicar_clausulas_contrato(p_solicitacao uuid, p_ator uuid default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_sol   record;
  v_con   jsonb;
  v_ante  jsonb;
  v_novas jsonb := '[]';
  r       jsonb;
  v_tema  text;
  v_slug  text;
  v_cid   uuid;
  v_pert  boolean;
begin
  select s.* into v_sol from public.solicitacoes s where s.id = p_solicitacao;
  if not found then return jsonb_build_object('erro','solicitação não encontrada'); end if;
  if not public.is_equipe(v_sol.cartorio_id) then return jsonb_build_object('erro','sem acesso'); end if;

  select d.extraido into v_con
  from public.documentos d
  where d.solicitacao_id = p_solicitacao and d.tipo in ('compromisso','contrato')
    and d.extraido is not null and d.vinculado
  order by (d.status = 'validado') desc, d.created_at desc limit 1;

  if v_con is null then
    return jsonb_build_object('erro','Nenhum contrato lido e vinculado a este ato.');
  end if;

  v_ante := coalesce(v_sol.clausulas_contrato, '[]'::jsonb);

  for r in select * from jsonb_array_elements(coalesce(v_con->'clausulas_relevantes','[]'::jsonb))
  loop
    -- Zerado no INÍCIO: SELECT INTO sem resultado preserva o valor anterior, e
    -- um CONTINUE pularia o reset no fim — a cláusula seguinte herdaria o
    -- vínculo desta e receberia a redação errada.
    v_cid := null; v_pert := null; v_slug := null;

    -- A extração antiga trazia string simples; a atual traz objeto.
    v_tema := coalesce(nullif(btrim(r->>'tema'), ''), nullif(btrim(r #>> '{}'), ''));
    continue when v_tema is null;

    v_slug := public.slug_do_tema(v_tema);

    select c.id into v_cid
    from public.clausulas_especiais c
    where c.cartorio_id = v_sol.cartorio_id and c.ativo
      and (c.slug = v_slug or (v_slug is null and c.nome ilike '%' || v_tema || '%'))
    limit 1;

    -- Decisão anterior do escrevente prevalece sobre a releitura.
    select (a->>'pertinente')::boolean into v_pert
    from jsonb_array_elements(v_ante) a
    where lower(a->>'tema') = lower(v_tema) limit 1;

    v_novas := v_novas || jsonb_build_object(
      'tema',        v_tema,
      'resumo',      r->>'resumo',
      'trecho',      r->>'trecho',
      'slug',        v_slug,
      'clausula_id', v_cid,
      'pertinente',  coalesce(v_pert, false));
  end loop;

  update public.solicitacoes set clausulas_contrato = v_novas where id = p_solicitacao;

  perform public.registrar_custodia(
    p_solicitacao, null, 'dados_aplicados',
    jsonb_build_object('tipo','clausulas_contrato','total', jsonb_array_length(v_novas)),
    coalesce(p_ator, auth.uid()));

  return jsonb_build_object(
    'clausulas', v_novas,
    'total', jsonb_array_length(v_novas),
    'sem_acervo', (select count(*) from jsonb_array_elements(v_novas) x where x->>'clausula_id' is null));
end $$;

-- ----------------------------------------------------------------------------
-- 4) Levar as marcadas para as cláusulas do ato
--
-- Só as pertinentes, e só as que têm cláusula no acervo — a redação vem de lá.
-- ----------------------------------------------------------------------------
create or replace function public.promover_clausulas_contrato(p_solicitacao uuid, p_ator uuid default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_sol   record;
  r       jsonb;
  v_cl    record;
  v_ord   int;
  v_add   int := 0;
begin
  select s.* into v_sol from public.solicitacoes s where s.id = p_solicitacao;
  if not found or not public.is_equipe(v_sol.cartorio_id) then
    return jsonb_build_object('erro','sem acesso');
  end if;

  select coalesce(max(ordem), -1) + 1 into v_ord
  from public.solicitacao_clausulas where solicitacao_id = p_solicitacao;

  for r in select * from jsonb_array_elements(coalesce(v_sol.clausulas_contrato, '[]'::jsonb))
  loop
    continue when not coalesce((r->>'pertinente')::boolean, false);
    continue when r->>'clausula_id' is null;
    -- já está no ato?
    continue when exists (
      select 1 from public.solicitacao_clausulas sc
      where sc.solicitacao_id = p_solicitacao and sc.clausula_id = (r->>'clausula_id')::uuid);

    select * into v_cl from public.clausulas_especiais where id = (r->>'clausula_id')::uuid;
    continue when not found;

    insert into public.solicitacao_clausulas (solicitacao_id, clausula_id, nome, texto, ordem)
    values (p_solicitacao, v_cl.id, v_cl.nome, v_cl.texto, v_ord);
    v_ord := v_ord + 1;
    v_add := v_add + 1;
  end loop;

  if v_add > 0 then
    perform public.registrar_custodia(
      p_solicitacao, null, 'dados_aplicados',
      jsonb_build_object('tipo','clausulas_promovidas','total', v_add),
      coalesce(p_ator, auth.uid()));
  end if;

  return jsonb_build_object('inseridas', v_add);
end $$;

-- ----------------------------------------------------------------------------
-- 5) O painel definitivo passa a expor as cláusulas do contrato
-- ----------------------------------------------------------------------------
create or replace function public.painel_definitivo(p_solicitacao uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'protocolo', s.protocolo,
    'tipo_ato', ta.nome,
    'unidade', s.unidade,
    'dados', coalesce(s.dados, '{}'::jsonb),
    'onus', coalesce(s.onus, '[]'::jsonb),
    'certidoes', coalesce(s.certidoes, '[]'::jsonb),
    'clausulas_contrato', coalesce((
      select jsonb_agg(c) from jsonb_array_elements(coalesce(s.clausulas_contrato,'[]'::jsonb)) c
      where coalesce((c->>'pertinente')::boolean, false)), '[]'::jsonb),
    'outras_informacoes', case when s.incluir_outras_informacoes then s.outras_informacoes end,
    'aplicado_em', s.dados_aplicados_em,
    'partes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'papel', p.papel, 'nome', p.nome, 'cpf_cnpj', p.cpf_cnpj, 'dados', p.dados)
        order by p.ordem, p.created_at)
      from public.partes p where p.solicitacao_id = s.id), '[]'::jsonb)
  )
  from public.solicitacoes s
  left join public.tipos_ato ta on ta.id = s.tipo_ato_id
  where s.id = p_solicitacao and public.is_equipe(s.cartorio_id);
$$;

notify pgrst, 'reload schema';

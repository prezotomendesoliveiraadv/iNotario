-- ============================================================================
-- iNotário · 22ª migration — semáforo de prontidão do ato
--                            + fila do dia por vencimento
--
-- Rodar DEPOIS de clausulas_contrato.sql. Idempotente.
--
-- A regra de prontidão mora AQUI, não no front. A mesma função responde ao
-- semáforo da tela do ato e à ordenação da fila do cockpit — se a regra
-- existisse nos dois lugares, a fila diria "urgente" e a tela do ato diria
-- "pronto", e ninguém saberia qual acreditar.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) PRONTIDÃO DE UM ATO
--
-- Devolve o que impede assinar, cada item com gravidade e prazo.
--   impeditivo → não pode ser assinado
--   atencao    → pode, com risco conhecido
--   ok         → nada a apontar
-- ----------------------------------------------------------------------------
create or replace function public.prontidao_ato(p_solicitacao uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_sol     record;
  v_itens   jsonb := '[]';
  v_minuta  record;
  v_mat     record;
  v_dias    int;
  v_pend    int;
  v_cert    jsonb;
  v_reg     record;
  v_venc    int := null;      -- menor prazo em dias entre tudo que vence
begin
  select s.* into v_sol from public.solicitacoes s where s.id = p_solicitacao;
  if not found then return jsonb_build_object('erro','solicitação não encontrada'); end if;
  if not public.is_equipe(v_sol.cartorio_id) then return jsonb_build_object('erro','sem acesso'); end if;

  -- ---------- matrícula: 30 dias ----------
  select d.emitida_em, d.nome_arquivo into v_mat
  from public.documentos d
  where d.solicitacao_id = p_solicitacao and d.tipo = 'matricula' and d.vinculado
  order by (d.status = 'validado') desc, d.created_at desc limit 1;

  if v_mat.emitida_em is null then
    v_itens := v_itens || jsonb_build_object(
      'gravidade', case when v_mat is null then 'impeditivo' else 'atencao' end,
      'item', 'Matrícula',
      'detalhe', case when v_mat is null
                      then 'Nenhuma matrícula vinculada ao ato.'
                      else 'Sem data de expedição legível — o prazo de 30 dias não está sendo controlado.' end);
  else
    v_dias := (v_mat.emitida_em + 30) - current_date;
    v_venc := least(coalesce(v_venc, v_dias), v_dias);
    if v_dias < 0 then
      v_itens := v_itens || jsonb_build_object('gravidade','impeditivo','item','Matrícula vencida',
        'detalhe', format('Expedida em %s; venceu há %s dia(s).', to_char(v_mat.emitida_em,'DD/MM/YYYY'), abs(v_dias)),
        'dias', v_dias);
    elsif v_dias <= 7 then
      v_itens := v_itens || jsonb_build_object('gravidade','atencao','item','Matrícula vence em breve',
        'detalhe', format('Restam %s dia(s) dos 30.', v_dias), 'dias', v_dias);
    end if;
  end if;

  -- ---------- certidões ----------
  if coalesce(jsonb_array_length(v_sol.certidoes), 0) = 0 then
    v_itens := v_itens || jsonb_build_object('gravidade','atencao','item','Certidões',
      'detalhe','Nenhuma certidão transcrita para o painel definitivo.');
  else
    for v_reg in select value from jsonb_array_elements(v_sol.certidoes) loop
      v_cert := v_reg.value;
      if (v_cert->>'validade') is not null and (v_cert->>'validade') ~ '^\d{4}-\d{2}-\d{2}$' then
        v_dias := (v_cert->>'validade')::date - current_date;
        v_venc := least(coalesce(v_venc, v_dias), v_dias);
        if v_dias < 0 then
          v_itens := v_itens || jsonb_build_object('gravidade','impeditivo',
            'item', format('%s vencida', coalesce(v_cert->>'tipo','Certidão')),
            'detalhe', format('Venceu há %s dia(s).', abs(v_dias)), 'dias', v_dias);
        elsif v_dias <= 15 then
          v_itens := v_itens || jsonb_build_object('gravidade','atencao',
            'item', format('%s vence em breve', coalesce(v_cert->>'tipo','Certidão')),
            'detalhe', format('Restam %s dia(s).', v_dias), 'dias', v_dias);
        end if;
      end if;
      -- teor positivo é impedimento de fato, não formalidade
      if lower(coalesce(v_cert->>'teor','')) = 'positiva' then
        v_itens := v_itens || jsonb_build_object('gravidade','impeditivo',
          'item', format('%s POSITIVA', coalesce(v_cert->>'tipo','Certidão')),
          'detalhe','Certidão positiva sem efeito de negativa. Verifique antes de lavrar.');
      elsif coalesce(v_cert->>'teor','indefinido') = 'indefinido' then
        v_itens := v_itens || jsonb_build_object('gravidade','atencao',
          'item', format('%s sem teor', coalesce(v_cert->>'tipo','Certidão')),
          'detalhe','Não foi possível ler se é negativa ou positiva — e o teor entra na minuta.');
      end if;
    end loop;
  end if;

  -- ---------- dados aplicados ----------
  if v_sol.dados_aplicados_em is null then
    v_itens := v_itens || jsonb_build_object('gravidade','atencao','item','Dados não aplicados',
      'detalhe','O painel definitivo ainda não recebeu os dados dos documentos.');
  end if;

  -- ---------- minuta ----------
  select m.* into v_minuta from public.minutas m
  where m.solicitacao_id = p_solicitacao order by m.versao desc limit 1;

  if v_minuta is null then
    v_itens := v_itens || jsonb_build_object('gravidade','atencao','item','Sem minuta',
      'detalhe','Nenhuma versão gerada.');
  else
    -- Campos do modelo não encontrados continuam no texto como [[**campo**]].
    -- Assinar com isso é levar um documento com lacuna para a leitura.
    select count(*) into v_pend
    from regexp_matches(coalesce(v_minuta.conteudo, ''), '\[\[\*\*.*?\*\*\]\]', 'g');
    if v_pend > 0 then
      v_itens := v_itens || jsonb_build_object('gravidade','impeditivo','item','Campos em branco na minuta',
        'detalhe', format('%s campo(s) marcado(s) como [[**...**]] na versão %s.', v_pend, v_minuta.versao));
    end if;
  end if;

  -- ---------- poderes de quem assina pela construtora ----------
  -- Definida na 23ª migration; a chamada é tolerante para que a 22ª continue
  -- funcionando sozinha em bancos que ainda não aplicaram a seguinte.
  begin
    v_itens := v_itens || public.prontidao_poderes(p_solicitacao);
  exception when undefined_function then null;
  end;

  -- ---------- ônus ----------
  if coalesce(jsonb_array_length(v_sol.onus), 0) > 0 then
    v_itens := v_itens || jsonb_build_object('gravidade','atencao','item','Ônus na matrícula',
      'detalhe', format('%s ônus/gravame(s) transcrito(s). Confirme o tratamento no ato.',
                        jsonb_array_length(v_sol.onus)));
  end if;

  return jsonb_build_object(
    'situacao', case
      when exists (select 1 from jsonb_array_elements(v_itens) i where i->>'gravidade' = 'impeditivo') then 'impeditivo'
      when jsonb_array_length(v_itens) > 0 then 'atencao'
      else 'ok' end,
    'itens', v_itens,
    'impeditivos', (select count(*) from jsonb_array_elements(v_itens) i where i->>'gravidade' = 'impeditivo'),
    'atencoes', (select count(*) from jsonb_array_elements(v_itens) i where i->>'gravidade' = 'atencao'),
    'dias_para_vencer', v_venc);
end $$;

comment on function public.prontidao_ato(uuid) is
  'Semáforo do ato: o que impede assinar, com gravidade e prazo. Mesma regra usada pela fila do cockpit.';

-- ----------------------------------------------------------------------------
-- 2) FILA DO DIA
--
-- Devolve os atos em curso já com prontidão, prazo e o agrupamento por
-- construtora/empreendimento. A ordenação fica com o front: é escolha do
-- escrevente, não regra de negócio.
-- ----------------------------------------------------------------------------
create or replace function public.fila_do_dia(p_cartorio uuid)
returns table (
  id uuid, protocolo text, titulo text, etapa text, responsavel_papel text,
  complexidade text, exigencia_atual text, tipo_nome text,
  construtora text, empreendimento text, unidade text,
  created_at timestamptz, updated_at timestamptz,
  situacao text, impeditivos int, atencoes int, dias_para_vencer int
)
language sql stable security definer set search_path = public as $$
  select s.id, s.protocolo, s.titulo, s.etapa, s.responsavel_papel,
         s.complexidade, s.exigencia_atual, ta.nome,
         c.razao_social, e.nome, s.unidade,
         s.created_at, s.updated_at,
         p->>'situacao',
         coalesce((p->>'impeditivos')::int, 0),
         coalesce((p->>'atencoes')::int, 0),
         (p->>'dias_para_vencer')::int
  from public.solicitacoes s
  left join public.tipos_ato ta on ta.id = s.tipo_ato_id
  left join public.empreendimentos e on e.id = s.empreendimento_id
  left join public.construtoras c on c.id = e.construtora_id
  cross join lateral public.prontidao_ato(s.id) as p
  where s.cartorio_id = p_cartorio
    and public.is_equipe(s.cartorio_id)
    and s.etapa <> 'concluida'
    and s.status <> 'cancelada';
$$;

comment on function public.fila_do_dia(uuid) is
  'Atos em curso com prontidão, prazo e agrupamento. A ordenação é escolha do escrevente, no front.';

notify pgrst, 'reload schema';

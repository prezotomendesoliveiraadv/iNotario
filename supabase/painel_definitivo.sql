-- ============================================================================
-- iNotário · 20ª migration — painel definitivo do ato
--
-- Rodar DEPOIS de painel_consolidado.sql. Idempotente.
--
-- O painel da 19ª CONSOLIDA e MOSTRA o que os documentos dizem. Ele é leitura.
-- Esta migration cria o passo seguinte: APLICAR essa leitura aos dados
-- definitivos do ato (`solicitacoes.dados` e `partes`), que são a base da
-- minuta. A separação é intencional — a IA propõe, o escrevente aplica, e o
-- que vale na escritura é sempre o que foi aplicado.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Campos definitivos que faltavam
-- ----------------------------------------------------------------------------
-- Ônus e gravames transcritos da matrícula, já na forma que a minuta usa.
alter table public.solicitacoes add column if not exists onus jsonb not null default '[]';

-- Certidões do ato com teor, número, emissão e vigência.
alter table public.solicitacoes add column if not exists certidoes jsonb not null default '[]';

-- Texto livre do escrevente + chave que decide se entra na minuta.
alter table public.solicitacoes add column if not exists outras_informacoes text;
alter table public.solicitacoes add column if not exists incluir_outras_informacoes boolean not null default false;

-- Quando o consolidado foi aplicado pela última vez, e por quem.
alter table public.solicitacoes add column if not exists dados_aplicados_em timestamptz;
alter table public.solicitacoes add column if not exists dados_aplicados_por uuid references public.profiles(id);

comment on column public.solicitacoes.onus is
  'Ônus e gravames da matrícula: [{tipo, detalhe, credor, valor}]. Transcritos ao aplicar o consolidado.';
comment on column public.solicitacoes.certidoes is
  'Certidões do ato: [{tipo, numero, teor, emitida_em, validade}]. teor = negativa | positiva | positiva com efeitos de negativa.';
comment on column public.solicitacoes.incluir_outras_informacoes is
  'Quando true, o texto de outras_informacoes entra na minuta.';

-- ----------------------------------------------------------------------------
-- 2) APLICAR O CONSOLIDADO AOS DADOS DEFINITIVOS
--
-- Só mexe no que está vazio, a menos que p_sobrescrever seja true. O
-- escrevente que já corrigiu um campo à mão não deve vê-lo revertido por uma
-- releitura de documento.
-- ----------------------------------------------------------------------------
create or replace function public.aplicar_consolidado(
  p_solicitacao  uuid,
  p_sobrescrever boolean default false,
  p_ator         uuid default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_sol    record;
  v_cons   jsonb;
  v_campos jsonb;
  v_dados  jsonb;
  v_onus   jsonb := '[]';
  v_certs  jsonb := '[]';
  v_mat    jsonb;
  v_aplic  jsonb := '[]';
  r        record;
  v_chave  text;
  v_valor  text;
begin
  select s.* into v_sol from public.solicitacoes s where s.id = p_solicitacao;
  if not found then return jsonb_build_object('erro','solicitação não encontrada'); end if;
  if not public.is_equipe(v_sol.cartorio_id) then return jsonb_build_object('erro','sem acesso'); end if;

  v_cons   := public.consolidar_ato(p_solicitacao);
  v_campos := coalesce(v_cons->'campos', '{}'::jsonb);
  v_dados  := coalesce(v_sol.dados, '{}'::jsonb);

  -- ---------- campos do ato ----------
  -- Mapeia o nome canônico do consolidado para a chave usada em `dados`.
  for r in
    select * from (values
      ('imovel_matricula','matricula'), ('imovel_cartorio_ri','cartorio_ri'),
      ('imovel_descricao','descricao_objeto'), ('imovel_endereco','endereco'),
      ('imovel_area','area'), ('empreendimento','empreendimento'),
      ('unidade','unidade'), ('torre_bloco','torre_bloco'), ('vaga_garagem','vaga_garagem'),
      ('valor_total','valor'), ('forma_pagamento','forma_pagamento'),
      ('sinal','sinal'), ('saldo','saldo'),
      ('instituicao_financeira','instituicao_financeira'),
      ('data_contrato','data_contrato'), ('prazo_entrega','prazo_entrega')
    ) as m(canonico, chave)
  loop
    v_valor := v_campos->r.canonico->>'valor';
    if v_valor is null or btrim(v_valor) = '' then continue; end if;
    v_chave := r.chave;
    if p_sobrescrever or coalesce(btrim(v_dados->>v_chave), '') = '' then
      if coalesce(v_dados->>v_chave,'') is distinct from v_valor then
        v_aplic := v_aplic || jsonb_build_object(
          'campo', v_chave, 'de', v_dados->>v_chave, 'para', v_valor,
          'fonte', v_campos->r.canonico->>'fonte');
      end if;
      v_dados := jsonb_set(v_dados, array[v_chave], to_jsonb(v_valor), true);
    end if;
  end loop;

  -- ---------- ônus e gravames da matrícula ----------
  select d.extraido into v_mat
  from public.documentos d
  where d.solicitacao_id = p_solicitacao and d.tipo = 'matricula'
    and d.extraido is not null and d.vinculado
  order by (d.status = 'validado') desc, d.created_at desc limit 1;

  if v_mat is not null then
    select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
             'tipo',    o->>'tipo',
             'detalhe', o->>'detalhe',
             'credor',  o->>'credor',
             'valor',   o->>'valor'))), '[]'::jsonb)
      into v_onus
    from jsonb_array_elements(coalesce(v_mat->'onus','[]'::jsonb)) o
    where coalesce(btrim(o->>'tipo'), '') <> '' or coalesce(btrim(o->>'detalhe'), '') <> '';

    if coalesce((v_mat->>'ha_indisponibilidade')::boolean, false) then
      v_onus := v_onus || jsonb_build_object(
        'tipo', 'Indisponibilidade',
        'detalhe', 'Averbação de indisponibilidade de bens constante da matrícula.');
    end if;
  end if;

  -- ---------- certidões vinculadas ----------
  select coalesce(jsonb_agg(jsonb_build_object(
           'tipo',       c->>'tipo',
           'numero',     c->>'numero',
           'teor',       coalesce(nullif(c->>'resultado',''), 'indefinido'),
           'emitida_em', c->>'emitida_em',
           'validade',   c->>'validade',
           'origem',     c->>'origem') order by c->>'tipo'), '[]'::jsonb)
    into v_certs
  from jsonb_array_elements(coalesce(v_cons->'certidoes','[]'::jsonb)) c;

  update public.solicitacoes
     set dados = v_dados,
         onus  = case when p_sobrescrever or onus = '[]'::jsonb then v_onus else onus end,
         certidoes = v_certs,
         dados_aplicados_em = now(),
         dados_aplicados_por = coalesce(p_ator, auth.uid())
   where id = p_solicitacao;

  perform public.registrar_custodia(
    p_solicitacao, null, 'dados_aplicados',
    jsonb_build_object('campos', v_aplic, 'onus', jsonb_array_length(v_onus),
                       'certidoes', jsonb_array_length(v_certs), 'sobrescreveu', p_sobrescrever),
    coalesce(p_ator, auth.uid()));

  return jsonb_build_object(
    'aplicados', v_aplic,
    'onus', v_onus,
    'certidoes', v_certs,
    'total', jsonb_array_length(v_aplic));
end $$;

-- ----------------------------------------------------------------------------
-- 3) BASE DE CONHECIMENTO DA ARTEMIS (item 7)
--
-- O que o assistente enxerga passa a ser o PAINEL DEFINITIVO, não uma leitura
-- solta de documentos. Assim a conversa e a minuta partem do mesmo lugar.
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

-- ----------------------------------------------------------------------------
-- 4) VERSÕES DA MINUTA: descrição e origem do arquivo (itens 5 e 6)
-- ----------------------------------------------------------------------------
alter table public.minutas add column if not exists descricao text;
alter table public.minutas add column if not exists arquivo_path text;
alter table public.minutas add column if not exists arquivo_nome text;

comment on column public.minutas.descricao is
  'Rótulo curto do que esta versão contém — escrito por quem gerou ou subiu.';

-- ----------------------------------------------------------------------------
-- 5) PROCURAÇÕES DOS REPRESENTANTES LIDAS POR IA (item 8)
-- ----------------------------------------------------------------------------
alter table public.construtora_representantes add column if not exists procuracao_lida jsonb;
alter table public.construtora_representantes add column if not exists procuracao_lida_em timestamptz;

comment on column public.construtora_representantes.procuracao_lida is
  'Leitura por IA da procuração: {outorgante, outorgado, poderes[], restricoes[], substabelecimento, prazo, lavrada_em, validade}.';

-- ----------------------------------------------------------------------------
-- 6) POSIÇÃO DA CLÁUSULA ESPECIAL NA MINUTA (item 10)
-- ----------------------------------------------------------------------------
alter table public.solicitacao_clausulas add column if not exists inserir_apos int;

comment on column public.solicitacao_clausulas.inserir_apos is
  'Número da cláusula do modelo após a qual esta entra. Nulo = antes do fecho.';

notify pgrst, 'reload schema';

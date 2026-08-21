-- ============================================================================
-- iNotário · 19ª migration — painel consolidado de dados do ato
--
-- Rodar DEPOIS de custodia_autoria.sql. Idempotente.
--
-- A consolidação mora AQUI, no banco, e não em módulo TypeScript, por um
-- motivo prático: o painel da tela e o dicionário que preenche a minuta têm de
-- enxergar exatamente os mesmos valores. Se a regra de precedência existisse em
-- dois lugares, mais cedo ou mais tarde a tela mostraria um dado e a escritura
-- sairia com outro — e ninguém perceberia até a assinatura.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Vínculo do documento ao ato e prazo da matrícula
-- ----------------------------------------------------------------------------
-- Documento lido não entra no painel enquanto o escrevente não vincular: leitura
-- por IA é insumo, vínculo é decisão humana.
alter table public.documentos add column if not exists vinculado boolean not null default false;
alter table public.documentos add column if not exists emitida_em date;
alter table public.documentos add column if not exists validade_ate date;

comment on column public.documentos.vinculado is
  'true quando o escrevente aplicou este documento ao ato. Só documento vinculado alimenta o painel.';

-- Documento já validado é, por definição, aplicado ao ato.
update public.documentos set vinculado = true where status = 'validado' and not vinculado;

-- Preenche emissão/validade a partir do que a IA já extraiu.
update public.documentos
   set emitida_em = nullif(extraido->>'emitida_em','')::date
 where emitida_em is null and extraido ? 'emitida_em'
   and (extraido->>'emitida_em') ~ '^\d{4}-\d{2}-\d{2}$';

update public.documentos
   set validade_ate = nullif(extraido->>'validade','')::date
 where validade_ate is null and extraido ? 'validade'
   and (extraido->>'validade') ~ '^\d{4}-\d{2}-\d{2}$';

   set validade_ate = nullif(extraido->>'validade','')::date
 where validade_ate is null and extraido ? 'validade'
   and (extraido->>'validade') ~ '^\d{4}-\d{2}-\d{2}$';

-- Matrícula vale 30 dias contados da expedição (prazo de praxe registral;
-- ajuste aqui se a comarca praticar outro).
create or replace function public.validade_matricula(p_emitida date)
returns date language sql immutable as $$ select p_emitida + 30 $$;

-- ----------------------------------------------------------------------------
-- 2) Extração das certidões da construtora para o formato do painel
-- ----------------------------------------------------------------------------
alter table public.construtora_certidoes add column if not exists extraido jsonb;
alter table public.construtora_certidoes add column if not exists resultado text;
alter table public.construtora_certidoes add column if not exists lido_em timestamptz;

comment on column public.construtora_certidoes.resultado is
  'negativa | positiva | positiva com efeito de negativa | indefinido — como a IA leu a certidão.';

-- ----------------------------------------------------------------------------
-- 3) CONSOLIDAÇÃO
--
-- Precedência, decidida com o cartório:
--   identidade das partes  → documento pessoal (RG/CNH) VENCE o contrato
--   objeto (imóvel)        → matrícula VENCE o contrato
--   negócio (pagamento)    → só o contrato tem
--
-- Quando duas fontes discordam, o painel ADOTA a de maior precedência e
-- REGISTRA a divergência. Não trava: travar pararia o ato por diferença de
-- grafia, e quem decide é o escrevente — mas ele precisa ver o conflito.
-- ----------------------------------------------------------------------------
-- unaccent pode não estar instalada; esta versão cobre o português.
create or replace function public.unaccent_simples(p text)
returns text language sql immutable as $$
  select translate(coalesce(p,''),
    'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
    'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')
$$;

create or replace function public.norm_txt(p text)
returns text language sql immutable as $$
  select nullif(regexp_replace(lower(unaccent_simples(coalesce(p,''))), '[^a-z0-9]+', '', 'g'), '')
$$;

create or replace function public.consolidar_ato(p_solicitacao uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_sol      record;
  v_mat      jsonb;
  v_mat_doc  record;
  v_con      jsonb;
  v_campos   jsonb := '{}'::jsonb;
  v_diverg   jsonb := '[]'::jsonb;
  v_falta    jsonb := '[]'::jsonb;
  v_certs    jsonb := '[]'::jsonb;
  v_matinfo  jsonb := 'null'::jsonb;
  v_preench  int := 0;
  v_total    int := 0;
begin
  select s.*, ta.slug as tipo_slug into v_sol
  from public.solicitacoes s
  left join public.tipos_ato ta on ta.id = s.tipo_ato_id
  where s.id = p_solicitacao;
  if not found then return jsonb_build_object('erro','solicitação não encontrada'); end if;
  if not public.is_equipe(v_sol.cartorio_id) then return jsonb_build_object('erro','sem acesso'); end if;

  -- ---------- fontes ----------
  select d.extraido, d.emitida_em, d.id, d.nome_arquivo into v_mat_doc
  from public.documentos d
  where d.solicitacao_id = p_solicitacao and d.tipo = 'matricula'
    and d.extraido is not null and d.vinculado
  order by (d.status = 'validado') desc, d.created_at desc limit 1;
  v_mat := coalesce(v_mat_doc.extraido, '{}'::jsonb);

  select d.extraido into v_con
  from public.documentos d
  where d.solicitacao_id = p_solicitacao and d.tipo in ('compromisso','contrato')
    and d.extraido is not null and d.vinculado
  order by (d.status = 'validado') desc, d.created_at desc limit 1;
  v_con := coalesce(v_con, '{}'::jsonb);

  -- ---------- OBJETO: matrícula vence o contrato ----------
  with pares(campo, rotulo, v_mat, v_con) as (
    values
      ('imovel_matricula',   'Matrícula',            v_mat->>'imovel_matricula',   v_con->>'imovel_matricula'),
      ('imovel_cartorio_ri', 'Cartório de registro', v_mat->>'imovel_cartorio_ri', v_con->>'imovel_cartorio_ri'),
      ('imovel_descricao',   'Descrição do imóvel',  v_mat->>'imovel_descricao',   v_con->>'imovel_descricao'),
      ('imovel_endereco',    'Endereço do imóvel',   v_mat->>'imovel_endereco',    null),
      ('imovel_area',        'Área',                 v_mat->>'area',               null),
      ('empreendimento',     'Empreendimento',       null,                          v_con->>'empreendimento'),
      ('unidade',            'Unidade',              null,                          coalesce(v_sol.unidade, v_con->>'unidade')),
      ('torre_bloco',        'Torre / bloco',        null,                          v_con->>'torre_bloco'),
      ('vaga_garagem',       'Vaga',                 null,                          v_con->>'vaga_garagem')
  )
  select
    coalesce(jsonb_object_agg(campo, jsonb_build_object(
      'rotulo', rotulo,
      'valor',  coalesce(nullif(btrim(v_mat),''), nullif(btrim(v_con),'')),
      'fonte',  case when nullif(btrim(v_mat),'') is not null then 'matricula'
                     when nullif(btrim(v_con),'') is not null then 'contrato' end,
      'grupo',  'objeto'
    )) filter (where coalesce(nullif(btrim(v_mat),''), nullif(btrim(v_con),'')) is not null), '{}'::jsonb),
    coalesce(jsonb_agg(jsonb_build_object(
      'campo', campo, 'rotulo', rotulo,
      'adotado', btrim(v_mat), 'fonte_adotada', 'matricula',
      'conflito', btrim(v_con), 'fonte_conflito', 'contrato'
    )) filter (where nullif(btrim(v_mat),'') is not null and nullif(btrim(v_con),'') is not null
                 and public.norm_txt(v_mat) is distinct from public.norm_txt(v_con)), '[]'::jsonb),
    count(*) filter (where coalesce(nullif(btrim(v_mat),''), nullif(btrim(v_con),'')) is not null),
    count(*)
  into v_campos, v_diverg, v_preench, v_total
  from pares;

  -- ---------- NEGÓCIO: só o contrato ----------
  with pares(campo, rotulo, v) as (
    values
      ('valor_total',           'Valor total',           v_con->>'valor_total'),
      ('forma_pagamento',       'Forma de pagamento',    v_con->>'forma_pagamento'),
      ('sinal',                 'Sinal / entrada',       v_con->>'sinal'),
      ('saldo',                 'Saldo',                 v_con->>'saldo'),
      ('instituicao_financeira','Instituição financeira',v_con->>'instituicao_financeira'),
      ('data_contrato',         'Data do contrato',      v_con->>'data_contrato'),
      ('prazo_entrega',         'Prazo de entrega',      v_con->>'prazo_entrega')
  )
  select v_campos || coalesce(jsonb_object_agg(campo, jsonb_build_object(
           'rotulo', rotulo, 'valor', btrim(v), 'fonte', 'contrato', 'grupo', 'negocio'
         )) filter (where nullif(btrim(v),'') is not null), '{}'::jsonb),
         v_preench + count(*) filter (where nullif(btrim(v),'') is not null),
         v_total + count(*)
  into v_campos, v_preench, v_total
  from pares;

  -- ---------- IDENTIDADE: documento pessoal vence o contrato ----------
  -- O contrato entra como base; o RG/CNH vinculado sobrepõe e a diferença
  -- vira divergência registrada.
  with contratuais as (
    select 'comprador' as polo, jsonb_array_elements(coalesce(v_con->'compradores','[]'::jsonb)) as p
    union all
    select 'vendedor', jsonb_array_elements(coalesce(v_con->'vendedores','[]'::jsonb))
  ), pessoais as (
    select d.extraido as p
    from public.documentos d
    where d.solicitacao_id = p_solicitacao and d.tipo in ('rg','cnh')
      and d.extraido is not null and d.vinculado
  ), casadas as (
    select c.polo, c.p as contrato, pe.p as pessoal
    from contratuais c
    left join pessoais pe
      on public.norm_txt(pe.p->>'cpf') = public.norm_txt(c.p->>'cpf_cnpj')
      or public.norm_txt(pe.p->>'nome') = public.norm_txt(c.p->>'nome')
  )
  select
    v_campos || coalesce(jsonb_object_agg(
      polo || '_' || ord, jsonb_build_object(
        'rotulo', initcap(polo),
        'valor',  coalesce(nullif(btrim(pessoal->>'nome'),''), btrim(contrato->>'nome')),
        'fonte',  case when nullif(btrim(pessoal->>'nome'),'') is not null then 'documento_pessoal' else 'contrato' end,
        'grupo',  'partes',
        'detalhe', jsonb_strip_nulls(jsonb_build_object(
          'cpf',          coalesce(nullif(btrim(pessoal->>'cpf'),''), nullif(btrim(contrato->>'cpf_cnpj'),'')),
          'rg',           nullif(btrim(pessoal->>'rg'),''),
          'estado_civil', nullif(btrim(contrato->>'estado_civil'),''),
          'regime_bens',  nullif(btrim(contrato->>'regime_bens'),''),
          'profissao',    coalesce(nullif(btrim(pessoal->>'profissao'),''), nullif(btrim(contrato->>'profissao'),'')),
          'endereco',     coalesce(nullif(btrim(pessoal->>'endereco'),''), nullif(btrim(contrato->>'endereco'),''))
        ))
      )), '{}'::jsonb),
    v_diverg || coalesce(jsonb_agg(jsonb_build_object(
      'campo', polo || '_' || ord, 'rotulo', initcap(polo) || ' — nome',
      'adotado', btrim(pessoal->>'nome'), 'fonte_adotada', 'documento_pessoal',
      'conflito', btrim(contrato->>'nome'), 'fonte_conflito', 'contrato'
    )) filter (where nullif(btrim(pessoal->>'nome'),'') is not null
                 and nullif(btrim(contrato->>'nome'),'') is not null
                 and public.norm_txt(pessoal->>'nome') is distinct from public.norm_txt(contrato->>'nome')), '[]'::jsonb)
  into v_campos, v_diverg
  from (select *, row_number() over (partition by polo order by contrato->>'nome') as ord from casadas) x;

  -- ---------- MATRÍCULA: prazo de 30 dias ----------
  if v_mat_doc.id is not null then
    v_matinfo := jsonb_build_object(
      'arquivo', v_mat_doc.nome_arquivo,
      'emitida_em', v_mat_doc.emitida_em,
      'validade', case when v_mat_doc.emitida_em is not null then public.validade_matricula(v_mat_doc.emitida_em) end,
      'dias_restantes', case when v_mat_doc.emitida_em is not null
                             then (public.validade_matricula(v_mat_doc.emitida_em) - current_date) end,
      'situacao', case
        when v_mat_doc.emitida_em is null then 'sem_data'
        when public.validade_matricula(v_mat_doc.emitida_em) < current_date then 'vencida'
        when public.validade_matricula(v_mat_doc.emitida_em) - current_date <= 7 then 'vence_em_breve'
        else 'vigente' end
    );
  end if;

  -- ---------- CERTIDÕES: do ato e do empreendimento ----------
  with doc_cert as (
    select coalesce(nullif(d.extraido->>'certidao_tipo',''), 'certidão') as tipo,
           d.extraido->>'numero' as numero,
           d.emitida_em, d.validade_ate, d.extraido->>'resultado' as resultado,
           'ato'::text as origem, d.nome_arquivo as arquivo
    from public.documentos d
    where d.solicitacao_id = p_solicitacao and d.tipo = 'certidao' and d.vinculado
  ), emp_cert as (
    select cc.tipo, cc.numero, cc.emitida_em, cc.validade as validade_ate, cc.resultado,
           'empreendimento'::text, cc.nome_arquivo
    from public.construtora_certidoes cc
    join public.empreendimentos e on e.construtora_id = cc.construtora_id
    where e.id = v_sol.empreendimento_id
  ), todas as (select * from doc_cert union all select * from emp_cert)
  select coalesce(jsonb_agg(jsonb_build_object(
    'tipo', tipo, 'numero', numero, 'emitida_em', emitida_em, 'validade', validade_ate,
    'resultado', resultado, 'origem', origem, 'arquivo', arquivo,
    'dias_restantes', case when validade_ate is not null then validade_ate - current_date end,
    'situacao', case
      when validade_ate is null then 'sem_validade'
      when validade_ate < current_date then 'vencida'
      when validade_ate - current_date <= 15 then 'vence_em_breve'
      else 'vigente' end
  ) order by validade_ate nulls last), '[]'::jsonb)
  into v_certs from todas;

  -- ---------- O QUE FALTA ----------
  if v_con = '{}'::jsonb then
    v_falta := v_falta || jsonb_build_object('item','Contrato de compra e venda',
      'motivo','Nenhum contrato lido e vinculado — sem ele não há dados de pagamento nem das partes.');
  end if;
  if v_mat = '{}'::jsonb then
    v_falta := v_falta || jsonb_build_object('item','Matrícula do imóvel',
      'motivo','Sem matrícula vinculada, a descrição do objeto vem do contrato e não foi conferida no registro.');
  elsif v_mat_doc.emitida_em is null then
    v_falta := v_falta || jsonb_build_object('item','Data de expedição da matrícula',
      'motivo','Não foi possível ler a data — o prazo de 30 dias não pode ser controlado.');
  end if;
  if not exists (select 1 from public.documentos d
                 where d.solicitacao_id = p_solicitacao and d.tipo in ('rg','cnh') and d.vinculado) then
    v_falta := v_falta || jsonb_build_object('item','Documento de identificação das partes',
      'motivo','Sem RG/CNH vinculado, a qualificação vem do contrato e não foi conferida no documento oficial.');
  end if;
  if jsonb_array_length(v_certs) = 0 then
    v_falta := v_falta || jsonb_build_object('item','Certidões',
      'motivo','Nenhuma certidão vinculada ao ato nem cadastrada no empreendimento.');
  end if;
  if exists (select 1 from jsonb_array_elements(v_certs) c where c->>'situacao' = 'vencida') then
    v_falta := v_falta || jsonb_build_object('item','Certidão vencida',
      'motivo','Há certidão fora do prazo — providencie a atualizada antes de lavrar.');
  end if;
  if v_matinfo->>'situacao' = 'vencida' then
    v_falta := v_falta || jsonb_build_object('item','Matrícula vencida',
      'motivo','A certidão de matrícula passou dos 30 dias. Solicite uma nova ao Registro de Imóveis.');
  end if;

  return jsonb_build_object(
    'campos', v_campos,
    'divergencias', v_diverg,
    'certidoes', v_certs,
    'matricula', v_matinfo,
    'faltantes', v_falta,
    'completude', case when v_total > 0 then round(v_preench::numeric / v_total, 2) else 0 end
  );
end $$;

notify pgrst, 'reload schema';

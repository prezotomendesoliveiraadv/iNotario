-- ============================================================================
-- iNotário · 16ª migration — precedência do modelo da construtora
--                            + confronto contrato x matrícula
--
-- Rodar DEPOIS de documentos_recebidos.sql. Idempotente.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) PRECEDÊNCIA DO MODELO — correção de bug
--
-- A versão anterior encadeava três SELECTs com UNION ALL e fechava com
-- `limit 1`, na intenção de "pega o do empreendimento, senão o da construtora,
-- senão o do acervo".
--
-- Isso não funciona: UNION ALL não garante ordem alguma, e o LIMIT recai sobre
-- o resultado combinado. O planejador podia devolver o modelo genérico do
-- acervo mesmo havendo modelo do empreendimento cadastrado — silenciosamente,
-- e de forma não determinística entre execuções.
--
-- Agora a prioridade é uma coluna explícita e o ORDER BY a torna obrigatória.
-- ----------------------------------------------------------------------------
create or replace function public.modelo_para_solicitacao(p_solicitacao uuid)
returns table (fonte text, titulo text, texto text)
language sql stable security definer set search_path = public as $$
  with s as (
    select sol.id, sol.cartorio_id, sol.empreendimento_id, ta.slug as tipo_slug
    from public.solicitacoes sol
    join public.tipos_ato ta on ta.id = sol.tipo_ato_id
    where sol.id = p_solicitacao
  ), candidatos as (
    -- 1º: modelo do empreendimento (o mais específico que existe)
    select 1 as prioridade, 'empreendimento'::text as fonte, e.nome as titulo,
           coalesce(e.modelo_escritura, a.conteudo_texto) as texto
    from s join public.empreendimentos e on e.id = s.empreendimento_id
           left join public.acervo a on a.id = e.modelo_acervo_id
    where coalesce(e.modelo_escritura, a.conteudo_texto) is not null

    union all
    -- 2º: modelo da construtora
    select 2, 'construtora', c.razao_social,
           coalesce(c.modelo_escritura, a.conteudo_texto)
    from s join public.empreendimentos e on e.id = s.empreendimento_id
           join public.construtoras c on c.id = e.construtora_id
           left join public.acervo a on a.id = c.modelo_acervo_id
    where coalesce(c.modelo_escritura, a.conteudo_texto) is not null

    union all
    -- 3º: modelo padrão do acervo para o tipo de ato
    select 3, 'acervo', a.titulo, a.conteudo_texto
    from s join public.acervo a
      on a.cartorio_id = s.cartorio_id and a.categoria = 'modelo'
     and a.padrao and a.tipo_ato_slug is not distinct from s.tipo_slug
    where a.conteudo_texto is not null
  )
  select fonte, titulo, texto
  from candidatos
  where btrim(coalesce(texto, '')) <> ''
  order by prioridade
  limit 1;
$$;

comment on function public.modelo_para_solicitacao(uuid) is
  'Modelo aplicável ao ato. Precedência garantida por ORDER BY: empreendimento > construtora > acervo padrão.';

-- ----------------------------------------------------------------------------
-- 2) MINUTAS: registrar como o texto foi produzido
--
-- Espelho determinístico e redação por IA são coisas diferentes e precisam ser
-- distinguíveis depois — inclusive para auditoria: quem lê a minuta seis meses
-- depois tem que saber se aquele texto é o modelo da construtora reproduzido
-- ou uma redação gerada.
-- ----------------------------------------------------------------------------
alter table public.minutas add column if not exists origem text;
alter table public.minutas add column if not exists modelo_fonte text;
alter table public.minutas add column if not exists pendencias jsonb not null default '[]';

comment on column public.minutas.origem is
  'espelho_modelo | ia | edicao_manual — como o texto desta versão foi produzido.';
comment on column public.minutas.modelo_fonte is
  'empreendimento | construtora | acervo — de onde veio o modelo espelhado.';
comment on column public.minutas.pendencias is
  'Campos do modelo que não foram encontrados na base: [{rotulo, ocorrencias}].';

-- ----------------------------------------------------------------------------
-- 3) CONFRONTO CONTRATO x MATRÍCULA
--
-- O resultado fica no documento do contrato, não numa tabela nova: é um
-- atributo daquela leitura, e some junto com ela se o documento for trocado.
-- ----------------------------------------------------------------------------
alter table public.documentos add column if not exists confronto jsonb;

comment on column public.documentos.confronto is
  'Resultado do confronto do contrato com a matrícula: {conferido_em, itens:[{campo,contrato,matricula,status,observacao}], veredito}.';

-- Documentos anexados pelo portal público entravam como tipo "contrato",
-- que o extrator não reconhece — caíam na instrução genérica e produziam um
-- JSON solto em vez do resumo do contrato. Normaliza o histórico.
update public.documentos set tipo = 'compromisso' where tipo = 'contrato';

notify pgrst, 'reload schema';

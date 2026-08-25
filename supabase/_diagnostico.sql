-- ============================================================================
-- DIAGNÓSTICO — o que já foi aplicado neste banco
--
-- Rode isto ANTES de qualquer migration. Cada linha diz se aquela peça existe.
-- "false" significa que a migration correspondente não rodou (ou falhou no
-- meio, o que é indistinguível pelo resultado — em ambos os casos, rode de novo).
-- ============================================================================
select 'm15 · documentos.recebido_em' as peca,
       to_regclass('public.documentos') is not null
       and exists (select 1 from information_schema.columns
                   where table_name='documentos' and column_name='recebido_em') as ok
union all
select 'm16 · minutas.origem',
       exists (select 1 from information_schema.columns
               where table_name='minutas' and column_name='origem')
union all
select 'm17 · tabela precos',            to_regclass('public.precos') is not null
union all
select 'm17 · fn demonstrativo_faturamento',
       exists (select 1 from pg_proc where proname='demonstrativo_faturamento')
union all
select 'm18 · registrar_custodia com p_ator',
       exists (select 1 from pg_proc where proname='registrar_custodia' and pronargs=5)
union all
select 'm18 · tabela uso_tokens',        to_regclass('public.uso_tokens') is not null
union all
select 'm18 · fn modelo_do_acervo',
       exists (select 1 from pg_proc where proname='modelo_do_acervo')
union all
select 'm19 · documentos.vinculado',
       exists (select 1 from information_schema.columns
               where table_name='documentos' and column_name='vinculado')
union all
select 'm19 · fn consolidar_ato',
       exists (select 1 from pg_proc where proname='consolidar_ato')
union all
-- Duas registrar_custodia = sobrecarga não removida: o PostgREST recusa a
-- chamada com "is not unique" e a abertura de solicitação quebra.
select 'sanidade · registrar_custodia única',
       (select count(*) from pg_proc where proname='registrar_custodia') = 1
order by 1;

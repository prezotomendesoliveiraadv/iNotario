-- ============================================================================
-- iNotário · 18ª migration — autoria na cadeia de custódia
--                            + modelo padrão do acervo por tipo de ato
--                            + medição de tokens por cartório
--
-- Rodar DEPOIS de faturamento_uso.sql. Idempotente.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) QUEM PRATICOU CADA ETAPA — correção
--
-- `custodia_log.ator_id` sempre existiu e a função gravava `auth.uid()`. O
-- problema é que TODA ação de IA é registrada por Edge Function usando a chave
-- de serviço, e sob service role `auth.uid()` é NULL. Resultado: leitura de
-- documento, geração de minuta, triagem, consulta jurídica e pré-qualificação
-- ficavam todas sem autor — justamente os eventos em que saber quem mandou
-- fazer é mais relevante.
--
-- A função passa a aceitar o ator explicitamente. Quando não vier, mantém o
-- comportamento antigo (auth.uid()), então as chamadas do front seguem iguais.
-- O ator entra no payload do hash: a autoria fica dentro da cadeia, não ao lado.
-- ----------------------------------------------------------------------------
-- ATENÇÃO: `create or replace` com um parâmetro A MAIS não substitui a função —
-- cria uma SOBRECARGA. Ficariam duas registrar_custodia (4 e 5 argumentos) e o
-- PostgREST não conseguiria escolher entre elas numa chamada de 4 argumentos,
-- devolvendo "function public.registrar_custodia is not unique" e derrubando a
-- abertura de solicitação. A antiga precisa cair antes, pela assinatura exata.
drop function if exists public.registrar_custodia(uuid, uuid, text, jsonb);

create or replace function public.registrar_custodia(
  p_solicitacao uuid,
  p_minuta      uuid,
  p_acao        text,
  p_detalhe     jsonb,
  p_ator        uuid default null
) returns void language plpgsql security definer set search_path = public, extensions as $$
declare
  v_prev text; v_payload text; v_hash text; v_ator uuid;
begin
  v_ator := coalesce(p_ator, auth.uid());

  select hash_atual into v_prev
  from public.custodia_log
  where solicitacao_id = p_solicitacao
  order by id desc limit 1;

  v_payload := coalesce(v_prev, '') || '|' || p_acao || '|' ||
               coalesce(v_ator::text, 'sistema') || '|' ||
               coalesce(p_detalhe::text, '{}') || '|' || now()::text;

  v_hash := encode(extensions.digest(v_payload, 'sha256'), 'hex');

  insert into public.custodia_log
    (solicitacao_id, minuta_id, ator_id, acao, detalhe, hash_anterior, hash_atual)
  values
    (p_solicitacao, p_minuta, v_ator, p_acao, coalesce(p_detalhe,'{}'::jsonb), v_prev, v_hash);
end $$;

-- Nome e papel do ator para a linha do tempo. Sem isto a tela mostraria um
-- UUID, que não é auditoria — é enigma.
create or replace function public.custodia_da_solicitacao(p_solicitacao uuid)
returns table (
  id bigint, acao text, detalhe jsonb, created_at timestamptz,
  hash_atual text, ator_id uuid, ator_nome text, ator_papel text
)
language sql stable security definer set search_path = public as $$
  select c.id, c.acao, c.detalhe, c.created_at, c.hash_atual,
         c.ator_id,
         coalesce(p.nome, case when c.ator_id is null then 'Sistema' else 'Usuário removido' end),
         p.papel::text
  from public.custodia_log c
  left join public.profiles p on p.id = c.ator_id
  join public.solicitacoes s on s.id = c.solicitacao_id
  where c.solicitacao_id = p_solicitacao and public.is_equipe(s.cartorio_id)
  order by c.id desc;
$$;

-- Exclusões também precisam de rastro. Sem este gatilho, apagar uma parte ou um
-- documento não deixava marca alguma no ato.
create or replace function public.tg_custodia_exclusao()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.registrar_custodia(
    old.solicitacao_id, null, 'registro_excluido',
    jsonb_build_object('tabela', tg_table_name, 'registro_id', old.id,
                       'rotulo', coalesce(old.nome, old.nome_arquivo, '')));
  return old;
end $$;

drop trigger if exists tg_partes_excluida on public.partes;
create trigger tg_partes_excluida before delete on public.partes
  for each row execute function public.tg_custodia_exclusao();

drop trigger if exists tg_documentos_excluido on public.documentos;
create trigger tg_documentos_excluido before delete on public.documentos
  for each row execute function public.tg_custodia_exclusao();

-- ----------------------------------------------------------------------------
-- 2) MODELO PADRÃO DO ACERVO POR TIPO DE ATO
--
-- Já havia `acervo.padrao` com índice único por tipo de ato. O que faltava era
-- o caminho: fora de venda de construtora, a geração caía no template genérico
-- de `tipos_ato` e o acervo do cartório nunca era consultado.
-- ----------------------------------------------------------------------------
create or replace function public.modelo_do_acervo(p_cartorio uuid, p_tipo_slug text)
returns table (fonte text, titulo text, texto text)
language sql stable security definer set search_path = public as $$
  select 'acervo'::text, a.titulo, a.conteudo_texto
  from public.acervo a
  where a.cartorio_id = p_cartorio
    and a.categoria = 'modelo'
    and a.padrao
    and a.tipo_ato_slug is not distinct from p_tipo_slug
    and btrim(coalesce(a.conteudo_texto, '')) <> ''
  limit 1;
$$;

-- ----------------------------------------------------------------------------
-- 3) MEDIÇÃO DE TOKENS (custo de IA por cartório)
--
-- Fica em tabela própria, não na custódia: custo é dado operacional do
-- fornecedor e não deve entrar na cadeia de hash de um ato notarial.
-- ----------------------------------------------------------------------------
create table if not exists public.uso_tokens (
  id             bigint generated always as identity primary key,
  cartorio_id    uuid references public.cartorios(id) on delete cascade,
  solicitacao_id uuid references public.solicitacoes(id) on delete set null,
  funcao         text not null,
  provedor       text,
  modelo         text,
  tokens_entrada int not null default 0,
  tokens_saida   int not null default 0,
  created_at     timestamptz not null default now()
);
create index if not exists idx_uso_tokens_periodo on public.uso_tokens(cartorio_id, created_at);

alter table public.uso_tokens enable row level security;
drop policy if exists p_uso_tokens_admin on public.uso_tokens;
create policy p_uso_tokens_admin on public.uso_tokens for all
  using (public.is_admin_plataforma()) with check (public.is_admin_plataforma());

-- Preço do provedor, em USD por milhão de tokens. Só a plataforma vê e edita:
-- é o custo do fornecedor, não do cartório.
create table if not exists public.precos_ia (
  modelo        text primary key,
  usd_entrada_m numeric(12,4) not null default 0,
  usd_saida_m   numeric(12,4) not null default 0,
  usd_brl       numeric(10,4) not null default 5.40,
  atualizado_em timestamptz not null default now()
);
alter table public.precos_ia enable row level security;
drop policy if exists p_precos_ia_admin on public.precos_ia;
create policy p_precos_ia_admin on public.precos_ia for all
  using (public.is_admin_plataforma()) with check (public.is_admin_plataforma());

insert into public.precos_ia (modelo, usd_entrada_m, usd_saida_m)
values ('gemini-3.5-flash', 1.50, 9.00)
on conflict (modelo) do nothing;

-- Custo estimado por cartório no período. Estimado, não faturado: usa o preço
-- de lista, sem desconto de lote nem economia de cache.
create or replace function public.custo_ia_periodo(p_cartorio uuid, p_competencia text)
returns jsonb language sql stable security definer set search_path = public as $$
  with janela as (
    select (p_competencia || '-01')::timestamptz as ini,
           ((p_competencia || '-01')::date + interval '1 month')::timestamptz as fim
  ), u as (
    select t.funcao, t.modelo,
           sum(t.tokens_entrada)::bigint as ent, sum(t.tokens_saida)::bigint as sai
    from public.uso_tokens t, janela j
    where t.cartorio_id = p_cartorio and t.created_at >= j.ini and t.created_at < j.fim
    group by t.funcao, t.modelo
  ), c as (
    select u.funcao, u.modelo, u.ent, u.sai,
           round((u.ent / 1e6 * coalesce(p.usd_entrada_m, 0)
                + u.sai / 1e6 * coalesce(p.usd_saida_m, 0)) * coalesce(p.usd_brl, 5.40), 4) as brl
    from u left join public.precos_ia p on p.modelo = u.modelo
  )
  select jsonb_build_object(
    'competencia', p_competencia,
    'linhas', coalesce((select jsonb_agg(to_jsonb(c) order by c.brl desc) from c), '[]'::jsonb),
    'tokens_entrada', coalesce((select sum(ent) from c), 0),
    'tokens_saida', coalesce((select sum(sai) from c), 0),
    'custo_brl', coalesce((select sum(brl) from c), 0)
  );
$$;

notify pgrst, 'reload schema';

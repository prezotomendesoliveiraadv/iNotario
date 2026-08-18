-- ============================================================================
-- iNotário · 17ª migration — contrato social lido por IA
--                            + tarifação por evento de uso
--
-- Rodar DEPOIS de modelo_espelho.sql. Idempotente.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) CONTRATO SOCIAL: resultado da leitura por IA (itens 1 e 3)
--
-- Fica na própria construtora, não em `documentos`: aquele é o acervo de um
-- protocolo, e o contrato social é do cadastro — vale para todos os atos
-- daquela empresa e não deve ser apagado junto com uma solicitação.
-- ----------------------------------------------------------------------------
alter table public.construtoras add column if not exists contrato_social_lido jsonb;
alter table public.construtoras add column if not exists contrato_social_lido_em timestamptz;

comment on column public.construtoras.contrato_social_lido is
  'Leitura por IA do contrato social: {representantes:[...], poderes:{forma, restricoes[], limite_valor}, alteracoes, fonte}.';

-- Origem do representante: digitado à mão, lido do contrato social ou inferido
-- do modelo de escritura. Sem isto não dá para saber o que foi conferido por
-- pessoa e o que veio de leitura automática — e a distinção importa: um
-- representante errado invalida a escritura.
alter table public.construtora_representantes add column if not exists origem text not null default 'manual';
alter table public.construtora_representantes add column if not exists poderes_forma text;
alter table public.construtora_representantes add column if not exists conferido_em timestamptz;

comment on column public.construtora_representantes.origem is
  'manual | contrato_social | modelo_escritura — de onde veio o registro.';
comment on column public.construtora_representantes.poderes_forma is
  'isolada | conjunta | conjunta_com_outro — como este representante pode assinar.';

-- ----------------------------------------------------------------------------
-- 2) VALIDAÇÃO DE CNPJ NO BANCO (item 2)
--
-- A máscara na tela evita o erro de digitação; a checagem aqui evita o dado
-- ruim que entra por importação, API ou correção manual no banco. Uma das
-- duas sozinha não basta.
-- ----------------------------------------------------------------------------
create or replace function public.cnpj_valido(p_cnpj text)
returns boolean language plpgsql immutable as $$
declare
  d text; soma int; resto int; i int; peso int;
begin
  d := regexp_replace(coalesce(p_cnpj, ''), '\D', '', 'g');
  if d = '' then return true; end if;                    -- vazio é permitido
  if length(d) <> 14 then return false; end if;
  if d ~ '^(\d)\1{13}$' then return false; end if;       -- 00000000000000 etc.

  -- 1º dígito verificador
  soma := 0; peso := 5;
  for i in 1..12 loop
    soma := soma + (substr(d, i, 1))::int * peso;
    peso := case when peso = 2 then 9 else peso - 1 end;
  end loop;
  resto := soma % 11;
  if (substr(d, 13, 1))::int <> (case when resto < 2 then 0 else 11 - resto end) then return false; end if;

  -- 2º dígito verificador
  soma := 0; peso := 6;
  for i in 1..13 loop
    soma := soma + (substr(d, i, 1))::int * peso;
    peso := case when peso = 2 then 9 else peso - 1 end;
  end loop;
  resto := soma % 11;
  if (substr(d, 14, 1))::int <> (case when resto < 2 then 0 else 11 - resto end) then return false; end if;

  return true;
end $$;

-- NOT VALID: passa a valer para o que entrar de agora em diante, sem quebrar a
-- migration por causa de cadastro antigo com CNPJ incompleto. Depois de
-- limpar a base, rode:
--   alter table public.construtoras validate constraint construtoras_cnpj_valido;
do $$ begin
  alter table public.construtoras
    add constraint construtoras_cnpj_valido check (public.cnpj_valido(cnpj)) not valid;
exception when duplicate_object then null; end $$;

-- ----------------------------------------------------------------------------
-- 3) TABELA DE PREÇOS POR EVENTO (itens 4 e 5)
--
-- `cartorio_id` nulo é a tabela padrão da plataforma; uma linha com cartório
-- preenchido sobrepõe o padrão só para aquele cartório. Assim dá para negociar
-- caso a caso sem duplicar a tabela inteira.
-- ----------------------------------------------------------------------------
create table if not exists public.precos (
  id             uuid primary key default gen_random_uuid(),
  cartorio_id    uuid references public.cartorios(id) on delete cascade,
  item           text not null,
  valor_unitario numeric(12,4) not null default 0,
  ativo          boolean not null default true,
  atualizado_em  timestamptz not null default now()
);

-- Unicidade em dois índices: NULL não colide consigo mesmo num UNIQUE comum.
create unique index if not exists idx_precos_padrao on public.precos(item) where cartorio_id is null;
create unique index if not exists idx_precos_cartorio on public.precos(cartorio_id, item) where cartorio_id is not null;

alter table public.precos enable row level security;
drop policy if exists p_precos_admin on public.precos;
create policy p_precos_admin on public.precos for all
  using (public.is_admin_plataforma()) with check (public.is_admin_plataforma());
drop policy if exists p_precos_cartorio_ler on public.precos;
create policy p_precos_cartorio_ler on public.precos for select
  using (cartorio_id is null or public.is_equipe(cartorio_id));

-- Valores iniciais em zero de propósito: preço é decisão comercial, não default
-- de software. Zero aparece explicitamente na tela como "não precificado".
insert into public.precos (cartorio_id, item, valor_unitario)
select null, x.item, 0 from (values
  ('ato_aberto'), ('leitura_documento'), ('minuta_ia'),
  ('triagem_ia'), ('consulta_juridica'), ('prequalificacao')
) as x(item)
on conflict do nothing;

-- ----------------------------------------------------------------------------
-- 4) MEDIÇÃO DO USO (item 4)
--
-- Cada item é contado na sua fonte natural: protocolos na tabela de
-- solicitações, minutas na tabela de minutas, e os eventos de IA na cadeia de
-- custódia — que já registrava tudo isso para fins de rastreabilidade e passa
-- a servir também de base de medição. Uma fonte só, sem contador paralelo que
-- possa divergir.
-- ----------------------------------------------------------------------------
create or replace function public.uso_faturavel(p_cartorio uuid, p_competencia text)
returns table (item text, rotulo text, quantidade bigint)
language sql stable security definer set search_path = public as $$
  with janela as (
    select (p_competencia || '-01')::timestamptz as ini,
           ((p_competencia || '-01')::date + interval '1 month')::timestamptz as fim
  ), sol as (
    select s.id from public.solicitacoes s, janela j
    where s.cartorio_id = p_cartorio and s.created_at >= j.ini and s.created_at < j.fim
  ), log as (
    select c.acao from public.custodia_log c
    join public.solicitacoes s on s.id = c.solicitacao_id, janela j
    where s.cartorio_id = p_cartorio and c.created_at >= j.ini and c.created_at < j.fim
  )
  select 'ato_aberto', 'Atos abertos (protocolos)', (select count(*) from sol)
  union all
  select 'leitura_documento', 'Leituras de documento por IA',
         (select count(*) from log where acao = 'documento_extraido')
  union all
  -- cada versão conta; edição manual não é geração por IA
  select 'minuta_ia', 'Minutas geradas por IA (por versão)',
         (select count(*) from public.minutas m
          join public.solicitacoes s on s.id = m.solicitacao_id, janela j
          where s.cartorio_id = p_cartorio and m.created_at >= j.ini and m.created_at < j.fim
            and coalesce(m.origem, 'ia') <> 'edicao_manual')
  union all
  select 'triagem_ia', 'Triagens por IA', (select count(*) from log where acao = 'triagem_ia')
  union all
  select 'consulta_juridica', 'Consultas jurídicas', (select count(*) from log where acao = 'consulta_juridica')
  union all
  select 'prequalificacao', 'Avaliações de aptidão registral',
         (select count(*) from log where acao = 'prequalificacao_registral');
$$;

-- ----------------------------------------------------------------------------
-- 5) DEMONSTRATIVO DA COBRANÇA (item 5)
--
-- Devolve a conta linha a linha. A tela apenas exibe: o cálculo mora aqui,
-- para que fatura, prévia e conferência usem exatamente a mesma regra.
-- ----------------------------------------------------------------------------
create or replace function public.demonstrativo_faturamento(p_cartorio uuid, p_competencia text)
returns jsonb
language sql stable security definer set search_path = public as $$
  with u as (select * from public.uso_faturavel(p_cartorio, p_competencia)),
  p as (
    select u.item, u.rotulo, u.quantidade,
           coalesce(
             (select valor_unitario from public.precos where cartorio_id = p_cartorio and item = u.item and ativo),
             (select valor_unitario from public.precos where cartorio_id is null and item = u.item and ativo),
             0
           ) as valor_unitario
    from u
  ), linhas as (
    select item, rotulo, quantidade, valor_unitario,
           round(quantidade * valor_unitario, 2) as valor_total
    from p
  ), fixo as (
    select coalesce((select valor_fixo from public.planos where cartorio_id = p_cartorio), 0) as v
  )
  select jsonb_build_object(
    'competencia', p_competencia,
    'valor_fixo', (select v from fixo),
    'linhas', (select coalesce(jsonb_agg(to_jsonb(l) order by l.item), '[]'::jsonb) from linhas l),
    'valor_variavel', (select coalesce(sum(valor_total), 0) from linhas),
    'valor_total', (select v from fixo) + (select coalesce(sum(valor_total), 0) from linhas),
    'sem_preco', (select coalesce(jsonb_agg(item), '[]'::jsonb) from linhas where valor_unitario = 0 and quantidade > 0)
  );
$$;

-- Só nível 4 (administração) e admin da plataforma veem a conta.
create or replace function public.pode_ver_faturamento(p_cartorio uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin_plataforma()
      or (public.is_equipe(p_cartorio) and coalesce(public.meu_nivel(), 0) >= 4);
$$;

notify pgrst, 'reload schema';

-- ============================================================================
-- iNotário · Vertical de incorporação
--   1) Construtoras, representantes legais e empreendimentos
--   2) Vínculo do ato à unidade (detecção de protocolo duplicado)
--   3) Cláusulas especiais no acervo
--   4) Controle de vencimento de certidões e procurações
-- Pré-requisitos: schema.sql → ... → melhorias_ux.sql
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) CONSTRUTORAS
-- ---------------------------------------------------------------------------
create table if not exists public.construtoras (
  id             uuid primary key default gen_random_uuid(),
  cartorio_id    uuid not null references public.cartorios(id) on delete cascade,
  razao_social   text not null,
  nome_fantasia  text,
  cnpj           text,
  endereco       text,
  -- Contrato social e modelo padrão de escritura da construtora
  contrato_social_path text,
  contrato_social_nome text,
  modelo_escritura     text,           -- texto do modelo padrão (base da minuta)
  modelo_acervo_id     uuid references public.acervo(id) on delete set null,
  observacoes    text,
  ativo          boolean not null default true,
  criado_por     uuid references auth.users(id) default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_construtoras_cart on public.construtoras(cartorio_id, razao_social);
create index if not exists idx_construtoras_cnpj on public.construtoras(regexp_replace(coalesce(cnpj,''), '\D', '', 'g'));

-- Representante legal: qualificação completa + procuração com validade
create table if not exists public.construtora_representantes (
  id              uuid primary key default gen_random_uuid(),
  construtora_id  uuid not null references public.construtoras(id) on delete cascade,
  nome            text not null,
  cpf             text,
  rg              text,
  nacionalidade   text,
  estado_civil    text,
  regime_bens     text,
  profissao       text,
  endereco        text,
  email           text,
  telefone        text,
  cargo           text,                      -- ex.: diretor, procurador
  -- Procuração outorgada ao representante
  procuracao_path      text,
  procuracao_nome      text,
  procuracao_lavrada_em date,
  procuracao_validade   date,               -- vencimento (item 6)
  procuracao_poderes    text,
  ativo           boolean not null default true,
  created_at      timestamptz not null default now()
);
create index if not exists idx_rep_construtora on public.construtora_representantes(construtora_id, ativo);
create index if not exists idx_rep_validade on public.construtora_representantes(procuracao_validade)
  where procuracao_validade is not null;

-- Certidões da construtora (N por construtora, cada uma com validade)
create table if not exists public.construtora_certidoes (
  id              uuid primary key default gen_random_uuid(),
  construtora_id  uuid not null references public.construtoras(id) on delete cascade,
  tipo            text not null,             -- ex.: negativa federal, FGTS, trabalhista
  numero          text,
  emitida_em      date,
  validade        date,
  storage_path    text,
  nome_arquivo    text,
  observacao      text,
  created_at      timestamptz not null default now()
);
create index if not exists idx_cert_construtora on public.construtora_certidoes(construtora_id);
create index if not exists idx_cert_validade on public.construtora_certidoes(validade) where validade is not null;

-- ---------------------------------------------------------------------------
-- 2) EMPREENDIMENTOS
-- ---------------------------------------------------------------------------
create table if not exists public.empreendimentos (
  id              uuid primary key default gen_random_uuid(),
  cartorio_id     uuid not null references public.cartorios(id) on delete cascade,
  construtora_id  uuid not null references public.construtoras(id) on delete cascade,
  nome            text not null,
  endereco        text,
  cidade          text,
  uf              text,
  matricula_mae   text,
  cartorio_ri     text,
  registro_incorporacao text,               -- R. da incorporação (Lei 4.591/64)
  total_unidades  int,
  -- Modelo próprio do empreendimento (tem precedência sobre o da construtora)
  modelo_escritura text,
  modelo_acervo_id uuid references public.acervo(id) on delete set null,
  ativo           boolean not null default true,
  created_at      timestamptz not null default now()
);
create index if not exists idx_empr_cart on public.empreendimentos(cartorio_id, ativo);
create index if not exists idx_empr_nome on public.empreendimentos(lower(nome));
create index if not exists idx_empr_construtora on public.empreendimentos(construtora_id);

-- Vínculo do ato à unidade comercializada
alter table public.solicitacoes add column if not exists empreendimento_id uuid
  references public.empreendimentos(id) on delete set null;
alter table public.solicitacoes add column if not exists unidade text;
create index if not exists idx_solic_unidade on public.solicitacoes(empreendimento_id, unidade)
  where empreendimento_id is not null;

-- ---------------------------------------------------------------------------
-- 3) CLÁUSULAS ESPECIAIS (acervo do cartório)
-- ---------------------------------------------------------------------------
create table if not exists public.clausulas_especiais (
  id            uuid primary key default gen_random_uuid(),
  cartorio_id   uuid not null references public.cartorios(id) on delete cascade,
  nome          text not null,               -- ex.: Retrovenda
  slug          text,
  categoria     text,                        -- ex.: resolutiva, restritiva, garantia
  texto         text not null,               -- redação padrão (com [placeholders])
  fundamento    text,                        -- ex.: CC, arts. 505 a 508
  orientacao    text,                        -- quando usar / cuidados
  tipos_ato     text[] not null default '{}',-- slugs em que se aplica ('' = todos)
  ativo         boolean not null default true,
  criado_por    uuid references auth.users(id) default auth.uid(),
  created_at    timestamptz not null default now()
);
create index if not exists idx_clausulas_cart on public.clausulas_especiais(cartorio_id, ativo);

-- Cláusulas efetivamente inseridas em um ato
create table if not exists public.solicitacao_clausulas (
  id             uuid primary key default gen_random_uuid(),
  solicitacao_id uuid not null references public.solicitacoes(id) on delete cascade,
  clausula_id    uuid references public.clausulas_especiais(id) on delete set null,
  nome           text not null,
  texto          text not null,               -- texto já ajustado ao caso
  ordem          int not null default 0,
  inserida_por   uuid references auth.users(id) default auth.uid(),
  created_at     timestamptz not null default now()
);
create index if not exists idx_solic_clausulas on public.solicitacao_clausulas(solicitacao_id, ordem);

-- ---------------------------------------------------------------------------
-- 4) VENCIMENTOS em documentos do ato (certidões, procurações)
-- ---------------------------------------------------------------------------
alter table public.documentos add column if not exists emitida_em date;
alter table public.documentos add column if not exists validade date;
alter table public.documentos add column if not exists vincular_escritura boolean not null default false;
create index if not exists idx_doc_validade on public.documentos(validade) where validade is not null;

-- ---------------------------------------------------------------------------
-- 5) RLS — tudo restrito à equipe do cartório
-- ---------------------------------------------------------------------------
alter table public.construtoras              enable row level security;
alter table public.construtora_representantes enable row level security;
alter table public.construtora_certidoes     enable row level security;
alter table public.empreendimentos           enable row level security;
alter table public.clausulas_especiais       enable row level security;
alter table public.solicitacao_clausulas     enable row level security;

drop policy if exists p_construtoras on public.construtoras;
create policy p_construtoras on public.construtoras for all
  using (public.is_equipe(cartorio_id)) with check (public.is_equipe(cartorio_id));

drop policy if exists p_empreendimentos on public.empreendimentos;
create policy p_empreendimentos on public.empreendimentos for all
  using (public.is_equipe(cartorio_id)) with check (public.is_equipe(cartorio_id));

drop policy if exists p_clausulas on public.clausulas_especiais;
create policy p_clausulas on public.clausulas_especiais for all
  using (public.is_equipe(cartorio_id)) with check (public.is_equipe(cartorio_id));

drop policy if exists p_reps on public.construtora_representantes;
create policy p_reps on public.construtora_representantes for all
  using (exists (select 1 from public.construtoras c
                 where c.id = construtora_id and public.is_equipe(c.cartorio_id)))
  with check (exists (select 1 from public.construtoras c
                 where c.id = construtora_id and public.is_equipe(c.cartorio_id)));

drop policy if exists p_certs on public.construtora_certidoes;
create policy p_certs on public.construtora_certidoes for all
  using (exists (select 1 from public.construtoras c
                 where c.id = construtora_id and public.is_equipe(c.cartorio_id)))
  with check (exists (select 1 from public.construtoras c
                 where c.id = construtora_id and public.is_equipe(c.cartorio_id)));

drop policy if exists p_solic_clausulas on public.solicitacao_clausulas;
create policy p_solic_clausulas on public.solicitacao_clausulas for all
  using (exists (select 1 from public.solicitacoes s
                 where s.id = solicitacao_id and public.is_equipe(s.cartorio_id)))
  with check (exists (select 1 from public.solicitacoes s
                 where s.id = solicitacao_id and public.is_equipe(s.cartorio_id)));

-- Bucket dos documentos societários
insert into storage.buckets (id, name, public) values ('construtoras', 'construtoras', false)
on conflict (id) do nothing;

drop policy if exists p_bkt_construtoras on storage.objects;
create policy p_bkt_construtoras on storage.objects for all to authenticated
  using (bucket_id = 'construtoras') with check (bucket_id = 'construtoras');

-- ---------------------------------------------------------------------------
-- 6) BUSCA DE EMPREENDIMENTO (usada também pelo atendimento externo)
--    Devolve só o que é público do empreendimento — nunca documentos.
-- ---------------------------------------------------------------------------
create or replace function public.buscar_empreendimentos(
  p_cartorio uuid, p_termo text default null, p_limite int default 10
)
returns table (
  id uuid, nome text, construtora text, cidade text, uf text, total_unidades int
)
language sql stable security definer set search_path = public as $$
  select e.id, e.nome, c.razao_social, e.cidade, e.uf, e.total_unidades
  from public.empreendimentos e
  join public.construtoras c on c.id = e.construtora_id
  where e.cartorio_id = p_cartorio and e.ativo
    and (
      nullif(btrim(coalesce(p_termo,'')), '') is null
      or e.nome ilike '%' || btrim(p_termo) || '%'
      or c.razao_social ilike '%' || btrim(p_termo) || '%'
      or c.nome_fantasia ilike '%' || btrim(p_termo) || '%'
    )
  order by e.nome
  limit greatest(1, least(coalesce(p_limite, 10), 50));
$$;

-- Já existe protocolo para esta unidade?
create or replace function public.unidade_em_uso(
  p_empreendimento uuid, p_unidade text
)
returns table (id uuid, protocolo text, status text, etapa text, criado_em timestamptz)
language sql stable security definer set search_path = public as $$
  select s.id, s.protocolo, s.status::text, s.etapa, s.created_at
  from public.solicitacoes s
  where s.empreendimento_id = p_empreendimento
    and upper(regexp_replace(coalesce(s.unidade,''), '\s', '', 'g'))
        = upper(regexp_replace(coalesce(p_unidade,''), '\s', '', 'g'))
    and s.status <> 'cancelada'
  order by s.created_at desc;
$$;

-- ---------------------------------------------------------------------------
-- 7) VENCIMENTOS — certidões e procurações do ato e da construtora
--    Alerta a partir de 10 dias antes (item 6).
-- ---------------------------------------------------------------------------
create or replace function public.vencimentos_solicitacao(
  p_solicitacao uuid, p_janela_dias int default 10
)
returns table (
  origem text,        -- documento | procuracao | certidao_construtora
  descricao text,
  validade date,
  dias_restantes int,
  situacao text       -- vencido | vence_em_breve | vigente
)
language sql stable security definer set search_path = public as $$
  with base as (
    -- documentos anexados ao próprio ato
    select 'documento'::text as origem,
           coalesce(d.nome_arquivo, d.tipo) as descricao,
           d.validade
    from public.documentos d
    where d.solicitacao_id = p_solicitacao and d.validade is not null

    union all
    -- procuração do representante da construtora vinculada ao empreendimento
    select 'procuracao'::text,
           'Procuração de ' || r.nome || ' (' || c.razao_social || ')',
           r.procuracao_validade
    from public.solicitacoes s
    join public.empreendimentos e on e.id = s.empreendimento_id
    join public.construtoras c on c.id = e.construtora_id
    join public.construtora_representantes r on r.construtora_id = c.id and r.ativo
    where s.id = p_solicitacao and r.procuracao_validade is not null

    union all
    -- certidões da construtora
    select 'certidao_construtora'::text,
           cc.tipo || coalesce(' nº ' || cc.numero, '') || ' (' || c.razao_social || ')',
           cc.validade
    from public.solicitacoes s
    join public.empreendimentos e on e.id = s.empreendimento_id
    join public.construtoras c on c.id = e.construtora_id
    join public.construtora_certidoes cc on cc.construtora_id = c.id
    where s.id = p_solicitacao and cc.validade is not null
  )
  select origem, descricao, validade,
         (validade - current_date)::int as dias_restantes,
         case
           when validade < current_date then 'vencido'
           when validade - current_date <= greatest(coalesce(p_janela_dias,10), 0) then 'vence_em_breve'
           else 'vigente'
         end as situacao
  from base
  order by validade;
$$;

-- ---------------------------------------------------------------------------
-- 8) MODELO PADRÃO aplicável ao ato (item 4)
--    Precedência: empreendimento → construtora → acervo padrão do tipo de ato
-- ---------------------------------------------------------------------------
create or replace function public.modelo_para_solicitacao(p_solicitacao uuid)
returns table (fonte text, titulo text, texto text)
language sql stable security definer set search_path = public as $$
  with s as (
    select sol.id, sol.cartorio_id, sol.empreendimento_id, ta.slug as tipo_slug
    from public.solicitacoes sol
    join public.tipos_ato ta on ta.id = sol.tipo_ato_id
    where sol.id = p_solicitacao
  )
  -- 1º: modelo do empreendimento
  select 'empreendimento'::text, e.nome,
         coalesce(e.modelo_escritura, a.conteudo_texto)
  from s join public.empreendimentos e on e.id = s.empreendimento_id
         left join public.acervo a on a.id = e.modelo_acervo_id
  where coalesce(e.modelo_escritura, a.conteudo_texto) is not null

  union all
  -- 2º: modelo da construtora
  select 'construtora', c.razao_social,
         coalesce(c.modelo_escritura, a.conteudo_texto)
  from s join public.empreendimentos e on e.id = s.empreendimento_id
         join public.construtoras c on c.id = e.construtora_id
         left join public.acervo a on a.id = c.modelo_acervo_id
  where coalesce(c.modelo_escritura, a.conteudo_texto) is not null

  union all
  -- 3º: modelo padrão do acervo para o tipo de ato
  select 'acervo', a.titulo, a.conteudo_texto
  from s join public.acervo a
    on a.cartorio_id = s.cartorio_id and a.categoria = 'modelo'
   and a.padrao and a.tipo_ato_slug is not distinct from s.tipo_slug
  where a.conteudo_texto is not null
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- 9) QUALIFICAÇÃO AUTOMÁTICA DO VENDEDOR (item 2)
--    Sendo venda de construtora, o vendedor já está na base: materializa a
--    parte "Outorgante Vendedor" com a construtora e seu representante.
-- ---------------------------------------------------------------------------
create or replace function public.aplicar_vendedor_construtora(
  p_solicitacao uuid, p_papel text default 'Outorgante Vendedor'
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_constr public.construtoras%rowtype;
  v_rep    public.construtora_representantes%rowtype;
  v_dados  jsonb;
  v_id     uuid;
begin
  select c.* into v_constr
  from public.solicitacoes s
  join public.empreendimentos e on e.id = s.empreendimento_id
  join public.construtoras c on c.id = e.construtora_id
  where s.id = p_solicitacao;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'sem empreendimento vinculado'); end if;

  select r.* into v_rep from public.construtora_representantes r
  where r.construtora_id = v_constr.id and r.ativo
  order by r.procuracao_validade desc nulls last limit 1;

  v_dados := jsonb_strip_nulls(jsonb_build_object(
    'origem', 'cadastro_construtora',
    'cnpj', v_constr.cnpj,
    'endereco', v_constr.endereco,
    'representante', v_rep.nome,
    'representante_cpf', v_rep.cpf,
    'representante_cargo', v_rep.cargo,
    'representante_estado_civil', v_rep.estado_civil,
    'representante_profissao', v_rep.profissao,
    'procuracao_validade', v_rep.procuracao_validade
  ));

  select id into v_id from public.partes
  where solicitacao_id = p_solicitacao and papel = p_papel limit 1;

  if v_id is null then
    insert into public.partes (solicitacao_id, papel, nome, cpf_cnpj, dados, ordem)
    values (p_solicitacao, p_papel, v_constr.razao_social, v_constr.cnpj, v_dados, 0)
    returning id into v_id;
  else
    update public.partes
      set nome = v_constr.razao_social, cpf_cnpj = v_constr.cnpj,
          dados = coalesce(dados, '{}'::jsonb) || v_dados
    where id = v_id;
  end if;

  return jsonb_build_object('ok', true, 'parte_id', v_id,
    'construtora', v_constr.razao_social, 'representante', v_rep.nome);
end $$;

notify pgrst, 'reload schema';
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 10) CLÁUSULAS ESPECIAIS — sementes clássicas (uma vez por cartório)
--     Textos de partida, para o cartório adaptar à sua praxe.
-- ---------------------------------------------------------------------------
insert into public.clausulas_especiais (cartorio_id, nome, slug, categoria, fundamento, orientacao, texto)
select c.id, v.nome, v.slug, v.categoria, v.fundamento, v.orientacao, v.texto
from public.cartorios c
cross join (values
  ('Retrovenda', 'retrovenda', 'resolutiva',
   'Código Civil, arts. 505 a 508',
   'Só em venda de imóvel e por prazo máximo de 3 anos. Deve constar da escritura e ser levada a registro para valer contra terceiros.',
   'RETROVENDA: O(A) OUTORGANTE VENDEDOR(A) reserva-se o direito de recobrar o imóvel ora alienado, no prazo de [PRAZO, máximo de três anos] contado desta data, restituindo ao(à) OUTORGADO(A) COMPRADOR(A) o preço recebido, corrigido na forma de [CRITÉRIO], acrescido das despesas de escritura e registro e das benfeitorias necessárias, nos termos dos arts. 505 a 508 do Código Civil. Exercido o direito no prazo, resolve-se a propriedade do comprador.'),
  ('Reversão (cláusula de reversão)', 'reversao', 'resolutiva',
   'Código Civil, art. 547',
   'Própria da doação: o bem retorna ao doador se este sobreviver ao donatário. Não se admite reversão em favor de terceiro.',
   'REVERSÃO: Fica estipulado que o bem ora doado reverterá ao patrimônio do(a) DOADOR(A) caso este(a) sobreviva ao(à) DONATÁRIO(A), nos termos do art. 547 do Código Civil, ficando desde já vedada a reversão em favor de terceiro.'),
  ('Perempção / caducidade do direito', 'perempcao', 'resolutiva',
   'Código Civil, arts. 505 e 507',
   'Registre o termo final de forma inequívoca: decorrido o prazo sem exercício, o direito caduca e a propriedade se consolida.',
   'PEREMPÇÃO: Não exercido o direito ora reservado até [DATA/PRAZO], operar-se-á de pleno direito a sua caducidade, consolidando-se definitivamente a propriedade em nome do(a) adquirente, independentemente de notificação, interpelação ou qualquer outra formalidade.'),
  ('Condição resolutiva expressa', 'condicao-resolutiva', 'resolutiva',
   'Código Civil, arts. 127 e 128',
   'Descreva o evento futuro e incerto com precisão; ambiguidade gera exigência no registro.',
   'CONDIÇÃO RESOLUTIVA: O presente negócio fica submetido à condição resolutiva expressa consistente em [DESCRIÇÃO DO EVENTO FUTURO E INCERTO]. Implementada a condição, resolve-se de pleno direito o negócio, retornando as partes ao estado anterior, na forma dos arts. 127 e 128 do Código Civil.'),
  ('Inalienabilidade, impenhorabilidade e incomunicabilidade', 'inalienabilidade', 'restritiva',
   'Código Civil, arts. 1.848 e 1.911',
   'Em doação ou testamento. A inalienabilidade implica impenhorabilidade e incomunicabilidade. Sobre a legítima, exige justa causa declarada.',
   'CLÁUSULAS RESTRITIVAS: O bem ora transmitido fica gravado com as cláusulas de INALIENABILIDADE, IMPENHORABILIDADE e INCOMUNICABILIDADE, [VITALÍCIA/PELO PRAZO DE ...], nos termos dos arts. 1.848 e 1.911 do Código Civil, [DECLARAR JUSTA CAUSA quando incidir sobre a legítima].'),
  ('Reserva de usufruto', 'usufruto', 'restritiva',
   'Código Civil, arts. 1.390 e seguintes',
   'A nua-propriedade é transmitida e o usufruto reservado. Deve ser registrado na matrícula.',
   'RESERVA DE USUFRUTO: O(A) OUTORGANTE transmite tão somente a NUA-PROPRIEDADE do imóvel, reservando para si o USUFRUTO VITALÍCIO, com direito ao uso, à administração e à percepção dos frutos, nos termos dos arts. 1.390 e seguintes do Código Civil, extinguindo-se o usufruto pela morte do usufrutuário, com consolidação automática da propriedade plena.'),
  ('Arras / sinal', 'arras', 'garantia',
   'Código Civil, arts. 417 a 420',
   'Distinga arras confirmatórias de penitenciais: o efeito do arrependimento é diferente.',
   'ARRAS: As partes declaram que foi pago, a título de arras [CONFIRMATÓRIAS/PENITENCIAIS], o valor de R$ [VALOR], [imputável ao preço/não imputável], aplicando-se o regime dos arts. 417 a 420 do Código Civil em caso de inexecução ou arrependimento.')
) as v(nome, slug, categoria, fundamento, orientacao, texto)
where not exists (
  select 1 from public.clausulas_especiais x
  where x.cartorio_id = c.id and x.slug = v.slug
);

notify pgrst, 'reload schema';

-- ============================================================================
-- iNotário · 15ª migration — recebimento confirmado de documentos
--                            + busca por nome/telefone do solicitante
--
-- Rodar DEPOIS de data_cartorio.sql. Idempotente.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) DOCUMENTOS: distinguir "reservado" de "efetivamente recebido"
--
-- O fluxo de anexo cria a linha em `documentos` ANTES de o arquivo subir (é ela
-- que dá origem ao caminho assinado). Se o upload falha, a linha fica órfã e o
-- sistema passa a acreditar que recebeu algo que nunca chegou — foi o que fez a
-- Artemis confirmar recebimento de documento inexistente.
--
-- `recebido_em` só é preenchido depois que o objeto é confirmado no storage.
-- Nada que esteja com `recebido_em` nulo pode ser tratado como recebido.
-- ----------------------------------------------------------------------------
alter table public.documentos add column if not exists recebido_em timestamptz;

comment on column public.documentos.recebido_em is
  'Preenchido só quando o arquivo é confirmado no storage. Nulo = reservado, não recebido.';

create index if not exists idx_documentos_recebidos
  on public.documentos(solicitacao_id, recebido_em)
  where recebido_em is not null;

-- Linhas antigas: as que têm tamanho gravado já passaram por upload concluído.
update public.documentos
   set recebido_em = created_at
 where recebido_em is null
   and tamanho is not null
   and tamanho > 0;

-- ----------------------------------------------------------------------------
-- 2) BUSCA: incluir nome e telefone do SOLICITANTE
--
-- A busca cobria protocolo, título, tipo de ato e as PARTES do ato. Mas quem
-- liga para o cartório costuma ser o solicitante do atendimento — que pode não
-- ser parte nenhuma (corretor, familiar, preposto da construtora). Sem isto,
-- procurar pelo telefone de quem abriu o protocolo não devolvia nada.
--
-- Telefone entra por dígitos, então "(19) 99999-8888" acha "19999998888".
-- ----------------------------------------------------------------------------
create or replace function public.buscar_solicitacoes(
  p_cartorio uuid,
  p_termo    text default null,
  p_status   text default null,
  p_limite   int  default 50
)
returns table (
  id uuid, protocolo text, titulo text, status text, etapa text,
  responsavel_papel text, complexidade text, exigencia_atual text,
  tipo_nome text, partes_nomes text, created_at timestamptz, updated_at timestamptz
)
language sql stable security definer set search_path = public as $$
  with termo as (
    select nullif(btrim(coalesce(p_termo,'')), '') as t
  ), so as (
    select numeros from (select regexp_replace(coalesce((select t from termo),''), '\D', '', 'g') as numeros) x
  )
  select s.id, s.protocolo, s.titulo, s.status::text, s.etapa, s.responsavel_papel,
         s.complexidade, s.exigencia_atual,
         ta.nome as tipo_nome,
         (select string_agg(p.nome, ', ' order by p.ordem, p.created_at)
            from public.partes p where p.solicitacao_id = s.id) as partes_nomes,
         s.created_at, s.updated_at
  from public.solicitacoes s
  left join public.tipos_ato ta on ta.id = s.tipo_ato_id
  where s.cartorio_id = p_cartorio
    and public.is_equipe(s.cartorio_id)
    and (p_status is null or p_status = '' or s.status::text = p_status)
    and (
      (select t from termo) is null
      or s.protocolo ilike '%' || (select t from termo) || '%'
      or s.titulo    ilike '%' || (select t from termo) || '%'
      or ta.nome     ilike '%' || (select t from termo) || '%'
      -- solicitante do atendimento (pode não ser parte do ato)
      or s.contato_nome ilike '%' || (select t from termo) || '%'
      or (
        length((select numeros from so)) >= 4
        and regexp_replace(coalesce(s.contato_whatsapp,''), '\D', '', 'g')
            like '%' || (select numeros from so) || '%'
      )
      or exists (
        select 1 from public.partes p
        where p.solicitacao_id = s.id
          and (
            p.nome ilike '%' || (select t from termo) || '%'
            or (
              length((select numeros from so)) >= 3
              and regexp_replace(coalesce(p.cpf_cnpj,''), '\D', '', 'g') like '%' || (select numeros from so) || '%'
            )
          )
      )
    )
  order by s.updated_at desc
  limit greatest(1, least(coalesce(p_limite, 50), 200));
$$;

-- Índices para o ilike não varrer a tabela inteira quando o volume crescer.
create extension if not exists pg_trgm;
create index if not exists idx_solic_contato_nome
  on public.solicitacoes using gin (contato_nome gin_trgm_ops);

notify pgrst, 'reload schema';

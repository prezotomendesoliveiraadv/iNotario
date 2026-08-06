-- ============================================================================
-- iNotário · Documentos de instrução + extração por IA (RG/CNH/Matrícula)
-- Execute no SQL Editor após o schema.sql e o acervo_portal_fix.sql.
-- ============================================================================

-- Tabela: documentos enviados para instruir a solicitação (e os dados extraídos)
create table if not exists public.documentos (
  id              uuid primary key default gen_random_uuid(),
  solicitacao_id  uuid not null references public.solicitacoes(id) on delete cascade,
  tipo            text not null default 'outro',   -- rg | cnh | matricula | outro
  nome_arquivo    text not null,
  storage_path    text not null,
  mime            text,
  tamanho         bigint,
  extraido        jsonb,                            -- dados lidos pela IA (p/ validação)
  status          text not null default 'pendente',-- pendente | extraido | validado
  enviado_por     uuid references auth.users(id) default auth.uid(),
  created_at      timestamptz not null default now()
);
create index if not exists idx_documentos_solic on public.documentos(solicitacao_id, created_at desc);

alter table public.documentos enable row level security;
drop policy if exists p_documentos_equipe on public.documentos;
create policy p_documentos_equipe on public.documentos for all
  using (exists (select 1 from public.solicitacoes s where s.id = solicitacao_id and public.is_equipe(s.cartorio_id)))
  with check (exists (select 1 from public.solicitacoes s where s.id = solicitacao_id and public.is_equipe(s.cartorio_id)));

-- Bucket privado para os documentos de instrução
do $$
begin
  insert into storage.buckets (id, name, public) values ('documentos','documentos',false)
  on conflict (id) do nothing;
exception when others then
  raise notice 'Crie o bucket "documentos" (privado) no painel: Storage > New bucket. (%)', sqlerrm;
end $$;

do $$
begin
  drop policy if exists p_documentos_rw on storage.objects;
  create policy p_documentos_rw on storage.objects for all to authenticated
    using (bucket_id = 'documentos') with check (bucket_id = 'documentos');
exception when others then
  raise notice 'Crie a policy de storage para o bucket "documentos" no painel. (%)', sqlerrm;
end $$;

notify pgrst, 'reload schema';
-- ============================================================================

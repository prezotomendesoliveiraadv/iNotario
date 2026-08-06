-- ============================================================================
-- iNotário · Atendimento externo por IA (onboarding do cliente)
-- Pré-requisitos: schema.sql, acervo_portal_fix.sql e documentos_instrucao.sql.
-- ============================================================================

alter table public.solicitacoes add column if not exists origem text not null default 'interna';       -- interna | externa
alter table public.solicitacoes add column if not exists contato_nome text;
alter table public.solicitacoes add column if not exists contato_email text;
alter table public.solicitacoes add column if not exists contato_whatsapp text;
alter table public.solicitacoes add column if not exists intake jsonb;   -- descrição do objeto, empreendimento, endereço, construtora, pré-qualificação

create index if not exists idx_solic_origem on public.solicitacoes(origem);

-- garante o bucket de documentos (caso documentos_instrucao.sql não tenha rodado)
do $$
begin
  insert into storage.buckets (id, name, public) values ('documentos','documentos',false)
  on conflict (id) do nothing;
exception when others then null; end $$;

notify pgrst, 'reload schema';
-- ============================================================================

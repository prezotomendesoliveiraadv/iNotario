-- ============================================================================
-- iNotário · Fluxo inteligente do workflow (fila por usuário + log de alterações)
-- Pré-requisitos: workflow_interno.sql (papéis, complexidade, financeiro).
-- ============================================================================

-- Estado do fluxo na solicitação
alter table public.solicitacoes add column if not exists etapa text not null default 'elaboracao';
  -- elaboracao | financeiro | aprovacao | finalizacao | concluida
alter table public.solicitacoes add column if not exists responsavel_papel text not null default 'escrevente';
  -- papel que deve agir agora: escrevente | financeiro | tabeliao_substituto | tabeliao_oficial
alter table public.solicitacoes add column if not exists exigencia_atual text;
  -- quando devolvido, o que precisa ser corrigido

-- Fila por usuário: "minhas tarefas" = responsavel_papel = meu papel, no meu cartório
create index if not exists idx_solic_fila on public.solicitacoes(cartorio_id, responsavel_papel, etapa);

-- Log de alterações do fluxo (histórico completo, imutável em prática)
create table if not exists public.workflow_log (
  id             uuid primary key default gen_random_uuid(),
  solicitacao_id uuid not null references public.solicitacoes(id) on delete cascade,
  ator           uuid references auth.users(id) default auth.uid(),
  papel          text,
  acao           text not null,          -- classificado | financeiro_lancado | avancado | devolvido | finalizado
  de_etapa       text,
  para_etapa     text,
  exigencia      text,
  observacao     text,
  created_at     timestamptz not null default now()
);
create index if not exists idx_wf_log_solic on public.workflow_log(solicitacao_id, created_at);

alter table public.workflow_log enable row level security;
drop policy if exists p_wf_log_equipe on public.workflow_log;
create policy p_wf_log_equipe on public.workflow_log for all
  using (exists (select 1 from public.solicitacoes s where s.id = solicitacao_id and public.is_equipe(s.cartorio_id)))
  with check (exists (select 1 from public.solicitacoes s where s.id = solicitacao_id and public.is_equipe(s.cartorio_id)));

-- Inicializa a etapa/responsável das solicitações já existentes conforme o status atual
update public.solicitacoes set
  etapa = case status
            when 'concluida' then 'concluida'
            when 'aprovada'  then 'finalizacao'
            when 'em_revisao' then 'aprovacao'
            else 'elaboracao' end,
  responsavel_papel = case
            when status = 'concluida' then 'escrevente'
            when status = 'aprovada'  then 'escrevente'
            when status = 'em_revisao' and complexidade = 'alta'  then 'tabeliao_oficial'
            when status = 'em_revisao' and complexidade = 'media' then 'tabeliao_substituto'
            when status = 'em_revisao' then 'escrevente'
            else 'escrevente' end
where etapa is null or etapa = 'elaboracao';

notify pgrst, 'reload schema';
-- ============================================================================

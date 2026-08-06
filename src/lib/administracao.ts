// src/lib/administracao.ts
// Administração de usuários do cartório e fluxo de tarefas designadas.

import { supabase } from './supabase'
import { mensagemErroFuncao } from './erros'

// ---------------------------------------------------------------------------
// Níveis de acesso — alcance ADMINISTRATIVO (distinto da competência no fluxo)
// ---------------------------------------------------------------------------
export const NIVEIS = [
  { v: 1, nome: 'Consulta', desc: 'Vê os atos, não altera nada.' },
  { v: 2, nome: 'Operação', desc: 'Trabalha nos atos da sua competência.' },
  { v: 3, nome: 'Supervisão', desc: 'Acompanha a produção e os relatórios da equipe.' },
  { v: 4, nome: 'Administração', desc: 'Gerencia usuários, grupos e acessos do cartório.' },
] as const

export const PAPEIS_CARTORIO = [
  { v: 'escrevente', nome: 'Escrevente' },
  { v: 'conferente', nome: 'Conferente' },
  { v: 'financeiro', nome: 'Analista financeiro' },
  { v: 'tabeliao_substituto', nome: 'Tabelião substituto' },
  { v: 'tabeliao_oficial', nome: 'Tabelião oficial' },
  { v: 'admin_cartorio', nome: 'Administrador do cartório' },
] as const

export interface Grupo {
  id: string; nome: string; slug: string
  papel_padrao: string; nivel_padrao: number; descricao: string | null; ativo: boolean
}

export interface UsuarioCartorio {
  id: string; nome: string; email: string | null; papel: string
  grupo_id: string | null; nivel_acesso: number; acesso_ate: string | null; ativo: boolean
}

export async function listarGrupos(): Promise<Grupo[]> {
  const { data, error } = await supabase.from('grupos_usuarios')
    .select('*').eq('ativo', true).order('nome')
  if (error) throw new Error(error.message)
  return (data as Grupo[]) ?? []
}

export async function salvarGrupo(g: Partial<Grupo>): Promise<void> {
  if (g.id) {
    const { error } = await supabase.from('grupos_usuarios').update(g).eq('id', g.id)
    if (error) throw new Error(error.message)
  } else {
    const { data: u } = await supabase.auth.getUser()
    const { data: prof } = await supabase.from('profiles').select('cartorio_id').eq('id', u!.user!.id).maybeSingle()
    const { error } = await supabase.from('grupos_usuarios')
      .insert({ ...g, cartorio_id: (prof as any)?.cartorio_id, slug: g.slug ?? (g.nome ?? '').toLowerCase().replace(/\s+/g, '-') })
    if (error) throw new Error(error.message)
  }
}

export async function listarUsuarios(): Promise<UsuarioCartorio[]> {
  const { data: u } = await supabase.auth.getUser()
  const { data: prof } = await supabase.from('profiles').select('cartorio_id').eq('id', u!.user!.id).maybeSingle()
  const cid = (prof as any)?.cartorio_id
  if (!cid) return []
  const { data, error } = await supabase.from('profiles')
    .select('id, nome, email, papel, grupo_id, nivel_acesso, acesso_ate, ativo')
    .eq('cartorio_id', cid).order('nome')
  if (error) throw new Error(error.message)
  return ((data as any[]) ?? []).filter(p => !['cliente', 'construtora'].includes(p.papel)) as UsuarioCartorio[]
}

export async function criarUsuario(p: {
  nome: string; email: string; papel: string; grupoId?: string | null
  nivel: number; acessoAte?: string | null
}): Promise<{ email: string; senha: string | null; aviso?: string | null }> {
  const { data, error } = await supabase.functions.invoke('admin-usuarios', {
    body: { action: 'criar', ...p },
  })
  const msg = await mensagemErroFuncao(error, data, 'admin-usuarios')
  if (msg) throw new Error(msg)
  return data as any
}

export async function atualizarUsuario(userId: string, patch: Record<string, unknown>): Promise<void> {
  const { data, error } = await supabase.functions.invoke('admin-usuarios', {
    body: { action: 'atualizar', userId, ...patch },
  })
  const msg = await mensagemErroFuncao(error, data, 'admin-usuarios')
  if (msg) throw new Error(msg)
}

export async function novaSenhaUsuario(userId: string): Promise<{ senha: string }> {
  const { data, error } = await supabase.functions.invoke('admin-usuarios', {
    body: { action: 'senha', userId },
  })
  const msg = await mensagemErroFuncao(error, data, 'admin-usuarios')
  if (msg) throw new Error(msg)
  return data as any
}

/** Só o administrador da plataforma: libera o administrador de um cartório. */
export async function liberarAdminCartorio(
  cartorioId: string, nome: string, email: string,
): Promise<{ email: string; senha: string | null; aviso?: string | null }> {
  const { data, error } = await supabase.functions.invoke('admin-usuarios', {
    body: { action: 'liberar_admin_cartorio', cartorioId, nome, email },
  })
  const msg = await mensagemErroFuncao(error, data, 'admin-usuarios')
  if (msg) throw new Error(msg)
  return data as any
}

// ---------------------------------------------------------------------------
// TAREFAS
// ---------------------------------------------------------------------------
export interface Tarefa {
  id: string; titulo: string; descricao: string | null
  prazo: string | null; prioridade: string; status: string
  solicitacao_id: string | null; protocolo: string | null
  designada_por_nome: string | null; created_at: string
  dias_para_prazo: number | null
}

export interface MembroEquipe {
  id: string; nome: string; papel: string; grupo: string | null; nivel: number; vigente: boolean
}

export async function equipeDoCartorio(): Promise<MembroEquipe[]> {
  const { data, error } = await supabase.rpc('equipe_do_cartorio')
  if (error) throw new Error(error.message)
  return ((data as MembroEquipe[]) ?? []).filter(m => m.vigente)
}

export async function minhasTarefas(status: 'abertas' | 'todas' | 'concluida' = 'abertas'): Promise<Tarefa[]> {
  const { data, error } = await supabase.rpc('minhas_tarefas', { p_status: status })
  if (error) throw new Error(error.message)
  return (data as Tarefa[]) ?? []
}

export async function tarefasDoAto(solicitacaoId: string): Promise<any[]> {
  const { data } = await supabase.from('tarefas')
    .select('id, titulo, descricao, prazo, prioridade, status, designada_para, designada_por, concluida_em, resultado, created_at')
    .eq('solicitacao_id', solicitacaoId).order('created_at', { ascending: false })
  return (data as any[]) ?? []
}

export async function criarTarefa(p: {
  para: string; titulo: string; descricao?: string
  solicitacaoId?: string | null; prazo?: string | null; prioridade?: string
}): Promise<{ ok: boolean; erro?: string; tarefa_id?: string }> {
  const { data, error } = await supabase.rpc('criar_tarefa', {
    p_para: p.para, p_titulo: p.titulo, p_descricao: p.descricao ?? null,
    p_solicitacao: p.solicitacaoId ?? null, p_prazo: p.prazo ?? null,
    p_prioridade: p.prioridade ?? 'normal',
  })
  if (error) throw new Error(error.message)
  return (data as any) ?? { ok: false }
}

/** Conclui e, se indicado, já designa o próximo do fluxo. */
export async function concluirTarefa(p: {
  tarefaId: string; resultado?: string
  proximo?: string | null; proximoTitulo?: string; proximoPrazo?: string | null; proximoDescricao?: string
}): Promise<{ ok: boolean; erro?: string }> {
  const { data, error } = await supabase.rpc('concluir_tarefa', {
    p_tarefa: p.tarefaId, p_resultado: p.resultado ?? null,
    p_proximo: p.proximo ?? null, p_proximo_titulo: p.proximoTitulo ?? null,
    p_proximo_prazo: p.proximoPrazo ?? null, p_proximo_descricao: p.proximoDescricao ?? null,
  })
  if (error) throw new Error(error.message)
  return (data as any) ?? { ok: false }
}

export async function reatribuirTarefa(tarefaId: string, para: string, observacao?: string): Promise<void> {
  const { data, error } = await supabase.rpc('reatribuir_tarefa', {
    p_tarefa: tarefaId, p_para: para, p_observacao: observacao ?? null,
  })
  if (error) throw new Error(error.message)
  if (!(data as any)?.ok) throw new Error((data as any)?.erro ?? 'Falha ao reatribuir.')
}

export async function historicoTarefa(tarefaId: string): Promise<any[]> {
  const { data } = await supabase.from('tarefa_eventos')
    .select('id, ator_nome, acao, observacao, created_at')
    .eq('tarefa_id', tarefaId).order('created_at', { ascending: false })
  return (data as any[]) ?? []
}

// ---------------------------------------------------------------------------
// Diagnóstico do WhatsApp
// ---------------------------------------------------------------------------
export interface DiagnosticoWpp {
  ok: boolean
  achados: { item: string; ok: boolean; detalhe: string }[]
  conclusao: string
}

export async function diagnosticarWhatsapp(): Promise<DiagnosticoWpp> {
  const { data, error } = await supabase.functions.invoke('whatsapp-enviar', {
    body: { action: 'diagnostico' },
  })
  const msg = await mensagemErroFuncao(error, data, 'whatsapp-enviar')
  if (msg) throw new Error(msg)
  return data as DiagnosticoWpp
}

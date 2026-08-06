// src/lib/construtoraPortal.ts
// Fluxo de validação jurídica da construtora e agendamento da assinatura.
//
// A validação é um GATE ORTOGONAL ao fluxo interno — mesma mecânica do
// financeiro: não é uma nova etapa do cartório, é a liberação de um terceiro
// que precisa acontecer antes da finalização.

import { supabase } from './supabase'
import { mensagemErroFuncao } from './erros'

export type ValidacaoStatus =
  | 'nao_aplicavel' | 'pendente' | 'enviada' | 'aprovada' | 'ressalvas' | 'reprovada'

export const VALIDACAO_LABEL: Record<ValidacaoStatus, string> = {
  nao_aplicavel: 'não se aplica',
  pendente: 'a enviar',
  enviada: 'em análise pela construtora',
  aprovada: 'aprovada',
  ressalvas: 'devolvida com ressalvas',
  reprovada: 'reprovada',
}

export const VALIDACAO_COR: Record<ValidacaoStatus, string> = {
  nao_aplicavel: '#7C8698',
  pendente: '#7C8698',
  enviada: '#1E3a63',
  aprovada: '#1E7A4F',
  ressalvas: '#A9761B',
  reprovada: '#B3261E',
}

// ---------------------------------------------------------------------------
// Cartório → construtora
// ---------------------------------------------------------------------------
export async function enviarParaConstrutora(
  solicitacaoId: string, observacoes?: string,
): Promise<{ ok: boolean; erro?: string; rodada?: number }> {
  const { data, error } = await supabase.rpc('enviar_para_construtora', {
    p_solicitacao: solicitacaoId, p_observacoes: observacoes ?? null,
  })
  if (error) throw new Error(error.message)
  return (data as any) ?? { ok: false }
}

// ---------------------------------------------------------------------------
// Jurídico da construtora decide
// ---------------------------------------------------------------------------
export async function decidirValidacao(
  solicitacaoId: string, decisao: 'aprovada' | 'ressalvas' | 'reprovada',
  observacoes?: string, autorNome?: string,
): Promise<{ ok: boolean; erro?: string }> {
  const { data, error } = await supabase.rpc('decidir_validacao_construtora', {
    p_solicitacao: solicitacaoId, p_decisao: decisao,
    p_observacoes: observacoes ?? null, p_autor_nome: autorNome ?? null,
  })
  if (error) throw new Error(error.message)
  return (data as any) ?? { ok: false }
}

// ---------------------------------------------------------------------------
// Agendamento da assinatura (cartório, após aprovação)
// ---------------------------------------------------------------------------
export async function agendarAssinatura(
  solicitacaoId: string, quandoISO: string, local?: string,
): Promise<{ ok: boolean; erro?: string; status?: string }> {
  const { data, error } = await supabase.rpc('agendar_assinatura', {
    p_solicitacao: solicitacaoId, p_quando: quandoISO, p_local: local ?? null,
  })
  if (error) throw new Error(error.message)
  return (data as any) ?? { ok: false }
}

// ---------------------------------------------------------------------------
// Histórico de validação (visível ao cartório e à construtora)
// ---------------------------------------------------------------------------
export interface RodadaValidacao {
  id: string; rodada: number; acao: string
  observacoes: string | null; autor_nome: string | null; created_at: string
}

export async function historicoValidacao(solicitacaoId: string): Promise<RodadaValidacao[]> {
  const { data } = await supabase.from('validacoes_construtora')
    .select('id, rodada, acao, observacoes, autor_nome, created_at')
    .eq('solicitacao_id', solicitacaoId).order('created_at', { ascending: false })
  return (data as RodadaValidacao[]) ?? []
}

// ---------------------------------------------------------------------------
// Painel interno (por construtora / empreendimento)
// ---------------------------------------------------------------------------
export interface LinhaPainelInterno {
  construtora_id: string; construtora: string
  empreendimento_id: string; empreendimento: string; total_unidades: number | null
  atos_total: number; em_elaboracao: number; aguardando_construtora: number
  com_ressalvas: number; aprovadas: number; agendadas: number; concluidas: number
  proxima_assinatura: string | null
}

export async function painelInterno(construtoraId?: string): Promise<LinhaPainelInterno[]> {
  const { data: u } = await supabase.auth.getUser()
  if (!u?.user) return []
  const { data: prof } = await supabase.from('profiles').select('cartorio_id').eq('id', u.user.id).maybeSingle()
  const cartorioId = (prof as any)?.cartorio_id
  if (!cartorioId) return []
  const { data, error } = await supabase.rpc('painel_construtoras', {
    p_cartorio: cartorioId, p_construtora: construtoraId ?? null,
  })
  if (error) throw new Error(error.message)
  return (data as LinhaPainelInterno[]) ?? []
}

// ---------------------------------------------------------------------------
// Painel da construtora (portal externo)
// ---------------------------------------------------------------------------
export interface LinhaPainelConstrutora {
  solicitacao_id: string; protocolo: string; empreendimento: string; unidade: string | null
  comprador: string | null; etapa: string; validacao: ValidacaoStatus
  minuta_versao: number | null
  enviada_em: string | null; decidida_em: string | null
  assinatura_em: string | null; assinatura_local: string | null; assinatura_status: string
}

/** Construtoras às quais o usuário logado está vinculado (normalmente uma). */
export async function minhasConstrutoras(): Promise<{ id: string; razao_social: string; papel: string }[]> {
  const { data } = await supabase.from('construtora_usuarios')
    .select('construtora_id, papel_construtora, construtoras(razao_social)')
    .eq('ativo', true)
  return ((data as any[]) ?? []).map(r => ({
    id: r.construtora_id,
    razao_social: r.construtoras?.razao_social ?? '',
    papel: r.papel_construtora,
  }))
}

export async function painelConstrutora(construtoraId: string): Promise<LinhaPainelConstrutora[]> {
  const { data, error } = await supabase.rpc('painel_da_construtora', { p_construtora: construtoraId })
  if (error) throw new Error(error.message)
  return (data as LinhaPainelConstrutora[]) ?? []
}

/** Minuta mais recente do ato — a construtora lê, não edita. */
export async function minutaDoAto(solicitacaoId: string): Promise<{ conteudo: string; versao: number } | null> {
  const { data } = await supabase.from('minutas')
    .select('conteudo, versao').eq('solicitacao_id', solicitacaoId)
    .order('versao', { ascending: false }).limit(1).maybeSingle()
  return (data as any) ?? null
}

// ---------------------------------------------------------------------------
// Vínculo de usuários da construtora (administrado pelo cartório)
// ---------------------------------------------------------------------------
export interface UsuarioConstrutora {
  id: string; construtora_id: string; user_id: string
  nome: string | null; email: string | null; papel_construtora: string; ativo: boolean
}

export async function usuariosDaConstrutora(construtoraId: string): Promise<UsuarioConstrutora[]> {
  const { data } = await supabase.from('construtora_usuarios')
    .select('*').eq('construtora_id', construtoraId).order('nome')
  return (data as UsuarioConstrutora[]) ?? []
}

/** Cria o usuário no Auth (sem cartório) e vincula à construtora. */
export async function criarAcessoConstrutora(
  construtoraId: string, nome: string, email: string, papel: 'juridico' | 'gestor',
): Promise<{ email: string; senha: string | null; aviso?: string | null }> {
  const { data, error } = await supabase.functions.invoke('construtora-acesso', {
    body: { action: 'criar', construtoraId, nome, email, papel },
  })
  const msg = await mensagemErroFuncao(error, data, 'construtora-acesso')
  if (msg) throw new Error(msg)
  return data as any
}

export async function redefinirSenhaAcesso(
  construtoraId: string, userId: string,
): Promise<{ senha: string }> {
  const { data, error } = await supabase.functions.invoke('construtora-acesso', {
    body: { action: 'senha', construtoraId, userId },
  })
  const msg = await mensagemErroFuncao(error, data, 'construtora-acesso')
  if (msg) throw new Error(msg)
  return data as any
}

export async function desvincularUsuario(construtoraId: string, id: string): Promise<void> {
  const { data, error } = await supabase.functions.invoke('construtora-acesso', {
    body: { action: 'desvincular', construtoraId, id },
  })
  const msg = await mensagemErroFuncao(error, data, 'construtora-acesso')
  if (msg) throw new Error(msg)
}

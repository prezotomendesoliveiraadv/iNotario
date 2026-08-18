// src/lib/incorporacao.ts
// Construtoras, empreendimentos, cláusulas especiais e controle de vigência.

import { supabase } from './supabase'

/** Leitura por IA do contrato social (ou, na falta dele, do modelo de escritura). */
export interface RepresentanteLido {
  nome: string; cpf?: string; rg?: string; nacionalidade?: string
  estado_civil?: string; profissao?: string; endereco?: string; cargo?: string
  poderes_forma?: 'isolada' | 'conjunta' | 'conjunta_com_outro' | string
  restricoes?: string
}
export interface LeituraContratoSocial {
  representantes: RepresentanteLido[]
  poderes?: {
    forma?: string; quorum?: string; limite_valor?: string
    restricoes?: string[]; exige_anuencia?: boolean; observacao?: string
  }
  empresa?: { razao_social?: string; cnpj?: string; nire?: string; data_arquivamento?: string; junta?: string }
  alteracao_mais_recente?: string
  fonte: 'contrato_social' | 'modelo_escritura'
  confianca?: 'alta' | 'media' | 'baixa'
  lido_em?: string
}
import { mensagemErroFuncao } from './erros'

// ---------------------------------------------------------------------------
// Construtoras e representantes
// ---------------------------------------------------------------------------
export interface Construtora {
  id: string
  cartorio_id?: string
  razao_social: string
  nome_fantasia: string | null
  cnpj: string | null
  endereco: string | null
  contrato_social_path: string | null
  contrato_social_nome: string | null
  contrato_social_lido?: LeituraContratoSocial | null
  contrato_social_lido_em?: string | null
  modelo_escritura: string | null
  modelo_acervo_id: string | null
  observacoes: string | null
  ativo: boolean
}

export interface Representante {
  id?: string
  construtora_id?: string
  nome: string
  cpf: string | null
  rg: string | null
  nacionalidade: string | null
  estado_civil: string | null
  regime_bens: string | null
  profissao: string | null
  endereco: string | null
  email: string | null
  telefone: string | null
  cargo: string | null
  procuracao_path: string | null
  procuracao_nome: string | null
  procuracao_lavrada_em: string | null
  procuracao_validade: string | null
  procuracao_poderes: string | null
  ativo: boolean
}

export interface Certidao {
  id?: string
  construtora_id?: string
  tipo: string
  numero: string | null
  emitida_em: string | null
  validade: string | null
  storage_path: string | null
  nome_arquivo: string | null
  observacao: string | null
}

export interface Empreendimento {
  id: string
  cartorio_id?: string
  construtora_id: string
  nome: string
  endereco: string | null
  cidade: string | null
  uf: string | null
  matricula_mae: string | null
  cartorio_ri: string | null
  registro_incorporacao: string | null
  total_unidades: number | null
  modelo_escritura: string | null
  modelo_acervo_id: string | null
  ativo: boolean
}

export async function listarConstrutoras(): Promise<Construtora[]> {
  const { data, error } = await supabase.from('construtoras')
    .select('*').order('razao_social')
  if (error) throw new Error(error.message)
  return (data as Construtora[]) ?? []
}

export async function salvarConstrutora(c: Partial<Construtora>): Promise<Construtora> {
  if (c.id) {
    const { data, error } = await supabase.from('construtoras')
      .update({ ...c, updated_at: new Date().toISOString() }).eq('id', c.id).select('*').single()
    if (error) throw new Error(error.message)
    return data as Construtora
  }
  const { data: u } = await supabase.auth.getUser()
  const { data: prof } = await supabase.from('profiles').select('cartorio_id').eq('id', u!.user!.id).maybeSingle()
  const { data, error } = await supabase.from('construtoras')
    .insert({ ...c, cartorio_id: (prof as any)?.cartorio_id }).select('*').single()
  if (error) throw new Error(error.message)
  return data as Construtora
}

/**
 * Manda a IA ler o contrato social da construtora. Sem contrato social anexado,
 * cai no modelo de escritura do cadastro — que é fonte secundária e volta
 * marcada como tal.
 */
export async function lerContratoSocial(construtoraId: string): Promise<{
  fonte: 'contrato_social' | 'modelo_escritura'; leitura: LeituraContratoSocial
}> {
  const { data, error } = await supabase.functions.invoke('artemis-extract', {
    body: { acao: 'contrato_social', construtoraId },
  })
  const msg = await mensagemErroFuncao(error, data, 'artemis-extract')
  if (msg) throw new Error(msg)
  return data as any
}

/** Cria os representantes lidos que ainda não existem (compara por CPF, senão por nome). */
export async function importarRepresentantes(
  construtoraId: string, lidos: RepresentanteLido[], fonte: string,
): Promise<number> {
  const existentes = await listarRepresentantes(construtoraId)
  const chave = (n?: string, c?: string) =>
    (c ?? '').replace(/\D/g, '') || (n ?? '').trim().toLowerCase()
  const jaTem = new Set(existentes.map(r => chave(r.nome, (r as any).cpf)))

  const novos = lidos.filter(r => r.nome?.trim() && !jaTem.has(chave(r.nome, r.cpf)))
  if (!novos.length) return 0

  const { error } = await supabase.from('construtora_representantes').insert(
    novos.map(r => ({
      construtora_id: construtoraId,
      nome: r.nome.trim(), cpf: r.cpf || null, rg: r.rg || null,
      nacionalidade: r.nacionalidade || null, estado_civil: r.estado_civil || null,
      profissao: r.profissao || null, endereco: r.endereco || null, cargo: r.cargo || null,
      poderes_forma: r.poderes_forma || null,
      origem: fonte === 'contrato_social' ? 'contrato_social' : 'modelo_escritura',
    })),
  )
  if (error) throw error
  return novos.length
}

export async function listarRepresentantes(construtoraId: string): Promise<Representante[]> {
  const { data } = await supabase.from('construtora_representantes')
    .select('*').eq('construtora_id', construtoraId).order('nome')
  return (data as Representante[]) ?? []
}

export async function salvarRepresentante(r: Partial<Representante>): Promise<void> {
  if (r.id) {
    const { error } = await supabase.from('construtora_representantes').update(r).eq('id', r.id)
    if (error) throw new Error(error.message)
  } else {
    const { error } = await supabase.from('construtora_representantes').insert(r)
    if (error) throw new Error(error.message)
  }
}

export async function removerRepresentante(id: string): Promise<void> {
  const { error } = await supabase.from('construtora_representantes').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

export async function listarCertidoes(construtoraId: string): Promise<Certidao[]> {
  const { data } = await supabase.from('construtora_certidoes')
    .select('*').eq('construtora_id', construtoraId).order('validade', { ascending: true })
  return (data as Certidao[]) ?? []
}

export async function salvarCertidao(c: Partial<Certidao>): Promise<void> {
  if (c.id) {
    const { error } = await supabase.from('construtora_certidoes').update(c).eq('id', c.id)
    if (error) throw new Error(error.message)
  } else {
    const { error } = await supabase.from('construtora_certidoes').insert(c)
    if (error) throw new Error(error.message)
  }
}

export async function removerCertidao(id: string): Promise<void> {
  const { error } = await supabase.from('construtora_certidoes').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

// ---------------------------------------------------------------------------
// Empreendimentos
// ---------------------------------------------------------------------------
export async function listarEmpreendimentos(construtoraId?: string): Promise<Empreendimento[]> {
  let q = supabase.from('empreendimentos').select('*').order('nome')
  if (construtoraId) q = q.eq('construtora_id', construtoraId)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return (data as Empreendimento[]) ?? []
}

export async function salvarEmpreendimento(e: Partial<Empreendimento>): Promise<void> {
  if (e.id) {
    const { error } = await supabase.from('empreendimentos').update(e).eq('id', e.id)
    if (error) throw new Error(error.message)
  } else {
    const { data: u } = await supabase.auth.getUser()
    const { data: prof } = await supabase.from('profiles').select('cartorio_id').eq('id', u!.user!.id).maybeSingle()
    const { error } = await supabase.from('empreendimentos')
      .insert({ ...e, cartorio_id: (prof as any)?.cartorio_id })
    if (error) throw new Error(error.message)
  }
}

/** Unidade já tem protocolo aberto? (alerta de duplicidade) */
export interface UsoUnidade { id: string; protocolo: string; status: string; etapa: string; criado_em: string }
export async function unidadeEmUso(empreendimentoId: string, unidade: string): Promise<UsoUnidade[]> {
  const { data, error } = await supabase.rpc('unidade_em_uso', {
    p_empreendimento: empreendimentoId, p_unidade: unidade,
  })
  if (error) throw new Error(error.message)
  return (data as UsoUnidade[]) ?? []
}

/** Vincula o ato ao empreendimento/unidade e qualifica a vendedora pelo cadastro. */
export async function vincularEmpreendimento(
  solicitacaoId: string, empreendimentoId: string, unidade: string,
): Promise<{ construtora?: string; representante?: string }> {
  const { error } = await supabase.from('solicitacoes')
    .update({ empreendimento_id: empreendimentoId, unidade: unidade || null })
    .eq('id', solicitacaoId)
  if (error) throw new Error(error.message)
  const { data, error: e2 } = await supabase.rpc('aplicar_vendedor_construtora', {
    p_solicitacao: solicitacaoId, p_papel: 'Outorgante Vendedor',
  })
  if (e2) throw new Error(e2.message)
  return (data as any) ?? {}
}

// ---------------------------------------------------------------------------
// Cláusulas especiais
// ---------------------------------------------------------------------------
export interface Clausula {
  id: string
  nome: string
  slug: string | null
  categoria: string | null
  texto: string
  fundamento: string | null
  orientacao: string | null
  tipos_ato: string[]
  ativo: boolean
}

export async function listarClausulas(tipoAtoSlug?: string | null): Promise<Clausula[]> {
  const { data, error } = await supabase.from('clausulas_especiais')
    .select('*').eq('ativo', true).order('nome')
  if (error) throw new Error(error.message)
  const todas = (data as Clausula[]) ?? []
  if (!tipoAtoSlug) return todas
  // sem tipos_ato = vale para todos
  return todas.filter(c => !c.tipos_ato?.length || c.tipos_ato.includes(tipoAtoSlug))
}

export async function salvarClausula(c: Partial<Clausula>): Promise<void> {
  if (c.id) {
    const { error } = await supabase.from('clausulas_especiais').update(c).eq('id', c.id)
    if (error) throw new Error(error.message)
  } else {
    const { data: u } = await supabase.auth.getUser()
    const { data: prof } = await supabase.from('profiles').select('cartorio_id').eq('id', u!.user!.id).maybeSingle()
    const { error } = await supabase.from('clausulas_especiais')
      .insert({ ...c, cartorio_id: (prof as any)?.cartorio_id })
    if (error) throw new Error(error.message)
  }
}

export interface ClausulaDoAto { id: string; clausula_id: string | null; nome: string; texto: string; ordem: number }

export async function clausulasDoAto(solicitacaoId: string): Promise<ClausulaDoAto[]> {
  const { data } = await supabase.from('solicitacao_clausulas')
    .select('id, clausula_id, nome, texto, ordem').eq('solicitacao_id', solicitacaoId).order('ordem')
  return (data as ClausulaDoAto[]) ?? []
}

export async function inserirClausulaNoAto(
  solicitacaoId: string, c: { clausula_id?: string; nome: string; texto: string; ordem?: number },
): Promise<void> {
  const { error } = await supabase.from('solicitacao_clausulas').insert({
    solicitacao_id: solicitacaoId, clausula_id: c.clausula_id ?? null,
    nome: c.nome, texto: c.texto, ordem: c.ordem ?? 0,
  })
  if (error) throw new Error(error.message)
}

export async function removerClausulaDoAto(id: string): Promise<void> {
  const { error } = await supabase.from('solicitacao_clausulas').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

// ---------------------------------------------------------------------------
// Vigência de certidões e procurações
// ---------------------------------------------------------------------------
export interface Vencimento {
  origem: 'documento' | 'procuracao' | 'certidao_construtora'
  descricao: string
  validade: string
  dias_restantes: number
  situacao: 'vencido' | 'vence_em_breve' | 'vigente'
}

export const JANELA_ALERTA_DIAS = 10

export async function vencimentosDoAto(solicitacaoId: string): Promise<Vencimento[]> {
  const { data, error } = await supabase.rpc('vencimentos_solicitacao', {
    p_solicitacao: solicitacaoId, p_janela_dias: JANELA_ALERTA_DIAS,
  })
  if (error) throw new Error(error.message)
  return (data as Vencimento[]) ?? []
}

export const COR_SITUACAO: Record<Vencimento['situacao'], string> = {
  vencido: '#B3261E', vence_em_breve: '#A9761B', vigente: '#1E7A4F',
}
export const LABEL_SITUACAO: Record<Vencimento['situacao'], string> = {
  vencido: 'vencido', vence_em_breve: 'vence em breve', vigente: 'vigente',
}
export const LABEL_ORIGEM: Record<Vencimento['origem'], string> = {
  documento: 'Documento do ato', procuracao: 'Procuração', certidao_construtora: 'Certidão da construtora',
}

// ---------------------------------------------------------------------------
// Assistente de minuta: recompilar e analisar ressalvas
// ---------------------------------------------------------------------------
export interface Ajuste {
  ressalva: string; trecho_atual: string; texto_sugerido: string; justificativa: string
}
export interface Objecao { ressalva: string; motivo: string; alternativa: string }
export interface AnaliseRessalvas {
  minuta_versao: number
  ajustes: Ajuste[]; objecoes: Objecao[]; duvidas: string[]; resumo: string
  ressalvas_consideradas: string[]
}

export async function recompilarMinuta(solicitacaoId: string): Promise<{
  versao: number; minuta: string; alertas: string[]; placeholders: string[]; modelo_fonte: string | null
}> {
  const { data, error } = await supabase.functions.invoke('minuta-assistente', {
    body: { action: 'recompilar', solicitacaoId },
  })
  const msg = await mensagemErroFuncao(error, data, 'minuta-assistente')
  if (msg) throw new Error(msg)
  return data as any
}

export async function analisarRessalvas(
  solicitacaoId: string, observacoes?: string,
): Promise<AnaliseRessalvas> {
  const { data, error } = await supabase.functions.invoke('minuta-assistente', {
    body: { action: 'analisar_ressalvas', solicitacaoId, observacoes },
  })
  const msg = await mensagemErroFuncao(error, data, 'minuta-assistente')
  if (msg) throw new Error(msg)
  return data as AnaliseRessalvas
}

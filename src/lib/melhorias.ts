// src/lib/melhorias.ts
// Partes múltiplas, busca interna, consulta jurídica e acionamento por WhatsApp.

import { supabase } from './supabase'
import { mensagemErroFuncao } from './erros'

// ---------------------------------------------------------------------------
// PARTES (um ato pode ter N partes por papel)
// ---------------------------------------------------------------------------
export interface ParteRow {
  id?: string
  solicitacao_id?: string
  papel: string
  nome: string
  cpf_cnpj: string | null
  dados: Record<string, any>
  ordem: number
}

export const CAMPOS_PARTE = [
  { k: 'estado_civil', label: 'Estado civil', tipo: 'select',
    opcoes: ['solteiro(a)', 'casado(a)', 'divorciado(a)', 'viúvo(a)', 'união estável'] },
  { k: 'regime_bens', label: 'Regime de bens', tipo: 'select',
    opcoes: ['comunhão parcial', 'comunhão universal', 'separação total', 'separação obrigatória', 'participação final nos aquestos'] },
  { k: 'profissao', label: 'Profissão', tipo: 'text' },
  { k: 'rg', label: 'RG / órgão', tipo: 'text' },
  { k: 'endereco', label: 'Endereço', tipo: 'text' },
  { k: 'email', label: 'E-mail', tipo: 'text' },
] as const

export async function listarPartes(solicitacaoId: string): Promise<ParteRow[]> {
  const { data } = await supabase.from('partes')
    .select('id, solicitacao_id, papel, nome, cpf_cnpj, dados, ordem')
    .eq('solicitacao_id', solicitacaoId)
    .order('ordem', { ascending: true }).order('created_at', { ascending: true })
  return ((data as any[]) ?? []).map(p => ({ ...p, dados: p.dados ?? {} }))
}

export async function salvarPartes(solicitacaoId: string, partes: ParteRow[]): Promise<void> {
  const atuais = await listarPartes(solicitacaoId)
  const idsMantidos = new Set(partes.filter(p => p.id).map(p => p.id))
  const remover = atuais.filter(a => a.id && !idsMantidos.has(a.id)).map(a => a.id!)
  if (remover.length) {
    const { error } = await supabase.from('partes').delete().in('id', remover)
    if (error) throw error
  }
  for (const [i, p] of partes.entries()) {
    const linha = {
      solicitacao_id: solicitacaoId, papel: p.papel.trim(), nome: p.nome.trim(),
      cpf_cnpj: p.cpf_cnpj?.trim() || null, dados: p.dados ?? {}, ordem: i,
    }
    if (p.id) {
      const { error } = await supabase.from('partes').update(linha).eq('id', p.id)
      if (error) throw error
    } else {
      const { error } = await supabase.from('partes').insert(linha)
      if (error) throw error
    }
  }
}

/** Agrupa por papel preservando a ordem de aparição. */
export function agruparPorPapel(partes: ParteRow[]): { papel: string; itens: ParteRow[] }[] {
  const ordem: string[] = []
  const mapa = new Map<string, ParteRow[]>()
  for (const p of partes) {
    if (!mapa.has(p.papel)) { mapa.set(p.papel, []); ordem.push(p.papel) }
    mapa.get(p.papel)!.push(p)
  }
  return ordem.map(papel => ({ papel, itens: mapa.get(papel)! }))
}

// ---------------------------------------------------------------------------
// BUSCA INTERNA (protocolo · nome de parte · CPF · status)
// ---------------------------------------------------------------------------
export interface ResultadoBusca {
  id: string; protocolo: string | null; titulo: string | null; status: string
  etapa: string; responsavel_papel: string; complexidade: string | null
  exigencia_atual: string | null; tipo_nome: string | null; partes_nomes: string | null
  created_at: string; updated_at: string
}

/** Identifica o que o usuário digitou — para dar retorno claro na interface. */
export function tipoDoTermo(termo: string): 'protocolo' | 'cpf' | 'nome' | 'vazio' {
  const t = termo.trim()
  if (!t) return 'vazio'
  if (/^\d{4}\/?\d{0,6}$/.test(t) || /^\d+\/\d+$/.test(t)) return 'protocolo'
  const so = t.replace(/\D/g, '')
  if (so.length >= 6 && so.length <= 14 && /^[\d.\-/\s]+$/.test(t)) return 'cpf'
  return 'nome'
}

export async function buscarSolicitacoes(
  termo: string, status?: string, limite = 50,
): Promise<ResultadoBusca[]> {
  const { data: u } = await supabase.auth.getUser()
  if (!u?.user) return []
  const { data: prof } = await supabase.from('profiles').select('cartorio_id').eq('id', u.user.id).maybeSingle()
  const cartorioId = (prof as any)?.cartorio_id
  if (!cartorioId) return []
  const { data, error } = await supabase.rpc('buscar_solicitacoes', {
    p_cartorio: cartorioId, p_termo: termo || null, p_status: status || null, p_limite: limite,
  })
  if (error) throw new Error(error.message)
  return (data as ResultadoBusca[]) ?? []
}

// ---------------------------------------------------------------------------
// CONSULTA JURÍDICA
// ---------------------------------------------------------------------------
export interface Fundamento { norma: string; dispositivo: string; aplicacao: string }
export interface FonteAcervo { id: string | null; titulo: string; categoria: string | null; como_usado?: string | null }
export interface Parecer {
  id?: string | null
  pergunta: string
  parecer: string
  fundamentos: Fundamento[]
  fontes_acervo: FonteAcervo[]
  divergencias?: string
  ressalvas?: string
  created_at?: string
  acervo_consultado?: { indice: number; id: string; titulo: string; categoria: string }[]
}

export async function consultarJuridico(p: { pergunta?: string; solicitacaoId?: string }): Promise<Parecer> {
  const { data, error } = await supabase.functions.invoke('consulta-juridica', { body: p })
  const msg = await mensagemErroFuncao(error, data, 'consulta-juridica')
  if (msg) throw new Error(msg)
  return data as Parecer
}

export async function historicoConsultas(solicitacaoId?: string, limite = 20): Promise<Parecer[]> {
  let q = supabase.from('consultas_juridicas')
    .select('id, pergunta, parecer, fundamentos, fontes_acervo, ressalvas, created_at, solicitacao_id')
    .order('created_at', { ascending: false }).limit(limite)
  if (solicitacaoId) q = q.eq('solicitacao_id', solicitacaoId)
  const { data } = await q
  return ((data as any[]) ?? []) as Parecer[]
}

// ---------------------------------------------------------------------------
// WHATSAPP — acionar o cliente pela API oficial
// ---------------------------------------------------------------------------
export async function whatsappMensagem(solicitacaoId: string, texto: string): Promise<void> {
  const { data, error } = await supabase.functions.invoke('whatsapp-enviar', {
    body: { solicitacaoId, texto },
  })
  const msg = await mensagemErroFuncao(error, data, 'whatsapp-enviar')
  if (msg) throw new Error(msg)
}

export function formatarWhatsapp(v: string): string {
  const d = (v || '').replace(/\D/g, '').slice(0, 11)
  if (d.length <= 2) return d
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
}

// ---------------------------------------------------------------------------
// ACERVO — modelo padrão por tipo de ato
// ---------------------------------------------------------------------------
export async function definirModeloPadrao(acervoId: string, padrao: boolean): Promise<void> {
  const { error } = await supabase.from('acervo').update({ padrao }).eq('id', acervoId)
  if (error) throw new Error(error.message)
}

export interface ModeloAcervo {
  id: string; titulo: string; tipo_ato_slug: string | null; padrao: boolean
  conteudo_texto: string | null; descricao: string | null
}

/** Modelos aplicáveis a um tipo de ato: o padrão primeiro, depois os demais. */
export async function modelosDoTipo(tipoAtoSlug?: string | null): Promise<ModeloAcervo[]> {
  let q = supabase.from('acervo')
    .select('id, titulo, tipo_ato_slug, padrao, conteudo_texto, descricao')
    .eq('categoria', 'modelo')
  if (tipoAtoSlug) q = q.or(`tipo_ato_slug.eq.${tipoAtoSlug},tipo_ato_slug.is.null`)
  const { data } = await q.order('padrao', { ascending: false }).order('titulo')
  const itens = ((data as any[]) ?? []) as ModeloAcervo[]
  // específicos do tipo antes dos genéricos
  return itens.sort((a, b) => {
    if (a.padrao !== b.padrao) return a.padrao ? -1 : 1
    const ea = a.tipo_ato_slug === tipoAtoSlug ? 0 : 1
    const eb = b.tipo_ato_slug === tipoAtoSlug ? 0 : 1
    return ea - eb
  })
}

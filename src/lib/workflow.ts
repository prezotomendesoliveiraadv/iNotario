import { supabase } from './supabase'
import { mensagemErroFuncao } from './erros'

// ---------- papéis, etapas e competência (espelha _shared/workflow.ts) ----------
export type Papel = 'escrevente' | 'tabeliao_substituto' | 'financeiro' | 'tabeliao_oficial' | 'tabeliao' | 'cliente'
export type Complexidade = 'baixa' | 'media' | 'alta'
export type Etapa = 'elaboracao' | 'financeiro' | 'aprovacao' | 'finalizacao' | 'concluida'

export const APROVADOR_LABEL: Record<string, string> = { baixa: 'Escrevente', media: 'Tabelião Substituto', alta: 'Tabelião Oficial' }
export const PAPEL_LABEL: Record<string, string> = {
  escrevente: 'Escrevente', tabeliao_substituto: 'Tabelião Substituto', financeiro: 'Financeiro',
  tabeliao_oficial: 'Tabelião Oficial', tabeliao: 'Tabelião Oficial', admin_plataforma: 'Admin da plataforma', cliente: 'Cliente',
}
export const ETAPA_LABEL: Record<string, string> = {
  elaboracao: 'Elaboração', financeiro: 'Financeiro', aprovacao: 'Aprovação', finalizacao: 'Finalização', concluida: 'Concluída',
}
export const ETAPAS_ORDEM: Etapa[] = ['elaboracao', 'financeiro', 'aprovacao', 'finalizacao', 'concluida']

export function rankAprovacao(p: string): number {
  if (p === 'escrevente') return 1
  if (p === 'tabeliao_substituto') return 2
  if (p === 'tabeliao_oficial' || p === 'tabeliao') return 3
  return 0
}
export function rankExigido(c?: string | null): number {
  return c === 'baixa' ? 1 : c === 'media' ? 2 : c === 'alta' ? 3 : 99
}
export function aprovadorPorComplexidade(c?: string | null): string {
  return c === 'alta' ? 'tabeliao_oficial' : c === 'media' ? 'tabeliao_substituto' : 'escrevente'
}
export function podeAgir(papel: string, etapa: string, responsavelPapel: string, complexidade?: string | null): boolean {
  if (papel === 'tabeliao_oficial' || papel === 'tabeliao') return true
  if (etapa === 'aprovacao') { const r = rankAprovacao(papel); return r > 0 && r >= rankExigido(complexidade) }
  return papel === responsavelPapel
}
export function podeFinanceiro(papel: string): boolean {
  return papel === 'financeiro' || papel === 'tabeliao_oficial' || papel === 'tabeliao'
}

export async function meuPapel(): Promise<string> {
  const { data: u } = await supabase.auth.getUser()
  if (!u?.user) return 'cliente'
  const { data } = await supabase.from('profiles').select('papel').eq('id', u.user.id).maybeSingle()
  return (data as any)?.papel ?? 'cliente'
}

// ---------- ações de workflow (função com enforcement) ----------
async function acao(action: string, payload: any) {
  const { data, error } = await supabase.functions.invoke('workflow-acao', { body: { action, ...payload } })
  const msg = await mensagemErroFuncao(error, data, 'workflow-acao')
  if (msg) throw new Error(msg)
  return data as any
}
export const classificar = (solicitacaoId: string, complexidade: Complexidade) => acao('classificar', { solicitacaoId, complexidade })
export const financeiroMarcar = (solicitacaoId: string, emolumentos: number, impostos: number) => acao('financeiro_marcar', { solicitacaoId, emolumentos, impostos })
export const avancar = (solicitacaoId: string, observacao?: string) => acao('avancar', { solicitacaoId, observacao })
export const devolver = (solicitacaoId: string, exigencia: string) => acao('devolver', { solicitacaoId, exigencia })
export const finalizarFluxo = (solicitacaoId: string) => acao('finalizar', { solicitacaoId })

// ---------- log de alterações do fluxo ----------
export interface WorkflowLog {
  id: string; papel: string | null; acao: string; de_etapa: string | null; para_etapa: string | null
  exigencia: string | null; observacao: string | null; created_at: string; ator_nome?: string
}
export async function workflowLog(solicitacaoId: string): Promise<WorkflowLog[]> {
  const { data } = await supabase.from('workflow_log')
    .select('id, papel, acao, de_etapa, para_etapa, exigencia, observacao, created_at, ator')
    .eq('solicitacao_id', solicitacaoId).order('created_at', { ascending: false })
  const linhas = (data as any[]) ?? []
  const ids = [...new Set(linhas.map(l => l.ator).filter(Boolean))]
  let nomes: Record<string, string> = {}
  if (ids.length) {
    const { data: profs } = await supabase.from('profiles').select('id, nome').in('id', ids)
    for (const p of (profs ?? []) as any[]) nomes[p.id] = p.nome
  }
  return linhas.map(l => ({ ...l, ator_nome: nomes[l.ator] ?? null }))
}

// ---------- minha fila de tarefas ----------
export interface Tarefa { id: string; protocolo: string | null; titulo: string | null; etapa: string; complexidade: string | null; exigencia_atual: string | null; tipo: string | null }
export async function minhasTarefas(): Promise<Tarefa[]> {
  const papel = await meuPapel()
  const { data: u } = await supabase.auth.getUser()
  const { data: prof } = await supabase.from('profiles').select('cartorio_id').eq('id', u!.user!.id).maybeSingle()
  const cartorioId = (prof as any)?.cartorio_id
  if (!cartorioId) return []
  // oficial vê tudo que está em revisão/aprovação/finalização; demais veem a própria fila
  let q = supabase.from('solicitacoes')
    .select('id, protocolo, titulo, etapa, complexidade, exigencia_atual, tipos_ato(nome)')
    .eq('cartorio_id', cartorioId).neq('etapa', 'concluida').neq('status', 'cancelada')
  if (papel !== 'tabeliao_oficial' && papel !== 'tabeliao') q = q.eq('responsavel_papel', papel)
  const { data } = await q.order('updated_at', { ascending: true })
  return ((data as any[]) ?? []).map(r => ({
    id: r.id, protocolo: r.protocolo, titulo: r.titulo, etapa: r.etapa, complexidade: r.complexidade,
    exigencia_atual: r.exigencia_atual, tipo: r.tipos_ato?.nome ?? null,
  }))
}

// ---------- minuta mais recente ----------
export async function ultimaMinuta(solicitacaoId: string): Promise<{ id: string; conteudo: string; versao: number } | null> {
  const { data } = await supabase.from('minutas').select('id, conteudo, versao')
    .eq('solicitacao_id', solicitacaoId).order('versao', { ascending: false }).limit(1).maybeSingle()
  return (data as any) ?? null
}
export async function salvarMinuta(minutaId: string, conteudo: string, solicitacaoId: string) {
  await supabase.from('minutas').update({ conteudo }).eq('id', minutaId)
  await supabase.rpc('registrar_custodia', { p_solicitacao: solicitacaoId, p_minuta: minutaId, p_acao: 'minuta_editada', p_detalhe: {} })
}

// ---------- geração de documentos ----------
function escapeHtml(s: string) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') }

export function baixarDoc(texto: string, titulo: string) {
  const html = `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'><head><meta charset='utf-8'><title>${titulo}</title></head><body><div style="font-family:Georgia,serif;font-size:12pt;line-height:1.5;white-space:pre-wrap">${escapeHtml(texto)}</div></body></html>`
  const blob = new Blob(['\ufeff' + html], { type: 'application/msword' })
  const url = URL.createObjectURL(blob); const a = document.createElement('a')
  a.href = url; a.download = `${titulo}.doc`; a.click(); URL.revokeObjectURL(url)
}

async function pdfBlob(texto: string): Promise<Blob> {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const margin = 56, width = doc.internal.pageSize.getWidth() - margin * 2
  const bottom = doc.internal.pageSize.getHeight() - margin
  doc.setFont('times', 'normal'); doc.setFontSize(11)
  const linhas = doc.splitTextToSize(texto || ' ', width)
  let y = margin
  for (const ln of linhas) { if (y > bottom) { doc.addPage(); y = margin } doc.text(ln, margin, y); y += 15 }
  return doc.output('blob')
}

export interface Saida { id: string; tipo: 'rascunho' | 'final'; formato: 'doc' | 'pdf'; storage_path: string; created_at: string }

export async function listarSaidas(solicitacaoId: string): Promise<Saida[]> {
  const { data } = await supabase.from('saidas').select('id, tipo, formato, storage_path, created_at')
    .eq('solicitacao_id', solicitacaoId).order('created_at', { ascending: false })
  return (data as Saida[]) ?? []
}

export async function gerarSaidaPDF(solicitacaoId: string, texto: string, tipo: 'rascunho' | 'final'): Promise<Saida> {
  const blob = await pdfBlob(texto)
  const path = `${solicitacaoId}/${tipo}_${Date.now()}.pdf`
  const up = await supabase.storage.from('saidas').upload(path, blob, { contentType: 'application/pdf' })
  if (up.error) throw up.error
  const { data, error } = await supabase.from('saidas').insert({ solicitacao_id: solicitacaoId, tipo, formato: 'pdf', storage_path: path }).select('id, tipo, formato, storage_path, created_at').single()
  if (error) throw error
  await supabase.rpc('registrar_custodia', { p_solicitacao: solicitacaoId, p_minuta: null, p_acao: tipo === 'final' ? 'documento_final' : 'documento_rascunho', p_detalhe: { formato: 'pdf' } })
  return data as Saida
}

export async function urlSaida(path: string): Promise<string | null> {
  const { data } = await supabase.storage.from('saidas').createSignedUrl(path, 3600)
  return data?.signedUrl ?? null
}

export async function enviarWhatsapp(solicitacaoId: string, saidaId: string) {
  const { data, error } = await supabase.functions.invoke('whatsapp-enviar', { body: { solicitacaoId, saidaId } })
  const msg = await mensagemErroFuncao(error, data, 'whatsapp-enviar')
  if (msg) throw new Error(msg)
  return data as any
}

import { supabase } from './supabase'
import { mensagemErroFuncao } from './erros'

export type Aptidao = 'apto' | 'exigencia' | 'bloqueio'
export interface ItemRegistral {
  principio: string; item: string; situacao: 'ok' | 'exigencia' | 'bloqueio'; fundamento: string
}
export interface PreQualRegistral {
  aptidao: Aptidao; aptidao_label: string; resumo: string
  itens: ItemRegistral[]; nota_ia?: string; provedor?: string | null; gerado_em?: string
}

export async function preQualificarRegistro(solicitacaoId: string): Promise<PreQualRegistral> {
  const { data, error } = await supabase.functions.invoke('registro-prequalificar', { body: { solicitacaoId } })
  const msg = await mensagemErroFuncao(error, data, 'registro-prequalificar')
  if (msg) throw new Error(msg)
  const d = data as any
  if (d?.error) throw new Error(d.error + (d.codigo ? ` (cód. ${d.codigo})` : ''))
  return d as PreQualRegistral
}

// Recupera a última pré-qualificação registral salva (em triagem), se houver
export async function ultimaPreQualRegistral(solicitacaoId: string): Promise<PreQualRegistral | null> {
  const { data } = await supabase.from('triagem')
    .select('resultado, created_at').eq('solicitacao_id', solicitacaoId)
    .order('created_at', { ascending: false }).limit(20)
  for (const row of (data as any[]) ?? []) {
    if (row?.resultado?.prequalificacao_registral) return row.resultado.prequalificacao_registral as PreQualRegistral
  }
  return null
}

export const APTIDAO_COR: Record<Aptidao, string> = {
  apto: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  exigencia: 'bg-amber-50 text-amber-800 border-amber-200',
  bloqueio: 'bg-red-50 text-red-700 border-red-200',
}

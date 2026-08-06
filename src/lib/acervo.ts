import { supabase } from './supabase'
import { mensagemErroFuncao } from './erros'

export type CategoriaAcervo = 'modelo' | 'jurisprudencia' | 'orientacao' | 'outro'

export const CATEGORIAS: { v: CategoriaAcervo; label: string }[] = [
  { v: 'modelo', label: 'Modelo de documento' },
  { v: 'jurisprudencia', label: 'Jurisprudência notarial/registral' },
  { v: 'orientacao', label: 'Orientação do tabelião' },
  { v: 'outro', label: 'Outro' },
]

export const TIPOS_DOC = ['rg', 'cpf', 'cnh', 'certidao', 'contrato', 'comprovante', 'procuracao', 'outro']

export interface AcervoItem {
  id: string; categoria: CategoriaAcervo; tipo_ato_slug: string | null
  titulo: string; tema: string[]; descricao: string | null
  storage_path: string | null; mime: string | null; tamanho: number | null; created_at: string
  padrao?: boolean
}

export async function listarAcervo(): Promise<AcervoItem[]> {
  const { data, error } = await supabase.from('acervo').select('*').order('created_at', { ascending: false })
  if (error) throw error
  return (data as AcervoItem[]) ?? []
}

export async function uploadAcervo(file: File, meta: {
  cartorio_id: string; categoria: CategoriaAcervo; tipo_ato_slug?: string
  titulo: string; tema: string[]; descricao?: string
}): Promise<void> {
  const safe = file.name.replace(/[^\w.\-]/g, '_').slice(0, 80)
  const path = `${meta.cartorio_id}/${crypto.randomUUID()}_${safe}`
  const up = await supabase.storage.from('acervo').upload(path, file)
  if (up.error) throw up.error
  const { error } = await supabase.from('acervo').insert({
    cartorio_id: meta.cartorio_id, categoria: meta.categoria,
    tipo_ato_slug: meta.tipo_ato_slug || null, titulo: meta.titulo,
    tema: meta.tema, descricao: meta.descricao || null,
    storage_path: path, mime: file.type, tamanho: file.size,
  })
  if (error) throw error
}

export async function urlAcervo(path: string): Promise<string | null> {
  const { data } = await supabase.storage.from('acervo').createSignedUrl(path, 3600)
  return data?.signedUrl ?? null
}

// ---- Link do cliente ----
export async function gerarLinkCliente(solicitacaoId: string, email?: string): Promise<string> {
  const { data, error } = await supabase.from('acesso_cliente')
    .insert({ solicitacao_id: solicitacaoId, email_cliente: email || null })
    .select('token').single()
  if (error) throw error
  return `${window.location.origin}/c/${(data as any).token}`
}

export interface UploadCliente {
  id: string; tipo_doc: string; nome_arquivo: string; storage_path: string; enviado_em: string
}
export async function listarUploadsCliente(solicitacaoId: string): Promise<UploadCliente[]> {
  const { data } = await supabase.from('cliente_uploads').select('*')
    .eq('solicitacao_id', solicitacaoId).order('enviado_em', { ascending: false })
  return (data as UploadCliente[]) ?? []
}
export async function urlUploadCliente(path: string): Promise<string | null> {
  const { data } = await supabase.storage.from('cliente-uploads').createSignedUrl(path, 3600)
  return data?.signedUrl ?? null
}

// ---- Triagem (IA) ----
export interface TriagemResultado {
  resumo?: string
  checklist_documentos?: { documento: string; status: string; observacao?: string }[]
  pre_qualificacao?: { item: string; status: string; fundamento: string }[]
  modelos_sugeridos?: string[]
  proximo_passo?: string
  status_sugerido?: string
  onus?: { item: string; status: string; fundamento: string }[]
}
export async function rodarTriagem(solicitacaoId: string): Promise<TriagemResultado> {
  const { data, error } = await supabase.functions.invoke('artemis-intake', { body: { solicitacaoId } })
  const msg = await mensagemErroFuncao(error, data, 'artemis-intake')
  if (msg) throw new Error(msg)
  return (data as any).resultado as TriagemResultado
}
export async function ultimaTriagem(solicitacaoId: string): Promise<TriagemResultado | null> {
  const { data } = await supabase.from('triagem').select('resultado')
    .eq('solicitacao_id', solicitacaoId).order('created_at', { ascending: false }).limit(1).maybeSingle()
  return (data as any)?.resultado ?? null
}

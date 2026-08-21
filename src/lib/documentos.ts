import { supabase } from './supabase'
import { mensagemErroFuncao } from './erros'

export type TipoDocInstrucao = 'rg' | 'cnh' | 'matricula' | 'certidao' | 'procuracao' | 'compromisso' | 'outro'

/** Confronto do contrato com a matrícula do imóvel. */
export interface ItemConfronto {
  campo: string; contrato: string; matricula: string
  status: 'confere' | 'divergente' | 'ausente'; observacao?: string
}
export interface Confronto {
  itens: ItemConfronto[]
  veredito: 'apto' | 'atencao' | 'impeditivo'
  resumo?: string
  conferido_em?: string
  matricula_arquivo?: string | null
}
export const TIPOS_DOC_INSTRUCAO: { v: TipoDocInstrucao; label: string }[] = [
  { v: 'rg', label: 'RG (identidade)' },
  { v: 'cnh', label: 'CNH (habilitação)' },
  { v: 'matricula', label: 'Matrícula do imóvel' },
  { v: 'compromisso', label: 'Compromisso de compra e venda' },
  { v: 'certidao', label: 'Certidão (com validade)' },
  { v: 'procuracao', label: 'Procuração (com validade)' },
  { v: 'outro', label: 'Outro' },
]

export interface Documento {
  validade?: string | null
  emitida_em?: string | null
  vincular_escritura?: boolean
  id: string; solicitacao_id: string; tipo: TipoDocInstrucao
  nome_arquivo: string; storage_path: string; mime: string | null
  extraido: Record<string, any> | null; status: 'pendente' | 'extraido' | 'validado'
  confronto?: Confronto | null
  vinculado?: boolean
  validade_ate?: string | null
  created_at: string
}

export async function listarDocumentos(solicitacaoId: string): Promise<Documento[]> {
  const { data, error } = await supabase.from('documentos').select('*')
    .eq('solicitacao_id', solicitacaoId).order('created_at', { ascending: false })
  if (error) throw error
  return (data as Documento[]) ?? []
}

export async function uploadDocumento(solicitacaoId: string, file: File, tipo: TipoDocInstrucao): Promise<Documento> {
  const safe = file.name.replace(/[^\w.\-]/g, '_').slice(0, 80)
  const path = `${solicitacaoId}/${crypto.randomUUID()}_${safe}`
  const up = await supabase.storage.from('documentos').upload(path, file)
  if (up.error) throw up.error
  const { data, error } = await supabase.from('documentos').insert({
    solicitacao_id: solicitacaoId, tipo, nome_arquivo: file.name,
    storage_path: path, mime: file.type, tamanho: file.size,
  }).select('*').single()
  if (error) throw error
  return data as Documento
}

export async function extrairDocumento(documentoId: string): Promise<Record<string, any>> {
  const { data, error } = await supabase.functions.invoke('artemis-extract', { body: { documentoId } })
  const msg = await mensagemErroFuncao(error, data, 'artemis-extract')
  if (msg) throw new Error(msg)
  return (data as any).extraido as Record<string, any>
}

/**
 * Confronta o contrato lido com a matrícula do imóvel deste protocolo.
 * Usa as duas leituras já gravadas — não relê os arquivos, para não divergir
 * do que o escrevente validou na tela.
 */
export async function confrontarComMatricula(documentoId: string): Promise<Confronto> {
  const { data, error } = await supabase.functions.invoke('artemis-extract', {
    body: { documentoId, acao: 'confrontar' },
  })
  const msg = await mensagemErroFuncao(error, data, 'artemis-extract')
  if (msg) throw new Error(msg)
  return (data as any).confronto as Confronto
}

export async function marcarValidado(documentoId: string): Promise<void> {
  await supabase.from('documentos').update({ status: 'validado' }).eq('id', documentoId)
}

export async function urlDocumento(path: string): Promise<string | null> {
  const { data } = await supabase.storage.from('documentos').createSignedUrl(path, 3600)
  return data?.signedUrl ?? null
}

/**
 * Vincula (ou desvincula) o documento ao ato. Leitura por IA é insumo; vínculo
 * é decisão humana — só documento vinculado alimenta o painel e a minuta.
 */
export async function vincularDocumento(documentoId: string, vinculado: boolean) {
  const { error } = await supabase.from('documentos').update({ vinculado }).eq('id', documentoId)
  if (error) throw error
}

/** Manda a IA ler uma certidão do cadastro da construtora/empreendimento. */
export async function lerCertidaoConstrutora(certidaoId: string) {
  const { data, error } = await supabase.functions.invoke('artemis-extract', {
    body: { acao: 'certidao_construtora', certidaoId },
  })
  const msg = await mensagemErroFuncao(error, data, 'artemis-extract')
  if (msg) throw new Error(msg)
  return (data as any).leitura
}

import { supabase } from './supabase'
import { mensagemErroFuncao } from './erros'

export type TipoDocInstrucao = 'rg' | 'cnh' | 'matricula' | 'certidao' | 'procuracao' | 'compromisso' | 'comprovante_endereco' | 'outro'

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
  { v: 'comprovante_endereco', label: 'Comprovante de endereço' },
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
  parte_id?: string | null
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

/** Manda a IA ler a procuração de um representante da construtora. */
export async function lerProcuracaoRepresentante(representanteId: string) {
  const { data, error } = await supabase.functions.invoke('artemis-extract', {
    body: { acao: 'procuracao_representante', representanteId },
  })
  const msg = await mensagemErroFuncao(error, data, 'artemis-extract')
  if (msg) throw new Error(msg)
  return (data as any).leitura
}

/**
 * Vincula o documento a uma parte e, sendo comprovante de endereço, copia a
 * qualificação de endereço para ela.
 *
 * A pergunta "de quem é este endereço?" não pode ser adivinhada: dois
 * compradores anexam dois comprovantes, e endereço errado em escritura é
 * defeito que só aparece no Registro.
 */
export async function vincularDocumentoAParte(
  documentoId: string, parteId: string,
): Promise<{ aplicado: boolean; titularDivergente?: string }> {
  const { data: doc } = await supabase.from('documentos')
    .select('extraido, tipo').eq('id', documentoId).maybeSingle()
  const { error } = await supabase.from('documentos').update({ parte_id: parteId }).eq('id', documentoId)
  if (error) throw error

  const e = (doc as any)?.extraido
  if ((doc as any)?.tipo !== 'comprovante_endereco' || !e) return { aplicado: false }

  const { data: parte } = await supabase.from('partes')
    .select('nome, dados').eq('id', parteId).maybeSingle()
  const dados = { ...((parte as any)?.dados ?? {}) }

  const rua = [e.logradouro, e.numero, e.complemento].filter(Boolean).join(', ')
  if (rua) dados.endereco = rua
  if (e.bairro) dados.bairro = e.bairro
  if (e.cidade || e.uf) dados.cidade = [e.cidade, e.uf].filter(Boolean).join('/')
  if (e.cep) dados.cep = e.cep

  const { error: e2 } = await supabase.from('partes').update({ dados }).eq('id', parteId)
  if (e2) throw e2

  // Titular diferente da parte não impede — mas quem lavra precisa saber.
  const norm = (s: string) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
  const divergente = e.titular && (parte as any)?.nome && norm(e.titular) !== norm((parte as any).nome)
  return { aplicado: true, titularDivergente: divergente ? e.titular : undefined }
}

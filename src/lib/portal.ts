import { supabase } from './supabase'
import { mensagemErroFuncao } from './erros'

export const LGPD_VERSAO = 'v1'
export const LGPD_TEXTO =
  `Para elaborar o ato notarial solicitado, o cartório tratará os dados pessoais e documentos aqui ` +
  `informados com a finalidade exclusiva de qualificação das partes, conferência documental e lavratura ` +
  `do instrumento, nos termos da Lei nº 13.709/2018 (LGPD) e da legislação notarial e registral. ` +
  `Os dados são armazenados de forma protegida e compartilhados apenas com os entes públicos e centrais ` +
  `obrigatórios à prática do ato. Quando há uso de inteligência artificial de apoio, os identificadores ` +
  `diretos são pseudonimizados antes do processamento. Você pode solicitar informações sobre o tratamento ` +
  `dos seus dados diretamente ao cartório responsável.`

export interface PortalDados {
  ok?: boolean; erro?: string; protocolo?: string; status?: string; lgpd_aceite?: boolean
  tipo_ato?: { nome: string; descricao: string | null; papeis: string[]; schema_campos: any[] }
  dados?: Record<string, any>
}

export async function portalGet(token: string): Promise<PortalDados> {
  const { data, error } = await supabase.functions.invoke('cliente-portal', { body: { action: 'get', token } })
  const msg = await mensagemErroFuncao(error, data, 'cliente-portal')
  if (msg) throw new Error(msg)
  return data as PortalDados
}

export async function portalUpload(token: string, file: File, tipoDoc: string): Promise<void> {
  const r = await supabase.functions.invoke('cliente-portal', {
    body: { action: 'upload-url', token, nome_arquivo: file.name, tipo_doc: tipoDoc, mime: file.type },
  })
  const msgUp = await mensagemErroFuncao(r.error, r.data, 'cliente-portal')
  if (msgUp) throw new Error(msgUp)
  const { path, token: signed } = r.data as { path: string; token: string }
  const up = await supabase.storage.from('cliente-uploads').uploadToSignedUrl(path, signed, file)
  if (up.error) throw up.error
}

export async function portalSubmit(token: string, p: {
  dados: Record<string, any>; email?: string; lgpd_aceite: boolean
}): Promise<void> {
  const { data, error } = await supabase.functions.invoke('cliente-portal', {
    body: { action: 'submit', token, dados: p.dados, email: p.email, lgpd_aceite: p.lgpd_aceite, lgpd_versao: LGPD_VERSAO },
  })
  const msg = await mensagemErroFuncao(error, data, 'cliente-portal')
  if (msg) throw new Error(msg)
}

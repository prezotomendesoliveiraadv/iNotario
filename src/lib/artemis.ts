import { supabase } from './supabase'
import type { Solicitacao, Parte, TipoAto, ItemQualificacao, Minuta } from './types'
import { mensagemErroFuncao } from './erros'

export type Modo = 'ELABORACAO' | 'QUALIFICACAO'
export type Canal = 'TEXTO' | 'VOZ'
export interface ChatMsg { role: 'user' | 'assistant'; content: string }
export interface Entidade { tipo: string; valor: string }

// Coleta os identificadores diretos (que serão pseudonimizados antes de ir à IA)
export function coletarPII(partes: Parte[], tipo: TipoAto, dados: Record<string, any>): Entidade[] {
  const ents: Entidade[] = []
  const push = (t: string, v?: string | null) => { if (v && String(v).trim()) ents.push({ tipo: t, valor: String(v) }) }
  for (const p of partes) {
    push('PESSOA', p.nome)
    const dig = (p.cpf_cnpj || '').replace(/\D/g, '')
    if (dig) push(dig.length > 11 ? 'CNPJ' : 'CPF', p.cpf_cnpj)
    push('ENDERECO', p.dados?.endereco)
  }
  for (const c of tipo.schema_campos) {
    if (/matricula/i.test(c.key)) push('MATRICULA', dados?.[c.key])
    else if (/cartorio_ri|registro/i.test(c.key)) push('REGISTRO', dados?.[c.key])
  }
  return ents
}

export interface ArtemisContexto {
  nome: string; tratamento: string; papel: string; serventia: string; tipoAto: string
}

// Monta o texto de "dados do caso" a partir da solicitação e das partes
export function montarCaseData(s: Solicitacao, tipo: TipoAto, partes: Parte[]): string {
  const linhasPartes = partes.map(p =>
    `- ${p.papel}: ${p.nome || '[nome]'}${p.cpf_cnpj ? ', CPF/CNPJ ' + p.cpf_cnpj : ''}` +
    `${p.dados?.estado_civil ? ', ' + p.dados.estado_civil : ''}` +
    `${p.dados?.regime_bens ? ', regime ' + p.dados.regime_bens : ''}`
  ).join('\n')
  const linhasDados = tipo.schema_campos
    .map(c => `- ${c.label}: ${s.dados?.[c.key] ?? '—'}`).join('\n')
  return `Tipo de ato: ${tipo.nome}\nProtocolo: ${s.protocolo ?? '—'}\n\nPartes:\n${linhasPartes || '(nenhuma)'}\n\nDados do ato:\n${linhasDados}`
}

// Saudação inicial (espelha o system prompt; exibida como 1ª fala da Artemis)
export function saudacao(modo: Modo, ctx: ArtemisContexto): string {
  const t = `${ctx.tratamento} ${ctx.nome}`.trim()
  const hoje = new Date().toLocaleString('pt-BR')
  return modo === 'ELABORACAO'
    ? `Olá ${t}, sou Artemis, sua assistente notarial. Hoje é ${hoje}. Espero que seu dia esteja produtivo. Vejo que temos um ato a preparar e estou aqui para auxiliar na elaboração da minuta. Quando estiver pronto, podemos começar a estruturar o documento.`
    : `Olá ${t}, sou eu, Artemis. Estou pronta para revisar este ato e antecipar eventuais exigências registrais antes da lavratura. Podemos começar a qualificação?`
}

interface ChatResp { reply: string; transcript?: string; audio?: string; audioMime?: string; error?: string }

export async function artemisChat(p: {
  mode: Modo; channel: Canal; context: ArtemisContexto; caseData: string;
  messages: ChatMsg[]; pii?: Entidade[]; audio?: { data: string; mime: string }
}): Promise<ChatResp> {
  const { data, error } = await supabase.functions.invoke('artemis-chat', { body: p })
  const msg = await mensagemErroFuncao(error, data, 'artemis-chat')
  if (msg) throw new Error(msg)
  return data as ChatResp
}

export interface CompileResp {
  mode: Modo
  minuta?: Minuta
  qualificacao: ItemQualificacao[]
  partes?: Parte[]
  metadados?: Record<string, any>
  placeholders_pendentes?: string[]
  resumo?: string
  pendencias_bloqueantes?: string[]
  error?: string
}

export async function artemisCompile(p: {
  mode: Modo; context: ArtemisContexto; caseData: string; messages: ChatMsg[];
  pii?: Entidade[]; solicitacaoId?: string; tipoMinuta?: 'provisoria' | 'definitiva'
}): Promise<CompileResp> {
  const { data, error } = await supabase.functions.invoke('artemis-compile', { body: p })
  const msg = await mensagemErroFuncao(error, data, 'artemis-compile')
  if (msg) throw new Error(msg)
  return data as CompileResp
}

// Gravação de áudio do microfone -> base64 (para o canal de voz)
export async function gravarAudio(): Promise<{ stop: () => Promise<{ data: string; mime: string }> }> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  const rec = new MediaRecorder(stream)
  const chunks: BlobPart[] = []
  rec.ondataavailable = (e) => chunks.push(e.data)
  rec.start()
  return {
    stop: () => new Promise((resolve) => {
      rec.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
        const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' })
        const buf = await blob.arrayBuffer()
        let bin = ''; const bytes = new Uint8Array(buf)
        for (const b of bytes) bin += String.fromCharCode(b)
        resolve({ data: btoa(bin), mime: blob.type })
      }
      rec.stop()
    }),
  }
}

export function tocarAudioB64(b64: string, mime = 'audio/mpeg') {
  const audio = new Audio(`data:${mime};base64,${b64}`)
  audio.play().catch(() => {})
}

// Toca e resolve quando o áudio termina (para retomar a escuta na conversa por voz)
export function tocarAudioB64Async(b64: string, mime = 'audio/mpeg'): Promise<void> {
  return new Promise((resolve) => {
    const audio = new Audio(`data:${mime};base64,${b64}`)
    audio.onended = () => resolve()
    audio.onerror = () => resolve()
    audio.play().catch(() => resolve())
  })
}

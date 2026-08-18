import { supabase } from './supabase'
import type { ChatMsg } from './artemis'
import { mensagemErroFuncao } from './erros'

export interface ServicoLite { slug: string; nome: string; descricao?: string }
export interface Contato { nome?: string; email?: string; whatsapp?: string }

async function call(body: any) {
  const { data, error } = await supabase.functions.invoke('intake-publico', { body })
  const msg = await mensagemErroFuncao(error, data, 'intake-publico')
  if (msg) throw new Error(msg)
  return data as any
}

export async function atenderTipos(): Promise<ServicoLite[]> {
  return (await call({ action: 'tipos' })).tipos ?? []
}

export async function atenderIniciar(tipoAtoSlug: string, comVoz = false): Promise<{
  token: string; protocolo: string; tipoAtoNome: string; saudacao: string; audio?: string; audioMime?: string
}> {
  return await call({ action: 'iniciar', tipoAtoSlug, comVoz })
}

export async function atenderChat(p: {
  trilha?: 'conversa' | 'documentos'
  campos?: { nome?: string; telefone?: string; email?: string }
  token: string; channel: 'TEXTO' | 'VOZ'; messages: ChatMsg[]; tipoAtoNome?: string
  audio?: { data: string; mime: string }
}): Promise<{ reply: string; transcript?: string; audio?: string; audioMime?: string }> {
  return await call({ action: 'chat', ...p })
}

export async function atenderFalar(token: string, texto: string): Promise<{ audio?: string; audioMime?: string }> {
  return await call({ action: 'falar', token, texto })
}

export async function atenderTraduzir(token: string, texto: string): Promise<{ texto: string }> {
  return await call({ action: 'traduzir', token, texto })
}

/**
 * Anexa um documento em três tempos: reservar o caminho, subir o arquivo e
 * confirmar que ele chegou. A confirmação é o que separa "reservado" de
 * "recebido" — sem ela, um upload interrompido deixava um registro fantasma e
 * a Artemis passava a dizer que tinha recebido o documento.
 *
 * Devolve a lista de documentos efetivamente recebidos, conferida no servidor.
 */
export async function atenderUpload(
  token: string, file: File, tipoDoc: string,
): Promise<{ tipo: string; nome_arquivo: string }[]> {
  const r = await call({ action: 'upload-url', token, nome_arquivo: file.name, tipo_doc: tipoDoc, mime: file.type })
  const up = await supabase.storage.from('documentos').uploadToSignedUrl(r.path, r.token, file)
  if (up.error) throw up.error
  const ok = await call({ action: 'upload-ok', token, path: r.path })
  if (!ok?.recebido) throw new Error('O arquivo não chegou ao servidor. Tente anexar de novo.')
  return ok.documentos ?? []
}

export async function atenderFinalizar(token: string, p: {
  messages: ChatMsg[]; contato: Contato; lgpd_aceite: boolean
}): Promise<{ protocolo: string; resumo: string; ficha?: FichaIntake }> {
  return await call({ action: 'finalizar', token, ...p })
}

export interface FichaIntake {
  titulo?: string
  tipo_ato_slug?: string
  solicitante?: { nome?: string; qualificacao?: string; representa?: string; vinculo?: string; empresa?: string }
  partes?: { papel?: string; nome?: string; estado_civil?: string; regime_bens?: string; cpf?: string; rg?: string; profissao?: string; cidade?: string }[]
  imovel?: { descricao?: string; empreendimento?: string; endereco?: string; matricula?: string; cartorio_ri?: string; construtora?: string; valor?: string; forma_pagamento?: string }
}

export async function atenderStatus(protocolo: string, whatsapp: string): Promise<{
  protocolo: string; nome: string | null; servico: string | null; etapa: string; atualizado_em: string; criado_em: string
}> {
  return await call({ action: 'status', protocolo, whatsapp })
}

// ---------------------------------------------------------------------------
// Escuta mãos-livres (VAD por energia): grava continuamente; ao detectar fala
// seguida de ~1,4s de silêncio, entrega o trecho via onUtterance e reinicia.
// pause()/resume() suspendem a escuta enquanto a Artemis fala (evita eco).
// ---------------------------------------------------------------------------
export interface EscutaVAD { pause: () => void; resume: () => void; stop: () => void; falando: () => boolean }

export async function escutarComVAD(
  onUtterance: (audio: { data: string; mime: string }) => void,
  opts?: { silencioMs?: number; falaMinMs?: number; limiar?: number },
): Promise<EscutaVAD> {
  const silencioMs = opts?.silencioMs ?? 1200
  const falaMinMs = opts?.falaMinMs ?? 400
  const limiar = opts?.limiar ?? 0.015

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  })
  const ctx = new AudioContext()
  const source = ctx.createMediaStreamSource(stream)
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 1024
  source.connect(analyser)
  const buf = new Float32Array(analyser.fftSize)

  // Container suportado pelo navegador (Safari/iOS não gravam webm).
  const TIPOS = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']
  const tipoRec = TIPOS.find(t => (window as any).MediaRecorder?.isTypeSupported?.(t)) || ''

  let rec: MediaRecorder | null = null
  let chunks: BlobPart[] = []
  let pausado = true
  let emFala = false
  let inicioFala = 0
  let ultimoSom = 0
  let vivo = true

  /**
   * CRÍTICO: cada trecho precisa ser um arquivo COMPLETO.
   * O MediaRecorder só emite o cabeçalho do container no primeiro chunk de
   * cada sessão de gravação. Descartar chunks (chunks = []) sem reiniciar o
   * gravador produz áudio sem cabeçalho — indecodificável pelo modelo, que
   * então "não ouve nada". Por isso, sempre que for preciso descartar o
   * buffer, o gravador é reiniciado.
   */
  function novoRec() {
    if (!vivo) return
    try { if (rec && rec.state !== 'inactive') rec.stop() } catch { /* já parado */ }
    chunks = []
    rec = new MediaRecorder(stream, tipoRec ? { mimeType: tipoRec } : undefined)
    rec.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data) }
    rec.start()   // sem timeslice: um único blob completo ao parar
  }

  /** Encerra a gravação atual e devolve o arquivo completo. */
  function pararRec(): Promise<Blob | null> {
    return new Promise((resolve) => {
      const r = rec
      if (!r || r.state === 'inactive') { resolve(null); return }
      r.onstop = () => {
        const blob = chunks.length ? new Blob(chunks, { type: r.mimeType || tipoRec || 'audio/webm' }) : null
        chunks = []
        resolve(blob)
      }
      try { r.stop() } catch { resolve(null) }
    })
  }

  async function fecharTrecho() {
    const blob = await pararRec()
    novoRec()                       // volta a escutar já com cabeçalho novo
    if (!blob || blob.size < 2500) return   // ruído/fragmento
    const ab = await blob.arrayBuffer()
    const bytes = new Uint8Array(ab)
    let bin = ''
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
    onUtterance({ data: btoa(bin), mime: blob.type })
  }

  function tick() {
    if (!vivo) return
    requestAnimationFrame(tick)
    if (pausado) return
    analyser.getFloatTimeDomainData(buf)
    let sum = 0
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
    const rms = Math.sqrt(sum / buf.length)
    const agora = performance.now()
    if (rms > limiar) {
      if (!emFala) { emFala = true; inicioFala = agora }
      ultimoSom = agora
    } else if (emFala && agora - ultimoSom > silencioMs) {
      emFala = false
      if (ultimoSom - inicioFala >= falaMinMs) void fecharTrecho()
      else novoRec()               // fala curta: reinicia (nunca só limpa chunks)
    }
  }

  novoRec()
  tick()

  return {
    // Pausa enquanto a Artemis fala: para o gravador (evita captar a própria
    // voz dela) e descarta o buffer reiniciando depois, no resume.
    pause: () => { pausado = true; emFala = false; void pararRec() },
    resume: () => { pausado = false; emFala = false; ultimoSom = 0; novoRec() },
    falando: () => emFala,
    stop: () => {
      vivo = false
      try { if (rec && rec.state !== 'inactive') rec.stop() } catch { /* já parado */ }
      stream.getTracks().forEach((t) => t.stop())
      void ctx.close()
    },
  }
}


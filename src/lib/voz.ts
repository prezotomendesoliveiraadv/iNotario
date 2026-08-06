// src/lib/voz.ts
// Reprodução de áudio em STREAMING: recebe pedaços de PCM (24kHz/mono/16-bit)
// e os agenda no Web Audio API, tocando sem emendas — a Artemis começa a falar
// assim que o primeiro pedaço chega, sem esperar a frase inteira.

const SAMPLE_RATE = 24000

export class TocadorPCM {
  private ctx: AudioContext
  private prox = 0            // instante (na linha do tempo do áudio) do próximo pedaço
  private fontes: AudioBufferSourceNode[] = []
  private parado = false

  constructor() {
    const AC: typeof AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext
    this.ctx = new AC({ sampleRate: SAMPLE_RATE })
  }

  async destravar() {
    // navegadores exigem um gesto do usuário; chame no clique de "Começar"
    if (this.ctx.state === 'suspended') await this.ctx.resume()
  }

  enfileirar(pcmB64: string) {
    if (this.parado) return
    const bin = atob(pcmB64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    const view = new DataView(bytes.buffer)
    const amostras = Math.floor(bytes.length / 2)
    if (amostras === 0) return

    const buf = this.ctx.createBuffer(1, amostras, SAMPLE_RATE)
    const canal = buf.getChannelData(0)
    for (let i = 0; i < amostras; i++) canal[i] = view.getInt16(i * 2, true) / 32768

    const src = this.ctx.createBufferSource()
    src.buffer = buf
    src.connect(this.ctx.destination)

    const agora = this.ctx.currentTime
    if (this.prox < agora + 0.06) this.prox = agora + 0.06   // pequena folga inicial
    src.start(this.prox)
    this.prox += buf.duration
    this.fontes.push(src)
    src.onended = () => { this.fontes = this.fontes.filter(f => f !== src) }
  }

  /** Espera o áudio já enfileirado terminar de tocar. */
  async aguardarFim() {
    const restante = Math.max(0, this.prox - this.ctx.currentTime)
    await new Promise(r => setTimeout(r, restante * 1000 + 80))
  }

  /** Interrompe imediatamente (ex.: usuário voltou a falar). */
  parar() {
    this.parado = true
    for (const f of this.fontes) { try { f.stop() } catch { /* já parou */ } }
    this.fontes = []
    this.prox = 0
    this.parado = false
  }

  fechar() { this.parar(); void this.ctx.close() }
}

// ---------------------------------------------------------------------------
// Cliente SSE da função voz-stream
// ---------------------------------------------------------------------------
export interface EventosVoz {
  onMeta?: (m: { transcricao: string; resposta: string; inaudivel?: boolean; saudacao?: boolean; alerta_unidade?: any; campos?: any }) => void
  onAudio?: (pcmB64: string) => void
  onErro?: (mensagem: string) => void
  onFim?: () => void
}

export async function conversarPorVoz(
  payload: { token: string; messages: { role: string; content: string }[]; tipoAtoNome?: string; trilha?: string; campos?: { nome?: string; telefone?: string; email?: string }
             audio?: { data: string; mime: string }; texto?: string },
  ev: EventosVoz,
): Promise<void> {
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/voz-stream`
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
    },
    body: JSON.stringify(payload),
  })
  if (!resp.ok || !resp.body) {
    ev.onErro?.(`Falha na voz (${resp.status}).`)
    return
  }

  const reader = resp.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })

    const blocos = buf.split('\n\n')
    buf = blocos.pop() ?? ''
    for (const bloco of blocos) {
      let evento = 'message'; let dados = ''
      for (const linha of bloco.split('\n')) {
        if (linha.startsWith('event:')) evento = linha.slice(6).trim()
        else if (linha.startsWith('data:')) dados += linha.slice(5).trim()
      }
      if (!dados) continue
      let j: any
      try { j = JSON.parse(dados) } catch { continue }
      if (evento === 'meta') ev.onMeta?.(j)
      else if (evento === 'audio') ev.onAudio?.(j.pcm)
      else if (evento === 'erro') ev.onErro?.(j.mensagem + (j.codigo ? ` (cód. ${j.codigo})` : ''))
      else if (evento === 'fim') ev.onFim?.()
    }
  }
}

import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import {
  artemisChat, artemisCompile, montarCaseData, saudacao, tocarAudioB64Async, coletarPII,
  type Modo, type Canal, type ChatMsg, type ArtemisContexto, type CompileResp, type Entidade,
} from '../lib/artemis'
import { escutarComVAD, type EscutaVAD } from '../lib/atendimento'
import type { Solicitacao, Parte, TipoAto } from '../lib/types'

export default function ArtemisPanel({
  solicitacao, tipo, partes, onCompiled,
}: {
  solicitacao: Solicitacao; tipo: TipoAto; partes: Parte[]; onCompiled: (r: CompileResp) => void
}) {
  const { profile } = useAuth()
  const [modo, setModo] = useState<Modo>('ELABORACAO')
  const [canal, setCanal] = useState<Canal>('TEXTO')
  const [msgs, setMsgs] = useState<ChatMsg[]>([])
  const [texto, setTexto] = useState('')
  const [loading, setLoading] = useState(false)
  const [vozAtiva, setVozAtiva] = useState(false)
  const [vozEstado, setVozEstado] = useState<'ouvindo' | 'pensando' | 'falando' | 'parado'>('parado')
  const [erro, setErro] = useState<string | null>(null)
  const vadRef = useRef<EscutaVAD | null>(null)
  const msgsRef = useRef<ChatMsg[]>([])
  const ocupadoRef = useRef(false)
  const campoRef = useRef<HTMLTextAreaElement | null>(null)
  const loadingRef = useRef(false)
  const fimRef = useRef<HTMLDivElement | null>(null)

  const ctx: ArtemisContexto = {
    nome: (profile?.nome || 'Tabelião').split(' ').slice(-1)[0],
    tratamento: 'Dr.',
    papel: profile?.papel || 'tabeliao',
    serventia: '1º Tabelionato de Notas',
    tipoAto: tipo.nome,
  }
  const caseData = montarCaseData(solicitacao, tipo, partes)
  const pii: Entidade[] = coletarPII(partes, tipo, solicitacao.dados)

  // Saudação inicial ao montar / trocar de modo
  useEffect(() => { setMsgs([{ role: 'assistant', content: saudacao(modo, ctx) }]) }, [modo])
  useEffect(() => { fimRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }) }, [msgs, loading, vozEstado])
  useEffect(() => { loadingRef.current = loading }, [loading])
  // O campo segue habilitado durante a resposta e recupera o foco ao final:
  // desabilitá-lo faz o navegador descartar o foco a cada turno.
  useEffect(() => { if (canal === 'TEXTO' && !loading) campoRef.current?.focus() }, [loading, canal])
  useEffect(() => () => { vadRef.current?.stop() }, [])
  useEffect(() => { msgsRef.current = msgs }, [msgs])
  useEffect(() => { if (canal === 'TEXTO' && vozAtiva) desligarVoz() }, [canal])

  async function enviar(conteudo?: string, audio?: { data: string; mime: string }) {
    const userMsg = conteudo?.trim()
    if (!audio && !userMsg) return
    if (loadingRef.current) return   // turno em andamento
    setErro(null); setLoading(true)
    const base = userMsg ? [...msgsRef.current, { role: 'user', content: userMsg } as ChatMsg] : msgsRef.current
    if (userMsg) { setMsgs(base); setTexto('') }
    try {
      const r = await artemisChat({ mode: modo, channel: canal, context: ctx, caseData, pii, messages: base, audio })
      const next = [...base]
      if (r.transcript && audio) next.push({ role: 'user', content: r.transcript })
      next.push({ role: 'assistant', content: r.reply })
      setMsgs(next)
      if (canal === 'VOZ' && r.audio) await tocarAudioB64Async(r.audio, r.audioMime || 'audio/mpeg')
    } catch (e: any) { setErro(e.message ?? 'Falha na conversa.') }
    finally { setLoading(false) }
  }

  // ---- voz mãos-livres (VAD), igual ao portal do cliente ----
  async function ligarVoz() {
    setErro(null)
    if (vadRef.current) { vadRef.current.resume(); setVozAtiva(true); setVozEstado('ouvindo'); return }
    try {
      const vad = await escutarComVAD(async (audio) => {
        if (ocupadoRef.current) return
        ocupadoRef.current = true
        vadRef.current?.pause(); setVozEstado('pensando')
        try {
          const base = msgsRef.current
          const r = await artemisChat({ mode: modo, channel: 'VOZ', context: ctx, caseData, pii, messages: base, audio })
          if ((r as any).inaudivel) {
            if (r.audio) { setVozEstado('falando'); await tocarAudioB64Async(r.audio, r.audioMime || 'audio/mpeg') }
          } else {
            const next = [...base]
            if (r.transcript) next.push({ role: 'user', content: r.transcript })
            next.push({ role: 'assistant', content: r.reply })
            setMsgs(next)
            if (r.audio) { setVozEstado('falando'); await tocarAudioB64Async(r.audio, r.audioMime || 'audio/mpeg') }
          }
        } catch (e: any) { setErro(e.message ?? 'Falha na conversa por voz.') }
        finally {
          ocupadoRef.current = false
          if (vadRef.current) { vadRef.current.resume(); setVozEstado('ouvindo') }
        }
      }, { silencioMs: 1200 })
      vadRef.current = vad
      vad.resume()
      setVozAtiva(true); setVozEstado('ouvindo')
    } catch { setErro('Não foi possível acessar o microfone. Verifique a permissão do navegador (e use HTTPS).') }
  }
  function desligarVoz() { vadRef.current?.pause(); setVozAtiva(false); setVozEstado('parado') }

  async function compilar(tipoMinuta: 'provisoria' | 'definitiva') {
    setErro(null); setLoading(true)
    try {
      const r = await artemisCompile({
        mode: modo, context: ctx, caseData, pii, messages: msgs,
        solicitacaoId: solicitacao.id, tipoMinuta,
      })
      if (modo === 'ELABORACAO') {
        setMsgs(m => [...m, { role: 'assistant', content: `Minuta v${r.minuta?.versao} compilada e gravada. Confira a minuta, o relatório de alertas e a cadeia de custódia ao lado.` }])
        onCompiled(r)
      } else {
        const linhas = (r.qualificacao || []).map(q => `• [${q.status}] ${q.item} — ${q.fundamento}`).join('\n')
        setMsgs(m => [...m, { role: 'assistant', content: `Relatório de qualificação:\n${r.resumo || ''}\n\n${linhas}` }])
      }
    } catch (e: any) { setErro(e.message ?? 'Falha ao compilar.') }
    finally { setLoading(false) }
  }

  return (
    <div className="card" style={{ marginTop: '1.1rem' }}>
      <div className="pad" style={{ borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '.6rem' }}>
        <div>
          <div className="eyebrow">Motor Artemis · IA</div>
          <h2 className="font-serif" style={{ fontSize: '1.15rem', color: 'var(--navy)', margin: 0 }}>Assistente notarial</h2>
        </div>
        <div style={{ display: 'flex', gap: '.4rem' }}>
          <select className="input" value={modo} onChange={e => setModo(e.target.value as Modo)} style={{ width: 'auto', fontSize: '.78rem' }}>
            <option value="ELABORACAO">Elaboração</option>
            <option value="QUALIFICACAO">Qualificação</option>
          </select>
          <select className="input" value={canal} onChange={e => setCanal(e.target.value as Canal)} style={{ width: 'auto', fontSize: '.78rem' }}>
            <option value="TEXTO">Texto</option>
            <option value="VOZ">Voz</option>
          </select>
        </div>
      </div>

      {/* histórico */}
      <div style={{ maxHeight: 360, overflow: 'auto', padding: '1rem 1.1rem', display: 'flex', flexDirection: 'column', gap: '.6rem' }}>
        {msgs.map((m, i) => (
          <div key={i} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '85%' }}>
            <div style={{
              whiteSpace: 'pre-wrap', fontSize: '.86rem', lineHeight: 1.5, padding: '.55rem .8rem', borderRadius: 12,
              background: m.role === 'user' ? 'var(--navy)' : 'var(--paper)',
              color: m.role === 'user' ? '#fff' : 'var(--ink)',
            }}>{m.content}</div>
          </div>
        ))}
        {loading && <div className="muted" style={{ fontSize: '.8rem' }}>Artemis está pensando…</div>}
        <div ref={fimRef} />
      </div>

      {erro && <div style={{ color: '#b23a3a', fontSize: '.82rem', padding: '0 1.1rem .4rem' }}>{erro}</div>}

      {/* entrada */}
      <div className="pad" style={{ borderTop: '1px solid var(--line)' }}>
        <div style={{ display: 'flex', gap: '.5rem', alignItems: 'flex-end' }}>
          {canal === 'TEXTO' ? (
            <>
              <textarea ref={campoRef} className="input" value={texto} onChange={e => setTexto(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(texto) } }}
                placeholder="Converse com a Artemis… (Enter envia)" style={{ minHeight: 44 }} />
              <button className="btn btn-primary" onClick={() => enviar(texto)} disabled={loading || !texto.trim()}>Enviar</button>
            </>
          ) : (
            <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flex: 1 }}>
              <div style={{
                flex: 1, textAlign: 'center', padding: '.55rem', borderRadius: 12, fontSize: '.88rem',
                background: vozEstado === 'ouvindo' ? '#e8f5ee' : vozEstado === 'falando' ? '#eef2fb' : 'var(--paper)',
                color: 'var(--ink)', border: '1px solid var(--line)',
              }}>
                {vozEstado === 'ouvindo' ? '🎙️ Ouvindo — pode falar'
                  : vozEstado === 'pensando' ? '… entendendo'
                  : vozEstado === 'falando' ? '🔊 Artemis falando…'
                  : 'Voz pausada'}
                {vozEstado === 'ouvindo' && <span className="pulse-dot" style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 8, background: '#1E7a4f', marginLeft: 8 }} />}
              </div>
              {vozAtiva
                ? <button className="btn btn-ghost" onClick={desligarVoz}>Pausar</button>
                : <button className="btn btn-primary" onClick={ligarVoz}>🎙️ Iniciar voz</button>}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: '.5rem', marginTop: '.6rem' }}>
          {modo === 'ELABORACAO' ? (
            <>
              <button className="btn btn-brass" onClick={() => compilar('provisoria')} disabled={loading}>Compilar minuta provisória</button>
              <button className="btn btn-ghost" onClick={() => compilar('definitiva')} disabled={loading}>Compilar definitiva</button>
            </>
          ) : (
            <button className="btn btn-brass" onClick={() => compilar('provisoria')} disabled={loading}>Gerar relatório de qualificação</button>
          )}
        </div>
      </div>
    </div>
  )
}

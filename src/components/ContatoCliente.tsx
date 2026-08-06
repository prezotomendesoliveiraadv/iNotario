import { useState } from 'react'
import { whatsappMensagem, formatarWhatsapp } from '../lib/melhorias'
import { supabase } from '../lib/supabase'

const RAPIDAS = (protocolo: string) => [
  { r: 'Documentos', t: `Olá! Aqui é do cartório, sobre o protocolo ${protocolo}. Precisamos de alguns documentos para dar andamento. Pode nos enviar por aqui?` },
  { r: 'Exigência', t: `Olá! Sobre o protocolo ${protocolo}: identificamos um ponto que precisa ser ajustado antes de prosseguirmos. Podemos conversar?` },
  { r: 'Pronto', t: `Olá! Seu ato (protocolo ${protocolo}) está pronto. Podemos combinar a assinatura?` },
]

export default function ContatoCliente({
  solicitacaoId, protocolo, nome, whatsapp, onSalvo,
}: {
  solicitacaoId: string; protocolo: string | null
  nome: string | null; whatsapp: string | null; onSalvo?: () => void
}) {
  const [editando, setEditando] = useState(!whatsapp)
  const [nomeV, setNomeV] = useState(nome ?? '')
  const [wpp, setWpp] = useState(whatsapp ?? '')
  const [texto, setTexto] = useState('')
  const [aberto, setAberto] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  async function salvar() {
    setBusy(true); setErro(null); setMsg(null)
    try {
      const { error } = await supabase.from('solicitacoes')
        .update({ contato_nome: nomeV.trim() || null, contato_whatsapp: wpp.replace(/\D/g, '') || null })
        .eq('id', solicitacaoId)
      if (error) throw new Error(error.message)
      setEditando(false); setMsg('Contato salvo.'); onSalvo?.()
    } catch (e: any) { setErro(e.message) } finally { setBusy(false) }
  }

  async function enviar(t?: string) {
    const corpo = (t ?? texto).trim()
    if (!corpo) { setErro('Escreva a mensagem.'); return }
    setBusy(true); setErro(null); setMsg(null)
    try {
      await whatsappMensagem(solicitacaoId, corpo)
      setMsg('Mensagem enviada pelo WhatsApp.'); setTexto(''); setAberto(false)
    } catch (e: any) { setErro(e.message) } finally { setBusy(false) }
  }

  const temWpp = !!whatsapp

  return (
    <div className="card p-4 mb-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="eyebrow">Contato do solicitante</div>
          {editando ? (
            <div className="flex gap-2 mt-1 flex-wrap">
              <input className="input" style={{ width: 200 }} placeholder="Nome do solicitante"
                value={nomeV} onChange={e => setNomeV(e.target.value)} />
              <input className="input" style={{ width: 170 }} placeholder="(11) 99999-9999"
                value={formatarWhatsapp(wpp)} onChange={e => setWpp(e.target.value)} />
              <button className="btn-ghost" disabled={busy} onClick={salvar}>Salvar</button>
              {temWpp && <button className="btn-ghost" onClick={() => setEditando(false)}>cancelar</button>}
            </div>
          ) : (
            <div className="text-sm">
              <b className="text-navy">{nome || 'Sem nome'}</b>
              <span className="text-ink/60"> · {formatarWhatsapp(whatsapp ?? '')}</span>
              <button className="text-[11px] text-navy hover:underline ml-2" onClick={() => setEditando(true)}>editar</button>
            </div>
          )}
        </div>

        {temWpp && !editando && (
          <button className="btn-brass shrink-0" onClick={() => setAberto(v => !v)}>
            Falar no WhatsApp
          </button>
        )}
      </div>

      {aberto && temWpp && (
        <div className="mt-3 border-t border-black/5 pt-3">
          <div className="flex flex-wrap gap-1.5 mb-2">
            {RAPIDAS(protocolo ?? '').map(r => (
              <button key={r.r} className="text-[11px] px-2 py-1 rounded-full bg-paper hover:bg-brass/10 text-ink/70 hover:text-navy"
                onClick={() => setTexto(r.t)}>{r.r}</button>
            ))}
          </div>
          <div className="flex gap-2">
            <textarea className="input flex-1" style={{ minHeight: 56 }} placeholder="Mensagem ao cliente…"
              value={texto} onChange={e => setTexto(e.target.value)} />
            <button className="btn-primary self-start" disabled={busy || !texto.trim()} onClick={() => enviar()}>
              {busy ? '…' : 'Enviar'}
            </button>
          </div>
          <p className="text-[11px] text-ink/45 mt-1">
            Envio pela API oficial do WhatsApp. Fora da janela de 24h da última mensagem do cliente,
            a Meta só permite templates aprovados.
          </p>
        </div>
      )}

      {erro && <div className="text-sm text-red-600 mt-2">{erro}</div>}
      {msg && <div className="text-sm text-emerald-700 mt-2">{msg}</div>}
    </div>
  )
}

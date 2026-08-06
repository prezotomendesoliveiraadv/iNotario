import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Layout } from '../components/ui'
import { supabase } from '../lib/supabase'
import { dataExtenso, dataHora, diaISO } from '../lib/tempo'
import { agendarAssinatura } from '../lib/construtoraPortal'

interface Agendada {
  solicitacao_id: string; protocolo: string; tipo_ato: string | null
  quando: string; local: string | null; situacao: string
  empreendimento: string | null; unidade: string | null; construtora: string | null
  partes: string | null; contato_nome: string | null; contato_whatsapp: string | null
  minuta_id: string | null; minuta_versao: number | null; minuta_aprovada: boolean
  validacao: string; etapa: string
}
interface Pronta {
  solicitacao_id: string; protocolo: string; tipo_ato: string | null
  empreendimento: string | null; unidade: string | null; partes: string | null
  etapa: string; aprovada_em: string | null
}

const horaDe = (iso: string) =>
  new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

export default function Agendamentos() {
  const [itens, setItens] = useState<Agendada[]>([])
  const [prontas, setProntas] = useState<Pronta[]>([])
  const [de, setDe] = useState(diaISO())
  const [ate, setAte] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() + 30); return diaISO(d)
  })
  const [minuta, setMinuta] = useState<{ protocolo: string; texto: string } | null>(null)
  const [agendando, setAgendando] = useState<string | null>(null)
  const [form, setForm] = useState({ quando: '', local: '' })
  const [busy, setBusy] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function carregar() {
    setErro(null)
    try {
      const { data: u } = await supabase.auth.getUser()
      const { data: prof } = await supabase.from('profiles').select('cartorio_id').eq('id', u!.user!.id).maybeSingle()
      const cid = (prof as any)?.cartorio_id
      if (!cid) return
      const [a, p] = await Promise.all([
        supabase.rpc('agenda_assinaturas', { p_cartorio: cid, p_de: de || null, p_ate: ate || null }),
        supabase.rpc('prontos_para_agendar', { p_cartorio: cid }),
      ])
      if (a.error) throw new Error(a.error.message)
      setItens((a.data as Agendada[]) ?? [])
      setProntas((p.data as Pronta[]) ?? [])
    } catch (e: any) { setErro(e.message) }
  }
  useEffect(() => { carregar() }, [de, ate])

  async function verMinuta(solicitacaoId: string, protocolo: string) {
    const { data } = await supabase.from('minutas')
      .select('conteudo, versao').eq('solicitacao_id', solicitacaoId)
      .order('versao', { ascending: false }).limit(1).maybeSingle()
    setMinuta({ protocolo, texto: (data as any)?.conteudo ?? 'Minuta não encontrada.' })
  }

  // agrupa por dia — é assim que o cartório organiza a pauta
  const porDia = useMemo(() => {
    const ordem: string[] = []
    const mapa = new Map<string, Agendada[]>()
    for (const i of itens) {
      const d = diaISO(new Date(i.quando))
      if (!mapa.has(d)) { mapa.set(d, []); ordem.push(d) }
      mapa.get(d)!.push(i)
    }
    return ordem.map(d => ({ dia: d, itens: mapa.get(d)! }))
  }, [itens])

  const hoje = diaISO()

  return (
    <Layout>
      <div className="flex items-end justify-between gap-3 flex-wrap mb-4">
        <div>
          <div className="text-[11px] font-semibold tracking-[.14em] text-brass uppercase">Pauta</div>
          <h1 className="font-serif text-2xl font-bold text-navy leading-tight">Agenda de assinaturas</h1>
          <p className="text-sm text-ink/60">
            As datas marcadas, com a minuta aprovada e as partes de cada ato.
          </p>
        </div>
        <div className="flex gap-2 items-end flex-wrap">
          <label className="text-[11px] text-ink/55">De
            <input className="input" type="date" value={de} onChange={e => setDe(e.target.value)} /></label>
          <label className="text-[11px] text-ink/55">Até
            <input className="input" type="date" value={ate} onChange={e => setAte(e.target.value)} /></label>
        </div>
      </div>

      {erro && <div className="text-sm text-red-600 mb-3">{erro}</div>}

      {/* pauta */}
      {porDia.length === 0 ? (
        <div className="rounded-xl border border-dashed border-black/20 p-8 text-center mb-5">
          <div className="font-serif text-lg text-navy">Nenhuma assinatura marcada no período</div>
          <p className="text-[13px] text-ink/55 mt-1">Os atos prontos para agendar aparecem abaixo.</p>
        </div>
      ) : porDia.map(g => (
        <div key={g.dia} className="mb-5">
          <h2 className="font-serif text-lg font-bold text-navy mb-2 first-letter:uppercase">
            {dataExtenso(new Date(g.dia + 'T12:00:00'))}
            {g.dia === hoje && <span className="badge bg-brass/15 text-brass ml-2">hoje</span>}
          </h2>
          <div className="space-y-2">
            {g.itens.map(i => (
              <div key={i.solicitacao_id} className="rounded-xl border border-black/10 bg-white p-4">
                <div className="flex items-start gap-3 flex-wrap">
                  <div className="shrink-0 text-center" style={{ minWidth: 58 }}>
                    <div className="font-serif text-xl font-bold text-navy" style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {horaDe(i.quando)}
                    </div>
                    {i.situacao === 'remarcada' && <div className="text-[10px] text-ink/45">remarcada</div>}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Link to={`/s/${i.solicitacao_id}`} className="font-medium text-navy hover:underline">
                        {i.tipo_ato ?? 'Ato'}
                      </Link>
                      <span className="font-mono text-[11px] text-ink/50">{i.protocolo}</span>
                      {i.minuta_aprovada
                        ? <span className="badge" style={{ background: '#EAF6EF', color: '#14532D' }}>minuta aprovada</span>
                        : <span className="badge" style={{ background: '#FFF8E8', color: '#A9761B' }}>
                            {i.validacao === 'enviada' ? 'aguardando construtora' : 'validação pendente'}
                          </span>}
                    </div>
                    {(i.empreendimento || i.unidade) && (
                      <div className="text-[12px] text-ink/60">
                        {i.empreendimento}{i.unidade ? ` · unidade ${i.unidade}` : ''}
                        {i.construtora ? ` · ${i.construtora}` : ''}
                      </div>
                    )}
                    {i.partes && <div className="text-[12px] text-ink/70 mt-0.5">{i.partes}</div>}
                    <div className="text-[11px] text-ink/50 mt-0.5">
                      {i.local ? `Local: ${i.local}` : 'Local não informado'}
                      {i.contato_nome ? ` · contato: ${i.contato_nome}` : ''}
                      {i.contato_whatsapp ? ` (${i.contato_whatsapp})` : ''}
                    </div>
                  </div>

                  <div className="shrink-0 text-right">
                    {i.minuta_id && (
                      <button className="text-[12px] text-navy underline block"
                        onClick={() => verMinuta(i.solicitacao_id, i.protocolo)}>
                        ver minuta v{i.minuta_versao}
                      </button>
                    )}
                    <button className="text-[12px] text-navy underline block mt-1"
                      onClick={() => { setAgendando(i.solicitacao_id); setForm({ quando: '', local: i.local ?? '' }) }}>
                      remarcar
                    </button>
                  </div>
                </div>

                {agendando === i.solicitacao_id && (
                  <div className="mt-2 pt-2 border-t border-black/5 flex gap-2 flex-wrap items-end">
                    <input className="input" type="datetime-local" style={{ width: 'auto' }}
                      value={form.quando} onChange={e => setForm({ ...form, quando: e.target.value })} />
                    <input className="input" placeholder="Local" style={{ width: 'auto' }}
                      value={form.local} onChange={e => setForm({ ...form, local: e.target.value })} />
                    <button className="btn-primary" disabled={busy || !form.quando} onClick={async () => {
                      setBusy(true); setErro(null)
                      try {
                        const r = await agendarAssinatura(i.solicitacao_id, new Date(form.quando).toISOString(), form.local)
                        if (!r.ok) { setErro(r.erro ?? 'Falha ao remarcar.'); return }
                        setAgendando(null); await carregar()
                      } catch (e: any) { setErro(e.message) } finally { setBusy(false) }
                    }}>Salvar</button>
                    <button className="btn-ghost" onClick={() => setAgendando(null)}>cancelar</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* prontos para agendar */}
      <div className="card p-5">
        <h2 className="font-semibold text-navy">Prontos para agendar ({prontas.length})</h2>
        <p className="text-xs text-ink/55 mb-2">
          Atos aprovados e ainda sem data. Quando há construtora, só aparecem depois da aprovação do jurídico.
        </p>
        {prontas.length === 0 ? (
          <p className="text-[12px] text-ink/50">Nenhum ato aguardando agendamento.</p>
        ) : prontas.map(p => (
          <div key={p.solicitacao_id} className="rounded-lg bg-paper px-3 py-2 mb-1.5">
            <div className="flex items-center gap-2 flex-wrap">
              <Link to={`/s/${p.solicitacao_id}`} className="text-[13px] font-medium text-navy hover:underline">
                {p.tipo_ato ?? 'Ato'}
              </Link>
              <span className="font-mono text-[11px] text-ink/50">{p.protocolo}</span>
              {p.empreendimento && (
                <span className="text-[11px] text-ink/55">{p.empreendimento}{p.unidade ? ` · un. ${p.unidade}` : ''}</span>
              )}
            </div>
            {p.partes && <div className="text-[11px] text-ink/55">{p.partes}</div>}
            <div className="mt-1 flex gap-2 flex-wrap items-end">
              <input className="input" type="datetime-local" style={{ width: 'auto' }}
                value={agendando === p.solicitacao_id ? form.quando : ''}
                onFocus={() => { setAgendando(p.solicitacao_id); setForm({ quando: '', local: '' }) }}
                onChange={e => setForm({ ...form, quando: e.target.value })} />
              <input className="input" placeholder="Local" style={{ width: 'auto' }}
                value={agendando === p.solicitacao_id ? form.local : ''}
                onFocus={() => setAgendando(p.solicitacao_id)}
                onChange={e => setForm({ ...form, local: e.target.value })} />
              <button className="btn-brass" disabled={busy || agendando !== p.solicitacao_id || !form.quando}
                onClick={async () => {
                  setBusy(true); setErro(null)
                  try {
                    const r = await agendarAssinatura(p.solicitacao_id, new Date(form.quando).toISOString(), form.local)
                    if (!r.ok) { setErro(r.erro ?? 'Falha ao agendar.'); return }
                    setAgendando(null); await carregar()
                  } catch (e: any) { setErro(e.message) } finally { setBusy(false) }
                }}>Agendar</button>
            </div>
          </div>
        ))}
      </div>

      {/* leitura da minuta */}
      {minuta && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(14,28,54,.45)', display: 'flex',
                      alignItems: 'flex-start', justifyContent: 'center', padding: '2rem 1rem', overflowY: 'auto', zIndex: 50 }}
             onClick={e => { if (e.target === e.currentTarget) setMinuta(null) }}>
          <div className="card p-5" style={{ maxWidth: 820, width: '100%' }}>
            <div className="flex items-start justify-between gap-3">
              <h2 className="font-serif text-lg font-bold text-navy">Minuta · {minuta.protocolo}</h2>
              <button className="text-ink/40 hover:text-navy text-xl leading-none" onClick={() => setMinuta(null)}>×</button>
            </div>
            <div className="mt-3 rounded-lg border border-black/10 bg-paper p-3"
                 style={{ maxHeight: '60vh', overflowY: 'auto', whiteSpace: 'pre-wrap', fontSize: '.82rem', lineHeight: 1.6 }}>
              {minuta.texto}
            </div>
          </div>
        </div>
      )}
    </Layout>
  )
}

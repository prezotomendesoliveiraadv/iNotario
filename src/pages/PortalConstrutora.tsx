import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { dataHora } from '../lib/tempo'
import {
  minhasConstrutoras, painelConstrutora, minutaDoAto, decidirValidacao, historicoValidacao,
  VALIDACAO_LABEL, VALIDACAO_COR,
  type LinhaPainelConstrutora, type RodadaValidacao,
} from '../lib/construtoraPortal'

/**
 * Portal da construtora — usuário externo ao cartório.
 * Vê apenas os atos dos próprios empreendimentos. O jurídico aprova ou devolve
 * a minuta; o gestor apenas acompanha. Ninguém aqui edita o texto da escritura.
 */
export default function PortalConstrutora() {
  const { profile, signOut } = useAuth() as any
  const [construtoras, setConstrutoras] = useState<{ id: string; razao_social: string; papel: string }[]>([])
  const [ativa, setAtiva] = useState<string>('')
  const [linhas, setLinhas] = useState<LinhaPainelConstrutora[]>([])
  const [aberto, setAberto] = useState<LinhaPainelConstrutora | null>(null)
  const [minuta, setMinuta] = useState<{ conteudo: string; versao: number } | null>(null)
  const [hist, setHist] = useState<RodadaValidacao[]>([])
  const [obs, setObs] = useState('')
  const [busy, setBusy] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const papel = construtoras.find(c => c.id === ativa)?.papel ?? 'gestor'
  const ehJuridico = papel === 'juridico'

  useEffect(() => {
    minhasConstrutoras().then(cs => {
      setConstrutoras(cs)
      if (cs.length && !ativa) setAtiva(cs[0].id)
    }).catch(e => setErro(e.message))
  }, [])

  async function carregar() {
    if (!ativa) return
    try { setLinhas(await painelConstrutora(ativa)) } catch (e: any) { setErro(e.message) }
  }
  useEffect(() => { carregar() }, [ativa])

  async function abrir(l: LinhaPainelConstrutora) {
    setAberto(l); setMinuta(null); setHist([]); setObs(''); setErro(null); setMsg(null)
    const [m, h] = await Promise.all([minutaDoAto(l.solicitacao_id), historicoValidacao(l.solicitacao_id)])
    setMinuta(m); setHist(h)
  }

  async function decidir(decisao: 'aprovada' | 'ressalvas' | 'reprovada') {
    if (!aberto) return
    if (decisao !== 'aprovada' && !obs.trim()) { setErro('Descreva as ressalvas para o cartório.'); return }
    setBusy(true); setErro(null); setMsg(null)
    try {
      const r = await decidirValidacao(aberto.solicitacao_id, decisao, obs.trim() || undefined, profile?.nome)
      if (!r.ok) { setErro((r as any).erro ?? 'Não foi possível registrar a decisão.'); return }
      setMsg(decisao === 'aprovada'
        ? 'Minuta aprovada. O cartório foi liberado para agendar a assinatura.'
        : 'Devolvida ao cartório com as suas observações.')
      await carregar(); setAberto(null)
    } catch (e: any) { setErro(e.message) } finally { setBusy(false) }
  }

  const pendentes = useMemo(() => linhas.filter(l => l.validacao === 'enviada'), [linhas])
  const agendadas = useMemo(() => linhas.filter(l => l.assinatura_em), [linhas])

  // agrupamento por empreendimento
  const porEmpreendimento = useMemo(() => {
    const ordem: string[] = []
    const mapa = new Map<string, LinhaPainelConstrutora[]>()
    for (const l of linhas) {
      if (!mapa.has(l.empreendimento)) { mapa.set(l.empreendimento, []); ordem.push(l.empreendimento) }
      mapa.get(l.empreendimento)!.push(l)
    }
    return ordem.map(nome => ({ nome, itens: mapa.get(nome)! }))
  }, [linhas])

  if (construtoras.length === 0) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--paper)', padding: '3rem 1rem' }}>
        <div className="card p-6" style={{ maxWidth: 560, margin: '0 auto' }}>
          <h1 className="font-serif text-xl font-bold text-navy">Portal da construtora</h1>
          <p className="text-sm text-ink/65 mt-2">
            Seu usuário ainda não está vinculado a nenhuma construtora. Fale com o cartório para liberar o acesso.
          </p>
          <button className="btn-ghost mt-3" onClick={() => signOut?.()}>Sair</button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--paper)' }}>
      {/* cabeçalho próprio: este usuário não é do cartório */}
      <header style={{ background: 'var(--navy)', color: '#fff', padding: '1rem 1.25rem' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div className="font-serif" style={{ fontSize: '1.15rem', fontWeight: 700 }}>iNotário</div>
            <div style={{ fontSize: '.7rem', letterSpacing: '.14em', color: 'var(--brass-light, #E3C57E)' }}>
              PORTAL DA CONSTRUTORA
            </div>
          </div>
          {construtoras.length > 1 && (
            <select className="input" style={{ width: 'auto' }} value={ativa} onChange={e => setAtiva(e.target.value)}>
              {construtoras.map(c => <option key={c.id} value={c.id}>{c.razao_social}</option>)}
            </select>
          )}
          <div style={{ textAlign: 'right', fontSize: '.8rem' }}>
            <div>{profile?.nome ?? 'Usuário'}</div>
            <div style={{ opacity: .6, fontSize: '.72rem' }}>{ehJuridico ? 'Jurídico' : 'Acompanhamento'}</div>
          </div>
          <button className="btn-ghost" style={{ color: '#fff', borderColor: 'rgba(255,255,255,.3)' }}
            onClick={() => signOut?.()}>Sair</button>
        </div>
      </header>

      <main style={{ maxWidth: 1100, margin: '0 auto', padding: '1.5rem 1.25rem' }}>
        {erro && <div className="text-sm text-red-600 mb-3">{erro}</div>}
        {msg && <div className="text-sm text-emerald-700 mb-3">{msg}</div>}

        {/* fila de decisão — o que exige ação do jurídico */}
        <div className="card p-5 mb-5">
          <h2 className="font-semibold text-navy">
            {ehJuridico ? 'Aguardando sua validação' : 'Aguardando validação do jurídico'}
            {pendentes.length > 0 && <span className="badge bg-navy text-white ml-2">{pendentes.length}</span>}
          </h2>
          {pendentes.length === 0 ? (
            <p className="text-[13px] text-ink/55 mt-1">Nenhuma minuta aguardando decisão.</p>
          ) : (
            <div className="mt-2 space-y-1.5">
              {pendentes.map(l => (
                <button key={l.solicitacao_id} onClick={() => abrir(l)}
                  className="w-full text-left flex items-center gap-3 rounded-lg border border-black/10 bg-white px-3 py-2 hover:border-brass transition">
                  <span className="flex-1 min-w-0">
                    <span className="block text-[13px] font-medium text-navy truncate">
                      {l.empreendimento} · unidade {l.unidade ?? '—'}
                    </span>
                    <span className="block text-[11px] text-ink/50 truncate">
                      <span className="font-mono">{l.protocolo}</span>
                      {l.comprador ? ` · ${l.comprador}` : ''}
                      {l.enviada_em ? ` · enviada em ${dataHora(new Date(l.enviada_em))}` : ''}
                    </span>
                  </span>
                  <span className="badge shrink-0" style={{ background: '#F3F1EC', color: VALIDACAO_COR.enviada }}>
                    analisar
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* próximas assinaturas */}
        {agendadas.length > 0 && (
          <div className="card p-5 mb-5">
            <h2 className="font-semibold text-navy">Assinaturas agendadas</h2>
            <ul className="mt-2 space-y-1">
              {agendadas.map(l => (
                <li key={l.solicitacao_id} className="text-[13px] flex gap-2">
                  <span className="text-navy font-medium">{dataHora(new Date(l.assinatura_em!))}</span>
                  <span className="text-ink/65">
                    {l.empreendimento} · un. {l.unidade ?? '—'}{l.assinatura_local ? ` · ${l.assinatura_local}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* panorama por empreendimento */}
        {porEmpreendimento.map(g => (
          <div key={g.nome} className="card p-5 mb-4">
            <h2 className="font-semibold text-navy mb-2">{g.nome}</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]" style={{ minWidth: 620 }}>
                <thead>
                  <tr className="text-[11px] text-ink/55 border-b border-black/10">
                    <th className="px-2 py-1.5 text-left">Unidade</th>
                    <th className="px-2 py-1.5 text-left">Protocolo</th>
                    <th className="px-2 py-1.5 text-left">Comprador</th>
                    <th className="px-2 py-1.5 text-left">Situação</th>
                    <th className="px-2 py-1.5 text-left">Assinatura</th>
                    <th className="px-2 py-1.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {g.itens.map(l => (
                    <tr key={l.solicitacao_id} className="border-b border-black/5">
                      <td className="px-2 py-2 font-medium text-navy">{l.unidade ?? '—'}</td>
                      <td className="px-2 py-2 font-mono text-[11px] text-ink/55">{l.protocolo}</td>
                      <td className="px-2 py-2 text-ink/70 truncate" style={{ maxWidth: 180 }}>{l.comprador ?? '—'}</td>
                      <td className="px-2 py-2">
                        <span style={{ color: VALIDACAO_COR[l.validacao] }}>{VALIDACAO_LABEL[l.validacao]}</span>
                      </td>
                      <td className="px-2 py-2 text-[12px] text-ink/60">
                        {l.assinatura_em ? dataHora(new Date(l.assinatura_em)) : '—'}
                      </td>
                      <td className="px-2 py-2 text-right">
                        <button className="text-[12px] text-navy underline" onClick={() => abrir(l)}>ver minuta</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </main>

      {/* leitura da minuta e decisão */}
      {aberto && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(14,28,54,.45)', display: 'flex',
                      alignItems: 'flex-start', justifyContent: 'center', padding: '2rem 1rem', overflowY: 'auto', zIndex: 50 }}
             onClick={e => { if (e.target === e.currentTarget) setAberto(null) }}>
          <div className="card p-5" style={{ maxWidth: 820, width: '100%' }}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-serif text-lg font-bold text-navy">
                  {aberto.empreendimento} · unidade {aberto.unidade ?? '—'}
                </h2>
                <p className="text-[12px] text-ink/55">
                  <span className="font-mono">{aberto.protocolo}</span>
                  {aberto.comprador ? ` · comprador: ${aberto.comprador}` : ''}
                  {minuta ? ` · minuta v${minuta.versao}` : ''}
                </p>
              </div>
              <button className="text-ink/40 hover:text-navy text-xl leading-none" onClick={() => setAberto(null)}>×</button>
            </div>

            <div className="mt-3 rounded-lg border border-black/10 bg-paper p-3"
                 style={{ maxHeight: 340, overflowY: 'auto', whiteSpace: 'pre-wrap', fontSize: '.82rem', lineHeight: 1.6 }}>
              {minuta?.conteudo ?? 'Carregando a minuta…'}
            </div>

            {hist.length > 0 && (
              <details className="mt-3">
                <summary className="text-[13px] font-semibold text-navy cursor-pointer">Histórico ({hist.length})</summary>
                <ul className="mt-1.5 space-y-1">
                  {hist.map(h => (
                    <li key={h.id} className="text-[12px] text-ink/70">
                      <span className="text-ink/45">{dataHora(new Date(h.created_at))} · rodada {h.rodada} · </span>
                      {h.acao}{h.observacoes ? ` — ${h.observacoes}` : ''}
                    </li>
                  ))}
                </ul>
              </details>
            )}

            {ehJuridico && aberto.validacao === 'enviada' ? (
              <div className="mt-3">
                <label className="label">Observações (obrigatórias ao devolver)</label>
                <textarea className="input" style={{ minHeight: 70 }} value={obs}
                  onChange={e => setObs(e.target.value)}
                  placeholder="Ex.: ajustar a cláusula de forma de pagamento conforme o contrato." />
                <div className="flex gap-2 mt-2 flex-wrap">
                  <button className="btn-primary" disabled={busy} onClick={() => decidir('aprovada')}>
                    {busy ? '…' : 'Aprovar minuta'}
                  </button>
                  <button className="btn-ghost" disabled={busy} onClick={() => decidir('ressalvas')}>
                    Devolver com ressalvas
                  </button>
                  <button className="btn-ghost" style={{ color: '#B3261E' }} disabled={busy}
                    onClick={() => decidir('reprovada')}>Reprovar</button>
                </div>
                <p className="text-[11px] text-ink/45 mt-2">
                  Aprovando, o cartório fica liberado para finalizar a escritura e agendar a assinatura com o comprador.
                </p>
              </div>
            ) : (
              <p className="text-[12px] text-ink/55 mt-3">
                {aberto.validacao === 'enviada'
                  ? 'Somente o jurídico da construtora pode decidir sobre esta minuta.'
                  : `Situação: ${VALIDACAO_LABEL[aberto.validacao]}.`}
              </p>
            )}

            {erro && <div className="text-sm text-red-600 mt-2">{erro}</div>}
          </div>
        </div>
      )}
    </div>
  )
}

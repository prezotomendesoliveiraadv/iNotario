import { useEffect, useState } from 'react'
import { dataCurta, dataHora } from '../lib/tempo'
import { consultarJuridico, historicoConsultas, type Parecer } from '../lib/melhorias'

const SUGESTOES = [
  'Quais exigências para lavrar com procuração por instrumento particular?',
  'Vendedor casado em separação obrigatória: precisa de outorga conjugal?',
  'Imóvel com alienação fiduciária: como proceder na venda?',
  'Doação com reserva de usufruto: requisitos e tributação.',
]

export default function ConsultaJuridicaCard({
  solicitacaoId, titulo = 'Consulta jurídica',
}: { solicitacaoId?: string; titulo?: string }) {
  const [pergunta, setPergunta] = useState('')
  const [res, setRes] = useState<Parecer | null>(null)
  const [hist, setHist] = useState<Parecer[]>([])
  const [busy, setBusy] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => { historicoConsultas(solicitacaoId, 5).then(setHist).catch(() => {}) }, [solicitacaoId])

  async function consultar(p?: string) {
    const q = (p ?? pergunta).trim()
    if (!q && !solicitacaoId) { setErro('Escreva a sua consulta.'); return }
    setBusy(true); setErro(null); setRes(null)
    try {
      const r = await consultarJuridico({ pergunta: q || undefined, solicitacaoId })
      setRes(r)
      historicoConsultas(solicitacaoId, 5).then(setHist).catch(() => {})
    } catch (e: any) { setErro(e.message ?? 'Falha na consulta.') } finally { setBusy(false) }
  }

  return (
    <div className="card p-5 mb-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-semibold text-navy">{titulo}</h2>
          <p className="text-xs text-ink/55">
            A Artemis confronta o <b>acervo do cartório</b> (jurisprudências e orientações do tabelião)
            com a <b>legislação notarial</b> e devolve um parecer fundamentado.
          </p>
        </div>
        {solicitacaoId && (
          <button className="btn-ghost shrink-0" disabled={busy} onClick={() => consultar('')}>
            {busy ? 'Analisando…' : 'Analisar este protocolo'}
          </button>
        )}
      </div>

      <div className="flex gap-2 mt-3">
        <textarea className="input flex-1" style={{ minHeight: 60 }}
          placeholder={solicitacaoId
            ? 'Pergunte algo específico sobre este ato — ou use "Analisar este protocolo".'
            : 'Descreva a dúvida jurídica…'}
          value={pergunta} onChange={e => setPergunta(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) consultar() }} />
        <button className="btn-primary self-start" disabled={busy || (!pergunta.trim() && !solicitacaoId)}
          onClick={() => consultar()}>{busy ? '…' : 'Consultar'}</button>
      </div>

      {!res && !busy && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {SUGESTOES.map(s => (
            <button key={s} className="text-[11px] px-2 py-1 rounded-full bg-paper text-ink/70 hover:text-navy hover:bg-brass/10"
              onClick={() => { setPergunta(s); consultar(s) }}>{s}</button>
          ))}
        </div>
      )}

      {erro && <div className="text-sm text-red-600 mt-3">{erro}</div>}

      {res && (
        <div className="mt-4 space-y-3">
          <div>
            <div className="eyebrow mb-1">Parecer</div>
            <div className="text-sm leading-relaxed" style={{ whiteSpace: 'pre-wrap' }}>{res.parecer}</div>
          </div>

          {(res.fundamentos ?? []).length > 0 && (
            <div>
              <div className="eyebrow mb-1">Fundamentos legais</div>
              <div className="space-y-1">
                {res.fundamentos.map((f, i) => (
                  <div key={i} className="text-[13px] border-l-2 border-brass/60 pl-2">
                    <b className="text-navy">{f.norma}{f.dispositivo ? `, ${f.dispositivo}` : ''}</b>
                    <span className="text-ink/70"> — {f.aplicacao}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {(res.fontes_acervo ?? []).length > 0 && (
            <div>
              <div className="eyebrow mb-1">Acervo do cartório utilizado</div>
              <ul className="text-[13px] space-y-0.5">
                {res.fontes_acervo.map((f, i) => (
                  <li key={i} className="flex gap-2">
                    <span className={`badge shrink-0 ${
                      f.como_usado === 'divergente' ? 'bg-amber-50 text-amber-800'
                      : f.como_usado === 'convergente' ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}>
                      {f.como_usado ?? 'fonte'}
                    </span>
                    <span className="text-ink/75">{f.titulo}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {res.divergencias && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-[13px] text-amber-900">
              <b>Divergência entre o acervo interno e a legislação:</b> {res.divergencias}
            </div>
          )}

          {res.ressalvas && (
            <div className="text-[12px] text-ink/60"><b>Ressalvas:</b> {res.ressalvas}</div>
          )}

          <p className="text-[11px] text-ink/45 border-t border-black/5 pt-2">
            Parecer de apoio gerado por IA a partir do acervo e da legislação — confira os dispositivos citados.
            A decisão e a fé pública são do tabelião.
          </p>
        </div>
      )}

      {hist.length > 0 && (
        <details className="mt-4">
          <summary className="text-sm font-semibold text-navy cursor-pointer">Consultas anteriores ({hist.length})</summary>
          <div className="mt-2 space-y-2">
            {hist.map(h => (
              <div key={h.id} className="text-[12px] border-l-2 border-black/10 pl-2">
                <div className="text-ink/50">{h.created_at ? dataHora(new Date(h.created_at)) : ''}</div>
                <div className="font-medium text-navy">{h.pergunta}</div>
                <div className="text-ink/70 line-clamp-2">{(h.parecer ?? '').slice(0, 180)}…</div>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}

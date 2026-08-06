import { useEffect, useState } from 'react'
import { dataCurta, dataHora } from '../lib/tempo'
import {
  preQualificarRegistro, ultimaPreQualRegistral, APTIDAO_COR,
  type PreQualRegistral, type ItemRegistral,
} from '../lib/registro'

const SIT_LABEL: Record<string, string> = { ok: 'ok', exigencia: 'exigência', bloqueio: 'impeditivo' }
const SIT_COR: Record<string, string> = {
  ok: 'bg-emerald-50 text-emerald-700', exigencia: 'bg-amber-50 text-amber-800', bloqueio: 'bg-red-50 text-red-700',
}

export default function PreQualRegistralCard({ solicitacaoId }: { solicitacaoId: string }) {
  const [res, setRes] = useState<PreQualRegistral | null>(null)
  const [busy, setBusy] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => { ultimaPreQualRegistral(solicitacaoId).then(setRes).catch(() => {}) }, [solicitacaoId])

  async function rodar() {
    setBusy(true); setErro(null)
    try { setRes(await preQualificarRegistro(solicitacaoId)) }
    catch (e: any) { setErro(e.message ?? 'Falha na pré-qualificação.') } finally { setBusy(false) }
  }

  // agrupa por princípio registral
  const grupos: Record<string, ItemRegistral[]> = {}
  for (const it of res?.itens ?? []) (grupos[it.principio] ??= []).push(it)
  const pendencias = (res?.itens ?? []).filter(i => i.situacao !== 'ok').length

  return (
    <div className="card p-5 mb-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="font-semibold text-navy">Pré-qualificação registral</h2>
          <p className="text-xs text-ink/50">Aponta o que geraria exigência no Registro de Imóveis — para o título sair "registro-ready".</p>
        </div>
        <button className="btn-ghost" disabled={busy} onClick={rodar}>{busy ? 'Analisando…' : res ? 'Reavaliar' : 'Avaliar aptidão'}</button>
      </div>

      {erro && <div className="text-sm text-red-600 mt-3">{erro}</div>}

      {res && (
        <div className="mt-3">
          <div className={`rounded-lg border px-3 py-2 text-sm ${APTIDAO_COR[res.aptidao]}`}>
            <b>{res.aptidao_label}</b> · {res.resumo}
          </div>

          {Object.entries(grupos).map(([principio, itens]) => (
            <div key={principio} className="mt-3">
              <div className="text-xs font-semibold text-navy/80 uppercase tracking-wide">{principio}</div>
              {itens.map((it, i) => (
                <div key={i} className="flex items-start gap-2 text-sm py-1 border-b border-black/5 last:border-0">
                  <span className={`badge shrink-0 ${SIT_COR[it.situacao]}`}>{SIT_LABEL[it.situacao]}</span>
                  <span className="min-w-0">
                    <span className="font-medium">{it.item}</span>
                    <span className="block text-xs text-ink/60">{it.fundamento}</span>
                  </span>
                </div>
              ))}
            </div>
          ))}

          {pendencias === 0 && <div className="text-sm text-emerald-700 mt-2">Nenhuma pendência registral detectada nos pontos essenciais.</div>}

          {res.nota_ia && (
            <div className="mt-3 rounded-lg bg-paper p-3 text-sm">
              <div className="eyebrow mb-1">Leitura complementar da Artemis</div>
              <div style={{ whiteSpace: 'pre-wrap' }}>{res.nota_ia}</div>
            </div>
          )}
          {res.gerado_em && <div className="text-xs text-ink/40 mt-2">Avaliado em {dataHora(new Date(res.gerado_em))}. A conferência final é do tabelião/registrador.</div>}
        </div>
      )}
    </div>
  )
}

import { useEffect, useState } from 'react'
import { dataCurta, dataHora } from '../lib/tempo'
import { Layout } from '../components/ui'
import { supabase } from '../lib/supabase'
import {
  meuPlano, minhasFaturas, usoDoMes, brl, competenciaAtual,
  type Plano, type Fatura, type UsoMes,
} from '../lib/faturamento'

function Kpi({ label, valor, destaque }: { label: string; valor: string | number; destaque?: boolean }) {
  return (
    <div className="card p-4">
      <div className="text-xs text-ink/50">{label}</div>
      <div className={`font-serif font-bold ${destaque ? 'text-brass' : 'text-navy'}`} style={{ fontSize: '1.6rem' }}>{valor}</div>
    </div>
  )
}

export default function UsoCartorio() {
  const [cartorioId, setCartorioId] = useState<string | null>(null)
  const [comp, setComp] = useState(competenciaAtual())
  const [plano, setPlano] = useState<Plano | null>(null)
  const [faturas, setFaturas] = useState<Fatura[]>([])
  const [uso, setUso] = useState<UsoMes | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser()
      if (!u?.user) return
      const { data: prof } = await supabase.from('profiles').select('cartorio_id').eq('id', u.user.id).maybeSingle()
      setCartorioId((prof as any)?.cartorio_id ?? null)
    })()
  }, [])

  useEffect(() => {
    if (!cartorioId) return
    ;(async () => {
      try {
        setPlano(await meuPlano(cartorioId))
        setFaturas(await minhasFaturas(cartorioId))
        setUso(await usoDoMes(cartorioId, comp))
      } catch (e: any) { setErro(e.message) }
    })()
  }, [cartorioId, comp])

  const estimativa = plano && uso
    ? Number(plano.valor_fixo) + uso.concluidas * Number(plano.valor_ato)
    : null
  const fatComp = faturas.find(f => f.competencia === comp) ?? null
  const vencida = plano?.validade ? new Date(plano.validade + 'T23:59:59') < new Date() : false

  return (
    <Layout title="Uso e faturamento">
      {vencida && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 text-red-800 px-4 py-3 text-sm">
          Sua assinatura venceu em {dataCurta(new Date(plano!.validade! + 'T12:00:00'))}. Fale com a plataforma para renovar.
        </div>
      )}

      <div className="flex items-end justify-between flex-wrap gap-2 mb-4">
        <div>
          <div className="eyebrow">Competência</div>
          <input type="month" className="input w-auto" value={comp} onChange={e => setComp(e.target.value)} />
        </div>
        {plano && (
          <div className="text-right text-sm text-ink/70">
            Plano: <b>{brl(plano.valor_fixo)}/mês</b> + <b>{brl(plano.valor_ato)}/ato</b>
            {plano.validade && <span className="text-ink/50"> · validade {dataCurta(new Date(plano.validade + 'T12:00:00'))}</span>}
          </div>
        )}
      </div>

      {erro && <div className="text-sm text-red-600 mb-3">{erro}</div>}

      {/* KPIs */}
      <div className="grid md:grid-cols-4 gap-4 mb-5">
        <Kpi label="Atos efetivados no mês" valor={uso?.concluidas ?? '—'} />
        <Kpi label="Em andamento (agora)" valor={uso?.emAndamento ?? '—'} />
        <Kpi label="Vindos do atendimento IA" valor={uso?.externas ?? '—'} />
        <Kpi label={fatComp ? `Fatura ${comp}` : `Estimativa ${comp}`} valor={fatComp ? brl(fatComp.valor_total) : (estimativa != null ? brl(estimativa) : '—')} destaque />
      </div>

      <div className="grid lg:grid-cols-2 gap-5 mb-5">
        {/* Produtividade */}
        <div className="card p-5">
          <h2 className="font-semibold text-navy mb-2">Produtividade</h2>
          <div className="text-xs font-semibold text-ink/60 mb-1">Por tipo de ato</div>
          {(uso?.porTipo ?? []).length === 0 && <div className="text-xs text-ink/50">Sem atos concluídos na competência.</div>}
          {(uso?.porTipo ?? []).map(t => (
            <div key={t.tipo} className="flex items-center gap-2 text-sm py-0.5">
              <span className="flex-1">{t.tipo}</span>
              <span className="h-2 rounded bg-brass/70" style={{ width: `${Math.min(100, t.qtd / Math.max(1, uso!.concluidas) * 100)}%`, minWidth: 6 }} />
              <span className="w-8 text-right font-mono text-xs">{t.qtd}</span>
            </div>
          ))}
          {(uso?.porAprovador ?? []).length > 0 && (<>
            <div className="text-xs font-semibold text-ink/60 mt-3 mb-1">Aprovações por usuário</div>
            {(uso?.porAprovador ?? []).map(p => (
              <div key={p.nome} className="flex justify-between text-sm py-0.5">
                <span>{p.nome}</span><span className="font-mono text-xs">{p.qtd}</span>
              </div>
            ))}
          </>)}
        </div>

        {/* Extrato do mês */}
        <div className="card p-5">
          <h2 className="font-semibold text-navy mb-2">Extrato de utilização · {comp}</h2>
          {plano && uso && (
            <div className="text-sm bg-paper rounded-lg p-3 mb-2">
              Mensalidade fixa {brl(plano.valor_fixo)} + {uso.concluidas} atos × {brl(plano.valor_ato)} =
              <b> {brl(Number(plano.valor_fixo) + uso.concluidas * Number(plano.valor_ato))}</b>
              {!fatComp && <span className="text-ink/50"> (estimativa — fatura ainda não emitida)</span>}
            </div>
          )}
          <div className="max-h-64 overflow-auto border border-black/5 rounded-lg">
            {(uso?.atos ?? []).length === 0 && <div className="p-3 text-xs text-ink/50">Nenhum ato efetivado na competência.</div>}
            {(uso?.atos ?? []).map((a, i) => (
              <div key={i} className="flex justify-between px-3 py-1.5 text-xs border-b border-black/5">
                <span className="font-mono">{a.protocolo}</span>
                <span className="flex-1 px-2 truncate">{a.tipo ?? a.titulo}</span>
                <span className="text-ink/50">{dataCurta(new Date(a.concluida_em))}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Histórico de faturas */}
      <div className="card p-5">
        <h2 className="font-semibold text-navy mb-2">Faturas</h2>
        {faturas.length === 0 && <div className="text-xs text-ink/50">Nenhuma fatura emitida ainda.</div>}
        {faturas.map(f => (
          <div key={f.id} className="flex flex-wrap justify-between gap-2 text-sm border-b border-black/5 py-2">
            <span className="font-mono">{f.competencia}</span>
            <span>{f.qtd_atos} atos</span>
            <span>fixo {brl(f.valor_fixo)} + variável {brl(f.valor_variavel)}</span>
            <b>{brl(f.valor_total)}</b>
            <span className={`badge ${f.status === 'paga' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{f.status}</span>
          </div>
        ))}
      </div>
    </Layout>
  )
}

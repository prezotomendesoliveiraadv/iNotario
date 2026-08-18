import { useEffect, useState } from 'react'
import { dataCurta, dataHora } from '../lib/tempo'
import { Layout } from '../components/ui'
import { supabase } from '../lib/supabase'
import {
  meuPlano, minhasFaturas, usoDoMes, brl, competenciaAtual,
  demonstrativo, podeVerFaturamento,
  type Plano, type Fatura, type UsoMes, type Demonstrativo,
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
  const [dem, setDem] = useState<Demonstrativo | null>(null)
  const [autorizado, setAutorizado] = useState<boolean | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser()
      if (!u?.user) return
      const { data: prof } = await supabase.from('profiles').select('cartorio_id').eq('id', u.user.id).maybeSingle()
      const cid = (prof as any)?.cartorio_id ?? null
      setCartorioId(cid)
      // O gate real é do banco (pode_ver_faturamento + RLS). Isto aqui só evita
      // desenhar uma tela que viria vazia — esconder no front não é controle.
      setAutorizado(cid ? await podeVerFaturamento(cid) : false)
    })()
  }, [])

  useEffect(() => {
    if (!cartorioId) return
    ;(async () => {
      try {
        setPlano(await meuPlano(cartorioId))
        setFaturas(await minhasFaturas(cartorioId))
        setUso(await usoDoMes(cartorioId, comp))
        setDem(await demonstrativo(cartorioId, comp))
      } catch (e: any) { setErro(e.message) }
    })()
  }, [cartorioId, comp])

  const estimativa = plano && uso
    ? Number(plano.valor_fixo) + uso.concluidas * Number(plano.valor_ato)
    : null
  const fatComp = faturas.find(f => f.competencia === comp) ?? null
  const vencida = plano?.validade ? new Date(plano.validade + 'T23:59:59') < new Date() : false

  if (autorizado === false) {
    return (
      <Layout title="Uso e faturamento">
        <div className="card p-6 text-center">
          <div className="font-serif text-navy" style={{ fontSize: '1.1rem' }}>Acesso restrito</div>
          <p className="text-sm text-ink/60 mt-2">
            Esta tela mostra a cobrança do cartório e é liberada apenas para o nível de administração.
            Fale com quem administra os usuários da serventia.
          </p>
        </div>
      </Layout>
    )
  }
  if (autorizado === null) {
    return <Layout title="Uso e faturamento"><div className="card p-6 text-sm text-ink/50">Carregando…</div></Layout>
  }

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
        <Kpi label={fatComp ? `Fatura ${comp}` : `Estimativa ${comp}`} valor={fatComp ? brl(fatComp.valor_total) : (dem ? brl(dem.valor_total) : (estimativa != null ? brl(estimativa) : '—'))} destaque />
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

        {/* Demonstrativo da cobrança */}
        <div className="card p-5">
          <h2 className="font-semibold text-navy mb-2">Demonstrativo da cobrança · {comp}</h2>
          {dem && (
            <>
              <div className="border border-black/5 rounded-lg overflow-hidden mb-2">
                <div className="flex text-[11px] uppercase tracking-wider text-ink/50 bg-paper px-3 py-1.5">
                  <span className="flex-1">Item</span>
                  <span className="w-14 text-right">Qtde</span>
                  <span className="w-24 text-right">Unitário</span>
                  <span className="w-24 text-right">Total</span>
                </div>
                {dem.linhas.map(l => (
                  <div key={l.item} className="flex text-xs px-3 py-1.5 border-t border-black/5">
                    <span className="flex-1">{l.rotulo}</span>
                    <span className="w-14 text-right font-mono">{l.quantidade}</span>
                    <span className={`w-24 text-right font-mono ${Number(l.valor_unitario) === 0 ? 'text-amber-700' : ''}`}>
                      {Number(l.valor_unitario) === 0 ? '—' : brl(l.valor_unitario)}
                    </span>
                    <span className="w-24 text-right font-mono">{brl(l.valor_total)}</span>
                  </div>
                ))}
                <div className="flex text-xs px-3 py-1.5 border-t border-black/5">
                  <span className="flex-1">Base fixa mensal</span>
                  <span className="w-14" /><span className="w-24" />
                  <span className="w-24 text-right font-mono">{brl(dem.valor_fixo)}</span>
                </div>
                <div className="flex text-sm px-3 py-2 border-t-2 border-navy/15 bg-paper font-semibold">
                  <span className="flex-1">Total {comp}</span>
                  <span className="w-24 text-right font-mono text-brass">{brl(dem.valor_total)}</span>
                </div>
              </div>

              {dem.sem_preco.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 text-amber-900 px-3 py-2 text-xs mb-2">
                  Houve uso sem preço cadastrado em: <b>{dem.sem_preco.join(', ')}</b>.
                  Esses itens entraram como zero — não estão sendo cobrados.
                </div>
              )}

              <div className="text-[11px] text-ink/50 mb-2">
                {fatComp
                  ? 'Fatura já emitida para esta competência — os valores acima são os que a originaram.'
                  : 'Prévia: a fatura ainda não foi fechada e a contagem segue correndo até o fim do mês.'}
              </div>
            </>
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

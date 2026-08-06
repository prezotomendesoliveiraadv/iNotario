import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Layout } from '../components/ui'
import { dataHora } from '../lib/tempo'
import { listarConstrutoras, type Construtora } from '../lib/incorporacao'
import { painelInterno, type LinhaPainelInterno } from '../lib/construtoraPortal'
import { supabase } from '../lib/supabase'

interface Decisor {
  solicitacao_id: string; protocolo: string; empreendimento: string; unidade: string | null
  validacao: string; decidida_em: string | null; decidida_por: string | null; observacoes: string | null
}

/** Coluna do funil: número grande quando exige ação, discreto quando é só volume. */
function Celula({ n, cor, destaque }: { n: number; cor?: string; destaque?: boolean }) {
  return (
    <td className="px-3 py-2 text-center" style={{ fontVariantNumeric: 'tabular-nums' }}>
      <span className={destaque && n > 0 ? 'font-bold' : ''} style={{ color: n > 0 ? (cor ?? 'var(--ink)') : '#B8BEC9' }}>
        {n}
      </span>
    </td>
  )
}

export default function PainelConstrutoras() {
  const [construtoras, setConstrutoras] = useState<Construtora[]>([])
  const [filtro, setFiltro] = useState('')
  const [linhas, setLinhas] = useState<LinhaPainelInterno[]>([])
  const [carregando, setCarregando] = useState(true)
  const [decisores, setDecisores] = useState<Decisor[]>([])
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => { listarConstrutoras().then(setConstrutoras).catch(e => setErro(e.message)) }, [])

  useEffect(() => {
    setCarregando(true)
    painelInterno(filtro || undefined)
      .then(setLinhas).catch(e => setErro(e.message)).finally(() => setCarregando(false))
    // Quem decidiu por último — o nome facilita a conversa direta com a construtora
    supabase.auth.getUser().then(async ({ data: u }) => {
      if (!u?.user) return
      const { data: prof } = await supabase.from('profiles').select('cartorio_id').eq('id', u.user.id).maybeSingle()
      const cid = (prof as any)?.cartorio_id
      if (!cid) return
      const { data } = await supabase.rpc('decisores_construtora', {
        p_cartorio: cid, p_construtora: filtro || null,
      })
      setDecisores((data as Decisor[]) ?? [])
    })
  }, [filtro])

  const totais = useMemo(() => linhas.reduce((t, l) => ({
    atos: t.atos + Number(l.atos_total),
    aguardando: t.aguardando + Number(l.aguardando_construtora),
    ressalvas: t.ressalvas + Number(l.com_ressalvas),
    aprovadas: t.aprovadas + Number(l.aprovadas),
    agendadas: t.agendadas + Number(l.agendadas),
    concluidas: t.concluidas + Number(l.concluidas),
  }), { atos: 0, aguardando: 0, ressalvas: 0, aprovadas: 0, agendadas: 0, concluidas: 0 }), [linhas])

  // agrupa por construtora, preservando a ordem
  const grupos = useMemo(() => {
    const ordem: string[] = []
    const mapa = new Map<string, { nome: string; itens: LinhaPainelInterno[] }>()
    for (const l of linhas) {
      if (!mapa.has(l.construtora_id)) { mapa.set(l.construtora_id, { nome: l.construtora, itens: [] }); ordem.push(l.construtora_id) }
      mapa.get(l.construtora_id)!.itens.push(l)
    }
    return ordem.map(id => ({ id, ...mapa.get(id)! }))
  }, [linhas])

  return (
    <Layout>
      <div className="flex items-end justify-between gap-3 flex-wrap mb-4">
        <div>
          <div className="text-[11px] font-semibold tracking-[.14em] text-brass uppercase">Incorporação</div>
          <h1 className="font-serif text-2xl font-bold text-navy leading-tight">Painel de construtoras</h1>
          <p className="text-sm text-ink/60">
            O andamento das escrituras por empreendimento — e o que está parado na mão da construtora.
          </p>
        </div>
        <select className="input" style={{ width: 'auto' }} value={filtro} onChange={e => setFiltro(e.target.value)}>
          <option value="">Todas as construtoras</option>
          {construtoras.map(c => <option key={c.id} value={c.id}>{c.razao_social}</option>)}
        </select>
      </div>

      {erro && <div className="text-sm text-red-600 mb-3">{erro}</div>}

      {/* resumo */}
      <div className="grid gap-2 mb-5" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))' }}>
        {[
          { v: totais.atos, r: 'Atos no total' },
          { v: totais.aguardando, r: 'Na construtora', cor: '#1E3a63', destaque: true },
          { v: totais.ressalvas, r: 'Com ressalvas', cor: '#A9761B', destaque: true },
          { v: totais.aprovadas, r: 'Aprovadas', cor: '#1E7A4F' },
          { v: totais.agendadas, r: 'Assinaturas agendadas' },
          { v: totais.concluidas, r: 'Concluídas' },
        ].map(m => (
          <div key={m.r} className="rounded-xl border border-black/10 bg-white px-4 py-3">
            <div className="font-serif text-2xl font-bold" style={{ color: m.cor ?? '#0E1C36', fontVariantNumeric: 'tabular-nums' }}>
              {m.v}
            </div>
            <div className="text-[11px] text-ink/55 leading-tight">{m.r}</div>
          </div>
        ))}
      </div>

      {carregando ? (
        <div className="text-sm text-ink/50">Carregando…</div>
      ) : grupos.length === 0 ? (
        <div className="rounded-xl border border-dashed border-black/20 p-8 text-center">
          <div className="font-serif text-lg text-navy">Nenhum empreendimento com movimento</div>
          <p className="text-[13px] text-ink/55 mt-1">
            Cadastre construtoras e empreendimentos em <Link to="/construtoras" className="text-navy underline">Construtoras</Link>.
          </p>
        </div>
      ) : (
        grupos.map(g => (
          <div key={g.id} className="mb-5">
            <h2 className="font-serif text-lg font-bold text-navy mb-1">{g.nome}</h2>
            <div className="rounded-xl border border-black/10 bg-white overflow-hidden overflow-x-auto">
              <table className="w-full text-[13px]" style={{ minWidth: 720 }}>
                <thead>
                  <tr className="bg-navy text-white text-[11px]">
                    <th className="px-3 py-2 text-left font-semibold">Empreendimento</th>
                    <th className="px-3 py-2 text-center font-semibold">Atos</th>
                    <th className="px-3 py-2 text-center font-semibold">Em elaboração</th>
                    <th className="px-3 py-2 text-center font-semibold">Na construtora</th>
                    <th className="px-3 py-2 text-center font-semibold">Ressalvas</th>
                    <th className="px-3 py-2 text-center font-semibold">Aprovadas</th>
                    <th className="px-3 py-2 text-center font-semibold">Agendadas</th>
                    <th className="px-3 py-2 text-center font-semibold">Concluídas</th>
                    <th className="px-3 py-2 text-left font-semibold">Próxima assinatura</th>
                  </tr>
                </thead>
                <tbody>
                  {g.itens.map(l => (
                    <tr key={l.empreendimento_id} className="border-t border-black/5">
                      <td className="px-3 py-2">
                        <span className="font-medium text-navy">{l.empreendimento}</span>
                        {l.total_unidades ? <span className="block text-[11px] text-ink/45">{l.total_unidades} unidades</span> : null}
                      </td>
                      <Celula n={Number(l.atos_total)} />
                      <Celula n={Number(l.em_elaboracao)} />
                      <Celula n={Number(l.aguardando_construtora)} cor="#1E3a63" destaque />
                      <Celula n={Number(l.com_ressalvas)} cor="#A9761B" destaque />
                      <Celula n={Number(l.aprovadas)} cor="#1E7A4F" />
                      <Celula n={Number(l.agendadas)} />
                      <Celula n={Number(l.concluidas)} />
                      <td className="px-3 py-2 text-[12px] text-ink/60">
                        {l.proxima_assinatura ? dataHora(new Date(l.proxima_assinatura)) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}

      {decisores.length > 0 && (
        <div className="card p-5 mt-2">
          <h2 className="font-semibold text-navy">Decisões do jurídico</h2>
          <p className="text-xs text-ink/55 mb-2">
            Quem aprovou ou fez ressalvas em cada ato — útil para retomar a conversa direto com a pessoa.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]" style={{ minWidth: 640 }}>
              <thead>
                <tr className="text-[11px] text-ink/55 border-b border-black/10">
                  <th className="px-2 py-1.5 text-left">Unidade</th>
                  <th className="px-2 py-1.5 text-left">Protocolo</th>
                  <th className="px-2 py-1.5 text-left">Decisão</th>
                  <th className="px-2 py-1.5 text-left">Quem decidiu</th>
                  <th className="px-2 py-1.5 text-left">Quando</th>
                </tr>
              </thead>
              <tbody>
                {decisores.slice(0, 25).map(d => (
                  <tr key={d.solicitacao_id} className="border-b border-black/5">
                    <td className="px-2 py-2">
                      <span className="block text-navy">{d.empreendimento}</span>
                      <span className="block text-[11px] text-ink/50">un. {d.unidade ?? '—'}</span>
                    </td>
                    <td className="px-2 py-2 font-mono text-[11px] text-ink/55">{d.protocolo}</td>
                    <td className="px-2 py-2" style={{
                      color: d.validacao === 'aprovada' ? '#1E7A4F'
                        : d.validacao === 'enviada' ? '#1E3a63' : '#A9761B' }}>
                      {d.validacao === 'aprovada' ? 'aprovada'
                        : d.validacao === 'enviada' ? 'em análise'
                        : d.validacao === 'ressalvas' ? 'com ressalvas' : d.validacao}
                    </td>
                    <td className="px-2 py-2">
                      <span className="text-navy font-medium">{d.decidida_por ?? '—'}</span>
                      {d.observacoes && (
                        <span className="block text-[11px] text-ink/55 truncate" style={{ maxWidth: 260 }}>
                          {d.observacoes}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-[12px] text-ink/60">
                      {d.decidida_em ? dataHora(new Date(d.decidida_em)) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Layout>
  )
}

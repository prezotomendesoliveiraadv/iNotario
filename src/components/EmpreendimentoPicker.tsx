import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { dataCurta } from '../lib/tempo'
import {
  listarEmpreendimentos, unidadeEmUso, vincularEmpreendimento,
  type Empreendimento, type UsoUnidade,
} from '../lib/incorporacao'

/**
 * Venda de construtora: escolhido o empreendimento e a unidade, o sistema
 * (1) avisa se já existe protocolo para aquela unidade e
 * (2) qualifica a vendedora a partir do cadastro — ninguém redigita a construtora.
 */
export default function EmpreendimentoPicker({
  solicitacaoId, empreendimentoAtual, unidadeAtual, onVinculado,
}: {
  solicitacaoId: string
  empreendimentoAtual?: string | null
  unidadeAtual?: string | null
  onVinculado?: () => void
}) {
  const [lista, setLista] = useState<Empreendimento[]>([])
  const [empId, setEmpId] = useState(empreendimentoAtual ?? '')
  const [unidade, setUnidade] = useState(unidadeAtual ?? '')
  const [usos, setUsos] = useState<UsoUnidade[]>([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => { listarEmpreendimentos().then(setLista).catch(e => setErro(e.message)) }, [])

  // checagem de duplicidade enquanto digita a unidade
  useEffect(() => {
    if (!empId || !unidade.trim()) { setUsos([]); return }
    const t = setTimeout(async () => {
      try {
        const r = await unidadeEmUso(empId, unidade.trim())
        setUsos(r.filter(u => u.id !== solicitacaoId))
      } catch { /* silencioso: é só um aviso */ }
    }, 400)
    return () => clearTimeout(t)
  }, [empId, unidade, solicitacaoId])

  async function vincular() {
    if (!empId) { setErro('Escolha o empreendimento.'); return }
    setBusy(true); setErro(null); setMsg(null)
    try {
      const r = await vincularEmpreendimento(solicitacaoId, empId, unidade.trim())
      setMsg(r.construtora
        ? `Vendedora qualificada pelo cadastro: ${r.construtora}${r.representante ? ` (rep. ${r.representante})` : ''}.`
        : 'Empreendimento vinculado.')
      onVinculado?.()
    } catch (e: any) { setErro(e.message) } finally { setBusy(false) }
  }

  if (lista.length === 0) return null

  const emp = lista.find(e => e.id === empId)

  return (
    <div className="card p-5 mb-4">
      <h2 className="font-semibold text-navy">Venda de construtora</h2>
      <p className="text-xs text-ink/55 mb-3">
        Vinculando o empreendimento, a qualificação da vendedora vem do cadastro do cartório —
        e a minuta passa a usar o modelo padrão dela.
      </p>

      <div className="grid gap-2" style={{ gridTemplateColumns: '2fr 1fr auto' }}>
        <select className="input" value={empId} onChange={e => setEmpId(e.target.value)}>
          <option value="">— não é venda de construtora —</option>
          {lista.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
        </select>
        <input className="input" placeholder="Unidade / ap." value={unidade}
          onChange={e => setUnidade(e.target.value)} />
        <button className="btn-brass" disabled={busy || !empId} onClick={vincular}>
          {busy ? '…' : 'Vincular'}
        </button>
      </div>

      {emp?.total_unidades ? (
        <p className="text-[11px] text-ink/45 mt-1">
          {emp.nome} · {emp.total_unidades} unidades{emp.matricula_mae ? ` · matrícula mãe ${emp.matricula_mae}` : ''}
        </p>
      ) : null}

      {usos.length > 0 && (
        <div className="mt-3 rounded-lg p-3" style={{ background: '#FFF8E8', border: '1px solid #E3C57E' }}>
          <div className="text-[13px] font-semibold" style={{ color: '#A9761B' }}>
            Já existe protocolo para esta unidade
          </div>
          <ul className="mt-1 space-y-0.5">
            {usos.map(u => (
              <li key={u.id} className="text-[12px]">
                <Link to={`/s/${u.id}`} className="hover:underline">
                  <span className="font-mono">{u.protocolo}</span>
                  <span className="text-ink/60"> · {u.etapa} · aberto em {dataCurta(new Date(u.criado_em))}</span>
                </Link>
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-ink/60 mt-1">
            Confirme se é a mesma negociação (acompanhamento) ou uma nova (revenda, distrato) antes de prosseguir.
          </p>
        </div>
      )}

      {erro && <div className="text-sm text-red-600 mt-2">{erro}</div>}
      {msg && <div className="text-sm text-emerald-700 mt-2">{msg}</div>}
    </div>
  )
}

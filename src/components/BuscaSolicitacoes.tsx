import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { buscarSolicitacoes, tipoDoTermo, type ResultadoBusca } from '../lib/melhorias'
import { ETAPA_LABEL } from '../lib/workflow'

const STATUS = [
  { v: '', label: 'Todos' },
  { v: 'recebida', label: 'Recebidas' },
  { v: 'em_elaboracao', label: 'Em elaboração' },
  { v: 'em_revisao', label: 'Em revisão' },
  { v: 'aprovada', label: 'Aprovadas' },
  { v: 'concluida', label: 'Concluídas' },
  { v: 'cancelada', label: 'Canceladas' },
]

const DICA: Record<string, string> = {
  protocolo: 'buscando por protocolo',
  cpf: 'buscando por CPF/CNPJ de uma das partes',
  nome: 'buscando por nome de parte, título ou tipo de ato',
  vazio: '',
}

/**
 * Uma caixa só: o sistema identifica se o usuário digitou protocolo, CPF ou
 * nome — em vez de obrigá-lo a escolher o campo antes de procurar.
 */
export default function BuscaSolicitacoes({ onAtivo }: { onAtivo?: (ativo: boolean) => void }) {
  const [termo, setTermo] = useState('')
  const [status, setStatus] = useState('')
  const [itens, setItens] = useState<ResultadoBusca[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const debounce = useRef<any>(null)

  const ativo = termo.trim().length > 0 || status !== ''
  useEffect(() => { onAtivo?.(ativo) }, [ativo])

  useEffect(() => {
    if (!ativo) { setItens(null); return }
    clearTimeout(debounce.current)
    debounce.current = setTimeout(async () => {
      setBusy(true); setErro(null)
      try { setItens(await buscarSolicitacoes(termo.trim(), status)) }
      catch (e: any) { setErro(e.message ?? 'Falha na busca.') }
      finally { setBusy(false) }
    }, 300)
    return () => clearTimeout(debounce.current)
  }, [termo, status])

  const tipo = tipoDoTermo(termo)

  return (
    <div className="mb-5">
      <div className="flex gap-2 flex-wrap items-center">
        <div className="relative flex-1" style={{ minWidth: 260 }}>
          <input className="input" style={{ paddingRight: 70 }}
            placeholder="Buscar por protocolo, CPF ou nome de uma das partes…"
            value={termo} onChange={e => setTermo(e.target.value)} />
          {termo && (
            <button className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-ink/50 hover:text-navy"
              onClick={() => setTermo('')}>limpar</button>
          )}
        </div>
        <select className="input" style={{ width: 'auto' }} value={status} onChange={e => setStatus(e.target.value)}>
          {STATUS.map(s => <option key={s.v} value={s.v}>{s.label}</option>)}
        </select>
      </div>

      {ativo && (
        <div className="text-[11px] text-ink/50 mt-1">
          {busy ? 'buscando…' : itens
            ? `${itens.length} resultado${itens.length === 1 ? '' : 's'}${termo.trim() ? ` · ${DICA[tipo]}` : ''}`
            : DICA[tipo]}
        </div>
      )}

      {erro && <div className="text-sm text-red-600 mt-2">{erro}</div>}

      {itens && (
        <div className="mt-2 space-y-1.5">
          {itens.length === 0 && (
            <div className="rounded-lg border border-dashed border-black/20 p-6 text-center text-[13px] text-ink/55">
              Nada encontrado. Tente outro trecho do nome, o CPF sem pontuação ou o número do protocolo.
            </div>
          )}
          {itens.map(s => (
            <Link key={s.id} to={`/s/${s.id}`}
              className="flex items-center gap-3 rounded-lg border border-black/10 bg-white px-3 py-2 hover:border-brass transition">
              <span className="font-mono text-[11px] text-ink/55 shrink-0">{s.protocolo ?? '—'}</span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-medium text-ink truncate">{s.tipo_nome ?? s.titulo ?? 'Solicitação'}</span>
                {s.partes_nomes && <span className="block text-[11px] text-ink/50 truncate">{s.partes_nomes}</span>}
              </span>
              <span className="badge bg-navy text-white shrink-0">{ETAPA_LABEL[s.etapa] ?? s.status}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

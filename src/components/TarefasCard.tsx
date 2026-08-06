import { useEffect, useState } from 'react'
import { dataCurta, dataHora } from '../lib/tempo'
import {
  equipeDoCartorio, tarefasDoAto, criarTarefa, concluirTarefa, historicoTarefa,
  type MembroEquipe,
} from '../lib/administracao'

const COR_PRIORIDADE: Record<string, string> = { alta: '#B3261E', normal: '#1E3a63', baixa: '#7C8698' }

function prazoInfo(prazo: string | null) {
  if (!prazo) return null
  const dias = Math.floor((new Date(prazo + 'T12:00:00').getTime() - Date.now()) / 86400000)
  if (dias < 0) return { txt: `atrasada ${Math.abs(dias)}d`, cor: '#B3261E' }
  if (dias === 0) return { txt: 'vence hoje', cor: '#A9761B' }
  if (dias <= 2) return { txt: `em ${dias}d`, cor: '#A9761B' }
  return { txt: dataCurta(new Date(prazo + 'T12:00:00')), cor: '#7C8698' }
}

/**
 * Tarefas do ato. Complementa o fluxo de etapas: a etapa diz de quem é a vez;
 * a tarefa diz o que precisa ser feito, por quem e até quando. Ao concluir,
 * o usuário já designa o próximo do fluxo — a bola nunca fica no chão.
 */
export default function TarefasCard({ solicitacaoId }: { solicitacaoId: string }) {
  const [tarefas, setTarefas] = useState<any[]>([])
  const [equipe, setEquipe] = useState<MembroEquipe[]>([])
  const [nova, setNova] = useState<any>(null)
  const [concluindo, setConcluindo] = useState<string | null>(null)
  const [form, setForm] = useState<any>({ resultado: '', proximo: '', proximoTitulo: '', proximoPrazo: '' })
  const [hist, setHist] = useState<Record<string, any[]>>({})
  const [busy, setBusy] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function carregar() {
    try {
      const [t, e] = await Promise.all([tarefasDoAto(solicitacaoId), equipeDoCartorio()])
      setTarefas(t); setEquipe(e)
    } catch (e: any) { setErro(e.message) }
  }
  useEffect(() => { carregar() }, [solicitacaoId])

  const nomeDe = (id: string) => equipe.find(m => m.id === id)?.nome ?? '—'
  const abertas = tarefas.filter(t => t.status === 'pendente' || t.status === 'em_andamento')
  const fechadas = tarefas.filter(t => t.status === 'concluida' || t.status === 'cancelada')

  return (
    <div className="card p-5 mb-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-semibold text-navy">Tarefas</h2>
          <p className="text-xs text-ink/55">
            Designe uma tarefa a um colega com prazo. Ao concluir, você já indica quem continua.
          </p>
        </div>
        <button className="btn-ghost shrink-0"
          onClick={() => setNova({ para: '', titulo: '', descricao: '', prazo: '', prioridade: 'normal' })}>
          + Designar tarefa
        </button>
      </div>

      {erro && <div className="text-sm text-red-600 mt-2">{erro}</div>}

      {nova && (
        <div className="rounded-lg border border-black/10 p-3 mt-3">
          <div className="grid md:grid-cols-2 gap-2">
            <div><label className="label">Para *</label>
              <select className="input" value={nova.para} onChange={e => setNova({ ...nova, para: e.target.value })}>
                <option value="">— escolha —</option>
                {equipe.map(m => <option key={m.id} value={m.id}>{m.nome} ({m.grupo ?? m.papel})</option>)}
              </select></div>
            <div><label className="label">Tarefa *</label>
              <input className="input" placeholder="ex.: conferir a qualificação dos compradores"
                value={nova.titulo} onChange={e => setNova({ ...nova, titulo: e.target.value })} /></div>
            <div><label className="label">Prazo</label>
              <input className="input" type="date" value={nova.prazo} onChange={e => setNova({ ...nova, prazo: e.target.value })} /></div>
            <div><label className="label">Prioridade</label>
              <select className="input" value={nova.prioridade} onChange={e => setNova({ ...nova, prioridade: e.target.value })}>
                <option value="baixa">Baixa</option><option value="normal">Normal</option><option value="alta">Alta</option>
              </select></div>
          </div>
          <div className="mt-2">
            <label className="label">Detalhes (opcional)</label>
            <textarea className="input" style={{ minHeight: 56 }} value={nova.descricao}
              onChange={e => setNova({ ...nova, descricao: e.target.value })} />
          </div>
          <div className="flex gap-2 mt-2">
            <button className="btn-brass" disabled={busy} onClick={async () => {
              if (!nova.para || !nova.titulo.trim()) { setErro('Escolha o responsável e descreva a tarefa.'); return }
              setBusy(true); setErro(null)
              try {
                const r = await criarTarefa({
                  para: nova.para, titulo: nova.titulo.trim(), descricao: nova.descricao || undefined,
                  solicitacaoId, prazo: nova.prazo || null, prioridade: nova.prioridade,
                })
                if (!r.ok) { setErro(r.erro ?? 'Falha ao criar.'); return }
                setNova(null); await carregar()
              } catch (e: any) { setErro(e.message) } finally { setBusy(false) }
            }}>Designar</button>
            <button className="btn-ghost" onClick={() => setNova(null)}>cancelar</button>
          </div>
        </div>
      )}

      {/* em aberto */}
      {abertas.length === 0 && !nova && (
        <p className="text-[12px] text-ink/50 mt-3">Nenhuma tarefa em aberto neste ato.</p>
      )}
      {abertas.map(t => {
        const p = prazoInfo(t.prazo)
        const fechando = concluindo === t.id
        return (
          <div key={t.id} className="rounded-lg border border-black/10 mt-2">
            <div className="flex items-start gap-2 px-3 py-2">
              <span className="mt-[6px] h-2 w-2 rounded-full shrink-0" style={{ background: COR_PRIORIDADE[t.prioridade] }} />
              <span className="flex-1 min-w-0">
                <span className="block text-[13px] font-medium text-navy">{t.titulo}</span>
                <span className="block text-[11px] text-ink/55">
                  {nomeDe(t.designada_para)}
                  {p && <> · <span style={{ color: p.cor }}>{p.txt}</span></>}
                </span>
                {t.descricao && <span className="block text-[12px] text-ink/65 mt-0.5">{t.descricao}</span>}
              </span>
              <button className="text-[12px] text-navy underline shrink-0"
                onClick={() => { setConcluindo(fechando ? null : t.id); setForm({ resultado: '', proximo: '', proximoTitulo: '', proximoPrazo: '' }) }}>
                {fechando ? 'fechar' : 'concluir'}
              </button>
            </div>

            {fechando && (
              <div className="px-3 pb-3 border-t border-black/5 pt-2">
                <label className="label">O que foi feito</label>
                <textarea className="input" style={{ minHeight: 50 }} value={form.resultado}
                  onChange={e => setForm({ ...form, resultado: e.target.value })} />

                <div className="mt-2 rounded-lg bg-paper p-2.5">
                  <div className="text-[11px] font-semibold tracking-wide text-brass uppercase mb-1">
                    Passar para o próximo (opcional)
                  </div>
                  <div className="grid md:grid-cols-3 gap-2">
                    <select className="input" value={form.proximo} onChange={e => setForm({ ...form, proximo: e.target.value })}>
                      <option value="">— encerrar aqui —</option>
                      {equipe.filter(m => m.id !== t.designada_para).map(m =>
                        <option key={m.id} value={m.id}>{m.nome} ({m.grupo ?? m.papel})</option>)}
                    </select>
                    <input className="input" placeholder="Próxima tarefa" value={form.proximoTitulo}
                      onChange={e => setForm({ ...form, proximoTitulo: e.target.value })} />
                    <input className="input" type="date" value={form.proximoPrazo}
                      onChange={e => setForm({ ...form, proximoPrazo: e.target.value })} />
                  </div>
                </div>

                <button className="btn-primary mt-2" disabled={busy} onClick={async () => {
                  setBusy(true); setErro(null)
                  try {
                    const r = await concluirTarefa({
                      tarefaId: t.id, resultado: form.resultado || undefined,
                      proximo: form.proximo || null, proximoTitulo: form.proximoTitulo || undefined,
                      proximoPrazo: form.proximoPrazo || null,
                    })
                    if (!r.ok) { setErro(r.erro ?? 'Falha ao concluir.'); return }
                    setConcluindo(null); await carregar()
                  } catch (e: any) { setErro(e.message) } finally { setBusy(false) }
                }}>
                  {form.proximo ? 'Concluir e passar adiante' : 'Concluir tarefa'}
                </button>
              </div>
            )}
          </div>
        )
      })}

      {/* histórico */}
      {fechadas.length > 0 && (
        <details className="mt-3">
          <summary className="text-sm font-semibold text-navy cursor-pointer">Concluídas ({fechadas.length})</summary>
          <ul className="mt-2 space-y-1.5">
            {fechadas.map(t => (
              <li key={t.id} className="text-[12px] border-l-2 border-black/10 pl-2">
                <span className="block font-medium text-navy">{t.titulo}</span>
                <span className="block text-ink/50">
                  {nomeDe(t.designada_para)}
                  {t.concluida_em ? ` · concluída em ${dataHora(new Date(t.concluida_em))}` : ''}
                </span>
                {t.resultado && <span className="block text-ink/70">{t.resultado}</span>}
                <button className="text-[11px] text-navy underline" onClick={async () => {
                  if (hist[t.id]) { setHist({ ...hist, [t.id]: [] }); return }
                  setHist({ ...hist, [t.id]: await historicoTarefa(t.id) })
                }}>histórico</button>
                {(hist[t.id] ?? []).map(h => (
                  <span key={h.id} className="block text-[11px] text-ink/45 pl-2">
                    {dataHora(new Date(h.created_at))} · {h.acao}{h.ator_nome ? ` — ${h.ator_nome}` : ''}
                    {h.observacao ? `: ${h.observacao}` : ''}
                  </span>
                ))}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

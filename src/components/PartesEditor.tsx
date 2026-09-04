import { useState } from 'react'
import { camposVisiveis, exigeConjuge, agruparPorPapel, type ParteRow } from '../lib/melhorias'

/**
 * Edita N partes por papel. O cartório pensa por grupo de qualificação
 * ("Vendedores (2)"), então a interface agrupa e permite somar pessoas
 * dentro de cada papel — sem limite fixo por tipo de ato.
 */
export default function PartesEditor({
  partes, papeisSugeridos, onChange, compacto,
}: {
  partes: ParteRow[]
  papeisSugeridos: string[]
  onChange: (p: ParteRow[]) => void
  compacto?: boolean
}) {
  const [aberta, setAberta] = useState<number | null>(null)
  const [novoPapel, setNovoPapel] = useState('')

  const set = (i: number, patch: Partial<ParteRow>) =>
    onChange(partes.map((p, idx) => (idx === i ? { ...p, ...patch } : p)))
  const setDado = (i: number, k: string, v: string) =>
    set(i, { dados: { ...(partes[i].dados ?? {}), [k]: v } })

  function adicionar(papel: string) {
    onChange([...partes, { papel, nome: '', cpf_cnpj: '', dados: {}, ordem: partes.length }])
    setAberta(partes.length)
  }
  function remover(i: number) {
    onChange(partes.filter((_, idx) => idx !== i))
    setAberta(null)
  }

  const grupos = agruparPorPapel(partes)
  const papeisUsados = new Set(grupos.map(g => g.papel))
  const disponiveis = papeisSugeridos.filter(p => !papeisUsados.has(p))
  const indiceReal = (p: ParteRow) => partes.indexOf(p)

  return (
    <div className="space-y-3">
      {grupos.map(({ papel, itens }) => (
        <div key={papel} className="rounded-lg border border-black/10 overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 bg-paper">
            <span className="text-[11px] font-semibold tracking-wide text-brass uppercase">
              {papel}{itens.length > 1 ? ` · ${itens.length} pessoas` : ''}
            </span>
            <button type="button" className="text-[12px] text-navy hover:underline font-medium"
              onClick={() => adicionar(papel)}>+ adicionar</button>
          </div>

          <div className="divide-y divide-black/5">
            {itens.map((p) => {
              const i = indiceReal(p)
              const expandida = aberta === i
              const preenchidos = Object.entries(p.dados ?? {}).filter(([, v]) => v).length
              return (
                <div key={p.id ?? `n${i}`} className="p-3">
                  <div className="flex gap-2 items-start">
                    <div className="flex-1 grid gap-2" style={{ gridTemplateColumns: '1.6fr 1fr' }}>
                      <input className="input" placeholder="Nome completo" value={p.nome}
                        onChange={e => set(i, { nome: e.target.value })} />
                      <input className="input" placeholder="CPF / CNPJ" value={p.cpf_cnpj ?? ''}
                        onChange={e => set(i, { cpf_cnpj: e.target.value })} />
                    </div>
                    <button type="button" title="Remover esta pessoa"
                      className="text-ink/35 hover:text-red-600 text-lg leading-none px-1 pt-1.5"
                      onClick={() => remover(i)}>×</button>
                  </div>

                  {!compacto && (
                    <button type="button"
                      className="text-[11px] text-navy hover:underline mt-1.5"
                      onClick={() => setAberta(expandida ? null : i)}>
                      {expandida ? 'ocultar qualificação' : `qualificação completa${preenchidos ? ` (${preenchidos})` : ''}`}
                    </button>
                  )}

                  {expandida && (
                    <div className="grid gap-2 mt-2" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))' }}>
                      {camposVisiveis(p.dados ?? {}).map((c: any) => (
                        <label key={c.k} className="text-[11px] text-ink/60">
                          {c.label}
                          {c.tipo === 'select' ? (
                            <select className="input" value={(p.dados ?? {})[c.k] ?? ''}
                              onChange={e => setDado(i, c.k, e.target.value)}>
                              <option value="">—</option>
                              {(c as any).opcoes.map((o: string) => <option key={o} value={o}>{o}</option>)}
                            </select>
                          ) : (
                            <input className="input" type={c.tipo === 'date' ? 'date' : 'text'}
                              value={(p.dados ?? {})[c.k] ?? ''}
                              onChange={e => setDado(i, c.k, e.target.value)} />
                          )}
                        </label>
                      ))}
                      {exigeConjuge(p.dados ?? {}) && (
                        <p className="text-[11px] text-ink/45" style={{ gridColumn: '1/-1' }}>
                          O regime exige a outorga do cônjuge — por isso a qualificação dele é pedida.
                          Na separação total de bens estes campos não aparecem.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      ))}

      {/* adicionar um papel novo */}
      <div className="flex flex-wrap gap-1.5 items-center">
        {disponiveis.map(p => (
          <button key={p} type="button" className="btn-ghost text-[12px] py-1"
            onClick={() => adicionar(p)}>+ {p}</button>
        ))}
        <div className="flex gap-1 items-center">
          <input className="input" style={{ width: 190 }} placeholder="outro papel (ex.: Anuente)"
            value={novoPapel} onChange={e => setNovoPapel(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && novoPapel.trim()) { e.preventDefault(); adicionar(novoPapel.trim()); setNovoPapel('') } }} />
          <button type="button" className="btn-ghost text-[12px] py-1" disabled={!novoPapel.trim()}
            onClick={() => { adicionar(novoPapel.trim()); setNovoPapel('') }}>adicionar</button>
        </div>
      </div>

      {partes.length === 0 && (
        <p className="text-[12px] text-ink/50">Nenhuma parte cadastrada. Use os botões acima para incluir.</p>
      )}
    </div>
  )
}

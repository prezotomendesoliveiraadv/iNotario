import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// ============================================================================
// Painel de dados do ato
//
// Mostra o que o cartório sabe sobre o ato, de onde cada dado veio, onde as
// fontes discordam e o que ainda falta.
//
// A consolidação NÃO acontece aqui: vem inteira de `consolidar_ato` no banco,
// que é a mesma função que alimenta o dicionário da minuta. Se a regra
// existisse também no front, a tela e a escritura poderiam divergir — e a
// divergência só apareceria depois de assinada.
//
// Precedência (decidida com o cartório):
//   partes  → RG/CNH vence o contrato
//   objeto  → matrícula vence o contrato
//   negócio → só o contrato tem
// Divergência não trava: adota-se a fonte de maior precedência e registra-se
// o conflito, porque quem decide é o escrevente.
// ============================================================================

interface Campo {
  rotulo: string
  valor: string | null
  fonte: 'matricula' | 'contrato' | 'documento_pessoal' | null
  grupo: 'objeto' | 'negocio' | 'partes'
  detalhe?: Record<string, string>
}
interface Divergencia {
  campo: string; rotulo: string
  adotado: string; fonte_adotada: string
  conflito: string; fonte_conflito: string
}
interface Certidao {
  tipo: string; numero: string | null; emitida_em: string | null; validade: string | null
  resultado: string | null; origem: 'ato' | 'empreendimento'; arquivo: string | null
  dias_restantes: number | null
  situacao: 'vigente' | 'vence_em_breve' | 'vencida' | 'sem_validade'
}
export interface Consolidado {
  campos: Record<string, Campo>
  divergencias: Divergencia[]
  certidoes: Certidao[]
  matricula: null | {
    arquivo: string | null; emitida_em: string | null; validade: string | null
    dias_restantes: number | null
    situacao: 'vigente' | 'vence_em_breve' | 'vencida' | 'sem_data'
  }
  faltantes: { item: string; motivo: string }[]
  completude: number
}

const FONTE_LABEL: Record<string, string> = {
  matricula: 'matrícula',
  contrato: 'contrato',
  documento_pessoal: 'RG/CNH',
}
const SITUACAO: Record<string, { rotulo: string; cor: string }> = {
  vigente: { rotulo: 'vigente', cor: 'bg-emerald-50 text-emerald-700' },
  vence_em_breve: { rotulo: 'vence em breve', cor: 'bg-amber-50 text-amber-800' },
  vencida: { rotulo: 'vencida', cor: 'bg-red-50 text-red-700' },
  sem_validade: { rotulo: 'sem validade lida', cor: 'bg-gray-100 text-gray-600' },
  sem_data: { rotulo: 'sem data de expedição', cor: 'bg-gray-100 text-gray-600' },
}

const GRUPOS: { chave: Campo['grupo']; titulo: string }[] = [
  { chave: 'partes', titulo: 'Partes' },
  { chave: 'objeto', titulo: 'Objeto (imóvel)' },
  { chave: 'negocio', titulo: 'Negócio e pagamento' },
]

function dataBR(d?: string | null) {
  if (!d) return '—'
  const [a, m, dia] = d.split('-')
  return dia ? `${dia}/${m}/${a}` : d
}

export default function PainelDadosAto({ solicitacaoId }: { solicitacaoId: string }) {
  const [dados, setDados] = useState<Consolidado | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [busy, setBusy] = useState(true)

  async function carregar() {
    setBusy(true); setErro(null)
    try {
      const { data, error } = await supabase.rpc('consolidar_ato', { p_solicitacao: solicitacaoId })
      if (error) throw error
      if ((data as any)?.erro) throw new Error((data as any).erro)
      setDados(data as Consolidado)
    } catch (e: any) {
      setErro(`${e.message ?? e}. A 19ª migration já foi executada?`)
    } finally { setBusy(false) }
  }
  useEffect(() => { carregar() }, [solicitacaoId])

  if (busy && !dados) return <div className="card p-5 text-sm text-ink/50">Consolidando os dados do ato…</div>
  if (erro) return <div className="card p-5 text-sm text-red-600">{erro}</div>
  if (!dados) return null

  const campos = Object.entries(dados.campos ?? {}) as [string, Campo][]
  const pct = Math.round((dados.completude ?? 0) * 100)

  return (
    <div className="card p-5 mb-6">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
        <h2 className="font-semibold text-navy">Dados do ato</h2>
        <button className="btn-ghost text-[12px] py-1" onClick={carregar} disabled={busy}>
          {busy ? 'Atualizando…' : '↻ Atualizar'}
        </button>
      </div>
      <p className="text-[11px] text-ink/50 mb-3">
        Consolidado dos documentos lidos e vinculados. Cada dado mostra de onde veio.
      </p>

      {/* completude */}
      <div className="flex items-center gap-2 mb-4">
        <div className="flex-1 h-1.5 rounded-full bg-black/8 overflow-hidden">
          <div className="h-full bg-brass" style={{ width: `${pct}%` }} />
        </div>
        <span className="text-xs text-ink/60 font-mono">{pct}%</span>
      </div>

      {/* prazo da matrícula: primeiro, porque vence sozinho */}
      {dados.matricula && (
        <div className={`rounded-lg px-3 py-2 mb-3 text-xs ${SITUACAO[dados.matricula.situacao]?.cor ?? ''}`}>
          <b>Matrícula</b> — expedida em {dataBR(dados.matricula.emitida_em)}
          {dados.matricula.validade && <> · válida até {dataBR(dados.matricula.validade)}</>}
          {dados.matricula.dias_restantes != null && (
            <> · {dados.matricula.dias_restantes >= 0
              ? `${dados.matricula.dias_restantes} dia(s) restantes`
              : `vencida há ${Math.abs(dados.matricula.dias_restantes)} dia(s)`}</>
          )}
          {dados.matricula.situacao === 'sem_data' && ' — não foi possível ler a data de expedição, o prazo de 30 dias não está sendo controlado.'}
        </div>
      )}

      {/* divergências: antes dos campos, senão passam batidas */}
      {dados.divergencias?.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 mb-3">
          <div className="text-xs font-semibold text-amber-900 mb-1">
            {dados.divergencias.length} divergência(s) entre documentos
          </div>
          <div className="space-y-1">
            {dados.divergencias.map((d, i) => (
              <div key={i} className="text-xs text-amber-900">
                <b>{d.rotulo}</b>: adotado <b>{d.adotado}</b> ({FONTE_LABEL[d.fonte_adotada] ?? d.fonte_adotada}) —
                o {FONTE_LABEL[d.fonte_conflito] ?? d.fonte_conflito} diz <b>{d.conflito}</b>.
              </div>
            ))}
          </div>
          <div className="text-[11px] text-amber-800/70 mt-1">
            O painel adota a fonte de maior precedência e registra o conflito. Confira antes de lavrar.
          </div>
        </div>
      )}

      {/* campos por grupo */}
      {GRUPOS.map(g => {
        const doGrupo = campos.filter(([, c]) => c.grupo === g.chave)
        if (!doGrupo.length) return null
        return (
          <div key={g.chave} className="mb-3">
            <div className="text-[11px] uppercase tracking-wider text-brass mb-1">{g.titulo}</div>
            <div className="space-y-1">
              {doGrupo.map(([k, c]) => (
                <div key={k} className="flex gap-2 text-xs items-baseline">
                  <span className="text-ink/50" style={{ minWidth: 140 }}>{c.rotulo}</span>
                  <span className="flex-1">
                    {c.valor || '—'}
                    {c.detalhe && Object.keys(c.detalhe).length > 0 && (
                      <div className="text-ink/50 mt-0.5">
                        {Object.entries(c.detalhe).map(([kk, vv]) => `${kk}: ${vv}`).join(' · ')}
                      </div>
                    )}
                  </span>
                  {c.fonte && (
                    <span className="badge bg-paper text-[10px] shrink-0">{FONTE_LABEL[c.fonte] ?? c.fonte}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )
      })}

      {/* certidões */}
      <div className="mb-3">
        <div className="text-[11px] uppercase tracking-wider text-brass mb-1">
          Certidões ({dados.certidoes?.length ?? 0})
        </div>
        {dados.certidoes?.length ? (
          <div className="space-y-1">
            {dados.certidoes.map((c, i) => (
              <div key={i} className="flex gap-2 text-xs items-baseline">
                <span className="flex-1">
                  {c.tipo}
                  {c.numero && <span className="text-ink/50"> nº {c.numero}</span>}
                  {c.resultado && <span className="text-ink/50"> · {c.resultado}</span>}
                  <span className="text-ink/40"> · {c.origem === 'ato' ? 'do ato' : 'do empreendimento'}</span>
                </span>
                <span className="text-ink/50 shrink-0">{dataBR(c.validade)}</span>
                <span className={`badge text-[10px] shrink-0 ${SITUACAO[c.situacao]?.cor ?? ''}`}>
                  {SITUACAO[c.situacao]?.rotulo ?? c.situacao}
                </span>
              </div>
            ))}
          </div>
        ) : <p className="text-xs text-ink/50">Nenhuma certidão vinculada.</p>}
      </div>

      {/* o que falta */}
      {dados.faltantes?.length > 0 && (
        <div className="rounded-lg border border-black/8 bg-paper px-3 py-2">
          <div className="text-xs font-semibold text-navy mb-1">Falta para completar</div>
          <ul className="space-y-1">
            {dados.faltantes.map((f, i) => (
              <li key={i} className="text-xs">
                <b>{f.item}</b> <span className="text-ink/60">— {f.motivo}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

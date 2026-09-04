import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// ============================================================================
// Quem assina pela vendedora
//
// Quando o ato é venda de construtora, esta informação vivia só no cadastro —
// a três cliques de distância da tela onde a escritura é lavrada. O escrevente
// redigia sem ver quem pode assinar e com que limites.
//
// Aqui ela aparece no ato, com os poderes efetivos e as restrições. Não é
// atalho para o cadastro: é o dado que decide a lavratura.
// ============================================================================

interface Rep {
  id: string
  nome: string
  cpf: string | null
  cargo: string | null
  origem: string | null
  forma: string | null
  poderes: string[]
  restricoes: string[]
  pode_alienar: boolean | null
  pode_garantia: boolean | null
  pode_substabelecer: boolean | null
  limite_valor: string | null
  procuracao_validade: string | null
  procuracao_vencida: boolean
  tem_procuracao: boolean
  lida_em: string | null
}
interface Dados {
  construtora: string | null
  cnpj: string | null
  poderes_contrato_social: any
  representantes: Rep[]
}

const FORMA: Record<string, string> = {
  isolada: 'assina sozinho',
  conjunta: 'assina em conjunto',
  conjunta_com_outro: 'em conjunto com pessoa determinada',
}
const ORIGEM: Record<string, string> = {
  manual: 'cadastro manual',
  contrato_social: 'contrato social',
  modelo_escritura: 'modelo de escritura (fonte secundária)',
}

function dataBR(d?: string | null) {
  if (!d) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : d
}

/** Poder ausente é exibido como ausente — não como dúvida. */
function Poder({ rotulo, valor }: { rotulo: string; valor: boolean | null }) {
  if (valor === null || valor === undefined) {
    return <span className="badge bg-gray-100 text-gray-600 text-[10px]">{rotulo}: não lido</span>
  }
  return (
    <span className={`badge text-[10px] ${valor ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
      {valor ? '✓' : '✕'} {rotulo}
    </span>
  )
}

export default function RepresentantesDoAto({ solicitacaoId }: { solicitacaoId: string }) {
  const [d, setD] = useState<Dados | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  async function carregar() {
    try {
      const { data, error } = await supabase.rpc('representantes_do_ato', { p_solicitacao: solicitacaoId })
      if (error) throw error
      setD(data as Dados)
    } catch (e: any) {
      setErro(`${e.message ?? e}. A 23ª migration já foi executada?`)
    }
  }
  useEffect(() => { carregar() }, [solicitacaoId])

  if (erro) return <div className="card p-3 mb-4 text-xs text-red-600">{erro}</div>
  // Ato que não é venda de construtora simplesmente não mostra o card.
  if (!d?.construtora) return null

  const p = d.poderes_contrato_social

  return (
    <div className="card p-5 mb-6">
      <h2 className="font-semibold text-navy">Quem assina pela vendedora</h2>
      <p className="text-[11px] text-ink/50 mb-3">
        {d.construtora}{d.cnpj && ` · CNPJ ${d.cnpj}`}
      </p>

      {p?.forma && (
        <div className="rounded-lg bg-paper p-3 mb-3">
          <div className="text-[11px] uppercase tracking-wider text-brass mb-1">
            Regra de representação (contrato social)
          </div>
          <div className="text-sm">{p.forma}</div>
          {p.quorum && <div className="text-xs text-ink/70 mt-0.5">Quórum: {p.quorum}</div>}
          {p.limite_valor && <div className="text-xs text-ink/70">Limite de valor: {p.limite_valor}</div>}
          {(p.restricoes ?? []).length > 0 && (
            <ul className="text-xs list-disc ml-4 mt-1 text-amber-800">
              {p.restricoes.map((r: string, i: number) => <li key={i}>{r}</li>)}
            </ul>
          )}
        </div>
      )}

      {d.representantes.length === 0 && (
        <p className="text-xs text-amber-800">
          Nenhum representante cadastrado para esta construtora. Sem isso, não há como conferir
          quem pode assinar.
        </p>
      )}

      <div className="space-y-2">
        {d.representantes.map(r => (
          <div key={r.id}
            className={`border rounded-lg px-3 py-2 ${r.procuracao_vencida ? 'border-red-200 bg-red-50' : 'border-black/8'}`}>
            <div className="flex items-center gap-2 flex-wrap">
              <b className="text-sm">{r.nome}</b>
              {r.cargo && <span className="text-xs text-ink/50">{r.cargo}</span>}
              {r.forma && <span className="badge bg-paper text-[10px]">{FORMA[r.forma] ?? r.forma}</span>}
              {r.procuracao_vencida && (
                <span className="badge bg-red-100 text-red-700 text-[10px]">
                  procuração vencida em {dataBR(r.procuracao_validade)}
                </span>
              )}
            </div>

            {r.cpf && <div className="text-xs text-ink/50">CPF {r.cpf}</div>}

            <div className="flex flex-wrap gap-1 mt-1.5">
              <Poder rotulo="alienar imóveis" valor={r.pode_alienar} />
              <Poder rotulo="dar garantia" valor={r.pode_garantia} />
              <Poder rotulo="substabelecer" valor={r.pode_substabelecer} />
            </div>

            {r.limite_valor && (
              <div className="text-xs text-amber-800 mt-1">Limite de valor: {r.limite_valor}</div>
            )}
            {r.poderes.length > 0 && (
              <div className="text-xs text-ink/60 mt-1">{r.poderes.slice(0, 4).join('; ')}</div>
            )}
            {r.restricoes.length > 0 && (
              <ul className="text-xs list-disc ml-4 mt-1 text-amber-800">
                {r.restricoes.map((x, i) => <li key={i}>{x}</li>)}
              </ul>
            )}

            <div className="text-[11px] text-ink/40 mt-1">
              origem: {ORIGEM[r.origem ?? 'manual'] ?? r.origem}
              {r.tem_procuracao && !r.lida_em && ' · procuração anexada, ainda não lida pela IA'}
              {!r.tem_procuracao && r.origem === 'manual' && ' · sem procuração anexada'}
            </div>
          </div>
        ))}
      </div>

      <p className="text-[11px] text-ink/45 mt-3">
        Poder marcado como “não lido” significa que a procuração não foi analisada pela IA — não que
        o poder exista. Na dúvida, leia a procuração no cadastro da construtora.
      </p>
    </div>
  )
}

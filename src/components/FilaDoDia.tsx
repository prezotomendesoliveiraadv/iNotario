import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { dataCurta } from '../lib/tempo'

// ============================================================================
// Fila do dia
//
// Duas escolhas, ambas do escrevente e lembradas entre sessões:
//
//   ORDEM       vencimento (o que expira primeiro) ou chegada (protocolo mais
//               antigo). Nenhuma das duas é "a certa" — depende do dia. Quem
//               está correndo atrás de certidão quer vencimento; quem quer
//               justiça de fila quer chegada.
//
//   AGRUPAMENTO nenhum, construtora, ou construtora + empreendimento. O último
//               concatena os dois, que é como o cartório fala: "os cinco atos
//               da Alfa no Aurora".
//
// A prontidão de cada linha vem da MESMA função que alimenta o semáforo da tela
// do ato — a fila nunca discorda do que o ato diz sobre si.
// ============================================================================

export interface ItemFilaDia {
  id: string
  protocolo: string | null
  titulo: string | null
  etapa: string
  responsavel_papel: string
  complexidade: string | null
  exigencia_atual: string | null
  tipo_nome: string | null
  construtora: string | null
  empreendimento: string | null
  unidade: string | null
  created_at: string
  updated_at: string
  situacao: 'ok' | 'atencao' | 'impeditivo'
  impeditivos: number
  atencoes: number
  dias_para_vencer: number | null
}

type Ordem = 'vencimento' | 'chegada'
type Agrupar = 'nenhum' | 'construtora' | 'empreendimento'

const CHAVE_ORDEM = 'inotario.fila.ordem'
const CHAVE_GRUPO = 'inotario.fila.grupo'

const PONTO: Record<string, string> = {
  ok: 'bg-emerald-500', atencao: 'bg-amber-500', impeditivo: 'bg-red-500',
}

/** Sem prazo conhecido vai para o fim, não para o topo. */
function porVencimento(a: ItemFilaDia, b: ItemFilaDia) {
  const va = a.dias_para_vencer ?? 9999
  const vb = b.dias_para_vencer ?? 9999
  if (va !== vb) return va - vb
  // Empate: impedimento antes de atenção.
  if (a.impeditivos !== b.impeditivos) return b.impeditivos - a.impeditivos
  return a.created_at.localeCompare(b.created_at)
}

export default function FilaDoDia({ cartorioId, papel }: { cartorioId: string; papel: string }) {
  const [itens, setItens] = useState<ItemFilaDia[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [soMinhas, setSoMinhas] = useState(false)

  const [ordem, setOrdem] = useState<Ordem>(
    () => (localStorage.getItem(CHAVE_ORDEM) as Ordem) || 'vencimento')
  const [grupo, setGrupo] = useState<Agrupar>(
    () => (localStorage.getItem(CHAVE_GRUPO) as Agrupar) || 'nenhum')

  useEffect(() => { localStorage.setItem(CHAVE_ORDEM, ordem) }, [ordem])
  useEffect(() => { localStorage.setItem(CHAVE_GRUPO, grupo) }, [grupo])

  async function carregar() {
    setCarregando(true); setErro(null)
    try {
      const { data, error } = await supabase.rpc('fila_do_dia', { p_cartorio: cartorioId })
      if (error) throw error
      setItens((data as ItemFilaDia[]) ?? [])
    } catch (e: any) {
      setErro(`${e.message ?? e}. A 22ª migration já foi executada?`)
    } finally { setCarregando(false) }
  }
  useEffect(() => { if (cartorioId) carregar() }, [cartorioId])

  const grupos = useMemo(() => {
    const base = soMinhas ? itens.filter(i => i.responsavel_papel === papel) : itens
    const ordenados = [...base].sort(ordem === 'vencimento'
      ? porVencimento
      : (a, b) => a.created_at.localeCompare(b.created_at))

    if (grupo === 'nenhum') return [{ chave: '', itens: ordenados }]

    const mapa = new Map<string, ItemFilaDia[]>()
    for (const i of ordenados) {
      const chave = grupo === 'construtora'
        ? (i.construtora || 'Sem construtora')
        // Concatena os dois: é como o cartório fala — "os cinco atos da Alfa no Aurora".
        : [i.construtora || 'Sem construtora', i.empreendimento].filter(Boolean).join(' · ')
      const arr = mapa.get(chave) ?? []
      arr.push(i); mapa.set(chave, arr)
    }
    // Grupo com o item mais urgente aparece primeiro.
    return [...mapa.entries()]
      .map(([chave, itens]) => ({ chave, itens }))
      .sort((a, b) => ordem === 'vencimento'
        ? porVencimento(a.itens[0], b.itens[0])
        : a.itens[0].created_at.localeCompare(b.itens[0].created_at))
  }, [itens, ordem, grupo, soMinhas, papel])

  const total = grupos.reduce((n, g) => n + g.itens.length, 0)
  const impeditivos = itens.filter(i => i.situacao === 'impeditivo').length

  return (
    <section className="card p-5 mb-6">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
        <h2 className="font-semibold text-navy">
          Fila do dia <span className="text-ink/40 font-normal">({total})</span>
        </h2>
        <button className="btn-ghost" style={{ padding: '.15rem .6rem', fontSize: '.72rem' }}
          onClick={carregar} disabled={carregando}>{carregando ? '…' : '↻'}</button>
      </div>

      {impeditivos > 0 && (
        <p className="text-xs text-red-700 mb-2">
          {impeditivos} ato(s) com impedimento — certidão vencida, matrícula fora do prazo ou
          campo em branco na minuta.
        </p>
      )}

      {/* escolhas do escrevente */}
      <div className="flex flex-wrap items-center gap-3 mb-3 text-xs">
        <label className="flex items-center gap-1">
          <span className="text-ink/50">ordem</span>
          <select className="input" style={{ padding: '.2rem .4rem', fontSize: '.75rem', width: 'auto' }}
            value={ordem} onChange={e => setOrdem(e.target.value as Ordem)}>
            <option value="vencimento">por vencimento</option>
            <option value="chegada">por ordem de chegada</option>
          </select>
        </label>
        <label className="flex items-center gap-1">
          <span className="text-ink/50">agrupar</span>
          <select className="input" style={{ padding: '.2rem .4rem', fontSize: '.75rem', width: 'auto' }}
            value={grupo} onChange={e => setGrupo(e.target.value as Agrupar)}>
            <option value="nenhum">sem agrupamento</option>
            <option value="construtora">por construtora</option>
            <option value="empreendimento">por construtora e empreendimento</option>
          </select>
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={soMinhas} onChange={e => setSoMinhas(e.target.checked)} />
          <span>só a minha competência</span>
        </label>
      </div>

      {erro && <div className="text-sm text-red-600">{erro}</div>}

      {!erro && total === 0 && !carregando && (
        <p className="text-xs text-ink/50">Nenhum ato em curso.</p>
      )}

      {grupos.map(g => (
        <div key={g.chave || 'todos'} className="mb-3 last:mb-0">
          {g.chave && (
            <div className="text-[11px] uppercase tracking-wider text-brass mb-1 flex items-center gap-2">
              <span>{g.chave}</span>
              <span className="text-ink/30">({g.itens.length})</span>
            </div>
          )}
          <div className="space-y-1">
            {g.itens.map(i => (
              <Link key={i.id} to={`/solicitacao/${i.id}`}
                className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-paper transition-colors">
                <span className={`inline-block rounded-full shrink-0 ${PONTO[i.situacao]}`}
                  style={{ width: 8, height: 8 }} />
                <span className="font-mono text-xs text-ink/50 shrink-0" style={{ width: 92 }}>
                  {i.protocolo}
                </span>
                <span className="flex-1 text-xs truncate">
                  {i.titulo || i.tipo_nome}
                  {i.unidade && <span className="text-ink/50"> · un. {i.unidade}</span>}
                  {grupo === 'nenhum' && i.empreendimento && (
                    <span className="text-ink/40"> · {i.empreendimento}</span>
                  )}
                </span>
                <span className="text-[11px] text-ink/40 shrink-0 hidden sm:inline">{i.etapa}</span>
                <span className="text-[11px] shrink-0" style={{ width: 76, textAlign: 'right' }}>
                  {ordem === 'vencimento'
                    ? (i.dias_para_vencer == null
                        ? <span className="text-ink/30">sem prazo</span>
                        : i.dias_para_vencer < 0
                          ? <span className="text-red-700">vencido</span>
                          : <span className={i.dias_para_vencer <= 7 ? 'text-amber-800' : 'text-ink/50'}>
                              {i.dias_para_vencer}d
                            </span>)
                    : <span className="text-ink/40">{dataCurta(new Date(i.created_at))}</span>}
                </span>
              </Link>
            ))}
          </div>
        </div>
      ))}

      <p className="text-[11px] text-ink/45 mt-3">
        {ordem === 'vencimento'
          ? 'Ordenado pelo documento que expira primeiro — certidão ou matrícula. Ato sem prazo conhecido vai para o fim.'
          : 'Ordenado pela abertura do protocolo, do mais antigo para o mais recente.'}
      </p>
    </section>
  )
}

import { useMemo, useState } from 'react'

// ============================================================================
// Antes e depois entre versões da minuta
//
// Diff por LINHA, não por palavra: uma minuta é um documento de cláusulas, e o
// que o escrevente precisa ver é qual cláusula mudou — não que a palavra
// "trinta" virou "quarenta" no meio de um parágrafo de oito linhas.
//
// Implementado com a maior subsequência comum (LCS). Sem dependência: o
// algoritmo cabe em vinte linhas e a alternativa seria trazer uma biblioteca
// de diff inteira para o navegador.
// ============================================================================

type Tipo = 'igual' | 'add' | 'del'
interface Linha { tipo: Tipo; texto: string; nA?: number; nB?: number }

/** Ignora diferença só de espaçamento — reindentação não é mudança de conteúdo. */
const norm = (s: string) => s.replace(/\s+/g, ' ').trim()

function diffLinhas(a: string[], b: string[]): Linha[] {
  const n = a.length, m = b.length
  // Matriz de LCS. Minutas têm centenas de linhas, não milhares: cabe.
  const tab: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      tab[i][j] = norm(a[i]) === norm(b[j])
        ? tab[i + 1][j + 1] + 1
        : Math.max(tab[i + 1][j], tab[i][j + 1])
    }
  }
  const out: Linha[] = []
  let i = 0, j = 0
  while (i < n && j < m) {
    if (norm(a[i]) === norm(b[j])) { out.push({ tipo: 'igual', texto: b[j], nA: i + 1, nB: j + 1 }); i++; j++ }
    else if (tab[i + 1][j] >= tab[i][j + 1]) { out.push({ tipo: 'del', texto: a[i], nA: i + 1 }); i++ }
    else { out.push({ tipo: 'add', texto: b[j], nB: j + 1 }); j++ }
  }
  while (i < n) { out.push({ tipo: 'del', texto: a[i], nA: i + 1 }); i++ }
  while (j < m) { out.push({ tipo: 'add', texto: b[j], nB: j + 1 }); j++ }
  return out
}

/**
 * Esconde blocos longos de linhas iguais, mantendo três de contexto em volta
 * de cada mudança. Numa minuta de dez páginas com dois ajustes, mostrar tudo
 * faz a mudança desaparecer no meio do que ficou igual.
 */
function comContexto(linhas: Linha[], contexto = 3): (Linha | { tipo: 'corte'; texto: string })[] {
  const relevante = new Set<number>()
  linhas.forEach((l, i) => {
    if (l.tipo === 'igual') return
    for (let k = Math.max(0, i - contexto); k <= Math.min(linhas.length - 1, i + contexto); k++) relevante.add(k)
  })
  const out: (Linha | { tipo: 'corte'; texto: string })[] = []
  let pulando = 0
  linhas.forEach((l, i) => {
    if (relevante.has(i)) {
      if (pulando) { out.push({ tipo: 'corte', texto: `… ${pulando} linha(s) sem alteração` }); pulando = 0 }
      out.push(l)
    } else pulando++
  })
  if (pulando) out.push({ tipo: 'corte', texto: `… ${pulando} linha(s) sem alteração` })
  return out
}

const COR: Record<Tipo, string> = {
  add: 'bg-emerald-50 border-l-2 border-emerald-400',
  del: 'bg-red-50 border-l-2 border-red-300 line-through text-ink/50',
  igual: 'border-l-2 border-transparent',
}

export default function DiffMinuta({
  anterior, atual, rotuloA, rotuloB,
}: { anterior: string; atual: string; rotuloA: string; rotuloB: string }) {
  const [tudo, setTudo] = useState(false)

  const { linhas, add, del } = useMemo(() => {
    const d = diffLinhas((anterior ?? '').split('\n'), (atual ?? '').split('\n'))
    return {
      linhas: d,
      add: d.filter(l => l.tipo === 'add').length,
      del: d.filter(l => l.tipo === 'del').length,
    }
  }, [anterior, atual])

  const exibidas = tudo ? linhas : comContexto(linhas)

  if (!add && !del) {
    return (
      <div className="text-xs text-ink/50 p-3 bg-paper rounded-lg">
        As duas versões têm exatamente o mesmo texto. A diferença pode estar só nos metadados
        (tipo, parecer, descrição).
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
        <div className="text-xs">
          <span className="text-ink/50">{rotuloA} → {rotuloB}:</span>{' '}
          <b className="text-emerald-700">+{add}</b>{' '}
          <b className="text-red-700">−{del}</b>{' '}
          <span className="text-ink/50">linha(s)</span>
        </div>
        <button className="btn-ghost" style={{ padding: '.15rem .6rem', fontSize: '.72rem' }}
          onClick={() => setTudo(v => !v)}>
          {tudo ? 'só as mudanças' : 'mostrar tudo'}
        </button>
      </div>

      <div className="border border-black/8 rounded-lg overflow-auto" style={{ maxHeight: '60vh' }}>
        {exibidas.map((l, i) => l.tipo === 'corte' ? (
          <div key={i} className="text-[11px] text-ink/35 bg-paper px-3 py-1 text-center">{l.texto}</div>
        ) : (
          <div key={i} className={`flex gap-2 px-2 py-0.5 text-xs font-mono ${COR[l.tipo]}`}>
            <span className="text-ink/25 select-none shrink-0" style={{ width: 30, textAlign: 'right' }}>
              {(l as Linha).nB ?? (l as Linha).nA ?? ''}
            </span>
            <span className="text-ink/30 select-none shrink-0" style={{ width: 10 }}>
              {l.tipo === 'add' ? '+' : l.tipo === 'del' ? '−' : ''}
            </span>
            <span className="whitespace-pre-wrap break-words">{l.texto || '\u00A0'}</span>
          </div>
        ))}
      </div>

      <p className="text-[11px] text-ink/50 mt-2">
        Comparação por linha. Diferença apenas de espaçamento não é marcada como alteração.
      </p>
    </div>
  )
}

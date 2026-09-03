import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// ============================================================================
// Semáforo de prontidão
//
// Responde a uma pergunta só: este ato pode ser assinado hoje?
//
// A regra vive no banco (`prontidao_ato`) e é a MESMA que ordena a fila do
// cockpit. Se existisse nos dois lugares, a fila diria "urgente" e a tela do
// ato diria "pronto" — e ninguém saberia em qual acreditar.
// ============================================================================

export interface ItemProntidao {
  gravidade: 'impeditivo' | 'atencao'
  item: string
  detalhe: string
  dias?: number
}
export interface Prontidao {
  situacao: 'ok' | 'atencao' | 'impeditivo'
  itens: ItemProntidao[]
  impeditivos: number
  atencoes: number
  dias_para_vencer: number | null
}

const ESTILO = {
  ok: { faixa: 'bg-emerald-50 border-emerald-200', ponto: 'bg-emerald-500', texto: 'text-emerald-800' },
  atencao: { faixa: 'bg-amber-50 border-amber-200', ponto: 'bg-amber-500', texto: 'text-amber-900' },
  impeditivo: { faixa: 'bg-red-50 border-red-200', ponto: 'bg-red-500', texto: 'text-red-800' },
}

const TITULO = {
  ok: 'Pronto para assinatura',
  atencao: 'Pode assinar, com ressalvas',
  impeditivo: 'Não assine ainda',
}

export default function SemaforoProntidao({ solicitacaoId }: { solicitacaoId: string }) {
  const [p, setP] = useState<Prontidao | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [aberto, setAberto] = useState(false)

  async function carregar() {
    try {
      const { data, error } = await supabase.rpc('prontidao_ato', { p_solicitacao: solicitacaoId })
      if (error) throw error
      if ((data as any)?.erro) throw new Error((data as any).erro)
      const r = data as Prontidao
      setP(r)
      // Impedimento abre sozinho: exigir um clique para ver o que trava a
      // assinatura é esconder o que mais importa.
      setAberto(r.situacao === 'impeditivo')
    } catch (e: any) {
      setErro(`${e.message ?? e}. A 22ª migration já foi executada?`)
    }
  }
  useEffect(() => { carregar() }, [solicitacaoId])

  if (erro) return <div className="card p-3 mb-4 text-xs text-red-600">{erro}</div>
  if (!p) return null

  const st = ESTILO[p.situacao]

  return (
    <div className={`rounded-xl border px-4 py-3 mb-4 ${st.faixa}`}>
      <div className="flex items-center gap-3 flex-wrap">
        <span className={`inline-block rounded-full ${st.ponto}`} style={{ width: 12, height: 12 }} />
        <b className={`text-sm ${st.texto}`}>{TITULO[p.situacao]}</b>

        {p.impeditivos > 0 && (
          <span className="text-xs text-red-700">{p.impeditivos} impeditivo(s)</span>
        )}
        {p.atencoes > 0 && (
          <span className="text-xs text-amber-800">{p.atencoes} ponto(s) de atenção</span>
        )}
        {p.dias_para_vencer != null && p.dias_para_vencer >= 0 && p.dias_para_vencer <= 30 && (
          <span className="text-xs text-ink/60">
            documento mais próximo do vencimento: {p.dias_para_vencer} dia(s)
          </span>
        )}

        <div className="ml-auto flex gap-2">
          <button className="btn-ghost" style={{ padding: '.15rem .6rem', fontSize: '.72rem' }}
            onClick={carregar}>↻</button>
          {p.itens.length > 0 && (
            <button className="btn-ghost" style={{ padding: '.15rem .6rem', fontSize: '.72rem' }}
              onClick={() => setAberto(v => !v)}>
              {aberto ? 'ocultar' : `ver ${p.itens.length}`}
            </button>
          )}
        </div>
      </div>

      {aberto && p.itens.length > 0 && (
        <ul className="mt-2 space-y-1">
          {p.itens.map((i, k) => (
            <li key={k} className="text-xs flex gap-2">
              <span className={i.gravidade === 'impeditivo' ? 'text-red-600' : 'text-amber-700'}>
                {i.gravidade === 'impeditivo' ? '✕' : '○'}
              </span>
              <span>
                <b>{i.item}</b>
                <span className="text-ink/70"> — {i.detalhe}</span>
              </span>
            </li>
          ))}
        </ul>
      )}

      {p.situacao === 'ok' && (
        <p className="text-[11px] text-emerald-800/70 mt-1">
          Nada pendente nas verificações automáticas. A conferência do tabelião continua sendo a que vale.
        </p>
      )}
    </div>
  )
}

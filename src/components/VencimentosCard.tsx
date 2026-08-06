import { useEffect, useState } from 'react'
import { dataCurta } from '../lib/tempo'
import {
  vencimentosDoAto, JANELA_ALERTA_DIAS, COR_SITUACAO, LABEL_SITUACAO, LABEL_ORIGEM,
  type Vencimento,
} from '../lib/incorporacao'

/**
 * Vigência de certidões e procurações do ato e da construtora vinculada.
 * Documento vencido é exigência certa no registro — por isso o card sobe ao
 * topo quando há algo vencido ou a vencer em até 10 dias.
 */
export default function VencimentosCard({ solicitacaoId }: { solicitacaoId: string }) {
  const [itens, setItens] = useState<Vencimento[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    vencimentosDoAto(solicitacaoId).then(setItens).catch(e => setErro(e.message))
  }, [solicitacaoId])

  if (erro) return <div className="card p-4 mb-4 text-sm text-red-600">{erro}</div>
  if (!itens || itens.length === 0) return null

  const vencidos = itens.filter(i => i.situacao === 'vencido')
  const proximos = itens.filter(i => i.situacao === 'vence_em_breve')
  const critico = vencidos.length > 0
  const atencao = !critico && proximos.length > 0

  return (
    <div className="card p-5 mb-4"
      style={critico ? { borderColor: '#B3261E', borderWidth: 1 }
        : atencao ? { borderColor: '#E3C57E', borderWidth: 1 } : undefined}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-semibold text-navy">Vigência de certidões e procurações</h2>
          <p className="text-xs text-ink/55">
            Alerta a partir de {JANELA_ALERTA_DIAS} dias antes do vencimento.
          </p>
        </div>
        {critico && (
          <span className="badge" style={{ background: '#FBEAE9', color: '#B3261E' }}>
            {vencidos.length} vencido{vencidos.length > 1 ? 's' : ''}
          </span>
        )}
        {atencao && (
          <span className="badge" style={{ background: '#FFF8E8', color: '#A9761B' }}>
            {proximos.length} a vencer
          </span>
        )}
      </div>

      {critico && (
        <div className="mt-3 rounded-lg p-3 text-[13px]" style={{ background: '#FBEAE9', color: '#7F1D1B' }}>
          <b>Não lavre antes de regularizar.</b> Documento vencido é exigência certa no Registro de Imóveis
          e compromete a qualificação do título.
        </div>
      )}

      <ul className="mt-3 space-y-1.5">
        {itens.map((v, i) => (
          <li key={i} className="flex items-start gap-2 text-[13px]">
            <span className="mt-[6px] h-1.5 w-1.5 rounded-full shrink-0"
              style={{ background: COR_SITUACAO[v.situacao] }} />
            <span className="flex-1 min-w-0">
              <span className="text-ink/80">{v.descricao}</span>
              <span className="text-ink/45"> · {LABEL_ORIGEM[v.origem]}</span>
            </span>
            <span className="shrink-0 text-right">
              <span className="block text-[12px]" style={{ color: COR_SITUACAO[v.situacao] }}>
                {LABEL_SITUACAO[v.situacao]}
              </span>
              <span className="block text-[11px] text-ink/45">
                {dataCurta(new Date(v.validade + 'T12:00:00'))}
                {v.situacao === 'vencido'
                  ? ` · há ${Math.abs(v.dias_restantes)}d`
                  : v.situacao === 'vence_em_breve' ? ` · em ${v.dias_restantes}d` : ''}
              </span>
            </span>
          </li>
        ))}
      </ul>

      <p className="text-[11px] text-ink/45 mt-3 border-t border-black/5 pt-2">
        As datas vêm da leitura por IA das certidões e procurações anexadas e do cadastro da construtora.
        Confira o documento original antes da lavratura.
      </p>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { dataHora } from '../lib/tempo'
import { analisarRessalvas, type AnaliseRessalvas } from '../lib/incorporacao'
import {
  enviarParaConstrutora, historicoValidacao, agendarAssinatura,
  VALIDACAO_LABEL, VALIDACAO_COR,
  type ValidacaoStatus, type RodadaValidacao,
} from '../lib/construtoraPortal'

const ROTULO_ACAO: Record<string, string> = {
  enviada: 'Enviada à construtora', reenviada: 'Reenviada à construtora',
  aprovada: 'Aprovada pelo jurídico', ressalvas: 'Devolvida com ressalvas', reprovada: 'Reprovada',
}

/**
 * Fluxo com a construtora, visto pelo cartório:
 *   minuta pronta → envia → jurídico decide → aprovada libera a finalização
 *   → cartório agenda a assinatura com o comprador.
 * A validação é um gate ortogonal: não substitui nenhuma etapa interna.
 */
export default function ValidacaoConstrutoraCard({
  solicitacaoId, temEmpreendimento, validacao, assinaturaEm, assinaturaLocal, assinaturaStatus, onMudou,
}: {
  solicitacaoId: string
  temEmpreendimento: boolean
  validacao: ValidacaoStatus
  assinaturaEm?: string | null
  assinaturaLocal?: string | null
  assinaturaStatus?: string
  onMudou?: () => void
}) {
  const [hist, setHist] = useState<RodadaValidacao[]>([])
  const [obs, setObs] = useState('')
  const [quando, setQuando] = useState('')
  const [local, setLocal] = useState(assinaturaLocal ?? '')
  const [busy, setBusy] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [analise, setAnalise] = useState<AnaliseRessalvas | null>(null)
  const [analisando, setAnalisando] = useState(false)

  useEffect(() => { if (temEmpreendimento) historicoValidacao(solicitacaoId).then(setHist).catch(() => {}) },
    [solicitacaoId, temEmpreendimento, validacao])

  if (!temEmpreendimento) return null

  async function enviar() {
    setBusy(true); setErro(null); setMsg(null)
    try {
      const r = await enviarParaConstrutora(solicitacaoId, obs.trim() || undefined)
      if (!r.ok) { setErro(r.erro ?? 'Não foi possível enviar.'); return }
      setMsg(`Minuta enviada para validação (rodada ${r.rodada}).`); setObs(''); onMudou?.()
    } catch (e: any) { setErro(e.message) } finally { setBusy(false) }
  }

  async function agendar() {
    if (!quando) { setErro('Informe a data e a hora.'); return }
    setBusy(true); setErro(null); setMsg(null)
    try {
      const r = await agendarAssinatura(solicitacaoId, new Date(quando).toISOString(), local.trim() || undefined)
      if (!r.ok) { setErro(r.erro ?? 'Não foi possível agendar.'); return }
      setMsg(r.status === 'remarcada' ? 'Assinatura remarcada.' : 'Assinatura agendada.'); onMudou?.()
    } catch (e: any) { setErro(e.message) } finally { setBusy(false) }
  }

  const aprovada = validacao === 'aprovada'
  const emAnalise = validacao === 'enviada'
  const devolvida = validacao === 'ressalvas' || validacao === 'reprovada'
  const podeEnviar = !emAnalise

  return (
    <div className="card p-5 mb-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-semibold text-navy">Validação da construtora</h2>
          <p className="text-xs text-ink/55">
            O jurídico da construtora precisa aprovar a minuta antes da finalização e do agendamento.
          </p>
        </div>
        <span className="badge shrink-0" style={{ background: '#F3F1EC', color: VALIDACAO_COR[validacao] }}>
          {VALIDACAO_LABEL[validacao]}
        </span>
      </div>

      {devolvida && hist[0]?.observacoes && (
        <div className="mt-3 rounded-lg p-3 text-[13px]" style={{ background: '#FFF8E8', border: '1px solid #E3C57E' }}>
          <b>Observações da construtora:</b> {hist[0].observacoes}
          <div className="mt-2">
            <button className="btn-ghost" disabled={analisando} onClick={async () => {
              setAnalisando(true); setErro(null); setAnalise(null)
              try { setAnalise(await analisarRessalvas(solicitacaoId)) }
              catch (e: any) { setErro(e.message) } finally { setAnalisando(false) }
            }}>
              {analisando ? 'Analisando…' : '✦ Analisar ressalvas com a IA'}
            </button>
          </div>
        </div>
      )}

      {analise && (
        <div className="mt-3 rounded-lg border border-black/10 p-3">
          <div className="eyebrow mb-1">Sugestão de ajuste</div>
          {analise.resumo && <p className="text-[13px] text-ink/80 mb-2">{analise.resumo}</p>}

          {analise.ajustes.map((a, i) => (
            <div key={i} className="mb-2 pb-2 border-b border-black/5 last:border-0">
              <div className="text-[12px] text-ink/55"><b>Ressalva:</b> {a.ressalva}</div>
              {a.trecho_atual && (
                <div className="text-[12px] mt-1" style={{ color: '#B3261E' }}>
                  <b>Atual:</b> {a.trecho_atual}
                </div>
              )}
              <div className="text-[12px] mt-1 rounded p-2" style={{ background: '#EAF6EF', color: '#14532D' }}>
                <b>Sugerido:</b> {a.texto_sugerido}
                <button className="text-[11px] underline ml-2"
                  onClick={() => navigator.clipboard?.writeText(a.texto_sugerido)}>copiar</button>
              </div>
              {a.justificativa && <div className="text-[11px] text-ink/50 mt-1">{a.justificativa}</div>}
            </div>
          ))}

          {analise.objecoes.length > 0 && (
            <div className="rounded-lg p-2.5 mt-2" style={{ background: '#FBEAE9' }}>
              <div className="text-[12px] font-semibold" style={{ color: '#7F1D1B' }}>
                Ressalvas que não podem ser acatadas como pedidas
              </div>
              {analise.objecoes.map((o, i) => (
                <div key={i} className="text-[12px] text-ink/75 mt-1">
                  <b>{o.ressalva}</b> — {o.motivo}
                  {o.alternativa && <span className="block text-ink/60">Alternativa: {o.alternativa}</span>}
                </div>
              ))}
            </div>
          )}

          {analise.duvidas.length > 0 && (
            <div className="text-[12px] text-ink/65 mt-2">
              <b>A esclarecer com a construtora:</b> {analise.duvidas.join(' · ')}
            </div>
          )}

          <p className="text-[11px] text-ink/45 mt-2 border-t border-black/5 pt-2">
            Sugestão de apoio: aplique os ajustes na minuta, atualize-a e reenvie para validação.
            A redação final é do cartório.
          </p>
        </div>
      )}

      {/* Envio / reenvio */}
      {podeEnviar && (
        <div className="mt-3">
          <label className="label">{devolvida ? 'Resposta às ressalvas (opcional)' : 'Recado ao jurídico (opcional)'}</label>
          <textarea className="input" style={{ minHeight: 56 }} value={obs}
            onChange={e => setObs(e.target.value)}
            placeholder={devolvida ? 'Descreva os ajustes feitos na minuta…' : 'Ex.: minuta conforme o modelo padrão do empreendimento.'} />
          <button className="btn-brass mt-2" disabled={busy} onClick={enviar}>
            {busy ? 'Enviando…' : devolvida ? 'Reenviar minuta corrigida' : 'Enviar minuta para validação'}
          </button>
          <p className="text-[11px] text-ink/45 mt-1">
            Envia sempre a versão mais recente da minuta. A construtora vê o texto, mas não pode editá-lo.
          </p>
        </div>
      )}

      {emAnalise && (
        <p className="text-[13px] text-ink/70 mt-3">
          Aguardando a decisão do jurídico da construtora. A finalização fica bloqueada até a aprovação.
        </p>
      )}

      {/* Agendamento — liberado pela aprovação */}
      <div className="mt-4 pt-3 border-t border-black/5">
        <div className="flex items-center gap-2 mb-1">
          <span className="eyebrow">Assinatura com o comprador</span>
          {!aprovada && <span className="text-[11px] text-ink/45">— liberada após a aprovação</span>}
        </div>

        {assinaturaEm && (
          <p className="text-[13px] text-navy mb-2">
            <b>{dataHora(new Date(assinaturaEm))}</b>
            {assinaturaLocal ? ` · ${assinaturaLocal}` : ''}
            {assinaturaStatus === 'remarcada' ? ' (remarcada)' : ''}
          </p>
        )}

        <div className="grid gap-2" style={{ gridTemplateColumns: '1fr 1fr auto' }}>
          <input className="input" type="datetime-local" value={quando} disabled={!aprovada}
            onChange={e => setQuando(e.target.value)} />
          <input className="input" placeholder="Local (ex.: sede do cartório)" value={local} disabled={!aprovada}
            onChange={e => setLocal(e.target.value)} />
          <button className="btn-primary" disabled={busy || !aprovada} onClick={agendar}>
            {assinaturaEm ? 'Remarcar' : 'Agendar'}
          </button>
        </div>
      </div>

      {/* Trilha de auditoria */}
      {hist.length > 0 && (
        <details className="mt-4">
          <summary className="text-sm font-semibold text-navy cursor-pointer">
            Histórico de validação ({hist.length})
          </summary>
          <ul className="mt-2 space-y-1.5">
            {hist.map(h => (
              <li key={h.id} className="text-[12px] border-l-2 pl-2"
                style={{ borderColor: VALIDACAO_COR[(h.acao as ValidacaoStatus)] ?? '#DDD' }}>
                <span className="text-ink/50">{dataHora(new Date(h.created_at))} · rodada {h.rodada}</span>
                <span className="block font-medium text-navy">
                  {ROTULO_ACAO[h.acao] ?? h.acao}{h.autor_nome ? ` — ${h.autor_nome}` : ''}
                </span>
                {h.observacoes && <span className="block text-ink/70">{h.observacoes}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}

      {erro && <div className="text-sm text-red-600 mt-2">{erro}</div>}
      {msg && <div className="text-sm text-emerald-700 mt-2">{msg}</div>}
    </div>
  )
}

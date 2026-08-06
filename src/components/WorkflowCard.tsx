import { useEffect, useState } from 'react'
import { dataCurta, dataHora } from '../lib/tempo'
import type { Solicitacao } from '../lib/types'
import {
  meuPapel, PAPEL_LABEL, ETAPA_LABEL, ETAPAS_ORDEM, APROVADOR_LABEL, podeAgir, podeFinanceiro, aprovadorPorComplexidade,
  classificar, financeiroMarcar, avancar, devolver, finalizarFluxo,
  ultimaMinuta, salvarMinuta, baixarDoc, gerarSaidaPDF, listarSaidas, urlSaida, enviarWhatsapp, workflowLog,
  type Complexidade, type Saida, type WorkflowLog,
} from '../lib/workflow'

const COMPLEX = [
  { v: 'baixa', label: 'Baixa · Escrevente' },
  { v: 'media', label: 'Média · Tab. Substituto' },
  { v: 'alta', label: 'Alta · Tab. Oficial' },
] as const

const FIN_LABEL: Record<string, string> = { nao_aplicavel: 'Sem emolumentos', pendente: 'Aguardando Financeiro', validado: 'Financeiro validado' }
const FIN_COR: Record<string, string> = { nao_aplicavel: 'bg-gray-100 text-gray-600', pendente: 'bg-amber-50 text-amber-700', validado: 'bg-emerald-50 text-emerald-700' }
const ACAO_LOG: Record<string, string> = {
  classificado: 'Complexidade classificada', financeiro_lancado: 'Valores lançados',
  avancado: 'Avançou no fluxo', devolvido: 'Devolvido com exigência', finalizado: 'Finalizado e disponibilizado',
}

export default function WorkflowCard({ solic, onChange }: { solic: Solicitacao; onChange: () => void }) {
  const [papel, setPapel] = useState<string>('cliente')
  const [sugestao, setSugestao] = useState<string | null>(null)
  const [complexSel, setComplexSel] = useState<string>(solic.complexidade ?? '')
  const [emol, setEmol] = useState<string>(solic.emolumentos != null ? String(solic.emolumentos) : '')
  const [imp, setImp] = useState<string>(solic.impostos != null ? String(solic.impostos) : '')
  const [minutaId, setMinutaId] = useState<string | null>(null)
  const [conteudo, setConteudo] = useState('')
  const [saidas, setSaidas] = useState<Saida[]>([])
  const [log, setLog] = useState<WorkflowLog[]>([])
  const [exig, setExig] = useState('')
  const [mostrarDevolver, setMostrarDevolver] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  async function carregar() {
    setPapel(await meuPapel())
    const m = await ultimaMinuta(solic.id); setMinutaId(m?.id ?? null); setConteudo(m?.conteudo ?? '')
    setSaidas(await listarSaidas(solic.id))
    setLog(await workflowLog(solic.id))
    const { supabase } = await import('../lib/supabase')
    const { data: tri } = await supabase.from('triagem').select('resultado').eq('solicitacao_id', solic.id).order('created_at', { ascending: false }).limit(1).maybeSingle()
    setSugestao((tri as any)?.resultado?.complexidade_sugerida ?? null)
  }
  useEffect(() => { carregar() }, [solic.id])
  useEffect(() => { setComplexSel(solic.complexidade ?? ''); setEmol(solic.emolumentos != null ? String(solic.emolumentos) : ''); setImp(solic.impostos != null ? String(solic.impostos) : '') }, [solic])

  async function run(tag: string, fn: () => Promise<any>, okMsg?: string) {
    setBusy(tag); setErro(null); setMsg(null)
    try { await fn(); if (okMsg) setMsg(okMsg); setMostrarDevolver(false); setExig(''); await carregar(); onChange() }
    catch (e: any) { setErro(e.message ?? 'Falha na ação.') } finally { setBusy(null) }
  }

  const etapa = solic.etapa ?? 'elaboracao'
  const complexidade = solic.complexidade ?? null
  const finStatus = solic.financeiro_status ?? 'nao_aplicavel'
  const responsavel = solic.responsavel_papel ?? 'escrevente'
  const souResponsavel = podeAgir(papel, etapa, responsavel, complexidade)
  const concluida = etapa === 'concluida'

  // rótulo do botão avançar conforme a etapa
  const rotuloAvancar = etapa === 'elaboracao' ? 'Concluir elaboração e enviar'
    : etapa === 'financeiro' ? 'Validar pagamento e enviar à aprovação'
    : etapa === 'aprovacao' ? 'Aprovar e enviar para finalização'
    : 'Avançar'
  const bloqueiaAvancoElab = etapa === 'elaboracao' && !complexidade
  const bloqueiaFin = etapa === 'elaboracao' && finStatus === 'pendente' // precisa passar pelo financeiro (o fluxo roteia automático)

  const num = (v: any) => (v === '' || v == null ? 0 : Number(String(v).replace(',', '.')))
  async function baixarSaida(s: Saida) { const u = await urlSaida(s.storage_path); if (u) window.open(u, '_blank') }

  return (
    <div className="card p-5 mb-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="font-semibold text-navy">Workflow do cartório</h2>
        <span className="badge bg-navy text-white">Você: {PAPEL_LABEL[papel] ?? papel}</span>
      </div>

      {/* Trilha de etapas */}
      <div className="flex items-center gap-1 mt-3 flex-wrap">
        {ETAPAS_ORDEM.map((e, i) => {
          const idxAtual = ETAPAS_ORDEM.indexOf(etapa as any)
          const feito = i < idxAtual, atual = e === etapa
          return (
            <span key={e} className="flex items-center gap-1">
              <span className={`badge ${atual ? 'bg-brass text-navy' : feito ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>{ETAPA_LABEL[e]}</span>
              {i < ETAPAS_ORDEM.length - 1 && <span className="text-ink/30">›</span>}
            </span>
          )
        })}
      </div>
      {!concluida && (
        <div className="text-xs text-ink/60 mt-1">
          Responsável agora: <b>{PAPEL_LABEL[responsavel] ?? responsavel}</b>
          {souResponsavel ? <span className="text-emerald-700"> · é a sua vez</span> : <span> · aguardando este usuário</span>}
        </div>
      )}

      {/* Banner de exigência (quando devolvido ao escrevente) */}
      {solic.exigencia_atual && etapa === 'elaboracao' && (
        <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <b>Exigência de alteração:</b> {solic.exigencia_atual}
        </div>
      )}

      {/* 1. Complexidade */}
      <div className="mt-4">
        <div className="label">1 · Complexidade do ato</div>
        {sugestao && !complexidade && <div className="text-xs text-amber-700 mb-1">Sugestão da IA: <b>{sugestao}</b></div>}
        <div className="flex flex-wrap items-center gap-2">
          <select className="input w-auto" value={complexSel} onChange={e => setComplexSel(e.target.value)} disabled={concluida}>
            <option value="">Selecione…</option>
            {COMPLEX.map(c => <option key={c.v} value={c.v}>{c.label}</option>)}
          </select>
          <button className="btn-ghost" disabled={busy === 'clf' || !complexSel || concluida} onClick={() => run('clf', () => classificar(solic.id, complexSel as Complexidade), 'Complexidade classificada.')}>Classificar</button>
          {complexidade && <span className="text-xs text-ink/60">Aprovação por: <b>{APROVADOR_LABEL[complexidade]}</b></span>}
        </div>
      </div>

      {/* 2. Financeiro (lançamento na elaboração) */}
      <div className="mt-4">
        <div className="label">2 · Financeiro (emolumentos e impostos)</div>
        <div className="flex flex-wrap items-end gap-2">
          <div><span className="text-xs text-ink/60">Emolumentos (R$)</span><input className="input w-32" value={emol} onChange={e => setEmol(e.target.value)} disabled={concluida} /></div>
          <div><span className="text-xs text-ink/60">Impostos (R$)</span><input className="input w-32" value={imp} onChange={e => setImp(e.target.value)} disabled={concluida} /></div>
          <button className="btn-ghost" disabled={busy === 'finm' || concluida} onClick={() => run('finm', () => financeiroMarcar(solic.id, Number(emol || 0), Number(imp || 0)), 'Valores lançados.')}>Lançar</button>
          <span className={`badge ${FIN_COR[finStatus]}`}>{FIN_LABEL[finStatus]}</span>
        </div>
        {finStatus === 'pendente' && <div className="text-xs text-ink/50 mt-1">Com valores lançados, o fluxo passará pelo Financeiro antes da aprovação.</div>}
      </div>

      {/* 3. Documento editável + saídas */}
      <div className="mt-4">
        <div className="label">3 · Documento (editável antes do PDF final)</div>
        <textarea className="input" style={{ minHeight: 120, fontFamily: 'Georgia, serif' }} value={conteudo} onChange={e => setConteudo(e.target.value)} placeholder="A minuta aparece aqui após a compilação pela Artemis. Edite antes de gerar o PDF." />
        <div className="flex flex-wrap gap-2 mt-2">
          <button className="btn-ghost" disabled={!minutaId || busy === 'sav'} onClick={() => run('sav', () => salvarMinuta(minutaId!, conteudo, solic.id), 'Minuta salva.')}>Salvar edição</button>
          <button className="btn-ghost" disabled={!conteudo} onClick={() => baixarDoc(conteudo, `Minuta-${solic.protocolo ?? 'iNotario'}`)}>Baixar .doc</button>
          <button className="btn-ghost" disabled={!conteudo || busy === 'pdfr'} onClick={() => run('pdfr', () => gerarSaidaPDF(solic.id, conteudo, 'rascunho'), 'Rascunho PDF gerado.')}>Gerar rascunho PDF</button>
          <button className="btn-primary" disabled={!conteudo || (etapa !== 'finalizacao' && etapa !== 'concluida') || busy === 'pdff'} onClick={() => run('pdff', () => gerarSaidaPDF(solic.id, conteudo, 'final'), 'PDF final gerado.')}>Gerar PDF final</button>
        </div>
        {etapa !== 'finalizacao' && etapa !== 'concluida' && <div className="text-xs text-ink/50 mt-1">O PDF final é liberado na etapa de Finalização (após a aprovação).</div>}
        {saidas.length > 0 && (
          <div className="mt-3 space-y-1">
            {saidas.map(s => (
              <div key={s.id} className="flex items-center justify-between text-xs border border-black/5 rounded-lg px-2 py-1">
                <span><span className={`badge ${s.tipo === 'final' ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}>{s.tipo}</span> {s.formato.toUpperCase()} · {dataHora(new Date(s.created_at))}</span>
                <span className="flex gap-3">
                  <button className="text-navy underline" onClick={() => baixarSaida(s)}>abrir</button>
                  {solic.contato_whatsapp && (
                    <button className="text-emerald-700 underline" disabled={busy === 'wa' + s.id} onClick={() => run('wa' + s.id, () => enviarWhatsapp(solic.id, s.id), 'Enviado ao WhatsApp.')}>enviar ao WhatsApp</button>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 4. Ação da etapa: avançar / devolver / finalizar */}
      {!concluida && (
        <div className="mt-4 border-t border-black/5 pt-4">
          <div className="label">4 · Sua ação nesta etapa</div>
          {!souResponsavel ? (
            <div className="text-sm text-ink/60">Aguardando <b>{PAPEL_LABEL[responsavel] ?? responsavel}</b> executar esta etapa.</div>
          ) : etapa === 'finalizacao' ? (
            <div className="flex flex-wrap gap-2">
              <button className="btn-brass" disabled={busy === 'fin'} onClick={() => run('fin', () => finalizarFluxo(solic.id), 'Ato finalizado e disponibilizado ao cliente.')}>Finalizar e disponibilizar ao cliente</button>
              <button className="btn-ghost" onClick={() => setMostrarDevolver(v => !v)}>Devolver com exigência</button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button className="btn-brass" disabled={busy === 'avc' || bloqueiaAvancoElab}
                onClick={() => run('avc', () => avancar(solic.id))}>{rotuloAvancar}</button>
              {etapa !== 'elaboracao' && <button className="btn-ghost" onClick={() => setMostrarDevolver(v => !v)}>Devolver com exigência</button>}
            </div>
          )}
          {bloqueiaAvancoElab && <div className="text-xs text-amber-700 mt-1">Classifique a complexidade antes de avançar.</div>}

          {mostrarDevolver && (
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <input className="input flex-1" placeholder="Descreva a exigência de alteração ao escrevente…" value={exig} onChange={e => setExig(e.target.value)} />
              <button className="btn-ghost" disabled={busy === 'dev' || exig.trim().length < 3} onClick={() => run('dev', () => devolver(solic.id, exig), 'Devolvido ao escrevente com exigência.')}>Confirmar devolução</button>
            </div>
          )}
        </div>
      )}
      {concluida && <div className="mt-4 badge bg-emerald-50 text-emerald-700">Ato concluído e disponibilizado ao solicitante</div>}

      {/* Log de alterações */}
      {log.length > 0 && (
        <details className="mt-4">
          <summary className="text-sm font-semibold text-navy cursor-pointer">Log de alterações ({log.length})</summary>
          <div className="mt-2 space-y-1">
            {log.map(l => (
              <div key={l.id} className="text-xs border-l-2 border-brass/60 pl-2 py-0.5">
                <span className="text-ink/50">{dataHora(new Date(l.created_at))} · </span>
                <b>{ACAO_LOG[l.acao] ?? l.acao}</b>
                {l.papel && <span className="text-ink/60"> por {PAPEL_LABEL[l.papel] ?? l.papel}{l.ator_nome ? ` (${l.ator_nome})` : ''}</span>}
                {l.de_etapa && l.para_etapa && l.de_etapa !== l.para_etapa && <span className="text-ink/50"> · {ETAPA_LABEL[l.de_etapa] ?? l.de_etapa} → {ETAPA_LABEL[l.para_etapa] ?? l.para_etapa}</span>}
                {l.exigencia && <div className="text-amber-800">⚠ {l.exigencia}</div>}
              </div>
            ))}
          </div>
        </details>
      )}

      {erro && <div className="text-sm text-red-600 mt-3">{erro}</div>}
      {msg && <div className="text-sm text-emerald-700 mt-3">{msg}</div>}
    </div>
  )
}

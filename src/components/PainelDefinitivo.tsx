import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import {
  aplicarConsolidado, salvarOutrasInformacoes,
  aplicarClausulasContrato, marcarClausulaContrato, promoverClausulasContrato,
  type CampoAplicado, type Onus, type CertidaoAto, type ClausulaContrato,
} from '../lib/workflow'
import Modal from './Modal'

// ============================================================================
// Painel definitivo do ato
//
// É o que vale na minuta. O painel de cima (consolidado) mostra o que os
// documentos dizem; este mostra o que o cartório ADOTOU.
//
// A separação existe porque leitura por IA é proposta, não decisão. Aplicar é
// um ato do escrevente, registrado na cadeia de custódia com autor e horário.
// ============================================================================

const TEOR_COR: Record<string, string> = {
  'negativa': 'bg-emerald-50 text-emerald-700',
  'positiva com efeitos de negativa': 'bg-amber-50 text-amber-800',
  'positiva': 'bg-red-50 text-red-700',
  'indefinido': 'bg-gray-100 text-gray-600',
}

function dataBR(d?: string | null) {
  if (!d) return '—'
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : d
}

export default function PainelDefinitivo({
  solicitacaoId, aoAplicar,
}: { solicitacaoId: string; aoAplicar?: () => void }) {
  const [onus, setOnus] = useState<Onus[]>([])
  const [certs, setCerts] = useState<CertidaoAto[]>([])
  const [outras, setOutras] = useState('')
  const [incluir, setIncluir] = useState(false)
  const [aplicadoEm, setAplicadoEm] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [resultado, setResultado] = useState<CampoAplicado[] | null>(null)
  const [clausulas, setClausulas] = useState<ClausulaContrato[]>([])

  async function carregar() {
    const { data } = await supabase.from('solicitacoes')
      .select('onus, certidoes, outras_informacoes, incluir_outras_informacoes, dados_aplicados_em, clausulas_contrato')
      .eq('id', solicitacaoId).maybeSingle()
    const s = data as any
    setOnus(s?.onus ?? []); setCerts(s?.certidoes ?? [])
    setOutras(s?.outras_informacoes ?? ''); setIncluir(Boolean(s?.incluir_outras_informacoes))
    setAplicadoEm(s?.dados_aplicados_em ?? null); setClausulas(s?.clausulas_contrato ?? [])
  }
  useEffect(() => { carregar() }, [solicitacaoId])

  async function aplicar(sobrescrever: boolean) {
    setBusy('aplicar'); setErro(null); setMsg(null)
    try {
      const r = await aplicarConsolidado(solicitacaoId, sobrescrever)
      setResultado(r.aplicados)
      await carregar(); aoAplicar?.()
    } catch (e: any) { setErro(`${e.message ?? e}. A 20ª migration já foi executada?`) }
    finally { setBusy(null) }
  }

  async function lerClausulas() {
    setBusy('cls'); setErro(null); setMsg(null)
    try {
      const r = await aplicarClausulasContrato(solicitacaoId)
      setClausulas(r.clausulas)
      setMsg(r.sem_acervo
        ? `${r.total} cláusula(s) identificada(s); ${r.sem_acervo} sem correspondente no acervo.`
        : `${r.total} cláusula(s) identificada(s).`)
    } catch (e: any) { setErro(e.message ?? 'Falha ao ler as cláusulas.') }
    finally { setBusy(null) }
  }

  async function alternar(tema: string, pertinente: boolean) {
    try { setClausulas(await marcarClausulaContrato(solicitacaoId, tema, pertinente)) }
    catch (e: any) { setErro(e.message ?? 'Falha ao marcar.') }
  }

  async function promover() {
    setBusy('prom'); setErro(null); setMsg(null)
    try {
      const r = await promoverClausulasContrato(solicitacaoId)
      setMsg(r.inseridas
        ? `${r.inseridas} cláusula(s) adicionada(s) ao ato, com a redação do acervo. Regere a minuta.`
        : 'Nada a adicionar — as marcadas já estão no ato.')
      aoAplicar?.()
    } catch (e: any) { setErro(e.message ?? 'Falha ao promover.') }
    finally { setBusy(null) }
  }

  async function salvarTexto() {
    setBusy('texto'); setErro(null)
    try { await salvarOutrasInformacoes(solicitacaoId, outras, incluir); setMsg('Salvo.') }
    catch (e: any) { setErro(e.message ?? 'Falha ao salvar.') }
    finally { setBusy(null) }
  }

  return (
    <>
      <div className="card p-5 mb-6">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h2 className="font-semibold text-navy">Painel definitivo do ato</h2>
          <div className="flex gap-2">
            <button className="btn-primary" onClick={() => aplicar(false)} disabled={busy !== null}>
              {busy === 'aplicar' ? 'Aplicando…' : 'Aplicar dados dos documentos'}
            </button>
            <button className="btn-ghost" title="Substitui inclusive o que já foi preenchido à mão"
              onClick={() => aplicar(true)} disabled={busy !== null}>sobrescrever</button>
          </div>
        </div>
        <p className="text-[11px] text-ink/50 mt-1">
          É este painel — e não a leitura crua dos documentos — que alimenta a minuta e o assistente.
          {aplicadoEm && <> Última aplicação: {new Date(aplicadoEm).toLocaleString('pt-BR')}.</>}
        </p>

        {erro && <div className="text-sm text-red-600 mt-2">{erro}</div>}
        {msg && <div className="text-sm text-emerald-700 mt-2">{msg}</div>}

        {/* ônus e gravames */}
        <div className="mt-4">
          <div className="text-[11px] uppercase tracking-wider text-brass mb-1">
            Ônus e gravames ({onus.length})
          </div>
          {onus.length ? (
            <ul className="space-y-1">
              {onus.map((o, i) => (
                <li key={i} className="text-xs border-l-2 border-amber-300 pl-2">
                  <b>{o.tipo}</b>
                  {o.detalhe && <span className="text-ink/70"> — {o.detalhe}</span>}
                  {o.credor && <span className="text-ink/50"> · credor: {o.credor}</span>}
                  {o.valor && <span className="text-ink/50"> · {o.valor}</span>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-ink/50">
              Nenhum registrado. Aplique os dados com a matrícula vinculada para transcrever.
            </p>
          )}
        </div>

        {/* certidões */}
        <div className="mt-4">
          <div className="text-[11px] uppercase tracking-wider text-brass mb-1">
            Certidões ({certs.length})
          </div>
          {certs.length ? (
            <div className="space-y-1">
              {certs.map((c, i) => (
                <div key={i} className="flex gap-2 text-xs items-baseline">
                  <span className="flex-1">
                    {c.tipo}
                    {c.numero && <span className="text-ink/50"> nº {c.numero}</span>}
                  </span>
                  <span className="text-ink/50 shrink-0">
                    {dataBR(c.emitida_em)} → {dataBR(c.validade)}
                  </span>
                  <span className={`badge text-[10px] shrink-0 ${TEOR_COR[String(c.teor)] ?? TEOR_COR.indefinido}`}>
                    {c.teor}
                  </span>
                </div>
              ))}
            </div>
          ) : <p className="text-xs text-ink/50">Nenhuma vinculada.</p>}
          {certs.length > 0 && (
            <p className="text-[11px] text-ink/50 mt-1">
              Tipos reconhecidos para os campos da minuta:{' '}
              {['trabalhista', 'federal', 'imobiliária'].map(k => {
                const re = k === 'trabalhista' ? /trabalhist|cndt|tst/i
                  : k === 'federal' ? /feder|receita|pgfn|fazenda|uni[aã]o/i
                  : /imobili|iptu|municip|predial|prefeitura/i
                const achou = certs.some(c => re.test(String(c.tipo ?? '')))
                return (
                  <span key={k} className={achou ? 'text-emerald-700' : 'text-amber-800'}>
                    {achou ? '✓' : '○'} {k}{' '}
                  </span>
                )
              })}
            </p>
          )}
          {certs.some(c => String(c.teor) === 'indefinido') && (
            <p className="text-[11px] text-amber-800 mt-1">
              Há certidão sem teor identificado. Confira se é negativa, positiva ou positiva com
              efeitos de negativa antes de lavrar — o teor entra na minuta.
            </p>
          )}
        </div>

        {/* cláusulas do contrato */}
        <div className="mt-4">
          <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
            <div className="text-[11px] uppercase tracking-wider text-brass">
              Cláusulas do contrato ({clausulas.length})
            </div>
            <button className="btn-ghost" style={{ padding: '.15rem .6rem', fontSize: '.72rem' }}
              onClick={lerClausulas} disabled={busy !== null}>
              {busy === 'cls' ? 'Lendo…' : clausulas.length ? 'reler do contrato' : 'ler do contrato'}
            </button>
          </div>

          {clausulas.length ? (
            <>
              <div className="space-y-1.5">
                {clausulas.map((c, i) => (
                  <div key={i} className="text-xs border-l-2 pl-2"
                    style={{ borderColor: c.pertinente ? 'var(--brass)' : 'rgba(0,0,0,.1)' }}>
                    <label className="flex items-start gap-2 cursor-pointer">
                      <input type="checkbox" className="mt-0.5" checked={c.pertinente}
                        onChange={e => alternar(c.tema, e.target.checked)} />
                      <span className="flex-1">
                        <b className="capitalize">{c.tema}</b>
                        {c.clausula_id
                          ? <span className="badge bg-emerald-50 text-emerald-700 text-[10px] ml-1">no acervo</span>
                          : <span className="badge bg-amber-50 text-amber-800 text-[10px] ml-1">sem cláusula cadastrada</span>}
                        {c.resumo && <span className="block text-ink/70">{c.resumo}</span>}
                        {c.trecho && <span className="block text-ink/45 italic">“{c.trecho}”</span>}
                      </span>
                    </label>
                  </div>
                ))}
              </div>

              <button className="btn-primary mt-3" style={{ padding: '.25rem .7rem', fontSize: '.78rem' }}
                onClick={promover} disabled={busy !== null || !clausulas.some(c => c.pertinente && c.clausula_id)}>
                {busy === 'prom' ? 'Adicionando…' : 'Adicionar as marcadas ao ato'}
              </button>

              <p className="text-[11px] text-ink/50 mt-1">
                A IA identifica o TEMA no contrato; a redação vem do acervo do cartório. Tema sem
                cláusula cadastrada não é adicionado — cadastre a cláusula com o slug indicado ou
                insira-a manualmente no card de cláusulas especiais.
              </p>
              {clausulas.some(c => c.pertinente && !c.clausula_id) && (
                <p className="text-[11px] text-amber-800 mt-1">
                  Há tema marcado sem cláusula no acervo: {clausulas.filter(c => c.pertinente && !c.clausula_id)
                    .map(c => c.slug || c.tema).join(', ')}.
                </p>
              )}
            </>
          ) : (
            <p className="text-xs text-ink/50">
              Nenhuma lida. Vincule o contrato ao ato e clique em “ler do contrato”.
            </p>
          )}
        </div>

        {/* outras informações */}
        <div className="mt-4">
          <div className="text-[11px] uppercase tracking-wider text-brass mb-1">Outras informações do ato</div>
          <textarea className="input" rows={3} value={outras}
            placeholder="Texto livre — condição, declaração, particularidade deste ato."
            onChange={e => setOutras(e.target.value)} />
          <label className="flex items-center gap-2 mt-2 text-xs cursor-pointer">
            <input type="checkbox" checked={incluir} onChange={e => setIncluir(e.target.checked)} />
            <span>Incluir este texto na minuta</span>
          </label>
          <button className="btn-ghost mt-2" style={{ padding: '.25rem .7rem', fontSize: '.78rem' }}
            onClick={salvarTexto} disabled={busy !== null}>
            {busy === 'texto' ? 'Salvando…' : 'Salvar'}
          </button>
          <p className="text-[11px] text-ink/50 mt-1">
            Marcado, o texto entra no campo [OUTRAS INFORMAÇÕES] do modelo. Sem o campo no modelo,
            ele não aparece — o espelho não inventa posição.
          </p>
        </div>
      </div>

      <Modal
        aberto={resultado !== null}
        apenasAviso
        titulo="Dados aplicados ao ato"
        onFechar={() => setResultado(null)}
      >
        {resultado && (resultado.length ? (
          <>
            <p>{resultado.length} campo(s) atualizado(s) a partir dos documentos vinculados:</p>
            <ul className="mt-2 space-y-1">
              {resultado.map((a, i) => (
                <li key={i} className="text-xs">
                  <b>{a.campo}</b>: {a.de ? <s className="text-ink/40">{a.de}</s> : <i className="text-ink/40">vazio</i>} → {a.para}
                  <span className="text-ink/50"> ({a.fonte})</span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p>Nenhum campo mudou — os dados definitivos já estavam preenchidos.
            Use <b>sobrescrever</b> se quiser substituir pelo que os documentos dizem.</p>
        ))}
      </Modal>
    </>
  )
}

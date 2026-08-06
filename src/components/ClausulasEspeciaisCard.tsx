import { useEffect, useState } from 'react'
import {
  listarClausulas, clausulasDoAto, inserirClausulaNoAto, removerClausulaDoAto, recompilarMinuta,
  type Clausula, type ClausulaDoAto,
} from '../lib/incorporacao'

/**
 * Cláusulas especiais (retrovenda, reversão, perempção…) do acervo do cartório.
 * As escolhidas entram na próxima compilação da minuta, com a redação padrão
 * ajustada ao caso — a IA não inventa cláusula: usa o texto aprovado do acervo.
 */
export default function ClausulasEspeciaisCard({
  solicitacaoId, tipoAtoSlug, onMudou, onMinutaAtualizada,
}: { solicitacaoId: string; tipoAtoSlug?: string | null;
     onMudou?: () => void; onMinutaAtualizada?: (r: { versao: number; fonte: string | null }) => void }) {
  const [disponiveis, setDisponiveis] = useState<Clausula[]>([])
  const [noAto, setNoAto] = useState<ClausulaDoAto[]>([])
  const [aberta, setAberta] = useState<string | null>(null)
  const [rascunho, setRascunho] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [recompilando, setRecompilando] = useState(false)
  const [resultado, setResultado] = useState<{ versao: number; alertas: string[]; placeholders: string[]; fonte: string | null } | null>(null)

  async function carregar() {
    try {
      const [d, n] = await Promise.all([listarClausulas(tipoAtoSlug), clausulasDoAto(solicitacaoId)])
      setDisponiveis(d); setNoAto(n)
    } catch (e: any) { setErro(e.message) }
  }
  useEffect(() => { carregar() }, [solicitacaoId, tipoAtoSlug])

  async function inserir(c: Clausula) {
    setBusy(true); setErro(null)
    try {
      await inserirClausulaNoAto(solicitacaoId, {
        clausula_id: c.id, nome: c.nome,
        texto: rascunho[c.id] ?? c.texto, ordem: noAto.length,
      })
      setAberta(null); await carregar(); onMudou?.()
    } catch (e: any) { setErro(e.message) } finally { setBusy(false) }
  }

  async function remover(id: string) {
    setBusy(true)
    try { await removerClausulaDoAto(id); await carregar(); onMudou?.() }
    catch (e: any) { setErro(e.message) } finally { setBusy(false) }
  }

  const usadas = new Set(noAto.map(n => n.clausula_id))

  return (
    <div className="card p-5 mb-6">
      <h2 className="font-semibold text-navy">Cláusulas especiais</h2>
      <p className="text-xs text-ink/55">
        Escolha as cláusulas do acervo que devem constar da escritura. Elas entram na próxima
        compilação da minuta com a redação padrão do cartório.
      </p>

      {erro && <div className="text-sm text-red-600 mt-2">{erro}</div>}

      {noAto.length > 0 && (
        <div className="mt-3">
          <div className="eyebrow mb-1">Nesta escritura</div>
          <ul className="space-y-1.5">
            {noAto.map(n => (
              <li key={n.id} className="flex items-start gap-2 rounded-lg bg-paper px-3 py-2">
                <span className="flex-1 min-w-0">
                  <span className="block text-[13px] font-medium text-navy">{n.nome}</span>
                  <span className="block text-[12px] text-ink/60 line-clamp-2">{n.texto}</span>
                </span>
                <button className="text-ink/40 hover:text-red-600 text-lg leading-none px-1"
                  title="Remover da escritura" disabled={busy}
                  onClick={() => remover(n.id)}>×</button>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            <button className="btn-brass" disabled={recompilando || busy} onClick={async () => {
              setRecompilando(true); setErro(null); setResultado(null)
              try {
                const r = await recompilarMinuta(solicitacaoId)
                setResultado({ versao: r.versao, alertas: r.alertas ?? [], placeholders: r.placeholders ?? [], fonte: r.modelo_fonte })
                onMudou?.()
                onMinutaAtualizada?.({ versao: r.versao, fonte: r.modelo_fonte })
              } catch (e: any) { setErro(e.message) } finally { setRecompilando(false) }
            }}>
              {recompilando ? 'Atualizando minuta…' : '↻ Atualizar minuta'}
            </button>
            <span className="text-[11px] text-ink/50">
              Regera o texto com os dados atuais, o modelo aplicável e as cláusulas escolhidas.
            </span>
          </div>
        </div>
      )}

      {resultado && (
        <div className="mt-3 rounded-lg p-3" style={{ background: '#EAF6EF', border: '1px solid #9BC9AE' }}>
          <div className="text-[13px] font-semibold" style={{ color: '#14532D' }}>
            Minuta atualizada — versão {resultado.versao}
            {resultado.fonte && <span className="font-normal"> · base: {
              resultado.fonte === 'empreendimento' ? 'modelo do empreendimento'
              : resultado.fonte === 'construtora' ? 'modelo da construtora' : 'modelo padrão do acervo'}</span>}
          </div>
          {resultado.placeholders.length > 0 && (
            <div className="text-[12px] text-ink/70 mt-1">
              <b>Campos pendentes:</b> {resultado.placeholders.join(' · ')}
            </div>
          )}
          {resultado.alertas.length > 0 && (
            <ul className="text-[12px] text-ink/70 mt-1 list-disc pl-4">
              {resultado.alertas.slice(0, 4).map((a, i) => <li key={i}>{a}</li>)}
            </ul>
          )}
          <p className="text-[11px] text-ink/50 mt-1">Revise o texto no card da minuta antes de aprovar.</p>
        </div>
      )}

      <div className="mt-3">
        <div className="eyebrow mb-1">Disponíveis no acervo</div>
        {disponiveis.length === 0 ? (
          <p className="text-[12px] text-ink/50">
            Nenhuma cláusula cadastrada. Cadastre em <b>Acervo → Cláusulas</b>.
          </p>
        ) : (
          <div className="space-y-1.5">
            {disponiveis.map(c => (
              <div key={c.id} className="rounded-lg border border-black/10">
                <div className="flex items-center gap-2 px-3 py-2">
                  <span className="flex-1 min-w-0">
                    <span className="text-[13px] font-medium text-navy">{c.nome}</span>
                    {c.categoria && <span className="badge bg-paper ml-2 text-[10px]">{c.categoria}</span>}
                    {c.fundamento && <span className="block text-[11px] text-ink/50">{c.fundamento}</span>}
                  </span>
                  {usadas.has(c.id) ? (
                    <span className="text-[11px] text-emerald-700 shrink-0">já inserida</span>
                  ) : (
                    <button className="btn-ghost text-[12px] py-1 shrink-0"
                      onClick={() => { setAberta(aberta === c.id ? null : c.id); setRascunho(r => ({ ...r, [c.id]: r[c.id] ?? c.texto })) }}>
                      {aberta === c.id ? 'fechar' : 'revisar e inserir'}
                    </button>
                  )}
                </div>
                {aberta === c.id && (
                  <div className="px-3 pb-3">
                    {c.orientacao && (
                      <p className="text-[11px] text-ink/60 mb-1.5"><b>Quando usar:</b> {c.orientacao}</p>
                    )}
                    <textarea className="input" style={{ minHeight: 120, fontSize: '.82rem' }}
                      value={rascunho[c.id] ?? c.texto}
                      onChange={e => setRascunho(r => ({ ...r, [c.id]: e.target.value }))} />
                    <p className="text-[11px] text-ink/45 mt-1">
                      Ajuste os [campos] entre colchetes; a IA completa o que faltar com os dados do ato.
                    </p>
                    <button className="btn-brass mt-2" disabled={busy} onClick={() => inserir(c)}>
                      {busy ? 'Inserindo…' : 'Inserir na escritura'}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

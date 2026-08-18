import { useState } from 'react'
import {
  lerContratoSocial, importarRepresentantes,
  type Construtora, type LeituraContratoSocial, type RepresentanteLido,
} from '../lib/incorporacao'

// ============================================================================
// Contrato social lido por IA
//
// Mostra os poderes de representação antes dos nomes, de propósito: saber que
// "dois diretores em conjunto" é a regra muda o que o cartório faz com a lista
// de representantes. Ler a lista primeiro induz ao erro de aceitar assinatura
// isolada de quem aparece no topo.
//
// Isto NÃO substitui o cadastro manual — o botão de importar só cria quem
// ainda não existe, e cada registro guarda de onde veio.
// ============================================================================

const FORMA_LABEL: Record<string, string> = {
  isolada: 'Assinatura isolada',
  conjunta: 'Assinatura em conjunto',
  conjunta_com_outro: 'Em conjunto com pessoa determinada',
}
const FORMA_COR: Record<string, string> = {
  isolada: 'bg-emerald-50 text-emerald-700',
  conjunta: 'bg-amber-50 text-amber-800',
  conjunta_com_outro: 'bg-amber-50 text-amber-800',
}

function qualificacao(r: RepresentanteLido): string {
  return [r.cargo, r.cpf && `CPF ${r.cpf}`, r.nacionalidade, r.estado_civil, r.profissao, r.endereco]
    .filter(Boolean).join(' · ')
}

export default function ContratoSocialCard({
  construtora, onImportado,
}: { construtora: Construtora; onImportado: () => void }) {
  const [leitura, setLeitura] = useState<LeituraContratoSocial | null>(construtora.contrato_social_lido ?? null)
  const [busy, setBusy] = useState<'ler' | 'importar' | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const temFonte = Boolean(construtora.contrato_social_path || construtora.modelo_escritura)

  async function ler() {
    setBusy('ler'); setErro(null); setMsg(null)
    try {
      const r = await lerContratoSocial(construtora.id)
      setLeitura(r.leitura)
    } catch (e: any) { setErro(e.message ?? 'Falha ao ler.') }
    finally { setBusy(null) }
  }

  async function importar() {
    if (!leitura?.representantes?.length) return
    setBusy('importar'); setErro(null); setMsg(null)
    try {
      const n = await importarRepresentantes(construtora.id, leitura.representantes, leitura.fonte)
      setMsg(n ? `${n} representante(s) criado(s).` : 'Nenhum representante novo — os lidos já estão cadastrados.')
      onImportado()
    } catch (e: any) { setErro(e.message ?? 'Falha ao importar.') }
    finally { setBusy(null) }
  }

  const p = leitura?.poderes
  const restricoes = p?.restricoes?.filter(Boolean) ?? []

  return (
    <div className="card p-4 mt-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="font-semibold text-navy">Representação legal (leitura por IA)</h3>
        <button className="btn-ghost" onClick={ler} disabled={busy !== null || !temFonte}>
          {busy === 'ler' ? 'Lendo…' : leitura ? 'Ler de novo' : 'Ler contrato social'}
        </button>
      </div>

      {!temFonte && (
        <p className="text-xs text-ink/50 mt-2">
          Anexe o contrato social acima — ou preencha o modelo de escritura — para a IA poder ler.
        </p>
      )}

      {erro && <div className="text-sm text-red-600 mt-2">{erro}</div>}
      {msg && <div className="text-sm text-emerald-700 mt-2">{msg}</div>}

      {leitura && (
        <div className="mt-3">
          {leitura.fonte === 'modelo_escritura' && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 text-amber-900 px-3 py-2 text-xs mb-3">
              <b>Fonte secundária.</b> Não há contrato social anexado — isto foi lido do modelo de escritura,
              que reflete o que a construtora usa, não o que a Junta registrou. Confirme com o contrato social
              antes de usar em escritura.
            </div>
          )}
          {leitura.confianca === 'baixa' && (
            <div className="rounded-lg border border-red-200 bg-red-50 text-red-800 px-3 py-2 text-xs mb-3">
              A IA marcou esta leitura como de <b>baixa confiança</b> — documento ilegível, truncado ou parcial.
              Confira item a item.
            </div>
          )}

          {/* poderes primeiro: é a regra que condiciona a leitura dos nomes */}
          <div className="rounded-lg bg-paper p-3">
            <div className="text-[11px] uppercase tracking-wider text-brass mb-1">Poderes de representação</div>
            <div className="text-sm">{p?.forma || '—'}</div>
            {p?.quorum && <div className="text-xs text-ink/70 mt-0.5">Quórum: {p.quorum}</div>}
            {p?.limite_valor && <div className="text-xs text-ink/70">Limite de valor: {p.limite_valor}</div>}
            {p?.exige_anuencia && (
              <div className="text-xs text-amber-800 mt-1">Exige anuência de sócio ou assembleia.</div>
            )}
            {restricoes.length > 0 && (
              <div className="mt-2">
                <div className="text-[11px] uppercase tracking-wider text-brass mb-1">Restrições</div>
                <ul className="text-xs list-disc ml-4 space-y-0.5">
                  {restricoes.map((r, i) => <li key={i}>{r}</li>)}
                </ul>
              </div>
            )}
            {p?.observacao && <div className="text-xs text-ink/60 mt-2">{p.observacao}</div>}
          </div>

          <div className="text-[11px] uppercase tracking-wider text-brass mt-3 mb-1">
            Representantes identificados ({leitura.representantes?.length ?? 0})
          </div>
          <div className="space-y-2">
            {(leitura.representantes ?? []).map((r, i) => (
              <div key={i} className="border border-black/5 rounded-lg px-3 py-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <b className="text-sm">{r.nome}</b>
                  {r.poderes_forma && (
                    <span className={`badge ${FORMA_COR[r.poderes_forma] ?? 'bg-paper'}`}>
                      {FORMA_LABEL[r.poderes_forma] ?? r.poderes_forma}
                    </span>
                  )}
                </div>
                {qualificacao(r) && <div className="text-xs text-ink/60 mt-0.5">{qualificacao(r)}</div>}
                {r.restricoes && <div className="text-xs text-amber-800 mt-0.5">{r.restricoes}</div>}
              </div>
            ))}
            {!(leitura.representantes ?? []).length && (
              <p className="text-xs text-ink/50">Nenhum representante identificado no documento.</p>
            )}
          </div>

          {leitura.alteracao_mais_recente && (
            <div className="text-[11px] text-ink/50 mt-2">
              Redação vigente considerada: {leitura.alteracao_mais_recente}
            </div>
          )}

          <button className="btn-primary mt-3" onClick={importar}
            disabled={busy !== null || !(leitura.representantes ?? []).length}>
            {busy === 'importar' ? 'Importando…' : 'Cadastrar os que faltam'}
          </button>
          <div className="text-[11px] text-ink/50 mt-2">
            Leitura assistida por IA. Cria apenas quem ainda não está cadastrado e não altera registros
            existentes — o cadastro manual continua disponível para inserção avulsa.
          </div>
        </div>
      )}
    </div>
  )
}

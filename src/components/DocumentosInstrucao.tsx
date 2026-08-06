import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import {
  listarDocumentos, uploadDocumento, extrairDocumento, marcarValidado, urlDocumento,
  TIPOS_DOC_INSTRUCAO, type Documento, type TipoDocInstrucao,
} from '../lib/documentos'
import type { Solicitacao, Parte, TipoAto } from '../lib/types'

const STATUS_LABEL: Record<string, string> = { pendente: 'Pendente', extraido: 'Lido pela IA', validado: 'Validado' }
const STATUS_COR: Record<string, string> = {
  pendente: 'bg-gray-100 text-gray-600', extraido: 'bg-amber-50 text-amber-700', validado: 'bg-emerald-50 text-emerald-700',
}

export default function DocumentosInstrucao({
  solicitacao, tipo, onApplied,
}: { solicitacao: Solicitacao; tipo: TipoAto; partes: Parte[]; onApplied: () => void }) {
  const [docs, setDocs] = useState<Documento[]>([])
  const [tipoSel, setTipoSel] = useState<TipoDocInstrucao>('rg')
  const [enviando, setEnviando] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [edit, setEdit] = useState<Record<string, any>>({})
  const [papelSel, setPapelSel] = useState<Record<string, string>>({})

  async function carregar() { setDocs(await listarDocumentos(solicitacao.id)) }
  useEffect(() => { carregar() }, [solicitacao.id])

  async function subir(file: File | null) {
    if (!file) return
    setEnviando(true); setErro(null)
    try {
      const doc = await uploadDocumento(solicitacao.id, file, tipoSel)
      await carregar()
      // Leitura automática: o documento chega e a IA já extrai, poupando um
      // clique. A APLICAÇÃO dos dados continua manual — a conferência humana
      // é obrigatória antes de qualquer dado entrar no ato.
      setBusy(doc.id)
      try {
        const ex = await extrairDocumento(doc.id)
        setEdit(s => ({ ...s, [doc.id]: ex }))
        await carregar()
      } catch (e: any) {
        setErro(`Documento anexado, mas a leitura automática falhou (${e.message ?? 'erro'}). Use "Extrair dados (IA)".`)
      } finally { setBusy(null) }
    }
    catch (e: any) { setErro(e.message ?? 'Falha no upload.') } finally { setEnviando(false) }
  }

  async function extrair(d: Documento) {
    setBusy(d.id); setErro(null)
    try { const ex = await extrairDocumento(d.id); setEdit(s => ({ ...s, [d.id]: ex })); await carregar() }
    catch (e: any) { setErro(e.message ?? 'Falha na leitura.') } finally { setBusy(null) }
  }

  const setCampo = (id: string, k: string, v: any) => setEdit(s => ({ ...s, [id]: { ...s[id], [k]: v } }))

  async function finalizar(d: Documento) {
    await marcarValidado(d.id)
    await supabase.rpc('registrar_custodia', { p_solicitacao: solicitacao.id, p_minuta: null, p_acao: 'dados_validados', p_detalhe: { documento: d.tipo } })
    setEdit(s => { const c = { ...s }; delete c[d.id]; return c })
    await carregar(); onApplied()
  }

  async function aplicarPessoa(d: Documento) {
    const ex = edit[d.id]; const papel = papelSel[d.id] || tipo.papeis[0]
    setBusy(d.id); setErro(null)
    try {
      const { data: existente } = await supabase.from('partes').select('id, dados')
        .eq('solicitacao_id', solicitacao.id).eq('papel', papel).maybeSingle()
      const dados = { ...((existente as any)?.dados || {}), rg: ex.rg, data_nascimento: ex.data_nascimento, filiacao: ex.filiacao, nacionalidade: ex.nacionalidade, endereco: ex.endereco }
      if (existente) await supabase.from('partes').update({ nome: ex.nome, cpf_cnpj: ex.cpf, dados }).eq('id', (existente as any).id)
      else await supabase.from('partes').insert({ solicitacao_id: solicitacao.id, papel, nome: ex.nome, cpf_cnpj: ex.cpf, dados })
      await finalizar(d)
    } catch (e: any) { setErro(e.message) } finally { setBusy(null) }
  }

  async function aplicarImovel(d: Documento) {
    const ex = edit[d.id]
    setBusy(d.id); setErro(null)
    try {
      const dados = { ...(solicitacao.dados || {}), imovel_descricao: ex.imovel_descricao, imovel_matricula: ex.imovel_matricula, imovel_cartorio_ri: ex.imovel_cartorio_ri }
      await supabase.from('solicitacoes').update({ dados }).eq('id', solicitacao.id)
      await finalizar(d)
    } catch (e: any) { setErro(e.message) } finally { setBusy(null) }
  }

  async function abrir(d: Documento) { const u = await urlDocumento(d.storage_path); if (u) window.open(u, '_blank') }

  const fieldRow = (id: string, k: string, label: string, full = false) => (
    <div className={full ? 'md:col-span-2' : ''}>
      <label className="label">{label}</label>
      <input className="input" value={edit[id]?.[k] ?? ''} onChange={e => setCampo(id, k, e.target.value)} />
    </div>
  )

  return (
    <div className="card p-5 mb-6">
      <h2 className="font-semibold text-navy mb-1">Documentos de instrução · preenchimento por IA</h2>
      <p className="text-ink/60 text-xs mb-3">
        Envie RG/CNH das partes ou a matrícula do imóvel. A IA lê e pré-preenche os campos para a sua validação antes de gravar.
        <span className="text-amber-700"> Atenção: nesta etapa o documento é enviado em claro ao provedor de IA (não pseudonimizado).</span>
      </p>

      {/* Upload */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <select className="input w-auto" value={tipoSel} onChange={e => setTipoSel(e.target.value as TipoDocInstrucao)}>
          {TIPOS_DOC_INSTRUCAO.map(t => <option key={t.v} value={t.v}>{t.label}</option>)}
        </select>
        <input type="file" accept="image/*,application/pdf" disabled={enviando} onChange={e => subir(e.target.files?.[0] ?? null)} />
        {enviando && <span className="text-ink/50 text-xs">enviando…</span>}
      </div>
      {erro && <div className="text-sm text-red-600 mb-2">{erro}</div>}

      {/* Lista */}
      {docs.length === 0 ? <div className="text-ink/50 text-xs">Nenhum documento enviado.</div> : (
        <div className="space-y-3">
          {docs.map(d => (
            <div key={d.id} className="border border-black/5 rounded-xl p-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <span className="badge bg-navy text-white">{d.tipo.toUpperCase()}</span>
                  <span className="text-sm text-ink/80">{d.nome_arquivo}</span>
                  <span className={`badge ${STATUS_COR[d.status]}`}>{STATUS_LABEL[d.status]}</span>
                </div>
                <div className="flex gap-3">
                  <button className="text-navy text-xs underline" onClick={() => abrir(d)}>abrir</button>
                  {!edit[d.id] && (
                    <button className="btn-brass" onClick={() => extrair(d)} disabled={busy === d.id}>
                      {busy === d.id ? 'Lendo…' : (d.status === 'pendente' ? 'Extrair dados (IA)' : 'Reler')}
                    </button>
                  )}
                </div>
              </div>

              {/* Painel de validação (editável) */}
              {edit[d.id] && (
                <div className="mt-3 bg-paper rounded-lg p-3">
                  <div className="text-xs font-semibold text-ink/70 mb-2">Confira e ajuste antes de aplicar:</div>
                  {(d.tipo === 'rg' || d.tipo === 'cnh') ? (
                    <>
                      <div className="grid md:grid-cols-2 gap-2">
                        {fieldRow(d.id, 'nome', 'Nome', true)}
                        {fieldRow(d.id, 'cpf', 'CPF')}
                        {fieldRow(d.id, 'rg', 'RG')}
                        {fieldRow(d.id, 'data_nascimento', 'Nascimento')}
                        {fieldRow(d.id, 'nacionalidade', 'Nacionalidade')}
                        {fieldRow(d.id, 'filiacao', 'Filiação', true)}
                        {fieldRow(d.id, 'endereco', 'Endereço', true)}
                      </div>
                      <div className="flex flex-wrap items-end gap-2 mt-3">
                        <div>
                          <label className="label">Aplicar como</label>
                          <select className="input w-auto" value={papelSel[d.id] || tipo.papeis[0]} onChange={e => setPapelSel(s => ({ ...s, [d.id]: e.target.value }))}>
                            {tipo.papeis.map(p => <option key={p} value={p}>{p}</option>)}
                          </select>
                        </div>
                        <button className="btn-primary" onClick={() => aplicarPessoa(d)} disabled={busy === d.id}>Validar e aplicar à parte</button>
                      </div>
                    </>
                  ) : d.tipo === 'matricula' ? (
                    <>
                      <div className="grid md:grid-cols-2 gap-2">
                        {fieldRow(d.id, 'imovel_matricula', 'Matrícula')}
                        {fieldRow(d.id, 'imovel_cartorio_ri', 'Cartório de RI')}
                        {fieldRow(d.id, 'imovel_descricao', 'Descrição do imóvel', true)}
                      </div>
                      {edit[d.id]?.proprietarios && (
                        <div className="text-xs text-ink/60 mt-2">Proprietários lidos: {(edit[d.id].proprietarios || []).join('; ') || '—'}</div>
                      )}
                      {Array.isArray(edit[d.id]?.onus) && edit[d.id].onus.length > 0 && (
                        <div className="text-xs mt-1 text-amber-700">Ônus/gravames lidos: {edit[d.id].onus.map((o: any) => o.tipo + (o.detalhe ? ` (${o.detalhe})` : '')).join('; ')}</div>
                      )}
                      <button className="btn-primary mt-3" onClick={() => aplicarImovel(d)} disabled={busy === d.id}>Validar e aplicar ao imóvel</button>
                    </>
                  ) : (
                    <pre className="text-xs whitespace-pre-wrap">{JSON.stringify(edit[d.id], null, 2)}</pre>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

import { useEffect, useState } from 'react'
import { dataCurta, dataHora } from '../lib/tempo'
import { Layout } from '../components/ui'
import {
  adminListar, adminSalvarPlano, adminUsuarioMaster, adminGerarFatura, adminExtrato, adminMarcarPaga,
  brl, competenciaAtual, type CartorioAdmin, type Plano,
} from '../lib/faturamento'

export default function AdminPlataforma() {
  const [carts, setCarts] = useState<CartorioAdmin[]>([])
  const [sel, setSel] = useState<CartorioAdmin | null>(null)
  const [plano, setPlano] = useState<Partial<Plano>>({})
  const [master, setMaster] = useState({ email: '', senha: '', nome: '' })
  const [comp, setComp] = useState(competenciaAtual())
  const [extrato, setExtrato] = useState<any[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  async function carregar() {
    try { const r = await adminListar(); setCarts(r.cartorios) }
    catch (e: any) { setErro(e.message) }
  }
  useEffect(() => { carregar() }, [])

  function abrir(c: CartorioAdmin) {
    setSel(c); setExtrato(null); setMsg(null); setErro(null)
    setPlano(c.plano ?? { valor_fixo: 0, valor_ato: 0, ativo: true })
    setMaster({ email: c.plano?.email_master ?? '', senha: '', nome: '' })
  }

  async function run(tag: string, fn: () => Promise<any>, ok?: string) {
    setBusy(tag); setErro(null); setMsg(null)
    try { await fn(); if (ok) setMsg(ok); await carregar() }
    catch (e: any) { setErro(e.message) } finally { setBusy(null) }
  }

  const num = (v: any) => (v === '' || v == null ? 0 : Number(String(v).replace(',', '.')))

  return (
    <Layout title="Administração da plataforma">
      <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-5">
        {/* Lista de cartórios */}
        <div className="card p-0 overflow-hidden self-start">
          <div className="pad border-b border-black/5 font-semibold text-navy">Cartórios assinantes</div>
          {carts.length === 0 && <div className="pad text-ink/50 text-sm">Nenhum cartório encontrado.</div>}
          {carts.map(c => (
            <button key={c.id} onClick={() => abrir(c)}
              className={`w-full text-left px-5 py-3 border-b border-black/5 hover:bg-paper transition ${sel?.id === c.id ? 'bg-paper' : ''}`}>
              <div className="flex justify-between items-center gap-2">
                <div>
                  <div className="font-medium text-navy text-sm">{c.nome}</div>
                  <div className="text-xs text-ink/50">{c.comarca ?? ''}{c.uf ? `/${c.uf}` : ''}</div>
                </div>
                <div className="text-right text-xs">
                  {c.plano ? (
                    <>
                      <div>{brl(c.plano.valor_fixo)} + {brl(c.plano.valor_ato)}/ato</div>
                      <div className={c.plano.ativo ? 'text-emerald-700' : 'text-red-600'}>
                        {c.plano.ativo ? 'ativo' : 'inativo'}{c.plano.validade ? ` · até ${dataCurta(new Date(c.plano.validade + 'T12:00:00'))}` : ''}
                      </div>
                    </>
                  ) : <span className="text-amber-700">sem plano</span>}
                  {c.ultima_fatura && <div className="text-ink/50">últ. fatura {c.ultima_fatura.competencia}: {brl(c.ultima_fatura.valor_total)} ({c.ultima_fatura.status})</div>}
                </div>
              </div>
            </button>
          ))}
        </div>

        {/* Detalhe do cartório */}
        {sel ? (
          <div className="space-y-5">
            <div className="card p-5">
              <h2 className="font-semibold text-navy mb-2">Plano · {sel.nome}</h2>
              <div className="grid md:grid-cols-2 gap-2">
                <div><label className="label">Mensalidade fixa (R$)</label>
                  <input className="input" value={plano.valor_fixo ?? ''} onChange={e => setPlano(p => ({ ...p, valor_fixo: num(e.target.value) }))} /></div>
                <div><label className="label">Valor por ato (R$)</label>
                  <input className="input" value={plano.valor_ato ?? ''} onChange={e => setPlano(p => ({ ...p, valor_ato: num(e.target.value) }))} /></div>
                <div><label className="label">Tabelião oficial</label>
                  <input className="input" value={plano.tabeliao_oficial ?? ''} onChange={e => setPlano(p => ({ ...p, tabeliao_oficial: e.target.value }))} /></div>
                <div><label className="label">Validade da assinatura</label>
                  <input type="date" className="input" value={plano.validade ?? ''} onChange={e => setPlano(p => ({ ...p, validade: e.target.value }))} /></div>
                <div><label className="label">E-mail de contato</label>
                  <input className="input" value={plano.contato_email ?? ''} onChange={e => setPlano(p => ({ ...p, contato_email: e.target.value }))} /></div>
                <div><label className="label">Telefone de contato</label>
                  <input className="input" value={plano.contato_fone ?? ''} onChange={e => setPlano(p => ({ ...p, contato_fone: e.target.value }))} /></div>
                <div className="md:col-span-2"><label className="label">Observações do contrato</label>
                  <input className="input" value={plano.obs ?? ''} onChange={e => setPlano(p => ({ ...p, obs: e.target.value }))} /></div>
              </div>
              <label className="flex items-center gap-2 mt-2 text-sm">
                <input type="checkbox" checked={plano.ativo !== false} onChange={e => setPlano(p => ({ ...p, ativo: e.target.checked }))} style={{ width: 'auto' }} />
                Assinatura ativa
              </label>
              <button className="btn-primary mt-3" disabled={busy === 'plano'} onClick={() => run('plano', () => adminSalvarPlano(sel.id, plano), 'Plano salvo.')}>Salvar plano</button>
            </div>

            <div className="card p-5">
              <h2 className="font-semibold text-navy mb-1">Login master do cartório</h2>
              <p className="text-xs text-ink/50 mb-2">Cria (ou redefine a senha de) o usuário master, com papel Tabelião Oficial, vinculado a este cartório.</p>
              <div className="grid md:grid-cols-3 gap-2">
                <input className="input" placeholder="E-mail master" value={master.email} onChange={e => setMaster(m => ({ ...m, email: e.target.value }))} />
                <input className="input" placeholder="Senha (mín. 6)" type="password" value={master.senha} onChange={e => setMaster(m => ({ ...m, senha: e.target.value }))} />
                <input className="input" placeholder="Nome" value={master.nome} onChange={e => setMaster(m => ({ ...m, nome: e.target.value }))} />
              </div>
              <button className="btn-brass mt-3" disabled={busy === 'master' || !master.email || master.senha.length < 6}
                onClick={() => run('master', () => adminUsuarioMaster(sel.id, master.email, master.senha, master.nome), 'Usuário master salvo.')}>
                Criar / redefinir master
              </button>
            </div>

            <div className="card p-5">
              <h2 className="font-semibold text-navy mb-2">Faturamento</h2>
              <div className="flex flex-wrap items-end gap-2">
                <div><label className="label">Competência</label>
                  <input type="month" className="input w-auto" value={comp} onChange={e => setComp(e.target.value)} /></div>
                <button className="btn-ghost" disabled={busy === 'ext'} onClick={() => run('ext', async () => { const r = await adminExtrato(sel.id, comp); setExtrato(r.atos) })}>Ver extrato</button>
                <button className="btn-primary" disabled={busy === 'fat'} onClick={() => run('fat', () => adminGerarFatura(sel.id, comp), 'Fatura gerada/atualizada.')}>Gerar fatura</button>
                {sel.ultima_fatura && sel.ultima_fatura.status !== 'paga' && (
                  <button className="btn-ghost" disabled={busy === 'paga'} onClick={() => run('paga', () => adminMarcarPaga(sel.ultima_fatura!.id), 'Fatura marcada como paga.')}>Marcar últ. fatura paga</button>
                )}
              </div>
              {sel.ultima_fatura && (
                <div className="text-sm mt-3 bg-paper rounded-lg p-3">
                  <b>Última fatura ({sel.ultima_fatura.competencia}):</b> {sel.ultima_fatura.qtd_atos} atos ·
                  fixo {brl(sel.ultima_fatura.valor_fixo)} + variável {brl(sel.ultima_fatura.valor_variavel)} =
                  <b> {brl(sel.ultima_fatura.valor_total)}</b> · {sel.ultima_fatura.status}
                </div>
              )}
              {extrato && (
                <div className="mt-3">
                  <div className="text-xs font-semibold text-ink/70 mb-1">Extrato {comp} · {extrato.length} atos efetivados</div>
                  <div className="max-h-56 overflow-auto border border-black/5 rounded-lg">
                    {extrato.length === 0 && <div className="p-3 text-xs text-ink/50">Nenhum ato efetivado na competência.</div>}
                    {extrato.map((a, i) => (
                      <div key={i} className="flex justify-between px-3 py-1.5 text-xs border-b border-black/5">
                        <span className="font-mono">{a.protocolo}</span>
                        <span className="flex-1 px-2 truncate">{a.tipo ?? a.titulo}</span>
                        <span className="text-ink/50">{dataCurta(new Date(a.concluida_em))}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {erro && <div className="text-sm text-red-600">{erro}</div>}
            {msg && <div className="text-sm text-emerald-700">{msg}</div>}
          </div>
        ) : (
          <div className="card p-8 text-ink/50 text-sm self-start">Selecione um cartório para gerenciar o plano, o login master e as faturas.</div>
        )}
      </div>
    </Layout>
  )
}

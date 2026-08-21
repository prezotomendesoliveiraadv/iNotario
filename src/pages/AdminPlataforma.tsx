import { useEffect, useState } from 'react'
import { dataCurta, dataHora } from '../lib/tempo'
import { Layout } from '../components/ui'
import {
  adminListar, adminSalvarPlano, adminUsuarioMaster, adminGerarFatura, adminExtrato, adminMarcarPaga,
  adminSalvarPreco, listarPrecos, adminCustoIA, ITEM_ROTULO,
  brl, competenciaAtual, type CartorioAdmin, type Plano, type Preco, type CustoIA,
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
              <p className="text-[11px] text-ink/50 mt-2">
                O valor por ato acima é herança do modelo antigo e não é mais usado no cálculo.
                A cobrança variável sai da tabela de preços abaixo.
              </p>
            </div>

            <TabelaPrecos cartorioId={sel.id} onSalvo={carregar} />
            <CustoTokens cartorioId={sel.id} />

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


// ============================================================================
// Tabela de preços por evento
//
// Uma linha por item cobrável. Deixar em branco significa herdar o preço padrão
// da plataforma; preencher cria a exceção só para este cartório — que é como
// contrato negociado caso a caso costuma funcionar.
// ============================================================================

function TabelaPrecos({ cartorioId, onSalvo }: { cartorioId: string; onSalvo: () => void }) {
  const [precos, setPrecos] = useState<Preco[]>([])
  const [rascunho, setRascunho] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  async function carregar() {
    try { setPrecos(await listarPrecos(cartorioId)); setMsg(null) }
    catch (e: any) {
      // Engolir este erro foi o que fez a tabela parecer "zerada e sem edição":
      // a tela mostrava zeros porque a carga tinha falhado, não porque os
      // preços fossem zero.
      setMsg(`Não foi possível carregar os preços: ${e.message ?? e}. A 17ª migration já foi executada?`)
    }
  }
  useEffect(() => { carregar() }, [cartorioId])

  const padrao = (item: string) => precos.find(p => p.cartorio_id === null && p.item === item)
  const doCartorio = (item: string) => precos.find(p => p.cartorio_id === cartorioId && p.item === item)

  async function salvar(item: string, escopo: 'padrao' | 'cartorio') {
    const chave = `${escopo}:${item}`
    const bruto = rascunho[chave]
    if (bruto === undefined) return
    // Campo esvaziado na coluna do cartório significa "voltar a herdar".
    if (bruto.trim() === '') { if (escopo === 'cartorio') return remover(item); return }
    setBusy(chave); setMsg(null)
    try {
      await adminSalvarPreco(item, Number(String(bruto).replace(',', '.')), escopo === 'cartorio' ? cartorioId : null)
      setRascunho(r => { const n = { ...r }; delete n[chave]; return n })
      await carregar(); onSalvo()
      setMsg('Preço atualizado.')
    } catch (e: any) { setMsg(e.message ?? 'Falha ao salvar.') }
    finally { setBusy(null) }
  }

  async function remover(item: string) {
    const chave = `cartorio:${item}`
    setBusy(chave); setMsg(null)
    try {
      await adminSalvarPreco(item, null, cartorioId)
      setRascunho(r => { const n = { ...r }; delete n[chave]; return n })
      await carregar(); onSalvo(); setMsg('Exceção removida — volta a herdar o padrão.')
    } catch (e: any) { setMsg(e.message ?? 'Falha ao remover.') }
    finally { setBusy(null) }
  }

  return (
    <div className="card p-5">
      <h2 className="font-semibold text-navy mb-1">Tabela de preços por evento</h2>
      <p className="text-[11px] text-ink/50 mb-3">
        A coluna “padrão” vale para todos os cartórios. A coluna “deste cartório”, quando preenchida,
        sobrepõe o padrão apenas aqui.
      </p>

      <div className="border border-black/5 rounded-lg overflow-hidden">
        <div className="flex text-[11px] uppercase tracking-wider text-ink/50 bg-paper px-3 py-1.5">
          <span className="flex-1">Item</span>
          <span className="w-32 text-right">Padrão</span>
          <span className="w-40 text-right">Deste cartório</span>
        </div>
        {Object.entries(ITEM_ROTULO).map(([item, rotulo]) => {
          const vp = padrao(item), vc = doCartorio(item)
          const kp = `padrao:${item}`, kc = `cartorio:${item}`
          const valP = rascunho[kp] ?? (vp ? String(vp.valor_unitario) : '0')
          const valC = rascunho[kc] ?? (vc ? String(vc.valor_unitario) : '')
          const sujoP = rascunho[kp] !== undefined && rascunho[kp] !== String(vp?.valor_unitario ?? '')
          const sujoC = rascunho[kc] !== undefined && rascunho[kc] !== String(vc?.valor_unitario ?? '')
          return (
            <div key={item} className="flex items-center gap-2 px-3 py-1.5 border-t border-black/5">
              <span className="flex-1 text-xs">{rotulo}</span>

              <div className="w-36 flex gap-1 justify-end items-center">
                <input className="input text-right" style={{ width: 76, padding: '.2rem .4rem', fontSize: '.75rem' }}
                  value={valP} inputMode="decimal"
                  onChange={e => setRascunho(r => ({ ...r, [kp]: e.target.value }))} />
                <button className="btn-primary" style={{ padding: '.15rem .45rem', fontSize: '.7rem', visibility: sujoP ? 'visible' : 'hidden' }}
                  onClick={() => salvar(item, 'padrao')} disabled={busy === kp}>salvar</button>
              </div>

              <div className="w-44 flex gap-1 justify-end items-center">
                <input className="input text-right" style={{ width: 76, padding: '.2rem .4rem', fontSize: '.75rem' }}
                  placeholder="herda" value={valC} inputMode="decimal"
                  onChange={e => setRascunho(r => ({ ...r, [kc]: e.target.value }))} />
                <button className="btn-primary" style={{ padding: '.15rem .45rem', fontSize: '.7rem', visibility: sujoC ? 'visible' : 'hidden' }}
                  onClick={() => salvar(item, 'cartorio')} disabled={busy === kc}>salvar</button>
                {vc && !sujoC && (
                  <button className="btn-ghost" style={{ padding: '.15rem .45rem', fontSize: '.7rem' }}
                    title="Remover a exceção e voltar a herdar o padrão"
                    onClick={() => remover(item)} disabled={busy === kc}>↺</button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {msg && <div className="text-xs text-ink/60 mt-2">{msg}</div>}
    </div>
  )
}


// ============================================================================
// Custo de IA por cartório — visível apenas para a plataforma
//
// É o custo do FORNECEDOR (tokens consumidos), não a cobrança do cartório. Só
// aparece aqui, e a tabela `uso_tokens` tem RLS restrita a admin_plataforma.
// Margem = o que o cartório paga (demonstrativo) menos isto.
// ============================================================================

function CustoTokens({ cartorioId }: { cartorioId: string }) {
  const [comp, setComp] = useState(competenciaAtual())
  const [custo, setCusto] = useState<CustoIA | null>(null)
  const [busy, setBusy] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function carregar() {
    setBusy(true); setErro(null)
    try { setCusto((await adminCustoIA(cartorioId, comp)).custo) }
    catch (e: any) { setErro(e.message ?? 'Falha ao apurar.') }
    finally { setBusy(false) }
  }
  useEffect(() => { setCusto(null) }, [cartorioId, comp])

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="font-semibold text-navy">Custo de IA (tokens) — interno</h2>
        <div className="flex gap-2">
          <input className="input" style={{ width: 110 }} value={comp} onChange={e => setComp(e.target.value)} placeholder="AAAA-MM" />
          <button className="btn-ghost" onClick={carregar} disabled={busy}>{busy ? 'Apurando…' : 'Apurar'}</button>
        </div>
      </div>
      <p className="text-[11px] text-ink/50 mt-1">
        Consumo medido nas chamadas ao provedor, a preço de lista. Não considera desconto de lote nem
        economia de cache — é teto, não fatura.
      </p>

      {erro && <div className="text-sm text-red-600 mt-2">{erro}</div>}

      {custo && (
        <div className="mt-3">
          <div className="flex gap-4 text-xs text-ink/60 mb-2">
            <span>entrada: <b className="font-mono">{custo.tokens_entrada.toLocaleString('pt-BR')}</b></span>
            <span>saída: <b className="font-mono">{custo.tokens_saida.toLocaleString('pt-BR')}</b></span>
            <span>custo estimado: <b className="text-brass">{brl(custo.custo_brl)}</b></span>
          </div>
          <div className="border border-black/5 rounded-lg overflow-hidden">
            {custo.linhas.map((l, i) => (
              <div key={i} className="flex text-xs px-3 py-1.5 border-t border-black/5 first:border-t-0">
                <span className="flex-1">{l.funcao}</span>
                <span className="w-24 text-right font-mono text-ink/50">{l.ent.toLocaleString('pt-BR')}</span>
                <span className="w-24 text-right font-mono text-ink/50">{l.sai.toLocaleString('pt-BR')}</span>
                <span className="w-24 text-right font-mono">{brl(l.brl)}</span>
              </div>
            ))}
            {!custo.linhas.length && <div className="text-xs text-ink/50 px-3 py-2">Sem consumo medido nesta competência.</div>}
          </div>
        </div>
      )}
    </div>
  )
}

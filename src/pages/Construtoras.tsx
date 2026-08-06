import { useEffect, useState } from 'react'
import { Layout } from '../components/ui'
import { supabase } from '../lib/supabase'
import { dataCurta } from '../lib/tempo'
import {
  usuariosDaConstrutora, criarAcessoConstrutora, redefinirSenhaAcesso, desvincularUsuario,
  type UsuarioConstrutora,
} from '../lib/construtoraPortal'
import {
  listarConstrutoras, salvarConstrutora, listarRepresentantes, salvarRepresentante, removerRepresentante,
  listarCertidoes, salvarCertidao, removerCertidao, listarEmpreendimentos, salvarEmpreendimento,
  JANELA_ALERTA_DIAS,
  type Construtora, type Representante, type Certidao, type Empreendimento,
} from '../lib/incorporacao'

const vazioRep = (): Partial<Representante> => ({
  nome: '', cpf: '', rg: '', nacionalidade: 'brasileiro(a)', estado_civil: '', profissao: '',
  endereco: '', cargo: '', procuracao_validade: '', procuracao_poderes: '', ativo: true,
})
const vazioCert = (): Partial<Certidao> => ({ tipo: '', numero: '', emitida_em: '', validade: '' })
const vazioEmpr = (): Partial<Empreendimento> => ({ nome: '', cidade: '', uf: '', total_unidades: undefined })

/** Situação de vigência de uma data (mesma régua do card de vencimentos). */
function situacao(validade?: string | null) {
  if (!validade) return null
  const dias = Math.floor((new Date(validade + 'T12:00:00').getTime() - Date.now()) / 86400000)
  if (dias < 0) return { txt: `vencida há ${Math.abs(dias)}d`, cor: '#B3261E' }
  if (dias <= JANELA_ALERTA_DIAS) return { txt: `vence em ${dias}d`, cor: '#A9761B' }
  return { txt: 'vigente', cor: '#1E7A4F' }
}

export default function Construtoras() {
  const [lista, setLista] = useState<Construtora[]>([])
  const [sel, setSel] = useState<Construtora | null>(null)
  const [reps, setReps] = useState<Representante[]>([])
  const [certs, setCerts] = useState<Certidao[]>([])
  const [emprs, setEmprs] = useState<Empreendimento[]>([])
  const [novoRep, setNovoRep] = useState<Partial<Representante> | null>(null)
  const [novaCert, setNovaCert] = useState<Partial<Certidao> | null>(null)
  const [novoEmpr, setNovoEmpr] = useState<Partial<Empreendimento> | null>(null)
  const [acessos, setAcessos] = useState<UsuarioConstrutora[]>([])
  const [novoAcesso, setNovoAcesso] = useState<{ nome: string; email: string; papel: 'juridico' | 'gestor' } | null>(null)
  const [credencial, setCredencial] = useState<{ email: string; senha: string | null; aviso?: string | null } | null>(null)
  const [criando, setCriando] = useState(false)
  const [form, setForm] = useState<Partial<Construtora>>({ razao_social: '', cnpj: '' })
  const [busy, setBusy] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function carregar() {
    try { setLista(await listarConstrutoras()) } catch (e: any) { setErro(e.message) }
  }
  useEffect(() => { carregar() }, [])

  async function abrir(c: Construtora) {
    setSel(c); setForm(c); setCriando(false); setErro(null)
    const [r, ce, em, ac] = await Promise.all([
      listarRepresentantes(c.id), listarCertidoes(c.id), listarEmpreendimentos(c.id),
      usuariosDaConstrutora(c.id).catch(() => []),
    ])
    setReps(r); setCerts(ce); setEmprs(em); setAcessos(ac); setCredencial(null)
  }

  async function salvar() {
    if (!form.razao_social?.trim()) { setErro('Informe a razão social.'); return }
    setBusy(true); setErro(null)
    try {
      const c = await salvarConstrutora(form)
      await carregar(); await abrir(c)
    } catch (e: any) { setErro(e.message) } finally { setBusy(false) }
  }

  async function subirArquivo(file: File, prefixo: string): Promise<{ path: string; nome: string } | null> {
    const path = `${sel?.id ?? 'novo'}/${prefixo}-${Date.now()}-${file.name}`
    const { error } = await supabase.storage.from('construtoras').upload(path, file, { upsert: true })
    if (error) { setErro(error.message); return null }
    return { path, nome: file.name }
  }

  // ---------------------------------------------------------------- lista
  if (!sel && !criando) {
    return (
      <Layout>
        <div className="flex items-end justify-between gap-3 flex-wrap mb-4">
          <div>
            <div className="text-[11px] font-semibold tracking-[.14em] text-brass uppercase">Cadastro</div>
            <h1 className="font-serif text-2xl font-bold text-navy leading-tight">Construtoras e empreendimentos</h1>
            <p className="text-sm text-ink/60">
              O que estiver aqui não precisa ser perguntado ao cliente nem redigitado na minuta.
            </p>
          </div>
          <button className="btn-brass" onClick={() => { setCriando(true); setForm({ razao_social: '', cnpj: '' }); setSel(null) }}>
            + Nova construtora
          </button>
        </div>

        {erro && <div className="text-sm text-red-600 mb-3">{erro}</div>}

        {lista.length === 0 ? (
          <div className="rounded-xl border border-dashed border-black/20 p-8 text-center">
            <div className="font-serif text-lg text-navy">Nenhuma construtora cadastrada</div>
            <p className="text-[13px] text-ink/55 mt-1">
              Cadastre a construtora, seus empreendimentos e o modelo padrão de escritura.
              A partir daí, vendas desses empreendimentos são qualificadas automaticamente.
            </p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {lista.map(c => (
              <button key={c.id} onClick={() => abrir(c)}
                className="w-full text-left flex items-center gap-3 rounded-lg border border-black/10 bg-white px-4 py-3 hover:border-brass transition">
                <span className="flex-1 min-w-0">
                  <span className="block font-medium text-navy truncate">{c.razao_social}</span>
                  <span className="block text-[11px] text-ink/50">
                    {c.cnpj || 'sem CNPJ'}{c.nome_fantasia ? ` · ${c.nome_fantasia}` : ''}
                  </span>
                </span>
                {c.modelo_escritura && <span className="badge bg-brass/15 text-brass shrink-0">modelo</span>}
                <span className="text-ink/30">›</span>
              </button>
            ))}
          </div>
        )}
      </Layout>
    )
  }

  // ---------------------------------------------------------------- detalhe
  return (
    <Layout>
      <button className="text-[12px] text-navy hover:underline mb-3"
        onClick={() => { setSel(null); setCriando(false); carregar() }}>← todas as construtoras</button>

      <h1 className="font-serif text-2xl font-bold text-navy leading-tight mb-3">
        {criando ? 'Nova construtora' : sel?.razao_social}
      </h1>
      {erro && <div className="text-sm text-red-600 mb-3">{erro}</div>}

      {/* dados da empresa */}
      <div className="card p-5 mb-4">
        <h2 className="font-semibold text-navy mb-3">Dados da empresa</h2>
        <div className="grid md:grid-cols-2 gap-3">
          <div><label className="label">Razão social *</label>
            <input className="input" value={form.razao_social ?? ''} onChange={e => setForm(f => ({ ...f, razao_social: e.target.value }))} /></div>
          <div><label className="label">Nome fantasia</label>
            <input className="input" value={form.nome_fantasia ?? ''} onChange={e => setForm(f => ({ ...f, nome_fantasia: e.target.value }))} /></div>
          <div><label className="label">CNPJ</label>
            <input className="input" value={form.cnpj ?? ''} onChange={e => setForm(f => ({ ...f, cnpj: e.target.value }))} /></div>
          <div><label className="label">Endereço</label>
            <input className="input" value={form.endereco ?? ''} onChange={e => setForm(f => ({ ...f, endereco: e.target.value }))} /></div>
        </div>

        <div className="mt-3">
          <label className="label">Contrato social</label>
          {sel && (
            <div className="flex items-center gap-2 flex-wrap">
              {form.contrato_social_nome && <span className="badge bg-paper">{form.contrato_social_nome}</span>}
              <input type="file" accept="application/pdf,image/*" onChange={async e => {
                const f = e.target.files?.[0]; if (!f) return
                const up = await subirArquivo(f, 'contrato-social')
                if (up) setForm(x => ({ ...x, contrato_social_path: up.path, contrato_social_nome: up.nome }))
              }} />
            </div>
          )}
          {!sel && <p className="text-[11px] text-ink/50">Salve a construtora para anexar arquivos.</p>}
        </div>

        <div className="mt-3">
          <label className="label">Modelo padrão de escritura</label>
          <textarea className="input" style={{ minHeight: 120, fontSize: '.82rem' }}
            placeholder="Cole aqui a redação padrão da construtora. Ela será a base da minuta nas vendas dos empreendimentos desta empresa."
            value={form.modelo_escritura ?? ''} onChange={e => setForm(f => ({ ...f, modelo_escritura: e.target.value }))} />
          <p className="text-[11px] text-ink/45 mt-1">
            Um empreendimento pode ter modelo próprio, que tem precedência sobre este.
          </p>
        </div>

        <button className="btn-primary mt-3" disabled={busy} onClick={salvar}>
          {busy ? 'Salvando…' : criando ? 'Criar construtora' : 'Salvar alterações'}
        </button>
      </div>

      {!sel ? null : (
        <>
          {/* representantes */}
          <div className="card p-5 mb-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-navy">Representantes legais</h2>
              <button className="btn-ghost text-[12px] py-1" onClick={() => setNovoRep(vazioRep())}>+ adicionar</button>
            </div>
            <p className="text-xs text-ink/55 mb-2">Qualificação completa e procuração outorgada, com validade.</p>

            {reps.map(r => {
              const st = situacao(r.procuracao_validade)
              return (
                <div key={r.id} className="rounded-lg bg-paper px-3 py-2 mb-1.5 flex items-start gap-2">
                  <span className="flex-1 min-w-0">
                    <span className="block text-[13px] font-medium text-navy">
                      {r.nome} {r.cargo && <span className="text-ink/50 font-normal">· {r.cargo}</span>}
                    </span>
                    <span className="block text-[11px] text-ink/55">
                      {[r.cpf && `CPF ${r.cpf}`, r.estado_civil, r.profissao].filter(Boolean).join(' · ')}
                    </span>
                    {r.procuracao_validade && (
                      <span className="block text-[11px]" style={{ color: st?.cor }}>
                        Procuração até {dataCurta(new Date(r.procuracao_validade + 'T12:00:00'))} · {st?.txt}
                      </span>
                    )}
                  </span>
                  <button className="text-ink/35 hover:text-red-600 text-lg leading-none px-1"
                    onClick={async () => { await removerRepresentante(r.id!); setReps(await listarRepresentantes(sel.id)) }}>×</button>
                </div>
              )
            })}
            {reps.length === 0 && !novoRep && <p className="text-[12px] text-ink/50">Nenhum representante cadastrado.</p>}

            {novoRep && (
              <div className="rounded-lg border border-black/10 p-3 mt-2">
                <div className="grid md:grid-cols-3 gap-2">
                  {([['nome', 'Nome completo'], ['cpf', 'CPF'], ['rg', 'RG'], ['cargo', 'Cargo'],
                     ['nacionalidade', 'Nacionalidade'], ['estado_civil', 'Estado civil'], ['regime_bens', 'Regime de bens'],
                     ['profissao', 'Profissão'], ['endereco', 'Endereço'], ['email', 'E-mail'], ['telefone', 'Telefone']] as const)
                    .map(([k, label]) => (
                      <div key={k}><label className="label">{label}</label>
                        <input className="input" value={(novoRep as any)[k] ?? ''}
                          onChange={e => setNovoRep(r => ({ ...r!, [k]: e.target.value }))} /></div>
                    ))}
                  <div><label className="label">Procuração — lavrada em</label>
                    <input className="input" type="date" value={novoRep.procuracao_lavrada_em ?? ''}
                      onChange={e => setNovoRep(r => ({ ...r!, procuracao_lavrada_em: e.target.value }))} /></div>
                  <div><label className="label">Procuração — validade</label>
                    <input className="input" type="date" value={novoRep.procuracao_validade ?? ''}
                      onChange={e => setNovoRep(r => ({ ...r!, procuracao_validade: e.target.value }))} /></div>
                </div>
                <div className="mt-2">
                  <label className="label">Poderes outorgados</label>
                  <textarea className="input" style={{ minHeight: 60 }} value={novoRep.procuracao_poderes ?? ''}
                    onChange={e => setNovoRep(r => ({ ...r!, procuracao_poderes: e.target.value }))} />
                </div>
                <div className="mt-2">
                  <label className="label">Arquivo da procuração</label>
                  <input type="file" accept="application/pdf,image/*" onChange={async e => {
                    const f = e.target.files?.[0]; if (!f) return
                    const up = await subirArquivo(f, 'procuracao')
                    if (up) setNovoRep(r => ({ ...r!, procuracao_path: up.path, procuracao_nome: up.nome }))
                  }} />
                </div>
                <div className="flex gap-2 mt-2">
                  <button className="btn-brass" disabled={busy} onClick={async () => {
                    if (!novoRep.nome?.trim()) { setErro('Informe o nome do representante.'); return }
                    setBusy(true)
                    try {
                      await salvarRepresentante({ ...novoRep, construtora_id: sel.id })
                      setNovoRep(null); setReps(await listarRepresentantes(sel.id))
                    } catch (e: any) { setErro(e.message) } finally { setBusy(false) }
                  }}>Salvar representante</button>
                  <button className="btn-ghost" onClick={() => setNovoRep(null)}>cancelar</button>
                </div>
              </div>
            )}
          </div>

          {/* certidões */}
          <div className="card p-5 mb-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-navy">Certidões</h2>
              <button className="btn-ghost text-[12px] py-1" onClick={() => setNovaCert(vazioCert())}>+ adicionar</button>
            </div>
            <p className="text-xs text-ink/55 mb-2">
              O vencimento entra nos alertas dos atos deste empreendimento ({JANELA_ALERTA_DIAS} dias antes).
            </p>
            {certs.map(c => {
              const st = situacao(c.validade)
              return (
                <div key={c.id} className="rounded-lg bg-paper px-3 py-2 mb-1.5 flex items-center gap-2">
                  <span className="flex-1 min-w-0">
                    <span className="block text-[13px] text-navy">{c.tipo}{c.numero ? ` nº ${c.numero}` : ''}</span>
                    {c.validade && (
                      <span className="block text-[11px]" style={{ color: st?.cor }}>
                        até {dataCurta(new Date(c.validade + 'T12:00:00'))} · {st?.txt}
                      </span>
                    )}
                  </span>
                  <button className="text-ink/35 hover:text-red-600 text-lg leading-none px-1"
                    onClick={async () => { await removerCertidao(c.id!); setCerts(await listarCertidoes(sel.id)) }}>×</button>
                </div>
              )
            })}
            {certs.length === 0 && !novaCert && <p className="text-[12px] text-ink/50">Nenhuma certidão cadastrada.</p>}

            {novaCert && (
              <div className="rounded-lg border border-black/10 p-3 mt-2">
                <div className="grid md:grid-cols-4 gap-2">
                  <div><label className="label">Tipo *</label>
                    <input className="input" placeholder="ex.: Negativa federal" value={novaCert.tipo ?? ''}
                      onChange={e => setNovaCert(c => ({ ...c!, tipo: e.target.value }))} /></div>
                  <div><label className="label">Número</label>
                    <input className="input" value={novaCert.numero ?? ''}
                      onChange={e => setNovaCert(c => ({ ...c!, numero: e.target.value }))} /></div>
                  <div><label className="label">Emitida em</label>
                    <input className="input" type="date" value={novaCert.emitida_em ?? ''}
                      onChange={e => setNovaCert(c => ({ ...c!, emitida_em: e.target.value }))} /></div>
                  <div><label className="label">Validade</label>
                    <input className="input" type="date" value={novaCert.validade ?? ''}
                      onChange={e => setNovaCert(c => ({ ...c!, validade: e.target.value }))} /></div>
                </div>
                <div className="mt-2">
                  <input type="file" accept="application/pdf,image/*" onChange={async e => {
                    const f = e.target.files?.[0]; if (!f) return
                    const up = await subirArquivo(f, 'certidao')
                    if (up) setNovaCert(c => ({ ...c!, storage_path: up.path, nome_arquivo: up.nome }))
                  }} />
                </div>
                <div className="flex gap-2 mt-2">
                  <button className="btn-brass" disabled={busy} onClick={async () => {
                    if (!novaCert.tipo?.trim()) { setErro('Informe o tipo da certidão.'); return }
                    setBusy(true)
                    try {
                      await salvarCertidao({ ...novaCert, construtora_id: sel.id })
                      setNovaCert(null); setCerts(await listarCertidoes(sel.id))
                    } catch (e: any) { setErro(e.message) } finally { setBusy(false) }
                  }}>Salvar certidão</button>
                  <button className="btn-ghost" onClick={() => setNovaCert(null)}>cancelar</button>
                </div>
              </div>
            )}
          </div>

          {/* empreendimentos */}
          <div className="card p-5 mb-6">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-navy">Empreendimentos</h2>
              <button className="btn-ghost text-[12px] py-1" onClick={() => setNovoEmpr(vazioEmpr())}>+ adicionar</button>
            </div>
            <p className="text-xs text-ink/55 mb-2">
              O nome cadastrado é o que a Artemis reconhece quando o cliente cita o empreendimento no atendimento.
            </p>
            {emprs.map(e => (
              <div key={e.id} className="rounded-lg bg-paper px-3 py-2 mb-1.5">
                <span className="block text-[13px] font-medium text-navy">{e.nome}</span>
                <span className="block text-[11px] text-ink/55">
                  {[e.cidade && `${e.cidade}${e.uf ? '/' + e.uf : ''}`,
                    e.total_unidades ? `${e.total_unidades} unidades` : null,
                    e.matricula_mae ? `matrícula mãe ${e.matricula_mae}` : null,
                    e.modelo_escritura ? 'modelo próprio' : null].filter(Boolean).join(' · ')}
                </span>
              </div>
            ))}
            {emprs.length === 0 && !novoEmpr && <p className="text-[12px] text-ink/50">Nenhum empreendimento cadastrado.</p>}

            {novoEmpr && (
              <div className="rounded-lg border border-black/10 p-3 mt-2">
                <div className="grid md:grid-cols-3 gap-2">
                  <div className="md:col-span-2"><label className="label">Nome do empreendimento *</label>
                    <input className="input" placeholder="ex.: Residencial Aurora" value={novoEmpr.nome ?? ''}
                      onChange={e => setNovoEmpr(x => ({ ...x!, nome: e.target.value }))} /></div>
                  <div><label className="label">Nº de unidades</label>
                    <input className="input" type="number" value={novoEmpr.total_unidades ?? ''}
                      onChange={e => setNovoEmpr(x => ({ ...x!, total_unidades: Number(e.target.value) || undefined }))} /></div>
                  <div><label className="label">Cidade</label>
                    <input className="input" value={novoEmpr.cidade ?? ''}
                      onChange={e => setNovoEmpr(x => ({ ...x!, cidade: e.target.value }))} /></div>
                  <div><label className="label">UF</label>
                    <input className="input" maxLength={2} value={novoEmpr.uf ?? ''}
                      onChange={e => setNovoEmpr(x => ({ ...x!, uf: e.target.value.toUpperCase() }))} /></div>
                  <div><label className="label">Matrícula mãe</label>
                    <input className="input" value={novoEmpr.matricula_mae ?? ''}
                      onChange={e => setNovoEmpr(x => ({ ...x!, matricula_mae: e.target.value }))} /></div>
                  <div className="md:col-span-2"><label className="label">Cartório de RI</label>
                    <input className="input" value={novoEmpr.cartorio_ri ?? ''}
                      onChange={e => setNovoEmpr(x => ({ ...x!, cartorio_ri: e.target.value }))} /></div>
                  <div><label className="label">Registro da incorporação</label>
                    <input className="input" value={novoEmpr.registro_incorporacao ?? ''}
                      onChange={e => setNovoEmpr(x => ({ ...x!, registro_incorporacao: e.target.value }))} /></div>
                </div>
                <div className="mt-2">
                  <label className="label">Modelo de escritura próprio (opcional)</label>
                  <textarea className="input" style={{ minHeight: 90, fontSize: '.82rem' }}
                    placeholder="Se preenchido, tem precedência sobre o modelo da construtora."
                    value={novoEmpr.modelo_escritura ?? ''}
                    onChange={e => setNovoEmpr(x => ({ ...x!, modelo_escritura: e.target.value }))} />
                </div>
                <div className="flex gap-2 mt-2">
                  <button className="btn-brass" disabled={busy} onClick={async () => {
                    if (!novoEmpr.nome?.trim()) { setErro('Informe o nome do empreendimento.'); return }
                    setBusy(true)
                    try {
                      await salvarEmpreendimento({ ...novoEmpr, construtora_id: sel.id })
                      setNovoEmpr(null); setEmprs(await listarEmpreendimentos(sel.id))
                    } catch (e: any) { setErro(e.message) } finally { setBusy(false) }
                  }}>Salvar empreendimento</button>
                  <button className="btn-ghost" onClick={() => setNovoEmpr(null)}>cancelar</button>
                </div>
              </div>
            )}
          </div>
          {/* acessos ao portal */}
          <div className="card p-5 mb-6">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-navy">Acessos ao portal da construtora</h2>
              <button className="btn-ghost text-[12px] py-1"
                onClick={() => { setNovoAcesso({ nome: '', email: '', papel: 'juridico' }); setCredencial(null) }}>
                + liberar acesso
              </button>
            </div>
            <p className="text-xs text-ink/55 mb-2">
              O <b>jurídico</b> aprova ou devolve as minutas; o <b>gestor</b> apenas acompanha.
              Estes usuários não enxergam nada do cartório — só os atos dos empreendimentos desta construtora.
            </p>

            {acessos.filter(a => a.ativo).map(a => (
              <div key={a.id} className="rounded-lg bg-paper px-3 py-2 mb-1.5 flex items-center gap-2 flex-wrap">
                <span className="flex-1 min-w-0">
                  <span className="block text-[13px] font-medium text-navy">
                    {a.nome} <span className="text-ink/50 font-normal">· {a.papel_construtora === 'juridico' ? 'Jurídico' : 'Gestor'}</span>
                  </span>
                  <span className="block text-[11px] text-ink/55">{a.email}</span>
                </span>
                <button className="text-[11px] text-navy underline" disabled={busy}
                  onClick={async () => {
                    setBusy(true); setErro(null)
                    try {
                      const r = await redefinirSenhaAcesso(sel.id, a.user_id)
                      setCredencial({ email: a.email ?? '', senha: r.senha })
                    } catch (e: any) { setErro(e.message) } finally { setBusy(false) }
                  }}>nova senha</button>
                <button className="text-ink/35 hover:text-red-600 text-lg leading-none px-1" disabled={busy}
                  onClick={async () => {
                    if (!confirm(`Remover o acesso de ${a.nome}?`)) return
                    setBusy(true)
                    try { await desvincularUsuario(sel.id, a.id); setAcessos(await usuariosDaConstrutora(sel.id)) }
                    catch (e: any) { setErro(e.message) } finally { setBusy(false) }
                  }}>×</button>
              </div>
            ))}
            {acessos.filter(a => a.ativo).length === 0 && !novoAcesso && (
              <p className="text-[12px] text-ink/50">Nenhum acesso liberado.</p>
            )}

            {credencial && (
              <div className="rounded-lg p-3 mt-2" style={{ background: '#FFF8E8', border: '1px solid #E3C57E' }}>
                <div className="text-[13px] font-semibold" style={{ color: '#A9761B' }}>
                  Credenciais — anote agora, não serão exibidas de novo
                </div>
                <div className="text-[13px] mt-1">
                  <div>E-mail: <b>{credencial.email}</b></div>
                  {credencial.senha
                    ? <div>Senha: <b className="font-mono">{credencial.senha}</b></div>
                    : <div className="text-ink/60">{credencial.aviso}</div>}
                </div>
                <button className="text-[11px] text-navy underline mt-1" onClick={() => setCredencial(null)}>ocultar</button>
              </div>
            )}

            {novoAcesso && (
              <div className="rounded-lg border border-black/10 p-3 mt-2">
                <div className="grid md:grid-cols-3 gap-2">
                  <div><label className="label">Nome *</label>
                    <input className="input" value={novoAcesso.nome}
                      onChange={e => setNovoAcesso(a => ({ ...a!, nome: e.target.value }))} /></div>
                  <div><label className="label">E-mail *</label>
                    <input className="input" type="email" value={novoAcesso.email}
                      onChange={e => setNovoAcesso(a => ({ ...a!, email: e.target.value }))} /></div>
                  <div><label className="label">Perfil</label>
                    <select className="input" value={novoAcesso.papel}
                      onChange={e => setNovoAcesso(a => ({ ...a!, papel: e.target.value as any }))}>
                      <option value="juridico">Jurídico (decide)</option>
                      <option value="gestor">Gestor (acompanha)</option>
                    </select></div>
                </div>
                <div className="flex gap-2 mt-2">
                  <button className="btn-brass" disabled={busy} onClick={async () => {
                    if (!novoAcesso.nome.trim() || !novoAcesso.email.trim()) { setErro('Informe nome e e-mail.'); return }
                    setBusy(true); setErro(null)
                    try {
                      const r = await criarAcessoConstrutora(sel.id, novoAcesso.nome.trim(), novoAcesso.email.trim(), novoAcesso.papel)
                      setCredencial(r); setNovoAcesso(null)
                      setAcessos(await usuariosDaConstrutora(sel.id))
                    } catch (e: any) { setErro(e.message) } finally { setBusy(false) }
                  }}>Criar acesso</button>
                  <button className="btn-ghost" onClick={() => setNovoAcesso(null)}>cancelar</button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </Layout>
  )
}

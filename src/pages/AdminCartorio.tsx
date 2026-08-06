import { useEffect, useState } from 'react'
import { Layout } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { dataCurta } from '../lib/tempo'
import {
  listarGrupos, listarUsuarios, criarUsuario, atualizarUsuario, novaSenhaUsuario,
  diagnosticarWhatsapp, NIVEIS, PAPEIS_CARTORIO,
  type Grupo, type UsuarioCartorio, type DiagnosticoWpp,
} from '../lib/administracao'

const nomePapel = (v: string) => PAPEIS_CARTORIO.find(p => p.v === v)?.nome ?? v
const nomeNivel = (v: number) => NIVEIS.find(n => n.v === v)?.nome ?? String(v)

function situacaoAcesso(u: UsuarioCartorio) {
  if (!u.ativo) return { txt: 'desativado', cor: '#B3261E' }
  if (!u.acesso_ate) return { txt: 'sem prazo', cor: '#1E7A4F' }
  const dias = Math.floor((new Date(u.acesso_ate + 'T12:00:00').getTime() - Date.now()) / 86400000)
  if (dias < 0) return { txt: `vencido há ${Math.abs(dias)}d`, cor: '#B3261E' }
  if (dias <= 15) return { txt: `vence em ${dias}d`, cor: '#A9761B' }
  return { txt: `até ${dataCurta(new Date(u.acesso_ate + 'T12:00:00'))}`, cor: '#1E7A4F' }
}

export default function AdminCartorio() {
  const { profile } = useAuth() as any
  const [grupos, setGrupos] = useState<Grupo[]>([])
  const [usuarios, setUsuarios] = useState<UsuarioCartorio[]>([])
  const [novo, setNovo] = useState<any>(null)
  const [editando, setEditando] = useState<string | null>(null)
  const [rascunho, setRascunho] = useState<Record<string, any>>({})
  const [credencial, setCredencial] = useState<{ email: string; senha: string | null; aviso?: string | null } | null>(null)
  const [diag, setDiag] = useState<DiagnosticoWpp | null>(null)
  const [busy, setBusy] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const souAdmin = ['admin_cartorio', 'tabeliao', 'tabeliao_oficial'].includes(profile?.papel)

  async function carregar() {
    try {
      const [g, u] = await Promise.all([listarGrupos(), listarUsuarios()])
      setGrupos(g); setUsuarios(u)
    } catch (e: any) { setErro(e.message) }
  }
  useEffect(() => { carregar() }, [])

  if (!souAdmin) {
    return (
      <Layout>
        <div className="card p-6">
          <h1 className="font-serif text-xl font-bold text-navy">Administração</h1>
          <p className="text-sm text-ink/65 mt-2">
            Esta área é do administrador do cartório. Fale com o Tabelião Oficial para obter acesso.
          </p>
        </div>
      </Layout>
    )
  }

  return (
    <Layout>
      <div className="mb-4">
        <div className="text-[11px] font-semibold tracking-[.14em] text-brass uppercase">Administração</div>
        <h1 className="font-serif text-2xl font-bold text-navy leading-tight">Usuários e acessos</h1>
        <p className="text-sm text-ink/60">
          A <b>função</b> define a competência no fluxo (matéria legal); o <b>nível</b> define o alcance
          administrativo; o <b>grupo</b> organiza a equipe. A data limite corta o acesso automaticamente.
        </p>
      </div>

      {erro && <div className="text-sm text-red-600 mb-3">{erro}</div>}

      {credencial && (
        <div className="rounded-lg p-3 mb-4" style={{ background: '#FFF8E8', border: '1px solid #E3C57E' }}>
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

      {/* usuários */}
      <div className="card p-5 mb-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h2 className="font-semibold text-navy">Equipe do cartório ({usuarios.filter(u => u.ativo).length} ativos)</h2>
          <button className="btn-brass" onClick={() => setNovo({ nome: '', email: '', papel: 'escrevente', grupoId: '', nivel: 2, acessoAte: '' })}>
            + Novo usuário
          </button>
        </div>

        {novo && (
          <div className="rounded-lg border border-black/10 p-3 mt-3">
            <div className="grid md:grid-cols-3 gap-2">
              <div><label className="label">Nome *</label>
                <input className="input" value={novo.nome} onChange={e => setNovo({ ...novo, nome: e.target.value })} /></div>
              <div><label className="label">E-mail *</label>
                <input className="input" type="email" value={novo.email} onChange={e => setNovo({ ...novo, email: e.target.value })} /></div>
              <div><label className="label">Grupo</label>
                <select className="input" value={novo.grupoId} onChange={e => {
                  const g = grupos.find(x => x.id === e.target.value)
                  setNovo({ ...novo, grupoId: e.target.value, papel: g?.papel_padrao ?? novo.papel, nivel: g?.nivel_padrao ?? novo.nivel })
                }}>
                  <option value="">— sem grupo —</option>
                  {grupos.map(g => <option key={g.id} value={g.id}>{g.nome}</option>)}
                </select></div>
              <div><label className="label">Função (competência)</label>
                <select className="input" value={novo.papel} onChange={e => setNovo({ ...novo, papel: e.target.value })}>
                  {PAPEIS_CARTORIO.map(p => <option key={p.v} value={p.v}>{p.nome}</option>)}
                </select></div>
              <div><label className="label">Nível de acesso</label>
                <select className="input" value={novo.nivel} onChange={e => setNovo({ ...novo, nivel: Number(e.target.value) })}>
                  {NIVEIS.map(n => <option key={n.v} value={n.v}>{n.v} · {n.nome}</option>)}
                </select></div>
              <div><label className="label">Acesso até (opcional)</label>
                <input className="input" type="date" value={novo.acessoAte} onChange={e => setNovo({ ...novo, acessoAte: e.target.value })} /></div>
            </div>
            <p className="text-[11px] text-ink/50 mt-1">
              {NIVEIS.find(n => n.v === novo.nivel)?.desc}
            </p>
            <div className="flex gap-2 mt-2">
              <button className="btn-primary" disabled={busy} onClick={async () => {
                if (!novo.nome.trim() || !novo.email.trim()) { setErro('Informe nome e e-mail.'); return }
                setBusy(true); setErro(null)
                try {
                  const r = await criarUsuario({
                    nome: novo.nome.trim(), email: novo.email.trim(), papel: novo.papel,
                    grupoId: novo.grupoId || null, nivel: novo.nivel, acessoAte: novo.acessoAte || null,
                  })
                  setCredencial(r); setNovo(null); await carregar()
                } catch (e: any) { setErro(e.message) } finally { setBusy(false) }
              }}>Criar usuário</button>
              <button className="btn-ghost" onClick={() => setNovo(null)}>cancelar</button>
            </div>
          </div>
        )}

        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-[13px]" style={{ minWidth: 720 }}>
            <thead>
              <tr className="text-[11px] text-ink/55 border-b border-black/10">
                <th className="px-2 py-1.5 text-left">Nome</th>
                <th className="px-2 py-1.5 text-left">Função</th>
                <th className="px-2 py-1.5 text-left">Grupo</th>
                <th className="px-2 py-1.5 text-left">Nível</th>
                <th className="px-2 py-1.5 text-left">Acesso</th>
                <th className="px-2 py-1.5"></th>
              </tr>
            </thead>
            <tbody>
              {usuarios.map(u => {
                const st = situacaoAcesso(u)
                const ed = editando === u.id
                const r = rascunho[u.id] ?? { papel: u.papel, grupoId: u.grupo_id ?? '', nivel: u.nivel_acesso, acessoAte: u.acesso_ate ?? '', ativo: u.ativo }
                return (
                  <tr key={u.id} className="border-b border-black/5" style={!u.ativo ? { opacity: .55 } : undefined}>
                    <td className="px-2 py-2">
                      <span className="block font-medium text-navy">{u.nome || '(sem nome)'}</span>
                      <span className="block text-[11px] text-ink/50">{u.email}</span>
                    </td>
                    <td className="px-2 py-2">
                      {ed ? (
                        <select className="input" value={r.papel} onChange={e => setRascunho({ ...rascunho, [u.id]: { ...r, papel: e.target.value } })}>
                          {PAPEIS_CARTORIO.map(p => <option key={p.v} value={p.v}>{p.nome}</option>)}
                        </select>
                      ) : nomePapel(u.papel)}
                    </td>
                    <td className="px-2 py-2 text-ink/70">
                      {ed ? (
                        <select className="input" value={r.grupoId} onChange={e => setRascunho({ ...rascunho, [u.id]: { ...r, grupoId: e.target.value } })}>
                          <option value="">—</option>
                          {grupos.map(g => <option key={g.id} value={g.id}>{g.nome}</option>)}
                        </select>
                      ) : (grupos.find(g => g.id === u.grupo_id)?.nome ?? '—')}
                    </td>
                    <td className="px-2 py-2">
                      {ed ? (
                        <select className="input" value={r.nivel} onChange={e => setRascunho({ ...rascunho, [u.id]: { ...r, nivel: Number(e.target.value) } })}>
                          {NIVEIS.map(n => <option key={n.v} value={n.v}>{n.v} · {n.nome}</option>)}
                        </select>
                      ) : `${u.nivel_acesso} · ${nomeNivel(u.nivel_acesso)}`}
                    </td>
                    <td className="px-2 py-2">
                      {ed ? (
                        <input className="input" type="date" value={r.acessoAte}
                          onChange={e => setRascunho({ ...rascunho, [u.id]: { ...r, acessoAte: e.target.value } })} />
                      ) : <span style={{ color: st.cor }}>{st.txt}</span>}
                    </td>
                    <td className="px-2 py-2 text-right whitespace-nowrap">
                      {ed ? (
                        <>
                          <button className="text-[12px] text-navy underline mr-2" disabled={busy} onClick={async () => {
                            setBusy(true); setErro(null)
                            try {
                              await atualizarUsuario(u.id, {
                                papel: r.papel, grupoId: r.grupoId || null,
                                nivel: r.nivel, acessoAte: r.acessoAte || null,
                              })
                              setEditando(null); await carregar()
                            } catch (e: any) { setErro(e.message) } finally { setBusy(false) }
                          }}>salvar</button>
                          <button className="text-[12px] text-ink/50 underline" onClick={() => setEditando(null)}>cancelar</button>
                        </>
                      ) : (
                        <>
                          <button className="text-[12px] text-navy underline mr-2" onClick={() => setEditando(u.id)}>editar</button>
                          <button className="text-[12px] text-navy underline mr-2" disabled={busy} onClick={async () => {
                            setBusy(true)
                            try { const x = await novaSenhaUsuario(u.id); setCredencial({ email: u.email ?? '', senha: x.senha }) }
                            catch (e: any) { setErro(e.message) } finally { setBusy(false) }
                          }}>nova senha</button>
                          <button className="text-[12px] underline" style={{ color: u.ativo ? '#B3261E' : '#1E7A4F' }} disabled={busy}
                            onClick={async () => {
                              setBusy(true); setErro(null)
                              try { await atualizarUsuario(u.id, { ativo: !u.ativo }); await carregar() }
                              catch (e: any) { setErro(e.message) } finally { setBusy(false) }
                            }}>{u.ativo ? 'desativar' : 'reativar'}</button>
                        </>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* grupos */}
      <div className="card p-5 mb-4">
        <h2 className="font-semibold text-navy">Grupos</h2>
        <p className="text-xs text-ink/55 mb-2">
          Ao escolher o grupo no cadastro, a função e o nível vêm preenchidos — e podem ser ajustados caso a caso.
        </p>
        <div className="grid gap-1.5" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))' }}>
          {grupos.map(g => (
            <div key={g.id} className="rounded-lg bg-paper px-3 py-2">
              <span className="block text-[13px] font-medium text-navy">{g.nome}</span>
              <span className="block text-[11px] text-ink/55">
                {nomePapel(g.papel_padrao)} · nível {g.nivel_padrao} ({nomeNivel(g.nivel_padrao)})
              </span>
              {g.descricao && <span className="block text-[11px] text-ink/45 mt-0.5">{g.descricao}</span>}
            </div>
          ))}
        </div>
      </div>

      {/* diagnóstico do WhatsApp */}
      <div className="card p-5 mb-6">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h2 className="font-semibold text-navy">Integração com o WhatsApp</h2>
            <p className="text-xs text-ink/55">Testa as credenciais junto à Meta e aponta a causa provável de falhas.</p>
          </div>
          <button className="btn-ghost" disabled={busy} onClick={async () => {
            setBusy(true); setErro(null); setDiag(null)
            try { setDiag(await diagnosticarWhatsapp()) }
            catch (e: any) { setErro(e.message) } finally { setBusy(false) }
          }}>{busy ? 'Testando…' : 'Testar conexão'}</button>
        </div>

        {diag && (
          <div className="mt-3">
            <ul className="space-y-1">
              {diag.achados.map((a, i) => (
                <li key={i} className="flex gap-2 text-[13px]">
                  <span style={{ color: a.ok ? '#1E7A4F' : '#B3261E' }}>{a.ok ? '✓' : '✗'}</span>
                  <span className="text-ink/75"><b>{a.item}</b> — {a.detalhe}</span>
                </li>
              ))}
            </ul>
            <div className="mt-2 rounded-lg p-3 text-[13px]"
              style={{ background: diag.ok ? '#EAF6EF' : '#FBEAE9', color: diag.ok ? '#14532D' : '#7F1D1B' }}>
              {diag.conclusao}
            </div>
          </div>
        )}
      </div>
    </Layout>
  )
}

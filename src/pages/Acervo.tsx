import { useEffect, useMemo, useState } from 'react'
import { Layout } from '../components/ui'
import { definirModeloPadrao } from '../lib/melhorias'
import { useAuth } from '../context/AuthContext'
import {
  listarAcervo, uploadAcervo, urlAcervo, CATEGORIAS,
  type AcervoItem, type CategoriaAcervo,
} from '../lib/acervo'

const CAT_LABEL: Record<CategoriaAcervo, string> = {
  modelo: 'Modelo', jurisprudencia: 'Jurisprudência', orientacao: 'Orientação', outro: 'Outro',
}
const CAT_COR: Record<CategoriaAcervo, string> = {
  modelo: 'bg-blue-50 text-blue-700', jurisprudencia: 'bg-purple-50 text-purple-700',
  orientacao: 'bg-amber-50 text-amber-700', outro: 'bg-gray-100 text-gray-600',
}

export default function Acervo() {
  const { profile } = useAuth()
  const [itens, setItens] = useState<AcervoItem[]>([])
  const [loading, setLoading] = useState(true)
  const [filtroCat, setFiltroCat] = useState<CategoriaAcervo | 'todas'>('todas')
  const [busca, setBusca] = useState('')

  // form
  const [file, setFile] = useState<File | null>(null)
  const [categoria, setCategoria] = useState<CategoriaAcervo>('modelo')
  const [tipoAto, setTipoAto] = useState('')
  const [titulo, setTitulo] = useState('')
  const [tema, setTema] = useState('')
  const [descricao, setDescricao] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function carregar() {
    setLoading(true)
    try { setItens(await listarAcervo()) } catch (e: any) { setErro(e.message) }
    setLoading(false)
  }
  useEffect(() => { carregar() }, [])

  const temasDisponiveis = useMemo(() => {
    const s = new Set<string>(); itens.forEach(i => i.tema?.forEach(t => s.add(t))); return [...s].sort()
  }, [itens])

  const lista = useMemo(() => itens.filter(i => {
    if (filtroCat !== 'todas' && i.categoria !== filtroCat) return false
    if (busca) {
      const q = busca.toLowerCase()
      const hay = `${i.titulo} ${i.descricao ?? ''} ${(i.tema || []).join(' ')} ${i.tipo_ato_slug ?? ''}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  }), [itens, filtroCat, busca])

  async function enviar() {
    if (!file || !titulo) { setErro('Informe o arquivo e o título.'); return }
    if (!profile?.cartorio_id) { setErro('Perfil sem cartório vinculado.'); return }
    setErro(null); setEnviando(true)
    try {
      await uploadAcervo(file, {
        cartorio_id: profile.cartorio_id, categoria, tipo_ato_slug: tipoAto || undefined,
        titulo, tema: tema.split(',').map(t => t.trim()).filter(Boolean), descricao,
      })
      setFile(null); setTitulo(''); setTema(''); setDescricao(''); setTipoAto('')
      await carregar()
    } catch (e: any) { setErro(e.message ?? 'Falha no upload.') }
    finally { setEnviando(false) }
  }

  async function abrir(item: AcervoItem) {
    if (!item.storage_path) return
    const url = await urlAcervo(item.storage_path)
    if (url) window.open(url, '_blank')
  }

  return (
    <Layout>
      <div className="eyebrow">Base de conhecimento</div>
      <h1 className="font-serif text-3xl font-bold text-navy">Acervo do cartório</h1>
      <p className="text-ink/60 text-sm mb-6">Modelos, jurisprudência e orientações — indexados por tema e usados pela IA na triagem.</p>

      {/* Upload */}
      <div className="card p-5 mb-6">
        <h2 className="font-serif text-lg font-bold text-navy mb-3">Adicionar documento</h2>
        <div className="grid md:grid-cols-2 gap-3">
          <div>
            <label className="label">Arquivo</label>
            <input type="file" onChange={e => setFile(e.target.files?.[0] ?? null)} />
          </div>
          <div>
            <label className="label">Categoria</label>
            <select className="input" value={categoria} onChange={e => setCategoria(e.target.value as CategoriaAcervo)}>
              {CATEGORIAS.map(c => <option key={c.v} value={c.v}>{c.label}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Título</label>
            <input className="input" value={titulo} onChange={e => setTitulo(e.target.value)} placeholder="Ex.: Minuta padrão de compra e venda" />
          </div>
          <div>
            <label className="label">Tipo de ato (slug, opcional)</label>
            <input className="input" value={tipoAto} onChange={e => setTipoAto(e.target.value)} placeholder="compra-venda-imovel" />
          </div>
          <div className="md:col-span-2">
            <label className="label">Temas (separados por vírgula) — indexador</label>
            <input className="input" value={tema} onChange={e => setTema(e.target.value)} placeholder="usucapião, vênia conjugal, ITBI" />
          </div>
          <div className="md:col-span-2">
            <label className="label">Descrição</label>
            <textarea className="input" value={descricao} onChange={e => setDescricao(e.target.value)} />
          </div>
        </div>
        {erro && <div className="text-sm text-red-600 mt-2">{erro}</div>}
        <button className="btn-primary mt-3" onClick={enviar} disabled={enviando}>
          {enviando ? 'Enviando…' : 'Adicionar ao acervo'}
        </button>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-2 items-center mb-3">
        <select className="input w-auto" value={filtroCat} onChange={e => setFiltroCat(e.target.value as any)}>
          <option value="todas">Todas as categorias</option>
          {CATEGORIAS.map(c => <option key={c.v} value={c.v}>{c.label}</option>)}
        </select>
        <input className="input" style={{ maxWidth: 280 }} placeholder="Buscar por título ou tema…" value={busca} onChange={e => setBusca(e.target.value)} />
        {temasDisponiveis.slice(0, 8).map(t => (
          <button key={t} className="badge bg-paper" style={{ border: '1px solid var(--line)' }} onClick={() => setBusca(t)}>{t}</button>
        ))}
      </div>

      {/* Lista */}
      <div className="card overflow-hidden">
        {loading ? <div className="p-6 text-ink/50 text-center">Carregando…</div>
          : lista.length === 0 ? <div className="p-6 text-ink/50 text-center">Nenhum item no acervo.</div>
          : <table className="w-full text-sm">
            <thead><tr className="text-left text-ink/50 text-xs uppercase border-b border-black/5">
              <th className="px-5 py-2">Título</th><th className="px-5 py-2">Categoria</th>
              <th className="px-5 py-2 hide-sm">Temas</th><th className="px-5 py-2"></th>
            </tr></thead>
            <tbody>
              {lista.map(i => (
                <tr key={i.id} className="border-b border-black/5 hover:bg-black/[0.02]">
                  <td className="px-5 py-3">
                    <div className="font-medium text-navy flex items-center gap-1.5">
                      {i.titulo}
                      {(i as any).padrao && (
                        <span className="text-[10px] font-semibold px-1.5 py-[1px] rounded bg-brass/15 text-brass">PADRÃO</span>
                      )}
                    </div>
                    {i.tipo_ato_slug && <div className="text-xs text-ink/50">{i.tipo_ato_slug}</div>}
                  </td>
                  <td className="px-5 py-3"><span className={`badge ${CAT_COR[i.categoria]}`}>{CAT_LABEL[i.categoria]}</span></td>
                  <td className="px-5 py-3 hide-sm text-ink/60 text-xs">{(i.tema || []).join(' · ')}</td>
                  <td className="px-5 py-3 text-right whitespace-nowrap">
                    {i.categoria === 'modelo' && i.tipo_ato_slug && (
                      <button className="text-xs underline mr-3"
                        style={{ color: (i as any).padrao ? 'var(--brass)' : 'var(--navy)' }}
                        title={(i as any).padrao
                          ? 'Este é o modelo aplicado por padrão neste tipo de ato'
                          : 'Usar este modelo por padrão neste tipo de ato'}
                        onClick={async () => {
                          try { await definirModeloPadrao(i.id, !(i as any).padrao); await carregar() }
                          catch (e: any) { setErro(e.message) }
                        }}>
                        {(i as any).padrao ? '★ padrão' : '☆ tornar padrão'}
                      </button>
                    )}
                    {i.storage_path && <button className="text-navy text-xs underline" onClick={() => abrir(i)}>abrir</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>}
      </div>
    </Layout>
  )
}

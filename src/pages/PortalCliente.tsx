import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { portalGet, portalUpload, portalSubmit, LGPD_TEXTO, type PortalDados } from '../lib/portal'
import { TIPOS_DOC } from '../lib/acervo'

function Marca() {
  return (
    <div style={{ background: 'var(--navy)', color: '#fff', padding: '1rem 1.25rem', borderBottom: '2px solid var(--brass)' }}>
      <div className="font-serif" style={{ fontWeight: 700, fontSize: '1.35rem' }}>iNotário</div>
      <div style={{ fontSize: '.62rem', letterSpacing: '.2em', color: 'var(--brass)' }}>PORTAL DO CLIENTE</div>
    </div>
  )
}

export default function PortalCliente() {
  const { token } = useParams()
  const [dados, setDados] = useState<PortalDados | null>(null)
  const [valores, setValores] = useState<Record<string, any>>({})
  const [email, setEmail] = useState('')
  const [lgpd, setLgpd] = useState(false)
  const [tipoDoc, setTipoDoc] = useState('rg')
  const [docs, setDocs] = useState<string[]>([])
  const [enviandoDoc, setEnviandoDoc] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [okFinal, setOkFinal] = useState(false)

  useEffect(() => {
    if (!token) return
    portalGet(token).then(d => {
      setDados(d)
      if (d?.dados) setValores(d.dados)
    }).catch(e => setErro(e.message))
  }, [token])

  async function subirDoc(file: File | null) {
    if (!file || !token) return
    setEnviandoDoc(true); setErro(null)
    try { await portalUpload(token, file, tipoDoc); setDocs(d => [...d, `${tipoDoc.toUpperCase()} · ${file.name}`]) }
    catch (e: any) { setErro(e.message ?? 'Falha no envio do arquivo.') }
    finally { setEnviandoDoc(false) }
  }

  async function finalizar() {
    if (!lgpd) { setErro('É necessário aceitar os termos da LGPD.'); return }
    if (!token) return
    setEnviando(true); setErro(null)
    try { await portalSubmit(token, { dados: valores, email, lgpd_aceite: lgpd }); setOkFinal(true) }
    catch (e: any) { setErro(e.message ?? 'Falha ao enviar.') }
    finally { setEnviando(false) }
  }

  if (erro && !dados) return (
    <div style={{ minHeight: '100vh', background: 'var(--paper)' }}>
      <Marca /><div style={{ maxWidth: 640, margin: '3rem auto', padding: '0 1rem' }}>
        <div className="card p-5" style={{ color: '#9b2c2c' }}>{erro}</div></div>
    </div>
  )
  if (!dados) return <div style={{ minHeight: '100vh', background: 'var(--paper)' }}><Marca /><div style={{ padding: '3rem', textAlign: 'center', color: '#6B7280' }}>Carregando…</div></div>
  if (dados.erro) return (
    <div style={{ minHeight: '100vh', background: 'var(--paper)' }}>
      <Marca /><div style={{ maxWidth: 640, margin: '3rem auto', padding: '0 1rem' }}>
        <div className="card p-5" style={{ color: '#9b2c2c' }}>{dados.erro}</div></div>
    </div>
  )

  if (okFinal) return (
    <div style={{ minHeight: '100vh', background: 'var(--paper)' }}>
      <Marca />
      <div style={{ maxWidth: 640, margin: '3rem auto', padding: '0 1rem' }}>
        <div className="card p-6" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '2.2rem' }}>✓</div>
          <h1 className="font-serif" style={{ color: 'var(--navy)', fontSize: '1.5rem', margin: '.4rem 0' }}>Dados enviados ao cartório</h1>
          <p className="muted">Recebemos suas informações e documentos. O cartório dará andamento ao ato (protocolo {dados.protocolo}) e entrará em contato se algo mais for necessário.</p>
        </div>
      </div>
    </div>
  )

  const campos = dados.tipo_ato?.schema_campos ?? []
  return (
    <div style={{ minHeight: '100vh', background: 'var(--paper)' }}>
      <Marca />
      <div style={{ maxWidth: 680, margin: '1.5rem auto', padding: '0 1rem 4rem' }}>
        <div className="eyebrow">Protocolo {dados.protocolo}</div>
        <h1 className="font-serif" style={{ color: 'var(--navy)', fontSize: '1.7rem' }}>{dados.tipo_ato?.nome}</h1>
        <p className="muted" style={{ fontSize: '.9rem', marginBottom: '1rem' }}>
          Preencha os dados essenciais e anexe os documentos necessários para o cartório elaborar o seu ato.
        </p>

        {/* Dados essenciais */}
        <div className="card p-5" style={{ marginBottom: '1rem' }}>
          <h2 className="font-serif" style={{ color: 'var(--navy)', fontSize: '1.1rem', marginBottom: '.6rem' }}>Dados do ato</h2>
          <div className="grid md:grid-cols-2 gap-3">
            {campos.map((c: any) => (
              <div key={c.key} className={c.type === 'textarea' ? 'md:col-span-2' : ''}>
                <label className="label">{c.label}{c.required ? ' *' : ''}</label>
                {c.type === 'textarea'
                  ? <textarea className="input" value={valores[c.key] || ''} onChange={e => setValores(v => ({ ...v, [c.key]: e.target.value }))} />
                  : c.type === 'select'
                    ? <select className="input" value={valores[c.key] || ''} onChange={e => setValores(v => ({ ...v, [c.key]: e.target.value }))}>
                        <option value=""></option>{(c.options || []).map((o: string) => <option key={o}>{o}</option>)}
                      </select>
                    : <input type={c.type === 'number' ? 'number' : 'text'} className="input" value={valores[c.key] || ''} onChange={e => setValores(v => ({ ...v, [c.key]: e.target.value }))} />}
              </div>
            ))}
            <div>
              <label className="label">Seu e-mail para contato</label>
              <input type="email" className="input" value={email} onChange={e => setEmail(e.target.value)} />
            </div>
          </div>
        </div>

        {/* Documentos */}
        <div className="card p-5" style={{ marginBottom: '1rem' }}>
          <h2 className="font-serif" style={{ color: 'var(--navy)', fontSize: '1.1rem', marginBottom: '.6rem' }}>Documentos</h2>
          <p className="muted" style={{ fontSize: '.8rem', marginBottom: '.6rem' }}>Anexe identificação (RG/CPF/CNH), certidões, contratos e o que mais for pertinente.</p>
          <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <select className="input" style={{ width: 'auto' }} value={tipoDoc} onChange={e => setTipoDoc(e.target.value)}>
              {TIPOS_DOC.map(t => <option key={t} value={t}>{t.toUpperCase()}</option>)}
            </select>
            <input type="file" disabled={enviandoDoc} onChange={e => subirDoc(e.target.files?.[0] ?? null)} />
            {enviandoDoc && <span className="muted" style={{ fontSize: '.8rem' }}>enviando…</span>}
          </div>
          {docs.length > 0 && (
            <ul style={{ marginTop: '.7rem', fontSize: '.84rem' }}>
              {docs.map((d, i) => <li key={i} style={{ color: 'var(--ink)' }}>✓ {d}</li>)}
            </ul>
          )}
        </div>

        {/* LGPD */}
        <div className="card p-5" style={{ marginBottom: '1rem' }}>
          <h2 className="font-serif" style={{ color: 'var(--navy)', fontSize: '1.1rem', marginBottom: '.5rem' }}>Consentimento (LGPD)</h2>
          <p className="muted" style={{ fontSize: '.78rem', lineHeight: 1.5, marginBottom: '.6rem' }}>{LGPD_TEXTO}</p>
          <label style={{ display: 'flex', gap: '.5rem', alignItems: 'flex-start', fontSize: '.85rem' }}>
            <input type="checkbox" checked={lgpd} onChange={e => setLgpd(e.target.checked)} style={{ width: 'auto', marginTop: 3 }} />
            <span>Li e concordo com o tratamento dos meus dados pessoais para a finalidade de elaboração do ato notarial, nos termos acima.</span>
          </label>
        </div>

        {erro && <div style={{ color: '#9b2c2c', fontSize: '.85rem', marginBottom: '.6rem' }}>{erro}</div>}
        <button className="btn-primary" onClick={finalizar} disabled={enviando || !lgpd} style={{ width: '100%' }}>
          {enviando ? 'Enviando…' : 'Enviar ao cartório'}
        </button>
      </div>
    </div>
  )
}

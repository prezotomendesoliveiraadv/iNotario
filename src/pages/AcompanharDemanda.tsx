import { useState } from 'react'
import { dataCurta, dataHora } from '../lib/tempo'
import { Link } from 'react-router-dom'
import { atenderStatus } from '../lib/atendimento'

interface StatusResp {
  protocolo: string; nome: string | null; servico: string | null
  etapa: string; atualizado_em: string; criado_em: string
}

const ETAPAS_ORDEM = ['Recebida pelo cartório', 'Em elaboração', 'Em revisão', 'Aprovada — aguardando conclusão', 'Concluída']

export default function AcompanharDemanda() {
  const [protocolo, setProtocolo] = useState('')
  const [whatsapp, setWhatsapp] = useState('')
  const [res, setRes] = useState<StatusResp | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function consultar() {
    setErro(null); setRes(null); setLoading(true)
    try { setRes(await atenderStatus(protocolo.trim(), whatsapp)) }
    catch (e: any) { setErro(e.message ?? 'Falha na consulta.') }
    finally { setLoading(false) }
  }

  const idx = res ? ETAPAS_ORDEM.indexOf(res.etapa) : -1

  return (
    <div style={{ minHeight: '100vh', background: 'var(--paper)' }}>
      <div style={{ background: 'var(--navy)', color: '#fff', padding: '1rem 1.25rem', borderBottom: '2px solid var(--brass)' }}>
        <div className="font-serif" style={{ fontWeight: 700, fontSize: '1.35rem' }}>iNotário</div>
        <div style={{ fontSize: '.62rem', letterSpacing: '.2em', color: 'var(--brass)' }}>ACOMPANHAMENTO DE SOLICITAÇÃO</div>
      </div>

      <div style={{ maxWidth: 560, margin: '2rem auto', padding: '0 1rem 3rem' }}>
        <h1 className="font-serif" style={{ color: 'var(--navy)', fontSize: '1.6rem' }}>Acompanhe sua solicitação</h1>
        <p className="muted" style={{ fontSize: '.88rem', margin: '.3rem 0 1rem' }}>
          Por segurança, informe o <b>número do protocolo</b> e o <b>mesmo WhatsApp</b> usado na solicitação.
        </p>

        <div className="card p-5">
          <label className="label">Protocolo</label>
          <input className="input font-mono" placeholder="2026/000123" value={protocolo} onChange={e => setProtocolo(e.target.value)} />
          <label className="label">WhatsApp (com DDD)</label>
          <input className="input" placeholder="(11) 99999-9999" value={whatsapp} onChange={e => setWhatsapp(e.target.value)} />
          {erro && <div style={{ color: '#9b2c2c', fontSize: '.85rem', marginTop: '.6rem' }}>{erro}</div>}
          <button className="btn-primary mt-3" style={{ width: '100%' }} onClick={consultar} disabled={loading || !protocolo.trim() || whatsapp.replace(/\D/g, '').length < 10}>
            {loading ? 'Consultando…' : 'Consultar'}
          </button>
        </div>

        {res && (
          <div className="card p-5 mt-4">
            <div className="eyebrow">Protocolo {res.protocolo}</div>
            <h2 className="font-serif" style={{ color: 'var(--navy)', fontSize: '1.2rem', margin: '.2rem 0 .1rem' }}>
              {res.nome ? `Olá, ${res.nome}!` : 'Sua solicitação'}
            </h2>
            {res.servico && <p className="muted" style={{ fontSize: '.85rem' }}>{res.servico}</p>}

            <div style={{ margin: '1rem 0 .4rem' }}>
              {ETAPAS_ORDEM.map((et, i) => {
                const feito = idx >= 0 ? i <= idx : false
                const atual = i === idx
                return (
                  <div key={et} style={{ display: 'flex', alignItems: 'center', gap: '.6rem', padding: '.28rem 0' }}>
                    <span style={{
                      width: 14, height: 14, borderRadius: 14, flexShrink: 0,
                      background: feito ? 'var(--brass)' : '#e4e1da',
                      boxShadow: atual ? '0 0 0 4px rgba(195,154,77,.25)' : 'none',
                    }} />
                    <span style={{ fontSize: '.88rem', color: feito ? 'var(--ink)' : '#9aa0ab', fontWeight: atual ? 700 : 400 }}>{et}</span>
                  </div>
                )
              })}
              {idx === -1 && <div style={{ fontSize: '.88rem', color: 'var(--ink)' }}>Situação atual: <b>{res.etapa}</b></div>}
            </div>

            <p className="muted" style={{ fontSize: '.75rem' }}>
              Última atualização: {dataHora(new Date(res.atualizado_em))}. Dúvidas? O cartório fala com você pelo WhatsApp cadastrado.
            </p>
          </div>
        )}

        <div style={{ textAlign: 'center', marginTop: '1.2rem' }}>
          <Link to="/atender" className="text-navy" style={{ fontSize: '.85rem', textDecoration: 'underline' }}>Iniciar uma nova solicitação</Link>
          <span className="muted" style={{ margin: '0 .5rem' }}>·</span>
          <Link to="/login" className="text-navy" style={{ fontSize: '.85rem', textDecoration: 'underline' }}>Sou do cartório</Link>
        </div>
      </div>
    </div>
  )
}

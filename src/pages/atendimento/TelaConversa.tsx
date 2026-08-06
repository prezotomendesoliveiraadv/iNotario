import Marca from './Marca'
import FormularioManual from '../../components/FormularioManual'
import { LGPD_TEXTO } from '../../lib/portal'
import type { Atendimento } from './useAtendimento'

const DOC_TIPOS = ['rg', 'cnh', 'matricula', 'contrato', 'outro']

const VOZ_LABEL: Record<string, string> = {
  ouvindo: '🎙️ Ouvindo — pode falar', pensando: '… entendendo', falando: '🔊 Artemis falando…', parado: 'Voz pausada',
}

/** Passo 2 — a conversa em si: chat/voz à esquerda, documentos e LGPD à direita. */
export default function TelaConversa({ at }: { at: Atendimento }) {
  const {
    protocolo, tipoNome, msgs, loading, erro,
    legendaExibida, idioma, setIdioma, traduzirLegenda,
    canal, setCanal, vozAtiva, vozEstado, ligarVoz, desligarVoz,
    sugerirTexto, setSugerirTexto, falhasRef,
    texto, setTexto, enviarTexto, campoRef, fimRef,
    modoManual, setModoManual, enviarFormularioManual,
    contato, setContato, contatoConfirmado, setContatoConfirmado,
    emprConfirmado, alertaUnidade,
    docs, tipoDoc, setTipoDoc, enviandoDoc, subirDoc,
    lgpd, setLgpd, finalizar,
  } = at

  return (
    <div style={{ minHeight: '100vh', background: 'var(--paper)' }}>
      <Marca />
      <div style={{ maxWidth: 920, margin: '1rem auto', padding: '0 1rem 3rem' }}>
        <div className="eyebrow" style={{ marginBottom: '.6rem' }}>Protocolo {protocolo} · {tipoNome}</div>

        {/* Barra de legenda (voz) */}
        {legendaExibida && (
          <div className="card" style={{ padding: '.9rem 1.1rem', marginBottom: '.8rem', borderLeft: '3px solid var(--brass)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.5rem', marginBottom: '.3rem' }}>
              <span className="eyebrow">Legenda {idioma === 'en' ? '(EN)' : '(PT)'}</span>
              <div style={{ display: 'flex', gap: '.3rem' }}>
                <button onClick={() => setIdioma('pt')} className={idioma === 'pt' ? 'btn-primary' : 'btn-ghost'} style={{ padding: '.15rem .6rem', fontSize: '.72rem' }}>PT</button>
                <button onClick={traduzirLegenda} className={idioma === 'en' ? 'btn-primary' : 'btn-ghost'} style={{ padding: '.15rem .6rem', fontSize: '.72rem' }}>EN</button>
              </div>
            </div>
            <div style={{ fontSize: '1.05rem', lineHeight: 1.4, color: 'var(--navy)' }}>{legendaExibida}</div>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.5fr) minmax(0,1fr)', gap: '1rem' }} className="atend-grid">
          {/* Chat */}
          <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
            <div className="pad" style={{ borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong style={{ color: 'var(--navy)' }}>Conversa</strong>
              <select className="input" style={{ width: 'auto', fontSize: '.78rem' }} value={canal} onChange={e => setCanal(e.target.value as any)}>
                <option value="VOZ">Voz (mãos livres)</option>
                <option value="TEXTO">Texto</option>
              </select>
            </div>
            <div style={{ maxHeight: 320, overflow: 'auto', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '.6rem' }}>
              {msgs.map((m, i) => (
                <div key={i} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '88%' }}>
                  <div style={{ whiteSpace: 'pre-wrap', fontSize: '.88rem', lineHeight: 1.5, padding: '.55rem .8rem', borderRadius: 12, background: m.role === 'user' ? 'var(--navy)' : 'var(--paper)', color: m.role === 'user' ? '#fff' : 'var(--ink)' }}>{m.content}</div>
                </div>
              ))}
              {(loading || vozEstado === 'pensando') && <div className="muted" style={{ fontSize: '.8rem' }}>Artemis está pensando…</div>}
              <div ref={fimRef} />
            </div>
            {modoManual ? (
            <div style={{ padding: '1rem' }}>
              <FormularioManual
                inicial={{ solicitante: { nome: contato.nome || '', cpf: '', telefone: contato.whatsapp || '', email: contato.email || '' } } as any}
                enviando={loading}
                onVoltarConversa={() => setModoManual(false)}
                onEnviar={enviarFormularioManual}
              />
            </div>
          ) : null}

          {/* Dados de contato — a Artemis preenche, o cliente confirma */}
          {(contato.nome || contato.whatsapp || emprConfirmado) && (
            <div style={{ margin: '.75rem 1rem 0', padding: '.7rem .85rem', borderRadius: 12,
                          background: contatoConfirmado ? '#EAF6EF' : 'var(--paper)',
                          border: `1px solid ${contatoConfirmado ? '#9BC9AE' : 'var(--line)'}` }}>
              <div style={{ fontSize: '.68rem', letterSpacing: '.12em', textTransform: 'uppercase',
                            color: 'var(--brass)', fontWeight: 600, marginBottom: '.35rem' }}>
                Seus dados
              </div>

              {emprConfirmado && (
                <div style={{ fontSize: '.8rem', color: '#1E7A4F', marginBottom: '.4rem' }}>
                  ✓ Empreendimento <b>{emprConfirmado}</b> localizado no cartório — os dados da construtora já estão conosco.
                </div>
              )}

              <div style={{ display: 'grid', gap: '.4rem', gridTemplateColumns: '1fr 1fr' }}>
                <label style={{ fontSize: '.72rem', color: 'var(--muted, #6B7280)' }}>
                  Nome
                  <input className="input" value={contato.nome || ''}
                    onChange={e => { setContato(c => ({ ...c, nome: e.target.value })); setContatoConfirmado(false) }} />
                </label>
                <label style={{ fontSize: '.72rem', color: 'var(--muted, #6B7280)' }}>
                  WhatsApp
                  <input className="input" placeholder="(11) 99999-9999" value={contato.whatsapp || ''}
                    onChange={e => { setContato(c => ({ ...c, whatsapp: e.target.value })); setContatoConfirmado(false) }} />
                </label>
              </div>

              {(contato.nome || contato.whatsapp) && (
                contatoConfirmado ? (
                  <div style={{ fontSize: '.76rem', color: '#1E7A4F', marginTop: '.4rem' }}>
                    ✓ Dados confirmados. Se algo mudar, é só editar aqui.
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', marginTop: '.45rem', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '.76rem', color: 'var(--ink)' }}>Está certinho?</span>
                    <button className="btn-primary" style={{ padding: '.25rem .7rem', fontSize: '.78rem' }}
                      onClick={() => setContatoConfirmado(true)}>Confirmar</button>
                    <span style={{ fontSize: '.72rem', color: 'var(--muted, #6B7280)' }}>
                      ou corrija acima
                    </span>
                  </div>
                )
              )}
            </div>
          )}

          {alertaUnidade && (
            <div style={{ margin: '0 1rem .6rem', padding: '.6rem .8rem', borderRadius: 10,
                          background: '#FFF8E8', border: '1px solid #E3C57E', fontSize: '.84rem' }}>
              Já existe o protocolo <b>{alertaUnidade.protocolo}</b> para a unidade{' '}
              <b>{alertaUnidade.unidade}</b> do {alertaUnidade.empreendimento}.
              A Artemis vai confirmar com você se é a mesma negociação.
            </div>
          )}
          <div className="pad" style={{ borderTop: '1px solid var(--line)' }}>
              {canal === 'TEXTO' ? (
                <div style={{ display: 'flex', gap: '.5rem' }}>
                  <textarea ref={campoRef} className="input" value={texto} onChange={e => setTexto(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviarTexto(texto) } }}
                    placeholder="Escreva sua resposta… (Enter envia)" style={{ minHeight: 44 }} autoFocus />
                  <button className="btn-primary" onClick={() => enviarTexto(texto)} disabled={loading || !texto.trim()}>Enviar</button>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center' }}>
                  <div style={{ flex: 1, textAlign: 'center', padding: '.55rem', borderRadius: 12, fontSize: '.9rem', background: vozEstado === 'ouvindo' ? '#e8f5ee' : vozEstado === 'falando' ? '#eef2fb' : 'var(--paper)', color: 'var(--ink)', border: '1px solid var(--line)' }}>
                    {VOZ_LABEL[vozEstado]}
                    {vozEstado === 'ouvindo' && <span className="pulse-dot" style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 8, background: '#1E7a4f', marginLeft: 8 }} />}
                  </div>
                  {vozAtiva ? <button className="btn-ghost" onClick={desligarVoz}>Pausar</button>
                    : <button className="btn-primary" onClick={ligarVoz}>Retomar voz</button>}
                </div>
              )}

              {/* Saída elegante: nome próprio é o caso mais difícil da transcrição */}
              {canal === 'VOZ' && sugerirTexto && (
                <div style={{ marginTop: '.5rem', padding: '.6rem .8rem', borderRadius: 10, background: '#FFF8E8', border: '1px solid #E3C57E', fontSize: '.86rem' }}>
                  Está difícil ouvir daí. Se preferir, <b>escreva</b> — costuma ser mais rápido para nomes e números.
                  <button className="btn-ghost" style={{ marginLeft: '.5rem', padding: '.2rem .6rem' }}
                    onClick={() => { desligarVoz(); setCanal('TEXTO'); setSugerirTexto(false); falhasRef.current = 0 }}>
                    Digitar
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Painel: docs + contato + LGPD + finalizar */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div className="card p-4">
              <strong style={{ color: 'var(--navy)', fontSize: '.92rem' }}>Documentos</strong>
              <p className="muted" style={{ fontSize: '.75rem', margin: '.2rem 0 .5rem' }}>Anexe RG/CNH, matrícula ou contrato (foto ou PDF).</p>
              <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
                <select className="input" style={{ width: 'auto' }} value={tipoDoc} onChange={e => setTipoDoc(e.target.value)}>
                  {DOC_TIPOS.map(t => <option key={t} value={t}>{t.toUpperCase()}</option>)}
                </select>
                <input type="file" accept="image/*,application/pdf" disabled={enviandoDoc} onChange={e => subirDoc(e.target.files?.[0] ?? null)} />
              </div>
              {docs.length > 0 && <ul style={{ fontSize: '.8rem', marginTop: '.5rem' }}>{docs.map((d, i) => <li key={i}>✓ {d}</li>)}</ul>}
            </div>

            <div className="card p-4">
              <strong style={{ color: 'var(--navy)', fontSize: '.92rem' }}>Contato</strong>
              <label className="label">Seu nome</label>
              <input className="input" value={contato.nome || ''} onChange={e => setContato(c => ({ ...c, nome: e.target.value }))} />
              <label className="label">WhatsApp (com DDD)</label>
              <input className="input" placeholder="(11) 99999-9999" value={contato.whatsapp || ''} onChange={e => setContato(c => ({ ...c, whatsapp: e.target.value }))} />
              <label className="label">E-mail (opcional)</label>
              <input className="input" value={contato.email || ''} onChange={e => setContato(c => ({ ...c, email: e.target.value }))} />
            </div>

            <div className="card p-4">
              <label style={{ display: 'flex', gap: '.5rem', alignItems: 'flex-start', fontSize: '.82rem' }}>
                <input type="checkbox" checked={lgpd} onChange={e => setLgpd(e.target.checked)} style={{ width: 'auto', marginTop: 3 }} />
                <span>Li e concordo com o tratamento dos meus dados para este atendimento (LGPD).</span>
              </label>
              <details style={{ marginTop: '.4rem' }}>
                <summary className="muted" style={{ fontSize: '.72rem', cursor: 'pointer' }}>Ler o texto completo</summary>
                <p className="muted" style={{ fontSize: '.72rem', lineHeight: 1.5, marginTop: '.3rem' }}>{LGPD_TEXTO}</p>
              </details>
              {erro && <div style={{ color: '#9b2c2c', fontSize: '.82rem', marginTop: '.5rem' }}>{erro}</div>}
              <button className="btn-brass mt-3" style={{ width: '100%' }} onClick={finalizar} disabled={loading}>{loading ? 'Enviando…' : 'Finalizar e enviar ao cartório'}</button>
            </div>
          </div>
        </div>
      </div>
      <style>{`@media (max-width:760px){ .atend-grid{ grid-template-columns:1fr !important } }
      @keyframes pulso { 0%{opacity:.35} 50%{opacity:1} 100%{opacity:.35} }
      .pulse-dot{ animation: pulso 1.2s infinite }`}</style>
    </div>
  )
}

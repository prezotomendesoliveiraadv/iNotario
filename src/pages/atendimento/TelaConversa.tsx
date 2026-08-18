import { useState } from 'react'
import Marca from './Marca'
import Modal from '../../components/Modal'
import FormularioManual from '../../components/FormularioManual'
import { LGPD_TEXTO } from '../../lib/portal'
import type { Atendimento } from './useAtendimento'

// Os valores têm de bater com os tipos que o artemis-extract reconhece: o
// portal enviava 'contrato', que caía na instrução genérica do extrator e
// produzia um JSON solto em vez do resumo do contrato.
const DOC_TIPOS: { v: string; label: string }[] = [
  { v: 'rg', label: 'RG' },
  { v: 'cnh', label: 'CNH' },
  { v: 'matricula', label: 'Matrícula' },
  { v: 'compromisso', label: 'Contrato de compra e venda' },
  { v: 'outro', label: 'Outro' },
]

const VOZ_LABEL: Record<string, string> = {
  ouvindo: '🎙️ Ouvindo — pode falar', pensando: '… entendendo', falando: '🔊 Artemis falando…', parado: 'Voz pausada',
}

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: '.72rem', letterSpacing: '.06em', textTransform: 'uppercase',
                    color: 'var(--brass, #9A7B4F)', marginBottom: '.25rem' }}>{titulo}</div>
      <div style={{ fontSize: '.86rem' }}>{children}</div>
    </div>
  )
}

function Dado({ rotulo, valor, opcional }: { rotulo: string; valor?: string | null; opcional?: boolean }) {
  return (
    <div style={{ display: 'flex', gap: '.5rem' }}>
      <span style={{ color: 'var(--muted, #6B7280)', minWidth: 78, fontSize: '.78rem' }}>{rotulo}</span>
      <span style={{ color: valor ? 'var(--ink)' : 'var(--muted, #6B7280)', fontWeight: valor ? 600 : 400 }}>
        {valor || (opcional ? 'não informado' : '—')}
      </span>
    </div>
  )
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
    lgpd, setLgpd, finalizar, montarResumo,
  } = at

  // A pessoa só vê os campos abertos quando ainda não há nada anotado, ou
  // quando ela mesma pede para corrigir. Nos demais casos, confere e envia.
  const [editando, setEditando] = useState(false)
  const [conferindo, setConferindo] = useState<ReturnType<typeof montarResumo> | null>(null)
  const temContato = Boolean(contato.nome || contato.whatsapp)

  return (
    <>
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
          {emprConfirmado && (
            <div style={{ margin: '.75rem 1rem 0', padding: '.7rem .85rem', borderRadius: 12,
                          background: '#EAF6EF', border: '1px solid #9BC9AE', fontSize: '.8rem', color: '#1E7A4F' }}>
              ✓ Empreendimento <b>{emprConfirmado}</b> localizado no cartório — os dados da construtora já estão conosco.
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
                  {DOC_TIPOS.map(t => <option key={t.v} value={t.v}>{t.label}</option>)}
                </select>
                <input type="file" accept="image/*,application/pdf" disabled={enviandoDoc} onChange={e => subirDoc(e.target.files?.[0] ?? null)} />
              </div>
              {docs.length > 0 && <ul style={{ fontSize: '.8rem', marginTop: '.5rem' }}>{docs.map((d, i) => <li key={i}>✓ {d}</li>)}</ul>}
            </div>

            <div className="card p-4">
              <strong style={{ color: 'var(--navy)', fontSize: '.92rem' }}>Contato</strong>

              {temContato && !editando ? (
                <>
                  <div style={{ fontSize: '.76rem', color: '#1E7A4F', margin: '.35rem 0 .55rem' }}>
                    ✓ Anotado da sua conversa — confira antes de enviar.
                  </div>
                  <div style={{ display: 'grid', gap: '.3rem', fontSize: '.84rem' }}>
                    <Dado rotulo="Nome" valor={contato.nome} />
                    <Dado rotulo="WhatsApp" valor={contato.whatsapp} />
                    <Dado rotulo="E-mail" valor={contato.email} opcional />
                  </div>
                  <button className="btn-ghost mt-3" style={{ padding: '.25rem .7rem', fontSize: '.78rem' }}
                    onClick={() => setEditando(true)}>Corrigir</button>
                </>
              ) : (
                <>
                  <label className="label">Seu nome</label>
                  <input className="input" value={contato.nome || ''} onChange={e => setContato(c => ({ ...c, nome: e.target.value }))} />
                  <label className="label">WhatsApp (com DDD)</label>
                  <input className="input" placeholder="(11) 99999-9999" value={contato.whatsapp || ''} onChange={e => setContato(c => ({ ...c, whatsapp: e.target.value }))} />
                  <label className="label">E-mail (opcional)</label>
                  <input className="input" value={contato.email || ''} onChange={e => setContato(c => ({ ...c, email: e.target.value }))} />
                  {temContato && (
                    <button className="btn-primary mt-3" style={{ padding: '.25rem .7rem', fontSize: '.78rem' }}
                      onClick={() => { setEditando(false); setContatoConfirmado(true) }}>Pronto</button>
                  )}
                </>
              )}
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
              <button className="btn-brass mt-3" style={{ width: '100%' }}
                onClick={() => {
                  // A validação roda antes da janela: não faz sentido pedir
                  // conferência de um envio que ainda não pode acontecer.
                  const faltaNome = !contato.nome, faltaZap = !contato.whatsapp
                  if (faltaNome || faltaZap || !lgpd) { finalizar(); return }
                  setConferindo(montarResumo())
                }}
                disabled={loading}>{loading ? 'Enviando…' : 'Finalizar e enviar ao cartório'}</button>
            </div>
          </div>
        </div>
      </div>
      <style>{`@media (max-width:760px){ .atend-grid{ grid-template-columns:1fr !important } }
      @keyframes pulso { 0%{opacity:.35} 50%{opacity:1} 100%{opacity:.35} }
      .pulse-dot{ animation: pulso 1.2s infinite }`}</style>
    </div>
      <Modal
        aberto={conferindo !== null}
        titulo="Confira antes de enviar ao cartório"
        rotuloConfirmar="Está correto, enviar"
        rotuloCancelar="Voltar e corrigir"
        confirmando={loading}
        onFechar={() => setConferindo(null)}
        onConfirmar={async () => { await finalizar(); setConferindo(null) }}
      >
        {conferindo && (
          <div style={{ display: 'grid', gap: '.85rem' }}>
            <Secao titulo="Serviço">{conferindo.servico || '—'}</Secao>

            <Secao titulo="Seus dados">
              <Dado rotulo="Nome" valor={conferindo.contato.nome} />
              <Dado rotulo="WhatsApp" valor={conferindo.contato.whatsapp} />
              <Dado rotulo="E-mail" valor={conferindo.contato.email} opcional />
            </Secao>

            {conferindo.empreendimento && (
              <Secao titulo="Empreendimento">{conferindo.empreendimento}</Secao>
            )}

            <Secao titulo={`Documentos anexados (${conferindo.documentos.length})`}>
              {conferindo.documentos.length
                ? <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
                    {conferindo.documentos.map((d, i) => <li key={i}>{d}</li>)}
                  </ul>
                : <span style={{ color: '#9A3412' }}>
                    Nenhum documento anexado. Dá para enviar assim mesmo — o cartório pedirá depois.
                  </span>}
            </Secao>

            <Secao titulo="O que você informou na conversa">
              {conferindo.falas.length
                ? <ul style={{ margin: 0, paddingLeft: '1.1rem', display: 'grid', gap: '.25rem' }}>
                    {conferindo.falas.map((f, i) => <li key={i}>{f}</li>)}
                  </ul>
                : <span style={{ color: '#6B7280' }}>—</span>}
            </Secao>

            <div style={{ fontSize: '.78rem', color: '#6B7280', borderTop: '1px solid rgba(0,0,0,.07)', paddingTop: '.6rem' }}>
              Ao confirmar, o cartório recebe estes dados e o protocolo é gerado.
              Cancelando, você volta à conversa e pode corrigir o que quiser.
            </div>
          </div>
        )}
      </Modal>
    </>
  )
}

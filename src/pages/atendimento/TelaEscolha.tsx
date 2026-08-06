import Marca from './Marca'
import type { Atendimento } from './useAtendimento'

/** Passo 1 — escolha do serviço, da trilha (documentos x conversa) e do canal. */
export default function TelaEscolha({ at }: { at: Atendimento }) {
  const {
    tipos, tipoSlug, setTipoSlug, trilha, setTrilha,
    modoManual, setModoManual, modoInicial, setModoInicial,
    erro, loading, iniciar,
  } = at

  return (
    <div style={{ minHeight: '100vh', background: 'var(--paper)' }}>
      <Marca />
      <div style={{ maxWidth: 640, margin: '1.5rem auto', padding: '0 1rem 3rem' }}>
        <div className="eyebrow">Atendimento online</div>
        <h1 className="font-serif" style={{ color: 'var(--navy)', fontSize: '1.7rem' }}>Vamos iniciar sua solicitação</h1>
        <p className="muted" style={{ fontSize: '.9rem', marginBottom: '1rem' }}>A Artemis vai te atender em poucos minutos — por voz (como uma conversa) ou por texto. Escolha o serviço:</p>
        <div className="card p-5">
          <label className="label">Serviço desejado</label>
          <select className="input" value={tipoSlug} onChange={e => setTipoSlug(e.target.value)}>
            <option value="">Selecione…</option>
            {tipos.map(t => <option key={t.slug} value={t.slug}>{t.nome}</option>)}
          </select>
          <label className="label" style={{ marginTop: '.6rem' }}>Você já tem os documentos em mãos?</label>
          <div style={{ display: 'grid', gap: '.4rem' }}>
            <button type="button" onClick={() => setTrilha('documentos')}
              className={trilha === 'documentos' ? 'btn-primary' : 'btn-ghost'} style={{ textAlign: 'left' }}>
              📄 Sim, tenho — caminho rápido
            </button>
            <button type="button" onClick={() => setTrilha('conversa')}
              className={trilha === 'conversa' ? 'btn-primary' : 'btn-ghost'} style={{ textAlign: 'left' }}>
              💬 Prefiro conversar e enviar depois
            </button>
          </div>
          {trilha === 'documentos' && (
            <div style={{ marginTop: '.5rem', padding: '.6rem .75rem', borderRadius: 10,
                          background: 'var(--paper)', border: '1px solid var(--line)' }}>
              <div style={{ fontSize: '.8rem', marginBottom: '.35rem' }}>
                Prefere <b>digitar os dados</b> em vez de conversar?
              </div>
              <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap' }}>
                <button type="button" className={modoManual ? 'btn-primary' : 'btn-ghost'}
                  style={{ padding: '.25rem .7rem', fontSize: '.78rem' }}
                  onClick={() => setModoManual(true)}>Sim, preencher formulário</button>
                <button type="button" className={!modoManual ? 'btn-primary' : 'btn-ghost'}
                  style={{ padding: '.25rem .7rem', fontSize: '.78rem' }}
                  onClick={() => setModoManual(false)}>Não, falar com a Artemis</button>
              </div>
              <p className="muted" style={{ fontSize: '.72rem', marginTop: '.3rem' }}>
                {modoManual
                  ? 'Você digita nome, partes, objeto, matrícula e documentos — e anexa os arquivos depois.'
                  : 'A Artemis conduz e vai preenchendo os campos na tela conforme você informa.'}
              </p>
            </div>
          )}

          <p className="muted" style={{ fontSize: '.72rem', marginTop: '.35rem' }}>
            {trilha === 'documentos'
              ? 'Com RG ou CNH, o contrato e a matrícula em mãos, a Artemis lê os documentos e faz poucas perguntas.'
              : 'A Artemis conduz a conversa passo a passo e você anexa os documentos quando puder.'}
          </p>

          <label className="label" style={{ marginTop: '.6rem' }}>Como prefere conversar?</label>
          <div style={{ display: 'flex', gap: '.5rem' }}>
            <button type="button" onClick={() => setModoInicial('VOZ')} className={modoInicial === 'VOZ' ? 'btn-primary' : 'btn-ghost'} style={{ flex: 1 }}>🎙️ Por voz</button>
            <button type="button" onClick={() => setModoInicial('TEXTO')} className={modoInicial === 'TEXTO' ? 'btn-primary' : 'btn-ghost'} style={{ flex: 1 }}>⌨️ Por texto</button>
          </div>
          {erro && <div style={{ color: '#9b2c2c', fontSize: '.85rem', marginTop: '.6rem' }}>{erro}</div>}
          <button className="btn-brass mt-3" onClick={iniciar} disabled={loading} style={{ width: '100%' }}>{loading ? 'Iniciando…' : 'Começar atendimento'}</button>
          {modoInicial === 'VOZ' && <p className="muted" style={{ fontSize: '.72rem', marginTop: '.5rem' }}>Ao começar, a Artemis fala e já ativa o microfone. Permita o acesso quando o navegador pedir.</p>}
        </div>
      </div>
    </div>
  )
}

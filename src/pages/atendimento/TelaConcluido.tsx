import Marca from './Marca'
import type { Atendimento } from './useAtendimento'

/** Passo 3 — protocolo emitido e a ficha do que a Artemis registrou. */
export default function TelaConcluido({ at }: { at: Atendimento }) {
  const { protocolo, resumoFinal, ficha } = at

  return (
    <div style={{ minHeight: '100vh', background: 'var(--paper)' }}>
      <Marca />
      <div style={{ maxWidth: 720, margin: '2rem auto', padding: '0 1rem 3rem' }}>
        <div className="card p-6" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '2.2rem' }}>✓</div>
          <h1 className="font-serif" style={{ color: 'var(--navy)', fontSize: '1.5rem', margin: '.4rem 0' }}>Solicitação registrada!</h1>
          <p className="muted">Seu protocolo é</p>
          <div className="font-mono" style={{ fontSize: '1.5rem', color: 'var(--navy)', fontWeight: 700, margin: '.3rem 0 .8rem' }}>{protocolo}</div>
          {resumoFinal && <p style={{ fontSize: '.92rem', color: 'var(--ink)', margin: '0 auto .5rem', maxWidth: 560 }}>{resumoFinal}</p>}
          <p className="muted" style={{ fontSize: '.8rem' }}>O cartório vai analisar e falar com você pelo WhatsApp. Para acompanhar, use "Sou cliente" na página de entrada, com o protocolo + seu WhatsApp.</p>
        </div>
        {ficha && (
          <div className="card p-5 mt-4">
            <div className="eyebrow">O que a Artemis registrou</div>
            {ficha.titulo && <h2 className="font-serif" style={{ color: 'var(--navy)', fontSize: '1.1rem', marginBottom: '.5rem' }}>{ficha.titulo}</h2>}
            {ficha.solicitante?.nome && (
              <p style={{ fontSize: '.88rem', marginBottom: '.4rem' }}>
                <b>Solicitante:</b> {ficha.solicitante.nome}
                {ficha.solicitante.qualificacao === 'representante'
                  ? ` — representante${ficha.solicitante.empresa ? ` (${ficha.solicitante.empresa})` : ''}${ficha.solicitante.representa ? ` de ${ficha.solicitante.representa}` : ''}`
                  : ' — parte do ato'}
              </p>
            )}
            {(ficha.partes ?? []).length > 0 && (
              <div style={{ fontSize: '.88rem', marginBottom: '.4rem' }}><b>Partes:</b>
                <ul style={{ margin: '.2rem 0 0 1rem' }}>
                  {(ficha.partes ?? []).map((p, i) => <li key={i}>{p.papel ? `${p.papel}: ` : ''}{p.nome}{p.estado_civil ? `, ${p.estado_civil}` : ''}{p.cpf ? `, CPF ${p.cpf}` : ''}</li>)}
                </ul>
              </div>
            )}
            {ficha.imovel && (ficha.imovel.descricao || ficha.imovel.endereco || ficha.imovel.matricula) && (
              <p style={{ fontSize: '.88rem' }}><b>Objeto:</b> {ficha.imovel.descricao || '—'}
                {ficha.imovel.empreendimento ? ` · ${ficha.imovel.empreendimento}` : ''}{ficha.imovel.endereco ? ` · ${ficha.imovel.endereco}` : ''}
                {ficha.imovel.matricula ? ` · matrícula ${ficha.imovel.matricula}` : ''}</p>
            )}
            <p className="muted" style={{ fontSize: '.72rem', marginTop: '.6rem' }}>Esses dados serão conferidos pela equipe do cartório antes de qualquer ato.</p>
          </div>
        )}
      </div>
    </div>
  )
}

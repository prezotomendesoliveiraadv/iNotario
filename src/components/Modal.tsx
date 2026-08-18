import { type ReactNode } from 'react'

/**
 * Janela modal simples, usada em dois lugares:
 *  - confirmar o resumo antes de gerar o protocolo (/atender);
 *  - avisar que a edição manual gerou uma nova versão da minuta.
 *
 * Sem dependência externa de propósito: o projeto não usa biblioteca de UI e
 * um modal é pequeno demais para justificar uma.
 */
export default function Modal({
  aberto, titulo, children, onFechar,
  onConfirmar, rotuloConfirmar = 'Confirmar', rotuloCancelar = 'Cancelar',
  confirmando = false, apenasAviso = false,
}: {
  aberto: boolean
  titulo: string
  children: ReactNode
  onFechar: () => void
  onConfirmar?: () => void
  rotuloConfirmar?: string
  rotuloCancelar?: string
  confirmando?: boolean
  apenasAviso?: boolean
}) {
  if (!aberto) return null

  return (
    <div
      onClick={onFechar}
      style={{
        position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(15,23,42,.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#fff', borderRadius: 16, maxWidth: 560, width: '100%',
          maxHeight: '86vh', display: 'flex', flexDirection: 'column',
          boxShadow: '0 24px 60px rgba(0,0,0,.28)', border: '1px solid rgba(0,0,0,.08)',
        }}
      >
        <div style={{ padding: '1rem 1.15rem .6rem', borderBottom: '1px solid rgba(0,0,0,.07)' }}>
          <strong className="font-serif" style={{ color: 'var(--navy)', fontSize: '1.05rem' }}>{titulo}</strong>
        </div>

        <div style={{ padding: '.9rem 1.15rem', overflow: 'auto', fontSize: '.88rem', lineHeight: 1.55 }}>
          {children}
        </div>

        <div style={{ padding: '.75rem 1.15rem 1rem', display: 'flex', gap: '.5rem', justifyContent: 'flex-end',
                      borderTop: '1px solid rgba(0,0,0,.07)' }}>
          {apenasAviso ? (
            <button className="btn-primary" onClick={onFechar}>Entendi</button>
          ) : (
            <>
              <button className="btn-ghost" onClick={onFechar} disabled={confirmando}>{rotuloCancelar}</button>
              <button className="btn-primary" onClick={onConfirmar} disabled={confirmando}>
                {confirmando ? 'Enviando…' : rotuloConfirmar}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

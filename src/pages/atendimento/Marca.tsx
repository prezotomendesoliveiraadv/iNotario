// Cabeçalho de marca do atendimento público. Fica fora do Layout autenticado
// de propósito: /atender é acessado por quem ainda não tem login no cartório.
export default function Marca() {
  return (
    <div style={{ background: 'var(--navy)', color: '#fff', padding: '1rem 1.25rem', borderBottom: '2px solid var(--brass)' }}>
      <div className="font-serif" style={{ fontWeight: 700, fontSize: '1.35rem' }}>iNotário</div>
      <div style={{ fontSize: '.62rem', letterSpacing: '.2em', color: 'var(--brass)' }}>ATENDIMENTO · ARTEMIS</div>
    </div>
  )
}

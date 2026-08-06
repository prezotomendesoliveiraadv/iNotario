import { useEffect, useState } from 'react'

export interface Passo {
  id: string
  rotulo: string
  numero?: number
  pronto?: boolean
  alerta?: boolean
}

/**
 * Barra de passos da tela do ato.
 * A tela cresceu para mais de dez blocos; sem uma trilha visível o escrevente
 * perde o fio da meada. Aqui ele vê a ordem do trabalho, o que já está pronto
 * e salta direto para o bloco que precisa.
 */
export default function NavPassos({ passos }: { passos: Passo[] }) {
  const [ativo, setAtivo] = useState<string>(passos[0]?.id ?? '')

  useEffect(() => {
    const alvos = passos.map(p => document.getElementById(p.id)).filter(Boolean) as HTMLElement[]
    if (!alvos.length) return
    const obs = new IntersectionObserver(
      entradas => {
        const visivel = entradas.filter(e => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
        if (visivel) setAtivo(visivel.target.id)
      },
      { rootMargin: '-20% 0px -70% 0px', threshold: 0 },
    )
    alvos.forEach(a => obs.observe(a))
    return () => obs.disconnect()
  }, [passos.map(p => p.id).join('|')])

  function ir(id: string) {
    const el = document.getElementById(id)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setAtivo(id)
  }

  return (
    <nav className="nav-passos">
      {passos.map(p => {
        const atual = ativo === p.id
        return (
          <button key={p.id} onClick={() => ir(p.id)}
            className={`nav-passo ${atual ? 'atual' : ''} ${p.pronto ? 'pronto' : ''}`}
            title={p.rotulo}>
            <span className="nav-passo-marca">
              {p.alerta ? '!' : p.pronto ? '✓' : (p.numero ?? '·')}
            </span>
            <span className="nav-passo-rotulo">{p.rotulo}</span>
          </button>
        )
      })}
    </nav>
  )
}

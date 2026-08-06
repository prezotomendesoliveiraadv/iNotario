import { useEffect, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { STATUS_LABEL, type StatusSolicitacao } from '../lib/types'

// ----- StatusBadge --------------------------------------------------------
const STATUS_COLORS: Record<StatusSolicitacao, string> = {
  rascunho:      'bg-gray-100 text-gray-600',
  recebida:      'bg-blue-50 text-blue-700',
  em_elaboracao: 'bg-amber-50 text-amber-700',
  em_revisao:    'bg-purple-50 text-purple-700',
  aprovada:      'bg-emerald-50 text-emerald-700',
  concluida:     'bg-navy text-white',
  cancelada:     'bg-red-50 text-red-700',
}

export function StatusBadge({ status }: { status: StatusSolicitacao }) {
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_COLORS[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  )
}

// ----- Layout -------------------------------------------------------------
// Navegação por papel: cada função enxerga o que lhe compete. O Tabelião
// Oficial detém a fé pública e vê tudo; o Financeiro não abre atos novos.
interface ItemNav { to: string; label: string; papeis?: string[] }
const NAV: ItemNav[] = [
  { to: '/',       label: 'Cockpit' },
  { to: '/nova',   label: 'Nova solicitação', papeis: ['escrevente', 'tabeliao_substituto', 'tabeliao_oficial', 'tabeliao'] },
  { to: '/agendamentos', label: 'Agenda de assinaturas' },
  { to: '/acervo', label: 'Acervo' },
  { to: '/admin-cartorio', label: 'Usuários e acessos', papeis: ['admin_cartorio', 'tabeliao_oficial', 'tabeliao'] },
  { to: '/painel-construtoras', label: 'Painel construtoras', papeis: ['escrevente', 'tabeliao_substituto', 'tabeliao_oficial', 'tabeliao'] },
  { to: '/construtoras', label: 'Construtoras', papeis: ['escrevente', 'tabeliao_substituto', 'tabeliao_oficial', 'tabeliao'] },
  { to: '/juridico', label: 'Consulta jurídica', papeis: ['escrevente', 'tabeliao_substituto', 'tabeliao_oficial', 'tabeliao'] },
  { to: '/uso',    label: 'Uso e faturamento', papeis: ['financeiro', 'tabeliao_oficial', 'tabeliao', 'admin_plataforma'] },
]

const PAPEL_NOME: Record<string, string> = {
  admin_cartorio: 'Administrador do cartório', conferente: 'Conferente',
  escrevente: 'Escrevente', tabeliao_substituto: 'Tabelião Substituto', financeiro: 'Financeiro',
  tabeliao_oficial: 'Tabelião Oficial', tabeliao: 'Tabelião Oficial', admin_plataforma: 'Admin da plataforma',
}

export function Layout({ children, title }: { children: ReactNode; title?: string }) {
  const { profile, signOut } = useAuth()
  const loc = useLocation()
  const nav = useNavigate()
  const [menuAberto, setMenuAberto] = useState(false)
  const papel = (profile as any)?.papel ?? ''
  const base = NAV.filter(n => !n.papeis || n.papeis.includes(papel))
  const itens: ItemNav[] = papel === 'admin_plataforma'
    ? [...base, { to: '/admin', label: 'Admin da plataforma' }]
    : base

  // Fecha a gaveta ao navegar — no celular ela cobre a tela inteira.
  useEffect(() => { setMenuAberto(false) }, [loc.pathname])

  const menu = (
    <>
      <div className="px-5 py-5 border-b border-white/10">
        <div className="font-serif text-2xl font-bold tracking-tight">iNotário</div>
        <div className="text-[11px] text-brass-light tracking-wide">INTELIGÊNCIA NOTARIAL</div>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {itens.map((n) => {
          const active = loc.pathname === n.to
          return (
            <Link key={n.to} to={n.to}
              className={`block rounded-lg px-3 py-2 text-sm font-medium transition ${
                active ? 'bg-white/10 text-white' : 'text-white/70 hover:bg-white/5 hover:text-white'
              }`}>
              {n.label}
            </Link>
          )
        })}
      </nav>
      <div className="px-4 py-4 border-t border-white/10 text-sm">
        <div className="font-semibold truncate">{profile?.nome || 'Usuário'}</div>
        <div className="text-brass-light text-[11px] font-medium mb-2">{PAPEL_NOME[papel] ?? papel}</div>
        <button onClick={() => { signOut(); nav('/login') }}
          className="text-xs text-brass-light hover:underline">Sair</button>
      </div>
    </>
  )

  return (
    <div className="min-h-screen app-shell">
      {/* Barra superior — só no celular */}
      <header className="app-topbar">
        <button aria-label="Abrir menu" className="app-burger" onClick={() => setMenuAberto(true)}>
          <span /><span /><span />
        </button>
        <span className="font-serif font-bold">iNotário</span>
        <Link to="/nova" className="app-topbar-acao" aria-label="Nova solicitação">+</Link>
      </header>

      {/* Gaveta no celular, coluna fixa no desktop */}
      <aside className={`app-nav bg-navy text-white flex flex-col ${menuAberto ? 'aberto' : ''}`}>
        {menu}
      </aside>
      {menuAberto && <div className="app-overlay" onClick={() => setMenuAberto(false)} />}

      <main className="flex-1 overflow-auto min-w-0">
        <div className="app-conteudo">
          {title && <h1 className="font-serif text-2xl font-bold text-navy mb-5">{title}</h1>}
          {children}
        </div>
      </main>
    </div>
  )
}

// ----- ProtectedRoute -----------------------------------------------------
import { Navigate } from 'react-router-dom'

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { session, profile, loading } = useAuth()
  const local = useLocation()
  if (loading) {
    return <div className="min-h-screen grid place-items-center text-ink/50">Carregando…</div>
  }
  if (!session) return <Navigate to="/login" replace />
  // Usuário da construtora não é equipe do cartório: só enxerga o próprio portal.
  const ehConstrutora = (profile as any)?.papel === 'construtora'
  if (ehConstrutora && local.pathname !== '/construtora') return <Navigate to="/construtora" replace />
  if (!ehConstrutora && local.pathname === '/construtora') return <Navigate to="/" replace />
  return <>{children}</>
}

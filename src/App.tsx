import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { ProtectedRoute } from './components/ui'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import NovaSolicitacao from './pages/NovaSolicitacao'
import SolicitacaoDetalhe from './pages/SolicitacaoDetalhe'
import Acervo from './pages/Acervo'
import ConsultaJuridica from './pages/ConsultaJuridica'
import Construtoras from './pages/Construtoras'
import PainelConstrutoras from './pages/PainelConstrutoras'
import AdminCartorio from './pages/AdminCartorio'
import Agendamentos from './pages/Agendamentos'
import PortalConstrutora from './pages/PortalConstrutora'
import PortalCliente from './pages/PortalCliente'
import PortalAtendimento from './pages/PortalAtendimento'
import AcompanharDemanda from './pages/AcompanharDemanda'
import UsoCartorio from './pages/UsoCartorio'
import AdminPlataforma from './pages/AdminPlataforma'

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/c/:token" element={<PortalCliente />} />
          <Route path="/atender" element={<PortalAtendimento />} />
          <Route path="/acompanhar" element={<AcompanharDemanda />} />
          <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
          <Route path="/nova" element={<ProtectedRoute><NovaSolicitacao /></ProtectedRoute>} />
          <Route path="/acervo" element={<ProtectedRoute><Acervo /></ProtectedRoute>} />
          <Route path="/agendamentos" element={<ProtectedRoute><Agendamentos /></ProtectedRoute>} />
          <Route path="/admin-cartorio" element={<ProtectedRoute><AdminCartorio /></ProtectedRoute>} />
          <Route path="/painel-construtoras" element={<ProtectedRoute><PainelConstrutoras /></ProtectedRoute>} />
          <Route path="/construtora" element={<ProtectedRoute><PortalConstrutora /></ProtectedRoute>} />

          <Route path="/juridico" element={<ProtectedRoute><ConsultaJuridica /></ProtectedRoute>} />


          <Route path="/construtoras" element={<ProtectedRoute><Construtoras /></ProtectedRoute>} />
          <Route path="/uso" element={<ProtectedRoute><UsoCartorio /></ProtectedRoute>} />
          <Route path="/admin" element={<ProtectedRoute><AdminPlataforma /></ProtectedRoute>} />
          <Route path="/s/:id" element={<ProtectedRoute><SolicitacaoDetalhe /></ProtectedRoute>} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}

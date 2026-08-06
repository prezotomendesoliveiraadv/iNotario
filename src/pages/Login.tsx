import { useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function Login() {
  const [modo, setModo] = useState<'login' | 'cadastro'>('login')
  const [nome, setNome] = useState('')
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const nav = useNavigate()

  async function submit(e: FormEvent) {
    e.preventDefault()
    setErro(null); setMsg(null); setLoading(true)
    try {
      if (modo === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password: senha })
        if (error) throw error
        nav('/')
      } else {
        const { error } = await supabase.auth.signUp({
          email, password: senha, options: { data: { nome } },
        })
        if (error) throw error
        setMsg('Conta criada. Se a confirmação por e-mail estiver ativa, confirme antes de entrar.')
        setModo('login')
      }
    } catch (e: any) {
      setErro(e.message ?? 'Falha na autenticação.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      {/* painel de marca */}
      <div className="hidden lg:flex flex-col justify-between bg-navy text-white p-12">
        <div>
          <div className="font-serif text-4xl font-bold">iNotário</div>
          <div className="text-brass-light text-sm tracking-widest mt-1">INTELIGÊNCIA NOTARIAL</div>
        </div>
        <div>
          <p className="font-serif text-2xl leading-snug">
            A IA que <span className="text-brass-light">lavra e qualifica</span> escrituras públicas
            — com fé pública preservada.
          </p>
          <p className="text-white/50 text-sm mt-4">
            Criação e validação de minutas, dashboard do cartório e cadeia de custódia auditável.
          </p>
        </div>
        <div className="text-white/40 text-xs">Uma solução iAdvoga · motor Artemis</div>
      </div>

      {/* formulário */}
      <div className="flex items-center justify-center p-8 bg-paper">
        <form onSubmit={submit} className="card w-full max-w-sm p-7">
          <h1 className="font-serif text-2xl font-bold text-navy mb-1">
            {modo === 'login' ? 'Entrar' : 'Criar conta'}
          </h1>
          <p className="text-ink/60 text-sm mb-5">
            {modo === 'login' ? 'Acesse o painel do cartório.' : 'Cadastre-se para começar.'}
          </p>

          {modo === 'cadastro' && (
            <div className="mb-3">
              <label className="label">Nome completo</label>
              <input className="input" value={nome} onChange={(e) => setNome(e.target.value)} required />
            </div>
          )}
          <div className="mb-3">
            <label className="label">E-mail</label>
            <input type="email" className="input" value={email}
              onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="mb-4">
            <label className="label">Senha</label>
            <input type="password" className="input" value={senha}
              onChange={(e) => setSenha(e.target.value)} required minLength={6} />
          </div>

          {erro && <div className="mb-3 text-sm text-red-600">{erro}</div>}
          {msg && <div className="mb-3 text-sm text-emerald-700">{msg}</div>}

          <button type="submit" className="btn-primary w-full" disabled={loading}>
            {loading ? 'Aguarde…' : modo === 'login' ? 'Entrar' : 'Cadastrar'}
          </button>

          <button type="button" onClick={() => setModo(modo === 'login' ? 'cadastro' : 'login')}
            className="mt-4 text-sm text-navy hover:underline w-full text-center">
            {modo === 'login' ? 'Não tem conta? Cadastre-se' : 'Já tem conta? Entrar'}
          </button>

          <div className="mt-5 pt-4 border-t border-black/10 text-center">
            <div className="text-ink/50 text-xs mb-2">É cliente do cartório?</div>
            <button type="button" onClick={() => nav('/acompanhar')} className="btn-brass w-full">
              Sou cliente · acompanhar minha solicitação
            </button>
            <button type="button" onClick={() => nav('/atender')}
              className="mt-2 text-xs text-navy hover:underline w-full text-center">
              Quero iniciar uma nova solicitação
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

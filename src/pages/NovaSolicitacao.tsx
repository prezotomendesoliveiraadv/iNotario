import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Layout } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import PartesEditor from '../components/PartesEditor'
import DocumentosInstrucao from '../components/DocumentosInstrucao'
import { formatarWhatsapp, listarPartes, salvarPartes, whatsappMensagem, type ParteRow } from '../lib/melhorias'
import { gerarLinkCliente } from '../lib/acervo'
import type { TipoAto, Solicitacao, CampoSchema } from '../lib/types'

type Fase = 'abertura' | 'instrucao'

export default function NovaSolicitacao() {
  const { profile, session } = useAuth()
  const nav = useNavigate()

  const [fase, setFase] = useState<Fase>('abertura')
  const [tipos, setTipos] = useState<TipoAto[]>([])
  const [tipoId, setTipoId] = useState('')
  const [titulo, setTitulo] = useState('')
  const [contatoNome, setContatoNome] = useState('')
  const [contatoWpp, setContatoWpp] = useState('')

  const [solic, setSolic] = useState<Solicitacao | null>(null)
  const [partes, setPartes] = useState<ParteRow[]>([])
  const [dados, setDados] = useState<Record<string, any>>({})

  const [link, setLink] = useState<string | null>(null)
  const [copiado, setCopiado] = useState(false)
  const [busy, setBusy] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  const tipo = tipos.find((t) => t.id === tipoId)

  useEffect(() => {
    supabase.from('tipos_ato').select('*').eq('ativo', true).order('nome')
      .then(({ data }) => setTipos((data as TipoAto[]) ?? []))
  }, [])

  // ---------- fase 1: cria o protocolo (mínimo necessário) ----------
  async function abrir() {
    if (!tipo) { setErro('Escolha o tipo de ato.'); return }
    if (!profile?.cartorio_id) { setErro('Seu perfil não está vinculado a um cartório.'); return }
    setBusy(true); setErro(null)
    try {
      const { data, error } = await supabase.from('solicitacoes').insert({
        cartorio_id: profile.cartorio_id,
        tipo_ato_id: tipo.id,
        titulo: titulo || tipo.nome,
        dados: {},
        cliente_id: session?.user.id ?? null,
        contato_nome: contatoNome.trim() || null,
        contato_whatsapp: contatoWpp.replace(/\D/g, '') || null,
        status: 'recebida',
      }).select('*').single()
      if (error) throw new Error(error.message)
      const s = data as Solicitacao
      setSolic(s)
      // papéis do tipo entram como esqueleto; a IA ou o escrevente preenchem
      setPartes(tipo.papeis.map((papel, i) => ({ papel, nome: '', cpf_cnpj: '', dados: {}, ordem: i })))
      setFase('instrucao')
    } catch (e: any) { setErro(e.message ?? 'Erro ao abrir.') } finally { setBusy(false) }
  }

  // ---------- recarrega o que a IA gravou a partir dos documentos ----------
  async function recarregar() {
    if (!solic) return
    const [{ data: s }, ps] = await Promise.all([
      supabase.from('solicitacoes').select('*').eq('id', solic.id).single(),
      listarPartes(solic.id),
    ])
    if (s) { setSolic(s as Solicitacao); setDados(((s as any).dados) ?? {}) }
    // MESCLA: o que a IA gravou (tem id, é autoritativo) + os papéis do tipo de
    // ato que ainda ninguém preencheu. Substituir a lista inteira faria os
    // papéis pendentes sumirem da tela logo após aplicar o primeiro documento.
    const papeisNoBanco = new Set(ps.map(x => x.papel))
    const pendentes = (tipo?.papeis ?? [])
      .filter(papel => !papeisNoBanco.has(papel))
      .map((papel, i) => ({ papel, nome: '', cpf_cnpj: '', dados: {}, ordem: ps.length + i } as ParteRow))
    if (ps.length || pendentes.length) setPartes([...ps, ...pendentes])
    setAviso('Dados atualizados a partir dos documentos.')
    setTimeout(() => setAviso(null), 4000)
  }

  async function gerarLink() {
    if (!solic) return
    setBusy(true); setErro(null)
    try { setLink(await gerarLinkCliente(solic.id)) }
    catch (e: any) { setErro(e.message) } finally { setBusy(false) }
  }

  async function enviarLinkWpp() {
    if (!solic || !link) return
    setBusy(true); setErro(null)
    try {
      await whatsappMensagem(solic.id,
        `Olá! Aqui é do cartório, sobre o protocolo ${solic.protocolo}. Para adiantar seu atendimento, preencha seus dados e envie os documentos por este link: ${link}`)
      setAviso('Link enviado pelo WhatsApp.')
      setTimeout(() => setAviso(null), 4000)
    } catch (e: any) { setErro(e.message) } finally { setBusy(false) }
  }

  async function salvarDados() {
    if (!solic) return
    setBusy(true); setErro(null)
    try {
      const { error } = await supabase.from('solicitacoes')
        .update({ dados, titulo: titulo || tipo?.nome }).eq('id', solic.id)
      if (error) throw new Error(error.message)
      await salvarPartes(solic.id, partes.filter(p => p.nome.trim()))
      nav(`/s/${solic.id}`)
    } catch (e: any) { setErro(e.message ?? 'Erro ao salvar.') } finally { setBusy(false) }
  }

  const setCampo = (k: string, v: any) => setDados((d) => ({ ...d, [k]: v }))

  /** Abandonar a abertura não deve deixar protocolo vazio no cartório. */
  async function descartar() {
    if (!solic) return
    if (!confirm(`Descartar o protocolo ${solic.protocolo}? Esta ação não pode ser desfeita.`)) return
    setBusy(true); setErro(null)
    try {
      const { error } = await supabase.from('solicitacoes')
        .update({ status: 'cancelada' }).eq('id', solic.id)
      if (error) throw new Error(error.message)
      nav('/')
    } catch (e: any) { setErro(e.message) } finally { setBusy(false) }
  }

  // =========================================================================
  // FASE 1 — abertura
  // =========================================================================
  if (fase === 'abertura') {
    return (
      <Layout>
        <h1 className="font-serif text-3xl font-bold text-navy mb-1">Nova solicitação</h1>
        <p className="text-ink/60 text-sm mb-6">
          Abra o protocolo primeiro. Em seguida você escolhe como instruir o ato:
          anexando os documentos para a IA ler, enviando um link ao solicitante ou preenchendo à mão.
        </p>

        <div className="card p-6 mb-5">
          <label className="label">Tipo de ato</label>
          <select className="input mb-4" value={tipoId} onChange={(e) => setTipoId(e.target.value)}>
            <option value="">Selecione…</option>
            {tipos.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
          </select>
          {tipo?.descricao && <p className="text-sm text-ink/60 -mt-2 mb-4">{tipo.descricao}</p>}

          {tipo && (
            <>
              <label className="label">Título / referência interna</label>
              <input className="input" placeholder={tipo.nome}
                value={titulo} onChange={(e) => setTitulo(e.target.value)} />
            </>
          )}
        </div>

        {tipo && (
          <div className="card p-6 mb-5">
            <h2 className="font-serif text-xl font-bold text-navy mb-1">Contato do solicitante</h2>
            <p className="text-[12px] text-ink/55 mb-3">
              Com o WhatsApp, você já pode mandar o link de preenchimento na próxima tela
              e acionar o cliente durante todo o ato.
            </p>
            <div className="grid md:grid-cols-2 gap-3">
              <div>
                <label className="label">Nome de quem acompanha</label>
                <input className="input" value={contatoNome} onChange={(e) => setContatoNome(e.target.value)} />
              </div>
              <div>
                <label className="label">WhatsApp (com DDD)</label>
                <input className="input" placeholder="(11) 99999-9999"
                  value={formatarWhatsapp(contatoWpp)} onChange={(e) => setContatoWpp(e.target.value)} />
              </div>
            </div>
          </div>
        )}

        {erro && <div className="text-red-600 text-sm mb-3">{erro}</div>}

        <div className="flex gap-3">
          <button className="btn-primary" onClick={abrir} disabled={busy || !tipo}>
            {busy ? 'Abrindo…' : 'Abrir protocolo e continuar →'}
          </button>
          <button className="btn-ghost" onClick={() => nav('/')}>Cancelar</button>
        </div>
      </Layout>
    )
  }

  // =========================================================================
  // FASE 2 — instrução (documentos · link · preenchimento)
  // =========================================================================
  return (
    <Layout>
      <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
        <div>
          <div className="text-[11px] font-semibold tracking-[.14em] text-brass uppercase">Protocolo aberto</div>
          <h1 className="font-serif text-2xl font-bold text-navy leading-tight">
            {tipo?.nome} <span className="font-mono text-base text-ink/50">{solic?.protocolo}</span>
          </h1>
          <p className="text-sm text-ink/60">Escolha por onde começar — os três caminhos se somam.</p>
        </div>
        <button className="btn-ghost" onClick={() => nav(`/s/${solic!.id}`)}>Ir para o ato →</button>
      </div>

      {aviso && <div className="text-sm text-emerald-700 mb-3">{aviso}</div>}
      {erro && <div className="text-sm text-red-600 mb-3">{erro}</div>}

      {/* Caminho A — documentos já em mãos */}
      <div className="flex items-center gap-2 mb-2">
        <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-navy text-white text-xs font-bold">A</span>
        <span className="text-[11px] font-semibold tracking-[.14em] text-brass uppercase">Já tem os documentos?</span>
        <span className="text-[12px] text-ink/50">— anexe agora e a IA preenche as partes e os dados.</span>
      </div>
      {solic && tipo && (
        <DocumentosInstrucao
          solicitacao={solic}
          tipo={tipo}
          partes={partes as any}
          onApplied={recarregar}
        />
      )}

      {/* Caminho B — o cliente preenche */}
      <div className="flex items-center gap-2 mb-2 mt-6">
        <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-navy text-white text-xs font-bold">B</span>
        <span className="text-[11px] font-semibold tracking-[.14em] text-brass uppercase">Prefere que o cliente preencha?</span>
      </div>
      <div className="card p-5 mb-6">
        <p className="text-[13px] text-ink/65 mb-3">
          Envie um link seguro para o solicitante informar os dados e anexar os documentos.
          O que ele enviar cai direto neste protocolo.
        </p>
        {!link ? (
          <button className="btn-brass" onClick={gerarLink} disabled={busy}>
            {busy ? 'Gerando…' : 'Gerar link do solicitante'}
          </button>
        ) : (
          <div className="space-y-2">
            <div className="flex gap-2 items-center flex-wrap">
              <input className="input flex-1" style={{ minWidth: 240 }} readOnly value={link}
                onFocus={(e) => e.currentTarget.select()} />
              <button className="btn-ghost" onClick={() => {
                navigator.clipboard?.writeText(link); setCopiado(true); setTimeout(() => setCopiado(false), 2000)
              }}>{copiado ? 'copiado ✓' : 'copiar'}</button>
            </div>
            {solic?.contato_whatsapp ? (
              <button className="btn-primary" onClick={enviarLinkWpp} disabled={busy}>
                Enviar por WhatsApp para {formatarWhatsapp(solic.contato_whatsapp)}
              </button>
            ) : (
              <p className="text-[12px] text-ink/50">
                Sem WhatsApp cadastrado — copie o link e envie pelo canal que preferir.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Caminho C — preenchimento pela equipe */}
      <div className="flex items-center gap-2 mb-2">
        <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-navy text-white text-xs font-bold">C</span>
        <span className="text-[11px] font-semibold tracking-[.14em] text-brass uppercase">Partes e dados do ato</span>
        <span className="text-[12px] text-ink/50">— confira o que a IA trouxe ou preencha à mão.</span>
      </div>

      <div className="card p-6 mb-5">
        <h2 className="font-serif text-xl font-bold text-navy mb-1">Partes</h2>
        <p className="text-[12px] text-ink/55 mb-3">
          Inclua quantas pessoas houver em cada papel (dois vendedores, três compradores, anuentes…).
        </p>
        <PartesEditor partes={partes} papeisSugeridos={tipo?.papeis ?? []} onChange={setPartes} />
      </div>

      {tipo && tipo.schema_campos?.length > 0 && (
        <div className="card p-6 mb-5">
          <h2 className="font-serif text-xl font-bold text-navy mb-4">Dados do ato</h2>
          <div className="grid md:grid-cols-2 gap-4">
            {tipo.schema_campos.map((c: CampoSchema) => (
              <div key={c.key} className={c.type === 'textarea' ? 'md:col-span-2' : ''}>
                <label className="label">{c.label}{c.required && ' *'}</label>
                {c.type === 'textarea' ? (
                  <textarea className="input min-h-[80px]" value={dados[c.key] || ''}
                    onChange={(e) => setCampo(c.key, e.target.value)} />
                ) : c.type === 'select' ? (
                  <select className="input" value={dados[c.key] || ''} onChange={(e) => setCampo(c.key, e.target.value)}>
                    <option value="">Selecione…</option>
                    {(c.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : (
                  <input className="input" type={c.type === 'number' ? 'number' : c.type === 'date' ? 'date' : 'text'}
                    value={dados[c.key] || ''} onChange={(e) => setCampo(c.key, e.target.value)} />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-3">
        <button className="btn-primary" onClick={salvarDados} disabled={busy}>
          {busy ? 'Salvando…' : 'Salvar e abrir o ato →'}
        </button>
        <button className="btn-ghost" onClick={() => nav(`/s/${solic!.id}`)}>Deixar para depois</button>
        <button className="btn-ghost" style={{ marginLeft: 'auto', color: '#B3261E' }}
          onClick={descartar} disabled={busy}>Descartar protocolo</button>
      </div>
    </Layout>
  )
}

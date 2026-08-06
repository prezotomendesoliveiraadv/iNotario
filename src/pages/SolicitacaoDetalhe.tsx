import { useEffect, useState } from 'react'
import { dataCurta, dataHora } from '../lib/tempo'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Layout, StatusBadge } from '../components/ui'
import { processarMinuta } from '../lib/minutaEngine'
import ArtemisPanel from '../components/ArtemisPanel'
import DocumentosInstrucao from '../components/DocumentosInstrucao'
import WorkflowCard from '../components/WorkflowCard'
import PreQualRegistralCard from '../components/PreQualRegistralCard'
import ConsultaJuridicaCard from '../components/ConsultaJuridicaCard'
import ContatoCliente from '../components/ContatoCliente'
import VencimentosCard from '../components/VencimentosCard'
import EmpreendimentoPicker from '../components/EmpreendimentoPicker'
import ClausulasEspeciaisCard from '../components/ClausulasEspeciaisCard'
import ValidacaoConstrutoraCard from '../components/ValidacaoConstrutoraCard'
import TarefasCard from '../components/TarefasCard'
import NavPassos, { type Passo } from '../components/NavPassos'
import { meuPapel } from '../lib/workflow'
import {
  gerarLinkCliente, listarUploadsCliente, urlUploadCliente,
  rodarTriagem, ultimaTriagem, type UploadCliente, type TriagemResultado,
} from '../lib/acervo'
import {
  STATUS_LABEL, STATUS_ORDEM,
  type Solicitacao, type Parte, type Minuta, type CustodiaEntry,
  type TipoAto, type ItemStatus, type StatusSolicitacao,
} from '../lib/types'

function waDigits(s: string) { const d = (s || '').replace(/\D/g, ''); return d.startsWith('55') ? d : '55' + d }

const ACAO_LABEL: Record<string, string> = {
  solicitacao_criada: 'Solicitação criada',
  status_alterado: 'Status alterado',
  dados_atualizados: 'Dados atualizados',
  minuta_gerada: 'Minuta gerada',
  ia_pseudonimizada: 'Envio à IA pseudonimizado',
  cliente_devolveu: 'Cliente devolveu (LGPD aceita)',
  triagem_ia: 'Triagem por IA',
  documento_extraido: 'Documento lido pela IA',
  dados_validados: 'Dados validados e aplicados',
  intake_externo: 'Onboarding externo (Artemis)',
  classificado: 'Complexidade classificada',
  financeiro_lancado: 'Emolumentos/impostos lançados',
  financeiro_validado: 'Financeiro validado',
  aprovado: 'Ato aprovado',
  concluido: 'Ato concluído',
  minuta_editada: 'Minuta editada',
  documento_rascunho: 'Rascunho gerado',
  documento_final: 'Documento final gerado',
  whatsapp_enviado: 'Enviado ao WhatsApp',
}

const ITEM_COR: Record<ItemStatus, string> = {
  ok: 'text-emerald-700 bg-emerald-50',
  atencao: 'text-amber-700 bg-amber-50',
  pendente: 'text-red-700 bg-red-50',
}
const ITEM_ICONE: Record<ItemStatus, string> = { ok: '✓', atencao: '!', pendente: '×' }

export default function SolicitacaoDetalhe() {
  const { id } = useParams()
  const nav = useNavigate()
  const [solic, setSolic] = useState<Solicitacao | null>(null)
  const [tipo, setTipo] = useState<TipoAto | null>(null)
  const [partes, setPartes] = useState<Parte[]>([])
  const [minutas, setMinutas] = useState<Minuta[]>([])
  const [custodia, setCustodia] = useState<CustodiaEntry[]>([])
  const [minutaSel, setMinutaSel] = useState<Minuta | null>(null)
  const [loading, setLoading] = useState(true)
  const [gerando, setGerando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [papel, setPapel] = useState<string>('')
  const [avisoMinuta, setAvisoMinuta] = useState<{ versao: number; fonte: string | null } | null>(null)

  // O Financeiro valida guias e emolumentos. Etapas de redação e qualificação
  // são do escrevente e do tabelião — esconder o que não é dele torna a tela
  // objetiva e evita alteração indevida.
  const ehFinanceiro = papel === 'financeiro'
  const verTudo = !ehFinanceiro
  // Trilha de trabalho: o Financeiro vê só o que lhe compete.
  const passos: Passo[] = (ehFinanceiro
    ? [
        { id: 'p-contato', rotulo: 'Solicitante' },
        { id: 'p-docs', rotulo: 'Documentos' },
        { id: 'p-fluxo', rotulo: 'Emolumentos e guias', numero: 1,
          alerta: (solic as any)?.financeiro_status === 'pendente' },
        { id: 'p-tarefas', rotulo: 'Tarefas' },
      ]
    : [
        { id: 'p-contato', rotulo: 'Solicitante' },
        { id: 'p-docs', rotulo: 'Documentos', numero: 1, pronto: true },
        { id: 'p-partes', rotulo: 'Partes e dados', numero: 2, pronto: partes.length > 0 },
        { id: 'p-registro', rotulo: 'Pré-qualificação', numero: 3 },
        { id: 'p-clausulas', rotulo: 'Cláusulas', numero: 4 },
        { id: 'p-minuta', rotulo: 'Minuta', numero: 5, pronto: minutas.length > 0 },
        { id: 'p-construtora', rotulo: 'Construtora' },
        { id: 'p-fluxo', rotulo: 'Fluxo e entrega', numero: 6 },
        { id: 'p-tarefas', rotulo: 'Tarefas' },
      ]).filter(x => !!x)


  const [mostrarArtemis, setMostrarArtemis] = useState(false)
  const [linkCliente, setLinkCliente] = useState<string | null>(null)
  const [uploadsCliente, setUploadsCliente] = useState<UploadCliente[]>([])
  const [triagem, setTriagem] = useState<TriagemResultado | null>(null)
  const [rodandoTriagem, setRodandoTriagem] = useState(false)

  async function carregar() {
    setLoading(true)
    const { data: s } = await supabase
      .from('solicitacoes').select('*, tipos_ato(*)').eq('id', id).maybeSingle()
    setSolic(s as Solicitacao)
    setTipo((s as any)?.tipos_ato ?? null)

    const { data: ps } = await supabase
      .from('partes').select('*').eq('solicitacao_id', id).order('created_at')
    setPartes((ps as Parte[]) ?? [])

    const { data: ms } = await supabase
      .from('minutas').select('*').eq('solicitacao_id', id).order('versao', { ascending: false })
    const lista = (ms as Minuta[]) ?? []
    setMinutas(lista)
    setMinutaSel(lista[0] ?? null)

    const { data: cs } = await supabase
      .from('custodia_log').select('*').eq('solicitacao_id', id).order('id', { ascending: false })
    setCustodia((cs as CustodiaEntry[]) ?? [])
    try { setUploadsCliente(await listarUploadsCliente(id!)) } catch { /* ignore */ }
    try { setTriagem(await ultimaTriagem(id!)) } catch { /* ignore */ }
    setLoading(false)
  }

  useEffect(() => { if (id) carregar() }, [id])
  useEffect(() => { meuPapel().then(setPapel).catch(() => {}) }, [])

  async function gerarMinuta(tipoMinuta: 'provisoria' | 'definitiva') {
    if (!solic || !tipo) return
    setGerando(true); setErro(null)
    try {
      const { conteudo, qualificacao, hash } = await processarMinuta(tipo, solic.dados, partes)
      const proxVersao = (minutas[0]?.versao ?? 0) + 1
      const { error } = await supabase.from('minutas').insert({
        solicitacao_id: solic.id,
        versao: proxVersao,
        tipo: tipoMinuta,
        conteudo,
        hash,
        qualificacao,
      })
      if (error) throw error

      // avança status conforme o tipo de minuta
      const novoStatus: StatusSolicitacao = tipoMinuta === 'definitiva' ? 'aprovada' : 'em_elaboracao'
      if (solic.status !== novoStatus && solic.status !== 'concluida') {
        await supabase.from('solicitacoes').update({ status: novoStatus }).eq('id', solic.id)
      }
      await carregar()
    } catch (e: any) {
      setErro(e.message ?? 'Falha ao gerar minuta.')
    } finally {
      setGerando(false)
    }
  }

  async function mudarStatus(novo: StatusSolicitacao) {
    if (!solic) return
    await supabase.from('solicitacoes').update({ status: novo }).eq('id', solic.id)
    await carregar()
  }

  async function criarLink() {
    try { setLinkCliente(await gerarLinkCliente(solic!.id)) }
    catch (e: any) { setErro(e.message) }
  }
  async function triar() {
    setRodandoTriagem(true); setErro(null)
    try { setTriagem(await rodarTriagem(solic!.id)); await carregar() }
    catch (e: any) { setErro(e.message ?? 'Falha na triagem.') }
    finally { setRodandoTriagem(false) }
  }
  async function abrirUpload(path: string) {
    const url = await urlUploadCliente(path); if (url) window.open(url, '_blank')
  }

  if (loading) return <Layout><div className="text-ink/50">Carregando…</div></Layout>
  if (!solic) return <Layout><div className="text-ink/50">Solicitação não encontrada.</div></Layout>

  return (
    <Layout>
      <button onClick={() => nav('/')} className="text-sm text-navy hover:underline mb-3">← Voltar</button>

      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="font-mono text-xs text-ink/50">{solic.protocolo}</div>
          <h1 className="font-serif text-3xl font-bold text-navy">{tipo?.nome}</h1>
          <p className="text-ink/60 text-sm">{solic.titulo}</p>
        </div>
        <div className="text-right">
          <StatusBadge status={solic.status} />
          <div className="mt-2">
            <select className="input w-auto py-1 text-xs"
              value={solic.status} onChange={(e) => mudarStatus(e.target.value as StatusSolicitacao)}>
              {(['recebida','em_elaboracao','em_revisao','aprovada','concluida','cancelada'] as StatusSolicitacao[])
                .map((st) => <option key={st} value={st}>{STATUS_LABEL[st]}</option>)}
            </select>
          </div>
        </div>
      </div>

      <NavPassos passos={passos} />

      {/* Contato do solicitante — acionamento direto por WhatsApp */}
      <div id="p-contato" />
      <ContatoCliente
        solicitacaoId={solic.id}
        protocolo={solic.protocolo}
        nome={(solic as any).contato_nome ?? null}
        whatsapp={(solic as any).contato_whatsapp ?? null}
        onSalvo={() => carregar()}
      />

      {/* Vigência: documento vencido é exigência certa — aparece antes de tudo */}
      <VencimentosCard solicitacaoId={solic.id} />

      {/* Venda de construtora: vincula empreendimento/unidade e qualifica a vendedora */}
      <EmpreendimentoPicker
        solicitacaoId={solic.id}
        empreendimentoAtual={(solic as any).empreendimento_id}
        unidadeAtual={(solic as any).unidade}
        onVinculado={() => carregar()}
      />

      <div id="p-docs" />
      {/* PASSO 1 — leitura dos documentos pela IA (entrada do escrevente) */}
      <div className="flex items-center gap-2 mb-2">
        <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-navy text-white text-xs font-bold">1</span>
        <span className="text-[11px] font-semibold tracking-[.14em] text-brass uppercase">Leitura dos documentos</span>
        <span className="text-[12px] text-ink/50">— a IA lê e pré-preenche; a conferência é sua.</span>
      </div>
      {/* Documentos de instrução + preenchimento por IA */}
      {tipo && (
        <DocumentosInstrucao
          solicitacao={solic}
          tipo={tipo}
          partes={partes}
          onApplied={() => carregar()}
        />
      )}

      <div id="p-partes" />
      {/* PASSO 2 — conferência das partes e dados do ato */}
      <div className="flex items-center gap-2 mb-2">
        <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-navy text-white text-xs font-bold">2</span>
        <span className="text-[11px] font-semibold tracking-[.14em] text-brass uppercase">Partes e dados do ato</span>
      </div>

      {/* Partes + dados */}
      <div className="grid md:grid-cols-2 gap-5 mb-6">
        <div className="card p-5">
          <h2 className="font-semibold text-navy mb-3">Partes</h2>
          {partes.length === 0 ? <p className="text-sm text-ink/50">Nenhuma parte cadastrada.</p> :
            <ul className="space-y-3">
              {partes.map((p) => (
                <li key={p.id} className="text-sm">
                  <div className="text-xs text-brass font-semibold uppercase">{p.papel}</div>
                  <div className="font-medium">{p.nome}</div>
                  <div className="text-ink/50 text-xs">
                    {[p.cpf_cnpj, p.dados?.estado_civil, p.dados?.regime_bens].filter(Boolean).join(' · ')}
                  </div>
                </li>
              ))}
            </ul>}
        </div>
        <div className="card p-5">
          <h2 className="font-semibold text-navy mb-3">Dados do ato</h2>
          <dl className="space-y-1.5 text-sm">
            {tipo?.schema_campos.map((c) => (
              <div key={c.key} className="flex justify-between gap-3">
                <dt className="text-ink/50">{c.label}</dt>
                <dd className="text-right font-medium">{String(solic.dados?.[c.key] ?? '—')}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>

      {/* Ações Artemis */}
      <div className="card p-5 mb-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="font-serif text-xl font-bold text-navy">Motor Artemis</h2>
            <p className="text-ink/60 text-sm">Geração rápida (regras) ou assistente conversacional com IA, por texto ou voz.</p>
          </div>
          <div className="flex gap-2">
            <button className="btn-ghost" onClick={() => gerarMinuta('provisoria')} disabled={gerando}>
              {gerando ? 'Gerando…' : 'Geração rápida'}
            </button>
            <button className="btn-primary" onClick={() => setMostrarArtemis(v => !v)}>
              {mostrarArtemis ? 'Fechar assistente' : 'Abrir assistente (IA)'}
            </button>
          </div>
        </div>
        {erro && <div className="mt-3 text-sm text-red-600">{erro}</div>}
      </div>

      {mostrarArtemis && tipo && (
        <ArtemisPanel
          solicitacao={solic}
          tipo={tipo}
          partes={partes}
          onCompiled={() => carregar()}
        />
      )}

      {/* Solicitante externo (onboarding por IA) */}
      {solic.origem === 'externa' && (
        <div className="card p-5 mb-6" style={{ borderLeft: '3px solid var(--brass)' }}>
          <div className="flex items-start justify-between flex-wrap gap-3">
            <div>
              <span className="badge bg-brass text-navy">Demanda externa</span>
              <h2 className="font-semibold text-navy mt-1">Solicitante</h2>
              <div className="text-sm text-ink/80">{solic.contato_nome || '—'}{solic.contato_email ? ` · ${solic.contato_email}` : ''}</div>
              <div className="text-sm text-ink/60">WhatsApp: {solic.contato_whatsapp || '—'}</div>
            </div>
            {solic.contato_whatsapp && (
              <a className="btn-primary" target="_blank" rel="noreferrer"
                href={`https://wa.me/${waDigits(solic.contato_whatsapp)}?text=${encodeURIComponent(`Olá! Sobre a sua solicitação no cartório (protocolo ${solic.protocolo}).`)}`}>
                Falar no WhatsApp
              </a>
            )}
          </div>
          {solic.intake && (
            <div className="mt-3 text-sm text-ink/80 space-y-1">
              {solic.intake.resumo && <p><b>Resumo:</b> {solic.intake.resumo}</p>}
              {solic.intake.empreendimento && <p><b>Empreendimento:</b> {solic.intake.empreendimento}</p>}
              {solic.intake.endereco && <p><b>Endereço:</b> {solic.intake.endereco}</p>}
              {solic.intake.construtora && <p><b>Construtora:</b> {solic.intake.construtora}</p>}
            </div>
          )}
        </div>
      )}

      <div id="p-fluxo" />
      {/* Workflow interno do cartório */}
      <WorkflowCard solic={solic} onChange={() => carregar()} />

      <div id="p-registro" />
{verTudo && (<>
      {/* Pré-qualificação registral */}
      <PreQualRegistralCard solicitacaoId={solic.id} />
</>)}

{verTudo && (<>
      {/* Consulta jurídica: acervo do cartório × legislação notarial */}
      <ConsultaJuridicaCard solicitacaoId={solic.id} />
</>)}

      <div id="p-clausulas" />
{verTudo && (<>
      {/* Cláusulas especiais do acervo (retrovenda, reversão, perempção…) */}
      <ClausulasEspeciaisCard solicitacaoId={solic.id} tipoAtoSlug={tipo?.slug}
        onMinutaAtualizada={async (r) => {
          await carregar()                       // recarrega as versões da minuta
          setAvisoMinuta(r)                      // pop-up com o número da versão
          setTimeout(() => {
            const el = document.getElementById('p-minuta')
            el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
          }, 120)
        }} />
</>)}

      <div id="p-tarefas" />
      {/* Tarefas designadas entre a equipe */}
      <TarefasCard solicitacaoId={solic.id} />

      <div id="p-construtora" />
      {/* Fluxo com a construtora: validação jurídica → liberação → agendamento */}
      <ValidacaoConstrutoraCard
        solicitacaoId={solic.id}
        temEmpreendimento={!!(solic as any).empreendimento_id}
        validacao={((solic as any).validacao_construtora ?? 'nao_aplicavel')}
        assinaturaEm={(solic as any).assinatura_em}
        assinaturaLocal={(solic as any).assinatura_local}
        assinaturaStatus={(solic as any).assinatura_status}
        onMudou={() => carregar()}
      />

      {/* Portal do cliente + Triagem por IA */}
      <div className="grid lg:grid-cols-2 gap-5 mb-6">
        <div className="card p-5">
          <h2 className="font-semibold text-navy mb-1">Portal do cliente</h2>
          <p className="text-ink/60 text-xs mb-3">Gere um link para a parte preencher os dados, aceitar a LGPD e enviar documentos.</p>
          <button className="btn-ghost" onClick={criarLink}>Gerar link do cliente</button>
          {linkCliente && (
            <div className="mt-3">
              <input className="input text-xs" readOnly value={linkCliente} onClick={(e) => (e.target as HTMLInputElement).select()} />
              <button className="text-navy text-xs underline mt-1" onClick={() => navigator.clipboard?.writeText(linkCliente!)}>copiar link</button>
            </div>
          )}
          <div className="mt-4">
            <div className="text-xs font-semibold text-ink/70 mb-1">Documentos recebidos</div>
            {uploadsCliente.length === 0 ? <div className="text-ink/50 text-xs">Nenhum documento enviado ainda.</div>
              : <ul className="text-sm space-y-1">
                {uploadsCliente.map(u => (
                  <li key={u.id} className="flex justify-between gap-2">
                    <span className="text-ink/80">{u.tipo_doc.toUpperCase()} · {u.nome_arquivo}</span>
                    <button className="text-navy text-xs underline" onClick={() => abrirUpload(u.storage_path)}>abrir</button>
                  </li>
                ))}
              </ul>}
          </div>
        </div>

        <div className="card p-5">
          <div className="flex items-center justify-between mb-1">
            <h2 className="font-semibold text-navy">Triagem por IA</h2>
            <button className="btn-brass" onClick={triar} disabled={rodandoTriagem}>
              {rodandoTriagem ? 'Analisando…' : 'Rodar triagem'}
            </button>
          </div>
          <p className="text-ink/60 text-xs mb-3">Cruza dados, documentos do cliente e o acervo do cartório para dar andamento.</p>
          {!triagem ? <div className="text-ink/50 text-xs">Sem triagem ainda.</div> : (
            <div className="space-y-3 text-sm">
              {triagem.resumo && <p className="text-ink/80">{triagem.resumo}</p>}
              {triagem.onus && triagem.onus.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-2">
                  <div className="text-xs font-bold text-amber-800 mb-1">⚠ Ônus e gravames na matrícula</div>
                  {triagem.onus.map((o, i) => (
                    <div key={i} className="text-xs text-amber-900">
                      <span className={o.status === 'pendente' ? 'font-bold text-red-700' : 'text-amber-700'}>● </span>
                      {o.item} <span className="text-ink/50">— {o.fundamento}</span>
                    </div>
                  ))}
                </div>
              )}
              {triagem.checklist_documentos && triagem.checklist_documentos.length > 0 && (
                <div><div className="text-xs font-semibold text-ink/70 mb-1">Documentos</div>
                  {triagem.checklist_documentos.map((d, i) => (
                    <div key={i} className="text-xs">
                      <span className={d.status === 'recebido' ? 'text-emerald-700' : d.status === 'faltante' ? 'text-red-700' : 'text-amber-700'}>● </span>
                      {d.documento} <span className="text-ink/50">({d.status}){d.observacao ? ' — ' + d.observacao : ''}</span>
                    </div>
                  ))}
                </div>
              )}
              {triagem.pre_qualificacao && triagem.pre_qualificacao.length > 0 && (
                <div><div className="text-xs font-semibold text-ink/70 mb-1">Pré-qualificação</div>
                  {triagem.pre_qualificacao.map((q, i) => (
                    <div key={i} className="text-xs">
                      <span className={q.status === 'ok' ? 'text-emerald-700' : q.status === 'pendente' ? 'text-red-700' : 'text-amber-700'}>● </span>
                      {q.item} <span className="text-ink/50">— {q.fundamento}</span>
                    </div>
                  ))}
                </div>
              )}
              {triagem.modelos_sugeridos && triagem.modelos_sugeridos.length > 0 && (
                <div className="text-xs"><span className="font-semibold text-ink/70">Modelos sugeridos:</span> {triagem.modelos_sugeridos.join(', ')}</div>
              )}
              {triagem.proximo_passo && (
                <div className="text-xs bg-paper rounded-lg p-2"><span className="font-semibold">Próximo passo:</span> {triagem.proximo_passo}</div>
              )}
            </div>
          )}
        </div>
      </div>

      <div id="p-minuta" />
      {/* Minuta + qualificação */}
      {minutaSel && (
        <div className="grid lg:grid-cols-3 gap-5 mb-6">
          <div className="card p-5 lg:col-span-2">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-navy">
                Minuta v{minutaSel.versao}
                <span className="ml-2 text-xs font-normal text-ink/50 capitalize">({minutaSel.tipo})</span>
              </h2>
              {minutas.length > 1 && (
                <select className="input w-auto py-1 text-xs"
                  value={minutaSel.id}
                  onChange={(e) => setMinutaSel(minutas.find((m) => m.id === e.target.value) ?? null)}>
                  {minutas.map((m) => (
                    <option key={m.id} value={m.id}>v{m.versao} · {m.tipo}</option>
                  ))}
                </select>
              )}
            </div>
            <pre className="whitespace-pre-wrap font-serif text-sm leading-relaxed text-ink bg-paper rounded-lg p-4 max-h-[460px] overflow-auto">
{minutaSel.conteudo}
            </pre>
            <div className="mt-2 text-[11px] text-ink/40 font-mono break-all">
              hash: {minutaSel.hash}
            </div>
          </div>

          <div className="card p-5">
            <h2 className="font-semibold text-navy mb-1">Parecer de qualificação</h2>
            <p className="text-xs text-ink/50 mb-3">Verificações preventivas com fundamento.</p>
            <ul className="space-y-2">
              {minutaSel.qualificacao.map((q, i) => (
                <li key={i} className={`rounded-lg p-2.5 ${ITEM_COR[q.status]}`}>
                  <div className="flex items-start gap-2">
                    <span className="font-bold">{ITEM_ICONE[q.status]}</span>
                    <div>
                      <div className="text-sm font-semibold">{q.item}</div>
                      <div className="text-xs opacity-80">{q.fundamento}</div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Cadeia de custódia */}
      <div className="card p-5">
        <h2 className="font-semibold text-navy mb-1">Cadeia de custódia</h2>
        <p className="text-xs text-ink/50 mb-4">Registro append-only, encadeado por hash. Auditável.</p>
        {custodia.length === 0 ? <p className="text-sm text-ink/50">Sem registros.</p> :
          <ol className="relative border-l border-black/10 ml-2">
            {custodia.map((c) => (
              <li key={c.id} className="mb-5 ml-4">
                <div className="absolute -left-1.5 w-3 h-3 rounded-full bg-brass border border-white" />
                <div className="text-sm font-semibold text-navy">{ACAO_LABEL[c.acao] ?? c.acao}</div>
                <div className="text-xs text-ink/50">
                  {dataHora(new Date(c.created_at))}
                  {c.detalhe?.de && c.detalhe?.para &&
                    ` · ${STATUS_LABEL[c.detalhe.de as StatusSolicitacao] ?? c.detalhe.de} → ${STATUS_LABEL[c.detalhe.para as StatusSolicitacao] ?? c.detalhe.para}`}
                  {c.detalhe?.versao && ` · v${c.detalhe.versao} (${c.detalhe.tipo})`}
                </div>
                <div className="text-[10px] text-ink/35 font-mono break-all mt-0.5">
                  {c.hash_atual.slice(0, 32)}…
                </div>
              </li>
            ))}
          </ol>}
      </div>
      {avisoMinuta && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(14,28,54,.45)', display: 'grid',
                      placeItems: 'center', padding: '1rem', zIndex: 60 }}
             onClick={e => { if (e.target === e.currentTarget) setAvisoMinuta(null) }}>
          <div className="card p-5" style={{ maxWidth: 420, width: '100%' }}>
            <div className="text-[11px] font-semibold tracking-[.14em] text-brass uppercase">Minuta atualizada</div>
            <h2 className="font-serif text-xl font-bold text-navy mt-1">
              Versão {avisoMinuta.versao} gerada
            </h2>
            <p className="text-[13px] text-ink/70 mt-2">
              O texto foi regerado com os dados atuais e as cláusulas especiais selecionadas
              {avisoMinuta.fonte && (
                <>, a partir do {avisoMinuta.fonte === 'empreendimento' ? 'modelo do empreendimento'
                  : avisoMinuta.fonte === 'construtora' ? 'modelo da construtora' : 'modelo padrão do acervo'}</>
              )}. Revise antes de aprovar.
            </p>
            <button className="btn-primary mt-3" autoFocus onClick={() => {
              setAvisoMinuta(null)
              const el = document.getElementById('p-minuta')
              el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }}>Ver a minuta</button>
          </div>
        </div>
      )}
    </Layout>
  )
}

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import FilaDoDia from '../components/FilaDoDia'
import { Layout } from '../components/ui'
import {
  carregarCockpit, competenciaDo, souCompetente, faixaIdade, brl,
  type Cockpit, type ItemFila, type Alerta,
} from '../lib/cockpit'
import { ETAPA_LABEL, PAPEL_LABEL } from '../lib/workflow'
import BuscaSolicitacoes from '../components/BuscaSolicitacoes'
import { minhasTarefas, type Tarefa } from '../lib/administracao'
import { dataExtenso as hojeExtenso, saudacao, dataDoServidor, divergenciaDeData } from '../lib/tempo'

// Sinais funcionais de urgência — sóbrios, na família da marca
const NIVEL_COR = ['#7C8698', '#1E7A4F', '#A9761B', '#B3261E'] // hoje · recente · atenção · crítico

// Data e saudação vêm do fuso do CARTÓRIO, não do aparelho (ver src/lib/tempo.ts)

/* Faixa de competência: a carga de cada etapa e, destacado, onde ESTE usuário
   pode agir. Em cartório a competência é lei — a faixa mostra ao mesmo tempo
   o estado da casa e o lugar de quem olha. */
function FaixaCompetencia({ c }: { c: Cockpit }) {
  const comp = competenciaDo(c.papel)
  const etapas = ['elaboracao', 'financeiro', 'aprovacao', 'finalizacao'] as const
  const total = etapas.reduce((t, e) => t + (c.porEtapa[e] ?? 0), 0)
  const desc: Record<string, string> = {
    elaboracao: 'Escrevente redige e corrige',
    financeiro: 'Confere emolumentos',
    aprovacao: 'Revisão por competência',
    finalizacao: 'Entrega ao cliente',
  }

  return (
    <section className="rounded-xl border border-black/10 bg-white overflow-hidden mb-5">
      <div className="flex items-baseline justify-between px-5 pt-4 pb-3 gap-3 flex-wrap">
        <div>
          <div className="text-[11px] font-semibold tracking-[.14em] text-brass uppercase">Fluxo do cartório</div>
          <div className="text-sm text-ink/60">
            {total} ato{total === 1 ? '' : 's'} em andamento · sua competência está destacada
          </div>
        </div>
        <div className="text-[11px] text-ink/50">Você aprova até: <b className="text-navy">{comp.podeAprovarAte}</b></div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 border-t border-black/10">
        {etapas.map((etapa, i) => {
          const n = c.porEtapa[etapa] ?? 0
          const minha = comp.etapas.includes(etapa)
          return (
            <div key={etapa}
              className={`relative px-5 py-4 ${i > 0 ? 'md:border-l border-black/10' : ''} ${i < 2 ? 'border-b md:border-b-0 border-black/10' : ''} ${i % 2 === 1 ? 'border-l border-black/10 md:border-l' : ''}`}
              style={minha ? { background: 'linear-gradient(180deg,#FBF8F1 0%,#FFFFFF 100%)' } : undefined}>
              {minha && <span className="absolute left-0 top-0 h-full w-[3px] bg-brass" />}
              <div className="flex items-baseline gap-2">
                <span className="font-serif text-3xl font-bold text-navy" style={{ fontVariantNumeric: 'tabular-nums' }}>{n}</span>
                {minha && <span className="text-[10px] font-semibold tracking-wide text-brass uppercase">com você</span>}
              </div>
              <div className="text-sm font-medium text-ink mt-0.5">{ETAPA_LABEL[etapa]}</div>
              <div className="text-[11px] text-ink/45 mt-0.5">{desc[etapa]}</div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function LinhaFila({ s, papel }: { s: ItemFila; papel: string; key?: string }) {
  const idade = faixaIdade(s.diasParado)
  const podeAgir = souCompetente(papel, s.etapa, s.complexidade)
  return (
    <Link to={`/s/${s.id}`}
      className="group flex items-stretch gap-3 rounded-lg border border-black/10 bg-white hover:border-brass hover:shadow-sm transition overflow-hidden">
      <span className="w-[3px] shrink-0" style={{ background: NIVEL_COR[idade.nivel] }} />
      <div className="flex-1 min-w-0 py-2.5 pr-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-[11px] text-ink/55">{s.protocolo ?? '—'}</span>
          {s.exigencia_atual && (
            <span className="text-[10px] font-semibold px-1.5 py-[1px] rounded" style={{ background: '#FBEAE9', color: '#B3261E' }}>EXIGÊNCIA</span>
          )}
          {s.complexidade === 'alta' && <span className="text-[10px] font-semibold px-1.5 py-[1px] rounded bg-navy/10 text-navy">ALTA</span>}
          {s.origem === 'externo' && <span className="text-[10px] px-1.5 py-[1px] rounded bg-brass/15 text-brass">IA</span>}
        </div>
        <div className="text-sm font-medium text-ink truncate mt-0.5 group-hover:text-navy">
          {s.tipo ?? s.titulo ?? 'Solicitação'}
        </div>
        <div className="text-[11px] text-ink/50 mt-0.5">
          {ETAPA_LABEL[s.etapa]} · {s.motivo}
          {!podeAgir && <span> · aguarda {PAPEL_LABEL[s.responsavel_papel] ?? s.responsavel_papel}</span>}
        </div>
      </div>
      <div className="shrink-0 self-center pr-3 text-right">
        <div className="text-sm font-semibold" style={{ color: NIVEL_COR[idade.nivel], fontVariantNumeric: 'tabular-nums' }}>{idade.rotulo}</div>
        {podeAgir && <div className="text-[10px] text-brass font-semibold">sua vez</div>}
      </div>
    </Link>
  )
}

function Metrica({ valor, rotulo, destaque }: { valor: string | number; rotulo: string; destaque?: boolean }) {
  return (
    <div className="px-3 py-2.5 rounded-lg bg-paper">
      <div className={`font-serif text-2xl font-bold ${destaque ? 'text-brass' : 'text-navy'}`} style={{ fontVariantNumeric: 'tabular-nums' }}>{valor}</div>
      <div className="text-[11px] text-ink/55 leading-tight mt-0.5">{rotulo}</div>
    </div>
  )
}

function PainelFuncao({ c }: { c: Cockpit }) {
  const { papel, metricas: m, emCurso } = c
  const comp = competenciaDo(papel)
  const conta = (f: (s: ItemFila) => boolean) => emCurso.filter(f).length

  return (
    <section className="rounded-xl border border-black/10 bg-white p-4">
      <div className="text-[11px] font-semibold tracking-[.14em] text-brass uppercase">Sua função</div>
      <h2 className="font-serif text-lg font-bold text-navy leading-tight">{PAPEL_LABEL[papel] ?? papel}</h2>
      <p className="text-[12px] text-ink/60 leading-snug mt-1">{comp.resumo}</p>

      <div className="grid grid-cols-2 gap-2 mt-3">
        {papel === 'escrevente' && <>
          <Metrica valor={conta(s => !!s.exigencia_atual)} rotulo="Exigências a corrigir" destaque />
          <Metrica valor={conta(s => s.etapa === 'elaboracao')} rotulo="Em elaboração" />
          <Metrica valor={conta(s => s.etapa === 'finalizacao')} rotulo="Prontos para entregar" />
          <Metrica valor={conta(s => s.etapa === 'elaboracao' && !s.complexidade)} rotulo="Sem classificar" />
        </>}
        {papel === 'financeiro' && <>
          <Metrica valor={m.aguardandoFinanceiro} rotulo="Aguardando validação" destaque />
          <Metrica valor={brl(m.valorPendente)} rotulo="Valor a conferir" />
          <Metrica valor={m.concluidosHoje} rotulo="Concluídos hoje" />
          <Metrica valor={m.concluidosMes} rotulo="Concluídos no mês" />
        </>}
        {papel === 'tabeliao_substituto' && <>
          <Metrica valor={conta(s => s.etapa === 'aprovacao' && s.complexidade !== 'alta')} rotulo="Aprovações com você" destaque />
          <Metrica valor={conta(s => s.etapa === 'aprovacao' && s.complexidade === 'alta')} rotulo="Alta — cabe ao Oficial" />
          <Metrica valor={m.concluidosMes} rotulo="Concluídos no mês" />
          <Metrica valor={m.tempoMedioDias ?? '—'} rotulo="Dias, em média, por ato" />
        </>}
        {(papel === 'tabeliao_oficial' || papel === 'tabeliao') && <>
          <Metrica valor={conta(s => s.etapa === 'aprovacao' && s.complexidade === 'alta')} rotulo="Alta complexidade" destaque />
          <Metrica valor={conta(s => s.diasParado > 5)} rotulo="Parados +5 dias" />
          <Metrica valor={m.concluidosMes} rotulo="Concluídos no mês" />
          <Metrica valor={m.tempoMedioDias ?? '—'} rotulo="Dias, em média, por ato" />
        </>}
      </div>

      <div className="mt-3 pt-3 border-t border-black/10 flex items-center justify-between text-[11px] text-ink/55 gap-2">
        <span>Entraram hoje: <b className="text-navy">{m.novasHoje}</b></span>
        <Link to="/uso" className="text-navy hover:underline font-medium">Uso e faturamento →</Link>
      </div>
    </section>
  )
}

const COR_ALERTA: Record<Alerta['tipo'], string> = {
  exigencia: '#B3261E', parado: '#A9761B', financeiro: '#1E3a63', alta: '#7C8698',
}
function Alertas({ itens }: { itens: Alerta[] }) {
  if (!itens.length) return null
  return (
    <section className="rounded-xl border border-black/10 bg-white p-4">
      <div className="text-[11px] font-semibold tracking-[.14em] text-brass uppercase mb-2">Requer atenção</div>
      <ul className="space-y-1.5">
        {itens.map((a, i) => (
          <li key={i} className="flex gap-2 text-[12px] leading-snug">
            <span className="mt-[5px] h-1.5 w-1.5 rounded-full shrink-0" style={{ background: COR_ALERTA[a.tipo] }} />
            <span className="text-ink/75">
              {a.solicitacaoId
                ? <Link to={`/s/${a.solicitacaoId}`} className="hover:underline">
                    <span className="font-mono text-[11px] text-ink/55">{a.protocolo} </span>{a.texto}
                  </Link>
                : a.texto}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

export default function Dashboard() {
  const [c, setC] = useState<Cockpit | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [verTudo, setVerTudo] = useState(false)
  const [buscando, setBuscando] = useState(false)
  const [tarefas, setTarefas] = useState<Tarefa[]>([])
  // O cockpit fica aberto o dia inteiro: sem isto, data e saudação congelam no
  // instante em que a página foi carregada (à meia-noite, mostraria ontem).
  const [agora, setAgora] = useState(() => new Date())
  const [dataDivergente, setDataDivergente] = useState(false)
  useEffect(() => {
    // A data vem do servidor: é a mesma referência usada nos prazos e vigências.
    const sincronizar = () => dataDoServidor().then(d => {
      setAgora(d); setDataDivergente(divergenciaDeData(d))
    }).catch(() => setAgora(new Date()))
    sincronizar()
    const t = setInterval(sincronizar, 60_000)
    const aoVoltar = () => { if (!document.hidden) setAgora(new Date()) }
    document.addEventListener('visibilitychange', aoVoltar)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', aoVoltar) }
  }, [])

  useEffect(() => { carregarCockpit().then(setC).catch(e => setErro(e.message ?? 'Falha ao carregar.')) }, [])
  useEffect(() => { minhasTarefas('abertas').then(setTarefas).catch(() => {}) }, [])

  if (erro) return <Layout><div className="text-sm text-red-600">{erro}</div></Layout>
  if (!c) return <Layout><div className="text-sm text-ink/50">Carregando o cockpit…</div></Layout>

  const primeiro = c.nome?.split(' ')[0] ?? ''
  const comExigencia = c.minhaFila.filter(s => s.exigencia_atual).length
  const lista = verTudo ? c.minhaFila : c.minhaFila.slice(0, 8)
  const ehOficial = c.papel === 'tabeliao_oficial' || c.papel === 'tabeliao'

  return (
    <Layout>
      <header className="mb-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-serif text-2xl font-bold text-navy leading-tight">
              {saudacao(agora)}{primeiro ? `, ${primeiro}` : ''}
            </h1>
            <p className="text-sm text-ink/60 first-letter:uppercase">{hojeExtenso(agora)}</p>
            {dataDivergente && (
              <p className="text-[11px]" style={{ color: '#A9761B' }}>
                O relógio deste computador está em outra data — o sistema está usando a data do cartório.
              </p>
            )}
          </div>
          <div className="text-right">
            <div className="text-sm text-ink/70">
              <b className="text-navy" style={{ fontVariantNumeric: 'tabular-nums' }}>{c.minhaFila.length}</b>
              {ehOficial ? ' ato(s) em andamento' : ' aguardam você'}
              {comExigencia > 0 && <> · <span style={{ color: '#B3261E' }}><b>{comExigencia}</b> com exigência</span></>}
            </div>
            <Link to="/nova" className="btn-brass inline-block mt-1.5">+ Nova solicitação</Link>
          </div>
        </div>
      </header>

      <BuscaSolicitacoes onAtivo={setBuscando} />

      {!buscando && <FaixaCompetencia c={c} />}

      {!buscando && <div className="cockpit-grid grid gap-5">
        {c.cartorioId && <FilaDoDia cartorioId={c.cartorioId} papel={c.papel} />}

        <section>
          <div className="flex items-baseline justify-between mb-2 gap-3">
            <div>
              <div className="text-[11px] font-semibold tracking-[.14em] text-brass uppercase">
                {ehOficial ? 'Fila do cartório' : 'Sua fila'}
              </div>
              <p className="text-[12px] text-ink/55">Exigências primeiro, depois o que espera há mais tempo.</p>
            </div>
            {c.minhaFila.length > 8 && (
              <button className="text-[12px] text-navy hover:underline shrink-0" onClick={() => setVerTudo(v => !v)}>
                {verTudo ? 'ver menos' : `ver todas (${c.minhaFila.length})`}
              </button>
            )}
          </div>

          {lista.length === 0 ? (
            <div className="rounded-xl border border-dashed border-black/20 p-8 text-center">
              <div className="font-serif text-lg text-navy">Nada aguardando você</div>
              <p className="text-[13px] text-ink/55 mt-1">
                Quando um ato chegar à sua competência, ele aparece aqui — os mais urgentes no topo.
              </p>
              <Link to="/nova" className="btn-ghost inline-block mt-3">Abrir uma solicitação</Link>
            </div>
          ) : (
            <div className="space-y-1.5">
              {lista.map(s => <LinhaFila key={s.id} s={s} papel={c.papel} />)}
            </div>
          )}
        </section>

        <div className="space-y-4">
          {tarefas.length > 0 && (
            <section className="rounded-xl border border-black/10 bg-white p-4">
              <div className="text-[11px] font-semibold tracking-[.14em] text-brass uppercase mb-2">
                Tarefas designadas a você ({tarefas.length})
              </div>
              <ul className="space-y-1.5">
                {tarefas.slice(0, 6).map(t => {
                  const d = t.dias_para_prazo
                  const cor = d === null ? '#7C8698' : d < 0 ? '#B3261E' : d <= 2 ? '#A9761B' : '#7C8698'
                  const rot = d === null ? '' : d < 0 ? `atrasada ${Math.abs(d)}d` : d === 0 ? 'hoje' : `em ${d}d`
                  return (
                    <li key={t.id} className="text-[12px] leading-snug">
                      {t.solicitacao_id
                        ? <Link to={`/s/${t.solicitacao_id}`} className="hover:underline">
                            <span className="font-medium text-navy">{t.titulo}</span>
                            <span className="text-ink/45"> · {t.protocolo}</span>
                          </Link>
                        : <span className="font-medium text-navy">{t.titulo}</span>}
                      {rot && <span style={{ color: cor }}> · {rot}</span>}
                    </li>
                  )
                })}
              </ul>
            </section>
          )}

          <PainelFuncao c={c} />
          <Alertas itens={c.alertas} />
        </div>
      </div>}
    </Layout>
  )
}

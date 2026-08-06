// src/lib/cockpit.ts
// Dados do cockpit do cartório: carga por etapa, fila priorizada, alertas e
// o que cada papel PODE fazer (competência legal, não preferência de menu).

import { supabase } from './supabase'
import { meuPapel, ETAPAS_ORDEM, aprovadorPorComplexidade, type Etapa } from './workflow'

export interface ItemFila {
  id: string
  protocolo: string | null
  titulo: string | null
  tipo: string | null
  etapa: string
  responsavel_papel: string
  complexidade: string | null
  exigencia_atual: string | null
  financeiro_status: string
  emolumentos: number | null
  impostos: number | null
  origem: string | null
  atualizado_em: string
  criado_em: string
  // calculados
  diasParado: number
  prioridade: number
  motivo: string
}

export interface Cockpit {
  papel: string
  nome: string
  cartorioNome: string | null
  porEtapa: Record<string, number>
  minhaFila: ItemFila[]
  emCurso: ItemFila[]          // tudo em andamento no cartório (visão de monitoramento)
  alertas: Alerta[]
  metricas: {
    concluidosMes: number
    concluidosHoje: number
    novasHoje: number
    tempoMedioDias: number | null
    aguardandoFinanceiro: number
    valorPendente: number
  }
}

export interface Alerta {
  tipo: 'exigencia' | 'parado' | 'financeiro' | 'alta'
  texto: string
  solicitacaoId?: string
  protocolo?: string | null
}

const DIA = 86400000
export function diasEntre(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / DIA))
}

/** Faixas de envelhecimento — em cartório, o tempo parado é o risco. */
export function faixaIdade(dias: number): { rotulo: string; nivel: 0 | 1 | 2 | 3 } {
  if (dias <= 0) return { rotulo: 'hoje', nivel: 0 }
  if (dias <= 2) return { rotulo: `${dias}d`, nivel: 1 }
  if (dias <= 5) return { rotulo: `${dias}d`, nivel: 2 }
  return { rotulo: `${dias}d`, nivel: 3 }
}

/** Prioridade: exigência pendura o cliente; tempo parado corrói o prazo. */
function calcularPrioridade(r: any, dias: number): { prioridade: number; motivo: string } {
  let p = dias * 10
  let motivo = dias > 5 ? 'parado há mais de 5 dias' : dias > 2 ? 'aguardando há dias' : 'na fila'
  if (r.exigencia_atual) { p += 100; motivo = 'exigência a corrigir' }
  if (r.etapa === 'financeiro' && r.financeiro_status === 'pendente') { p += 20; if (!r.exigencia_atual) motivo = 'pagamento a validar' }
  if (r.complexidade === 'alta') p += 15
  if (r.etapa === 'finalizacao') { p += 25; if (!r.exigencia_atual) motivo = 'pronto para o cliente' }
  return { prioridade: p, motivo }
}

function mapear(r: any): ItemFila {
  const atualizado = r.updated_at ?? r.created_at
  const dias = diasEntre(atualizado)
  const { prioridade, motivo } = calcularPrioridade(r, dias)
  return {
    id: r.id, protocolo: r.protocolo, titulo: r.titulo, tipo: r.tipos_ato?.nome ?? null,
    etapa: r.etapa ?? 'elaboracao', responsavel_papel: r.responsavel_papel ?? 'escrevente',
    complexidade: r.complexidade, exigencia_atual: r.exigencia_atual,
    financeiro_status: r.financeiro_status ?? 'nao_aplicavel',
    emolumentos: r.emolumentos, impostos: r.impostos, origem: r.origem,
    atualizado_em: atualizado, criado_em: r.created_at,
    diasParado: dias, prioridade, motivo,
  }
}

const CAMPOS = `id, protocolo, titulo, etapa, responsavel_papel, complexidade, exigencia_atual,
  financeiro_status, emolumentos, impostos, origem, status, created_at, updated_at, concluida_em,
  tipos_ato(nome)`

export async function carregarCockpit(): Promise<Cockpit> {
  const papel = await meuPapel()
  const { data: u } = await supabase.auth.getUser()
  const { data: prof } = await supabase.from('profiles')
    .select('nome, cartorio_id, cartorios(nome)').eq('id', u!.user!.id).maybeSingle()
  const cartorioId = (prof as any)?.cartorio_id
  const vazio: Cockpit = {
    papel, nome: (prof as any)?.nome ?? '', cartorioNome: (prof as any)?.cartorios?.nome ?? null,
    porEtapa: {}, minhaFila: [], emCurso: [], alertas: [],
    metricas: { concluidosMes: 0, concluidosHoje: 0, novasHoje: 0, tempoMedioDias: null, aguardandoFinanceiro: 0, valorPendente: 0 },
  }
  if (!cartorioId) return vazio

  // Em andamento (base do monitoramento e da fila)
  const { data: abertas } = await supabase.from('solicitacoes').select(CAMPOS)
    .eq('cartorio_id', cartorioId).neq('etapa', 'concluida').neq('status', 'cancelada')
    .order('updated_at', { ascending: true })

  const emCurso = ((abertas as any[]) ?? []).map(mapear)

  // Carga por etapa
  const porEtapa: Record<string, number> = {}
  for (const e of ETAPAS_ORDEM) porEtapa[e] = 0
  for (const s of emCurso) porEtapa[s.etapa] = (porEtapa[s.etapa] ?? 0) + 1

  // Minha fila: onde a competência é minha (o Oficial supervisiona tudo)
  const ehOficial = papel === 'tabeliao_oficial' || papel === 'tabeliao'
  const minhaFila = emCurso
    .filter(s => ehOficial ? true : s.responsavel_papel === papel)
    .sort((a, b) => b.prioridade - a.prioridade)

  // Métricas do mês
  const inicioMes = new Date(); inicioMes.setDate(1); inicioMes.setHours(0, 0, 0, 0)
  const inicioDia = new Date(); inicioDia.setHours(0, 0, 0, 0)
  const { data: conc } = await supabase.from('solicitacoes')
    .select('id, created_at, concluida_em').eq('cartorio_id', cartorioId)
    .gte('concluida_em', inicioMes.toISOString())
  const concl = (conc as any[]) ?? []
  const concluidosHoje = concl.filter(c => c.concluida_em >= inicioDia.toISOString()).length
  const tempos = concl.filter(c => c.created_at && c.concluida_em)
    .map(c => (new Date(c.concluida_em).getTime() - new Date(c.created_at).getTime()) / DIA)
  const tempoMedioDias = tempos.length ? Math.round((tempos.reduce((a, b) => a + b, 0) / tempos.length) * 10) / 10 : null

  const { count: novasHoje } = await supabase.from('solicitacoes')
    .select('id', { count: 'exact', head: true }).eq('cartorio_id', cartorioId)
    .gte('created_at', inicioDia.toISOString())

  const aguardandoFinanceiro = emCurso.filter(s => s.financeiro_status === 'pendente').length
  const valorPendente = emCurso.filter(s => s.financeiro_status === 'pendente')
    .reduce((t, s) => t + Number(s.emolumentos ?? 0) + Number(s.impostos ?? 0), 0)

  // Alertas: o que o cartório precisa enxergar hoje
  const alertas: Alerta[] = []
  for (const s of emCurso.filter(x => x.exigencia_atual).slice(0, 4))
    alertas.push({ tipo: 'exigencia', texto: `Exigência pendente: ${s.exigencia_atual}`, solicitacaoId: s.id, protocolo: s.protocolo })
  for (const s of emCurso.filter(x => x.diasParado > 5).slice(0, 4))
    alertas.push({ tipo: 'parado', texto: `Parado há ${s.diasParado} dias em ${s.etapa}`, solicitacaoId: s.id, protocolo: s.protocolo })
  const semClassificar = emCurso.filter(s => !s.complexidade && s.etapa === 'elaboracao').length
  if (semClassificar > 0)
    alertas.push({ tipo: 'alta', texto: `${semClassificar} ato(s) sem complexidade classificada — o fluxo não avança sem isso` })
  if (aguardandoFinanceiro > 0)
    alertas.push({ tipo: 'financeiro', texto: `${aguardandoFinanceiro} ato(s) aguardando validação do Financeiro` })

  return {
    papel, nome: (prof as any)?.nome ?? '', cartorioNome: (prof as any)?.cartorios?.nome ?? null,
    porEtapa, minhaFila, emCurso, alertas,
    metricas: { concluidosMes: concl.length, concluidosHoje, novasHoje: novasHoje ?? 0, tempoMedioDias, aguardandoFinanceiro, valorPendente },
  }
}

// ---------------------------------------------------------------------------
// Competência: o que cada papel PODE fazer. Em cartório isso é lei, não menu.
// ---------------------------------------------------------------------------
export interface Competencia { etapas: Etapa[]; resumo: string; podeAprovarAte: string }

export function competenciaDo(papel: string): Competencia {
  switch (papel) {
    case 'escrevente':
      return { etapas: ['elaboracao', 'finalizacao'], podeAprovarAte: 'Baixa complexidade',
        resumo: 'Você elabora a minuta, lança valores, corrige exigências e disponibiliza o ato final ao cliente. Aprova atos de baixa complexidade.' }
    case 'financeiro':
      return { etapas: ['financeiro'], podeAprovarAte: '—',
        resumo: 'Você confere e valida emolumentos e impostos. Sem a sua validação, atos com valores não seguem para aprovação.' }
    case 'tabeliao_substituto':
      return { etapas: ['aprovacao'], podeAprovarAte: 'Média complexidade',
        resumo: 'Você revisa e aprova atos de baixa e média complexidade, ou devolve com exigência ao escrevente.' }
    case 'tabeliao_oficial':
    case 'tabeliao':
      return { etapas: ['elaboracao', 'financeiro', 'aprovacao', 'finalizacao'], podeAprovarAte: 'Alta complexidade',
        resumo: 'Você detém a fé pública: aprova atos de qualquer complexidade e pode atuar em qualquer etapa do fluxo.' }
    default:
      return { etapas: [], podeAprovarAte: '—', resumo: 'Perfil sem competência no fluxo interno.' }
  }
}

/** Nesta etapa, este papel pode agir — ou está apenas acompanhando? */
export function souCompetente(papel: string, etapa: string, complexidade?: string | null): boolean {
  if (papel === 'tabeliao_oficial' || papel === 'tabeliao') return true
  if (etapa === 'aprovacao') return aprovadorPorComplexidade(complexidade) === papel ||
    (papel === 'tabeliao_substituto' && complexidade !== 'alta')
  return competenciaDo(papel).etapas.includes(etapa as Etapa)
}

export const brl = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })

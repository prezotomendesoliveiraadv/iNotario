import { supabase } from './supabase'
import { mensagemErroFuncao } from './erros'

export interface Plano {
  cartorio_id: string; valor_fixo: number; valor_ato: number
  tabeliao_oficial: string | null; contato_email: string | null; contato_fone: string | null
  email_master: string | null; validade: string | null; ativo: boolean; obs: string | null
}
export interface Fatura {
  id: string; cartorio_id: string; competencia: string; qtd_atos: number
  valor_fixo: number; valor_variavel: number; valor_total: number
  status: 'aberta' | 'fechada' | 'paga'; detalhes: any; gerada_em: string; paga_em: string | null
}
/** Uma linha do demonstrativo: quantidade medida x preço da tabela. */
export interface LinhaCobranca {
  item: string; rotulo: string; quantidade: number
  valor_unitario: number; valor_total: number
}
export interface Demonstrativo {
  competencia: string
  valor_fixo: number
  linhas: LinhaCobranca[]
  valor_variavel: number
  valor_total: number
  /** Itens com uso no mês e preço zerado — cobrança que ficaria de fora. */
  sem_preco: string[]
}
export interface Preco {
  id: string; cartorio_id: string | null; item: string
  valor_unitario: number; ativo: boolean; atualizado_em: string
}

export const ITEM_ROTULO: Record<string, string> = {
  ato_aberto: 'Atos abertos (protocolos)',
  leitura_documento: 'Leituras de documento por IA',
  minuta_ia: 'Minutas geradas por IA (por versão)',
  triagem_ia: 'Triagens por IA',
  consulta_juridica: 'Consultas jurídicas',
  prequalificacao: 'Avaliações de aptidão registral',
}

export interface CartorioAdmin {
  id: string; nome: string; comarca: string | null; uf: string | null
  plano: Plano | null; ultima_fatura: Fatura | null
}

export const brl = (v: number | null | undefined) =>
  (Number(v ?? 0)).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export const competenciaAtual = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

async function adminCall(action: string, payload: any = {}) {
  const { data, error } = await supabase.functions.invoke('admin-plataforma', { body: { action, ...payload } })
  const msg = await mensagemErroFuncao(error, data, 'admin-plataforma')
  if (msg) throw new Error(msg)
  return data as any
}

export const adminListar = (): Promise<{ cartorios: CartorioAdmin[] }> => adminCall('listar')
export const adminSalvarPlano = (cartorioId: string, plano: Partial<Plano>) => adminCall('salvar_plano', { cartorioId, plano })
export const adminUsuarioMaster = (cartorioId: string, email: string, senha: string, nome: string) => adminCall('usuario_master', { cartorioId, email, senha, nome })
export const adminGerarFatura = (cartorioId: string, competencia: string): Promise<{ fatura: Fatura }> => adminCall('gerar_fatura', { cartorioId, competencia })
export const adminExtrato = (cartorioId: string, competencia: string): Promise<{ qtd: number; atos: any[] }> => adminCall('extrato', { cartorioId, competencia })
export const adminMarcarPaga = (faturaId: string) => adminCall('marcar_paga', { faturaId })

// ------- lado do cartório (leitura via RLS) -------
export async function meuPlano(cartorioId: string): Promise<Plano | null> {
  const { data } = await supabase.from('planos').select('*').eq('cartorio_id', cartorioId).maybeSingle()
  return (data as Plano) ?? null
}
export async function minhasFaturas(cartorioId: string): Promise<Fatura[]> {
  const { data } = await supabase.from('faturas').select('*').eq('cartorio_id', cartorioId).order('competencia', { ascending: false })
  return (data as Fatura[]) ?? []
}
export interface UsoMes {
  concluidas: number; emAndamento: number; externas: number
  porTipo: { tipo: string; qtd: number }[]
  porAprovador: { nome: string; qtd: number }[]
  atos: { protocolo: string | null; titulo: string | null; tipo: string | null; concluida_em: string }[]
}
export async function usoDoMes(cartorioId: string, competencia: string): Promise<UsoMes> {
  const [ano, mes] = competencia.split('-').map(Number)
  const ini = new Date(Date.UTC(ano, mes - 1, 1)).toISOString()
  const fim = new Date(Date.UTC(ano, mes, 1)).toISOString()

  const { data: concl } = await supabase.from('solicitacoes')
    .select('protocolo, titulo, origem, concluida_em, aprovado_por, tipos_ato(nome)')
    .eq('cartorio_id', cartorioId).eq('status', 'concluida')
    .gte('concluida_em', ini).lt('concluida_em', fim).order('concluida_em')
  const { count: andamento } = await supabase.from('solicitacoes')
    .select('id', { count: 'exact', head: true })
    .eq('cartorio_id', cartorioId).not('status', 'in', '("concluida","cancelada")')

  const lista = (concl ?? []) as any[]
  const porTipoMap: Record<string, number> = {}
  const porAprovMap: Record<string, number> = {}
  for (const a of lista) {
    const t = a.tipos_ato?.nome ?? 'Outro'
    porTipoMap[t] = (porTipoMap[t] ?? 0) + 1
    if (a.aprovado_por) porAprovMap[a.aprovado_por] = (porAprovMap[a.aprovado_por] ?? 0) + 1
  }
  // nomes dos aprovadores
  const ids = Object.keys(porAprovMap)
  let nomes: Record<string, string> = {}
  if (ids.length) {
    const { data: profs } = await supabase.from('profiles').select('id, nome').in('id', ids)
    for (const p of (profs ?? []) as any[]) nomes[p.id] = p.nome
  }
  return {
    concluidas: lista.length,
    emAndamento: andamento ?? 0,
    externas: lista.filter(a => a.origem === 'externa').length,
    porTipo: Object.entries(porTipoMap).map(([tipo, qtd]) => ({ tipo, qtd })).sort((a, b) => b.qtd - a.qtd),
    porAprovador: Object.entries(porAprovMap).map(([id, qtd]) => ({ nome: nomes[id] ?? 'Usuário', qtd })).sort((a, b) => b.qtd - a.qtd),
    atos: lista.map(a => ({ protocolo: a.protocolo, titulo: a.titulo, tipo: a.tipos_ato?.nome ?? null, concluida_em: a.concluida_em })),
  }
}


// ---------------------------------------------------------------------------
// Demonstrativo por evento
//
// O cálculo mora no banco (demonstrativo_faturamento). O front só exibe: assim
// a prévia na tela do cartório, a fatura fechada e a conferência do admin usam
// exatamente a mesma regra, sem risco de divergirem.
// ---------------------------------------------------------------------------
export async function demonstrativo(cartorioId: string, competencia: string): Promise<Demonstrativo> {
  const { data, error } = await supabase.rpc('demonstrativo_faturamento', {
    p_cartorio: cartorioId, p_competencia: competencia,
  })
  if (error) throw error
  return data as Demonstrativo
}

/** Nível 4 (administração) do cartório, ou admin da plataforma. */
export async function podeVerFaturamento(cartorioId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('pode_ver_faturamento', { p_cartorio: cartorioId })
  if (error) return false
  return Boolean(data)
}

/** Tabela de preços: a do cartório quando existir, senão a padrão da plataforma. */
export async function listarPrecos(cartorioId?: string | null): Promise<Preco[]> {
  let q = supabase.from('precos').select('*').order('item')
  q = cartorioId ? q.or(`cartorio_id.is.null,cartorio_id.eq.${cartorioId}`) : q.is('cartorio_id', null)
  const { data, error } = await q
  if (error) throw error
  return (data as Preco[]) ?? []
}

export const adminSalvarPreco = (item: string, valorUnitario: number | null, cartorioId?: string | null) =>
  adminCall('salvar_preco', { item, valorUnitario, cartorioId: cartorioId ?? null })

/** Custo estimado de IA do cartório no período — só a plataforma enxerga. */
export interface CustoIA {
  competencia: string
  linhas: { funcao: string; modelo: string; ent: number; sai: number; brl: number }[]
  tokens_entrada: number
  tokens_saida: number
  custo_brl: number
}
export const adminCustoIA = (cartorioId: string, competencia: string): Promise<{ custo: CustoIA }> =>
  adminCall('custo_ia', { cartorioId, competencia })

export type Papel = 'tabeliao' | 'escrevente' | 'cliente'

export type StatusSolicitacao =
  | 'rascunho'
  | 'recebida'
  | 'em_elaboracao'
  | 'em_revisao'
  | 'aprovada'
  | 'concluida'
  | 'cancelada'

export const STATUS_ORDEM: StatusSolicitacao[] = [
  'recebida', 'em_elaboracao', 'em_revisao', 'aprovada', 'concluida',
]

export const STATUS_LABEL: Record<StatusSolicitacao, string> = {
  rascunho: 'Rascunho',
  recebida: 'Recebida',
  em_elaboracao: 'Em elaboração',
  em_revisao: 'Em revisão',
  aprovada: 'Aprovada',
  concluida: 'Concluída',
  cancelada: 'Cancelada',
}

export interface Profile {
  id: string
  cartorio_id: string | null
  nome: string
  papel: Papel
}

export interface CampoSchema {
  key: string
  label: string
  type: 'text' | 'textarea' | 'number' | 'select' | 'date'
  required?: boolean
  options?: string[]
}

export interface TipoAto {
  id: string
  slug: string
  nome: string
  descricao: string | null
  papeis: string[]
  schema_campos: CampoSchema[]
  template: string
}

export interface Parte {
  id?: string
  solicitacao_id?: string
  papel: string
  nome: string
  cpf_cnpj?: string
  dados?: Record<string, any>
}

export interface Solicitacao {
  id: string
  cartorio_id: string
  tipo_ato_id: string
  protocolo: string | null
  status: StatusSolicitacao
  titulo: string | null
  cliente_id: string | null
  responsavel_id: string | null
  criado_por: string | null
  dados: Record<string, any>
  origem?: string
  contato_nome?: string | null
  contato_email?: string | null
  contato_whatsapp?: string | null
  intake?: Record<string, any> | null
  complexidade?: 'baixa' | 'media' | 'alta' | null
  financeiro_status?: 'nao_aplicavel' | 'pendente' | 'validado'
  emolumentos?: number | null
  impostos?: number | null
  financeiro_obs?: string | null
  etapa?: 'elaboracao' | 'financeiro' | 'aprovacao' | 'finalizacao' | 'concluida'
  responsavel_papel?: string
  exigencia_atual?: string | null
  aprovado_por?: string | null
  aprovado_em?: string | null
  created_at: string
  updated_at: string
  tipos_ato?: TipoAto
}

export type ItemStatus = 'ok' | 'atencao' | 'pendente'

export interface ItemQualificacao {
  item: string
  status: ItemStatus
  fundamento: string
}

export interface Minuta {
  id: string
  solicitacao_id: string
  versao: number
  tipo: 'provisoria' | 'definitiva'
  conteudo: string
  hash: string
  qualificacao: ItemQualificacao[]
  criado_por: string | null
  created_at: string
}

export interface CustodiaEntry {
  id: number
  solicitacao_id: string
  minuta_id: string | null
  ator_id: string | null
  acao: string
  detalhe: Record<string, any>
  hash_anterior: string | null
  hash_atual: string
  created_at: string
}

import type {
  TipoAto, Parte, ItemQualificacao, ItemStatus,
} from './types'

/**
 * Motor Artemis (MVP)
 * -------------------
 * Nesta versão o motor é DETERMINÍSTICO: monta a minuta a partir do template do
 * tipo de ato e roda um qualificador heurístico (regras notariais/registrais
 * básicas) que produz um parecer com fundamentos.
 *
 * Para plugar a IA generativa real (linha Artemis do iAdvoga / Claude), substitua
 * `gerarConteudo` por uma chamada a uma Supabase Edge Function que invoque o LLM
 * — mantendo a chave fora do front. O restante do fluxo (qualificação, hash,
 * versionamento, cadeia de custódia) permanece igual.
 */

// ---- Hash SHA-256 (Web Crypto) -------------------------------------------
export async function sha256(texto: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto))
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

// ---- Formatação ----------------------------------------------------------
function fmtParte(p: Parte): string {
  const partes = [p.nome]
  if (p.cpf_cnpj) partes.push(`CPF/CNPJ ${p.cpf_cnpj}`)
  const d = p.dados || {}
  if (d.estado_civil) partes.push(d.estado_civil)
  if (d.regime_bens) partes.push(`regime de ${d.regime_bens}`)
  if (d.endereco) partes.push(`residente em ${d.endereco}`)
  return partes.join(', ')
}

function fmtValor(v: any): string {
  const n = Number(v)
  if (!isFinite(n)) return String(v ?? '')
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2 })
}

// ---- Geração do conteúdo da minuta ---------------------------------------
export function gerarConteudo(
  tipo: TipoAto,
  dados: Record<string, any>,
  partes: Parte[],
): string {
  let texto = tipo.template

  // Substitui {{parte:Papel}}
  for (const papel of tipo.papeis) {
    const p = partes.find((x) => x.papel === papel)
    const repr = p ? fmtParte(p) : `__________ (${papel} — dado pendente)`
    texto = texto.split(`{{parte:${papel}}}`).join(repr)
  }

  // Substitui campos {{key}}
  for (const campo of tipo.schema_campos) {
    let val = dados?.[campo.key]
    if (campo.key === 'valor' || campo.type === 'number') val = fmtValor(val)
    if (val === undefined || val === null || val === '') val = '__________'
    texto = texto.split(`{{${campo.key}}}`).join(String(val))
  }

  // Limpa placeholders remanescentes
  texto = texto.replace(/\{\{[^}]+\}\}/g, '__________')
  return texto
}

// ---- Qualificação preventiva (heurística) --------------------------------
export function qualificar(
  tipo: TipoAto,
  dados: Record<string, any>,
  partes: Parte[],
): ItemQualificacao[] {
  const itens: ItemQualificacao[] = []
  const add = (item: string, status: ItemStatus, fundamento: string) =>
    itens.push({ item, status, fundamento })

  // 1. Partes obrigatórias presentes e identificadas
  for (const papel of tipo.papeis) {
    const p = partes.find((x) => x.papel === papel)
    if (!p || !p.nome) {
      add(`Parte "${papel}" ausente`, 'pendente',
        'Toda escritura exige a qualificação completa dos comparecentes (art. 215, CC).')
    } else if (!p.cpf_cnpj) {
      add(`CPF/CNPJ de "${p.nome}" não informado`, 'atencao',
        'A qualificação das partes deve incluir documento de identificação (CNN/CNJ).')
    } else {
      add(`Qualificação de "${p.nome}"`, 'ok',
        'Parte identificada com nome e CPF/CNPJ.')
    }
  }

  // 2. Campos obrigatórios do tipo de ato
  for (const campo of tipo.schema_campos) {
    if (campo.required) {
      const v = dados?.[campo.key]
      if (v === undefined || v === null || v === '') {
        add(`Campo obrigatório "${campo.label}" em branco`, 'pendente',
          'Elemento essencial do ato ausente — impede a lavratura definitiva.')
      }
    }
  }

  // 3. Regras específicas por tipo
  if (tipo.slug === 'compra-venda-imovel') {
    if (String(dados?.itbi_pago).toLowerCase() === 'não' || dados?.itbi_pago === 'Não') {
      add('ITBI não recolhido', 'atencao',
        'O recolhimento do ITBI é condição para o registro do título no RI (art. 289, LRP; arts. do CTN).')
    } else if (dados?.itbi_pago === 'Sim') {
      add('ITBI recolhido', 'ok', 'Comprovação de ITBI declarada.')
    }
    if (dados?.forma_pagamento === 'Dação em pagamento') {
      add('Forma "dação em pagamento"', 'atencao',
        'A cláusula descreve dação, não pagamento em pecúnia — verifique a natureza do negócio e a tributação aplicável.')
    }
    if (!dados?.imovel_matricula) {
      add('Matrícula do imóvel ausente', 'pendente',
        'Princípio da especialidade objetiva exige a identificação registral do imóvel (art. 176, LRP).')
    }
  }

  if (tipo.slug === 'doacao') {
    if (dados?.reserva_usufruto === 'Sim') {
      add('Reserva de usufruto', 'ok',
        'Reserva de usufruto admitida; registre o gravame na matrícula.')
    }
  }

  // 4. Partes casadas — alerta de vênia conjugal (compra e venda / doação de imóvel)
  if (tipo.slug === 'compra-venda-imovel' || tipo.slug === 'doacao') {
    for (const p of partes) {
      const ec = (p.dados?.estado_civil || '').toLowerCase()
      const regime = (p.dados?.regime_bens || '').toLowerCase()
      if (ec.includes('casad') && !regime.includes('separação')) {
        add(`Outorga conjugal — "${p.nome}"`, 'atencao',
          'Parte casada: pode ser necessária a vênia conjugal para alienação de imóvel (art. 1.647, CC).')
      }
    }
  }

  if (itens.length === 0) {
    add('Sem apontamentos', 'ok', 'Nenhum óbice detectado nas verificações automáticas.')
  }
  return itens
}

export interface ResultadoArtemis {
  conteudo: string
  qualificacao: ItemQualificacao[]
  hash: string
}

export async function processarMinuta(
  tipo: TipoAto,
  dados: Record<string, any>,
  partes: Parte[],
): Promise<ResultadoArtemis> {
  const conteudo = gerarConteudo(tipo, dados, partes)
  const qualificacao = qualificar(tipo, dados, partes)
  const hash = await sha256(conteudo)
  return { conteudo, qualificacao, hash }
}

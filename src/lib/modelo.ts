import { supabase } from './supabase'
import { dicionarioDoAto } from './espelho'

// ============================================================================
// Qual modelo se aplica a este ato
//
// A precedência é a mesma dos dois lados — Edge Function e geração rápida:
//
//   1. modelo do empreendimento     (venda de construtora, o mais específico)
//   2. modelo da construtora
//   3. modelo padrão do acervo do cartório para aquele tipo de ato
//   4. nada  → o chamador cai no template genérico de `tipos_ato`
//
// Os três primeiros vêm de funções do banco, não de consulta montada aqui:
// duplicar a regra de precedência no front seria a forma mais rápida de as
// duas telas passarem a gerar minutas diferentes.
// ============================================================================

export interface ModeloAplicavel {
  fonte: 'empreendimento' | 'construtora' | 'acervo'
  titulo: string
  texto: string
}

export async function modeloAplicavel(
  solicitacaoId: string, cartorioId: string, tipoSlug?: string | null,
): Promise<ModeloAplicavel | null> {
  // 1-3: cobre empreendimento, construtora e o padrão do acervo por tipo de ato
  const { data } = await supabase.rpc('modelo_para_solicitacao', { p_solicitacao: solicitacaoId })
  const m = ((data as any[]) ?? [])[0]
  if (m?.texto) return m as ModeloAplicavel

  // Sem empreendimento vinculado, `modelo_para_solicitacao` não chega ao acervo:
  // ela parte da solicitação e o ramo do acervo depende do tipo de ato. Este é
  // o caminho para o ato que não é venda de construtora.
  if (!tipoSlug) return null
  const { data: ac } = await supabase.rpc('modelo_do_acervo', {
    p_cartorio: cartorioId, p_tipo_slug: tipoSlug,
  })
  const a = ((ac as any[]) ?? [])[0]
  return a?.texto ? (a as ModeloAplicavel) : null
}

/** Cláusulas especiais já escolhidas para este ato, na ordem definida. */
export async function listarClausulasDoAto(solicitacaoId: string) {
  const { data } = await supabase.from('solicitacao_clausulas')
    .select('nome, texto, ordem').eq('solicitacao_id', solicitacaoId).order('ordem')
  return ((data as any[]) ?? []).map(c => ({ nome: c.nome, texto: c.texto }))
}

/**
 * Monta o dicionário de substituição com os mesmos insumos que a Edge Function
 * usa: partes, dados do ato, matrícula e contrato lidos, empreendimento e
 * cartório.
 */
export async function dicionarioDoProtocolo(solic: any, partes: any[]) {
  const [{ data: docs }, { data: extra }] = await Promise.all([
    supabase.from('documentos').select('tipo, extraido, status').eq('solicitacao_id', solic.id),
    supabase.from('solicitacoes')
      .select('empreendimentos(nome), cartorios(nome, cidade)').eq('id', solic.id).maybeSingle(),
  ])

  // Documento validado ganha do apenas extraído: se alguém conferiu, é o que vale.
  const pega = (t: string) => ((docs as any[]) ?? [])
    .filter(d => d.tipo === t && d.extraido)
    .sort((a, b) => (a.status === 'validado' ? -1 : 1))[0]?.extraido ?? null

  // A consolidação do banco tem precedência: é a mesma que o painel mostra e a
  // mesma que as Edge Functions usam. O dicionário local só cobre o que ela não
  // devolve (rótulos do cartório, data do ato).
  const { data: cons } = await supabase.rpc('consolidar_ato', { p_solicitacao: solic.id })
  const doPainel: Record<string, string> = {}
  for (const [k, v] of Object.entries(((cons as any)?.campos ?? {}) as Record<string, any>)) {
    if (v?.valor) doPainel[k] = String(v.valor)
  }

  return { ...dicionarioDoAto({
    solicitacao: solic,
    partes,
    imovel: pega('matricula') ?? solic?.dados,
    contrato: pega('compromisso'),
    empreendimento: (extra as any)?.empreendimentos,
    cartorio: (extra as any)?.cartorios,
  }), ...doPainel }
}

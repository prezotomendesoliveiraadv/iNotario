// ============================================================================
// ESPELHO DO MODELO — preenchimento determinístico da minuta
//
// Quando o empreendimento ou a construtora tem modelo próprio, a minuta NÃO é
// reescrita pelo modelo de linguagem: o texto do modelo é reproduzido como
// está e apenas os campos entre colchetes são substituídos pelos dados do
// protocolo. Forma, ordem das cláusulas, numeração e redação ficam idênticas.
//
// Um LLM reescrevendo uma escritura de dez páginas sempre desvia em algum
// ponto — e a construtora aprovou aquela redação, não uma paráfrase dela.
//
// O que não for encontrado na base vira [[**campo**]]: fácil de achar na tela,
// impossível de confundir com texto pronto e evidente num PDF de conferência.
// ============================================================================

export interface CampoNaoResolvido {
  rotulo: string;
  ocorrencias: number;
}

export interface ResultadoEspelho {
  texto: string;
  preenchidos: { rotulo: string; valor: string }[];
  pendentes: CampoNaoResolvido[];
  total: number;
}

/** Normaliza um rótulo para comparação: minúsculas, sem acento e sem ruído. */
export function chave(s: string): string {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * Sinônimos aceitos por campo canônico. Modelos de construtora usam rótulos
 * livres — "[NOME DO COMPRADOR]", "[ADQUIRENTE]", "[PROMISSÁRIO COMPRADOR]"
 * são o mesmo campo. Sem isto, o espelho marcaria tudo como pendente.
 */
const SINONIMOS: Record<string, string[]> = {
  comprador_nome: [
    "comprador", "nome do comprador", "nome comprador", "adquirente", "nome do adquirente",
    "promissario comprador", "promissaria compradora", "outorgado comprador", "outorgado",
  ],
  comprador_cpf: ["cpf do comprador", "cpf comprador", "cpf do adquirente", "cpf/cnpj do comprador"],
  comprador_rg: ["rg do comprador", "rg comprador", "identidade do comprador"],
  comprador_estado_civil: ["estado civil do comprador", "estado civil comprador", "estado civil do adquirente"],
  comprador_regime_bens: ["regime de bens", "regime de bens do comprador", "regime"],
  comprador_profissao: ["profissao do comprador", "profissao comprador"],
  comprador_endereco: ["endereco do comprador", "endereco comprador", "residencia do comprador"],
  comprador_nacionalidade: ["nacionalidade do comprador", "nacionalidade"],

  vendedor_nome: [
    "vendedor", "nome do vendedor", "vendedora", "construtora", "incorporadora",
    "razao social", "razao social da vendedora", "outorgante vendedor", "promitente vendedora",
  ],
  vendedor_cnpj: ["cnpj", "cnpj da vendedora", "cnpj da construtora", "cnpj do vendedor"],
  vendedor_endereco: ["endereco da vendedora", "sede da vendedora", "endereco da construtora"],
  vendedor_representante: [
    "representante", "representante legal", "representante da vendedora", "socio administrador",
  ],

  empreendimento: ["empreendimento", "nome do empreendimento", "condominio", "edificio"],
  unidade: ["unidade", "unidade autonoma", "apartamento", "apto", "numero da unidade"],
  torre_bloco: ["torre", "bloco", "torre/bloco", "torre bloco"],
  vaga_garagem: ["vaga", "vaga de garagem", "garagem", "box"],

  imovel_matricula: ["matricula", "numero da matricula", "matricula do imovel"],
  imovel_cartorio_ri: [
    "cartorio de registro de imoveis", "cartorio de ri", "registro de imoveis", "cri", "oficio de registro",
  ],
  imovel_descricao: ["descricao do imovel", "imovel", "descricao"],
  imovel_endereco: ["endereco do imovel", "localizacao do imovel"],
  imovel_area: ["area", "area privativa", "area total"],

  valor_total: ["valor", "valor total", "preco", "valor do imovel", "valor da venda", "preco certo e ajustado"],
  valor_extenso: ["valor por extenso", "valor total por extenso", "preco por extenso"],
  forma_pagamento: ["forma de pagamento", "condicoes de pagamento", "pagamento"],
  sinal: ["sinal", "entrada", "arras", "sinal e principio de pagamento"],
  saldo: ["saldo", "saldo devedor", "saldo remanescente"],
  instituicao_financeira: ["instituicao financeira", "banco", "agente financeiro", "credor fiduciario"],
  data_contrato: ["data do contrato", "data do compromisso", "data"],
  prazo_entrega: ["prazo de entrega", "habite-se", "prazo"],

  cartorio_nome: ["cartorio", "tabeliao", "serventia", "nome do cartorio"],
  cidade: ["cidade", "municipio", "comarca"],
  data_ato: ["data do ato", "data da escritura", "data de hoje"],
};

/** Índice invertido: sinônimo normalizado -> campo canônico. */
const INDICE: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  for (const [canon, lista] of Object.entries(SINONIMOS)) {
    m[canon] = canon;
    for (const s of lista) m[chave(s)] = canon;
  }
  return m;
})();

/**
 * Resolve o rótulo lido no modelo contra o dicionário de dados do protocolo.
 * Tenta, nesta ordem: chave exata, sinônimo conhecido, e por fim uma
 * correspondência por prefixo — que cobre "[NOME DO COMPRADOR (1)]" e afins.
 */
function resolver(rotulo: string, dados: Record<string, string>): string | null {
  const k = chave(rotulo);
  if (!k) return null;

  const direto = dados[k];
  if (direto) return direto;

  const canon = INDICE[k];
  if (canon && dados[canon]) return dados[canon];

  // Rótulo com sufixo/ruído: "[CPF DO COMPRADOR:]" -> cpf_do_comprador
  for (const [sin, c] of Object.entries(INDICE)) {
    if (sin.length >= 5 && (k.startsWith(sin) || k.endsWith(sin)) && dados[c]) return dados[c];
  }
  return null;
}

/**
 * Reproduz o modelo substituindo os campos entre colchetes.
 *
 * Reconhece `[campo]`, `[[campo]]` e `{{campo}}` — modelos de construtora
 * chegam nos três formatos. O que não resolver sai como `[[**campo**]]`.
 */
export function espelharModelo(modelo: string, dados: Record<string, string>): ResultadoEspelho {
  const preenchidos: { rotulo: string; valor: string }[] = [];
  const pendentes = new Map<string, number>();
  let total = 0;

  // Ordem importa: os delimitadores duplos primeiro, senão o padrão simples
  // consome o colchete de dentro e deixa um par órfão no texto.
  const padroes = [/\[\[([^\[\]]{1,160})\]\]/g, /\{\{([^{}]{1,160})\}\}/g, /\[([^\[\]]{1,160})\]/g];

  let texto = String(modelo ?? "");
  for (const padrao of padroes) {
    texto = texto.replace(padrao, (inteiro, bruto) => {
      const rotulo = String(bruto).replace(/^[\s*:.-]+|[\s*:.-]+$/g, "").trim();
      if (!rotulo) return inteiro;

      // Já marcado como pendente numa passada anterior: não remarcar.
      if (/^\*\*.*\*\*$/.test(String(bruto).trim())) return inteiro;

      total++;
      const valor = resolver(rotulo, dados);
      if (valor) {
        preenchidos.push({ rotulo, valor });
        return valor;
      }
      pendentes.set(rotulo, (pendentes.get(rotulo) ?? 0) + 1);
      return `[[**${rotulo}**]]`;
    });
  }

  return {
    texto,
    preenchidos,
    pendentes: [...pendentes.entries()].map(([rotulo, ocorrencias]) => ({ rotulo, ocorrencias })),
    total,
  };
}

/**
 * Monta o dicionário de substituição a partir do que o cartório já tem.
 *
 * Só entra valor efetivamente presente: string vazia não vira preenchimento,
 * senão o espelho esconderia uma pendência real atrás de um campo em branco.
 */
export function dicionarioDoAto(ctx: {
  solicitacao?: any;
  partes?: any[];
  imovel?: any;
  construtora?: any;
  empreendimento?: any;
  contrato?: any;
  cartorio?: any;
}): Record<string, string> {
  const d: Record<string, string> = {};
  const por = (k: string, v: unknown) => {
    const t = String(v ?? "").trim();
    if (t && t !== "null" && t !== "undefined") d[k] = t;
  };

  const partes = ctx.partes ?? [];
  const achaPapel = (re: RegExp) => partes.find((p: any) => re.test(String(p?.papel ?? "")));
  const comprador = achaPapel(/compra|adquir|outorgad/i);
  const vendedor = achaPapel(/vend|outorgante|promitente/i);

  if (comprador) {
    por("comprador_nome", comprador.nome);
    por("comprador_cpf", comprador.cpf_cnpj);
    por("comprador_rg", comprador.dados?.rg);
    por("comprador_estado_civil", comprador.dados?.estado_civil);
    por("comprador_regime_bens", comprador.dados?.regime_bens);
    por("comprador_profissao", comprador.dados?.profissao);
    por("comprador_endereco", comprador.dados?.endereco ?? comprador.dados?.cidade);
    por("comprador_nacionalidade", comprador.dados?.nacionalidade ?? "brasileiro(a)");
  }
  if (vendedor) {
    por("vendedor_nome", vendedor.nome);
    por("vendedor_cnpj", vendedor.cpf_cnpj);
    por("vendedor_endereco", vendedor.dados?.endereco);
    por("vendedor_representante", vendedor.dados?.representante);
  }

  const c = ctx.construtora ?? {};
  por("vendedor_nome", d.vendedor_nome ?? c.razao_social);
  por("vendedor_cnpj", d.vendedor_cnpj ?? c.cnpj);
  por("vendedor_endereco", d.vendedor_endereco ?? c.endereco);

  const e = ctx.empreendimento ?? {};
  por("empreendimento", e.nome ?? ctx.solicitacao?.dados?.empreendimento);
  por("unidade", ctx.solicitacao?.unidade ?? ctx.solicitacao?.dados?.unidade);
  por("torre_bloco", ctx.solicitacao?.dados?.torre_bloco);
  por("vaga_garagem", ctx.solicitacao?.dados?.vaga_garagem);

  const im = ctx.imovel ?? ctx.solicitacao?.dados ?? {};
  por("imovel_matricula", im.imovel_matricula ?? im.matricula);
  por("imovel_cartorio_ri", im.imovel_cartorio_ri ?? im.cartorio_ri);
  por("imovel_descricao", im.imovel_descricao ?? im.descricao_objeto ?? im.descricao);
  por("imovel_endereco", im.endereco);
  por("imovel_area", im.area ?? im.area_privativa);

  const k = ctx.contrato ?? {};
  por("valor_total", ctx.solicitacao?.dados?.valor ?? k.valor_total);
  por("forma_pagamento", ctx.solicitacao?.dados?.forma_pagamento ?? k.forma_pagamento);
  por("sinal", k.sinal);
  por("saldo", k.saldo);
  por("instituicao_financeira", k.instituicao_financeira);
  por("data_contrato", k.data_contrato);
  por("prazo_entrega", k.prazo_entrega);

  por("cartorio_nome", ctx.cartorio?.nome);
  por("cidade", ctx.cartorio?.cidade ?? im.cidade);
  por("data_ato", new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" }));

  return d;
}

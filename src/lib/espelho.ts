// ============================================================================
// ⚠️ ESTE ARQUIVO É ESPELHO DE supabase/functions/_shared/espelho.ts
// Mantenha os dois em sincronia — o front e as Edge Functions precisam
// produzir EXATAMENTE o mesmo texto a partir do mesmo modelo.
// ============================================================================

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

  onus: ["onus", "onus e gravames", "gravames", "onus reais", "restricoes da matricula"],
  cnd_trabalhista: ["cndt", "certidao trabalhista", "cnd trabalhista", "certidao negativa de debitos trabalhistas"],
  cnd_federal: ["cnd federal", "certidao federal", "certidao negativa de debitos federais", "cnd receita federal", "receita federal"],
  cnd_imobiliaria: ["cnd tributos imobiliarios", "certidao de tributos imobiliarios", "iptu", "certidao municipal", "tributos municipais"],
  outras_informacoes: ["outras informacoes", "informacoes adicionais", "observacoes"],
  qualificacao_completa: ["qualificacao completa", "qualificacao das partes", "qualificacao"],
  qualificacao_comprador: [
    "qualificacao completa do comprador", "qualificacao do comprador", "qualificacao comprador",
    "qualificacao completa do adquirente", "qualificacao do adquirente",
  ],
  qualificacao_vendedor: [
    "qualificacao completa do vendedor", "qualificacao do vendedor", "qualificacao vendedor",
    "qualificacao da vendedora", "qualificacao completa da vendedora",
  ],
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

// ============================================================================
// CLÁUSULAS ESPECIAIS NO TEXTO ESPELHADO
//
// Regressão que isto corrige: as cláusulas especiais eram passadas ao modelo de
// linguagem como instrução ("incorpore cada uma como cláusula própria"). Quando
// o espelho passou a substituir a saída do modelo pelo modelo preenchido, essa
// instrução deixou de ter efeito — as cláusulas sumiam silenciosamente das
// minutas de construtora, que são justamente as que mais dependem delas.
//
// Aqui a inserção é determinística, como o resto do espelho.
// ============================================================================

/** Marcador que a construtora pode deixar no modelo para indicar o ponto exato. */
const MARCA_CLAUSULAS = /\[\[?\s*(cl[áa]usulas?\s+especiais?|inserir\s+cl[áa]usulas?)\s*\]?\]/i;

/**
 * Onde termina o corpo e começa o fecho. Inserir cláusula depois do fecho
 * ("assim o disseram... lavro a presente") produz documento errado, então
 * procuramos o início do fecho e inserimos antes dele.
 */
const INICIO_FECHO = /^\s*(assim\s+o\s+disseram|e\s+de\s+como\s+assim|lavro\s+a\s+presente|dou\s+f[ée]|em\s+testemunho|pelas?\s+partes?\s+foi\s+dito\s+que\s+aceita)/im;

export interface ResultadoClausulas {
  texto: string;
  /** Como a inserção foi resolvida — vira aviso no parecer. */
  posicao: "marcador" | "antes_do_fecho" | "final";
  inseridas: number;
}

export function inserirClausulas(
  texto: string,
  clausulas: { nome: string; texto: string; inserir_apos?: number | null }[],
  numeroInicial = 0,
): ResultadoClausulas {
  const uteis = (clausulas ?? []).filter((c) => String(c?.texto ?? "").trim());
  if (!uteis.length) return { texto, posicao: "final", inseridas: 0 };

  // Com posição indicada, cada cláusula entra logo depois da cláusula do
  // modelo que o escrevente escolheu — e o documento é renumerado ao final.
  const posicionadas = uteis.filter((c) => Number.isFinite(Number(c.inserir_apos)));
  if (posicionadas.length) {
    let t = texto;
    // De trás para frente: inserir na cláusula 8 não desloca o índice da 3.
    const ordenadas = [...posicionadas].sort((a, b) => Number(b.inserir_apos) - Number(a.inserir_apos));
    for (const c of ordenadas) {
      // O número aqui é provisório: renumerar() reescreve tudo em sequência no
      // fim. O que importa é o cabeçalho existir, senão a cláusula inserida não
      // entra na contagem e o documento fica com numeração repetida.
      // Adota a grafia dominante do modelo: inserir "CLÁUSULA 3ª" num documento
      // que usa "CLÁUSULA III" descaracteriza a redação aprovada.
      t = inserirApos(
        t, Number(c.inserir_apos),
        `${cabecalhoNoEstilo(t)} — ${String(c.nome ?? "").toUpperCase()}\n${String(c.texto).trim()}`,
      );
    }
    const soltas = uteis.filter((c) => !Number.isFinite(Number(c.inserir_apos)));
    if (soltas.length) {
      const r = inserirClausulas(t, soltas.map((c) => ({ nome: c.nome, texto: c.texto })), numeroInicial);
      t = r.texto;
    }
    return { texto: renumerar(t), posicao: "marcador", inseridas: uteis.length };
  }

  const bloco = uteis
    .map((c, i) => {
      const n = numeroInicial ? `CLÁUSULA ${numeroInicial + i + 1}ª — ` : "";
      return `${n}${String(c.nome ?? "").toUpperCase()}\n${String(c.texto).trim()}`;
    })
    .join("\n\n");

  if (MARCA_CLAUSULAS.test(texto)) {
    return { texto: texto.replace(MARCA_CLAUSULAS, bloco), posicao: "marcador", inseridas: uteis.length };
  }

  const linhas = texto.split("\n");
  const idx = linhas.findIndex((l) => INICIO_FECHO.test(l));
  if (idx > 0) {
    linhas.splice(idx, 0, "", bloco, "");
    return { texto: linhas.join("\n"), posicao: "antes_do_fecho", inseridas: uteis.length };
  }

  return { texto: `${texto.trimEnd()}\n\n${bloco}\n`, posicao: "final", inseridas: uteis.length };
}

// ---------------------------------------------------------------------------
// Reconhecimento do cabeçalho de cláusula
//
// Modelos de construtora numeram de todo jeito: "CLÁUSULA 3ª", "CLÁUSULA III",
// "Cláusula Terceira", "3." ou "TERCEIRA —". Reconhecer só o algarismo fazia a
// posição escolhida pelo escrevente não ser encontrada, e a cláusula caía no
// fim do documento sem aviso.
// ---------------------------------------------------------------------------

const ORDINAIS: Record<string, number> = {
  primeira: 1, primeiro: 1, segunda: 2, segundo: 2, terceira: 3, terceiro: 3,
  quarta: 4, quarto: 4, quinta: 5, quinto: 5, sexta: 6, sexto: 6,
  setima: 7, setimo: 7, oitava: 8, oitavo: 8, nona: 9, nono: 9,
  decima: 10, decimo: 10, undecima: 11, undecimo: 11, "decima primeira": 11,
  duodecima: 12, duodecimo: 12, "decima segunda": 12, "decima terceira": 13,
  "decima quarta": 14, "decima quinta": 15, "decima sexta": 16,
  "decima setima": 17, "decima oitava": 18, "decima nona": 19, vigesima: 20, vigesimo: 20,
};

const ROMANOS: Record<string, number> = {
  i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10,
  xi: 11, xii: 12, xiii: 13, xiv: 14, xv: 15, xvi: 16, xvii: 17, xviii: 18, xix: 19, xx: 20,
};

/**
 * Cabeçalho de cláusula. Duas formas aceitas, e a distinção importa:
 *
 *   1. com a palavra "cláusula" — aceita algarismo, romano ou extenso;
 *   2. sem ela — SÓ algarismo, e exigindo um título em maiúsculas na sequência.
 *
 * Sem essa restrição, uma linha do CORPO começando com "X." ou "V." era lida
 * como numeral romano e renumerada. O texto da cláusula virava cabeçalho, a
 * contagem inflava e a numeração final saía errada.
 */
const CAB_COM_PALAVRA = /^\s*cl[áa]usula\s+([0-9]{1,2}|[ivxIVX]{1,6}|[a-zà-úA-ZÀ-Ú]+(?:\s+[a-zà-úA-ZÀ-Ú]+)?)\s*[ªº°.\-–—:)\s]/i;
const CAB_SO_NUMERO = /^\s*([0-9]{1,2})\s*[ªº°.\-–—:)]\s+[\p{Lu}]{3}/u;

function casarCabecalho(l: string): { bruto: string; comPalavra: boolean } | null {
  const a = CAB_COM_PALAVRA.exec(l);
  if (a) return { bruto: a[1], comPalavra: true };
  const b = CAB_SO_NUMERO.exec(l);
  if (b) return { bruto: b[1], comPalavra: false };
  return null;
}

/** Marcador livre para a cláusula especial, quando não há posição indicada. */
const MARCA_CLAUSULA_SIMPLES = /\[\[?\s*cl[áa]usula\s+especial\s*\]?\]/i;

function semAcentoBaixa(s: string): string {
  return String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

/** Converte o rótulo lido (algarismo, romano ou extenso) em número. */
export function numeroDoRotulo(bruto: string): number | null {
  const t = semAcentoBaixa(bruto);
  if (!t) return null;
  if (/^\d{1,2}$/.test(t)) return Number(t);
  if (ROMANOS[t] !== undefined) return ROMANOS[t];
  if (ORDINAIS[t] !== undefined) return ORDINAIS[t];
  return null;
}

/** Todas as cláusulas do texto, com o índice da linha em que começam. */
export function numerarClausulas(texto: string): { numero: number; linha: number }[] {
  const out: { numero: number; linha: number }[] = [];
  texto.split("\n").forEach((l, i) => {
    const m = casarCabecalho(l);
    if (!m) return;
    const n = numeroDoRotulo(m.bruto);
    if (n !== null) out.push({ numero: n, linha: i });
  });
  return out;
}

/** Grafia predominante dos cabeçalhos, para o cabeçalho provisório da inserção. */
function cabecalhoNoEstilo(texto: string): string {
  for (const l of texto.split("\n")) {
    const m = CAB_COM_PALAVRA.exec(l);
    if (!m) continue;
    if (/^\d{1,2}$/.test(m[1])) return "CLÁUSULA 0ª";
    if (/^[ivxIVX]{1,6}$/.test(m[1])) return "CLÁUSULA I";
    return "CLÁUSULA PRIMEIRA";
  }
  return "CLÁUSULA 0ª";
}

/** Insere um bloco imediatamente após o fim da cláusula de número informado. */
function inserirApos(texto: string, numero: number, bloco: string): string {
  const linhas = texto.split("\n");
  const marcos = numerarClausulas(texto);
  const alvo = marcos.find((m) => m.numero === numero);
  if (!alvo) {
    // Posição não encontrada: antes de jogar ao final, procurar o marcador
    // livre que o modelo pode trazer.
    if (MARCA_CLAUSULA_SIMPLES.test(texto)) return texto.replace(MARCA_CLAUSULA_SIMPLES, bloco);
    const linhasF = texto.split("\n");
    const idxF = linhasF.findIndex((l) => INICIO_FECHO.test(l));
    if (idxF > 0) { linhasF.splice(idxF, 0, "", bloco, ""); return linhasF.join("\n"); }
    return `${texto.trimEnd()}\n\n${bloco}\n`;
  }

  const seguinte = marcos.find((m) => m.linha > alvo.linha);
  const onde = seguinte ? seguinte.linha : linhas.length;
  linhas.splice(onde, 0, "", bloco, "");
  return linhas.join("\n");
}

/**
 * Renumera as cláusulas em sequência, preservando a redação de cada cabeçalho.
 *
 * Sem isto, inserir uma cláusula no meio produz "CLÁUSULA 3ª" seguida de outra
 * "CLÁUSULA 3ª" — e uma escritura com numeração repetida é devolvida pelo
 * Registro de Imóveis.
 */
export function renumerar(texto: string): string {
  // Preserva a GRAFIA de cada cabeçalho: modelo em romanos continua em
  // romanos, por extenso continua por extenso. Trocar tudo por algarismo
  // descaracterizaria a redação que a construtora aprovou.
  const romano = (n: number) => Object.keys(ROMANOS).find((k) => ROMANOS[k] === n)?.toUpperCase() ?? String(n);
  const extenso = (n: number) => Object.keys(ORDINAIS).find((k) => ORDINAIS[k] === n) ?? String(n);
  const capitalizar = (t: string) => t.replace(/\b\p{L}/gu, (c) => c.toUpperCase());

  let n = 0;
  return texto
    .split("\n")
    .map((l) => {
      const m = casarCabecalho(l);
      if (!m || numeroDoRotulo(m.bruto) === null) return l;
      n++;
      const bruto = m.bruto;
      let novo: string;
      if (/^\d{1,2}$/.test(bruto)) novo = String(n);
      else if (/^[ivxIVX]{1,5}$/.test(bruto)) novo = bruto === bruto.toUpperCase() ? romano(n) : romano(n).toLowerCase();
      else novo = bruto === bruto.toUpperCase() ? extenso(n).toUpperCase() : capitalizar(extenso(n));
      return l.replace(bruto, novo);
    })
    .join("\n");
}


// ============================================================================
// Transcrição de ônus e certidões para o texto da minuta
//
// O modelo da construtora traz campos como [ÔNUS E GRAVAMES] e
// [CND TRABALHISTA]. Estes formatadores transformam o dado estruturado do
// painel definitivo na redação que entra no lugar do colchete.
// ============================================================================

export function textoOnus(onus: any[]): string {
  const uteis = (onus ?? []).filter((o) => o?.tipo || o?.detalhe);
  if (!uteis.length) return "nenhum ônus ou gravame consta da matrícula";
  return uteis
    .map((o) => {
      const partes = [o.tipo, o.detalhe, o.credor && `credor: ${o.credor}`, o.valor && `valor: ${o.valor}`];
      return partes.filter(Boolean).join(" — ");
    })
    .join("; ");
}

/** "negativa nº 123, expedida em 01/08/2026, válida até 30/10/2026" */
export function textoCertidao(c: any): string {
  if (!c) return "";
  const dt = (d?: string) => {
    if (!d) return "";
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d));
    return m ? `${m[3]}/${m[2]}/${m[1]}` : String(d);
  };
  const teor = String(c.teor ?? "").trim();
  const partes = [
    teor && teor !== "indefinido" ? teor : null,
    c.numero ? `nº ${c.numero}` : null,
    c.emitida_em ? `expedida em ${dt(c.emitida_em)}` : null,
    c.validade ? `válida até ${dt(c.validade)}` : null,
  ].filter(Boolean);
  return partes.join(", ");
}

/**
 * Reconhecimento do tipo de certidão pelo nome que a IA leu do documento.
 *
 * Os padrões são PREFIXOS de propósito. O nome oficial da certidão federal é
 * "Certidão de Débitos Relativos a Créditos Tributários FederaIS" — que não
 * contém "federal". Um padrão literal deixava esse campo em branco na minuta
 * justamente na certidão mais comum do ato.
 */
const TIPO_CND: Record<string, RegExp> = {
  cnd_trabalhista: /trabalhist|cndt|\btst\b|justica do trabalho/i,
  cnd_federal: /feder|receita|pgfn|fazenda nacional|divida ativa da uniao|uniao/i,
  cnd_imobiliaria: /imobili|iptu|municip|predial|territorial urban|prefeitura/i,
};

/** Sem acento e em minúsculas — o nome vem do documento, com grafia livre. */
function semAcento(s: string): string {
  return String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/**
 * Acrescenta ao dicionário os campos que só existem no painel definitivo:
 * ônus, cada tipo de certidão e o texto livre do escrevente.
 */
export function enriquecerComPainel(
  dic: Record<string, string>,
  painel: any,
): Record<string, string> {
  const out = { ...dic };
  const onus = painel?.onus ?? [];
  out.onus = textoOnus(onus);

  const certs: any[] = painel?.certidoes ?? [];
  for (const [chave, re] of Object.entries(TIPO_CND)) {
    const c = certs.find((x) => re.test(semAcento(x?.tipo ?? "")));
    if (c) out[chave] = textoCertidao(c);
  }
  // Lista completa, para modelos que trazem um campo único de certidões.
  if (certs.length) {
    out.certidoes = certs.map((c) => `${c.tipo}: ${textoCertidao(c)}`).join("; ");
  }

  const extra = String(painel?.outras_informacoes ?? "").trim();
  if (extra) out.outras_informacoes = extra;

  return out;
}


// ============================================================================
// Qualificação completa por extenso
//
// O campo [QUALIFICAÇÃO COMPLETA DO COMPRADOR] espera a redação notarial
// inteira, não um dado. Montá-la aqui — e não pedir ao modelo de linguagem —
// garante que a mesma pessoa saia com a mesma redação em todos os atos.
// ============================================================================

const dt = (d?: string) => {
  if (!d) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(d);
};

/** "portador do RG nº 12.345 SSP/SP, expedido em 01/02/2010" */
function trechoIdentidade(d: any): string {
  const num = String(d?.rg ?? "").trim();
  if (!num) return "";
  const partes = [
    `portador(a) da cédula de identidade RG nº ${num}`,
    d?.rg_orgao ? String(d.rg_orgao).trim() : "",
    d?.rg_emissao ? `expedida em ${dt(d.rg_emissao)}` : "",
  ].filter(Boolean);
  return partes.join(", ");
}

function trechoEndereco(d: any): string {
  const p = [d?.endereco, d?.bairro, d?.cidade, d?.cep ? `CEP ${d.cep}` : ""]
    .map((x) => String(x ?? "").trim()).filter(Boolean);
  return p.length ? `residente e domiciliado(a) na ${p.join(", ")}` : "";
}

/**
 * Redação completa de uma parte. A ordem segue a praxe notarial:
 * nome, nacionalidade, estado civil (com regime), profissão, identidade,
 * CPF, endereço — e, havendo outorga, o cônjuge na sequência.
 */
export function qualificacaoCompleta(parte: any): string {
  if (!parte?.nome) return "";
  const d = parte.dados ?? {};

  // Pessoa jurídica tem redação própria. Sem isto a construtora saía como
  // "brasileiro(a), residente e domiciliado(a)" — erro que o Registro devolve.
  const digitos = String(parte.cpf_cnpj ?? "").replace(/\D/g, "");
  if (digitos.length === 14) {
    const sede = [d.endereco, d.bairro, d.cidade, d.cep ? `CEP ${d.cep}` : ""]
      .map((x: any) => String(x ?? "").trim()).filter(Boolean).join(", ");
    const rep = d.representante || d.conjuge_nome;
    return [
      String(parte.nome).toUpperCase(),
      "pessoa jurídica de direito privado",
      `inscrita no CNPJ/MF sob o nº ${parte.cpf_cnpj}`,
      sede ? `com sede na ${sede}` : "",
      d.nire ? `NIRE ${d.nire}` : "",
      rep ? `neste ato representada por ${String(rep).toUpperCase()}` : "",
    ].filter(Boolean).join(", ");
  }

  const casado = /casad|uni[ãa]o est[áa]vel/i.test(String(d.estado_civil ?? ""));
  const sepTotal = /separa[çc][ãa]o total/i.test(String(d.regime_bens ?? ""));

  const civil = [
    d.estado_civil,
    casado && d.regime_bens ? `sob o regime de ${d.regime_bens}` : "",
  ].filter(Boolean).join(", ");

  const base = [
    String(parte.nome).toUpperCase(),
    d.nacionalidade || "brasileiro(a)",
    civil,
    d.profissao,
    trechoIdentidade(d),
    parte.cpf_cnpj ? `inscrito(a) no CPF/MF sob o nº ${parte.cpf_cnpj}` : "",
    trechoEndereco(d),
  ].map((x) => String(x ?? "").trim()).filter(Boolean).join(", ");

  // Cônjuge só entra quando há outorga a colher.
  if (casado && !sepTotal && d.conjuge_nome) {
    const c = [
      String(d.conjuge_nome).toUpperCase(),
      d.conjuge_nacionalidade || "brasileiro(a)",
      d.conjuge_profissao,
      d.conjuge_rg ? `portador(a) do RG nº ${d.conjuge_rg}` : "",
      d.conjuge_cpf ? `inscrito(a) no CPF/MF sob o nº ${d.conjuge_cpf}` : "",
    ].map((x) => String(x ?? "").trim()).filter(Boolean).join(", ");
    return `${base}, e seu(sua) cônjuge ${c}`;
  }
  return base;
}

/**
 * Acrescenta ao dicionário as qualificações por extenso, por papel e para o
 * conjunto de cada polo.
 */
export function enriquecerComPartes(
  dic: Record<string, string>, partes: any[],
): Record<string, string> {
  const out = { ...dic };
  const lista = partes ?? [];
  const doPolo = (re: RegExp) => lista.filter((p) => re.test(String(p?.papel ?? "")));

  const compradores = doPolo(/compra|adquir|outorgad|donat[áa]ri/i);
  const vendedores = doPolo(/vend|outorgante|promitente|doador/i);

  const juntar = (arr: any[]) => arr.map(qualificacaoCompleta).filter(Boolean).join("; e ");

  if (compradores.length) {
    out.qualificacao_comprador = juntar(compradores);
    out.comprador_qualificacao = out.qualificacao_comprador;
  }
  if (vendedores.length) {
    out.qualificacao_vendedor = juntar(vendedores);
    out.vendedor_qualificacao = out.qualificacao_vendedor;
  }
  if (lista.length) {
    out.qualificacao_completa = juntar(lista);
    out.qualificacao_das_partes = out.qualificacao_completa;
  }
  return out;
}

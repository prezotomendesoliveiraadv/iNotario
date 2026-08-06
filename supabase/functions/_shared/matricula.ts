// supabase/functions/_shared/matricula.ts
// Regras de cartório sobre a matrícula: classifica ônus/gravames e a continuidade
// registral (titularidade), e sugere as cláusulas/exigências correspondentes.

export function norm(s: string) {
  return (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export interface Alerta { item: string; status: "ok" | "atencao" | "pendente"; fundamento: string }

const BLOQUEANTE: [string, string, string][] = [
  ["indisponib", "Indisponibilidade de bens", "Indisponibilidade averbada impede a alienação até o seu levantamento (CNIB/CNJ)."],
  ["penhora", "Penhora", "Penhora registrada: a alienação caracteriza fraude à execução (art. 792, CPC)."],
  ["arresto", "Arresto", "Constrição judicial sobre o bem: impede a livre disposição."],
  ["sequestro", "Sequestro", "Constrição judicial sobre o bem: impede a livre disposição."],
  ["premonit", "Averbação premonitória (execução)", "Averbação de execução (art. 828, CPC): risco de fraude à execução."],
  ["reipersecut", "Ação reipersecutória", "Demanda que pode recair sobre o imóvel; alienação de alto risco."],
  ["inalienab", "Cláusula de inalienabilidade", "Impede a alienação enquanto vigente (art. 1.911, CC)."],
];
const ATENCAO: [string, string, string][] = [
  ["hipotec", "Hipoteca", "Exige anuência e/ou quitação do credor hipotecário para a transmissão."],
  ["fiduci", "Alienação fiduciária", "Propriedade resolúvel do credor fiduciário; necessária quitação/anuência."],
  ["alienac", "Alienação fiduciária", "Propriedade resolúvel do credor fiduciário; necessária quitação/anuência."],
  ["usufrut", "Usufruto", "Direito real de terceiro: o usufrutuário deve anuir ao ato."],
  ["servid", "Servidão", "Ônus real que acompanha o imóvel; registre o reflexo no ato."],
  ["bem de fam", "Bem de família", "Verifique a impenhorabilidade e eventuais restrições à disposição."],
  ["impenhorab", "Impenhorabilidade", "Cláusula restritiva: verifique o alcance antes do ato."],
  ["incomunicab", "Incomunicabilidade", "Cláusula restritiva: verifique o alcance antes do ato."],
];

function transmitentes(partes: any[]) {
  return (partes ?? []).filter((p: any) => /vendedor|doador|outorgante|transmitente/i.test(p.papel || ""));
}
function titularidadeDivergente(matricula: any, partes: any[]): any[] {
  const props = (matricula?.proprietarios ?? []).map((s: string) => norm(s)).filter(Boolean);
  const out: any[] = [];
  if (!props.length) return out;
  for (const v of transmitentes(partes)) {
    const toks = norm(v.nome || "").split(/\s+/).filter((w: string) => w.length > 2);
    const bate = toks.length > 0 && props.some((pr: string) => toks.every((tk: string) => pr.includes(tk)) || toks.some((tk: string) => pr.includes(tk)));
    if (v.nome && !bate) out.push(v);
  }
  return out;
}

// Alertas para o parecer de qualificação (triagem e compilação)
export function analisarMatricula(matricula: any, partes: any[]): Alerta[] {
  if (!matricula) return [];
  const alertas: Alerta[] = [];
  for (const o of (matricula.onus ?? [])) {
    const t = norm(`${o?.tipo ?? ""} ${o?.detalhe ?? ""}`);
    if (!t.trim()) continue;
    const b = BLOQUEANTE.find(([k]) => t.includes(k));
    const a = ATENCAO.find(([k]) => t.includes(k));
    if (b) alertas.push({ item: `Ônus na matrícula: ${b[1]}`, status: "pendente", fundamento: b[2] });
    else if (a) alertas.push({ item: `Ônus na matrícula: ${a[1]}`, status: "atencao", fundamento: a[2] });
    else alertas.push({ item: `Averbação na matrícula: ${o.tipo || o.detalhe}`, status: "atencao", fundamento: "Ônus/averbação registrado — avaliar o reflexo no ato." });
  }
  if (matricula.ha_indisponibilidade && !alertas.some((x) => /indisponib/i.test(x.item)))
    alertas.push({ item: "Indisponibilidade de bens", status: "pendente", fundamento: "Indisponibilidade indicada na matrícula: impede a alienação até o levantamento." });
  for (const v of titularidadeDivergente(matricula, partes))
    alertas.push({ item: `Conferir titularidade de "${v.nome}"`, status: "atencao", fundamento: "O transmitente deve constar como proprietário na matrícula (princípio da continuidade, art. 195 da LRP). Confirme a cadeia dominial." });
  return alertas;
}

// Instruções de cláusula/exigência para a redação da minuta
export function clausulasMatricula(matricula: any, partes: any[]): string[] {
  if (!matricula) return [];
  const out: string[] = [];
  for (const o of (matricula.onus ?? [])) {
    const t = norm(`${o?.tipo ?? ""} ${o?.detalhe ?? ""}`);
    if (!t.trim()) continue;
    if (t.includes("hipotec"))
      out.push("HIPOTECA: inserir cláusula condicionando a transmissão à quitação da hipoteca registrada (ou à anuência expressa do credor hipotecário), com apresentação do termo de quitação/baixa na matrícula.");
    else if (t.includes("fiduci") || t.includes("alienac"))
      out.push("ALIENAÇÃO FIDUCIÁRIA: condicionar à quitação e à baixa da propriedade fiduciária; exigir a anuência do credor fiduciário.");
    else if (t.includes("usufrut"))
      out.push("USUFRUTO: exigir a anuência e a participação do usufrutuário no ato (ou a extinção/renúncia do usufruto, com a devida averbação).");
    else if (t.includes("servid"))
      out.push("SERVIDÃO: mencionar a servidão na escritura e ressalvar sua manutenção, pois acompanha o imóvel.");
    else if (t.includes("indisponib"))
      out.push("INDISPONIBILIDADE: NÃO lavrar enquanto vigente; exigir a certidão de levantamento da indisponibilidade (CNIB) antes do ato.");
    else if (t.includes("penhora") || t.includes("arresto") || t.includes("sequestro"))
      out.push("CONSTRIÇÃO JUDICIAL (penhora/arresto/sequestro): exigir a baixa/levantamento e advertir as partes sobre fraude à execução (art. 792, CPC).");
    else if (t.includes("premonit") || t.includes("reipersecut"))
      out.push("AVERBAÇÃO DE EXECUÇÃO/AÇÃO REIPERSECUTÓRIA: advertir sobre o risco de fraude à execução e condicionar o ato à regularização, com certidões.");
    else if (t.includes("inalienab"))
      out.push("INALIENABILIDADE: ato vedado enquanto vigente, salvo sub-rogação ou autorização judicial — exigir o respectivo título.");
    else if (t.includes("impenhorab") || t.includes("incomunicab") || t.includes("bem de fam"))
      out.push(`CLÁUSULA RESTRITIVA (${o.tipo}): mencionar e verificar o alcance antes do ato.`);
    else
      out.push(`AVERBAÇÃO "${o.tipo || o.detalhe}": avaliar o reflexo e ressalvar na minuta.`);
  }
  for (const v of titularidadeDivergente(matricula, partes))
    out.push(`CONTINUIDADE REGISTRAL: o transmitente "${v.nome}" não confere com a titularidade da matrícula — sanar a cadeia dominial (art. 195, LRP) antes de lavrar.`);
  return out;
}

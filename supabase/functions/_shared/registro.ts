// supabase/functions/_shared/registro.ts
// Pré-qualificação registral preventiva: avalia o título contra os princípios
// do Registro de Imóveis e aponta o que geraria EXIGÊNCIA na serventia registral.
// Determinístico (auditável); a Artemis complementa com leitura fina, se disponível.

import { norm, analisarMatricula, type Alerta } from "./matricula.ts";

export type Aptidao = "apto" | "exigencia" | "bloqueio";
export interface ItemRegistral {
  principio: string;      // Especialidade objetiva, Continuidade, etc.
  item: string;           // o ponto verificado
  situacao: "ok" | "exigencia" | "bloqueio";
  fundamento: string;     // base legal / motivo
}

const vazio = (v: unknown) => !v || String(v).trim() === "";
function achou(hay: string, re: RegExp) { return re.test(norm(hay)); }

// Recebe a "ficha" do ato (intake/dados/partes/imovel) e a matrícula estruturada.
export function preQualificarRegistro(ctx: {
  tipoSlug?: string;
  imovel?: any;                 // { matricula, cartorio_ri, endereco, descricao, area, valor, ... }
  matricula?: any;              // estruturada (onus[], proprietarios[], ha_indisponibilidade)
  partes?: any[];               // [{ papel, nome, cpf, estado_civil, regime_bens, ... }]
  dados?: Record<string, any>;  // valor, itbi_pago, forma_pagamento, ...
}): { itens: ItemRegistral[]; aptidao: Aptidao; resumo: string } {
  const itens: ItemRegistral[] = [];
  const imovel = ctx.imovel ?? {};
  const partes = ctx.partes ?? [];
  const dados = ctx.dados ?? {};
  const ehImovel = /imovel|compra|venda|permuta|doacao|dacao|hipotec/.test(norm(ctx.tipoSlug ?? "")) || !vazio(imovel.matricula) || !vazio(imovel.descricao);

  const add = (principio: string, item: string, situacao: ItemRegistral["situacao"], fundamento: string) =>
    itens.push({ principio, item, situacao, fundamento });

  // ---- Especialidade objetiva (o imóvel deve estar perfeitamente identificado) ----
  if (ehImovel) {
    if (vazio(imovel.matricula))
      add("Especialidade objetiva", "Número da matrícula ausente", "exigencia", "O título deve indicar a matrícula do imóvel (individualização); sem ela o registro não localiza o bem.");
    if (vazio(imovel.cartorio_ri))
      add("Especialidade objetiva", "Cartório de Registro de Imóveis (RI) não informado", "exigencia", "Indicar a serventia registral competente pela circunscrição do imóvel.");
    if (vazio(imovel.descricao) && vazio(imovel.endereco))
      add("Especialidade objetiva", "Descrição/endereço do imóvel ausente", "exigencia", "A descrição deve permitir a perfeita identificação do imóvel e conferir com a matrícula.");
    if (vazio(imovel.area) && vazio(dados.area))
      add("Especialidade objetiva", "Área do imóvel não informada", "exigencia", "Conferir a área com a matrícula; divergência de área pode exigir retificação (art. 213 da LRP).");
  }

  // ---- Especialidade subjetiva (qualificação completa das partes) ----
  const papelTransmitente = (p: any) => /vendedor|outorgante|doador|transmitente|cedente/.test(norm(p.papel ?? ""));
  for (const p of partes) {
    const quem = p.nome || "(sem nome)";
    if (vazio(p.cpf))
      add("Especialidade subjetiva", `CPF/CNPJ de "${quem}" ausente`, "exigencia", "A qualificação das partes exige CPF/CNPJ (individualização subjetiva).");
    if (vazio(p.estado_civil))
      add("Especialidade subjetiva", `Estado civil de "${quem}" ausente`, "exigencia", "Estado civil (e regime de bens, se casado) é essencial para a qualificação e a outorga conjugal.");
    if (achou(p.estado_civil ?? "", /casad/) && vazio(p.regime_bens))
      add("Especialidade subjetiva", `Regime de bens de "${quem}" não informado`, "exigencia", "Casado(a): informar o regime de bens; pode ser necessária a outorga/vênia conjugal.");
    // Outorga conjugal do transmitente casado (salvo separação absoluta)
    if (papelTransmitente(p) && achou(p.estado_civil ?? "", /casad/) && !achou(p.regime_bens ?? "", /separacao absoluta|separacao total/))
      add("Consentimento", `Outorga conjugal do transmitente "${quem}"`, "exigencia", "Alienação de imóvel por pessoa casada exige a participação/anuência do cônjuge (art. 1.647, I, do Código Civil), salvo separação absoluta.");
  }
  if (partes.length === 0)
    add("Especialidade subjetiva", "Partes não qualificadas", "bloqueio", "Sem partes qualificadas não há como registrar o título.");

  // ---- Continuidade + disponibilidade + ônus (reaproveita a análise da matrícula) ----
  const daMatricula: Alerta[] = analisarMatricula(ctx.matricula, partes);
  for (const a of daMatricula) {
    const situacao = a.status === "pendente" ? "bloqueio" : "exigencia";
    const principio = /titularidade|continuidade/i.test(a.item) ? "Continuidade"
      : /indisponib|penhora|arresto|sequestro|inalienab/i.test(a.item) ? "Disponibilidade" : "Ônus reais";
    add(principio, a.item, situacao, a.fundamento);
  }
  if (ctx.matricula && (ctx.matricula.proprietarios?.length ?? 0) === 0 && !vazio(imovel.matricula))
    add("Continuidade", "Titularidade atual da matrícula não confirmada", "exigencia", "Confirmar o proprietário tabular atual para verificar a continuidade (art. 195 da LRP).");

  // ---- Tributos (o registro exige a comprovação) ----
  if (ehImovel) {
    const compraVenda = /compra|venda|permuta|dacao/.test(norm(ctx.tipoSlug ?? ""));
    const doacao = /doacao/.test(norm(ctx.tipoSlug ?? ""));
    const itbiPago = dados.itbi_pago === true || !vazio(dados.itbi) || achou(String(dados.tributos ?? ""), /itbi/);
    const itcmdPago = dados.itcmd_pago === true || !vazio(dados.itcmd) || achou(String(dados.tributos ?? ""), /itcmd/);
    if (compraVenda && !itbiPago)
      add("Tributos", "ITBI não comprovado", "exigencia", "Transmissão onerosa: exigir a guia de ITBI paga (municipal) antes do registro.");
    if (doacao && !itcmdPago)
      add("Tributos", "ITCMD não comprovado", "exigencia", "Transmissão gratuita (doação): exigir a comprovação do ITCMD (estadual).");
    if (vazio(dados.valor) && vazio(imovel.valor))
      add("Tributos", "Valor do ato não informado", "exigencia", "Informar o valor da transação (base de cálculo dos tributos e dos emolumentos).");
  }

  // ---- Formalidade / instrumento ----
  if (!vazio(dados.valor) || !vazio(imovel.valor)) {
    // (verificação de valor x 30 salários mínimos p/ escritura pública fica a cargo do tabelião)
  }

  // ---- Consolidação ----
  const temBloqueio = itens.some((i) => i.situacao === "bloqueio");
  const temExig = itens.some((i) => i.situacao === "exigencia");
  const aptidao: Aptidao = temBloqueio ? "bloqueio" : temExig ? "exigencia" : "apto";
  const nExig = itens.filter((i) => i.situacao === "exigencia").length;
  const nBloq = itens.filter((i) => i.situacao === "bloqueio").length;
  const resumo = aptidao === "apto"
    ? "Título aparentemente apto para registro: os pontos essenciais de qualificação registral estão presentes. Conferência final do tabelião."
    : aptidao === "bloqueio"
      ? `Há ${nBloq} ponto(s) impeditivo(s) e ${nExig} exigência(s): resolver os bloqueios (ex.: ônus/indisponibilidade) antes de lavrar.`
      : `Título quase apto: ${nExig} exigência(s) a sanar para reduzir o risco de devolução no Registro de Imóveis.`;

  return { itens, aptidao, resumo };
}

export const APTIDAO_LABEL: Record<Aptidao, string> = {
  apto: "Apto para registro", exigencia: "Exigências a sanar", bloqueio: "Impeditivo (bloqueio)",
};

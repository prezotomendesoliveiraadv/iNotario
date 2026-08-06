// supabase/functions/artemis-extract/index.ts
// Lê um documento (RG, CNH ou matrícula) vinculado à solicitação e extrai os
// campos pertinentes para preenchimento e POSTERIOR VALIDAÇÃO humana.
// Body: { "documentoId": "<uuid>" }   (usuário autenticado da equipe)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders, json } from "../_shared/cors.ts";
import { respostaErro } from "../_shared/erros.ts";
import { callModelVision, PROVEDOR_ATIVO, MODELO_ATIVO } from "../_shared/artemis.ts";

const SYSTEM = `Você é Artemis, especialista em qualificação notarial. Leia o documento fornecido e extraia EXATAMENTE os dados solicitados. Não invente: se um campo estiver ilegível ou ausente, retorne string vazia. Não normalize além do necessário. Responda SOMENTE com JSON válido, sem texto fora do JSON e sem cercas de código.`;

function instrucao(tipo: string): string {
  if (tipo === "rg" || tipo === "cnh") {
    return `Documento de identificação (${tipo.toUpperCase()}) de uma das partes. Extraia e responda SOMENTE com:
{ "nome":"", "cpf":"", "rg":"", "data_nascimento":"", "filiacao":"", "nacionalidade":"", "endereco":"" }`;
  }
  if (tipo === "matricula") {
    return `Matrícula de imóvel do Registro de Imóveis. Extraia e responda SOMENTE com:
{ "imovel_matricula":"", "imovel_cartorio_ri":"", "imovel_descricao":"", "proprietarios":[""], "area":"",
  "onus":[ {"tipo":"", "detalhe":""} ], "ha_indisponibilidade": false }
Em "onus", liste TODAS as averbações de ônus, gravames ou restrições que aparentem estar ATIVAS na matrícula: hipoteca, penhora, arresto, sequestro, indisponibilidade, alienação fiduciária, usufruto, servidão, cláusula de inalienabilidade/impenhorabilidade/incomunicabilidade, bem de família, ação reipersecutória e averbação premonitória de execução. Se não houver nenhuma, retorne lista vazia. Não invente.`;
  }
  if (tipo === "certidao") {
    return `Certidão (negativa de débitos, ônus reais, distribuidor, trabalhista, FGTS, etc.).
Extraia e responda SOMENTE com:
{ "certidao_tipo":"", "orgao_emissor":"", "numero":"", "emitida_em":"AAAA-MM-DD",
  "validade":"AAAA-MM-DD", "prazo_dias":0, "resultado":"negativa|positiva|positiva com efeito de negativa|indefinido",
  "titular":"", "cpf_cnpj":"", "observacoes":"" }
Regras: datas SEMPRE em AAAA-MM-DD. Se a certidão indicar apenas prazo de validade em dias (ex.: "válida por 90 dias"),
preencha "prazo_dias" e calcule "validade" a partir da emissão. Se a validade não constar, deixe "" — não invente.`;
  }
  if (tipo === "procuracao") {
    return `Procuração (pública ou particular). Extraia e responda SOMENTE com:
{ "outorgante":"", "outorgante_cpf_cnpj":"", "outorgado":"", "outorgado_cpf":"",
  "lavrada_em":"AAAA-MM-DD", "validade":"AAAA-MM-DD", "prazo":"", "irrevogavel": false,
  "poderes":"", "poderes_para_alienar": false, "substabelecimento_permitido": false,
  "tabelionato":"", "livro":"", "folha":"" }
Regras: datas em AAAA-MM-DD. "poderes_para_alienar" só true se houver poderes EXPRESSOS para vender/alienar/dar quitação.
Se o instrumento não indicar prazo, deixe "validade" vazia e descreva em "prazo" (ex.: "sem prazo determinado"). Não invente.`;
  }
  if (tipo === "compromisso") {
    return `Compromisso/contrato particular de compra e venda de imóvel. Extraia e responda SOMENTE com:
{ "vendedores":[ {"nome":"","cpf_cnpj":"","estado_civil":"","regime_bens":"","profissao":"","endereco":""} ],
  "compradores":[ {"nome":"","cpf_cnpj":"","estado_civil":"","regime_bens":"","profissao":"","endereco":""} ],
  "empreendimento":"", "unidade":"", "torre_bloco":"", "vaga_garagem":"",
  "imovel_descricao":"", "imovel_matricula":"", "imovel_cartorio_ri":"",
  "valor_total":"", "forma_pagamento":"", "sinal":"", "saldo":"",
  "financiamento": false, "instituicao_financeira":"",
  "data_contrato":"AAAA-MM-DD", "prazo_entrega":"", "clausulas_relevantes":[""] }
Regras: liste TODAS as partes de cada polo. Valores como aparecem no contrato. Em "clausulas_relevantes",
registre cláusulas com efeito notarial (retrovenda, reversão, condição resolutiva, arras, alienação fiduciária).
Não invente dados ausentes: use "" ou lista vazia.`;
  }
  return `Extraia os dados relevantes do documento e responda SOMENTE com um objeto JSON de pares campo/valor.`;
}

function parseJson(txt: string): any {
  let t = txt.trim().replace(/^```(json)?/i, "").replace(/```$/, "").trim();
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a >= 0 && b > a) t = t.slice(a, b + 1);
  return JSON.parse(t);
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = ""; const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);

  try {
    const { documentoId } = await req.json();
    if (!documentoId) return json({ error: "documentoId é obrigatório" }, 400);

    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // valida acesso pelo RLS do usuário
    const { data: doc, error: eDoc } = await userClient
      .from("documentos").select("*").eq("id", documentoId).maybeSingle();
    if (eDoc || !doc) return json({ error: "Documento não encontrado ou sem acesso." }, 404);

    // baixa o arquivo do storage (service role) e converte para base64
    const { data: blob, error: eDl } = await admin.storage.from("documentos").download((doc as any).storage_path);
    if (eDl || !blob) return json({ error: "Falha ao ler o arquivo no storage." }, 500);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const mime = (doc as any).mime || blob.type || "image/jpeg";

    const tipo = (doc as any).tipo as string;
    const raw = await callModelVision(SYSTEM, instrucao(tipo), [{ mime, data: bytesToBase64(bytes) }], 1500);

    let extraido: any;
    try { extraido = parseJson(raw); }
    catch { return json({ error: "Não foi possível interpretar a leitura do documento." }, 502); }

    // Datas de vigência: quando a IA lê uma certidão ou procuração, a validade
    // vai para COLUNA própria — é o que alimenta os alertas de vencimento.
    const dataISO = (v: unknown): string | null => {
      const t = String(v ?? "").trim();
      return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null;
    };
    let validade = dataISO(extraido?.validade);
    const emitida = dataISO(extraido?.emitida_em) ?? dataISO(extraido?.lavrada_em);
    // certidão que informa só o prazo em dias: calcula o vencimento
    const prazo = Number(extraido?.prazo_dias ?? 0);
    if (!validade && emitida && prazo > 0) {
      const d = new Date(emitida + "T12:00:00Z");
      d.setUTCDate(d.getUTCDate() + prazo);
      validade = d.toISOString().slice(0, 10);
    }

    const patch: Record<string, unknown> = { extraido, status: "extraido" };
    if (validade) patch.validade = validade;
    if (emitida) patch.emitida_em = emitida;
    if (tipo === "certidao" || tipo === "procuracao") patch.vincular_escritura = true;

    // grava o resultado para validação
    await admin.from("documentos").update(patch).eq("id", documentoId);
    await admin.rpc("registrar_custodia", {
      p_solicitacao: (doc as any).solicitacao_id, p_minuta: null, p_acao: "documento_extraido",
      p_detalhe: { tipo, modelo: MODELO_ATIVO, provedor: PROVEDOR_ATIVO, pseudonimizado: false },
    });

    return json({ ok: true, tipo, extraido });
  } catch (e) {
    return await respostaErro("artemis-extract", e, 500);
  }
});

// supabase/functions/artemis-compile/index.ts
// Etapa de compilação (gatilho de satisfação).
// ELABORACAO: pede JSON estrito, grava a minuta (hash + custódia automática via trigger)
//             e avança o status da solicitação.
// QUALIFICACAO: devolve o relatório de qualificação, sem inserir minuta.
//
// Body (JSON):
// {
//   "mode": "ELABORACAO" | "QUALIFICACAO",
//   "context": {...}, "caseData": "...", "messages": [...],
//   "solicitacaoId": "<uuid>",            // obrigatório no modo ELABORACAO
//   "tipoMinuta": "provisoria" | "definitiva"
// }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders, json } from "../_shared/cors.ts";
import { respostaErro } from "../_shared/erros.ts";
import {
  buildSystemPrompt, callClaude, callModel, extrairJson, sha256, PROVEDOR_ATIVO, MODELO_ATIVO,
  type Modo, type Contexto, type Msg,
} from "../_shared/artemis.ts";
import { criarCofre, type Entidade } from "../_shared/tokenizer.ts";
import { clausulasMatricula, analisarMatricula } from "../_shared/matricula.ts";

const ESQUEMA_ELABORACAO = `Responda SOMENTE com um objeto JSON válido (sem texto fora do JSON, sem cercas de código), no formato:
{
  "tipo_ato": "string (slug, ex.: compra-venda-imovel|doacao|procuracao|outro)",
  "titulo": "string",
  "minuta_markdown": "documento completo e editável em Markdown, padrão notarial brasileiro (título; comparecimento e qualificação das partes; cláusulas numeradas; fecho com leitura e assinaturas). Dados não confirmados como [PLACEHOLDERS].",
  "partes": [ { "papel":"", "nome":"", "cpf_cnpj":"", "estado_civil":"", "regime":"", "representacao":"" } ],
  "qualificacao": [ { "item":"", "status":"ok|atencao|pendente", "fundamento":"" } ],
  "placeholders_pendentes": ["[...]"],
  "metadados": { "valor":"", "forma_pagamento":"", "tributos": {"itbi":"","itcmd":""}, "conformidade": [] }
}`;

const ESQUEMA_QUALIFICACAO = `Responda SOMENTE com um objeto JSON válido (sem texto fora do JSON, sem cercas de código), no formato:
{
  "resumo": "2 a 3 frases",
  "qualificacao": [ { "item":"", "status":"ok|atencao|pendente", "fundamento":"" } ],
  "pendencias_bloqueantes": ["..."]
}`;

function parseJson(txt: string): any {
  let t = txt.trim().replace(/^```(json)?/i, "").replace(/```$/, "").trim();
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a >= 0 && b > a) t = t.slice(a, b + 1);
  return JSON.parse(t);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);

  try {
    const body = await req.json();
    const mode: Modo = body.mode === "QUALIFICACAO" ? "QUALIFICACAO" : "ELABORACAO";
    const ctx: Contexto = {
      nome: body.context?.nome ?? "",
      tratamento: body.context?.tratamento ?? "Dr.",
      papel: body.context?.papel ?? "tabeliao",
      serventia: body.context?.serventia ?? "",
      tipoAto: body.context?.tipoAto ?? "a definir",
    };
    const caseData: string = body.caseData ?? "";
    const messages: Msg[] = Array.isArray(body.messages) ? body.messages.slice() : [];
    const tipoMinuta = body.tipoMinuta === "definitiva" ? "definitiva" : "provisoria";

    const dataHora = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });

    // ----- Pseudonimização: cofre efêmero no servidor -----
    const pii: Entidade[] = Array.isArray(body.pii) ? body.pii : [];
    // ---------------------------------------------------------------------
    // MODELO PADRÃO E CLÁUSULAS ESPECIAIS
    // Precedência do modelo: empreendimento → construtora → acervo padrão.
    // Sendo negócio de construtora já cadastrada, a minuta NASCE do modelo
    // dela, e não de um texto genérico.
    // ---------------------------------------------------------------------
    let blocoModelo = "";
    let blocoClausulas = "";
    let modeloFonte: string | null = null;
    if (body.solicitacaoId) {
      const admin2 = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

      const { data: mod } = await admin2.rpc("modelo_para_solicitacao", { p_solicitacao: body.solicitacaoId });
      const m = ((mod as any[]) ?? [])[0];
      if (m?.texto) {
        modeloFonte = m.fonte;
        blocoModelo = `

MODELO PADRÃO A SEGUIR (fonte: ${m.fonte === "empreendimento" ? "modelo do empreendimento" : m.fonte === "construtora" ? "modelo da construtora" : "modelo padrão do acervo"} — "${m.titulo}"):
"""
${String(m.texto).slice(0, 12000)}
"""
INSTRUÇÃO SOBRE O MODELO: use esta redação como BASE da minuta — preserve a estrutura, a ordem das cláusulas e a terminologia.
Substitua os dados pelas informações reais deste ato. Não descarte cláusulas do modelo sem motivo jurídico; se alguma for
inaplicável, mantenha a numeração coerente e registre a supressão em "alertas".`;
      }

      const { data: cls } = await admin2.from("solicitacao_clausulas")
        .select("nome, texto, ordem").eq("solicitacao_id", body.solicitacaoId).order("ordem");
      if (((cls as any[]) ?? []).length) {
        blocoClausulas = `

CLÁUSULAS ESPECIAIS SELECIONADAS PELO CARTÓRIO (inserir na minuta, na ordem indicada):
${(cls as any[]).map((c, i) => `[${i + 1}] ${c.nome}\n${c.texto}`).join("\n\n")}
INSTRUÇÃO: incorpore cada uma como cláusula própria, ajustando os [placeholders] aos dados reais do ato e
mantendo a numeração sequencial do documento. Não altere o efeito jurídico do texto padrão.`;
      }
    }

    const cofre = criarCofre(pii, [caseData + blocoModelo + blocoClausulas, ...messages.map((m) => m.content)]);
    const caseDataTok = cofre.tokenizar(caseData + blocoModelo + blocoClausulas);
    const messagesTok: Msg[] = messages.map((m) => ({ role: m.role, content: cofre.tokenizar(m.content) }));

    const system = buildSystemPrompt(mode, "TEXTO", ctx, caseDataTok, dataHora);
    const esquema = mode === "ELABORACAO" ? ESQUEMA_ELABORACAO : ESQUEMA_QUALIFICACAO;

    // Cliente Supabase — também lê a matrícula e grava a minuta
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } },
    );

    // Ônus da matrícula -> cláusulas/exigências na minuta + alertas no parecer
    let exigenciasTok = "";
    let alertasOnus: any[] = [];
    if (mode === "ELABORACAO" && body.solicitacaoId) {
      const { data: partesDb } = await supabase.from("partes").select("papel, nome").eq("solicitacao_id", body.solicitacaoId);
      const { data: docsMat } = await supabase.from("documentos")
        .select("extraido, status, created_at").eq("solicitacao_id", body.solicitacaoId).eq("tipo", "matricula")
        .order("created_at", { ascending: false });
      const matricula = (docsMat ?? []).find((d: any) => d.status === "validado" && d.extraido)?.extraido
        ?? (docsMat ?? []).find((d: any) => d.extraido)?.extraido ?? null;
      const clausulas = clausulasMatricula(matricula, partesDb ?? []);
      alertasOnus = analisarMatricula(matricula, partesDb ?? []);
      if (clausulas.length) {
        exigenciasTok = cofre.tokenizar(
          `\n\nEXIGÊNCIAS E CLÁUSULAS OBRIGATÓRIAS decorrentes da matrícula — inclua na minuta as cláusulas/ressalvas correspondentes e relacione cada ponto no campo "qualificacao":\n- ${clausulas.join("\n- ")}`,
        );
      }
    }

    // Mensagem final de formatação estrita
    const compileMessages: Msg[] = [
      ...messagesTok,
      { role: "user", content: `Compile agora o resultado deste atendimento. ${esquema}${exigenciasTok}` },
    ];
    const raw = await callModel(system, compileMessages, 4000, { json: true });
    // Reidrata todo o JSON (minuta, alertas, partes, metadados) com os dados reais
    const result = cofre.reidratarProfundo(extrairJson(raw)) as any;

    if (mode === "QUALIFICACAO") {
      return json({ mode, ...result, pseudonimizado: cofre.tamanho });
    }

    // funde os alertas determinísticos de ônus/titularidade no parecer
    if (alertasOnus.length) result.qualificacao = [...(result.qualificacao ?? []), ...alertasOnus];

    // ----- ELABORAÇÃO: grava a minuta (custódia automática via trigger) -----
    const solicitacaoId = body.solicitacaoId;
    if (!solicitacaoId) return json({ error: "solicitacaoId é obrigatório no modo ELABORACAO." }, 400);

    const conteudo: string = result.minuta_markdown ?? "";
    const hash = await sha256(conteudo);
    const qualificacao = Array.isArray(result.qualificacao) ? result.qualificacao : [];

    // próxima versão
    const { data: ult } = await supabase
      .from("minutas").select("versao").eq("solicitacao_id", solicitacaoId)
      .order("versao", { ascending: false }).limit(1).maybeSingle();
    const versao = ((ult?.versao as number) ?? 0) + 1;

    const { data: minuta, error: errM } = await supabase
      .from("minutas")
      .insert({ solicitacao_id: solicitacaoId, versao, tipo: tipoMinuta, conteudo, hash, qualificacao })
      .select("*").single();
    if (errM) throw new Error("Falha ao gravar minuta: " + errM.message);

    // avança status (a custódia do minuta_gerada é registrada pelo trigger)
    const novoStatus = tipoMinuta === "definitiva" ? "aprovada" : "em_elaboracao";
    await supabase.from("solicitacoes").update({ status: novoStatus }).eq("id", solicitacaoId);

    // registra na cadeia de custódia a comprovação da medida técnica (sem PII)
    await supabase.rpc("registrar_custodia", {
      p_solicitacao: solicitacaoId,
      p_minuta: minuta.id,
      p_acao: "ia_pseudonimizada",
      p_detalhe: {
        tokens: cofre.tamanho,
        modelo: MODELO_ATIVO,
        provedores: [PROVEDOR_ATIVO],
      },
    });

    return json({
      mode, minuta, qualificacao,
      modelo_fonte: modeloFonte,     // de onde veio a base da minuta
      partes: result.partes ?? [],
      metadados: result.metadados ?? {},
      placeholders_pendentes: result.placeholders_pendentes ?? [],
    });
  } catch (e) {
    return await respostaErro("artemis-compile", e, 500);
  }
});

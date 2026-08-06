// supabase/functions/registro-prequalificar/index.ts
// Pré-qualificação registral preventiva: monta o contexto do ato (partes, imóvel,
// matrícula, tributos), roda o checklist determinístico de aptidão registral e,
// se houver IA disponível, agrega uma leitura fina. Grava o resultado e devolve.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders, json } from "../_shared/cors.ts";
import { respostaErro } from "../_shared/erros.ts";
import { preQualificarRegistro, APTIDAO_LABEL } from "../_shared/registro.ts";
import { callModel, PROVEDOR_ATIVO } from "../_shared/artemis.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);

  let solicId: string | undefined;
  try {
    const { solicitacaoId } = await req.json();
    solicId = solicitacaoId;
    if (!solicitacaoId) return json({ error: "solicitacaoId é obrigatório." }, 400);

    const auth = req.headers.get("Authorization") ?? "";
    const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: sol } = await userClient.from("solicitacoes").select("*, tipos_ato(*)").eq("id", solicitacaoId).maybeSingle();
    if (!sol) return json({ error: "Solicitação não encontrada ou sem acesso." }, 404);
    const s: any = sol;

    const { data: partesRaw } = await userClient.from("partes").select("*").eq("solicitacao_id", solicitacaoId);
    const partes = (partesRaw ?? []).map((p: any) => ({
      papel: p.papel, nome: p.nome, cpf: p.cpf_cnpj,
      estado_civil: p.dados?.estado_civil, regime_bens: p.dados?.regime_bens,
    }));

    const { data: docsMat } = await userClient.from("documentos")
      .select("extraido, status").eq("solicitacao_id", solicitacaoId).eq("tipo", "matricula").order("created_at", { ascending: false });
    const matricula: any = (docsMat ?? []).find((d: any) => d.status === "validado" && d.extraido)?.extraido
      ?? (docsMat ?? [])[0]?.extraido ?? null;

    const intake = s.intake ?? {};
    const imovel = {
      matricula: intake.matricula || matricula?.imovel_matricula || s.dados?.imovel_matricula,
      cartorio_ri: intake.cartorio_ri || matricula?.imovel_cartorio_ri || s.dados?.imovel_cartorio_ri,
      endereco: intake.endereco || s.dados?.endereco,
      descricao: intake.descricao_objeto || s.dados?.imovel_descricao,
      area: s.dados?.area || intake.area,
      valor: intake.valor || s.dados?.valor,
    };

    // 1) Checklist determinístico (auditável)
    const base = preQualificarRegistro({
      tipoSlug: s.tipos_ato?.slug, imovel, matricula, partes, dados: s.dados ?? {},
    });

    // 2) Complemento da IA (best-effort — nunca derruba o resultado determinístico)
    let notaIA = "";
    try {
      const ctx = [
        `Tipo de ato: ${s.tipos_ato?.nome ?? "—"}`,
        `Imóvel: matrícula ${imovel.matricula ?? "—"} (${imovel.cartorio_ri ?? "RI não informado"}); ${imovel.descricao ?? imovel.endereco ?? "sem descrição"}`,
        `Partes: ${partes.map((p) => `${p.papel}: ${p.nome}${p.cpf ? ", " + p.cpf : ""}${p.estado_civil ? ", " + p.estado_civil : ""}`).join(" | ") || "—"}`,
        `Ônus lidos na matrícula: ${(matricula?.onus ?? []).map((o: any) => o.tipo).join("; ") || "nenhum aparente"}`,
        `Checklist automático: ${base.itens.map((i) => `${i.item} [${i.situacao}]`).join("; ") || "sem apontamentos"}`,
      ].join("\n");
      const sys = "Você é Artemis, especialista em qualificação REGISTRAL (Registro de Imóveis) apoiando o tabelião de notas. Com base no contexto, aponte em 2 a 4 frases curtas quais pontos ADICIONAIS poderiam gerar exigência no registro (continuidade, especialidade, tributos, formalidades, certidões), citando o fundamento quando souber. Não repita o checklist automático. Se nada relevante, diga que o checklist cobre o essencial. Fé pública indelegável: você prepara, o registrador decide.";
      notaIA = await callModel(sys, [{ role: "user", content: ctx }], 500);
    } catch { notaIA = ""; }

    const resultado = {
      aptidao: base.aptidao, aptidao_label: APTIDAO_LABEL[base.aptidao],
      resumo: base.resumo, itens: base.itens, nota_ia: notaIA,
      provedor: notaIA ? PROVEDOR_ATIVO : null, gerado_em: new Date().toISOString(),
    };

    // 3) Persiste em triagem (reusa a tabela) e registra custódia
    await admin.from("triagem").insert({ solicitacao_id: solicitacaoId, resultado: { prequalificacao_registral: resultado } });
    await admin.rpc("registrar_custodia", {
      p_solicitacao: solicitacaoId, p_minuta: null, p_acao: "prequalificacao_registral",
      p_detalhe: { aptidao: base.aptidao, exigencias: base.itens.filter((i) => i.situacao !== "ok").length },
    });

    return json({ ok: true, ...resultado });
  } catch (e) {
    return await respostaErro("registro-prequalificar", e, 500, { solicitacaoId: solicId });
  }
});

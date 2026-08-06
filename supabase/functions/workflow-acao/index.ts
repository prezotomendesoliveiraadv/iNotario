// supabase/functions/workflow-acao/index.ts
// Motor de fluxo do cartório: fila por usuário, avançar/devolver com exigência,
// finalização pelo escrevente e log de alterações.
// Ações (body.action):
//   "classificar"       { solicitacaoId, complexidade }
//   "financeiro_marcar" { solicitacaoId, emolumentos, impostos }
//   "avancar"           { solicitacaoId, observacao? }   -> executa a etapa e segue
//   "devolver"          { solicitacaoId, exigencia }      -> volta ao escrevente p/ correção
//   "finalizar"         { solicitacaoId }                 -> conclui e disponibiliza ao cliente

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders, json } from "../_shared/cors.ts";
import { respostaErro } from "../_shared/erros.ts";
import {
  podeAgir, proximaEtapa, responsavelDaEtapa, statusDaEtapa, aprovadorPorComplexidade,
  PAPEL_LABEL, ETAPA_LABEL,
} from "../_shared/workflow.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);

  try {
    const { action, solicitacaoId, complexidade, emolumentos, impostos, observacao, exigencia } = await req.json();
    if (!solicitacaoId) return json({ error: "solicitacaoId é obrigatório." }, 400);

    const auth = req.headers.get("Authorization") ?? "";
    const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: userRes } = await userClient.auth.getUser();
    const uid = userRes?.user?.id;
    if (!uid) return json({ error: "Não autenticado." }, 401);
    const { data: prof } = await admin.from("profiles").select("papel").eq("id", uid).maybeSingle();
    const papel = (prof as any)?.papel ?? "cliente";

    const { data: sol, error: eSol } = await userClient.from("solicitacoes")
      .select("id, etapa, responsavel_papel, complexidade, financeiro_status, status, empreendimento_id, validacao_construtora").eq("id", solicitacaoId).maybeSingle();
    if (eSol || !sol) return json({ error: "Solicitação não encontrada ou sem acesso." }, 404);
    const s: any = sol;

    async function log(acao: string, de: string | null, para: string | null, extra: Record<string, unknown> = {}) {
      await admin.from("workflow_log").insert({
        solicitacao_id: solicitacaoId, ator: uid, papel, acao, de_etapa: de, para_etapa: para,
        exigencia: (extra.exigencia as string) ?? null, observacao: (extra.observacao as string) ?? null,
      });
      await admin.rpc("registrar_custodia", { p_solicitacao: solicitacaoId, p_minuta: null, p_acao: `wf_${acao}`, p_detalhe: { papel, de, para, ...extra } });
    }

    // ---- classificar complexidade (equipe) ----
    if (action === "classificar") {
      if (!["baixa", "media", "alta"].includes(complexidade)) return json({ error: "Complexidade inválida." }, 400);
      await admin.from("solicitacoes").update({ complexidade }).eq("id", solicitacaoId);
      await log("classificado", s.etapa, s.etapa, { complexidade });
      return json({ ok: true, complexidade });
    }

    // ---- lançar emolumentos/impostos (equipe, na elaboração) ----
    if (action === "financeiro_marcar") {
      const emol = Number(emolumentos ?? 0), imp = Number(impostos ?? 0);
      const fin = (emol > 0 || imp > 0) ? "pendente" : "nao_aplicavel";
      await admin.from("solicitacoes").update({ emolumentos: emol, impostos: imp, financeiro_status: fin }).eq("id", solicitacaoId);
      await log("financeiro_lancado", s.etapa, s.etapa, { emolumentos: emol, impostos: imp, financeiro_status: fin });
      return json({ ok: true, financeiro_status: fin });
    }

    // ---- avançar: executa a etapa atual e segue o fluxo ----
    if (action === "avancar") {
      if (s.etapa === "concluida") return json({ error: "Solicitação já concluída." }, 409);
      if (!podeAgir(papel, s.etapa, s.responsavel_papel, s.complexidade)) {
        const alvo = s.etapa === "aprovacao" ? aprovadorPorComplexidade(s.complexidade) : s.responsavel_papel;
        return json({ error: `Esta etapa (${ETAPA_LABEL[s.etapa]}) é de responsabilidade de: ${PAPEL_LABEL[alvo] ?? alvo}.` }, 403);
      }
      // guardas por etapa
      if (s.etapa === "elaboracao" && !s.complexidade) return json({ error: "Classifique a complexidade antes de avançar." }, 400);

      // GATE DA CONSTRUTORA (ortogonal, como o financeiro): havendo empreendimento
      // vinculado, a minuta só segue para a finalização depois que o jurídico da
      // construtora aprovar. É a liberação que antecede o agendamento da assinatura.
      if (s.etapa === "aprovacao" && (s as any).empreendimento_id) {
        const v = (s as any).validacao_construtora ?? "nao_aplicavel";
        if (v !== "aprovada") {
          const motivo = v === "enviada" ? "A minuta está em análise pelo jurídico da construtora."
            : v === "ressalvas" ? "A construtora devolveu a minuta com ressalvas — trate-as e reenvie."
            : v === "reprovada" ? "A construtora reprovou a minuta — trate as observações e reenvie."
            : "Envie a minuta para validação do jurídico da construtora antes de finalizar.";
          return json({ error: motivo, validacao_construtora: v }, 409);
        }
      }

      const patch: Record<string, unknown> = {};
      // sair do financeiro = validar o pagamento
      if (s.etapa === "financeiro") patch.financeiro_status = "validado";
      // sair da aprovação = registrar aprovação
      if (s.etapa === "aprovacao") { patch.aprovado_por = uid; patch.aprovado_em = new Date().toISOString(); }

      const finStatus = (patch.financeiro_status as string) ?? s.financeiro_status;
      const prox = proximaEtapa(s.etapa, finStatus);
      const resp = responsavelDaEtapa(prox, s.complexidade);

      await admin.from("solicitacoes").update({
        ...patch, etapa: prox, responsavel_papel: resp, status: statusDaEtapa(prox), exigencia_atual: null,
      }).eq("id", solicitacaoId);
      await log("avancado", s.etapa, prox, { observacao, responsavel: resp });
      return json({ ok: true, etapa: prox, responsavel_papel: resp });
    }

    // ---- devolver ao escrevente com exigência de alteração ----
    if (action === "devolver") {
      if (!exigencia || String(exigencia).trim().length < 3) return json({ error: "Descreva a exigência de alteração." }, 400);
      if (s.etapa === "elaboracao") return json({ error: "A solicitação já está com o escrevente." }, 409);
      if (!podeAgir(papel, s.etapa, s.responsavel_papel, s.complexidade)) return json({ error: "Você não é o responsável por esta etapa." }, 403);

      await admin.from("solicitacoes").update({
        etapa: "elaboracao", responsavel_papel: "escrevente", status: "em_elaboracao", exigencia_atual: String(exigencia).trim(),
      }).eq("id", solicitacaoId);
      await log("devolvido", s.etapa, "elaboracao", { exigencia: String(exigencia).trim() });
      return json({ ok: true, etapa: "elaboracao" });
    }

    // ---- finalizar: escrevente conclui e disponibiliza ao cliente ----
    if (action === "finalizar") {
      if (s.etapa !== "finalizacao") return json({ error: "A finalização só ocorre após a aprovação." }, 409);
      if (papel !== "escrevente" && papel !== "tabeliao_oficial" && papel !== "tabeliao") {
        return json({ error: "A finalização é do Escrevente." }, 403);
      }
      await admin.from("solicitacoes").update({
        etapa: "concluida", responsavel_papel: "", status: "concluida", concluida_em: new Date().toISOString(),
      }).eq("id", solicitacaoId);
      await log("finalizado", "finalizacao", "concluida", { observacao: "Disponibilizado ao solicitante" });
      return json({ ok: true, etapa: "concluida" });
    }

    return json({ error: "Ação desconhecida." }, 400);
  } catch (e) {
    return await respostaErro("workflow-acao", e, 500);
  }
});

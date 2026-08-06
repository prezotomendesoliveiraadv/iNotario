// supabase/functions/whatsapp-enviar/index.ts
// Envia um documento (rascunho em elaboração ou final aprovado) ao WhatsApp do
// solicitante, pela WhatsApp Business Cloud API (Meta).
// Body: { solicitacaoId, saidaId }  (o arquivo já está no bucket 'saidas')
// Secrets: WHATSAPP_TOKEN, WHATSAPP_PHONE_ID, WHATSAPP_API_VERSION (opcional).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders, json } from "../_shared/cors.ts";
import { respostaErro } from "../_shared/erros.ts";

function waDigits(s: string) { const d = (s || "").replace(/\D/g, ""); return d.startsWith("55") ? d : "55" + d; }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);

  try {
    const body0 = await req.json();
    const { solicitacaoId, saidaId, texto } = body0;

    // -----------------------------------------------------------------------
    // DIAGNÓSTICO: valida credenciais e número junto à Meta e devolve a causa
    // provável em português. Chamado por { action: "diagnostico" }.
    // -----------------------------------------------------------------------
    if (body0.action === "diagnostico") {
      const tk = Deno.env.get("WHATSAPP_TOKEN");
      const pid = Deno.env.get("WHATSAPP_PHONE_ID");
      const ver = Deno.env.get("WHATSAPP_API_VERSION") ?? "v20.0";
      const achados: { item: string; ok: boolean; detalhe: string }[] = [];

      achados.push({ item: "WHATSAPP_TOKEN", ok: !!tk,
        detalhe: tk ? `definido (${tk.length} caracteres)` : "AUSENTE — defina o segredo" });
      achados.push({ item: "WHATSAPP_PHONE_ID", ok: !!pid,
        detalhe: pid ? pid : "AUSENTE — defina o segredo" });
      achados.push({ item: "WHATSAPP_API_VERSION", ok: true, detalhe: ver });

      if (tk && pid) {
        // 1) o par token + phone_id é válido?
        const r = await fetch(
          `https://graph.facebook.com/${ver}/${pid}?fields=display_phone_number,verified_name,quality_rating,code_verification_status,platform_type`,
          { headers: { Authorization: `Bearer ${tk}` } },
        );
        const j = await r.json().catch(() => ({}));
        if (r.ok) {
          achados.push({ item: "Número na Meta", ok: true,
            detalhe: `${(j as any).display_phone_number ?? "?"} · ${(j as any).verified_name ?? "sem nome verificado"} · qualidade ${(j as any).quality_rating ?? "?"}` });
        } else {
          const e = (j as any)?.error ?? {};
          const cod = e.code;
          let causa = e.message ?? `HTTP ${r.status}`;
          if (cod === 190) causa = "Token inválido ou EXPIRADO. Tokens temporários do painel duram 24h — gere um token permanente de Usuário do Sistema (System User) com a permissão whatsapp_business_messaging.";
          else if (cod === 100) causa = "WHATSAPP_PHONE_ID não confere. Use o 'Phone number ID' (numérico) do painel do WhatsApp, não o número de telefone nem o WABA ID.";
          else if (r.status === 403) causa = "Token sem permissão. O System User precisa das permissões whatsapp_business_messaging e whatsapp_business_management, e de acesso ao ativo (WABA).";
          achados.push({ item: "Número na Meta", ok: false, detalhe: causa });
        }
      }

      const falhas = achados.filter((a) => !a.ok);
      return json({
        ok: falhas.length === 0, achados,
        conclusao: falhas.length === 0
          ? "Credenciais válidas. Se o envio ainda falhar, o motivo mais comum é a janela de 24h: fora dela, a Meta só entrega templates aprovados. Peça ao cliente que envie qualquer mensagem para reabrir a conversa."
          : `Corrija: ${falhas.map((f) => f.item).join(", ")}.`,
      });
    }

    if (!solicitacaoId) return json({ error: "solicitacaoId é obrigatório." }, 400);
    if (!saidaId && !texto) return json({ error: "Informe o documento (saidaId) ou o texto da mensagem." }, 400);

    const token = Deno.env.get("WHATSAPP_TOKEN");
    const phoneId = Deno.env.get("WHATSAPP_PHONE_ID");
    const version = Deno.env.get("WHATSAPP_API_VERSION") ?? "v20.0";
    if (!token || !phoneId) return json({ error: "WhatsApp não configurado (WHATSAPP_TOKEN/WHATSAPP_PHONE_ID)." }, 500);

    const auth = req.headers.get("Authorization") ?? "";
    const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // acesso via RLS do usuário
    const { data: sol } = await userClient.from("solicitacoes")
      .select("id, protocolo, contato_whatsapp, contato_nome").eq("id", solicitacaoId).maybeSingle();
    if (!sol) return json({ error: "Solicitação não encontrada ou sem acesso." }, 404);
    const wpp = (sol as any).contato_whatsapp;
    if (!wpp) return json({ error: "O solicitante não tem WhatsApp cadastrado." }, 400);

    // ---- Mensagem de texto (acionar o cliente) ----
    if (texto && !saidaId) {
      const msg = String(texto).trim().slice(0, 900);
      if (!msg) return json({ error: "Mensagem vazia." }, 400);
      const r = await fetch(`https://graph.facebook.com/${version}/${phoneId}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          messaging_product: "whatsapp", to: waDigits(wpp), type: "text",
          text: { preview_url: false, body: msg },
        }),
      });
      const resp = await r.json().catch(() => ({}));
      if (!r.ok) {
        const detalhe = (resp as any)?.error?.message ?? "";
        const cod = (resp as any)?.error?.code;
        const sub = (resp as any)?.error?.error_subcode;
        const janela = /24|window|re-?engage|template/i.test(detalhe) || cod === 131047 || cod === 131051;
        return json({
          error: janela
            ? "Fora da janela de 24h do WhatsApp: só é possível enviar um template aprovado pela Meta. Peça ao cliente que envie qualquer mensagem para reabrir a conversa."
            : cod === 190 ? "Token do WhatsApp inválido ou expirado — gere um token permanente de System User e atualize WHATSAPP_TOKEN."
            : cod === 131030 ? "Número do destinatário não está na lista de testes. Enquanto o app estiver em modo de desenvolvimento, só números cadastrados recebem mensagens."
            : cod === 100 ? "Parâmetro inválido — confira o WHATSAPP_PHONE_ID e o formato do número (DDI+DDD+número, só dígitos)."
            : `WhatsApp recusou o envio: ${detalhe || r.status}${sub ? ` (subcódigo ${sub})` : ""}`,
          detalhe: resp,
        }, 422);
      }
      await admin.rpc("registrar_custodia", {
        p_solicitacao: solicitacaoId, p_minuta: null, p_acao: "whatsapp_mensagem",
        p_detalhe: { para: waDigits(wpp), tamanho: msg.length },
      });
      return json({ ok: true, tipo: "texto", id: (resp as any)?.messages?.[0]?.id ?? null });
    }

    const { data: saida } = await admin.from("saidas").select("*").eq("id", saidaId).maybeSingle();
    if (!saida) return json({ error: "Documento de saída não encontrado." }, 404);

    // URL assinada (pública e temporária) para a Meta baixar o arquivo
    const { data: signed, error: eUrl } = await admin.storage.from("saidas").createSignedUrl((saida as any).storage_path, 3600);
    if (eUrl || !signed) return json({ error: "Falha ao gerar o link do documento." }, 500);

    const ehFinal = (saida as any).tipo === "final";
    const filename = `${ehFinal ? "Documento-final" : "Minuta"}-${(sol as any).protocolo ?? "iNotario"}.${(saida as any).formato === "doc" ? "doc" : "pdf"}`;
    const caption = ehFinal
      ? `Olá! Segue o documento final do seu ato (protocolo ${(sol as any).protocolo}).`
      : `Olá! Segue a minuta em elaboração do seu ato (protocolo ${(sol as any).protocolo}) para conferência.`;

    const resp = await fetch(`https://graph.facebook.com/${version}/${phoneId}/messages`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp", to: waDigits(wpp), type: "document",
        document: { link: signed.signedUrl, filename, caption },
      }),
    });
    const body = await resp.json();
    if (!resp.ok) return json({ error: "Falha no envio pelo WhatsApp.", detalhe: body }, 502);

    await admin.rpc("registrar_custodia", {
      p_solicitacao: solicitacaoId, p_minuta: null, p_acao: "whatsapp_enviado",
      p_detalhe: { tipo: (saida as any).tipo, formato: (saida as any).formato, para: waDigits(wpp) },
    });

    return json({ ok: true, message_id: body?.messages?.[0]?.id ?? null });
  } catch (e) {
    return await respostaErro("whatsapp-enviar", e, 500);
  }
});

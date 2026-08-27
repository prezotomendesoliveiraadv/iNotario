// supabase/functions/cliente-portal/index.ts
// Portal público do cliente, protegido por TOKEN (sem login).
// Ações (body.action): "get" | "upload-url" | "submit".
// Usa service role internamente e valida o token a cada chamada.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders, json } from "../_shared/cors.ts";

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

async function validarToken(token: string) {
  const { data } = await admin.from("acesso_cliente").select("*").eq("token", token).maybeSingle();
  if (!data) return { erro: "Link inválido." };
  if (new Date(data.expira_em).getTime() < Date.now()) return { erro: "Link expirado." };
  return { acesso: data };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);

  try {
    const body = await req.json();
    const action = body.action;
    const token = body.token as string;
    if (!token) return json({ error: "token ausente" }, 400);

    const v = await validarToken(token);
    if (v.erro) return json({ error: v.erro }, 403);
    const acesso = v.acesso!;

    // ---- GET: dados do formulário e status ----
    if (action === "get") {
      const { data, error } = await admin.rpc("portal_dados", { p_token: token });
      if (error) throw error;
      return json(data);
    }

    // ---- UPLOAD-URL: cria registro e devolve signed upload URL ----
    if (action === "upload-url") {
      const nome = String(body.nome_arquivo ?? "documento");
      const tipoDoc = String(body.tipo_doc ?? "outro");
      const safe = nome.replace(/[^\w.\-]/g, "_").slice(0, 80);
      const path = `${acesso.solicitacao_id}/${crypto.randomUUID()}_${safe}`;

      const { data: signed, error: e1 } = await admin.storage
        .from("cliente-uploads").createSignedUploadUrl(path);
      if (e1) throw e1;

      const { data: up, error: e2 } = await admin.from("cliente_uploads").insert({
        solicitacao_id: acesso.solicitacao_id, acesso_id: acesso.id,
        tipo_doc: tipoDoc, nome_arquivo: nome, storage_path: path, mime: body.mime ?? null,
      }).select("id").single();
      if (e2) throw e2;

      return json({ path, token: signed.token, uploadId: up.id });
    }

    // ---- SUBMIT: grava dados + aceite LGPD + dispara devolutiva ----
    if (action === "submit") {
      if (!body.lgpd_aceite) return json({ error: "É necessário aceitar os termos da LGPD." }, 400);

      // merge dos dados preenchidos pelo cliente
      const { data: sol } = await admin.from("solicitacoes")
        .select("dados, status").eq("id", acesso.solicitacao_id).single();
      const dados = { ...(sol?.dados ?? {}), ...(body.dados ?? {}) };

      await admin.from("solicitacoes").update({ dados }).eq("id", acesso.solicitacao_id);
      await admin.from("acesso_cliente").update({
        lgpd_aceite: true, lgpd_aceite_em: new Date().toISOString(),
        lgpd_versao: body.lgpd_versao ?? "v1", devolvido_em: new Date().toISOString(),
        email_cliente: body.email ?? acesso.email_cliente,
      }).eq("id", acesso.id);

      await admin.rpc("registrar_custodia", {
        p_solicitacao: acesso.solicitacao_id, p_minuta: null,
        p_acao: "cliente_devolveu",
        p_detalhe: { lgpd: true, versao: body.lgpd_versao ?? "v1", via: "portal" },
      });

      return json({ ok: true });
    }

    return json({ error: "ação desconhecida" }, 400);
  } catch (e) {
    return json({ error: String((e as any)?.message ?? e) }, 500);
  }
});

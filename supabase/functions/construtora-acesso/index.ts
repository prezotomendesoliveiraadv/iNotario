// supabase/functions/construtora-acesso/index.ts
// Cria e administra os acessos do portal da construtora.
// Só a equipe do cartório pode usar. O usuário criado fica SEM cartorio_id,
// para nunca passar em is_equipe — ele só enxerga o portal da construtora.
//
// Ações: { action: "criar" | "senha" | "desvincular", ... }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders, json } from "../_shared/cors.ts";
import { respostaErro } from "../_shared/erros.ts";

function senhaAleatoria(): string {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  let s = "";
  const buf = new Uint8Array(14);
  crypto.getRandomValues(buf);
  for (const b of buf) s += abc[b % abc.length];
  return s;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);

  try {
    const body = await req.json();
    const { action, construtoraId } = body;

    const auth = req.headers.get("Authorization") ?? "";
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: auth } } },
    );
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: userRes } = await userClient.auth.getUser();
    const uid = userRes?.user?.id;
    if (!uid) return json({ error: "Não autenticado." }, 401);

    // quem chama precisa ser equipe do cartório dono da construtora
    const { data: constr } = await admin.from("construtoras")
      .select("id, cartorio_id, razao_social").eq("id", construtoraId ?? "").maybeSingle();
    if (!constr) return json({ error: "Construtora não encontrada." }, 404);

    const { data: prof } = await admin.from("profiles").select("cartorio_id, papel").eq("id", uid).maybeSingle();
    const equipe = (prof as any)?.cartorio_id === (constr as any).cartorio_id &&
      ["tabeliao", "escrevente", "tabeliao_substituto", "financeiro", "tabeliao_oficial"].includes((prof as any)?.papel);
    if (!equipe) return json({ error: "Apenas a equipe do cartório administra os acessos." }, 403);

    // ---------------------------------------------------------------- criar
    if (action === "criar") {
      const email = String(body.email ?? "").trim().toLowerCase();
      const nome = String(body.nome ?? "").trim();
      const papel = body.papel === "gestor" ? "gestor" : "juridico";
      if (!email || !nome) return json({ error: "Informe nome e e-mail." }, 400);

      const senha = senhaAleatoria();
      let userId: string | null = null;

      const { data: criado, error: eCriar } = await admin.auth.admin.createUser({
        email, password: senha, email_confirm: true,
        user_metadata: { nome, origem: "portal_construtora" },
      });
      if (criado?.user) {
        userId = criado.user.id;
      } else {
        // já existe: localiza e apenas revincula (sem trocar a senha)
        const { data: lista } = await admin.auth.admin.listUsers();
        userId = (lista?.users ?? []).find((u: any) => (u.email ?? "").toLowerCase() === email)?.id ?? null;
        if (!userId) return json({ error: `Não foi possível criar o usuário: ${eCriar?.message ?? "erro"}` }, 400);
      }

      // perfil sem cartório: este usuário NUNCA é equipe
      await admin.from("profiles").upsert({
        id: userId, nome, papel: "construtora", cartorio_id: null,
      }, { onConflict: "id" });

      const { error: eVinc } = await admin.from("construtora_usuarios").upsert({
        construtora_id: construtoraId, user_id: userId, nome, email,
        papel_construtora: papel, ativo: true,
      }, { onConflict: "construtora_id,user_id" });
      if (eVinc) return json({ error: eVinc.message }, 400);

      return json({
        ok: true, email, senha: criado?.user ? senha : null,
        aviso: criado?.user ? null : "Usuário já existia — o acesso foi vinculado sem alterar a senha.",
      });
    }

    // --------------------------------------------------------------- senha
    if (action === "senha") {
      const userId = String(body.userId ?? "");
      if (!userId) return json({ error: "userId é obrigatório." }, 400);
      const { data: vinc } = await admin.from("construtora_usuarios")
        .select("id").eq("construtora_id", construtoraId).eq("user_id", userId).maybeSingle();
      if (!vinc) return json({ error: "Este usuário não pertence a esta construtora." }, 403);

      const senha = senhaAleatoria();
      const { error } = await admin.auth.admin.updateUserById(userId, { password: senha });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true, senha });
    }

    // --------------------------------------------------------- desvincular
    if (action === "desvincular") {
      const id = String(body.id ?? "");
      if (!id) return json({ error: "id é obrigatório." }, 400);
      const { error } = await admin.from("construtora_usuarios")
        .update({ ativo: false }).eq("id", id).eq("construtora_id", construtoraId);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    return json({ error: "ação desconhecida" }, 400);
  } catch (e) {
    return await respostaErro("construtora-acesso", e, 500);
  }
});

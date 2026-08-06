// supabase/functions/admin-usuarios/index.ts
// Administração de usuários em dois níveis:
//   · admin_plataforma (iAdvoga) → cria/libera o ADMINISTRADOR de cada cartório
//   · admin_cartorio             → cria e administra os usuários do seu cartório
// Um administrador de cartório nunca alcança outro cartório.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders, json } from "../_shared/cors.ts";
import { respostaErro } from "../_shared/erros.ts";

const PAPEIS_CARTORIO = [
  "escrevente", "conferente", "financeiro",
  "tabeliao_substituto", "tabeliao_oficial", "admin_cartorio",
];

function senhaAleatoria(): string {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const buf = new Uint8Array(14);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => abc[b % abc.length]).join("");
}

async function acharUsuarioPorEmail(admin: any, email: string): Promise<string | null> {
  const { data } = await admin.auth.admin.listUsers();
  return (data?.users ?? []).find((u: any) => (u.email ?? "").toLowerCase() === email)?.id ?? null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);

  try {
    const body = await req.json();
    const action = String(body.action ?? "");

    const auth = req.headers.get("Authorization") ?? "";
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: auth } } },
    );
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: userRes } = await userClient.auth.getUser();
    const uid = userRes?.user?.id;
    if (!uid) return json({ error: "Não autenticado." }, 401);

    const { data: eu } = await admin.from("profiles")
      .select("cartorio_id, papel, ativo, acesso_ate").eq("id", uid).maybeSingle();
    const meuPapel = (eu as any)?.papel;
    const meuCartorio = (eu as any)?.cartorio_id;
    const vigente = (eu as any)?.ativo !== false &&
      (!(eu as any)?.acesso_ate || (eu as any).acesso_ate >= new Date().toISOString().slice(0, 10));
    if (!vigente) return json({ error: "Seu acesso está vencido ou desativado." }, 403);

    const ehPlataforma = meuPapel === "admin_plataforma";
    const ehAdminCartorio = ["admin_cartorio", "tabeliao", "tabeliao_oficial"].includes(meuPapel);

    // =====================================================================
    // NÍVEL 1 — admin da plataforma libera o ADMINISTRADOR de um cartório
    // =====================================================================
    if (action === "liberar_admin_cartorio") {
      if (!ehPlataforma) return json({ error: "Ação exclusiva do administrador da plataforma." }, 403);
      const cartorioId = String(body.cartorioId ?? "");
      const email = String(body.email ?? "").trim().toLowerCase();
      const nome = String(body.nome ?? "").trim();
      if (!cartorioId || !email || !nome) return json({ error: "Informe cartório, nome e e-mail." }, 400);

      const senha = senhaAleatoria();
      let userId: string | null = null;
      const { data: criado } = await admin.auth.admin.createUser({
        email, password: senha, email_confirm: true, user_metadata: { nome },
      });
      userId = criado?.user?.id ?? await acharUsuarioPorEmail(admin, email);
      if (!userId) return json({ error: "Não foi possível criar o usuário." }, 400);

      const { data: grupo } = await admin.from("grupos_usuarios")
        .select("id").eq("cartorio_id", cartorioId).eq("slug", "tab-oficiais").maybeSingle();

      await admin.from("profiles").upsert({
        id: userId, nome, email, papel: "admin_cartorio", cartorio_id: cartorioId,
        nivel_acesso: 4, ativo: true, grupo_id: (grupo as any)?.id ?? null,
      }, { onConflict: "id" });

      return json({
        ok: true, email, senha: criado?.user ? senha : null,
        aviso: criado?.user ? null : "Usuário já existia — foi promovido a administrador deste cartório sem alterar a senha.",
      });
    }

    // =====================================================================
    // NÍVEL 2 — administrador do cartório administra a própria equipe
    // =====================================================================
    const cartorioAlvo = ehPlataforma ? String(body.cartorioId ?? meuCartorio ?? "") : meuCartorio;
    if (!ehPlataforma && !ehAdminCartorio) {
      return json({ error: "Apenas o administrador do cartório pode gerenciar usuários." }, 403);
    }
    if (!cartorioAlvo) return json({ error: "Cartório não identificado." }, 400);

    // ------------------------------------------------------------- criar
    if (action === "criar") {
      const email = String(body.email ?? "").trim().toLowerCase();
      const nome = String(body.nome ?? "").trim();
      const papel = String(body.papel ?? "escrevente");
      const grupoId = body.grupoId ?? null;
      const nivel = Number(body.nivel ?? 2);
      const acessoAte = body.acessoAte || null;
      if (!email || !nome) return json({ error: "Informe nome e e-mail." }, 400);
      if (!PAPEIS_CARTORIO.includes(papel)) return json({ error: "Função inválida." }, 400);
      if (papel === "admin_cartorio" && !ehPlataforma && meuPapel !== "admin_cartorio") {
        return json({ error: "Só outro administrador pode criar um administrador de cartório." }, 403);
      }
      if (nivel < 1 || nivel > 4) return json({ error: "Nível de acesso deve estar entre 1 e 4." }, 400);

      const senha = senhaAleatoria();
      const { data: criado } = await admin.auth.admin.createUser({
        email, password: senha, email_confirm: true, user_metadata: { nome },
      });
      const userId = criado?.user?.id ?? await acharUsuarioPorEmail(admin, email);
      if (!userId) return json({ error: "Não foi possível criar o usuário." }, 400);

      // impede sequestrar usuário de outro cartório
      const { data: ja } = await admin.from("profiles").select("cartorio_id").eq("id", userId).maybeSingle();
      if ((ja as any)?.cartorio_id && (ja as any).cartorio_id !== cartorioAlvo) {
        return json({ error: "Este e-mail já pertence a outro cartório." }, 409);
      }

      const { error } = await admin.from("profiles").upsert({
        id: userId, nome, email, papel, cartorio_id: cartorioAlvo,
        grupo_id: grupoId, nivel_acesso: nivel, acesso_ate: acessoAte, ativo: true,
      }, { onConflict: "id" });
      if (error) return json({ error: error.message }, 400);

      return json({
        ok: true, userId, email, senha: criado?.user ? senha : null,
        aviso: criado?.user ? null : "Usuário já existia — o vínculo foi atualizado sem alterar a senha.",
      });
    }

    // ----------------------------------------------------------- atualizar
    if (action === "atualizar") {
      const userId = String(body.userId ?? "");
      if (!userId) return json({ error: "userId é obrigatório." }, 400);
      const { data: alvo } = await admin.from("profiles").select("cartorio_id, papel").eq("id", userId).maybeSingle();
      if ((alvo as any)?.cartorio_id !== cartorioAlvo) {
        return json({ error: "Este usuário não pertence ao seu cartório." }, 403);
      }
      const patch: Record<string, unknown> = {};
      if (body.nome !== undefined) patch.nome = String(body.nome).trim();
      if (body.papel !== undefined) {
        if (!PAPEIS_CARTORIO.includes(String(body.papel))) return json({ error: "Função inválida." }, 400);
        patch.papel = body.papel;
      }
      if (body.grupoId !== undefined) patch.grupo_id = body.grupoId;
      if (body.nivel !== undefined) {
        const n = Number(body.nivel);
        if (n < 1 || n > 4) return json({ error: "Nível de acesso deve estar entre 1 e 4." }, 400);
        patch.nivel_acesso = n;
      }
      if (body.acessoAte !== undefined) patch.acesso_ate = body.acessoAte || null;
      if (body.ativo !== undefined) patch.ativo = !!body.ativo;

      // não deixar o cartório sem nenhum administrador ativo
      if ((patch.ativo === false || (patch.papel && patch.papel !== "admin_cartorio")) &&
          (alvo as any)?.papel === "admin_cartorio") {
        const { count } = await admin.from("profiles")
          .select("id", { count: "exact", head: true })
          .eq("cartorio_id", cartorioAlvo).eq("papel", "admin_cartorio").eq("ativo", true);
        if ((count ?? 0) <= 1) {
          return json({ error: "Este é o único administrador ativo do cartório — nomeie outro antes." }, 409);
        }
      }

      const { error } = await admin.from("profiles").update(patch).eq("id", userId);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    // --------------------------------------------------------------- senha
    if (action === "senha") {
      const userId = String(body.userId ?? "");
      const { data: alvo } = await admin.from("profiles").select("cartorio_id").eq("id", userId).maybeSingle();
      if ((alvo as any)?.cartorio_id !== cartorioAlvo) {
        return json({ error: "Este usuário não pertence ao seu cartório." }, 403);
      }
      const senha = senhaAleatoria();
      const { error } = await admin.auth.admin.updateUserById(userId, { password: senha });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true, senha });
    }

    return json({ error: "ação desconhecida" }, 400);
  } catch (e) {
    return await respostaErro("admin-usuarios", e, 500);
  }
});

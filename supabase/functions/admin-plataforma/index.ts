// supabase/functions/admin-plataforma/index.ts
// Administração do FORNECEDOR da plataforma (papel: admin_plataforma).
// Ações (body.action):
//   "listar"          -> cartórios + planos + última fatura
//   "salvar_plano"    { cartorioId, plano:{...} }
//   "usuario_master"  { cartorioId, email, senha, nome }  (cria/reseta o login master)
//   "gerar_fatura"    { cartorioId, competencia:"AAAA-MM" }
//   "extrato"         { cartorioId, competencia }
//   "marcar_paga"     { faturaId }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders, json } from "../_shared/cors.ts";

function mesRange(competencia: string): { ini: string; fim: string } | null {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(competencia ?? "");
  if (!m) return null;
  const ano = Number(m[1]), mes = Number(m[2]);
  const ini = new Date(Date.UTC(ano, mes - 1, 1));
  const fim = new Date(Date.UTC(ano, mes, 1));
  return { ini: ini.toISOString(), fim: fim.toISOString() };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);

  try {
    const body = await req.json();
    const action = body.action;

    const auth = req.headers.get("Authorization") ?? "";
    const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // exige papel admin_plataforma
    const { data: uRes } = await userClient.auth.getUser();
    const uid = uRes?.user?.id;
    if (!uid) return json({ error: "Não autenticado." }, 401);
    const { data: prof } = await admin.from("profiles").select("papel").eq("id", uid).maybeSingle();
    if ((prof as any)?.papel !== "admin_plataforma") return json({ error: "Acesso restrito à administração da plataforma." }, 403);

    if (action === "listar") {
      const { data: carts } = await admin.from("cartorios").select("id, nome, comarca, uf, created_at").order("nome");
      const { data: planos } = await admin.from("planos").select("*");
      const { data: faturas } = await admin.from("faturas").select("*").order("competencia", { ascending: false });
      const byCart: Record<string, any> = {};
      for (const f of (faturas ?? []) as any[]) if (!byCart[f.cartorio_id]) byCart[f.cartorio_id] = f;
      return json({
        cartorios: (carts ?? []).map((c: any) => ({
          ...c,
          plano: (planos ?? []).find((p: any) => p.cartorio_id === c.id) ?? null,
          ultima_fatura: byCart[c.id] ?? null,
        })),
      });
    }

    if (action === "salvar_plano") {
      const p = body.plano ?? {};
      const row = {
        cartorio_id: body.cartorioId,
        valor_fixo: Number(p.valor_fixo ?? 0), valor_ato: Number(p.valor_ato ?? 0),
        tabeliao_oficial: p.tabeliao_oficial ?? null, contato_email: p.contato_email ?? null,
        contato_fone: p.contato_fone ?? null, email_master: p.email_master ?? null,
        validade: p.validade || null, ativo: p.ativo !== false, obs: p.obs ?? null,
        atualizado_em: new Date().toISOString(),
      };
      const { error } = await admin.from("planos").upsert(row);
      if (error) throw error;
      return json({ ok: true });
    }

    if (action === "usuario_master") {
      const { cartorioId, email, senha, nome } = body;
      if (!email || !senha) return json({ error: "email e senha são obrigatórios." }, 400);
      // cria (ou atualiza a senha de) o usuário master
      const { data: created, error: eCreate } = await admin.auth.admin.createUser({
        email, password: senha, email_confirm: true, user_metadata: { nome: nome ?? "Master do cartório" },
      });
      let userId = created?.user?.id;
      if (eCreate) {
        // já existe: localiza e reseta a senha
        const { data: lista } = await admin.auth.admin.listUsers();
        const existente = (lista?.users ?? []).find((u: any) => u.email?.toLowerCase() === String(email).toLowerCase());
        if (!existente) return json({ error: `Falha ao criar usuário: ${eCreate.message}` }, 500);
        userId = existente.id;
        const { error: eUpd } = await admin.auth.admin.updateUserById(userId, { password: senha });
        if (eUpd) return json({ error: `Falha ao redefinir a senha: ${eUpd.message}` }, 500);
      }
      await admin.from("profiles").upsert({ id: userId, nome: nome ?? "Master do cartório", papel: "tabeliao_oficial", cartorio_id: cartorioId });
      await admin.from("planos").update({ email_master: email }).eq("cartorio_id", cartorioId);
      return json({ ok: true, user_id: userId });
    }

    if (action === "gerar_fatura" || action === "extrato") {
      const range = mesRange(body.competencia);
      if (!range) return json({ error: "competencia deve ser 'AAAA-MM'." }, 400);
      const cartorioId = body.cartorioId;

      const { data: atos } = await admin.from("solicitacoes")
        .select("id, protocolo, titulo, concluida_em, origem, tipos_ato(nome)")
        .eq("cartorio_id", cartorioId).eq("status", "concluida")
        .gte("concluida_em", range.ini).lt("concluida_em", range.fim)
        .order("concluida_em");

      const extrato = (atos ?? []).map((a: any) => ({
        protocolo: a.protocolo, titulo: a.titulo, tipo: a.tipos_ato?.nome ?? null,
        origem: a.origem, concluida_em: a.concluida_em,
      }));

      if (action === "extrato") return json({ competencia: body.competencia, qtd: extrato.length, atos: extrato });

      const { data: plano } = await admin.from("planos").select("*").eq("cartorio_id", cartorioId).maybeSingle();
      if (!plano) return json({ error: "Cadastre o plano do cartório antes de gerar a fatura." }, 400);

      const qtd = extrato.length;
      const vFixo = Number((plano as any).valor_fixo ?? 0);
      const vVar = Number(((qtd * Number((plano as any).valor_ato ?? 0))).toFixed(2));
      const total = Number((vFixo + vVar).toFixed(2));

      const { data: fat, error: eFat } = await admin.from("faturas").upsert({
        cartorio_id: cartorioId, competencia: body.competencia,
        qtd_atos: qtd, valor_fixo: vFixo, valor_variavel: vVar, valor_total: total,
        status: "fechada", detalhes: { atos: extrato, valor_ato: (plano as any).valor_ato },
        gerada_em: new Date().toISOString(),
      }, { onConflict: "cartorio_id,competencia" }).select("*").single();
      if (eFat) throw eFat;
      return json({ ok: true, fatura: fat });
    }

    if (action === "marcar_paga") {
      const { error } = await admin.from("faturas").update({ status: "paga", paga_em: new Date().toISOString() }).eq("id", body.faturaId);
      if (error) throw error;
      return json({ ok: true });
    }

    return json({ error: "Ação desconhecida." }, 400);
  } catch (e) {
    return json({ error: String(e?.message ?? e) }, 500);
  }
});

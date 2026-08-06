// supabase/functions/plataforma-admin/index.ts
// Administração da PLATAFORMA (lado iAdvoga). Requer papel 'admin_plataforma'.
// Ações (body.action):
//   "visao"           -> lista cartórios + contrato + usuários + fatura corrente
//   "criar_cartorio"  { nome, cns?, comarca?, uf? }
//   "salvar_contrato" { cartorioId, contrato: {...} }
//   "criar_usuario"   { cartorioId, email, senha, nome, papel }   (inclui o master)
//   "definir_papel"   { userId, papel }
//   "gerar_fatura"    { cartorioId, competencia: "AAAA-MM" }
//   "faturas"         { cartorioId? }
//   "marcar_paga"     { faturaId }
//   "extrato"         { cartorioId, competencia }  -> atos efetivados no mês

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders, json } from "../_shared/cors.ts";

function faixaMes(competencia: string): { ini: string; fim: string } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(competencia ?? "");
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

    // gate: só admin da plataforma
    const { data: u } = await userClient.auth.getUser();
    if (!u?.user) return json({ error: "Não autenticado." }, 401);
    const { data: prof } = await admin.from("profiles").select("papel").eq("id", u.user.id).maybeSingle();
    if ((prof as any)?.papel !== "admin_plataforma") {
      return json({ error: "Acesso restrito ao administrador da plataforma." }, 403);
    }

    // ---- visão geral ----
    if (action === "visao") {
      const { data: cartorios } = await admin.from("cartorios").select("id, nome, cns, comarca, uf").order("nome");
      const { data: contratos } = await admin.from("contratos").select("*");
      const { data: perfis } = await admin.from("profiles").select("id, nome, papel, cartorio_id");
      const comp = new Date().toISOString().slice(0, 7);
      const { data: fats } = await admin.from("faturas").select("*").eq("competencia", comp);
      const lista = (cartorios ?? []).map((c: any) => ({
        ...c,
        contrato: (contratos ?? []).find((x: any) => x.cartorio_id === c.id) ?? null,
        usuarios: (perfis ?? []).filter((p: any) => p.cartorio_id === c.id),
        fatura_corrente: (fats ?? []).find((f: any) => f.cartorio_id === c.id) ?? null,
      }));
      return json({ cartorios: lista, competencia: comp });
    }

    if (action === "criar_cartorio") {
      const { data, error } = await admin.from("cartorios")
        .insert({ nome: body.nome, cns: body.cns ?? null, comarca: body.comarca ?? null, uf: body.uf ?? null })
        .select("id").single();
      if (error) throw error;
      return json({ ok: true, cartorioId: (data as any).id });
    }

    if (action === "salvar_contrato") {
      const c = body.contrato ?? {};
      const payload = {
        cartorio_id: body.cartorioId,
        mensalidade_fixa: Number(c.mensalidade_fixa ?? 0), valor_por_ato: Number(c.valor_por_ato ?? 0),
        vigencia_inicio: c.vigencia_inicio || null, vigencia_fim: c.vigencia_fim || null,
        status: c.status ?? "ativo", tabeliao_oficial: c.tabeliao_oficial ?? null,
        cnpj: c.cnpj ?? null, contato_nome: c.contato_nome ?? null,
        contato_email: c.contato_email ?? null, contato_telefone: c.contato_telefone ?? null,
        observacoes: c.observacoes ?? null, updated_at: new Date().toISOString(),
      };
      const { error } = await admin.from("contratos").upsert(payload, { onConflict: "cartorio_id" });
      if (error) throw error;
      return json({ ok: true });
    }

    // cria usuário do cartório (inclui o login/senha master)
    if (action === "criar_usuario") {
      const { data: nu, error: eU } = await admin.auth.admin.createUser({
        email: body.email, password: body.senha, email_confirm: true,
        user_metadata: { nome: body.nome ?? body.email },
      });
      if (eU) throw eU;
      const uid = nu.user?.id;
      await admin.from("profiles").upsert({
        id: uid, nome: body.nome ?? body.email, papel: body.papel ?? "escrevente", cartorio_id: body.cartorioId,
      });
      if (body.master) {
        await admin.from("contratos").update({ usuario_master: uid }).eq("cartorio_id", body.cartorioId);
      }
      return json({ ok: true, userId: uid });
    }

    if (action === "definir_papel") {
      const { error } = await admin.from("profiles").update({ papel: body.papel }).eq("id", body.userId);
      if (error) throw error;
      return json({ ok: true });
    }

    // ---- fatura: fixo + (atos efetivados no mês × valor_por_ato) ----
    if (action === "gerar_fatura") {
      const faixa = faixaMes(body.competencia);
      if (!faixa) return json({ error: "competencia inválida (use AAAA-MM)." }, 400);
      const { data: ctr } = await admin.from("contratos").select("*").eq("cartorio_id", body.cartorioId).maybeSingle();
      if (!ctr) return json({ error: "Cartório sem contrato cadastrado." }, 400);
      const { count } = await admin.from("solicitacoes")
        .select("id", { count: "exact", head: true })
        .eq("cartorio_id", body.cartorioId)
        .gte("concluida_em", faixa.ini).lt("concluida_em", faixa.fim);
      const qtd = count ?? 0;
      const vAto = Number((ctr as any).valor_por_ato ?? 0);
      const vFixo = Number((ctr as any).mensalidade_fixa ?? 0);
      const variavel = Math.round(qtd * vAto * 100) / 100;
      const total = Math.round((variavel + vFixo) * 100) / 100;
      const { data: fat, error } = await admin.from("faturas").upsert({
        cartorio_id: body.cartorioId, competencia: body.competencia,
        qtd_atos: qtd, valor_por_ato: vAto, valor_variavel: variavel,
        valor_fixo: vFixo, valor_total: total, status: "fechada", gerada_em: new Date().toISOString(),
      }, { onConflict: "cartorio_id,competencia" }).select("*").single();
      if (error) throw error;
      return json({ ok: true, fatura: fat });
    }

    if (action === "faturas") {
      let q = admin.from("faturas").select("*").order("competencia", { ascending: false });
      if (body.cartorioId) q = q.eq("cartorio_id", body.cartorioId);
      const { data } = await q.limit(60);
      return json({ faturas: data ?? [] });
    }

    if (action === "marcar_paga") {
      const { error } = await admin.from("faturas").update({ status: "paga", paga_em: new Date().toISOString() }).eq("id", body.faturaId);
      if (error) throw error;
      return json({ ok: true });
    }

    // extrato: atos efetivados no mês (base da cobrança)
    if (action === "extrato") {
      const faixa = faixaMes(body.competencia);
      if (!faixa) return json({ error: "competencia inválida (use AAAA-MM)." }, 400);
      const { data } = await admin.from("solicitacoes")
        .select("protocolo, titulo, concluida_em, origem, tipos_ato(nome)")
        .eq("cartorio_id", body.cartorioId)
        .gte("concluida_em", faixa.ini).lt("concluida_em", faixa.fim)
        .order("concluida_em");
      return json({ atos: data ?? [] });
    }

    return json({ error: "Ação desconhecida." }, 400);
  } catch (e) {
    return json({ error: String(e?.message ?? e) }, 500);
  }
});

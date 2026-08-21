// supabase/functions/artemis-intake/index.ts
// Triagem por IA: cruza dados do ato + documentos do cliente + acervo do cartório
// (modelos, jurisprudência, orientações) e produz um parecer de triagem que dá
// andamento ao workflow. Pseudonimiza antes de chamar a IA e reidrata depois.
//
// Body: { "solicitacaoId": "<uuid>" }   (requer usuário autenticado da equipe)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders, json } from "../_shared/cors.ts";
import { respostaErro } from "../_shared/erros.ts";
import { callModel, extrairJson, type Msg, gravarUso } from "../_shared/artemis.ts";
import { criarCofre, type Entidade } from "../_shared/tokenizer.ts";
import { analisarMatricula } from "../_shared/matricula.ts";

const ESQUEMA = `Responda SOMENTE com JSON válido (sem texto fora do JSON, sem cercas):
{
  "resumo": "2-3 frases sobre a prontidão do caso para lavratura",
  "checklist_documentos": [ {"documento":"", "status":"recebido|faltante|ilegivel", "observacao":""} ],
  "pre_qualificacao": [ {"item":"", "status":"ok|atencao|pendente", "fundamento":""} ],
  "modelos_sugeridos": ["título do acervo aplicável"],
  "proximo_passo": "ação objetiva recomendada ao cartório",
  "complexidade_sugerida": "baixa|media|alta",
  "status_sugerido": "em_elaboracao|em_revisao|aprovada"
}`;

const SYSTEM = `Você é Artemis, especialista sênior em procedimentos de tabelionato de notas, realizando a TRIAGEM de uma solicitação antes da lavratura. Avalie a suficiência documental, a qualificação das partes e a conformidade registral. Princípio inegociável: fé pública indelegável — você prepara, o tabelião decide. Cite o fundamento de cada apontamento (lei, CNN/CNJ, súmula ou jurisprudência); sem segurança sobre a fonte, marque "a confirmar pelo delegatário". Não invente. Trate tokens entre colchetes (ex.: [PESSOA_1]) como dados reais e preserve-os.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);

  try {
    const { solicitacaoId } = await req.json();
    if (!solicitacaoId) return json({ error: "solicitacaoId é obrigatório" }, 400);

    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    // Autor real da ação: sob service role auth.uid() é nulo, então o ator
    // precisa ser resolvido aqui e passado explicitamente à custódia.
    const { data: _u } = await userClient.auth.getUser();
    const uid = _u?.user?.id ?? null;
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Leitura com o JWT do usuário (RLS garante acesso só à própria serventia)
    const { data: sol, error: eSol } = await userClient
      .from("solicitacoes").select("*, tipos_ato(*)").eq("id", solicitacaoId).maybeSingle();
    if (eSol || !sol) return json({ error: "Solicitação não encontrada ou sem acesso." }, 404);

    const { data: partes } = await userClient.from("partes").select("*").eq("solicitacao_id", solicitacaoId);
    const { data: uploads } = await userClient.from("cliente_uploads").select("tipo_doc, nome_arquivo").eq("solicitacao_id", solicitacaoId);

    // matrícula lida pela IA (preferir a já validada)
    const { data: docsMat } = await userClient.from("documentos")
      .select("extraido, status, created_at").eq("solicitacao_id", solicitacaoId).eq("tipo", "matricula")
      .order("created_at", { ascending: false });
    const matricula: any = (docsMat ?? []).find((d: any) => d.status === "validado" && d.extraido)?.extraido
      ?? (docsMat ?? []).find((d: any) => d.extraido)?.extraido ?? null;

    const tipo: any = (sol as any).tipos_ato;
    const { data: acervo } = await userClient.from("acervo")
      .select("categoria, titulo, descricao, tema, tipo_ato_slug, conteudo_texto")
      .eq("cartorio_id", (sol as any).cartorio_id)
      .or(`tipo_ato_slug.eq.${tipo?.slug},categoria.eq.jurisprudencia,categoria.eq.orientacao`)
      .limit(30);

    // ---- Pseudonimização ----
    const pii: Entidade[] = [];
    for (const p of (partes ?? []) as any[]) {
      if (p.nome) pii.push({ tipo: "PESSOA", valor: p.nome });
      if (p.cpf_cnpj) pii.push({ tipo: (p.cpf_cnpj.replace(/\D/g, "").length > 11 ? "CNPJ" : "CPF"), valor: p.cpf_cnpj });
    }
    // identificadores vindos da matrícula também são pseudonimizados antes da IA
    for (const nome of (matricula?.proprietarios ?? [])) if (nome) pii.push({ tipo: "PESSOA", valor: String(nome) });
    if (matricula?.imovel_matricula) pii.push({ tipo: "MATRICULA", valor: String(matricula.imovel_matricula) });

    const ctxPartes = (partes ?? []).map((p: any) =>
      `- ${p.papel}: ${p.nome}${p.cpf_cnpj ? ", " + p.cpf_cnpj : ""}${p.dados?.estado_civil ? ", " + p.dados.estado_civil : ""}${p.dados?.regime_bens ? ", regime " + p.dados.regime_bens : ""}`).join("\n");
    const ctxDados = (tipo?.schema_campos ?? []).map((c: any) => `- ${c.label}: ${(sol as any).dados?.[c.key] ?? "—"}`).join("\n");
    const ctxDocs = (uploads ?? []).map((u: any) => `- ${u.tipo_doc}: ${u.nome_arquivo}`).join("\n") || "(nenhum documento enviado pelo cliente)";
    const ctxAcervo = (acervo ?? []).map((a: any) =>
      `- [${a.categoria}${a.tipo_ato_slug ? "/" + a.tipo_ato_slug : ""}] ${a.titulo}${a.tema?.length ? " (temas: " + a.tema.join(", ") + ")" : ""}${a.descricao ? " — " + a.descricao : ""}`).join("\n") || "(acervo vazio)";
    const ctxMatricula = matricula
      ? `Matrícula ${matricula.imovel_matricula ?? "—"} (${matricula.imovel_cartorio_ri ?? "—"})\n` +
        `Proprietários registrados: ${(matricula.proprietarios ?? []).join("; ") || "—"}\n` +
        `Ônus/gravames lidos: ${(matricula.onus ?? []).map((o: any) => `${o.tipo}${o.detalhe ? " (" + o.detalhe + ")" : ""}`).join("; ") || "nenhum aparente"}`
      : "(matrícula ainda não lida pela IA)";

    // Vigência de certidões e procurações (do ato e da construtora vinculada).
    // Documento vencido é exigência certa no registro — entra na triagem.
    const { data: venc } = await admin.rpc("vencimentos_solicitacao", {
      p_solicitacao: solicitacaoId, p_janela_dias: 10,
    });
    const criticos = ((venc as any[]) ?? []).filter((v) => v.situacao !== "vigente");
    const ctxVenc = ((venc as any[]) ?? []).length
      ? (venc as any[]).map((v) =>
          `- ${v.descricao}: validade ${v.validade} (${
            v.situacao === "vencido" ? `VENCIDO há ${Math.abs(v.dias_restantes)} dia(s)`
            : v.situacao === "vence_em_breve" ? `vence em ${v.dias_restantes} dia(s)`
            : "vigente"})`).join("\n")
      : "(nenhum documento com validade informada)";

    const prompt = `ATO: ${tipo?.nome} (protocolo ${(sol as any).protocolo})

PARTES:
${ctxPartes || "(nenhuma)"}

DADOS DO ATO:
${ctxDados}

MATRÍCULA DO IMÓVEL (lida por IA):
${ctxMatricula}

DOCUMENTOS ENVIADOS PELO CLIENTE:
${ctxDocs}

VIGÊNCIA DE CERTIDÕES E PROCURAÇÕES:
${ctxVenc}

ACERVO DISPONÍVEL (modelos, jurisprudência, orientações):
${ctxAcervo}

Considere os ônus da matrícula e a continuidade registral (titularidade) na pré-qualificação. Documento VENCIDO é exigência bloqueante: aponte-o. Documento que vence em até 10 dias vira alerta com recomendação de renovar antes da lavratura. Faça a triagem. ${ESQUEMA}`;

    const cofre = criarCofre(pii, [prompt]);
    const messages: Msg[] = [{ role: "user", content: cofre.tokenizar(prompt) }];
    const raw = await callModel(SYSTEM, messages, 2500, { json: true });

    let result: any;
    try {
      result = cofre.reidratarProfundo(extrairJson(raw));
    } catch {
      return json({ error: "Não foi possível interpretar a triagem da IA." }, 502);
    }

    // ---- Camada determinística: ônus/gravames e continuidade (titularidade) ----
    const onusAlertas = analisarMatricula(matricula, partes ?? []);
    if (onusAlertas.length) {
      result.pre_qualificacao = [...(result.pre_qualificacao ?? []), ...onusAlertas];
      result.onus = onusAlertas;
      // se há ônus bloqueante, não deixa "subir" o status para aprovada
      if (onusAlertas.some((a: any) => a.status === "pendente")) {
        if (result.status_sugerido === "aprovada") result.status_sugerido = "em_revisao";
        result.proximo_passo = "Resolver os ônus/gravames apontados na matrícula antes de prosseguir. " + (result.proximo_passo ?? "");
      }
    }

    // ---- Complexidade sugerida (heurística determinística sobre a IA) ----
    const temOnusBloqueante = onusAlertas.some((a: any) => a.status === "pendente");
    const temOnus = onusAlertas.length > 0;
    const slug = (tipo?.slug ?? "").toLowerCase();
    const ehImovel = /imovel|compra|venda|doacao|permuta/.test(slug);
    let complexidade: string = result.complexidade_sugerida;
    if (!["baixa", "media", "alta"].includes(complexidade)) {
      complexidade = temOnusBloqueante ? "alta" : (ehImovel || temOnus) ? "media" : "baixa";
    }
    // ônus bloqueante sempre eleva para alta
    if (temOnusBloqueante) complexidade = "alta";
    result.complexidade_sugerida = complexidade;

    // grava triagem + custódia + status (service role)
    await admin.from("triagem").insert({ solicitacao_id: solicitacaoId, resultado: result });
    // registra a complexidade sugerida sem sobrescrever uma já classificada manualmente
    if ((sol as any).complexidade == null) {
      await admin.from("solicitacoes").update({ complexidade }).eq("id", solicitacaoId);
    }

    const validos = ["em_elaboracao", "em_revisao", "aprovada"];
    if ((sol as any).status !== "concluida" && validos.includes(result.status_sugerido)) {
      await admin.from("solicitacoes").update({ status: result.status_sugerido }).eq("id", solicitacaoId);
    }
    await admin.rpc("registrar_custodia", {
      p_solicitacao: solicitacaoId, p_minuta: null, p_acao: "triagem_ia",
      p_detalhe: { docs: (uploads ?? []).length, acervo: (acervo ?? []).length, tokens: cofre.tamanho }, p_ator: uid ?? null,
    });
    await gravarUso(admin, "artemis-intake", (sol as any)?.cartorio_id ?? null, solicitacaoId);

    return json({ ok: true, resultado: result, vencimentos: venc ?? [], vencimentos_criticos: criticos.length });
  } catch (e) {
    return await respostaErro("artemis-intake", e, 500);
  }
});

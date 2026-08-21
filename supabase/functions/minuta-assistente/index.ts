// supabase/functions/minuta-assistente/index.ts
// Duas ações de apoio à minuta:
//   · recompilar        — regera a minuta a partir dos DADOS ATUAIS do ato
//                         (partes, imóvel, modelo da construtora e cláusulas
//                         especiais já escolhidas), sem depender do histórico
//                         de conversa do assistente.
//   · analisar_ressalvas— lê as ressalvas do jurídico da construtora e propõe
//                         o texto ajustado. NÃO altera a minuta: devolve
//                         sugestão para o cartório revisar e aplicar.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders, json } from "../_shared/cors.ts";
import { respostaErro } from "../_shared/erros.ts";
import { callModel, callModelJson, sha256, PROVEDOR_ATIVO, MODELO_ATIVO, gravarUso } from "../_shared/artemis.ts";

import { espelharModelo, dicionarioDoAto, inserirClausulas } from "../_shared/espelho.ts";

async function contexto(admin: any, solicitacaoId: string) {
  const { data: sol } = await admin.from("solicitacoes")
    .select("id, cartorio_id, protocolo, titulo, dados, complexidade, unidade, empreendimento_id, tipos_ato(nome, slug, template), empreendimentos(nome), cartorios(nome, cidade)")
    .eq("id", solicitacaoId).maybeSingle();
  if (!sol) return null;

  const { data: partes } = await admin.from("partes")
    .select("papel, nome, cpf_cnpj, dados").eq("solicitacao_id", solicitacaoId).order("ordem");
  const { data: docs } = await admin.from("documentos")
    .select("tipo, extraido, validade").eq("solicitacao_id", solicitacaoId);
  const { data: cls } = await admin.from("solicitacao_clausulas")
    .select("nome, texto, ordem").eq("solicitacao_id", solicitacaoId).order("ordem");
  const { data: mod } = await admin.rpc("modelo_para_solicitacao", { p_solicitacao: solicitacaoId });
  const { data: minuta } = await admin.from("minutas")
    .select("id, versao, conteudo").eq("solicitacao_id", solicitacaoId)
    .order("versao", { ascending: false }).limit(1).maybeSingle();

  const s: any = sol;
  const mat = ((docs as any[]) ?? []).find((d) => d.tipo === "matricula")?.extraido;

  const bloco = `ATO: ${s.tipos_ato?.nome ?? "—"} · protocolo ${s.protocolo ?? "—"}
${s.unidade ? `UNIDADE: ${s.unidade}\n` : ""}PARTES:
${((partes as any[]) ?? []).map((p) =>
  `- ${p.papel}: ${p.nome}${p.cpf_cnpj ? ` (${p.cpf_cnpj})` : ""}${
    p.dados?.estado_civil ? `, ${p.dados.estado_civil}` : ""}${
    p.dados?.regime_bens ? `, ${p.dados.regime_bens}` : ""}${
    p.dados?.profissao ? `, ${p.dados.profissao}` : ""}${
    p.dados?.endereco ? `, ${p.dados.endereco}` : ""}`).join("\n") || "(nenhuma cadastrada)"}

DADOS DO ATO:
${JSON.stringify(s.dados ?? {}, null, 1).slice(0, 2000)}

MATRÍCULA (lida por IA):
${mat ? JSON.stringify(mat).slice(0, 1500) : "(não lida)"}`;

  const m = ((mod as any[]) ?? [])[0];
  const blocoModelo = m?.texto
    ? `\n\nMODELO PADRÃO (fonte: ${m.fonte} — "${m.titulo}"):\n"""\n${String(m.texto).slice(0, 12000)}\n"""`
    : (s.tipos_ato?.template ? `\n\nMODELO BASE DO TIPO DE ATO:\n"""\n${String(s.tipos_ato.template).slice(0, 8000)}\n"""` : "");

  const blocoClausulas = ((cls as any[]) ?? []).length
    ? `\n\nCLÁUSULAS ESPECIAIS A INCORPORAR (na ordem):\n${(cls as any[]).map((c, i) => `[${i + 1}] ${c.nome}\n${c.texto}`).join("\n\n")}`
    : "";

  return {
    sol: s, bloco, blocoModelo, blocoClausulas, minuta,
    modeloFonte: m?.fonte ?? null,
    clausulas: ((cls as any[]) ?? []).map((c: any) => ({ nome: c.nome, texto: c.texto })),
    modeloTexto: String(m?.texto ?? ""),
    partes: (partes as any[]) ?? [],
    docs: (docs as any[]) ?? [],
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);

  let ctxId: string | undefined;
  try {
    const body = await req.json();
    const { action, solicitacaoId } = body;
    ctxId = solicitacaoId;
    if (!solicitacaoId) return json({ error: "solicitacaoId é obrigatório." }, 400);

    const auth = req.headers.get("Authorization") ?? "";
    const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: auth } } });
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: userRes } = await userClient.auth.getUser();
    const uid = userRes?.user?.id;
    if (!uid) return json({ error: "Não autenticado." }, 401);

    const ctx = await contexto(admin, solicitacaoId);
    if (!ctx) return json({ error: "Solicitação não encontrada." }, 404);

    // acesso: equipe do cartório do ato
    const { data: prof } = await admin.from("profiles")
      .select("cartorio_id, papel, ativo, acesso_ate").eq("id", uid).maybeSingle();
    const vigente = (prof as any)?.ativo !== false &&
      (!(prof as any)?.acesso_ate || (prof as any).acesso_ate >= new Date().toISOString().slice(0, 10));
    if ((prof as any)?.cartorio_id !== ctx.sol.cartorio_id || !vigente) {
      return json({ error: "Sem acesso a este ato." }, 403);
    }

    // =====================================================================
    // RECOMPILAR — regera a minuta a partir dos dados atuais
    // =====================================================================
    if (action === "recompilar") {
      const system = `Você é a Artemis, assistente notarial. Redija a MINUTA do ato em português do Brasil, pronta para revisão do tabelião.

REGRAS:
- Se houver MODELO PADRÃO, use-o como base: preserve estrutura, ordem das cláusulas e terminologia, trocando os dados pelos do ato.
- Incorpore as CLÁUSULAS ESPECIAIS indicadas, na ordem, ajustando os [campos] aos dados reais e mantendo a numeração sequencial.
- Dados ausentes viram placeholders visíveis entre colchetes (ex.: [CPF DO COMPRADOR]) — NUNCA invente nome, CPF, matrícula, valor ou data.
- Não afirme fatos não comprovados nos dados fornecidos.
- A decisão e a fé pública são do tabelião: você redige, ele decide.

Responda APENAS com JSON:
{"minuta":"texto completo da minuta","alertas":["pontos que exigem conferência do tabelião"],"placeholders":["campos que ficaram pendentes"]}`;

      const entrada = `${ctx.bloco}${ctx.blocoModelo}${ctx.blocoClausulas}\n\nRedija a minuta agora.`;
      const r = await callModelJson(system, [{ role: "user", content: entrada }], 4000);

      // Havendo modelo do empreendimento ou da construtora, o texto é o modelo
      // espelhado — a IA fica com os alertas. Mesma regra do artemis-compile:
      // a redação aprovada pela construtora não é reescrita.
      let texto = String(r.minuta ?? "").trim();
      let origemTexto = "ia";
      let pendencias: { rotulo: string; ocorrencias: number }[] = [];

      if (ctx.modeloTexto.trim()) {
        const pega = (t: string) => ctx.docs.filter((d: any) => d.tipo === t && d.extraido)[0]?.extraido ?? null;
        const { data: cons } = await admin.rpc("consolidar_ato", { p_solicitacao: solicitacaoId });
        const doPainel: Record<string, string> = {};
        for (const [k, v] of Object.entries(((cons as any)?.campos ?? {}) as Record<string, any>)) {
          if (v?.valor) doPainel[k] = String(v.valor);
        }
        // O painel da tela e a minuta leem a MESMA consolidação: sem isto, o
        // escrevente confere um valor na tela e a escritura sai com outro.
        const esp = espelharModelo(ctx.modeloTexto, {
          ...dicionarioDoAto({
            solicitacao: ctx.sol, partes: ctx.partes,
            imovel: pega("matricula") ?? ctx.sol?.dados,
            contrato: pega("compromisso"),
            empreendimento: ctx.sol?.empreendimentos, cartorio: ctx.sol?.cartorios,
          }),
          ...doPainel,
        });
        texto = esp.texto;
        origemTexto = "espelho_modelo";
        pendencias = esp.pendentes;

        // Mesma correção do artemis-compile: com espelho, a instrução de
        // cláusulas no prompt não produz efeito no documento final.
        const clsEsp = (ctx.clausulas ?? []).map((c: any) => ({ nome: c.nome, texto: c.texto }));
        if (clsEsp.length) {
          const ins = inserirClausulas(texto, clsEsp);
          texto = ins.texto;
          r.alertas = [
            ...(Array.isArray(r.alertas) ? r.alertas : []),
            { item: `${ins.inseridas} cláusula(s) especial(is) inserida(s)`,
              status: ins.posicao === "marcador" ? "ok" : "atencao",
              fundamento: ins.posicao === "final"
                ? "Anexadas ao final por falta de marcador e de fecho reconhecível. REPOSICIONE antes de aprovar."
                : "Confira a posição e a numeração no documento." },
          ];
        }
        r.placeholders = [
          ...(Array.isArray(r.placeholders) ? r.placeholders : []),
          ...esp.pendentes.map((x) => x.rotulo),
        ];
      }

      if (!texto) return json({ error: "A IA não retornou a minuta. Tente novamente." }, 502);

      const versao = ((ctx.minuta as any)?.versao ?? 0) + 1;
      const hash = await sha256(texto);
      const { data: nova } = await admin.from("minutas").insert({
        solicitacao_id: solicitacaoId, versao, tipo: "provisoria",
        conteudo: texto, hash, qualificacao: r.alertas ?? [], criado_por: uid,
        origem: origemTexto, modelo_fonte: ctx.modeloFonte, pendencias,
      }).select("id, versao").maybeSingle();

      await admin.rpc("registrar_custodia", {
        p_solicitacao: solicitacaoId, p_minuta: (nova as any)?.id ?? null,
        p_acao: "minuta_recompilada",
        p_detalhe: { versao, modelo_fonte: ctx.modeloFonte, clausulas: ctx.blocoClausulas ? true : false }, p_ator: uid ?? null,
      });
    await gravarUso(admin, "minuta-assistente", (ctx.sol as any)?.cartorio_id ?? null, solicitacaoId);

      return json({
        ok: true, versao: (nova as any)?.versao ?? versao, minuta: texto,
        alertas: r.alertas ?? [], placeholders: r.placeholders ?? [],
        modelo_fonte: ctx.modeloFonte, origem: origemTexto, pendencias,
        provedor: PROVEDOR_ATIVO, modelo: MODELO_ATIVO,
      });
    }

    // =====================================================================
    // ANALISAR RESSALVAS — sugere o texto ajustado (não aplica)
    // =====================================================================
    if (action === "analisar_ressalvas") {
      const { data: rodadas } = await admin.from("validacoes_construtora")
        .select("rodada, acao, observacoes, autor_nome, created_at")
        .eq("solicitacao_id", solicitacaoId).order("created_at", { ascending: false }).limit(6);
      const devolucoes = ((rodadas as any[]) ?? [])
        .filter((r) => ["ressalvas", "reprovada"].includes(r.acao) && r.observacoes);

      const manual = String(body.observacoes ?? "").trim();
      if (devolucoes.length === 0 && !manual) {
        return json({ error: "Não há ressalvas registradas para analisar." }, 400);
      }
      if (!ctx.minuta?.conteudo) {
        return json({ error: "Não há minuta gerada para ajustar." }, 400);
      }

      const listaRessalvas = manual
        ? `- ${manual}`
        : devolucoes.map((d) => `- (rodada ${d.rodada}${d.autor_nome ? `, ${d.autor_nome}` : ""}) ${d.observacoes}`).join("\n");

      const system = `Você é a Artemis, assistente notarial. O jurídico da CONSTRUTORA devolveu a minuta com ressalvas. Sua tarefa é propor os AJUSTES DE TEXTO.

REGRAS:
- Para cada ressalva, indique o trecho atual da minuta e proponha a nova redação.
- Sugira apenas o que a ressalva pede. Não reescreva a minuta inteira.
- Se a ressalva for JURIDICAMENTE INVIÁVEL ou contrariar a lei notarial/registral, NÃO a acate: explique o motivo no campo "objecoes" e proponha alternativa compatível. A conveniência comercial da construtora não se sobrepõe à legalidade do ato.
- Se a ressalva for ambígua, registre em "duvidas" o que precisa ser esclarecido com a construtora.
- NUNCA invente dados (nome, CPF, matrícula, valor, data).
- Você propõe; o tabelião decide e aplica.

Responda APENAS com JSON:
{
 "ajustes":[{"ressalva":"o que foi pedido","trecho_atual":"trecho da minuta (curto)","texto_sugerido":"nova redação","justificativa":"por que atende"}],
 "objecoes":[{"ressalva":"...","motivo":"por que não pode ser acatada como pedida","alternativa":"..."}],
 "duvidas":["pontos a esclarecer com a construtora"],
 "resumo":"síntese em 2 a 4 frases para o escrevente"
}`;

      const entrada = `${ctx.bloco}

RESSALVAS DO JURÍDICO DA CONSTRUTORA:
${listaRessalvas}

MINUTA ATUAL (versão ${ctx.minuta.versao}):
"""
${String(ctx.minuta.conteudo).slice(0, 14000)}
"""

Analise as ressalvas e proponha os ajustes.`;

      const r = await callModelJson(system, [{ role: "user", content: entrada }], 3500);

      await admin.rpc("registrar_custodia", {
        p_solicitacao: solicitacaoId, p_minuta: ctx.minuta.id, p_acao: "ressalvas_analisadas",
        p_detalhe: { ajustes: (r.ajustes ?? []).length, objecoes: (r.objecoes ?? []).length }, p_ator: uid ?? null,
      });

      return json({
        ok: true, minuta_versao: ctx.minuta.versao,
        ajustes: r.ajustes ?? [], objecoes: r.objecoes ?? [],
        duvidas: r.duvidas ?? [], resumo: String(r.resumo ?? ""),
        ressalvas_consideradas: manual ? [manual] : devolucoes.map((d) => d.observacoes),
      });
    }

    return json({ error: "ação desconhecida" }, 400);
  } catch (e) {
    return await respostaErro("minuta-assistente", e, 500, { solicitacaoId: ctxId });
  }
});

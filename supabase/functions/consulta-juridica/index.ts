// supabase/functions/consulta-juridica/index.ts
// Consulta jurídica: confronta o ACERVO do cartório (jurisprudências e
// orientações do tabelião) com a LEGISLAÇÃO NOTARIAL e emite um parecer.
// Aceita uma pergunta livre e/ou um protocolo específico.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders, json } from "../_shared/cors.ts";
import { respostaErro } from "../_shared/erros.ts";
import { callModelJson, PROVEDOR_ATIVO, MODELO_ATIVO, gravarUso } from "../_shared/artemis.ts";

const LEGISLACAO = `LEGISLAÇÃO NOTARIAL E REGISTRAL DE REFERÊNCIA (Brasil):
- CF/88, art. 236 (serviços notariais e de registro, por delegação).
- Lei 8.935/1994 (Lei dos Notários e Registradores): atribuições e competência do tabelião (arts. 6º a 8º), responsabilidade (art. 22), fé pública.
- Código Civil/2002: negócio jurídico e forma (arts. 104, 107, 166, 167); escritura pública como requisito de validade em imóveis acima de 30 salários mínimos (art. 108); requisitos da escritura (art. 215); outorga conjugal (art. 1.647); mandato e procuração (arts. 653 e ss.); regimes de bens (arts. 1.639 e ss.); doação (arts. 538 e ss.); usufruto (arts. 1.390 e ss.).
- Lei 7.433/1985 e Decreto 93.240/1986: documentos exigidos para lavratura de escritura de imóvel (certidões, comprovação de quitação de tributos, identificação das partes).
- Lei 6.015/1973 (LRP): registros públicos; continuidade (art. 195), especialidade e disponibilidade; retificação (art. 213).
- Lei 14.382/2022: Sistema Eletrônico dos Registros Públicos (SERP) e atos eletrônicos.
- Lei 11.441/2007 e CPC/2015, art. 610 e ss.: inventário, partilha, separação e divórcio por escritura pública.
- Provimentos do CNJ / Código Nacional de Normas da Corregedoria Nacional de Justiça (CNN/CN/CNJ-Extra), incluindo o regime do e-Notariado e da videoconferência notarial.
- Normas de Serviço da Corregedoria-Geral da Justiça do Estado (NSCGJ) — variam por unidade federativa.
- Lei 13.709/2018 (LGPD) quanto ao tratamento de dados no serviço notarial.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);

  let ctxId: string | undefined;
  try {
    const { pergunta, solicitacaoId, salvar = true } = await req.json();
    ctxId = solicitacaoId;
    const perguntaTxt = String(pergunta ?? "").trim();
    if (!perguntaTxt && !solicitacaoId)
      return json({ error: "Informe uma pergunta ou um protocolo para consultar." }, 400);

    const auth = req.headers.get("Authorization") ?? "";
    const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: userRes } = await userClient.auth.getUser();
    const uid = userRes?.user?.id;
    if (!uid) return json({ error: "Não autenticado." }, 401);
    const { data: prof } = await admin.from("profiles").select("cartorio_id").eq("id", uid).maybeSingle();
    const cartorioId = (prof as any)?.cartorio_id;
    if (!cartorioId) return json({ error: "Usuário sem cartório vinculado." }, 403);

    // ---- Contexto do ato (quando a consulta é sobre um protocolo) ----
    let contextoAto = "";
    if (solicitacaoId) {
      const { data: sol } = await userClient.from("solicitacoes")
        .select("protocolo, titulo, dados, complexidade, etapa, tipos_ato(nome, slug)").eq("id", solicitacaoId).maybeSingle();
      if (sol) {
        const s: any = sol;
        const { data: partes } = await userClient.from("partes").select("papel, nome, cpf_cnpj, dados").eq("solicitacao_id", solicitacaoId);
        const { data: docs } = await userClient.from("documentos").select("tipo, extraido").eq("solicitacao_id", solicitacaoId);
        const mat = (docs ?? []).find((d: any) => d.tipo === "matricula")?.extraido;
        contextoAto = `
ATO EM ANÁLISE
Protocolo: ${s.protocolo ?? "—"} · Tipo: ${s.tipos_ato?.nome ?? "—"} · Etapa: ${s.etapa ?? "—"} · Complexidade: ${s.complexidade ?? "não classificada"}
Partes: ${(partes ?? []).map((p: any) => `${p.papel}: ${p.nome}${p.dados?.estado_civil ? `, ${p.dados.estado_civil}` : ""}${p.dados?.regime_bens ? `, ${p.dados.regime_bens}` : ""}`).join(" | ") || "não cadastradas"}
Dados do ato: ${JSON.stringify(s.dados ?? {}).slice(0, 1200)}
Ônus da matrícula: ${(mat?.onus ?? []).map((o: any) => o.tipo).join("; ") || "nenhum lido"}`;
      }
    }

    // ---- Acervo do cartório: jurisprudências e orientações do tabelião ----
    const termos = (perguntaTxt || contextoAto).toLowerCase()
      .replace(/[^\wàáâãéêíóôõúç\s]/gi, " ").split(/\s+/)
      .filter((t) => t.length > 4).slice(0, 12);

    let q = admin.from("acervo")
      .select("id, titulo, categoria, tema, descricao, conteudo_texto, tipo_ato_slug")
      .eq("cartorio_id", cartorioId).in("categoria", ["jurisprudencia", "orientacao"])
      .order("created_at", { ascending: false }).limit(40);
    const { data: acervoTudo } = await q;

    // relevância simples e transparente: ocorrência dos termos no título/tema/descrição/texto
    const pontuar = (a: any) => {
      const alvo = `${a.titulo} ${(a.tema ?? []).join(" ")} ${a.descricao ?? ""} ${(a.conteudo_texto ?? "").slice(0, 4000)}`.toLowerCase();
      return termos.reduce((n, t) => n + (alvo.includes(t) ? 1 : 0), 0);
    };
    const selecionados = ((acervoTudo as any[]) ?? [])
      .map((a) => ({ a, p: pontuar(a) }))
      .sort((x, y) => y.p - x.p)
      .filter((x, i) => x.p > 0 || i < 3)   // sempre leva algo do acervo, mesmo sem match
      .slice(0, 6)
      .map((x) => x.a);

    const blocoAcervo = selecionados.length
      ? selecionados.map((a, i) => `[${i + 1}] (${a.categoria === "jurisprudencia" ? "Jurisprudência" : "Orientação do tabelião"}) ${a.titulo}
${a.descricao ? `Resumo: ${a.descricao}\n` : ""}${(a.conteudo_texto ?? "").slice(0, 1800)}`).join("\n\n")
      : "(O acervo do cartório ainda não tem jurisprudências ou orientações cadastradas sobre o tema.)";

    // ---- Parecer ----
    const system = `Você é a Artemis, assistente jurídica notarial do cartório, especialista em direito notarial e registral brasileiro.

Sua tarefa: responder à consulta CONFRONTANDO duas fontes:
(A) o ACERVO INTERNO do cartório (jurisprudências e orientações do tabelião fornecidas abaixo) — é a posição da casa;
(B) a LEGISLAÇÃO NOTARIAL vigente.

${LEGISLACAO}

REGRAS:
- Cite os dispositivos legais pelo nome e número (ex.: "art. 1.647, I, do Código Civil"). NUNCA invente número de artigo, súmula ou provimento: se não tiver certeza do dispositivo, descreva a regra sem citar número e sinalize que a referência deve ser conferida.
- Ao usar o acervo, referencie pelo índice fornecido ([1], [2]...).
- Se o acervo DIVERGIR da legislação ou estiver desatualizado, aponte isso expressamente — é a informação mais valiosa do parecer.
- Se o acervo for silente, diga que a orientação interna não cobre o caso e responda apenas pela legislação.
- Assinale as competências: o que é do tabelião, o que é do registrador, o que depende de decisão judicial.
- Fé pública indelegável: você fundamenta, o tabelião decide. Não afirme que um ato "pode ser lavrado" de forma peremptória; indique requisitos e riscos.
- Responda em português do Brasil, técnico e objetivo.

Responda APENAS com JSON:
{
  "parecer": "análise em 2 a 5 parágrafos, redigida de forma corrida",
  "fundamentos": [{"norma":"ex.: Código Civil","dispositivo":"ex.: art. 215","aplicacao":"como incide no caso"}],
  "fontes_acervo": [{"indice":1,"titulo":"...","como_usado":"convergente | divergente | complementar"}],
  "divergencias": "o que no acervo interno conflita com a lei, ou string vazia",
  "ressalvas": "riscos, requisitos pendentes e o que depende de conferência do tabelião"
}`;

    const entrada = `CONSULTA: ${perguntaTxt || "Analise juridicamente o ato indicado abaixo e aponte requisitos, riscos e exigências."}
${contextoAto}

ACERVO INTERNO DO CARTÓRIO:
${blocoAcervo}`;

    const r = await callModelJson(system, [{ role: "user", content: entrada }], 3000);

    const fontes = (r.fontes_acervo ?? []).map((f: any) => {
      const a = selecionados[(Number(f.indice) || 1) - 1];
      return { id: a?.id ?? null, titulo: a?.titulo ?? f.titulo ?? "", categoria: a?.categoria ?? null, como_usado: f.como_usado ?? null };
    });

    const registro = {
      cartorio_id: cartorioId, solicitacao_id: solicitacaoId ?? null, autor: uid,
      pergunta: perguntaTxt || `Análise do protocolo`,
      parecer: String(r.parecer ?? ""), fundamentos: r.fundamentos ?? [],
      fontes_acervo: fontes, ressalvas: String(r.ressalvas ?? ""),
    };
    let id: string | null = null;
    if (salvar) {
      const { data: ins } = await admin.from("consultas_juridicas").insert(registro).select("id").maybeSingle();
      id = (ins as any)?.id ?? null;
      if (solicitacaoId) {
        await admin.rpc("registrar_custodia", {
          p_solicitacao: solicitacaoId, p_minuta: null, p_acao: "consulta_juridica",
          p_detalhe: { pergunta: registro.pergunta, fontes: fontes.length }, p_ator: uid ?? null,
        });
    await gravarUso(admin, "consulta-juridica", null, solicitacaoId);
      }
    }

    return json({
      ok: true, id, ...registro,
      divergencias: String(r.divergencias ?? ""),
      provedor: PROVEDOR_ATIVO, modelo: MODELO_ATIVO,
      acervo_consultado: selecionados.map((a, i) => ({ indice: i + 1, id: a.id, titulo: a.titulo, categoria: a.categoria })),
    });
  } catch (e) {
    return await respostaErro("consulta-juridica", e, 500, { solicitacaoId: ctxId });
  }
});

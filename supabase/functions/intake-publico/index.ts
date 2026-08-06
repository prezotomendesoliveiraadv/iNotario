// supabase/functions/intake-publico/index.ts
// Onboarding externo por IA (público, sem login). Ações (body.action):
//   "tipos"      -> lista os serviços disponíveis
//   "iniciar"    -> cria a demanda externa (rascunho) + token + protocolo
//   "chat"       -> conversa com a Artemis de atendimento (texto ou voz)
//   "upload-url" -> signed URL p/ anexar documento (bucket 'documentos')
//   "finalizar"  -> compila a solicitação, aceita LGPD e a coloca no painel
//
// Publique com: supabase functions deploy intake-publico --no-verify-jwt
// (ou verify_jwt=false no config.toml). A segurança é o token da demanda.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders, json } from "../_shared/cors.ts";
import { respostaErro } from "../_shared/erros.ts";
import { callModel, callModelJson, sintetizarAudio, sanitizarResposta, extrairCampos, conversarComAudio, type Msg } from "../_shared/artemis.ts";
import { promptAtendimento } from "../_shared/atendimento.ts";

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

async function resolveCartorio(): Promise<string | null> {
  const envId = Deno.env.get("INTAKE_CARTORIO_ID");
  if (envId) return envId;
  const { data } = await admin.from("cartorios").select("id").limit(1).maybeSingle();
  return (data as any)?.id ?? null;
}
async function validar(token: string) {
  const { data } = await admin.from("acesso_cliente").select("*").eq("token", token).maybeSingle();
  if (!data) return null;
  if (new Date((data as any).expira_em).getTime() < Date.now()) return null;
  return data as any;
}
function parseJson(txt: string): any {
  let t = txt.trim().replace(/^```(json)?/i, "").replace(/```$/, "").trim();
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a >= 0 && b > a) t = t.slice(a, b + 1);
  return JSON.parse(t);
}

const CARTORIO = Deno.env.get("INTAKE_CARTORIO_ID") ?? "";

/** Catálogo de empreendimentos do cartório (nome + construtora). */
async function catalogo(admin: any): Promise<{ id: string; nome: string; construtora: string }[]> {
  if (!CARTORIO) return [];
  const { data } = await admin.rpc("buscar_empreendimentos", { p_cartorio: CARTORIO, p_termo: null, p_limite: 50 });
  return ((data as any[]) ?? []).map((e) => ({ id: e.id, nome: e.nome, construtora: e.construtora }));
}

/** Reconhece empreendimento citado e o número da unidade no que a pessoa falou. */
function detectarUnidade(texto: string, empr: { id: string; nome: string }[]) {
  const t = (texto ?? "").toLowerCase();
  const achado = empr.find((e) => {
    const n = e.nome.toLowerCase();
    if (t.includes(n)) return true;
    // tolera "Ed. Iemanjá" / "edifício Iemanjá" citando só o nome próprio
    const nucleo = n.replace(/^(ed\.?|edif[íi]cio|residencial|cond\.?|condom[íi]nio)\s+/i, "").trim();
    return nucleo.length >= 4 && t.includes(nucleo);
  });
  if (!achado) return null;
  const m = t.match(/(?:unidade|apto?\.?|apartamento|ap\.?|casa|sala|lote)\s*(?:n[º°.]?\s*)?([0-9]{1,5}[a-z]?)/i)
        ?? t.match(/\bn[º°]\s*([0-9]{1,5}[a-z]?)/i);
  return { empreendimento_id: achado.id, nome: achado.nome, unidade: m ? m[1].toUpperCase() : null };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);

  try {
    const body = await req.json();
    const action = body.action;

    // ---- lista de serviços (para a tela inicial) ----
    if (action === "tipos") {
      const { data } = await admin.from("tipos_ato").select("slug, nome, descricao").order("nome");
      return json({ tipos: data ?? [] });
    }

    // ---- cria a demanda externa ----
    if (action === "iniciar") {
      const cartorioId = await resolveCartorio();
      if (!cartorioId) return json({ error: "Cartório não configurado (INTAKE_CARTORIO_ID)." }, 500);
      let { data: tipo } = await admin.from("tipos_ato").select("id, nome").eq("slug", body.tipoAtoSlug).maybeSingle();
      if (!tipo) { const r = await admin.from("tipos_ato").select("id, nome").limit(1).maybeSingle(); tipo = r.data as any; }
      if (!tipo) return json({ error: "Nenhum tipo de ato cadastrado." }, 500);

      const { data: sol, error: eSol } = await admin.from("solicitacoes").insert({
        cartorio_id: cartorioId, tipo_ato_id: (tipo as any).id, status: "rascunho",
        origem: "externa", titulo: "Demanda externa (onboarding)",
      }).select("id, protocolo").single();
      if (eSol) throw eSol;

      const { data: ac, error: eAc } = await admin.from("acesso_cliente")
        .insert({ solicitacao_id: (sol as any).id }).select("token").single();
      if (eAc) throw eAc;

      const nome = (tipo as any).nome as string;
      const saudacao = `Oi! Aqui é a Artemis, do cartório. Vou te ajudar com ${nome.toLowerCase()}. Me conta: esse ato é pra você mesmo, ou você está cuidando disso pra outra pessoa ou empresa?`;
      const out: Record<string, unknown> = {
        token: (ac as any).token, protocolo: (sol as any).protocolo, tipoAtoNome: nome, saudacao,
      };
      // Voz: já devolve o áudio da saudação — a Artemis fala assim que a tela abre.
      if (body.comVoz) {
        try { const a = await sintetizarAudio(saudacao); out.audio = a.data; out.audioMime = a.mime; }
        catch { /* sem áudio: a tela ainda funciona por texto */ }
      }
      return json(out);
    }

    // ---- acompanhamento seguro: protocolo + WhatsApp devem conferir ----
    if (action === "status") {
      const protocolo = String(body.protocolo ?? "").trim();
      const wpp = String(body.whatsapp ?? "").replace(/\D/g, "");
      if (!protocolo || wpp.length < 10) return json({ error: "Informe o protocolo e o WhatsApp usados na solicitação." }, 400);

      const { data: sol } = await admin.from("solicitacoes")
        .select("id, protocolo, status, updated_at, created_at, contato_whatsapp, contato_nome, tipos_ato(nome)")
        .eq("protocolo", protocolo).maybeSingle();

      // resposta neutra (não revela se o protocolo existe) + verificação do WhatsApp
      const cad = String((sol as any)?.contato_whatsapp ?? "").replace(/\D/g, "");
      const bate = sol && cad && (cad === wpp || cad === "55" + wpp || "55" + cad === wpp || cad.endsWith(wpp.slice(-11)));
      if (!bate) return json({ error: "Não localizamos uma solicitação com esse protocolo e WhatsApp. Confira os dados." }, 404);

      const ETAPAS: Record<string, string> = {
        rascunho: "Em preenchimento", recebida: "Recebida pelo cartório", em_elaboracao: "Em elaboração",
        em_revisao: "Em revisão", aprovada: "Aprovada — aguardando conclusão", concluida: "Concluída", cancelada: "Cancelada",
      };
      const primeiroNome = String((sol as any).contato_nome ?? "").split(/\s+/)[0] || null;
      // divulgação mínima: sem dados pessoais além do primeiro nome
      return json({
        ok: true, protocolo: (sol as any).protocolo, nome: primeiroNome,
        servico: (sol as any).tipos_ato?.nome ?? null,
        etapa: ETAPAS[(sol as any).status] ?? (sol as any).status,
        atualizado_em: (sol as any).updated_at, criado_em: (sol as any).created_at,
      });
    }

    // as demais ações exigem token válido
    const acesso = body.token ? await validar(body.token) : null;
    if (!acesso) return json({ error: "Link/sessão inválido ou expirado." }, 403);

    // ---- conversa (texto ou voz) ----
    if (action === "chat") {
      const canal = body.channel === "VOZ" ? "VOZ" : "TEXTO";
      const messages: Msg[] = Array.isArray(body.messages) ? body.messages.slice() : [];
      const empr = await catalogo(admin);
      // O que já está na tela do cliente, para a Artemis reconhecer em vez de repetir
      const camposTela = (body.campos ?? {}) as Record<string, string>;

      // Verificação determinística: se a pessoa citou empreendimento + unidade,
      // conferimos na base se já existe protocolo — sem depender do modelo.
      const ditoPeloCliente = [...messages.filter((m) => m.role === "user").map((m) => m.content)].join(" ");
      const alvo = detectarUnidade(ditoPeloCliente, empr);

      const system = promptAtendimento(canal, {
        tipoAtoNome: body.tipoAtoNome, empreendimentos: empr,
        trilha: body.trilha === "documentos" ? "documentos" : "conversa",
        campos: { nome: camposTela.nome, telefone: camposTela.telefone, email: camposTela.email },
        empreendimentoConfirmado: alvo?.nome ?? null,
      });
      let alertaUnidade: Record<string, unknown> | null = null;
      if (alvo?.unidade) {
        const { data: usos } = await admin.rpc("unidade_em_uso", {
          p_empreendimento: alvo.empreendimento_id, p_unidade: alvo.unidade,
        });
        const lista = (usos as any[]) ?? [];
        if (lista.length) {
          alertaUnidade = {
            empreendimento: alvo.nome, unidade: alvo.unidade,
            protocolo: lista[0].protocolo, etapa: lista[0].etapa, quantidade: lista.length,
          };
        }
      }
      const out: Record<string, unknown> = {};

      // O aviso entra como contexto do sistema para a Artemis relatar naturalmente.
      const messagesComAviso: Msg[] = alertaUnidade
        ? [...messages, { role: "user", content:
            `[AVISO DO CARTÓRIO — relate isto com naturalidade na sua próxima fala: já existe o protocolo ${alertaUnidade.protocolo} aberto para a unidade ${alertaUnidade.unidade} do ${alertaUnidade.empreendimento}. Pergunte se é a mesma negociação (acompanhamento) ou uma nova.]` } as Msg]
        : messages;

      if (canal === "VOZ" && body.audio?.data) {
        // UMA chamada: o modelo ouve o áudio e já devolve transcrição + resposta.
        const { transcricao, resposta } = await conversarComAudio(
          system, messagesComAviso, { data: body.audio.data, mime: body.audio.mime ?? "audio/webm" }, 700,
        );
        if (!transcricao) {
          // Não houve fala audível: pede para repetir, SEM poluir o histórico.
          const pedido = "Desculpa, não consegui ouvir direito. Pode repetir, por favor?";
          const a = await sintetizarAudio(pedido).catch(() => null);
          return json({ reply: pedido, transcript: "", audio: a?.data, audioMime: a?.mime, inaudivel: true });
        }
        const exV = extrairCampos(resposta);
        out.transcript = transcricao;
        out.reply = exV.texto;
        if (Object.keys(exV.campos).length) out.campos = exV.campos;
        if (alvo?.nome) out.empreendimento_confirmado = alvo.nome;
        if (alertaUnidade) out.alerta_unidade = alertaUnidade;
        const a = await sintetizarAudio(resposta).catch(() => null);
        if (a) { out.audio = a.data; out.audioMime = a.mime; }
        return json(out);
      }

      if (!messages.length) return json({ error: "Sem mensagem." }, 400);
      const bruto = sanitizarResposta(await callModel(system, messagesComAviso, 700));
      const ex = extrairCampos(bruto);
      const reply = ex.texto;
      out.reply = reply;
      if (Object.keys(ex.campos).length) out.campos = ex.campos;
      if (alvo?.nome) out.empreendimento_confirmado = alvo.nome;
      if (alertaUnidade) out.alerta_unidade = alertaUnidade;
      if (canal === "VOZ") {
        const a = await sintetizarAudio(reply).catch(() => null);
        if (a) { out.audio = a.data; out.audioMime = a.mime; }
      }
      return json(out);
    }

    // ---- falar: apenas sintetiza um texto (saudação por voz ao entrar) ----
    if (action === "falar") {
      const texto = String(body.texto ?? "").trim();
      if (!texto) return json({ error: "Sem texto." }, 400);
      const a = await sintetizarAudio(texto);
      return json({ audio: a.data, audioMime: a.mime });
    }

    // ---- traduzir: legenda em inglês sob demanda (não bloqueia o áudio em pt) ----
    if (action === "traduzir") {
      const texto = String(body.texto ?? "").trim();
      if (!texto) return json({ texto: "" });
      const traducao = await callModel(
        "You are a translator. Translate the user's text to natural English. Reply ONLY with the translation, no quotes, no notes.",
        [{ role: "user", content: texto }], 400,
      );
      return json({ texto: traducao.trim() });
    }

    // ---- anexar documento (vai para o bucket 'documentos' p/ preenchimento automático) ----
    if (action === "upload-url") {
      const nome = String(body.nome_arquivo ?? "documento");
      const tipoDoc = String(body.tipo_doc ?? "outro");
      const safe = nome.replace(/[^\w.\-]/g, "_").slice(0, 80);
      const path = `${acesso.solicitacao_id}/${crypto.randomUUID()}_${safe}`;
      const { data: signed, error: e1 } = await admin.storage.from("documentos").createSignedUploadUrl(path);
      if (e1) throw e1;
      const { error: e2 } = await admin.from("documentos").insert({
        solicitacao_id: acesso.solicitacao_id, tipo: tipoDoc, nome_arquivo: nome, storage_path: path, mime: body.mime ?? null,
      });
      if (e2) throw e2;
      return json({ path, token: signed.token });
    }

    // ---- finalizar: compila a demanda e coloca no painel ----
    if (action === "finalizar") {
      if (!body.lgpd_aceite) return json({ error: "É necessário aceitar os termos da LGPD." }, 400);
      const messages: Msg[] = Array.isArray(body.messages) ? body.messages.slice() : [];
      const contato = body.contato ?? {};

      const { data: tipos } = await admin.from("tipos_ato").select("id, slug");
      const esquema = `Compile esta solicitação de atendimento em uma FICHA ESTRUTURADA. Extraia somente o que foi dito (não invente; ausente = ""). Responda SOMENTE com JSON válido:
{
  "tipo_ato_slug": "",
  "titulo": "título curto do ato (ex.: Compra e venda — Ed. Iemanjá, ap. 12)",
  "solicitante": { "nome":"", "qualificacao":"parte|representante", "representa":"", "vinculo":"imobiliaria|construtora|advogado|familiar|outro", "empresa":"" },
  "partes": [ { "papel":"", "nome":"", "estado_civil":"", "regime_bens":"", "cpf":"", "rg":"", "profissao":"", "cidade":"" } ],
  "imovel": { "descricao":"", "empreendimento":"", "unidade":"", "torre_bloco":"", "endereco":"", "matricula":"", "cartorio_ri":"", "construtora":"", "valor":"", "forma_pagamento":"" },
  "pre_qualificacao": [ {"pergunta":"","resposta":""} ],
  "dados": {},
  "resumo": "2-3 frases, em linguagem natural, do que o cliente precisa"
}
Em "partes", use papéis notariais (Outorgante Vendedor, Outorgado Comprador, Outorgante, Outorgado, Doador, Donatário...). Em "dados", coloque pares campo/valor úteis à minuta (valor, forma de pagamento etc.).`;
      const system = promptAtendimento("TEXTO", {});
      let r: any = {};
      try { r = await callModelJson(system, [...messages, { role: "user", content: esquema }], 3000); }
      catch { r = {}; }
      if (!r || typeof r !== "object") r = {};

      const solicitante = r.solicitante && typeof r.solicitante === "object" ? r.solicitante : {};
      const imovel = r.imovel && typeof r.imovel === "object" ? r.imovel : {};
      const dados: Record<string, unknown> = r.dados && typeof r.dados === "object" ? r.dados : {};
      if (imovel.descricao) dados.imovel_descricao = imovel.descricao;
      if (imovel.matricula) dados.imovel_matricula = imovel.matricula;
      if (imovel.cartorio_ri) dados.imovel_cartorio_ri = imovel.cartorio_ri;
      if (imovel.valor) dados.valor = imovel.valor;
      if (imovel.forma_pagamento) dados.forma_pagamento = imovel.forma_pagamento;

      const update: Record<string, unknown> = {
        status: "recebida", origem: "externa",
        dados,
        intake: {
          solicitante,
          descricao_objeto: imovel.descricao ?? "", empreendimento: imovel.empreendimento ?? "",
          endereco: imovel.endereco ?? "", construtora: imovel.construtora ?? "",
          matricula: imovel.matricula ?? "", cartorio_ri: imovel.cartorio_ri ?? "",
          valor: imovel.valor ?? "", forma_pagamento: imovel.forma_pagamento ?? "",
          pre_qualificacao: r.pre_qualificacao ?? [], resumo: r.resumo ?? "",
        },
        titulo: r.titulo || "Demanda externa",
        contato_nome: contato.nome ?? solicitante.nome ?? null,
        contato_email: contato.email ?? null, contato_whatsapp: contato.whatsapp ?? null,
      };
      const t = (tipos ?? []).find((x: any) => x.slug === r.tipo_ato_slug);
      if (t) update.tipo_ato_id = (t as any).id;

      // Venda de construtora: vincula o ato ao empreendimento/unidade e traz a
      // qualificação da vendedora do cadastro — o cliente não precisou informar.
      const empr2 = await catalogo(admin);
      const citado = `${imovel.empreendimento ?? ""} ${imovel.unidade ?? ""} ${r.titulo ?? ""}`;
      const alvo2 = detectarUnidade(citado, empr2)
        ?? detectarUnidade(messages.filter((m) => m.role === "user").map((m) => m.content).join(" "), empr2);
      let vendedoraAplicada: any = null;
      if (alvo2) {
        const unidade = String(imovel.unidade ?? alvo2.unidade ?? "").trim() || null;
        update.empreendimento_id = alvo2.empreendimento_id;
        if (unidade) update.unidade = unidade;
      }

      await admin.from("solicitacoes").update(update).eq("id", acesso.solicitacao_id);

      if (alvo2) {
        const { data: apl } = await admin.rpc("aplicar_vendedor_construtora", {
          p_solicitacao: acesso.solicitacao_id, p_papel: "Outorgante Vendedor",
        });
        vendedoraAplicada = apl ?? null;
      }

      // grava as PARTES extraídas (facilita o trabalho do cartório; validação humana depois)
      let partes = Array.isArray(r.partes) ? r.partes.filter((p: any) => p?.nome) : [];
      // A vendedora já foi qualificada pelo cadastro: descarta o que a conversa
      // tenha capturado para esse papel, evitando parte duplicada/divergente.
      if (vendedoraAplicada?.ok) {
        partes = partes.filter((p: any) => !/vendedor|outorgante/i.test(String(p.papel ?? "")));
      }
      for (const p of partes) {
        await admin.from("partes").insert({
          solicitacao_id: acesso.solicitacao_id,
          papel: p.papel || "Parte", nome: p.nome, cpf_cnpj: p.cpf || null,
          dados: {
            estado_civil: p.estado_civil || null, regime_bens: p.regime_bens || null,
            rg: p.rg || null, profissao: p.profissao || null, cidade: p.cidade || null,
            origem: "intake_ia",
          },
        });
      }

      await admin.from("acesso_cliente").update({
        lgpd_aceite: true, lgpd_aceite_em: new Date().toISOString(), lgpd_versao: "v1",
        devolvido_em: new Date().toISOString(), email_cliente: contato.email ?? null,
      }).eq("id", acesso.id);
      await admin.rpc("registrar_custodia", {
        p_solicitacao: acesso.solicitacao_id, p_minuta: null, p_acao: "intake_externo",
        p_detalhe: { via: "portal-ia", whatsapp: !!contato.whatsapp, partes: partes.length, solicitante: solicitante.qualificacao ?? null },
      });

      const { data: sol } = await admin.from("solicitacoes").select("protocolo").eq("id", acesso.solicitacao_id).single();
      return json({
        ok: true, protocolo: (sol as any)?.protocolo, resumo: r.resumo ?? "",
        ficha: { solicitante, partes, imovel, tipo_ato_slug: r.tipo_ato_slug ?? "", titulo: r.titulo ?? "" },
        construtora: vendedoraAplicada?.ok
          ? { razao_social: vendedoraAplicada.construtora, representante: vendedoraAplicada.representante }
          : null,
      });
    }

    return json({ error: "ação desconhecida" }, 400);
  } catch (e) {
    return await respostaErro("intake-publico", e, 500);
  }
});

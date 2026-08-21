// supabase/functions/artemis-extract/index.ts
// Lê um documento (RG, CNH ou matrícula) vinculado à solicitação e extrai os
// campos pertinentes para preenchimento e POSTERIOR VALIDAÇÃO humana.
// Body: { "documentoId": "<uuid>" }   (usuário autenticado da equipe)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders, json } from "../_shared/cors.ts";
import { respostaErro } from "../_shared/erros.ts";
import { callModel, callModelVision, PROVEDOR_ATIVO, MODELO_ATIVO, gravarUso } from "../_shared/artemis.ts";

const SYSTEM = `Você é Artemis, especialista em qualificação notarial. Leia o documento fornecido e extraia EXATAMENTE os dados solicitados. Não invente: se um campo estiver ilegível ou ausente, retorne string vazia. Não normalize além do necessário. Responda SOMENTE com JSON válido, sem texto fora do JSON e sem cercas de código.`;

function instrucao(tipo: string): string {
  if (tipo === "rg" || tipo === "cnh") {
    return `Documento de identificação (${tipo.toUpperCase()}) de uma das partes. Extraia e responda SOMENTE com:
{ "nome":"", "cpf":"", "rg":"", "data_nascimento":"", "filiacao":"", "nacionalidade":"", "endereco":"" }`;
  }
  if (tipo === "matricula") {
    return `Matrícula de imóvel do Registro de Imóveis. Extraia e responda SOMENTE com:
{ "imovel_matricula":"", "imovel_cartorio_ri":"", "imovel_descricao":"", "proprietarios":[""], "area":"",
  "imovel_endereco":"", "emitida_em":"AAAA-MM-DD",
  "onus":[ {"tipo":"", "detalhe":""} ], "ha_indisponibilidade": false }
Em "onus", liste TODAS as averbações de ônus, gravames ou restrições que aparentem estar ATIVAS na matrícula: hipoteca, penhora, arresto, sequestro, indisponibilidade, alienação fiduciária, usufruto, servidão, cláusula de inalienabilidade/impenhorabilidade/incomunicabilidade, bem de família, ação reipersecutória e averbação premonitória de execução. Se não houver nenhuma, retorne lista vazia. Não invente.
"emitida_em" é a data de EXPEDIÇÃO da certidão de matrícula (o carimbo/rodapé do cartório de registro), não a data
de abertura da matrícula nem a do último registro. Formato AAAA-MM-DD. Se não constar, deixe "" — é melhor vazio do
que uma data errada, porque este campo controla o prazo de 30 dias.`;
  }
  if (tipo === "certidao") {
    return `Certidão (negativa de débitos, ônus reais, distribuidor, trabalhista, FGTS, etc.).
Extraia e responda SOMENTE com:
{ "certidao_tipo":"", "orgao_emissor":"", "numero":"", "emitida_em":"AAAA-MM-DD",
  "validade":"AAAA-MM-DD", "prazo_dias":0, "resultado":"negativa|positiva|positiva com efeito de negativa|indefinido",
  "titular":"", "cpf_cnpj":"", "observacoes":"" }
Regras: datas SEMPRE em AAAA-MM-DD. Se a certidão indicar apenas prazo de validade em dias (ex.: "válida por 90 dias"),
preencha "prazo_dias" e calcule "validade" a partir da emissão. Se a validade não constar, deixe "" — não invente.`;
  }
  if (tipo === "procuracao") {
    return `Procuração (pública ou particular). Extraia e responda SOMENTE com:
{ "outorgante":"", "outorgante_cpf_cnpj":"", "outorgado":"", "outorgado_cpf":"",
  "lavrada_em":"AAAA-MM-DD", "validade":"AAAA-MM-DD", "prazo":"", "irrevogavel": false,
  "poderes":"", "poderes_para_alienar": false, "substabelecimento_permitido": false,
  "tabelionato":"", "livro":"", "folha":"" }
Regras: datas em AAAA-MM-DD. "poderes_para_alienar" só true se houver poderes EXPRESSOS para vender/alienar/dar quitação.
Se o instrumento não indicar prazo, deixe "validade" vazia e descreva em "prazo" (ex.: "sem prazo determinado"). Não invente.`;
  }
  if (tipo === "compromisso" || tipo === "contrato") {
    return `Compromisso/contrato particular de compra e venda de imóvel. Extraia e responda SOMENTE com:
{ "vendedores":[ {"nome":"","cpf_cnpj":"","estado_civil":"","regime_bens":"","profissao":"","endereco":""} ],
  "compradores":[ {"nome":"","cpf_cnpj":"","estado_civil":"","regime_bens":"","profissao":"","endereco":""} ],
  "empreendimento":"", "unidade":"", "torre_bloco":"", "vaga_garagem":"",
  "imovel_descricao":"", "imovel_matricula":"", "imovel_cartorio_ri":"",
  "valor_total":"", "forma_pagamento":"", "sinal":"", "saldo":"",
  "financiamento": false, "instituicao_financeira":"",
  "data_contrato":"AAAA-MM-DD", "prazo_entrega":"",
  "clausulas_relevantes":[ {"tema":"", "resumo":"", "trecho":""} ] }
Regras: liste TODAS as partes de cada polo, com a qualificação completa que o contrato trouxer.
Valores exatamente como aparecem no contrato (não converta, não arredonde).
Em "clausulas_relevantes", registre cada cláusula com efeito notarial ou registral, uma por entrada, usando
em "tema" um destes rótulos quando couber: alienação fiduciária, garantia hipotecária, rescisão, retenção,
direito de arrependimento, arras/sinal, condição resolutiva, retrovenda, reversão, cessão, multa, tolerância
de entrega, correção monetária. "resumo" em uma frase; "trecho" com a passagem literal (máx. 300 caracteres).
Não invente dados ausentes: use "" ou lista vazia.`;
  }
  return `Extraia os dados relevantes do documento e responda SOMENTE com um objeto JSON de pares campo/valor.`;
}

function parseJson(txt: string): any {
  let t = txt.trim().replace(/^```(json)?/i, "").replace(/```$/, "").trim();
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a >= 0 && b > a) t = t.slice(a, b + 1);
  return JSON.parse(t);
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = ""; const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);

  try {
    const body = await req.json();
    const { documentoId } = body;
    const acao = String(body.acao ?? "extrair");

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    if (acao === "certidao_construtora") {
      // Certidão do cadastro do empreendimento/construtora. Fica no bucket
      // `construtoras`, não em `documentos` — é do cadastro, não do protocolo.
      const certidaoId = String(body.certidaoId ?? "");
      if (!certidaoId) return json({ error: "certidaoId é obrigatório." }, 400);

      const { data: cert, error: eC } = await userClient
        .from("construtora_certidoes").select("*").eq("id", certidaoId).maybeSingle();
      if (eC || !cert) return json({ error: "Certidão não encontrada ou sem acesso." }, 404);
      const c = cert as any;
      if (!c.storage_path) return json({ error: "Anexe o arquivo da certidão antes de mandar ler." }, 400);

      const { data: blobC, error: eB } = await admin.storage.from("construtoras").download(c.storage_path);
      if (eB || !blobC) return json({ error: "Falha ao ler o arquivo no storage." }, 500);
      const bytesC = new Uint8Array(await blobC.arrayBuffer());

      const raw = await callModelVision(
        SYSTEM, instrucao("certidao"),
        [{ mime: blobC.type || "application/pdf", data: bytesToBase64(bytesC) }], 1200,
      );
      let lido: any;
      try { lido = parseJson(raw); } catch { return json({ error: "Não foi possível interpretar a certidão." }, 502); }

      const dt = (v: unknown) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v ?? "")) ? String(v) : null);
      await admin.from("construtora_certidoes").update({
        extraido: lido,
        // Só sobrescreve o que estava em branco: dado conferido por pessoa não
        // é substituído por leitura automática.
        numero: c.numero || lido.numero || null,
        emitida_em: c.emitida_em || dt(lido.emitida_em),
        validade: c.validade || dt(lido.validade),
        tipo: c.tipo || lido.certidao_tipo || "certidão",
        resultado: lido.resultado ?? null,
        lido_em: new Date().toISOString(),
      }).eq("id", certidaoId);

      await gravarUso(admin, "artemis-extract", null, null);
      return json({ ok: true, leitura: lido });
    }

    if (acao !== "contrato_social" && !documentoId) {
      return json({ error: "documentoId é obrigatório" }, 400);
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    // Autor real da ação: sob service role auth.uid() é nulo, então o ator
    // precisa ser resolvido aqui e passado explicitamente à custódia.
    const { data: _u } = await userClient.auth.getUser();
    const uid = _u?.user?.id ?? null;

    // ---- contrato social da construtora: representantes e poderes ----
    // Lê o arquivo do cadastro (bucket `construtoras`), não da tabela
    // `documentos`: o contrato social é do cadastro da empresa e vale para
    // todos os atos dela — não pertence a um protocolo.
    if (acao === "contrato_social") {
      const construtoraId = String(body.construtoraId ?? "");
      if (!construtoraId) return json({ error: "construtoraId é obrigatório." }, 400);

      const { data: emp, error: eEmp } = await userClient
        .from("construtoras").select("*").eq("id", construtoraId).maybeSingle();
      if (eEmp || !emp) return json({ error: "Construtora não encontrada ou sem acesso." }, 404);

      const c = emp as any;
      const ESQUEMA = `{ "representantes":[ {"nome":"","cpf":"","rg":"","nacionalidade":"","estado_civil":"",
      "profissao":"","endereco":"","cargo":"","poderes_forma":"isolada|conjunta|conjunta_com_outro",
      "restricoes":""} ],
  "poderes": {"forma":"", "quorum":"", "limite_valor":"", "restricoes":[""],
              "exige_anuencia":false, "observacao":""},
  "empresa": {"razao_social":"","cnpj":"","nire":"","data_arquivamento":"","junta":""},
  "alteracao_mais_recente":"", "fonte":"", "confianca":"alta|media|baixa" }`;

      const REGRAS = `Extraia APENAS o que o documento disser. Regras:
- "poderes_forma": "isolada" quando o representante pode assinar sozinho; "conjunta" quando a cláusula exige
  assinatura de dois ou mais; "conjunta_com_outro" quando exige assinatura em conjunto com pessoa determinada.
- Em "restricoes", registre limitações reais: alienação de imóveis exigindo aprovação, teto de valor,
  vedação de garantias, necessidade de anuência de sócio ou de assembleia.
- "quorum" só quando o texto disser expressamente (ex.: "dois diretores em conjunto").
- Se o documento for uma alteração contratual, considere a redação vigente e informe em
  "alteracao_mais_recente" a identificação dela.
- Nunca invente CPF, cargo ou poder. Campo sem informação vai vazio.
- "confianca": "baixa" quando o documento estiver ilegível, truncado ou for consolidação parcial.`;

      let bruto: string;
      let fonte: string;

      if (c.contrato_social_path) {
        const { data: blobCs, error: eCs } = await admin.storage.from("construtoras").download(c.contrato_social_path);
        if (eCs || !blobCs) return json({ error: "Falha ao ler o contrato social no storage." }, 500);
        const bytesCs = new Uint8Array(await blobCs.arrayBuffer());
        fonte = "contrato_social";
        bruto = await callModelVision(
          SYSTEM,
          `Contrato social (ou alteração consolidada) de uma sociedade. ${REGRAS}\n\nResponda SOMENTE com:\n${ESQUEMA}`,
          [{ mime: blobCs.type || "application/pdf", data: bytesToBase64(bytesCs) }], 2000,
        );
      } else if (String(c.modelo_escritura ?? "").trim()) {
        // Sem contrato social, o modelo de escritura costuma trazer a
        // qualificação da vendedora e de quem assina por ela. É fonte
        // secundária e sai marcada como tal — quem confere precisa saber.
        fonte = "modelo_escritura";
        bruto = await callModel(SYSTEM, [{ role: "user", content:
          `Do MODELO DE ESCRITURA abaixo, extraia a qualificação da vendedora e de quem assina por ela.
Este é um modelo: onde houver campo entre colchetes, o dado não existe — deixe vazio, não copie o rótulo.
${REGRAS}

MODELO:
"""
${String(c.modelo_escritura).slice(0, 12000)}
"""

Responda SOMENTE com:
${ESQUEMA}` }], 2000, { json: true });
      } else {
        return json({ error: "Anexe o contrato social ou preencha o modelo de escritura antes de mandar a IA ler." }, 400);
      }

      let lido: any;
      try { lido = parseJson(bruto); }
      catch { return json({ error: "Não foi possível interpretar o contrato social." }, 502); }

      lido.fonte = fonte;
      lido.lido_em = new Date().toISOString();
      await admin.from("construtoras")
        .update({ contrato_social_lido: lido, contrato_social_lido_em: lido.lido_em })
        .eq("id", construtoraId);

      return json({ ok: true, fonte, leitura: lido });
    }

    // valida acesso pelo RLS do usuário
    const { data: doc, error: eDoc } = await userClient
      .from("documentos").select("*").eq("id", documentoId).maybeSingle();
    if (eDoc || !doc) return json({ error: "Documento não encontrado ou sem acesso." }, 404);

    // ---- confrontar: contrato x matrícula, sem reler os arquivos ----
    // Usa as duas leituras já gravadas. Reler PDF a cada clique custaria caro e,
    // pior, poderia divergir da leitura que o escrevente validou na tela.
    if (acao === "confrontar") {
      const solicitacaoId = (doc as any).solicitacao_id;
      const contrato = (doc as any).extraido;
      if (!contrato) return json({ error: "O contrato ainda não foi lido pela IA." }, 400);

      const { data: mats } = await admin.from("documentos")
        .select("extraido, status, nome_arquivo, created_at")
        .eq("solicitacao_id", solicitacaoId).eq("tipo", "matricula")
        .order("created_at", { ascending: false });
      const mat = ((mats as any[]) ?? []).find((d) => d.status === "validado" && d.extraido)
        ?? ((mats as any[]) ?? []).find((d) => d.extraido);
      if (!mat) {
        return json({ error: "Nenhuma matrícula lida neste protocolo. Anexe a matrícula e mande a IA ler antes de confrontar." }, 409);
      }

      const instrucaoConf = `Você confronta dois documentos do MESMO imóvel: o contrato de compra e venda e a
matrícula do Registro de Imóveis. Aponte convergências e divergências com olhar de qualificação notarial.

CONTRATO (leitura):
${JSON.stringify(contrato).slice(0, 6000)}

MATRÍCULA (leitura):
${JSON.stringify(mat.extraido).slice(0, 6000)}

Responda SOMENTE com:
{ "itens":[ {"campo":"", "contrato":"", "matricula":"", "status":"confere|divergente|ausente", "observacao":""} ],
  "veredito":"apto|atencao|impeditivo", "resumo":"" }

Confronte ao menos: número da matrícula, cartório de registro, descrição/endereço do imóvel, unidade e
torre/bloco, área, e a TITULARIDADE (quem vende no contrato é quem consta como proprietário na matrícula?).
Verifique também se há ônus na matrícula (hipoteca, alienação fiduciária, penhora, indisponibilidade) que o
contrato não mencione — isso é "divergente", não "ausente".
Use "ausente" quando o dado não existir em um dos documentos, e "divergente" quando existir nos dois e não bater.
"veredito" é "impeditivo" quando houver divergência de titularidade ou indisponibilidade; "atencao" quando
houver ônus ou divergência de descrição; "apto" quando nada disso ocorrer. Não invente dados.`;

      const bruto = await callModel(SYSTEM, [{ role: "user", content: instrucaoConf }], 1800, { json: true });
      let conf: any;
      try { conf = parseJson(bruto); }
      catch { return json({ error: "Não foi possível interpretar o confronto." }, 502); }

      conf.conferido_em = new Date().toISOString();
      conf.matricula_arquivo = mat.nome_arquivo ?? null;
      await admin.from("documentos").update({ confronto: conf }).eq("id", documentoId);
      await admin.rpc("registrar_custodia", {
        p_solicitacao: solicitacaoId, p_minuta: null, p_acao: "documento_extraido",
        p_detalhe: { tipo: "confronto_contrato_matricula", veredito: conf.veredito, modelo: MODELO_ATIVO }, p_ator: uid ?? null,
      });
      await gravarUso(admin, "artemis-extract", null, solicitacaoId);
      return json({ ok: true, confronto: conf });
    }

    // baixa o arquivo do storage (service role) e converte para base64
    const { data: blob, error: eDl } = await admin.storage.from("documentos").download((doc as any).storage_path);
    if (eDl || !blob) return json({ error: "Falha ao ler o arquivo no storage." }, 500);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const mime = (doc as any).mime || blob.type || "image/jpeg";

    const tipo = (doc as any).tipo as string;
    const raw = await callModelVision(SYSTEM, instrucao(tipo), [{ mime, data: bytesToBase64(bytes) }], 1500);

    let extraido: any;
    try { extraido = parseJson(raw); }
    catch { return json({ error: "Não foi possível interpretar a leitura do documento." }, 502); }

    // Datas de vigência: quando a IA lê uma certidão ou procuração, a validade
    // vai para COLUNA própria — é o que alimenta os alertas de vencimento.
    const dataISO = (v: unknown): string | null => {
      const t = String(v ?? "").trim();
      return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null;
    };
    let validade = dataISO(extraido?.validade);
    const emitida = dataISO(extraido?.emitida_em) ?? dataISO(extraido?.lavrada_em);
    // certidão que informa só o prazo em dias: calcula o vencimento
    const prazo = Number(extraido?.prazo_dias ?? 0);
    if (!validade && emitida && prazo > 0) {
      const d = new Date(emitida + "T12:00:00Z");
      d.setUTCDate(d.getUTCDate() + prazo);
      validade = d.toISOString().slice(0, 10);
    }

    const patch: Record<string, unknown> = { extraido, status: "extraido" };
    if (validade) patch.validade = validade;
    if (emitida) patch.emitida_em = emitida;
    if (tipo === "certidao" || tipo === "procuracao") patch.vincular_escritura = true;

    // grava o resultado para validação
    await admin.from("documentos").update(patch).eq("id", documentoId);
    await admin.rpc("registrar_custodia", {
      p_solicitacao: (doc as any).solicitacao_id, p_minuta: null, p_acao: "documento_extraido",
      p_detalhe: { tipo, modelo: MODELO_ATIVO, provedor: PROVEDOR_ATIVO, pseudonimizado: false }, p_ator: uid ?? null,
    });
    await gravarUso(admin, "artemis-extract", null, (doc as any)?.solicitacao_id ?? null);

    return json({ ok: true, tipo, extraido });
  } catch (e) {
    return await respostaErro("artemis-extract", e, 500);
  }
});

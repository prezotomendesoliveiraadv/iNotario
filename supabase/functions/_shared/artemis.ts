// supabase/functions/_shared/artemis.ts
// Núcleo compartilhado: monta o system prompt da Artemis Notarial e fala com os modelos.
// LLM de conversa/compilação: Anthropic (Claude) OU Gemini (Google), via ARTEMIS_PROVIDER.
// Voz: STT/TTS via OpenAI OU Gemini, via ARTEMIS_VOICE_PROVIDER (independente do provedor de texto).

export type Modo = "ELABORACAO" | "QUALIFICACAO";
export type Canal = "TEXTO" | "VOZ";

export interface Contexto {
  nome: string;          // último nome do tabelião/escrevente
  tratamento: string;    // Dr., Dra., Prezado, Prezada
  papel: string;         // tabeliao | escrevente
  serventia: string;     // ex.: 1º Tabelionato de Notas de Campinas/SP
  tipoAto: string;       // ex.: compra e venda | a definir
}

export interface Msg { role: "user" | "assistant"; content: string }

// Provedor de IA para conversa/compilação: "anthropic" (Claude) ou "gemini" (Google).
const PROVIDER = (Deno.env.get("ARTEMIS_PROVIDER") ?? "anthropic").toLowerCase();
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
const MODEL = Deno.env.get("ARTEMIS_MODEL") ?? (PROVIDER === "gemini" ? "gemini-3.5-flash" : "claude-sonnet-4-6");
// Voz (STT/TTS) — independente do provedor de texto. openai (padrão) ou gemini.
const VOICE_PROVIDER = (Deno.env.get("ARTEMIS_VOICE_PROVIDER") ?? "openai").toLowerCase();
const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const TTS_MODEL = Deno.env.get("ARTEMIS_TTS_MODEL") ?? "tts-1";
const TTS_VOICE = Deno.env.get("ARTEMIS_TTS_VOICE") ?? "alloy";
const STT_MODEL = Deno.env.get("ARTEMIS_STT_MODEL") ?? "whisper-1";
// Gemini TTS: modelo dedicado de fala (diferente do modelo de texto) + voz padrão calorosa.
const GEMINI_TTS_MODEL = Deno.env.get("ARTEMIS_GEMINI_TTS_MODEL") ?? "gemini-3.1-flash-tts-preview";
const GEMINI_TTS_FALLBACK = Deno.env.get("ARTEMIS_GEMINI_TTS_FALLBACK") ?? "gemini-2.5-flash-preview-tts";
const GEMINI_VOICE = Deno.env.get("ARTEMIS_GEMINI_VOICE") ?? "Sulafat";
// STT via Gemini reaproveita o modelo de texto (multimodal), a menos que outro seja definido.
const GEMINI_STT_MODEL = Deno.env.get("ARTEMIS_GEMINI_STT_MODEL") ?? MODEL;

export const PROVEDOR_ATIVO = PROVIDER;
export const MODELO_ATIVO = MODEL;

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------
export function buildSystemPrompt(
  modo: Modo, canal: Canal, ctx: Contexto, dadosCaso: string, dataHora: string,
): string {
  const tratNome = `${ctx.tratamento} ${ctx.nome}`;
  const vozBloco = canal === "VOZ"
    ? `\n9. **Canal de voz ATIVO (mãos livres)**: a pessoa está FALANDO com você, sem apertar botões — como numa ligação. Responda em prosa MUITO curta: 1 a 3 frases, no máximo. Uma pergunta por vez. Sem listas, sem markdown, sem títulos. Use confirmações naturais ("certo", "entendi", "perfeito"). Confirme CPF, valores e matrícula repetindo os números. Antes de compilar, ofereça uma recapitulação oral breve. Não narre a minuta por inteiro — diga que o documento está pronto na tela para revisão. Se a transcrição vier confusa, peça gentilmente para repetir só aquele trecho.`
    : `\n9. **Canal de texto**: respostas podem usar listas curtas e marcação leve; placeholders visíveis em colchetes.`;

  const modoBloco = modo === "ELABORACAO"
    ? `# MODO ATIVO: ELABORAÇÃO
1. Se esta for a primeira interação, a saudação já foi exibida — prossiga diretamente para a estruturação do ato.
2. Conduza um debate socrático, direcionado, validando ou preenchendo: natureza e cabimento do ato e competência territorial/serventia; qualificação e capacidade das partes (representação/procurações); consentimento (presencial ou eletrônico via e-Notariado/ICP-Brasil); objeto e sua especialização (para imóvel: matrícula, registro, cartório de RI — art. 176 da LRP); preço/valor, forma de pagamento e quitação; tributos (ITBI/ITCMD) e documentos/certidões (Lei 7.433/85); cláusulas especiais (usufruto, gravames, vênia conjugal — art. 1.647 do CC); conformidade com o CNN/CNJ.
3. Gatilho de satisfação ("estou satisfeito", "pode compilar", "gerar a minuta", "concluído"): encerre o debate e responda exatamente: "Perfeito, ${tratNome}. Compilando a minuta final agora."`
    : `# MODO ATIVO: QUALIFICAÇÃO
1. A partir da minuta ou dos dados em DADOS DO CASO, examine elementos essenciais, qualificação das partes, especialização do objeto, tributos, cláusulas e conformidade. Aponte o que o Oficial de Registro exigiria e como sanar.
2. Cada apontamento tem status ok | atenção | pendente e um fundamento.
3. Gatilho de satisfação: encerre e responda exatamente: "Entendido, ${tratNome}. Gerando o relatório de qualificação agora."`;

  return `# PERSONA E PAPEL
Você é **Artemis**, assistente notarial sênior do iNotário, especialista em direito notarial e registral e na elaboração de minutas de escrituras, procurações, atas e demais atos do tabelionato de notas. Tom profissional, técnico, direto, empático, de alto nível. Comunica-se em português (Brasil) como copiloto do tabelião e do escrevente.
Princípio inegociável — **fé pública indelegável**: você assiste, não substitui o delegatário. A decisão, a qualificação definitiva e a fé pública são do tabelião (Lei 8.935/94; Resoluções CNJ 615/2025 e 674/2026). Você prepara; o humano comanda.

# CONTEXTO DO SISTEMA
- Data e hora: ${dataHora}
- Usuário: ${tratNome} (${ctx.papel}) — ${ctx.serventia}
- Tipo de ato pretendido: ${ctx.tipoAto || "a definir"}
- Canal: ${canal}

# DADOS DO CASO
${dadosCaso || "(ainda não informados — conduza a coleta)"}

# REGRAS GERAIS (INEGOCIÁVEIS)
1. Trate sempre o usuário por "${tratNome}".
2. Concisão e direcionamento; uma pergunta clara por vez; sem floreios.
3. Foco ESTRITO no domínio notarial e registral. Se o usuário puxar assunto alheio (notícias, política, entretenimento, programação, conselhos médicos etc.), responda com cortesia que você atua apenas no escopo notarial deste cartório e retome o ponto pendente do atendimento. Não opine nem converse sobre o tema estranho.
4. Nunca afirme que o ato está "lavrado" ou "válido": você produz minuta sujeita à conferência e à fé pública do delegatário.
5. Proveniência (anti-alucinação): toda cláusula relevante e todo alerta citam o fundamento (lei, CNN/CNJ, súmula ou jurisprudência). Sem segurança sobre a fonte, marque "a confirmar pelo delegatário" — não invente artigo ou precedente.
6. Dados não confirmados viram placeholders em colchetes (ex.: [NOME DO COMPRADOR], [CPF], [MATRÍCULA], [VALOR]). Nunca presuma qualificação, estado civil ou regime de bens.
7. Garanta os elementos essenciais (consentimento; partes qualificadas e capazes; objeto lícito e especializado; forma legal — art. 215 do CC; Lei 7.433/85). Falta de elemento essencial é alerta pendente.
8. Gatilho de encerramento: ao sinal de satisfação, encerre imediatamente e emita a Regra de Saída do modo ativo.${vozBloco}
9.05. **Confirmação de dados ditados (voz)**: a transcrição pode falhar. Ao receber nome, CPF/CNPJ, RG, matrícula, endereço, valor ou data por voz, REPITA o dado para conferência antes de usar ("Anotei [dado] — confirma?"); números e CPFs, dígito a dígito. Se a transcrição trouxer [?], aproveite o que veio claro e pergunte SOMENTE sobre o trecho marcado (nunca leia "[?]" em voz alta, nunca peça para repetir tudo). Se já pediu para repetir uma vez, mude a abordagem: peça em partes, peça para soletrar ou ofereça o campo de texto. Só registre após a confirmação.
9.1. **Nunca simule o diálogo**: produza APENAS a sua próxima fala. Jamais escreva a fala do usuário nem use rótulos como "Usuário:", "Escrevente:", "Artemis:". Nada de rubricas cênicas.
10. **Tokens de pseudonimização**: alguns identificadores podem chegar mascarados como [PESSOA_1], [CPF_1], [CNPJ_1], [MATRICULA_1], [ENDERECO_1] etc. Trate cada token como o dado real correspondente e **preserve-o exatamente** na sua resposta — não o altere, traduza, renumere nem complete, e não tente adivinhar o valor real por trás dele. Use o token onde o dado apareceria no documento.

${modoBloco}`;
}

// Saudações fixas (espelham o app; usadas como 1ª fala da assistente)
export function saudacao(modo: Modo, ctx: Contexto, dataHora: string): string {
  const t = `${ctx.tratamento} ${ctx.nome}`;
  return modo === "ELABORACAO"
    ? `Olá ${t}, sou Artemis, sua assistente notarial. Hoje é ${dataHora}. Espero que seu dia esteja produtivo. Vejo que temos um ato a preparar e estou aqui para auxiliar na elaboração da minuta. Quando estiver pronto, podemos começar a estruturar o documento.`
    : `Olá ${t}, sou eu, Artemis. Estou pronta para revisar este ato e antecipar eventuais exigências registrais antes da lavratura. Podemos começar a qualificação?`;
}

// ---------------------------------------------------------------------------
// LLM multi-provedor (conversa/compilação): Anthropic (Claude) ou Gemini
// Selecionado por ARTEMIS_PROVIDER. A interface é a mesma para o resto do app.
// ---------------------------------------------------------------------------
export interface CallOpts { json?: boolean }
export async function callModel(
  system: string, messages: Msg[], maxTokens = 1800, opts: CallOpts = {},
): Promise<string> {
  return PROVIDER === "gemini"
    ? callGemini(system, messages, maxTokens, opts)
    : callAnthropic(system, messages, maxTokens, opts);
}
// Compatibilidade: as funções existentes importam "callClaude".
export const callClaude = callModel;

// ---------------------------------------------------------------------------
// Sanitiza a resposta do modelo: remove rótulos de locutor e corta qualquer
// continuação em que o modelo INVENTA a fala do interlocutor (fonte comum de
// "mensagens fictícias" no meio da conversa).
// ---------------------------------------------------------------------------
const ROTULO_ASSISTENTE = /^\s*(artemis|assistente|ia|bot)\s*:\s*/i;
const ROTULO_INTERLOCUTOR = /^\s*(cliente|usu[áa]rio|interlocutor|user|human|voc[êe]|pessoa|solicitante|escrevente|tabeli[ãa]o)\s*:/i;

// ---------------------------------------------------------------------------
// Campos que a Artemis preenche na TELA do cliente.
// O modelo anexa um marcador ao fim da fala; nós o extraímos e REMOVEMOS antes
// de exibir ou sintetizar em voz — o interlocutor nunca o vê nem o ouve.
//   Formato: [[campos: nome=João Silva; telefone=11999998888; empreendimento=Aurora]]
// ---------------------------------------------------------------------------
export interface CamposTela {
  nome?: string; telefone?: string; email?: string;
  empreendimento?: string; unidade?: string;
}

const MARCADOR = /\[\[\s*campos?\s*:([^\]]*)\]\]/i;

export function extrairCampos(texto: string): { texto: string; campos: CamposTela } {
  const campos: CamposTela = {};
  const m = (texto ?? "").match(MARCADOR);
  if (!m) return { texto: texto ?? "", campos };

  for (const par of m[1].split(";")) {
    const [k, ...resto] = par.split("=");
    const chave = (k ?? "").trim().toLowerCase();
    const valor = resto.join("=").trim();
    if (!valor || /^(vazio|null|-)$/i.test(valor)) continue;
    if (chave === "nome") campos.nome = valor;
    else if (chave === "telefone" || chave === "whatsapp") campos.telefone = valor.replace(/\D/g, "");
    else if (chave === "email" || chave === "e-mail") campos.email = valor;
    else if (chave === "empreendimento") campos.empreendimento = valor;
    else if (chave === "unidade") campos.unidade = valor;
  }
  return { texto: (texto ?? "").replace(MARCADOR, "").trim(), campos };
}

export function sanitizarResposta(texto: string): string {
  let t = (texto ?? "").trim();
  if (!t) return t;
  t = t.replace(MARCADOR, "").trim();     // nunca exibir/falar o marcador
  t = t.replace(ROTULO_ASSISTENTE, ""); // "Artemis: ..." -> "..."

  // Corta a partir da linha em que o modelo simula a fala do interlocutor
  const linhas = t.split(/\r?\n/);
  const corte = linhas.findIndex((l) => ROTULO_INTERLOCUTOR.test(l));
  if (corte >= 0) t = linhas.slice(0, corte).join("\n");

  // Remove rubricas cênicas ("(pausa)", "[o cliente responde]")
  t = t.replace(/^\s*[\(\[][^)\]]{0,60}[\)\]]\s*$/gim, "");

  return t.trim();
}

// Extrai um objeto JSON de um texto (tolera thinking/cercas/prefixos).
export function extrairJson(txt: string): any {
  let t = (txt ?? "").trim().replace(/^```(json)?/i, "").replace(/```$/i, "").trim();
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a >= 0 && b > a) t = t.slice(a, b + 1);
  return JSON.parse(t);
}

// Chama o modelo pedindo JSON e garante o parse; se falhar, tenta reparar 1x.
export async function callModelJson(
  system: string, messages: Msg[], maxTokens = 2000,
): Promise<any> {
  const raw = await callModel(system, messages, maxTokens, { json: true });
  try { return extrairJson(raw); }
  catch {
    // reparo: devolve só o JSON válido correspondente
    try {
      const rep = await callModel(
        "Você recebe um texto que deveria ser um JSON. Devolva APENAS o JSON válido correspondente, sem comentários, sem cercas.",
        [{ role: "user", content: raw }], maxTokens, { json: true },
      );
      return extrairJson(rep);
    } catch { return {}; }
  }
}

// Erros transitórios de provedor (429/500/502/503/529) — tenta novamente com backoff.
const RETRIAVEL = new Set([429, 500, 502, 503, 529]);
async function fetchResiliente(url: string, init: RequestInit, tentativas = 3): Promise<Response> {
  let ultima: Response | null = null;
  for (let i = 0; i < tentativas; i++) {
    try {
      const r = await fetch(url, init);
      if (r.ok || !RETRIAVEL.has(r.status)) return r;
      ultima = r;
    } catch (e) {
      if (i === tentativas - 1) throw e; // erro de rede: repete até o fim
    }
    await new Promise((res) => setTimeout(res, 400 * Math.pow(2, i) + Math.random() * 200)); // 0.4s, 0.8s, 1.6s
  }
  return ultima!;
}

async function callAnthropic(system: string, messages: Msg[], maxTokens: number, opts: CallOpts = {}): Promise<string> {
  if (!ANTHROPIC_KEY) throw new Error("ANTHROPIC_API_KEY não configurada.");
  const sys = opts.json ? system + "\n\nResponda APENAS com JSON válido, sem texto fora do JSON e sem cercas de código." : system;
  const r = await fetchResiliente("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system: sys, messages }),
  });
  if (!r.ok) throw new Error(`Anthropic ${r.status}: ${await r.text()}`);
  const data = await r.json();
  return (data.content ?? [])
    .filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n").trim();
}

async function callGemini(system: string, messages: Msg[], maxTokens: number, opts: CallOpts = {}): Promise<string> {
  if (!GEMINI_KEY) throw new Error("GEMINI_API_KEY não configurada.");
  // A API do Gemini exige que a conversa COMECE com um turno do usuário; o app
  // semeia o chat com a saudação da Artemis. Sem normalizar, o modelo fica errático.
  const { contents, saudacoes } = normalizarHistoricoGemini(messages);
  if (contents.length === 0) contents.push({ role: "user", parts: [{ text: "Olá." }] });
  const sys = saudacoes.length
    ? `${system}\n\n[Você já disse ao interlocutor: "${saudacoes.join(" ")}" — não repita a saudação; continue naturalmente.]`
    : system;

  // Gemini 3.x: NÃO enviar temperature/top_p/top_k (a Google recomenda os padrões).
  const generationConfig: Record<string, unknown> = { maxOutputTokens: maxTokens };
  if (opts.json) generationConfig.responseMimeType = "application/json";
  const r = await fetchResiliente(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
    { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": GEMINI_KEY },
      body: JSON.stringify({ system_instruction: { parts: [{ text: sys }] }, contents, generationConfig }) },
  );
  if (!r.ok) throw new Error(`Gemini ${r.status}: ${await r.text()}`);
  const data = await r.json();
  const cand = data?.candidates?.[0];
  const texto = (cand?.content?.parts ?? []).map((p: any) => p.text ?? "").join("").trim();
  if (!texto) throw new Error(`Gemini sem resposta (${data?.promptFeedback?.blockReason || cand?.finishReason || "vazio"}).`);
  return texto;
}

// ---------------------------------------------------------------------------
// LLM multimodal (leitura de documentos: RG, CNH, matrícula) — multi-provedor
// files: [{ mime, data(base64) }]. Imagens (jpeg/png/webp/gif) ou application/pdf.
// ---------------------------------------------------------------------------
export interface ArquivoIA { mime: string; data: string }

export async function callModelVision(
  system: string, userText: string, files: ArquivoIA[], maxTokens = 1500,
): Promise<string> {
  return PROVIDER === "gemini"
    ? geminiVision(system, userText, files, maxTokens)
    : anthropicVision(system, userText, files, maxTokens);
}

async function anthropicVision(system: string, userText: string, files: ArquivoIA[], maxTokens: number): Promise<string> {
  if (!ANTHROPIC_KEY) throw new Error("ANTHROPIC_API_KEY não configurada.");
  const content: any[] = [{ type: "text", text: userText }];
  for (const f of files) {
    content.push(f.mime === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: f.data } }
      : { type: "image", source: { type: "base64", media_type: f.mime, data: f.data } });
  }
  const r = await fetchResiliente("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages: [{ role: "user", content }] }),
  });
  if (!r.ok) throw new Error(`Anthropic(vision) ${r.status}: ${await r.text()}`);
  const data = await r.json();
  return (data.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n").trim();
}

async function geminiVision(system: string, userText: string, files: ArquivoIA[], maxTokens: number): Promise<string> {
  if (!GEMINI_KEY) throw new Error("GEMINI_API_KEY não configurada.");
  const parts: any[] = [{ text: userText }];
  for (const f of files) parts.push({ inline_data: { mime_type: f.mime, data: f.data } });
  const body = {
    system_instruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts }],
    generationConfig: { maxOutputTokens: maxTokens },
  };
  const r = await fetchResiliente(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
    { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": GEMINI_KEY }, body: JSON.stringify(body) },
  );
  if (!r.ok) throw new Error(`Gemini(vision) ${r.status}: ${await r.text()}`);
  const data = await r.json();
  const ps = data?.candidates?.[0]?.content?.parts ?? [];
  return ps.map((p: any) => p.text ?? "").join("").trim();
}

// ---------------------------------------------------------------------------
// SHA-256 (para o hash da minuta — mesma cadeia de custódia)
// ---------------------------------------------------------------------------
export async function sha256(txt: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(txt));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------------------
// Voz — STT (Whisper) e TTS
// ---------------------------------------------------------------------------
function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToB64(bytes: Uint8Array): string {
  let s = ""; for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

// ---------------------------------------------------------------------------
// Voz: transcrição (STT) e fala (TTS) — dispatcher OpenAI ou Gemini.
// ---------------------------------------------------------------------------
export interface Audio { data: string; mime: string }

export async function transcrever(audioB64: string, mime = "audio/webm"): Promise<string> {
  return VOICE_PROVIDER === "gemini" ? transcreverGemini(audioB64, mime) : transcreverOpenAI(audioB64, mime);
}

// Mantido por compatibilidade: retorna só os bytes (assume mp3/OpenAI).
// Prefira sintetizarAudio(), que também informa o mime type correto.
export async function sintetizar(texto: string): Promise<string> {
  return (await sintetizarAudio(texto)).data;
}

export async function sintetizarAudio(texto: string): Promise<Audio> {
  return VOICE_PROVIDER === "gemini" ? sintetizarGemini(texto) : sintetizarOpenAI(texto);
}

// ---- OpenAI (Whisper + TTS) ----
async function transcreverOpenAI(audioB64: string, mime: string): Promise<string> {
  if (!OPENAI_KEY) throw new Error("OPENAI_API_KEY não configurada (necessária para voz).");
  const limpo = limparMime(mime);
  const ext = limpo.includes("mp3") || limpo.includes("mpeg") ? "mp3" : limpo.includes("wav") ? "wav" : limpo.includes("ogg") ? "ogg" : "webm";
  const fd = new FormData();
  fd.append("file", new Blob([b64ToBytes(audioB64)], { type: limpo }), `audio.${ext}`);
  fd.append("model", STT_MODEL);
  fd.append("language", "pt");
  const r = await fetchResiliente("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST", headers: { Authorization: `Bearer ${OPENAI_KEY}` }, body: fd,
  });
  if (!r.ok) throw new Error(`STT(OpenAI) ${r.status}: ${await r.text()}`);
  return (await r.json()).text ?? "";
}

async function sintetizarOpenAI(texto: string): Promise<Audio> {
  if (!OPENAI_KEY) throw new Error("OPENAI_API_KEY não configurada (necessária para voz).");
  const r = await fetchResiliente("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ model: TTS_MODEL, voice: TTS_VOICE, input: texto, response_format: "mp3" }),
  });
  if (!r.ok) throw new Error(`TTS(OpenAI) ${r.status}: ${await r.text()}`);
  return { data: bytesToB64(new Uint8Array(await r.arrayBuffer())), mime: "audio/mpeg" };
}

// ---- Gemini (multimodal p/ STT via generateContent; TTS nativo) ----

// O MediaRecorder do navegador entrega "audio/webm;codecs=opus". A API do Gemini
// NÃO aceita mime type com parâmetros — o áudio é descartado e o modelo responde
// "me envie o áudio". Sempre normalize antes de enviar.
export function limparMime(mime: string): string {
  const base = (mime || "audio/webm").split(";")[0].trim().toLowerCase();
  const ok = ["audio/webm", "audio/ogg", "audio/wav", "audio/mp3", "audio/mpeg", "audio/mp4", "audio/aac", "audio/flac", "audio/m4a"];
  return ok.includes(base) ? base : "audio/webm";
}

// Detecta "transcrições" que na verdade são o modelo respondendo/recusando —
// nunca devem entrar na conversa como fala do usuário.
const META_TRANSCRICAO = /(forne[çc]a|envie|compartilhe).{0,25}(áudio|audio|link)|não (sou|posso|consigo).{0,30}(transcri|áudio|audio)|sem áudio|nenhum áudio|ferramenta de transcri/i;
export function pareceMetaTranscricao(t: string): boolean {
  const s = (t ?? "").trim();
  if (!s) return true;
  return META_TRANSCRICAO.test(s);
}

async function transcreverGemini(audioB64: string, mime: string): Promise<string> {
  if (!GEMINI_KEY) throw new Error("GEMINI_API_KEY não configurada (necessária para voz).");
  // Transcrição FIEL: só o áudio, sem histórico e sem contexto da conversa.
  // Qualquer contexto faz o modelo "completar" o que ele espera ouvir.
  const body = {
    contents: [{
      role: "user",
      parts: [
        { inline_data: { mime_type: limparMime(mime), data: audioB64 } },
        { text: `Transcreva EXATAMENTE a fala deste áudio em português do Brasil.

CONTEXTO (ajuda a reconhecer, NÃO é conteúdo): atendimento de cartório de notas. É comum ouvir nomes próprios completos, CPF/CNPJ, número de matrícula de imóvel, valores em reais, estado civil e tipos de ato (escritura de compra e venda, procuração, doação, inventário). Isso ajuda a grafar corretamente — jamais a inventar.

REGRAS ABSOLUTAS:
- Escreva SOMENTE o que foi realmente falado. Não complete, não corrija, não interprete, não adivinhe.
- É PROIBIDO inventar palavras que você não ouviu com clareza.
- Se uma parte estiver inaudível ou ambígua, escreva [?] no lugar dela.
- Se não houver fala humana audível (silêncio, ruído, respiração), responda exatamente: (vazio)
- Não adicione comentários, saudações, aspas ou explicações. Só a transcrição.` },
      ],
    }],
    generationConfig: { temperature: 0 },
  };
  const r = await fetchResiliente(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_STT_MODEL}:generateContent`,
    { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": GEMINI_KEY }, body: JSON.stringify(body) },
  );
  if (!r.ok) throw new Error(`STT(Gemini) ${r.status}: ${await r.text()}`);
  const data = await r.json();
  const parts = data?.candidates?.[0]?.content?.parts ?? [];
  const t = parts.map((p: any) => p.text ?? "").join("").trim();
  if (!t || pareceMetaTranscricao(t)) {
    // Diagnóstico: áudio que não decodifica costuma indicar container inválido
    // (ex.: trecho sem cabeçalho) — sem este rastro o sintoma vira "não ouvi".
    console.error("[iNotario:stt] sem transcrição", JSON.stringify({
      mime: limparMime(mime), bytesB64: audioB64.length,
      resposta: t.slice(0, 120), motivo: data?.candidates?.[0]?.finishReason ?? null,
    }));
    return "";
  }
  if (/^\(?\s*(vazio|inaud[íi]vel|sil[êe]ncio)\s*\)?$/i.test(t)) return "";

  // Descarta APENAS quando não sobrou conteúdo real. Nomes próprios costumam
  // vir com [?] justamente por não serem palavras de dicionário — descartar
  // por causa disso gera laço infinito de "não entendi". Preferimos entregar o
  // que foi ouvido, com a marca de dúvida, e deixar a Artemis confirmar o
  // trecho específico com a pessoa.
  const semMarcas = t.replace(/\[\?\]/g, " ").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  if (!semMarcas) return "";              // só marcas de dúvida, nada aproveitável
  return t;
}


// ---------------------------------------------------------------------------
// VOZ RÁPIDA: uma única chamada multimodal (áudio -> transcrição + resposta),
// eliminando a ida e volta separada de STT. Reduz a latência quase pela metade.
// ---------------------------------------------------------------------------
export async function conversarComAudio(
  system: string, historico: Msg[], audio: { data: string; mime: string }, maxTokens = 700,
): Promise<{ transcricao: string; resposta: string; incerta?: boolean }> {
  // ETAPA 1 — TRANSCRIÇÃO ISOLADA (sem histórico, sem contexto).
  // CRÍTICO: transcrever junto com o histórico faz o modelo "adivinhar" uma
  // resposta plausível para a pergunta anterior em vez de ouvir o áudio.
  // Em cartório, um nome ou CPF inventado é inaceitável — a transcrição é
  // sempre uma chamada separada, cega ao que foi perguntado.
  const transcricao = await transcrever(audio.data, audio.mime);
  if (!transcricao) return { transcricao: "", resposta: "" };

  // ETAPA 2 — resposta, já com a transcrição REAL no histórico.
  const resposta = await callModel(
    system, [...historico, { role: "user", content: transcricao }], maxTokens,
  );
  return { transcricao, resposta: sanitizarResposta(resposta) };
}

// Normaliza o histórico no formato do Gemini (usado no chat e na voz)
function normalizarHistoricoGemini(messages: Msg[]) {
  const mapped = messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }] as any[],
  }));
  let i = 0;
  const saudacoes: string[] = [];
  while (i < mapped.length && mapped[i].role === "model") { saudacoes.push(mapped[i].parts[0].text); i++; }
  const contents: { role: string; parts: any[] }[] = [];
  for (const c of mapped.slice(i)) {
    const ult = contents[contents.length - 1];
    if (ult && ult.role === c.role) ult.parts[0].text += "\n" + c.parts[0].text;
    else contents.push({ role: c.role, parts: [{ text: c.parts[0].text }] });
  }
  return { contents, saudacoes };
}

async function sintetizarGemini(texto: string): Promise<Audio> {
  if (!GEMINI_KEY) throw new Error("GEMINI_API_KEY não configurada (necessária para voz).");
  const gerar = async (modelo: string): Promise<Audio> => {
    const body = {
      contents: [{ role: "user", parts: [{ text: texto }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: GEMINI_VOICE } } },
      },
    };
    const r = await fetchResiliente(
      `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`,
      { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": GEMINI_KEY }, body: JSON.stringify(body) },
    );
    if (!r.ok) throw new Error(`TTS(Gemini/${modelo}) ${r.status}: ${await r.text()}`);
    const data = await r.json();
    const part = data?.candidates?.[0]?.content?.parts?.[0];
    const inline = part?.inlineData ?? part?.inline_data;
    const pcmB64: string | undefined = inline?.data;
    if (!pcmB64) throw new Error(`TTS(Gemini/${modelo}): resposta sem áudio.`);
    return { data: pcmParaWavB64(pcmB64, 24000, 1, 16), mime: "audio/wav" };
  };
  try { return await gerar(GEMINI_TTS_MODEL); }
  catch (e) {
    // Fallback para o modelo estável se o preferido (preview) falhar
    if (GEMINI_TTS_FALLBACK && GEMINI_TTS_FALLBACK !== GEMINI_TTS_MODEL) {
      try { return await gerar(GEMINI_TTS_FALLBACK); } catch { /* usa o erro original */ }
    }
    throw e;
  }
}

// ---------------------------------------------------------------------------
// TTS em STREAMING: emite pedaços de PCM assim que o modelo os gera, para o
// navegador começar a tocar antes de a frase terminar (latência muito menor).
// Cada item do gerador é um trecho de PCM 24kHz/mono/16-bit em base64.
// ---------------------------------------------------------------------------
export async function* sintetizarStream(texto: string): AsyncGenerator<string> {
  if (VOICE_PROVIDER !== "gemini" || !GEMINI_KEY) {
    // Provedor sem streaming: devolve o áudio completo como um único pedaço.
    const a = await sintetizarAudio(texto);
    yield a.data;
    return;
  }
  const body = {
    contents: [{ role: "user", parts: [{ text: texto }] }],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: GEMINI_VOICE } } },
    },
  };
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_TTS_MODEL}:streamGenerateContent?alt=sse`,
    { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": GEMINI_KEY }, body: JSON.stringify(body) },
  );
  if (!r.ok || !r.body) throw new Error(`TTS(stream) ${r.status}: ${await r.text().catch(() => "")}`);

  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const linhas = buf.split("\n");
    buf = linhas.pop() ?? "";           // guarda a linha incompleta
    for (const ln of linhas) {
      const l = ln.trim();
      if (!l.startsWith("data:")) continue;
      const payload = l.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const j = JSON.parse(payload);
        const part = j?.candidates?.[0]?.content?.parts?.[0];
        const pcm = (part?.inlineData ?? part?.inline_data)?.data;
        if (pcm) yield pcm;            // trecho de áudio pronto para tocar
      } catch { /* pedaço parcial: ignora */ }
    }
  }
}

// Envolve PCM 16-bit em um cabeçalho WAV (44 bytes) — sem dependências externas.
function pcmParaWavB64(pcmB64: string, sampleRate: number, channels: number, bitsPerSample: number): string {
  const pcm = b64ToBytes(pcmB64);
  const blockAlign = channels * (bitsPerSample / 8);
  const byteRate = sampleRate * blockAlign;
  const header = new Uint8Array(44);
  const dv = new DataView(header.buffer);
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  w(0, "RIFF"); dv.setUint32(4, 36 + pcm.length, true); w(8, "WAVE");
  w(12, "fmt "); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); // PCM
  dv.setUint16(22, channels, true); dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, byteRate, true); dv.setUint16(32, blockAlign, true); dv.setUint16(34, bitsPerSample, true);
  w(36, "data"); dv.setUint32(40, pcm.length, true);
  const wav = new Uint8Array(header.length + pcm.length);
  wav.set(header, 0); wav.set(pcm, header.length);
  return bytesToB64(wav);
}

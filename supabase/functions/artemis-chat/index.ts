// supabase/functions/artemis-chat/index.ts
// Etapa conversacional da Artemis — modos TEXTO e VOZ.
//
// Body (JSON):
// {
//   "mode": "ELABORACAO" | "QUALIFICACAO",
//   "channel": "TEXTO" | "VOZ",
//   "context": { "nome","tratamento","papel","serventia","tipoAto" },
//   "caseData": "texto livre com os dados já conhecidos do caso",
//   "messages": [ { "role":"user|assistant", "content":"..." } ],
//   "audio": { "data":"<base64>", "mime":"audio/webm" }   // opcional, canal VOZ
// }
//
// Resposta:
// { "reply": "...", "transcript": "...(se voz)...", "audio": "<base64 mp3 se voz>" }

import { corsHeaders, json } from "../_shared/cors.ts";
import { respostaErro } from "../_shared/erros.ts";
import {
  buildSystemPrompt, callClaude, transcrever, sintetizarAudio, sanitizarResposta, conversarComAudio,
  type Modo, type Canal, type Contexto, type Msg,
} from "../_shared/artemis.ts";
import { criarCofre, type Entidade } from "../_shared/tokenizer.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);

  try {
    const body = await req.json();
    const mode: Modo = body.mode === "QUALIFICACAO" ? "QUALIFICACAO" : "ELABORACAO";
    const channel: Canal = body.channel === "VOZ" ? "VOZ" : "TEXTO";
    const ctx: Contexto = {
      nome: body.context?.nome ?? "",
      tratamento: body.context?.tratamento ?? "Dr.",
      papel: body.context?.papel ?? "tabeliao",
      serventia: body.context?.serventia ?? "",
      tipoAto: body.context?.tipoAto ?? "a definir",
    };
    const caseData: string = body.caseData ?? "";
    const messages: Msg[] = Array.isArray(body.messages) ? body.messages.slice() : [];

    // Canal de voz: transcreve o áudio e o anexa como fala do usuário
    let transcript: string | undefined;
    if (channel === "VOZ" && body.audio?.data) {
      transcript = await transcrever(body.audio.data, body.audio.mime ?? "audio/webm");
      if (!transcript) {
        // Sem fala audível (ou o modelo devolveu meta-resposta): pede para repetir
        const pedido = "Não consegui ouvir direito. Pode repetir, por favor?";
        const a = await sintetizarAudio(pedido).catch(() => null);
        return json({ reply: pedido, transcript: "", audio: a?.data, audioMime: a?.mime, inaudivel: true });
      }
      messages.push({ role: "user", content: transcript });
    }

    if (messages.length === 0) {
      return json({ error: "Nenhuma mensagem para processar." }, 400);
    }

    // ----- Pseudonimização: cofre efêmero no servidor -----
    const pii: Entidade[] = Array.isArray(body.pii) ? body.pii : [];
    const cofre = criarCofre(pii, [caseData, ...messages.map((m) => m.content)]);
    const caseDataTok = cofre.tokenizar(caseData);
    const messagesTok: Msg[] = messages.map((m) => ({ role: m.role, content: cofre.tokenizar(m.content) }));

    const dataHora = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
    const system = buildSystemPrompt(mode, channel, ctx, caseDataTok, dataHora);
    const replyTok = await callClaude(system, messagesTok, channel === "VOZ" ? 600 : 1800);
    const reply = sanitizarResposta(cofre.reidratar(replyTok)); // dados reais + sem falas inventadas

    const out: Record<string, unknown> = { reply, transcript, pseudonimizado: cofre.tamanho };
    if (channel === "VOZ") { const a = await sintetizarAudio(reply); out.audio = a.data; out.audioMime = a.mime; }
    return json(out);
  } catch (e) {
    return await respostaErro("artemis-chat", e, 500);
  }
});

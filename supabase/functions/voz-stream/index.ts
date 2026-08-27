// supabase/functions/voz-stream/index.ts
// Conversa por VOZ com baixa latência (SSE):
//   1) uma única chamada multimodal: áudio -> transcrição + resposta
//   2) o texto é enviado na hora (legenda/chat aparecem imediatamente)
//   3) o áudio é transmitido em PEDAÇOS, conforme o modelo gera — a Artemis
//      começa a falar antes de terminar a frase.
// Público (verify_jwt = false): a segurança vem do token do atendimento.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders } from "../_shared/cors.ts";
import { promptAtendimento } from "../_shared/atendimento.ts";
import { conversarComAudio, callModel, sanitizarResposta, extrairCampos, sintetizarStream, type Msg } from "../_shared/artemis.ts";
import { registrarErro } from "../_shared/erros.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Método não permitido", { status: 405, headers: corsHeaders });

  const body = await req.json().catch(() => ({}));
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // valida o token do atendimento
  const { data: acesso } = await admin.from("acesso_cliente")
    .select("id, solicitacao_id").eq("token", body.token ?? "").maybeSingle();
  if (!acesso) {
    return new Response(JSON.stringify({ error: "Sessão inválida." }), {
      status: 401, headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }

  const messages: Msg[] = Array.isArray(body.messages) ? body.messages.slice() : [];
  const camposTela = (body.campos ?? {}) as Record<string, string>;
  const system = promptAtendimento("VOZ", {
    tipoAtoNome: body.tipoAtoNome,
    trilha: body.trilha === "documentos" ? "documentos" : "conversa",
    campos: { nome: camposTela.nome, telefone: camposTela.telefone, email: camposTela.email },
  });

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const enviar = (evento: string, dados: unknown) =>
        controller.enqueue(enc.encode(`event: ${evento}\ndata: ${JSON.stringify(dados)}\n\n`));

      try {
        let transcricao = "";
        let resposta = "";
        let camposExtraidos: Record<string, string> = {};

        if (body.audio?.data) {
          const r = await conversarComAudio(
            system, messages, { data: body.audio.data, mime: body.audio.mime ?? "audio/webm" }, 700,
          );
          transcricao = r.transcricao;
          const exv = extrairCampos(r.resposta);
          resposta = exv.texto;
          camposExtraidos = exv.campos as unknown as Record<string, string>;
          if (!transcricao) {
            resposta = "Desculpa, não consegui ouvir direito. Pode repetir, por favor?";
            enviar("meta", { transcricao: "", resposta, inaudivel: true });
          } else {
            enviar("meta", { transcricao, resposta, campos: camposExtraidos });
          }
        } else if (body.texto) {
          // fala inicial (saudação) ou texto avulso: só sintetiza
          resposta = String(body.texto);
          enviar("meta", { transcricao: "", resposta, saudacao: true });
        } else {
          resposta = sanitizarResposta(await callModel(system, messages, 700));
          enviar("meta", { transcricao: "", resposta });
        }

        if (resposta) {
          for await (const pcm of sintetizarStream(resposta)) {
            enviar("audio", { pcm });   // pedaço de PCM 24kHz/mono/16-bit (base64)
          }
        }
        enviar("fim", {});
      } catch (e) {
        const codigo = await registrarErro("voz-stream", e, { solicitacaoId: (acesso as any).solicitacao_id });
        enviar("erro", { mensagem: "Instabilidade momentânea na voz. Tente novamente.", codigo });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      ...corsHeaders,
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "connection": "keep-alive",
    },
  });
});

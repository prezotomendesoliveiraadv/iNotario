// supabase/functions/_shared/erros.ts
// Módulo central de tratamento de erros: grava na tabela erros_log (diagnóstico
// pelo Supabase) e no log das Edge Functions, devolvendo um código rastreável.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { json } from "./cors.ts";
import { PROVEDOR_ATIVO, MODELO_ATIVO } from "./artemis.ts";

function novoCodigo(): string {
  return `E-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
}

// Extrai o status HTTP embutido em mensagens como "Anthropic 429: ..."
function statusDe(msg: string): number | null {
  const m = /\b(4\d\d|5\d\d)\b/.exec(msg ?? "");
  return m ? Number(m[1]) : null;
}

export async function registrarErro(
  contexto: string, e: unknown, extra: Record<string, unknown> = {},
): Promise<string> {
  const codigo = novoCodigo();
  const mensagem = (e as any)?.message ?? String(e);
  const stack = (e as any)?.stack ?? null;
  const status_http = (extra.status_http as number) ?? statusDe(mensagem);

  // 1) Log nas Edge Functions (Supabase → Edge Functions → Logs): prefixo pesquisável
  console.error(`[iNotario:erro] ${codigo} | ${contexto} | status=${status_http ?? "-"} | ${mensagem}`);

  // 2) Tabela erros_log (best-effort — nunca deixa o log derrubar a resposta)
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    await admin.from("erros_log").insert({
      codigo, contexto, mensagem, status_http,
      solicitacao_id: (extra.solicitacaoId as string) ?? null,
      user_id: (extra.userId as string) ?? null,
      detalhe: {
        provedor: extra.provedor ?? PROVEDOR_ATIVO, modelo: extra.modelo ?? MODELO_ATIVO,
        canal: extra.canal ?? null, acao: extra.acao ?? null, stack,
        ...(extra.detalhe as Record<string, unknown> ?? {}),
      },
    });
  } catch (_) { /* silencioso */ }

  return codigo;
}

// Gera a resposta de erro padronizada (loga e devolve JSON com código rastreável).
export async function respostaErro(
  contexto: string, e: unknown, status = 500, extra: Record<string, unknown> = {},
): Promise<Response> {
  const codigo = await registrarErro(contexto, e, { ...extra, status_http: status });
  const mensagem = (e as any)?.message ?? String(e);
  return json({ error: mensagemAmigavel(mensagem, status), detalhe: mensagem, codigo, contexto }, status);
}

/**
 * Traduz o erro sem mentir sobre a causa.
 *
 * A versão anterior chamava TODO erro 500 de "instabilidade ao falar com a IA".
 * Um banco desatualizado — função ou coluna que a migration ainda não criou —
 * aparecia como falha do provedor, e mandava quem depura procurar no lugar
 * errado. Aconteceu duas vezes em produção.
 */
export function mensagemAmigavel(mensagem: string, status: number): string {
  if (status < 500) return mensagem;
  const m = (mensagem ?? "").toLowerCase();

  // Banco atrás do código: PostgREST não acha função/coluna que a migration cria.
  const bancoDesatualizado =
    m.includes("schema cache") ||
    m.includes("pgrst") ||
    (m.includes("function") && (m.includes("does not exist") || m.includes("could not find"))) ||
    (m.includes("column") && m.includes("does not exist")) ||
    m.includes("relation") && m.includes("does not exist");
  if (bancoDesatualizado) {
    return "O banco de dados está desatualizado em relação a esta versão do sistema: "
      + "há uma migration pendente. Avise o suporte com o código abaixo. "
      + "(Não é falha da IA — nada foi enviado ao provedor.)";
  }

  if (m.includes("permission denied") || m.includes("row-level security") || m.includes("rls")) {
    return "Seu usuário não tem permissão para esta operação. Fale com quem administra o cartório.";
  }
  if (m.includes("429") || m.includes("rate limit") || m.includes("quota") || m.includes("resource_exhausted")) {
    return "O provedor de IA atingiu o limite de uso no momento. Tente de novo em alguns minutos.";
  }
  if (m.includes("401") || m.includes("403") || m.includes("api key") || m.includes("unauthorized")) {
    return "A chave do provedor de IA está ausente ou inválida. Avise o suporte com o código abaixo.";
  }
  if (/\b5\d\d\b/.test(m) || m.includes("timeout") || m.includes("fetch failed") || m.includes("network")) {
    return "Tivemos uma instabilidade momentânea ao falar com a IA. Tente novamente em instantes.";
  }
  // Sem classificação: melhor um erro técnico visível do que um palpite errado.
  return `Não foi possível concluir. Avise o suporte com o código abaixo. Detalhe: ${mensagem}`;
}

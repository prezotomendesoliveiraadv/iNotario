// src/lib/erros.ts
// Tratamento central de erros das Edge Functions.
//
// PROBLEMA: supabase.functions.invoke() devolve apenas
//   "Edge Function returned a non-2xx status code"
// quando o status não é 2xx — a mensagem real (e o nosso código E-XXXX) fica
// no CORPO da resposta, que o cliente não lê sozinho. O corpo vem em
// error.context, um objeto Response.
//
// Este módulo abre esse corpo e devolve a mensagem específica.

const GENERICAS = [
  'edge function returned a non-2xx status code',
  'failed to send a request to the edge function',
  'functionsHttpError',
]

function comCodigo(msg: string, codigo?: string | null): string {
  const m = String(msg).trim()
  return codigo && !m.includes(codigo) ? `${m} (cód. ${codigo})` : m
}

/** Traduz as mensagens genéricas do cliente Supabase em algo acionável. */
function traduzirGenerica(msg: string, status?: number, fn?: string): string {
  const m = (msg ?? '').toLowerCase()
  if (m.includes('failed to send a request') || m.includes('failed to fetch'))
    return fn
      ? `Não foi possível falar com a função "${fn}". Se a conexão está boa, ela provavelmente ainda não foi publicada — rode: npx supabase functions deploy ${fn}`
      : 'Não foi possível falar com o servidor. Verifique a conexão — se persistir, a função pode não estar publicada.'
  if (status === 401 || status === 403)
    return 'Acesso negado. Confira suas credenciais ou o vínculo do seu usuário ao cartório.'
  if (status === 404)
    return fn
      ? `Recurso não encontrado. Confirme os dados informados — ou publique a função: npx supabase functions deploy ${fn}`
      : 'Recurso não encontrado. Confirme os dados informados — ou a função pode não estar publicada.'
  if (status === 429)
    return 'Muitas requisições em sequência. Aguarde alguns instantes e tente novamente.'
  if (status && status >= 500)
    return 'O servidor teve uma instabilidade momentânea. Tente novamente em instantes.'
  if (GENERICAS.some(g => m.includes(g)))
    return 'A função retornou um erro. Tente novamente; se persistir, informe o código exibido ao suporte.'
  return msg || 'Falha inesperada.'
}

/**
 * Extrai a mensagem REAL de um retorno de functions.invoke().
 * Use sempre em vez de `error.message`.
 */
export async function mensagemErroFuncao(error: any, data?: any, nomeFuncao?: string): Promise<string | null> {
  // 1) Resposta 2xx, mas com { error } no corpo (nosso padrão de erro de negócio)
  if (!error && data && typeof data === 'object' && (data as any).error)
    return comCodigo((data as any).error, (data as any).codigo)

  if (!error) return null

  // 2) Erro HTTP: a mensagem específica está no corpo (error.context = Response)
  const ctx = (error as any).context
  const status: number | undefined = ctx?.status ?? (error as any).status

  if (ctx && typeof ctx.text === 'function') {
    try {
      const bruto = await ctx.text()
      if (bruto) {
        try {
          const j = JSON.parse(bruto)
          const msg = j.error ?? j.message ?? j.msg ?? j.error_description
          if (msg) return comCodigo(String(msg), j.codigo ?? j.code)
        } catch {
          // corpo não é JSON: usa o texto puro, se for legível
          const t = bruto.trim()
          if (t && !t.startsWith('<')) return t.slice(0, 300)
        }
      }
    } catch { /* corpo indisponível/já consumido — cai no fallback */ }
  }

  // 3) Algumas versões trazem o corpo já desserializado
  const body = (error as any).body ?? (error as any).data
  if (body && typeof body === 'object' && body.error)
    return comCodigo(String(body.error), body.codigo)

  return traduzirGenerica((error as any).message ?? String(error), status, nomeFuncao)
}

/**
 * Envelope padrão: chama a função e lança um Error com a mensagem específica.
 * Substitui o par `if (error) throw new Error(error.message)` espalhado pelo app.
 */
export async function chamarFuncao<T = any>(
  invocar: () => Promise<{ data: any; error: any }>,
): Promise<T> {
  const { data, error } = await invocar()
  const msg = await mensagemErroFuncao(error, data)
  if (msg) throw new Error(msg)
  return data as T
}

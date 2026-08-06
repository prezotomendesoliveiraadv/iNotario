// supabase/functions/_shared/tokenizer.ts
// Cofre de pseudonimização — roda no servidor, em memória, por requisição.
// Substitui identificadores diretos (nome, CPF/CNPJ, matrícula, endereço) por
// tokens estáveis ([PESSOA_1], [CPF_1]...) ANTES de enviar à IA, e reidrata a
// resposta DEPOIS. O mapa token→valor real nunca sai do servidor nem é persistido.

export interface Entidade { tipo: string; valor: string }

export interface Cofre {
  tokenizar: (texto: string) => string;
  reidratar: (texto: string) => string;
  reidratarProfundo: (valor: unknown) => unknown;
  tamanho: number;
}

const RE_CNPJ = /\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/g;
const RE_CPF = /\d{3}\.?\d{3}\.?\d{3}-?\d{2}/g;

export function criarCofre(entidades: Entidade[], textosLivres: string[]): Cofre {
  const mapa = new Map<string, string>();      // token -> valor real
  const inverso = new Map<string, string>();   // valor normalizado -> token
  const contador: Record<string, number> = {};

  const registrar = (tipo: string, valorBruto: string): string => {
    const valor = (valorBruto ?? "").trim();
    if (!valor) return valorBruto;
    const norm = valor.toLowerCase();
    const existente = inverso.get(norm);
    if (existente) return existente;
    contador[tipo] = (contador[tipo] ?? 0) + 1;
    const token = `[${tipo}_${contador[tipo]}]`;
    mapa.set(token, valor);
    inverso.set(norm, token);
    return token;
  };

  // 1) Identificadores estruturados conhecidos (ordem determinística)
  for (const e of entidades) registrar(e.tipo, e.valor);

  // 2) Varredura de CPF/CNPJ que escaparam no texto livre
  const todo = textosLivres.join("\n");
  for (const m of todo.matchAll(RE_CNPJ)) registrar("CNPJ", m[0]);
  for (const m of todo.matchAll(RE_CPF)) registrar("CPF", m[0]);

  // Substituições ordenadas do valor mais longo para o mais curto
  // (evita substituir um trecho contido dentro de outro identificador).
  const entradas = [...mapa.entries()].sort((a, b) => b[1].length - a[1].length);

  const tokenizar = (texto: string): string => {
    let t = texto ?? "";
    for (const [token, valor] of entradas) if (valor) t = t.split(valor).join(token);
    return t;
  };
  const reidratar = (texto: string): string => {
    let t = texto ?? "";
    for (const [token, valor] of entradas) t = t.split(token).join(valor);
    return t;
  };
  const reidratarProfundo = (valor: unknown): unknown => {
    if (typeof valor === "string") return reidratar(valor);
    if (Array.isArray(valor)) return valor.map(reidratarProfundo);
    if (valor && typeof valor === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(valor)) out[k] = reidratarProfundo(v);
      return out;
    }
    return valor;
  };

  return { tokenizar, reidratar, reidratarProfundo, tamanho: mapa.size };
}

// supabase/functions/_shared/workflow.ts
// Papéis internos e regras de competência do cartório.

export type Papel = "escrevente" | "tabeliao_substituto" | "financeiro" | "tabeliao_oficial" | "tabeliao" | "cliente";
export type Complexidade = "baixa" | "media" | "alta";

// Rank de aprovação (financeiro/cliente não aprovam atos)
export function rankAprovacao(papel: string): number {
  switch (papel) {
    case "escrevente": return 1;
    case "tabeliao_substituto": return 2;
    case "tabeliao_oficial":
    case "tabeliao": return 3; // 'tabeliao' legado = oficial
    default: return 0;         // financeiro, cliente
  }
}

// Rank mínimo exigido para aprovar conforme a complexidade
export function rankExigido(complexidade?: string | null): number {
  switch (complexidade) {
    case "baixa": return 1;   // escrevente
    case "media": return 2;   // tabelião substituto
    case "alta": return 3;    // tabelião oficial
    default: return 99;       // não classificado -> ninguém aprova
  }
}

export function podeAprovar(papel: string, complexidade?: string | null): boolean {
  const r = rankAprovacao(papel);
  return r > 0 && r >= rankExigido(complexidade);
}

export function podeFinanceiro(papel: string): boolean {
  return papel === "financeiro" || papel === "tabeliao_oficial" || papel === "tabeliao";
}

export const LABEL_COMPLEX: Record<string, string> = { baixa: "Baixa", media: "Média", alta: "Alta" };
export const APROVADOR_LABEL: Record<string, string> = {
  baixa: "Escrevente", media: "Tabelião Substituto", alta: "Tabelião Oficial",
};

// ---------------------------------------------------------------------------
// Motor de etapas (fila por usuário + roteamento inteligente)
// Etapas: elaboracao -> [financeiro] -> aprovacao -> finalizacao -> concluida
// ---------------------------------------------------------------------------
export type Etapa = "elaboracao" | "financeiro" | "aprovacao" | "finalizacao" | "concluida";

export const ETAPA_LABEL: Record<string, string> = {
  elaboracao: "Elaboração", financeiro: "Financeiro", aprovacao: "Aprovação",
  finalizacao: "Finalização", concluida: "Concluída",
};
export const PAPEL_LABEL: Record<string, string> = {
  escrevente: "Escrevente", tabeliao_substituto: "Tabelião Substituto", financeiro: "Financeiro",
  tabeliao_oficial: "Tabelião Oficial", tabeliao: "Tabelião Oficial", admin_plataforma: "Admin da plataforma", cliente: "Cliente",
};

export function aprovadorPorComplexidade(complexidade?: string | null): string {
  return complexidade === "alta" ? "tabeliao_oficial"
    : complexidade === "media" ? "tabeliao_substituto" : "escrevente";
}

// Próxima etapa a partir da atual (o financeiro só entra se houver valores pendentes)
export function proximaEtapa(etapa: string, financeiroStatus: string): Etapa {
  switch (etapa) {
    case "elaboracao": return financeiroStatus === "pendente" ? "financeiro" : "aprovacao";
    case "financeiro": return "aprovacao";
    case "aprovacao": return "finalizacao";
    case "finalizacao": return "concluida";
    default: return "concluida";
  }
}

export function responsavelDaEtapa(etapa: string, complexidade?: string | null): string {
  switch (etapa) {
    case "elaboracao": return "escrevente";
    case "financeiro": return "financeiro";
    case "aprovacao": return aprovadorPorComplexidade(complexidade);
    case "finalizacao": return "escrevente";
    default: return "";
  }
}

// Mapeia etapa -> status legado (mantém rótulos e o marco de cobrança coerentes)
export function statusDaEtapa(etapa: string): string {
  switch (etapa) {
    case "elaboracao": return "em_elaboracao";
    case "financeiro":
    case "aprovacao": return "em_revisao";
    case "finalizacao": return "aprovada";
    case "concluida": return "concluida";
    default: return "em_elaboracao";
  }
}

// O usuário (papel) pode agir na etapa atual?
export function podeAgir(papel: string, etapa: string, responsavelPapel: string, complexidade?: string | null): boolean {
  if (papel === "tabeliao_oficial" || papel === "tabeliao") return true; // oficial supervisiona todo o fluxo
  if (etapa === "aprovacao") return podeAprovar(papel, complexidade);
  return papel === responsavelPapel;
}

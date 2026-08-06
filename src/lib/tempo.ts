// src/lib/tempo.ts
// Data e hora do CARTÓRIO.
//
// Num cartório a data tem efeito jurídico (protocolo, data do ato), então ela
// não pode depender da configuração do aparelho de quem está olhando. Uma
// máquina em UTC mostraria o dia seguinte a partir das 21h no horário de
// Brasília. Aqui tudo é ancorado no fuso civil do cartório.
//
// O Brasil tem quatro fusos: se o cartório não estiver em Brasília, defina
// VITE_TZ_CARTORIO (ex.: 'America/Manaus', 'America/Rio_Branco',
// 'America/Noronha').

export const TZ_CARTORIO: string =
  (import.meta as any).env?.VITE_TZ_CARTORIO || 'America/Sao_Paulo'

/** "terça-feira, 22 de julho de 2026" — sempre no fuso do cartório. */
export function dataExtenso(d: Date = new Date()): string {
  return d.toLocaleDateString('pt-BR', {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
    timeZone: TZ_CARTORIO,
  })
}

/** "22/07/2026" */
export function dataCurta(d: Date = new Date()): string {
  return d.toLocaleDateString('pt-BR', { timeZone: TZ_CARTORIO })
}

/** "22/07/2026 14:35" */
export function dataHora(d: Date = new Date()): string {
  return d.toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: TZ_CARTORIO,
  })
}

/** Hora cheia (0-23) no fuso do cartório — para saudação e turnos. */
export function horaLocal(d: Date = new Date()): number {
  const h = new Intl.DateTimeFormat('pt-BR', {
    hour: 'numeric', hour12: false, timeZone: TZ_CARTORIO,
  }).format(d)
  return parseInt(h, 10) % 24
}

/** Data civil do cartório no formato AAAA-MM-DD (para comparar dias). */
export function diaISO(d: Date = new Date()): string {
  const p = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric', month: '2-digit', day: '2-digit', timeZone: TZ_CARTORIO,
  }).format(d)
  return p // en-CA já devolve AAAA-MM-DD
}

export function saudacao(d: Date = new Date()): string {
  const h = horaLocal(d)
  return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'
}

// ---------------------------------------------------------------------------
// Data do SERVIDOR — fonte única de "hoje"
// O relógio do aparelho pode estar errado (ou em outro fuso). Para um cartório,
// a data tem efeito jurídico, então ela vem do banco, que é a mesma referência
// usada nos cálculos de prazo, vigência e vencimento.
// ---------------------------------------------------------------------------
import { supabase } from './supabase'

let _diaServidor: string | null = null
let _lidoEm = 0

export async function dataDoServidor(): Promise<Date> {
  const agora = Date.now()
  // recarrega a cada 10 min (ou na virada, pelo timer da tela)
  if (!_diaServidor || agora - _lidoEm > 600_000) {
    try {
      const { data, error } = await supabase.rpc('data_cartorio')
      if (!error && data) { _diaServidor = String(data); _lidoEm = agora }
    } catch { /* offline: cai no relógio local */ }
  }
  if (!_diaServidor) return new Date()
  // combina o DIA do servidor com a HORA local, para saudação e ordenação
  const local = new Date()
  const [a, m, d] = _diaServidor.split('-').map(Number)
  return new Date(a, m - 1, d, local.getHours(), local.getMinutes(), local.getSeconds())
}

/** Confere se o aparelho está em outro dia que o cartório (aviso ao usuário). */
export function divergenciaDeData(dataServidor: Date): boolean {
  return diaISO(dataServidor) !== diaISO(new Date())
}

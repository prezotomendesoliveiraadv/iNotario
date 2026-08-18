// ============================================================================
// CNPJ — máscara e validação
//
// Duas coisas diferentes: `mascaraCnpj` formata enquanto a pessoa digita,
// `cnpjValido` confere os dígitos verificadores. A máscara sozinha aceita
// 11.111.111/1111-11, que tem forma de CNPJ e não é um.
//
// A mesma checagem existe no banco (função cnpj_valido). Aqui evita o erro de
// digitação; lá evita o dado ruim que entra por importação ou correção direta.
// ============================================================================

/** Só os dígitos, no máximo 14. */
export function apenasDigitos(v: string, max = 14): string {
  return String(v ?? '').replace(/\D/g, '').slice(0, max)
}

/** Formata progressivamente: 12.345.678/0001-95 */
export function mascaraCnpj(v: string): string {
  const d = apenasDigitos(v)
  if (d.length <= 2) return d
  if (d.length <= 5) return `${d.slice(0, 2)}.${d.slice(2)}`
  if (d.length <= 8) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`
  if (d.length <= 12) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`
}

/** Dígitos verificadores pelo módulo 11. Vazio é considerado válido (campo opcional). */
export function cnpjValido(v: string): boolean {
  const d = apenasDigitos(v)
  if (!d) return true
  if (d.length !== 14) return false
  if (/^(\d)\1{13}$/.test(d)) return false

  const dv = (base: string, pesoInicial: number) => {
    let soma = 0
    let peso = pesoInicial
    for (const ch of base) {
      soma += Number(ch) * peso
      peso = peso === 2 ? 9 : peso - 1
    }
    const resto = soma % 11
    return resto < 2 ? 0 : 11 - resto
  }

  return dv(d.slice(0, 12), 5) === Number(d[12]) && dv(d.slice(0, 13), 6) === Number(d[13])
}

/** Mensagem pronta para a tela — null quando não há o que reclamar. */
export function erroCnpj(v: string): string | null {
  const d = apenasDigitos(v)
  if (!d) return null
  if (d.length < 14) return `CNPJ incompleto (${d.length} de 14 dígitos).`
  if (!cnpjValido(v)) return 'CNPJ inválido — confira os dígitos.'
  return null
}

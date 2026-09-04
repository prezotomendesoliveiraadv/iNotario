import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { APP_VERSAO, APP_DATA, MIGRATION_ESPERADA } from '../lib/versao'

// ============================================================================
// Rodapé — cartório e versão vigente
//
// Discreto por padrão: uma linha cinza com o nome do cartório e a versão.
//
// Clicando na versão, abre a conferência das três camadas — front, banco e
// data de publicação. Isso existe porque, durante a implantação, deploys
// "bem-sucedidos" subiram código antigo por duas sessões seguidas e não havia
// como olhar a tela e saber o que estava no ar.
// ============================================================================

/** Peças que provam até onde o banco foi migrado. Tolerante: ausência = false. */
const MARCOS: { migration: number; teste: string }[] = [
  { migration: 19, teste: 'consolidar_ato' },
  { migration: 20, teste: 'aplicar_consolidado' },
  { migration: 21, teste: 'aplicar_clausulas_contrato' },
  { migration: 22, teste: 'prontidao_ato' },
  { migration: 23, teste: 'representantes_do_ato' },
]

export default function RodapeVersao() {
  const { profile } = useAuth()
  const [cartorio, setCartorio] = useState<string | null>(null)
  const [aberto, setAberto] = useState(false)
  const [banco, setBanco] = useState<number | null | 'erro'>(null)

  useEffect(() => {
    const id = (profile as any)?.cartorio_id
    if (!id) return
    supabase.from('cartorios').select('nome').eq('id', id).maybeSingle()
      .then(({ data }) => setCartorio((data as any)?.nome ?? null))
  }, [profile])

  /**
   * Descobre a migration mais alta aplicada testando as funções que cada uma
   * cria. É indireto de propósito: não exige tabela de controle de versão no
   * banco, e portanto funciona em qualquer instalação, inclusive antiga.
   */
  async function conferirBanco() {
    setBanco(null)
    try {
      let maior = 0
      for (const m of MARCOS) {
        const { error } = await supabase.rpc(m.teste, { p_solicitacao: '00000000-0000-0000-0000-000000000000' })
        // Função inexistente devolve PGRST202 / "Could not find the function".
        const ausente = error && /could not find the function|PGRST202/i.test(`${error.message} ${error.code ?? ''}`)
        if (!ausente) maior = m.migration
      }
      setBanco(maior)
    } catch { setBanco('erro') }
  }

  function alternar() {
    const novo = !aberto
    setAberto(novo)
    if (novo && banco === null) conferirBanco()
  }

  const defasado = typeof banco === 'number' && banco < MIGRATION_ESPERADA

  return (
    <footer className="mt-10 pt-3 border-t border-black/8">
      <div className="flex items-center justify-between flex-wrap gap-2 text-[11px] text-ink/40">
        <span className="truncate">{cartorio || '—'}</span>
        <button onClick={alternar} className="hover:text-ink/70 transition-colors"
          title="Conferir versão do sistema">
          iNotário v{APP_VERSAO}
          {defasado && <span className="text-amber-700"> · banco desatualizado</span>}
        </button>
      </div>

      {aberto && (
        <div className="mt-2 rounded-lg bg-paper px-3 py-2 text-[11px] text-ink/60 space-y-0.5">
          <div>Aplicação: <b className="font-mono">v{APP_VERSAO}</b> · publicada em {APP_DATA}</div>
          <div>
            Banco:{' '}
            {banco === null ? 'conferindo…'
              : banco === 'erro' ? <span className="text-red-600">não foi possível conferir</span>
              : banco === 0 ? <span className="text-amber-700">anterior à 19ª migration</span>
              : <b className="font-mono">{banco}ª migration</b>}
            {' '}· esperado pela aplicação: <b className="font-mono">{MIGRATION_ESPERADA}ª</b>
          </div>
          {defasado && (
            <div className="text-amber-800">
              Faltam migrations. Telas que dependem delas mostram erro em vermelho ao serem usadas.
            </div>
          )}
          <div className="text-ink/35 pt-1">
            A conferência do banco é indireta: testa as funções que cada migration cria.
            Ela não verifica qual código está publicado nas Edge Functions.
          </div>
        </div>
      )}
    </footer>
  )
}

import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string

if (!url || !anon) {
  // Mensagem clara em vez de falha silenciosa
  console.error(
    'Variáveis VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY ausentes. ' +
    'Copie .env.example para .env.local e preencha.'
  )
}

export const supabase = createClient(url ?? '', anon ?? '')

/// <reference types="vite/client" />

// Declarado explicitamente para que a verificação de tipos funcione mesmo sem
// node_modules instalado (é o caso do ambiente onde as revisões são feitas).
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  readonly VITE_ARTEMIS_VOICE_PROVIDER?: string
  readonly VITE_ARTEMIS_VOICE?: string
}
interface ImportMeta {
  readonly env: ImportMetaEnv
}

#!/usr/bin/env bash
# ============================================================================
# Verificação antes de publicar
#
# Existe por causa de um erro concreto: uma vírgula dupla num import
# (`type Msg,, gravarUso`) foi publicada porque a saída do compilador estava
# sendo filtrada por uma lista estreita de códigos de erro, e TS1003 não estava
# nela. O defeito só apareceu no cartório, em produção.
#
# A regra que este script impõe: nada de filtrar por código de erro. Filtre
# apenas o ruído estrutural conhecido (módulos não instalados, globais do Deno)
# e leia TUDO o que sobrar.
#
# Uso:  bash verificar.sh
# ============================================================================
set -uo pipefail
cd "$(dirname "$0")"

TSC="${TSC:-npx --no-install tsc}"
falhou=0

# Ruído estrutural: dependências que não são resolvidas fora do runtime real.
# NUNCA acrescente um código TSxxxx a esta lista — filtre a CAUSA, não o sintoma.
RUIDO="Cannot find module|Cannot find name .Deno.|Cannot find namespace .React.|implicitly has type .any.|implicitly has an .any.|JSX.IntrinsicElements|jsx-runtime|--jsx|tsconfig.json is present"

echo "──> Edge Functions (Deno)"
saida=$($TSC --ignoreConfig --noEmit --target es2022 --module esnext \
  --moduleResolution bundler --skipLibCheck --allowImportingTsExtensions \
  supabase/functions/*/index.ts supabase/functions/_shared/*.ts 2>&1 \
  | grep -vE "$RUIDO")
if [ -n "$saida" ]; then echo "$saida"; falhou=1; else echo "  ok"; fi

echo "──> Front (React)"
saida=$($TSC --ignoreConfig --noEmit --jsx react-jsx --target es2020 --module esnext \
  --moduleResolution bundler --skipLibCheck \
  $(ls src/*.tsx src/lib/*.ts src/pages/*.tsx src/pages/atendimento/*.ts* src/components/*.tsx src/context/*.tsx src/vite-env.d.ts 2>/dev/null) 2>&1 | grep -vE "$RUIDO")
if [ -n "$saida" ]; then echo "$saida"; falhou=1; else echo "  ok"; fi

echo "──> SQL: só o que dá para checar sem um Postgres"
for f in supabase/*.sql; do
  grep -q ',,' "$f" && { echo "  $f: vírgula dupla"; falhou=1; }
  # sobrecarga acidental: create or replace de função que já existe com OUTRA
  # lista de parâmetros cria uma segunda função em vez de substituir.
  :
done
echo "  (contagem de parênteses NÃO é checada: strings, comentários e \$\$...\$\$"
echo "   tornam a conta inútil e o falso alarme ensina a ignorar a ferramenta)"

echo
if [ "$falhou" = "0" ]; then
  echo "Tudo limpo. Lembre-se: isto NÃO substitui rodar as migrations num"
  echo "Supabase de teste — erro de plpgsql (variável ambígua, sobrecarga de"
  echo "função) só aparece no CREATE FUNCTION de verdade."
else
  echo "Há erros acima. Não publique."
  exit 1
fi

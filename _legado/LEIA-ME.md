# Arquivos legados — fora da implantação

Nada aqui é usado pelo sistema atual. Foram movidos para cá porque estavam
misturados às pastas de produção e representavam risco de implantação.

**Para reverter, basta mover de volta:**

```bash
mv _legado/functions/plataforma-admin supabase/functions/
mv _legado/sql/*.sql supabase/
```

## functions/plataforma-admin

Versão anterior de `admin-plataforma` (162 linhas contra 140 da atual).
Nenhum ponto do front a invoca — `src/lib/faturamento.ts` chama
`admin-plataforma`. O Guia de Implantação (seção 5) lista 15 funções e não
inclui esta. Manter as duas lado a lado convida a publicar a errada.

## sql/acervo_portal.sql

Substituída por `acervo_portal_fix.sql`, que é a 2ª migration da lista oficial.

## sql/tarifador.sql

Substituída por `faturamento.sql`, que é a 6ª migration da lista oficial.

> **Por que isso importa:** o Guia de Implantação abre a seção 2 com um aviso
> de que a ordem das migrations é crítica e que rodar uma antiga depois de uma
> nova sobrescreve a correção. Deixar duas migrations fora da lista numerada
> dentro de `supabase/` é exatamente o cenário que o aviso tenta evitar.

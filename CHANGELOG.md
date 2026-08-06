# Changelog

## 2026-07-24 — Refatoração do atendimento + higiene de implantação

Nenhuma rota, migration, Edge Function ou regra de negócio mudou de
comportamento. Tudo abaixo é reorganização, remoção de código morto e correção
de documentação.

---

### 1. `PortalAtendimento.tsx` decomposto

**Antes:** 547 linhas em um único componente — máquina de estado de voz, VAD,
upload, formulário manual e as três telas, tudo junto.

**Depois:**

| Arquivo | Linhas | Papel |
| --- | --- | --- |
| `src/pages/PortalAtendimento.tsx` | 18 | Só roteia os três passos |
| `src/pages/atendimento/useAtendimento.ts` | 286 | Toda a máquina de estado |
| `src/pages/atendimento/TelaConversa.tsx` | 209 | Chat/voz + documentos + LGPD |
| `src/pages/atendimento/TelaEscolha.tsx` | 76 | Serviço, trilha e canal |
| `src/pages/atendimento/TelaConcluido.tsx` | 50 | Protocolo + ficha |
| `src/pages/atendimento/Marca.tsx` | 10 | Cabeçalho do atendimento público |

O JSX foi movido **sem alteração**. As telas recebem o objeto do hook
(`at`) e desestruturam o que usam.

#### Correções embutidas na mudança

- **`setStep` deixou de ser público.** Só `iniciar()` e `finalizar()` trocam de
  passo, de dentro do hook. Antes, qualquer trecho do JSX podia pular etapa.
- **Dois imports mortos removidos:** `tocarAudioB64Async` e `atenderFalar`
  apareciam apenas na linha de import — sobras da versão anterior ao streaming
  de voz.
- **`enviarFormularioManual` saiu de dentro do JSX.** Era um
  `onEnviar={async (d) => { ... }}` de vinte linhas que montava a string do
  resumo dentro do atributo. Virou função nomeada no hook.
- **Botão EN da legenda** tinha `try/catch` e `await` inline no `onClick`.
  Virou `traduzirLegenda()` no hook.
- **`VOZ_LABEL`** era recriado a cada render (estava declarado dentro do
  componente). Passou a constante de módulo, junto de `DOC_TIPOS`.

#### Verificação feita

- `tsc` sem erro de sintaxe, JSX ou nome indefinido nos arquivos novos.
- Contagem de chamadas a `conversarPorVoz`, `escutarComVAD`, `atenderChat`,
  `atenderIniciar`, `atenderUpload`, `atenderFinalizar`, `atenderTraduzir` e
  `TocadorPCM` **idêntica** antes e depois.

> ⚠️ O `npm run build` **não** foi executado (o ambiente onde a refatoração foi
> feita está sem rede e sem `node_modules`). Rode-o antes de publicar.

---

### 2. Arquivos órfãos isolados em `_legado/`

Movidos — **não apagados**. Instruções de reversão em `_legado/LEIA-ME.md`.

| Movido | Por quê |
| --- | --- |
| `supabase/functions/plataforma-admin/` | Versão anterior de `admin-plataforma`. Nada no front a invoca; o Guia lista 15 funções e não a inclui. |
| `supabase/acervo_portal.sql` | Substituída por `acervo_portal_fix.sql` (2ª da lista oficial). |
| `supabase/tarifador.sql` | Substituída por `faturamento.sql` (6ª da lista oficial). |

Depois da mudança, `supabase/` contém **exatamente as 14 migrations** da lista
numerada do Guia, e `supabase/functions/` **exatamente as 15 funções** da seção 5
(mais `_shared/` e `DEPLOY.md`).

---

### 3. `README.md` corrigido

Dois trechos estavam desatualizados a ponto de induzir erro:

- Mandava rodar **só** o `schema.sql` — que é 1 das 14 migrations. Agora aponta
  a lista ordenada do Guia e o alerta sobre `data_cartorio.sql` ser a última.
- A árvore de estrutura descrevia o MVP (um `schema.sql` único, sem Edge
  Functions). Foi atualizada.

O restante do README (contexto do produto, notas sobre fé pública indelegável)
continua válido e não foi tocado.

---

## Pendências conhecidas

- **`package-lock.json` não versionado.** É a causa da seção 6.1 do Guia. Não
  dá para gerar sem rede; rode `npm install` e faça o commit do lock.
- **Monolíticos restantes:** `SolicitacaoDetalhe.tsx` (565 linhas),
  `Construtoras.tsx` (489) e `supabase/functions/_shared/artemis.ts` (586).
  O `artemis.ts` já está bem seccionado por comentários — o corte natural é em
  módulos (`prompt`, `provider`, `json`, `vision`, `voz`, `stream`) — mas mexer
  nele obriga a republicar as 15 funções.

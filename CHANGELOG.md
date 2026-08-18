# Changelog

## 2026-08-13 (b) — Contrato social lido por IA; CNPJ validado; faturamento por evento

### Adicionado

**Leitura do contrato social (itens 1 e 3).** Nova ação `contrato_social` no
`artemis-extract` e card na tela da construtora. A IA extrai representantes com
qualificação completa, a **forma de representação** (isolada, conjunta, conjunta
com pessoa determinada), quórum, limite de valor e restrições.

O card mostra **os poderes antes dos nomes**, de propósito: saber que a regra é
"dois diretores em conjunto" muda o que se faz com a lista. Ler a lista primeiro
induz a aceitar assinatura isolada de quem aparece no topo.

Sem contrato social anexado, a leitura cai no **modelo de escritura** do cadastro
— e volta marcada como fonte secundária, com aviso de que reflete o que a
construtora usa, não o que a Junta registrou.

O botão "Cadastrar os que faltam" cria apenas quem ainda não existe (compara por
CPF, senão por nome) e nunca altera registro existente. Cada linha guarda
`origem` (`manual` / `contrato_social` / `modelo_escritura`). **O cadastro
manual continua intacto** para inserção avulsa.

**Máscara e validação de CNPJ (item 2).** Novo `src/lib/cnpj.ts`: máscara
progressiva, dígitos verificadores por módulo 11 e mensagem de erro na tela. O
salvamento é bloqueado com CNPJ inválido. A mesma checagem existe no banco
(`cnpj_valido`), como constraint `NOT VALID` — vale para o que entrar de agora
em diante, sem quebrar a migration por cadastro antigo incompleto. A máscara
sozinha aceita `11.111.111/1111-11`, que tem forma de CNPJ e não é um.

**Tarifação por evento (itens 4 e 5).** Nova tabela `precos` e duas funções:

- `uso_faturavel(cartorio, competencia)` conta os seis itens: atos abertos
  (protocolos criados no mês), leituras de documento por IA, minutas geradas
  por IA (cada versão, exceto edição manual), triagens, consultas jurídicas e
  avaliações de aptidão registral. A fonte é a cadeia de custódia, que já
  registrava tudo isso — sem contador paralelo que possa divergir.
- `demonstrativo_faturamento(...)` devolve a conta linha a linha: quantidade,
  unitário, total por item, base fixa e total geral.

A tela de Uso e faturamento mostra o demonstrativo detalhado e avisa quando
houve **uso com preço zerado** — item que entraria de graça na fatura.

Na Admin da plataforma há o editor da tabela: coluna "padrão" (todos os
cartórios) e coluna "deste cartório", que sobrepõe o padrão só ali.

### Mudado

**A base de cobrança deixou de ser "ato concluído" e passou a ser "protocolo
aberto"**, conforme o item 4-A. Isso antecipa o faturamento de atos que levam
meses até a finalização.

**A fatura fechada passou a usar a mesma função da prévia.** Antes o
`admin-plataforma` recalculava por conta própria — caminho curto para a fatura
discordar do que o cartório viu na tela o mês inteiro. `planos.valor_ato`
continua na tabela por compatibilidade, mas não entra mais no cálculo (há um
aviso na tela do admin).

**Tela de faturamento restrita ao nível administração.** Gate real no banco
(`pode_ver_faturamento`: nível 4 ou admin da plataforma) mais o filtro do menu.
O papel `financeiro` **saiu** do acesso: ele lança emolumentos do ato, que é
outra coisa — esconder no front nunca foi controle.

### Migration

`supabase/faturamento_uso.sql` — **17ª**, roda depois de `modelo_espelho.sql`.
Idempotente.

Depois de limpar CNPJs antigos, vale rodar:
`alter table public.construtoras validate constraint construtoras_cnpj_valido;`

### Republicar

`artemis-extract` e `admin-plataforma`. O restante é front.

### Atenção antes de usar

Os preços entram **zerados**. Preço é decisão comercial, não default de
software — e zero aparece explicitamente na tela como não precificado, em vez
de cobrar um valor que ninguém escolheu.

---

## 2026-08-13 — Espelho do modelo da construtora; resumo do contrato e confronto com matrícula

### Corrigido

**A precedência do modelo não era garantida (item 1).** `modelo_para_solicitacao`
encadeava três SELECTs com `UNION ALL` e fechava com `limit 1`, na intenção de
"empreendimento, senão construtora, senão acervo". `UNION ALL` não garante
ordem, e o `LIMIT` recai sobre o resultado combinado: o banco podia devolver o
modelo genérico do acervo mesmo havendo modelo do empreendimento cadastrado —
em silêncio, e de forma não determinística entre execuções.

Agora a prioridade é coluna explícita, com `ORDER BY prioridade`.

**O contrato caía na leitura genérica (item 3).** O portal público enviava
documentos com tipo `contrato`; o `artemis-extract` só reconhece `compromisso`.
O tipo desconhecido caía na instrução genérica ("extraia os dados relevantes"),
o que produzia um objeto solto de chave/valor — exatamente a "tela de dados
interna" reclamada, já que a UI não tinha branch para esse tipo e caía num
`JSON.stringify`.

Corrigido nas três pontas: o extrator aceita `contrato` como sinônimo, o portal
público passou a enviar `compromisso`, e a migration normaliza o histórico.

### Adicionado

**Espelho do modelo (item 2).** Novo módulo `_shared/espelho.ts`. Havendo modelo
do empreendimento ou da construtora, a minuta passa a ser o **modelo reproduzido
com os campos preenchidos** — não uma redação nova. O modelo de linguagem deixa
de escrever o corpo e passa a cuidar só do parecer.

- Reconhece `[campo]`, `[[campo]]` e `{{campo}}`.
- Resolve o rótulo por dicionário de sinônimos: "[NOME DO COMPRADOR]",
  "[ADQUIRENTE]" e "[PROMISSÁRIO COMPRADOR]" caem no mesmo campo.
- Preenche a partir de partes, dados do ato, matrícula lida, contrato lido,
  empreendimento e cartório.
- O que não encontrar vira `[[**campo**]]` e entra no parecer como pendência.

Vale tanto para a geração rápida (`artemis-compile`) quanto para o assistente
(`minuta-assistente`). A razão de não deixar o LLM reescrever: a construtora
aprovou aquela redação — qualquer paráfrase é um texto que ninguém aprovou.

**Resumo do contrato (item 3).** A leitura do compromisso passou a extrair
cláusulas relevantes estruturadas (`tema`, `resumo`, `trecho` literal), com a
lista de temas notariais esperados: alienação fiduciária, garantia hipotecária,
rescisão, retenção, direito de arrependimento, arras, condição resolutiva,
retrovenda, tolerância de entrega e outros. A tela mostra Partes, Objeto,
Negócio e Cláusulas em vez do JSON cru.

**Confrontar com matrícula (item 3).** Nova ação `confrontar` no
`artemis-extract`, com botão no card do contrato. Compara as duas leituras já
gravadas — não relê os arquivos, para não divergir do que o escrevente validou.
Confere matrícula, cartório, descrição, unidade, área e **titularidade**, e
sinaliza ônus presentes na matrícula que o contrato não menciona. Devolve
veredito `apto` / `atencao` / `impeditivo` e grava em `documentos.confronto`.

### Migration

`supabase/modelo_espelho.sql` — **16ª**, roda depois de `documentos_recebidos.sql`.
Corrige `modelo_para_solicitacao`; adiciona `minutas.origem`,
`minutas.modelo_fonte`, `minutas.pendencias` e `documentos.confronto`; normaliza
`tipo = 'contrato'` para `'compromisso'`. Idempotente.

### Republicar

`artemis-compile`, `minuta-assistente`, `artemis-extract`. O restante é front.

---

## 2026-08-04 — Atendimento: contato primeiro, documentos conferidos, conferência antes do envio; minuta versionada

### Corrigido

**Edição manual da minuta não salvava (item 4).** A causa é RLS: `minutas` tem
policy de `select` e de `insert`, mas **não de `update`**. O `update` era
descartado sem erro, e `salvarMinuta` não checava o retorno — a tela dizia
"Minuta salva." e nada era gravado.

`salvarMinuta(solicitacaoId, conteudo)` agora **insere uma nova versão** em vez
de sobrescrever: calcula o hash, incrementa `versao`, herda tipo e qualificação
da versão anterior, registra `minuta_editada` na cadeia de custódia e propaga
qualquer erro. Um pop-up informa o número da nova versão. Salvar sem alteração
é recusado com aviso.

Versionar (e não liberar `update`) é o comportamento correto: a custódia
encadeia hashes, e sobrescrever conteúdo apagaria a rastreabilidade.

**Artemis confirmava documento que nunca chegou (item 1).** Duas causas:

1. A ação `chat` nunca consultava a tabela `documentos` — o modelo não tinha
   como saber o que existia e acreditava na afirmação da pessoa.
2. A linha em `documentos` era criada **antes** do upload (é ela que origina o
   caminho assinado). Upload interrompido deixava registro fantasma.

Correções: nova coluna `recebido_em` (nulo = reservado, não recebido); nova ação
`upload-ok`, que **confere o objeto no storage** e só então marca o recebimento;
o prompt recebe a lista real de recebidos com uma regra dura de nunca confirmar
o que não está nela; e a tela passa a exibir a lista devolvida pelo servidor.

### Mudado

**Contato virou o passo 1 do roteiro (item 2).** A Artemis abre pedindo nome,
WhatsApp e e-mail (opcional, sem insistir), emite o marcador de campos na mesma
fala e segue — sem pedir confirmação verbal, já que a conferência acontece na
tela antes do envio.

**Conferência antes de gerar o protocolo (item 3).** O botão Finalizar abre uma
janela com serviço, contato, empreendimento, documentos anexados e o que a
pessoa informou na conversa. Confirmar envia; cancelar volta à conversa. O
resumo é montado do estado local — é exatamente o que será enviado, sem nova
chamada ao modelo. A validação de obrigatórios roda antes da janela.

**Busca por solicitante (item 5).** `buscar_solicitacoes` cobria protocolo,
título, tipo de ato e as partes. Passou a cobrir `contato_nome` e
`contato_whatsapp` (por dígitos, mínimo 4). Quem liga costuma ser o solicitante
do atendimento, que pode não ser parte nenhuma — corretor, familiar, preposto.

### Verificado (sem alteração)

**Vínculo automático de imóveis de construtora (item 6): funciona.** Em
`intake-publico`, ao finalizar, `detectarUnidade` roda sobre o objeto extraído e
sobre a conversa inteira, grava `empreendimento_id` e `unidade`, chama
`aplicar_vendedor_construtora` e descarta partes com papel de vendedor
capturadas pela conversa, evitando duplicidade com a qualificação do cadastro.

### Migration

`supabase/documentos_recebidos.sql` — **15ª**, roda depois de `data_cartorio.sql`.
Adiciona `documentos.recebido_em` (+ índice parcial), marca retroativamente como
recebidos os registros antigos com `tamanho > 0`, e substitui
`buscar_solicitacoes`. Idempotente.

### Republicar

`intake-publico` (ações `chat` e `upload-ok`) e `voz-stream` (compartilha o
prompt). O restante é front.

### Pendente

**Item 7 — upload e leitura de modelo de escritura pronto:** não implementado.
Ver a seção de escopo na conversa.

---

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

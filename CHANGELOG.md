# Changelog

## 2026-08-25 (d) — v8.5: secret do cartório validado antes de ir ao banco

### Corrigido

**`invalid input syntax for type uuid: "UUID-DO-CARTORIO"` no atendimento
público.** O secret `INTAKE_CARTORIO_ID` recebeu o texto do exemplo em vez do
UUID real, e o valor seguia direto para a consulta. O Postgres recusava, e o
erro cru aparecia na tela de quem estava tentando abrir uma escritura.

`resolveCartorio` agora valida o formato antes de usar: apara espaços, remove
chaves angulares e aspas coladas por engano, e confere contra o padrão UUID.
Valor inválido registra aviso no log e **cai no fallback** (primeiro cartório da
base) em vez de derrubar o atendimento. A mensagem de "não configurado" diz o
que fazer, incluindo o aviso de não colar as chaves angulares.

Um secret mal preenchido é erro de operação, não de quem está do outro lado da
tela — e não deveria interromper o atendimento.

**`DEPLOY.md` deixou de trazer um placeholder colável.** A linha era
`INTAKE_CARTORIO_ID=<uuid-do-cartorio>`, que copiado e colado produz exatamente
o erro acima. Virou um UUID de exemplo bem formado, com a consulta para obter o
valor real logo acima.

### Republicar

`intake-publico`.

---

## 2026-08-25 (c) — v8.4: erro na compilação de minuta + verificador de build

### Corrigido

**`sol is not defined` ao compilar minuta.** Ao instrumentar a medição de
tokens, escrevi `gravarUso(..., (sol as any)?.cartorio_id, ...)` no fim do
`artemis-compile`. Mas `sol` é declarado **dentro** do bloco do espelho —
no fim da função já saiu de escopo. O cartório guarda agora numa variável do
escopo externo (`cartorioDoAto`).

**Vírgula dupla no import do `artemis-compile`.** `type Msg,, gravarUso` —
erro de sintaxe, publicado. Ver a seção de método abaixo.

**Sete avisos de tipo antigos, zerados** (`e.message` em `catch` sem tipo,
`Uint8Array` como `BlobPart`, `CamposTela` sem index signature, `key` em
`LinhaFila`) e novo `src/vite-env.d.ts` declarando `ImportMetaEnv`, para que a
verificação de tipos funcione mesmo sem `node_modules` instalado.

### Adicionado

**`verificar.sh` — rode antes de publicar.**

```
bash verificar.sh
```

Checa Edge Functions e front. A regra que ele impõe está escrita no cabeçalho
do arquivo: **não filtrar a saída do compilador por código de erro.** Filtrar
apenas o ruído estrutural conhecido (módulo ausente, global do Deno) e ler todo
o resto.

O script diz explicitamente o que NÃO cobre: contagem de parênteses em SQL foi
deliberadamente removida por gerar falso positivo em todos os arquivos (strings,
comentários, `$$...$$`), e falso alarme ensina a ignorar a ferramenta.

### Sobre o método — por que isto escapou

A vírgula dupla passou porque eu vinha rodando o compilador **filtrando a saída
por uma lista estreita de códigos** (`TS2448|TS2304|TS1005|TS2454`). O erro real
era `TS1003`, que não estava na lista. O filtro que existia para esconder ruído
escondeu um erro de sintaxe.

Erro de plpgsql — variável ambígua, sobrecarga de função — continua fora do
alcance de qualquer verificação estática. Só um `CREATE FUNCTION` num Postgres
real pega. A recomendação do Supabase de teste segue de pé.

### Republicar

`artemis-compile` (crítico), `admin-plataforma`, `cliente-portal`, `voz-stream`,
`_shared` afeta todas — na prática, publique as 15.

---

## 2026-08-25 (b) — Correção: sobrecarga de registrar_custodia quebrava a abertura de solicitação

### Corrigido

**`function public.registrar_custodia is not unique` (bug meu).** Na 18ª
migration usei `create or replace function` para acrescentar o parâmetro
`p_ator`. No PostgreSQL, mudar a lista de parâmetros **não substitui a função —
cria uma sobrecarga**. O banco passou a ter duas: a antiga de 4 argumentos e a
nova de 5 (com default no 5º).

Numa chamada de 4 argumentos, as duas se encaixam. O PostgREST não consegue
escolher, recusa com "is not unique", e a abertura de solicitação quebra — o
front chama a custódia com 4 argumentos.

`custodia_autoria.sql` passou a derrubar a versão antiga pela assinatura exata
antes de criar a nova:

```sql
drop function if exists public.registrar_custodia(uuid, uuid, text, jsonb);
```

Em banco já migrado, rode só essa linha e um `notify pgrst, 'reload schema'`.

Conferi as outras funções redefinidas nas migrations 15 a 19
(`buscar_solicitacoes`, `modelo_para_solicitacao`): **as assinaturas são
idênticas às originais**, então `create or replace` de fato substituiu e não há
sobrecarga nesses casos. `registrar_custodia` era a única com parâmetro novo.

### Diagnóstico

`_diagnostico.sql` ganhou uma décima linha, de sanidade:
`registrar_custodia única` — falsa quando a sobrecarga existe.

---

## 2026-08-25 — Mensagem de erro deixa de culpar a IA por erro de banco

### Corrigido

**Todo erro 500 aparecia como "instabilidade momentânea ao falar com a IA".**
Incluindo os que não tinham relação alguma com o provedor — notadamente banco
desatualizado, quando uma Edge Function nova chama função ou coluna que a
migration ainda não criou. Isso mandou o diagnóstico para o lugar errado duas
vezes em produção.

`mensagemAmigavel` passa a classificar antes de traduzir:

| Sinal no erro | Mensagem ao usuário |
| --- | --- |
| `schema cache`, `PGRST`, função/coluna inexistente | Banco desatualizado — migration pendente. Diz explicitamente que **nada foi enviado ao provedor**. |
| `permission denied`, RLS | Falta de permissão do usuário. |
| 429, quota, rate limit | Limite do provedor de IA. |
| 401/403, api key | Chave do provedor ausente ou inválida. |
| 5xx, timeout, fetch failed | Instabilidade do provedor (o caso original). |
| sem classificação | Erro técnico visível, com o detalhe. Melhor que um palpite errado. |

Erros abaixo de 500 continuam mostrando a mensagem original, como já era.

### Republicar

Todas as funções que importam `_shared/erros.ts` — na prática, as 15.
Sem urgência: é melhoria de diagnóstico, não de comportamento.

---

## 2026-08-21 — Correção: a 19ª migration não executava

### Corrigido

**`consolidar_ato` não era criada — a 19ª migration abortava (bug meu).** Na CTE
que consolida o objeto, as colunas foram nomeadas `v_mat` e `v_con`, **os mesmos
nomes das variáveis plpgsql** declaradas na função. Dentro de uma função
plpgsql o Postgres substitui identificadores antes de planejar, e uma
referência ambígua faz a criação da função inteira falhar. Colunas renomeadas
para `da_mat` / `do_con`.

Efeito colateral do mesmo problema: como a 19ª abortava, quem seguisse a ordem
podia interromper a sequência e deixar a **18ª** também sem aplicar. Daí o
segundo erro relatado: `artemis-extract` passou a chamar `registrar_custodia`
com o parâmetro `p_ator`, que só existe a partir da 18ª. Sem ela, a chamada
falha, a exceção sobe e o usuário vê "instabilidade momentânea ao falar com a
IA" — mensagem que mascara um erro de banco, não do provedor.

Outros dois defeitos corrigidos na mesma varredura:

- `jsonb_object_agg` recebia `polo || '_' || ord` com `ord` bigint; agora
  `ord::text`.
- A validade da certidão não era calculada quando o documento informava só
  `prazo_dias`. Agora é, a partir da data de emissão.

**`userClient` usado antes da declaração em `artemis-extract`.** A ação
`certidao_construtora` referenciava o cliente ~40 linhas acima do `const`,
resultado de uma reordenação malfeita minha. Só quebrava naquele caminho, mas
quebrava com certeza. Declarações movidas para o topo do handler.

### Adicionado

`supabase/_diagnostico.sql` — consulta que lista, peça por peça, o que já está
aplicado no banco. Rode antes das migrations: "false" indica migration não
executada **ou** executada com falha no meio, casos indistinguíveis pelo
resultado. Em ambos, rode de novo (são idempotentes).

### Republicar

`artemis-extract`. E rodar novamente as migrations 18 e 19.

---

## 2026-08-26 — Painel consolidado de dados do ato; certidões lidas por IA

### Adicionado

**Painel de dados do ato (itens 2 e 3).** Novo card no topo do ato, alimentado
por `consolidar_ato` — **função do banco, não módulo do front**. A razão é
direta: o painel e o dicionário que preenche a minuta precisam enxergar os
mesmos valores. Com a regra em dois lugares, mais cedo ou mais tarde a tela
mostraria um dado e a escritura sairia com outro, e ninguém notaria até a
assinatura. A geração rápida, o `artemis-compile` e o `minuta-assistente` agora
leem a mesma função.

Precedência implementada:

| Grupo | Fonte que vence | Perde para ela |
| --- | --- | --- |
| Partes (identidade) | RG / CNH | contrato |
| Objeto (imóvel) | matrícula | contrato |
| Negócio (pagamento) | contrato | — |

**Divergência adota e registra, não trava.** Quando o RG diz um nome e o
contrato outro, o painel fica com o RG, mostra o conflito num bloco âmbar acima
dos campos e segue. Travar pararia o ato por diferença de grafia; quem decide é
o escrevente, mas ele precisa ver.

A comparação normaliza acento, caixa e pontuação — "José da Silva" e "JOSE DA
SILVA" não geram divergência falsa.

**Prazo de 30 dias da matrícula.** A extração passou a capturar `emitida_em` (a
data de expedição, com instrução explícita para não confundir com abertura da
matrícula ou último registro). O painel mostra dias restantes e sinaliza
vencida / vence em breve / sem data.

**Vínculo explícito do documento ao ato.** Nova coluna `documentos.vinculado`,
com caixa de seleção na tela. Leitura por IA é insumo; vínculo é decisão
humana — **só documento vinculado entra no painel e na minuta**. Documentos já
validados foram marcados como vinculados na migration.

**Certidões (item 1).** Nova ação `certidao_construtora` no `artemis-extract`,
com botão "ler (IA)" em cada certidão do cadastro. Extrai tipo, número, órgão,
emissão, validade (calculando a partir do prazo em dias quando a certidão só o
informa) e resultado. **Só preenche campo em branco** — dado conferido por
pessoa não é sobrescrito por leitura automática.

O painel reúne as certidões do ato e as do empreendimento numa lista só, cada
uma com validade e situação. O tipo `certidao` entrou no portal público, para o
caso que não é venda de construtora.

**Inventário do que falta.** O painel lista o que impede completar: contrato
ausente, matrícula ausente ou sem data de expedição, falta de RG/CNH, ausência
de certidões, certidão vencida, matrícula vencida — cada item com o motivo em
uma frase, não só o nome do campo.

### Migration

`supabase/painel_consolidado.sql` — **19ª**, depois de `custodia_autoria.sql`.

### Republicar

`artemis-extract`, `artemis-compile`, `minuta-assistente`.

### Ponto de atenção

`unaccent_simples` é uma tradução de caracteres feita à mão, não a extensão
`unaccent` do Postgres. Cobre o português; se aparecer nome com caractere fora
disso, a comparação pode gerar divergência falsa.

---

## 2026-08-20 — Cláusulas especiais no espelho; autoria na custódia; geração rápida com modelo; preços editáveis

### Corrigido

**Cláusulas especiais sumiam das minutas de construtora (item 6).** Regressão
introduzida junto com o espelho, em 13/08. As cláusulas eram passadas ao modelo
de linguagem como instrução ("incorpore cada uma como cláusula própria") — mas
quando há modelo cadastrado, a saída do LLM é descartada e o texto vem do
espelho. A instrução deixou de ter efeito e as cláusulas desapareciam em
silêncio, justamente nas minutas que mais dependem delas.

Agora a inserção é determinística (`inserirClausulas`): procura um marcador no
modelo (`[[CLÁUSULAS ESPECIAIS]]`), senão insere antes do fecho, senão anexa ao
final — e em cada caso registra no parecer onde entrou e se precisa
reposicionamento.

**A custódia não sabia quem agiu nas ações de IA (item 5).** `ator_id` existia e
a função gravava `auth.uid()` — mas toda ação de IA é registrada por Edge
Function sob service role, onde `auth.uid()` é NULL. Leitura de documento,
minuta, triagem, consulta jurídica e pré-qualificação ficavam sem autor.

`registrar_custodia` passou a aceitar `p_ator`; as seis funções resolvem o
usuário autenticado e o repassam. O ator entra no payload do hash — autoria
dentro da cadeia, não ao lado. A tela passou a exibir nome e papel.
Novos gatilhos registram **exclusão** de partes e de documentos, que antes não
deixavam rastro nenhum.

**Geração rápida ignorava o modelo da construtora (item 4a).** Ela roda no
navegador a partir de `tipos_ato.template` e nunca consultava
`modelo_para_solicitacao`. Passou a resolver: empreendimento > construtora >
padrão do acervo do cartório para o tipo de ato > template genérico. O motor de
espelho foi portado para `src/lib/espelho.ts` — **é cópia sincronizada** de
`_shared/espelho.ts`, e há aviso no cabeçalho dos dois.

Nova função `modelo_do_acervo(cartorio, tipo_slug)`: sem empreendimento
vinculado, `modelo_para_solicitacao` não alcançava o acervo. É o caminho do ato
que não é venda de construtora.

**Tabela de preços parecia zerada e sem edição (item 4b).** Três defeitos
somados: o erro de carga era engolido por um `catch {}` vazio (a tela mostrava
zeros porque a consulta falhara, não porque o preço fosse zero); os valores
apareciam como *placeholder* e não como conteúdo; e `.filter("cartorio_id",
"is", null)` serializa mal no postgrest-js — trocado por `.is()`.

Agora: valores editáveis visíveis, botão de salvar explícito por linha, botão
para remover a exceção do cartório, validação de valor e o erro de carga na
tela com a pergunta certa ("a 17ª migration já foi executada?").

### Adicionado

**Medição real de tokens.** `registrarUso` captura o consumo devolvido pelo
provedor em cada chamada (Gemini e Anthropic) e `gravarUso` persiste por
função, cartório e protocolo. Novo painel **Custo de IA (tokens)** na Admin da
plataforma, com RLS restrita a `admin_plataforma` — é custo do fornecedor, não
do cartório. Preço do provedor editável em `precos_ia`.

Isso substitui a estimativa por medição, que é o que sustenta a cláusula de
reajuste por custo de IA.

### Migration

`supabase/custodia_autoria.sql` — **18ª**, depois de `faturamento_uso.sql`.

### Republicar

`artemis-compile`, `artemis-extract`, `artemis-intake`, `consulta-juridica`,
`minuta-assistente`, `registro-prequalificar`, `admin-plataforma`.

### Não entregue nesta rodada

Itens 1, 2 e 3 (extração de certidões, painel consolidado de dados do ato com
precedência entre fontes, e indicação do que falta). Ver a conversa.

---

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

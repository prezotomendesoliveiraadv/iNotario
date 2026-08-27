# Implantação — Artemis (Edge Functions)

Duas funções dão vida à IA da Artemis no iNotário:

- **`artemis-chat`** — conversa nos modos **texto** e **voz** (STT + TTS).
- **`artemis-compile`** — compila a minuta editável + relatório de qualificação, grava em `minutas` (com hash) e dispara a **cadeia de custódia** via trigger.

## Pré-requisitos

- Projeto Supabase já criado e com o `supabase/schema.sql` executado.
- [Supabase CLI](https://supabase.com/docs/guides/cli) instalado e logado: `supabase login`.
- Uma chave da **Anthropic** (conversa/compilação). Para **voz**, uma chave da **OpenAI** (Whisper + TTS).

## 1. Vincular o projeto

```bash
supabase link --project-ref SEU_PROJECT_REF
```

## 2. Definir os segredos (Edge Functions)

```bash
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
# opcional — ajuste ao modelo que sua conta acessa:
supabase secrets set ARTEMIS_MODEL=claude-sonnet-4-6

# necessário apenas para o canal de VOZ:
supabase secrets set OPENAI_API_KEY=sk-...
supabase secrets set ARTEMIS_TTS_VOICE=alloy
```

> `SUPABASE_URL` e `SUPABASE_ANON_KEY` já são injetados automaticamente no runtime das Edge Functions — não precisa defini-los.

## 3. Publicar as funções

```bash
supabase functions deploy artemis-chat
supabase functions deploy artemis-compile
```

As funções exigem JWT por padrão; o front envia o token do usuário logado automaticamente (`supabase.functions.invoke`), e o `artemis-compile` grava respeitando o RLS **como o próprio usuário** — assim a custódia registra corretamente o `ator_id`.

## 4. Front

Nenhuma configuração extra: o app deriva a URL das funções de `VITE_SUPABASE_URL`. Garanta apenas que `.env.local` tem `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`.

## Como usar no app

Abra uma solicitação → **Abrir assistente (IA)**. No painel:
- Alterne **Elaboração / Qualificação** e **Texto / Voz**.
- Converse (ou fale) com a Artemis; ela conduz a coleta socrática.
- **Compilar minuta provisória / definitiva** → a minuta é gravada, a tela mostra a minuta, o **relatório de alertas** e a **cadeia de custódia** atualizados.

## Trocar de provedores de voz

O STT/TTS está isolado em `_shared/artemis.ts` (`transcrever`, `sintetizar`). Para usar outro provedor (ElevenLabs, Google, Azure), basta reimplementar essas duas funções; o resto do fluxo não muda.

## Notas

- **Fé pública indelegável**: a IA produz minuta sujeita à conferência e à fé pública do delegatário. O system prompt reforça isso e exige fundamento em cada cláusula/alerta (anti-alucinação).
- O motor determinístico (`minutaEngine`) segue disponível como **geração rápida / offline**; a IA é o caminho avançado.
- Custos: cada conversa e cada compilação chamam o LLM; a voz adiciona STT e TTS. Monitore o uso pelos provedores.

---

## Pseudonimização (tokenização) antes da IA

As Edge Functions agora **mascaram os identificadores diretos antes de chamar a IA** e **reidratam** a resposta já dentro da sua infraestrutura. O mapa token→valor real é um **cofre efêmero em memória, por requisição** — nunca é enviado à IA nem persistido.

**Como funciona** (`_shared/tokenizer.ts`):
1. O front coleta os identificadores (`coletarPII`: nome, CPF/CNPJ, matrícula, endereço) e os envia no campo `pii`.
2. A função troca cada um por um token estável (`[PESSOA_1]`, `[CPF_1]`, `[MATRICULA_1]`…) no `caseData` e nas mensagens, e ainda varre CPF/CNPJ que escaparem no texto livre.
3. A IA recebe **só tokens**; o system prompt a instrui a preservá-los exatamente.
4. A resposta (conversa, minuta e relatório de alertas) é **reidratada** com os dados reais antes de exibir/gravar. O hash e a custódia usam o conteúdo real.
5. Na compilação, registra-se um evento de custódia **`ia_pseudonimizada`** (sem PII: só nº de tokens, modelo e provedor) — prova auditável da medida técnica.

**O que isto cobre:** identificadores diretos (nome, CPF/CNPJ, matrícula, endereço) deixam de trafegar em claro para a IA.

**O que isto NÃO cobre sozinho** (combine com ZDR + minimização):
- **Quase-identificadores** que a IA precisa ler para qualificar (valor, regime de bens, tipo/descrição do imóvel) continuam seguindo — podem reidentificar quando cruzados.
- **Canal de voz**: o áudio vai ao provedor de STT **antes** de existir texto para tokenizar; o TTS recebe a resposta reidratada. Para sigilo notarial, use **STT/TTS local ou com ZDR**.
- Continua sendo **dado pessoal pseudonimizado** (reversível) sob a LGPD — mantenha DPA e validação do DPO.

---

## Módulos Acervo + Portal do Cliente + Triagem

**1. Banco:** execute `supabase/acervo_portal.sql` (cria buckets `acervo` e `cliente-uploads`, tabelas `acervo`, `acesso_cliente`, `cliente_uploads`, `triagem`, RLS e a função `portal_dados`).

**2. Funções:**
```bash
supabase functions deploy cliente-portal
supabase functions deploy artemis-intake
```
- `cliente-portal` usa **service role** e valida o **token** do link a cada chamada (ações `get`, `upload-url`, `submit`). O cliente nunca recebe credenciais; os uploads sobem por **signed URL**.
- `artemis-intake` faz a **triagem por IA**: cruza dados do ato, documentos do cliente e o **acervo** do cartório (modelos, jurisprudência, orientações), com pseudonimização, e grava o parecer + custódia, sugerindo o próximo status.

> A função `cliente-portal` precisa ser pública (sem verificação de JWT, pois o cliente não tem login). No deploy, use:
> `supabase functions deploy cliente-portal --no-verify-jwt`
> A segurança vem da validação do token + service role. As demais funções mantêm a verificação de JWT.

## Uso no app

- **Acervo** (menu lateral): suba modelos, jurisprudência e orientações, com **temas** (indexador) e tipo de ato. A triagem consulta esse acervo.
- **Detalhe da solicitação → Portal do cliente:** *Gerar link do cliente* produz uma URL `/c/<token>`. O cliente abre, preenche os dados essenciais, anexa documentos e **aceita a LGPD**; a devolutiva fica registrada na custódia (`cliente_devolveu`).
- **Detalhe → Triagem por IA:** *Rodar triagem* gera o checklist de documentos, a pré-qualificação fundamentada, os modelos sugeridos e o próximo passo — dando andamento ao workflow.

---

## Provedor de IA: Claude ou Gemini (multi-provedor)

A conversa/compilação/triagem da Artemis funciona com **Anthropic (Claude)** ou **Google (Gemini)**, escolhido por uma variável. A camada de pseudonimização, custódia e o restante do app não mudam. A **voz** (STT/TTS) continua na OpenAI, independente dessa escolha.

```bash
# Claude (padrão)
npx supabase@latest secrets set ARTEMIS_PROVIDER=anthropic ANTHROPIC_API_KEY=sk-ant-xxxxx
npx supabase@latest secrets set ARTEMIS_MODEL=claude-sonnet-4-6   # opcional

# Gemini
npx supabase@latest secrets set ARTEMIS_PROVIDER=gemini GEMINI_API_KEY=AIza-xxxxx
npx supabase@latest secrets set ARTEMIS_MODEL=gemini-2.5-flash    # opcional
```

Depois redeploy: `npx supabase@latest functions deploy artemis-chat artemis-compile artemis-intake`.

> Chave do Gemini: gere no **Google AI Studio → Create API key**. Desde 19/06/2026 o Google rejeita chaves "standard" irrestritas; chaves novas já saem como *auth keys* — restrinja a chave a **Gemini API only** no AI Studio. Para soberania de dados em região brasileira, considere rodar via **Vertex AI** (exige service account em vez de chave simples; me peça a variação se for por esse caminho).

---

## Preenchimento automático por leitura de documentos (RG/CNH/Matrícula)

**Banco:** execute `supabase/documentos_instrucao.sql` (cria o bucket privado `documentos`, a tabela `documentos` com RLS e o campo `extraido`).

**Função:**
```bash
npx supabase@latest functions deploy artemis-extract
```

**No app** (detalhe da solicitação → card "Documentos de instrução"): envie RG/CNH ou a matrícula (imagem ou PDF) → **Extrair dados (IA)**. A Artemis lê o documento (visão multimodal, Claude ou Gemini) e pré-preenche os campos; o escrevente **valida e aplica** — RG/CNH viram dados da parte; a matrícula preenche a descrição/registro do imóvel. Os arquivos ficam armazenados e vinculados à solicitação; a custódia registra `documento_extraido` e `dados_validados`.

> Privacidade: nesta etapa o documento é enviado **em claro** ao provedor (a finalidade é justamente extrair os identificadores), portanto a pseudonimização não se aplica aqui. Use provedor com **ZDR** e, para soberania, **Gemini via Vertex AI em região brasileira**. A validação é sempre humana antes de gravar.

---

## Alerta de ônus da matrícula no parecer de qualificação

Depois de ler a matrícula (artemis-extract → ônus estruturados), a **triagem** (artemis-intake) cruza esses ônus com o ato e produz alertas no parecer, combinando o julgamento da IA com uma camada **determinística** (regras de cartório), para o alerta ser confiável:

- **Bloqueante (pendente):** indisponibilidade, penhora, arresto, sequestro, averbação premonitória (art. 828 CPC), ação reipersecutória, inalienabilidade. Rebaixa o status sugerido (não deixa ir a "aprovada").
- **Atenção:** hipoteca, alienação fiduciária, usufruto, servidão, bem de família, impenhorabilidade, incomunicabilidade.
- **Continuidade registral:** confere se o vendedor/doador consta como proprietário na matrícula (art. 195 da LRP); divergência vira alerta.

No app, o card **Triagem por IA** mostra um bloco destacado "⚠ Ônus e gravames na matrícula", além de os itens entrarem na pré-qualificação. Nenhuma função nova a publicar — basta o redeploy de `artemis-intake` e `artemis-extract`:
```bash
npx supabase@latest functions deploy artemis-extract artemis-intake
```

---

## Fechando o ciclo: ônus da matrícula → cláusula na minuta

Quando a Artemis **compila** a minuta (artemis-compile), ela carrega a matrícula lida pela IA, deriva as **cláusulas/exigências** correspondentes aos ônus e as injeta na redação, além de fundir os alertas no parecer:

- **Hipoteca** → cláusula condicionando à quitação/anuência do credor hipotecário.
- **Alienação fiduciária** → quitação e baixa da propriedade fiduciária; anuência do credor.
- **Usufruto** → anuência/participação do usufrutuário (ou extinção).
- **Penhora/arresto/sequestro/indisponibilidade/premonitória** → exigir baixa/levantamento; advertir sobre fraude à execução; condicionar o ato.
- **Inalienabilidade** → ato vedado salvo sub-rogação/autorização judicial.
- **Continuidade registral** → sanar a cadeia dominial (art. 195, LRP) quando o transmitente não confere com a titularidade.

A regra é compartilhada (`_shared/matricula.ts`) entre a triagem e a compilação, garantindo o mesmo critério. Redeploy:
```bash
npx supabase@latest functions deploy artemis-intake artemis-compile
```

---

## Atendimento externo por IA (onboarding do cliente) — /atender

Fluxo público onde o cliente inicia a solicitação sozinho, conversando com a Artemis (perfil de atendimento iAdvoga) por **texto ou voz**, aceita a LGPD, anexa documentos e recebe um **protocolo**. A demanda entra no painel classificada como **externa**, com contato/WhatsApp, pronta para análise, preenchimento automático e minuta.

**Banco:** rode `supabase/intake_externo.sql` (adiciona origem/contato/intake e garante o bucket `documentos`). Pré-requisitos: `acervo_portal_fix.sql` e `documentos_instrucao.sql`.

**Cartório de destino:** defina qual serventia recebe as demandas externas:
```bash
# Pegue o UUID com:  select id, nome from public.cartorios;
# Cole o valor SEM as chaves angulares — elas são só marcação deste exemplo.
npx supabase@latest secrets set INTAKE_CARTORIO_ID=00000000-0000-0000-0000-000000000000
```
(sem isso, usa o primeiro cartório cadastrado.)

**Função (pública):**
```bash
npx supabase@latest functions deploy intake-publico   # config.toml já traz verify_jwt=false
```

**Uso:** divulgue o link `https://SEU-APP/atender` (site do cartório, QR code, link de WhatsApp). O convidado escolhe o serviço, conversa com a Artemis, anexa RG/CNH/matrícula/contrato, informa contato e finaliza. No painel, a demanda aparece com o selo **Externa**; no detalhe há o card do solicitante com botão **Falar no WhatsApp** e o resumo do que a IA coletou.

> Privacidade: a conversa de atendimento contém dados do próprio cliente, enviados ao provedor mediante consentimento LGPD — recomenda-se ZDR. A fé pública e a decisão seguem sempre com o tabelião.

---

## Workflow interno do cartório (papéis, complexidade, financeiro, aprovação)

Fluxo com competências: **Escrevente**, **Tabelião Substituto**, **Financeiro** e **Tabelião Oficial**.

**Banco:** rode `supabase/workflow_interno.sql` (amplia o enum de papéis; adiciona complexidade, financeiro, aprovação; cria a tabela `saidas` e o bucket `saidas`).

**Papéis** (defina no perfil de cada usuário):
```sql
update public.profiles set papel='escrevente'         where id=(select id from auth.users where email='...');
update public.profiles set papel='tabeliao_substituto' where id=(select id from auth.users where email='...');
update public.profiles set papel='financeiro'          where id=(select id from auth.users where email='...');
update public.profiles set papel='tabeliao_oficial'    where id=(select id from auth.users where email='...');
```

**Funções:**
```bash
npx supabase@latest functions deploy workflow-acao
npx supabase@latest functions deploy whatsapp-enviar
npx supabase@latest functions deploy artemis-intake   # agora sugere a complexidade
```

**WhatsApp (Meta Cloud API):**
```bash
npx supabase@latest secrets set WHATSAPP_TOKEN=EAAG... WHATSAPP_PHONE_ID=1234567890
# opcional: WHATSAPP_API_VERSION (padrão v20.0)
```

**Regras (no card "Workflow do cartório", no detalhe):**
- **Complexidade:** a IA sugere na triagem; o escrevente pode classificar (baixa/média/alta).
- **Aprovação por competência:** baixa → Escrevente; média → Tab. Substituto; alta → Tab. Oficial (papel superior pode aprovar os inferiores).
- **Financeiro:** ao lançar emolumentos/impostos > 0, o status vira *pendente* e **bloqueia a aprovação** até o Financeiro validar.
- **Documento:** a minuta é **editável** no app; exporte **.doc** (Word) para editar, gere **rascunho PDF** e, após a aprovação, o **PDF final**; cada saída fica no bucket `saidas` com custódia.
- **WhatsApp:** rascunho e final podem ser enviados ao WhatsApp do solicitante externo, direto pela API.
- Tudo é registrado na **cadeia de custódia** (classificado, financeiro, aprovado, documento final, whatsapp_enviado).

> Nota WhatsApp: o envio de documento por link exige que a conversa esteja na janela de 24h ou o uso de template aprovado (regra da Meta). A fé pública e a decisão seguem sempre com o tabelião.

---

## Onboarding 2.0: voz mãos-livres, ficha estruturada e acompanhamento "Sou cliente"

**Voz fluida (sem botão):** em `/atender`, o modo "Voz (mãos livres)" usa detecção automática de fala/silêncio (VAD no navegador): o cliente só fala; ao silenciar ~1,4s, o trecho vai à Artemis, que responde em áudio e volta a escutar. A persona foi humanizada (tom de ligação telefônica, uma pergunta por vez, confirmações naturais).

**Qualificação do solicitante:** a Artemis pergunta se a pessoa é a própria parte ou representante (imobiliária, construtora, advogado, familiar) e registra a empresa/representado — com aviso de que a comprovação da representação poderá ser exigida.

**Ficha estruturada no finalizar:** além do resumo e do protocolo na tela, a IA entrega os campos preenchidos — solicitante (com qualificação), partes (papel, nome, estado civil, regime, CPF, RG, profissão, cidade), objeto/imóvel (empreendimento, endereço, matrícula, cartório de RI, construtora, valor, forma de pagamento). As partes extraídas **já são gravadas** na tabela `partes` (marcadas com origem `intake_ia`) e o restante vai para `dados`/`intake` — pronto para o cartório validar.

**Acompanhamento seguro ("Sou cliente"):** botão na tela de login → `/acompanhar`. O cliente informa **protocolo + o mesmo WhatsApp** da solicitação; a função confere o par e devolve somente o mínimo (primeiro nome, serviço, etapa e datas) com uma linha do tempo. Resposta neutra quando não confere (não revela se o protocolo existe).

**Deploy:** basta republicar a função e o front:
```bash
npx supabase@latest functions deploy intake-publico
npm install && npm run build   # + hard refresh
```
Sem mudanças de banco. Requer OPENAI_API_KEY para a voz (STT/TTS).

---

## Tarifador por ato + faturamento mensal + administração da plataforma

**Modelo de cobrança:** mensalidade **fixa** (contrato) + valor **variável por ato efetivado** (solicitação que chegou a `concluida` no mês — o marco é `concluida_em`, gravado ao Concluir no workflow).

**Banco:** rode `supabase/faturamento.sql` (papel `admin_plataforma`, tabelas `planos` e `faturas`, marco `concluida_em`, RLS: admin gerencia tudo; o cartório lê apenas o próprio plano/faturas).

**Admin da plataforma (fornecedor):** promova seu usuário e publique a função:
```sql
update public.profiles set papel='admin_plataforma'
where id=(select id from auth.users where email='ADMIN@SUAEMPRESA.COM');
```
```bash
npx supabase@latest functions deploy admin-plataforma
npx supabase@latest functions deploy workflow-acao    # grava o marco concluida_em
```

**Painel `/admin`** (aparece no menu só para o admin da plataforma): lista de cartórios assinantes; por cartório — **plano** (mensalidade fixa, valor por ato, tabelião oficial, contato, validade da assinatura, ativo/inativo, observações), **login master** (cria/redefine o usuário master com papel Tabelião Oficial — a senha fica no auth, nunca em texto no banco), **faturamento** (extrato da competência, gerar fatura com fixo+variável+total, marcar como paga).

**Dashboard `/uso`** (equipe do cartório): KPIs do mês (atos efetivados, em andamento, vindos do atendimento IA), produtividade por tipo de ato e por aprovador, **extrato de utilização** (lista dos atos cobrados + memória de cálculo fixo + N×valor/ato), estimativa da fatura antes da emissão, histórico de faturas e alerta de assinatura vencida.

---

## Voz com Gemini (em vez de OpenAI)

A voz (transcrição + fala) agora é um provedor independente e configurável — pode ficar na OpenAI (padrão) ou passar a usar a API do Gemini, a mesma família de modelo já usada no texto/visão.

```bash
npx supabase@latest secrets set ARTEMIS_VOICE_PROVIDER=gemini
# Reaproveita a GEMINI_API_KEY já configurada para texto/visão.
# Opcionais (com padrão sensato se omitidos):
npx supabase@latest secrets set ARTEMIS_GEMINI_TTS_MODEL=gemini-2.5-flash-preview-tts
npx supabase@latest secrets set ARTEMIS_GEMINI_VOICE=Sulafat
```

Redeploy: `npx supabase@latest functions deploy artemis-chat intake-publico`

**Como funciona:** a transcrição (STT) envia o áudio gravado (webm/opus, aceito nativamente) para o modelo de texto configurado, pedindo a transcrição literal — sem endpoint dedicado. A fala (TTS) usa um modelo Gemini específico de geração de áudio (`gemini-2.5-flash-preview-tts`), que devolve PCM cru (24kHz/mono/16-bit); a função empacota em WAV antes de mandar ao navegador. Vozes disponíveis (`ARTEMIS_GEMINI_VOICE`): Kore (firme), Puck (animada), Sulafat (calorosa, padrão), Aoede (leve), Achird (amigável), entre outras 30 opções do catálogo Gemini.

**Voltar para OpenAI:** basta `ARTEMIS_VOICE_PROVIDER=openai` (ou remover a variável) e redeploy — nada mais muda.

> Modelo mais recente: o Gemini 3.1 Flash TTS Preview tem qualidade superior e streaming, mas ocasionalmente retorna erro 500 (falha aleatória documentada pela Google); o padrão aqui é o 2.5 Flash TTS, mais estável. Para usar o 3.1, defina `ARTEMIS_GEMINI_TTS_MODEL=gemini-3.1-flash-tts-preview` e trate esse erro com nova tentativa no front, se notar falhas.

---

## Fluxo inteligente do workflow (fila por usuário + log de alterações)

Redesenho do workflow como um motor de estados com responsável designado por etapa.

**Banco:** rode `supabase/workflow_fluxo.sql` (adiciona etapa/responsavel_papel/exigencia_atual, cria a tabela `workflow_log` e inicializa as solicitações existentes).

**Função:** `npx supabase@latest functions deploy workflow-acao`

**Etapas:** Elaboração (escrevente) → [Financeiro, só se houver emolumentos] → Aprovação (por competência: baixa=escrevente, média=substituto, alta=oficial) → Finalização (escrevente disponibiliza ao cliente) → Concluída.

**Cada usuário tem sua fila:** no Painel, o card *Minhas tarefas* lista as solicitações em que o papel do usuário é o responsável atual (o Tabelião Oficial vê tudo em andamento). Em cada etapa o responsável pode:
- **Avançar** — executa e envia à próxima etapa (ao sair do Financeiro, valida o pagamento; ao sair da Aprovação, registra a aprovação).
- **Devolver com exigência** — retorna ao Escrevente com o texto da alteração exigida (aparece como banner destacado na solicitação).
- **Finalizar** (só o Escrevente, na etapa Finalização) — conclui, marca `concluida_em` (base do faturamento) e disponibiliza ao solicitante.

O **log de alterações** (`workflow_log`) registra cada movimento — quem, qual ação, de/para etapa e a exigência — visível na própria solicitação, além da custódia por hash. A competência continua sendo imposta no servidor; o Oficial supervisiona todo o fluxo.

---

## Tratamento de erros + retry + voz fluida com legenda

### Diagnóstico de erros das Edge Functions
- **Banco:** rode `supabase/erros_log.sql` (tabela `erros_log` com RLS de leitura para admin/equipe).
- Todo erro passa por `_shared/erros.ts`, que: (1) grava em `erros_log` (código, contexto, mensagem, provedor, modelo, status HTTP, stack) e (2) escreve no log das Edge Functions com o prefixo pesquisável `[iNotario:erro]`. O usuário recebe um **código rastreável** (ex.: `cód. E-XXXX`) na mensagem de erro.
- Consulta rápida no SQL Editor:
  ```sql
  select created_at, codigo, contexto, mensagem,
         detalhe->>'provedor' as provedor, detalhe->>'modelo' as modelo, status_http
  from public.erros_log order by created_at desc limit 50;
  ```
- Ou nos logs: Supabase → Edge Functions → (função) → Logs, filtrando por `[iNotario:erro]`.

### Retry automático (reduz os "erros no meio da conversa")
As chamadas de IA (texto, visão e voz) usam `fetchResiliente`: em erros transitórios do provedor (429/500/502/503/529) tenta de novo com backoff (0,4s → 0,8s → 1,6s). Erros definitivos (400/401/403) não são repetidos.

### Voz mais humana e legendada
- O atendimento externo (`/atender`) **entra já com voz ativa**: ao escolher "Por voz" e tocar em Começar, a Artemis **fala a saudação** e ativa o microfone (o clique habilita o áudio no navegador).
- **Legenda na tela**: barra destacada com a fala atual da Artemis. Botões **PT/EN** — em inglês, a legenda é traduzida sob demanda (ação `traduzir`), sem atrasar o áudio em português.
- VAD mais responsivo (silêncio de ~1,1s) para a conversa fluir mais rápido.
- Duas novas ações públicas em `intake-publico`: `falar` (TTS da saudação) e `traduzir` (legenda EN).

**Deploy:** `functions deploy artemis-chat intake-publico artemis-compile artemis-intake artemis-extract workflow-acao whatsapp-enviar` + `npm run build`. Recomendado usar a voz do Gemini (`ARTEMIS_VOICE_PROVIDER=gemini`) para maior naturalidade.

---

## Pré-qualificação registral preventiva

Módulo que avalia o título contra os princípios do Registro de Imóveis e aponta o que geraria exigência — para o título sair "registro-ready", reduzindo devoluções.

**Sem mudança de banco** (reaproveita `triagem`, `documentos`, `partes` e a análise de matrícula). Publique a função:
```bash
npx supabase@latest functions deploy registro-prequalificar
```

**O que verifica (determinístico + leitura complementar da IA):**
- **Especialidade objetiva:** matrícula, cartório de RI, descrição/endereço e área do imóvel.
- **Especialidade subjetiva:** CPF/CNPJ, estado civil e regime de bens das partes; qualificação completa.
- **Consentimento:** outorga conjugal do transmitente casado (art. 1.647, I, CC), salvo separação absoluta.
- **Continuidade:** titularidade do transmitente × proprietário tabular (art. 195 da LRP).
- **Disponibilidade/ônus:** penhora, indisponibilidade, hipoteca, alienação fiduciária etc. (reusa a análise da matrícula; bloqueantes viram impeditivo).
- **Tributos:** ITBI (compra e venda) / ITCMD (doação) e valor do ato.

**Uso:** no detalhe da solicitação, card "Pré-qualificação registral" → "Avaliar aptidão". O resultado (apto / exigências / impeditivo), o checklist por princípio e a nota da Artemis ficam salvos e registrados na custódia (`prequalificacao_registral`).

> Escopo: o iNotário prepara o título e reduz exigências; o registro é ato do registrador, com sua própria qualificação e fé pública. Este módulo é a base ("camada 1") para, no futuro, preparar o título eletrônico e integrar ao SERP/ONR.

---

## Correções da Artemis: Gemini 3.5, JSON garantido e voz mãos-livres em todo o app

### Causa das falhas "no final da conversa"
1. **JSON frágil** — a compilação final (ficha do atendimento, triagem, minuta) parseava a resposta "no olho". Modelos com raciocínio (Gemini 3.x) podem devolver texto antes/depois do JSON, o que quebrava o parse e resultava em "não gera o documento" ou resposta impertinente.
2. **`temperature` fixo** — a Google recomenda **não** alterar temperature/top_p/top_k nos modelos Gemini 3.x (o raciocínio é otimizado para os padrões). O valor fixo degradava a qualidade.
3. **Resposta vazia silenciosa** — bloqueio de segurança ou truncamento retornava string vazia sem erro claro.

### O que mudou
- **Modelo padrão: `gemini-3.5-flash`** (GA, estável para produção). Sobrescreva com `ARTEMIS_MODEL` se quiser.
- **Modo JSON garantido**: as chamadas estruturadas usam `responseMimeType: application/json` (Gemini) e instrução estrita (Claude), com `extrairJson()` tolerante e **reparo automático** (`callModelJson`) se o parse falhar.
- **Sem `temperature`** nos modelos Gemini 3.x (segue a recomendação oficial).
- **Erro explícito** quando o modelo retorna vazio/bloqueado (aparece na `erros_log` com o motivo).
- **TTS com fallback**: modelo padrão `gemini-3.1-flash-tts-preview` (mais natural, com streaming); se falhar, cai automaticamente para `gemini-2.5-flash-preview-tts`. Configurável por `ARTEMIS_GEMINI_TTS_MODEL` / `ARTEMIS_GEMINI_TTS_FALLBACK`.

### Voz mãos-livres também no assistente interno
O painel da Artemis (equipe) agora usa o **mesmo VAD do portal do cliente**: sem botão de gravar — o usuário fala, a Artemis entende o fim da fala, responde em áudio e volta a ouvir. Indicador de estado (ouvindo / entendendo / falando) e retomada automática. Latência reduzida: silêncio de fim de fala em ~0,85s e respostas de voz limitadas a 600 tokens (prosa curta, 1–3 frases).

### Configuração recomendada
```bash
npx supabase@latest secrets set ARTEMIS_PROVIDER=gemini GEMINI_API_KEY=AIza-xxxxx
npx supabase@latest secrets set ARTEMIS_MODEL=gemini-3.5-flash
npx supabase@latest secrets set ARTEMIS_VOICE_PROVIDER=gemini
npx supabase@latest functions deploy artemis-chat artemis-compile artemis-intake artemis-extract intake-publico
npm run build
```

---

## Build do front: alinhamento do Vite (package.json × package-lock.json)

O `package.json` agora declara **`vite: ^6.0.0`** e **`@vitejs/plugin-react: ^4.3.4`** (versão compatível com o Vite 6), além de um campo `engines` (Node 18/20/22+).

O projeto **não versiona `package-lock.json`** — ele é gerado no seu ambiente. Se o deploy falhar com divergência entre o manifesto e o lock (`npm ci` exige que estejam sincronizados), regenere o lock:

```bash
rm -f package-lock.json
npm install          # regenera o lock a partir do package.json
npm run build        # confirme que o build passa localmente
git add package.json package-lock.json && git commit -m "chore: alinha vite 6 e regenera lock"
```

> Use `npm install` (não `npm ci`) para **gerar** o lock; o `npm ci` só deve ser usado depois, quando o lock já estiver consistente com o `package.json`. A configuração do Vite (`vite.config.ts`) é compatível com a versão 6 sem alterações.

---

## Correção das "mensagens fictícias" da Artemis

**Causa raiz encontrada:** a API do Gemini exige que a conversa **comece com um turno do usuário**. O app semeia o chat com a saudação da Artemis (turno `assistant` → `model`), então enviávamos `[model, user, ...]` — histórico inválido, que deixa o modelo errático e o faz *inventar o diálogo*.

**Correções:**
1. **Normalização do histórico** (`callGemini`): descarta os turnos iniciais do modelo (a saudação vai para o system prompt como contexto, para ele não se repetir), mescla turnos consecutivos do mesmo papel e garante que o primeiro turno seja do usuário.
2. **Sanitizador de resposta** (`sanitizarResposta`): remove rótulos ("Artemis:") e **corta qualquer trecho em que o modelo simula a fala do interlocutor** ("Cliente: …", "Usuário: …"), além de rubricas cênicas. Aplicado no `artemis-chat` e no `intake-publico`.
3. **Guarda de escopo nos prompts**: a Artemis só trata de serviços notariais; se o interlocutor puxar assunto alheio (notícias, política, entretenimento etc.), ela recusa com cortesia e retoma a pergunta pendente — sem opinar. Proibido inventar valores, prazos, exigências, matrículas ou artigos de lei; proibido simular o diálogo.

**Modelos** (já são os padrões do código; os secrets abaixo apenas confirmam):
```bash
npx supabase@latest secrets set ARTEMIS_MODEL=gemini-3.5-flash
npx supabase@latest secrets set ARTEMIS_GEMINI_TTS_MODEL=gemini-3.1-flash-tts-preview
npx supabase@latest functions deploy artemis-chat intake-publico artemis-compile artemis-intake
```

---

## CORREÇÃO CRÍTICA — voz: áudio não chegava ao modelo

**Causa raiz:** o `MediaRecorder` do navegador entrega `audio/webm;codecs=opus` (com parâmetro). A API do Gemini **não aceita mime type com parâmetros** — o áudio era **descartado**, sobrava só a instrução "transcreva", e o modelo respondia *"Por favor, forneça o áudio…"*. Esse texto entrava no chat **como se fosse a fala do usuário**, e a Artemis respondia àquilo — origem de todas as mensagens impertinentes.

**Correções:**
1. **`limparMime()`** — normaliza o mime (`audio/webm;codecs=opus` → `audio/webm`) antes de enviar ao Gemini e à OpenAI.
2. **Guarda `pareceMetaTranscricao()`** — se a "transcrição" for na verdade uma recusa/meta-resposta do modelo, ela é **descartada**: a Artemis diz "não consegui ouvir, pode repetir?" e o histórico **não é poluído**.
3. **Voz em UMA chamada (`conversarComAudio`)** — o áudio vai direto ao modelo multimodal, que devolve **transcrição + resposta juntas**. Elimina a ida e volta separada do STT: eram 3 chamadas por turno (STT → LLM → TTS), agora são 2.
4. **Saudação instantânea** — a ação `iniciar` já devolve a saudação **com áudio** (`comVoz: true`), numa única ida ao servidor: a Artemis fala assim que a tela abre.
5. **VAD mais rápido** — fim de fala em ~0,7s (era 1,4s), no portal e no assistente interno.

**Deploy:** `functions deploy artemis-chat intake-publico` + `npm run build`.

---

## Voz em STREAMING (fluidez máxima)

Nova função **`voz-stream`** (pública, protegida pelo token do atendimento): a Artemis **começa a falar assim que o primeiro pedaço de áudio é gerado**, sem esperar a frase inteira.

**Como funciona (SSE):**
1. `meta` — o modelo ouve o áudio numa **única chamada multimodal** e devolve *transcrição + resposta*; o texto aparece **imediatamente** no chat e na legenda.
2. `audio` — o TTS do Gemini transmite o áudio em **pedaços de PCM** (`streamGenerateContent?alt=sse`), enviados conforme são gerados.
3. `fim` / `erro` — encerramento (erros vão para a `erros_log` com código rastreável).

No navegador, `TocadorPCM` (Web Audio API) enfileira os pedaços e os agenda de forma contígua — reprodução sem emendas, começando no primeiro pedaço. O `AudioContext` é destravado no clique de "Começar atendimento" (exigência dos navegadores).

**Ganho de latência (por turno):**
- Antes: 3 chamadas sequenciais (STT → LLM → TTS completo) e só então o áudio tocava.
- Agora: 1 chamada multimodal + TTS em streaming → o texto sai na hora e a voz começa nos primeiros milissegundos de áudio gerado.

**Deploy:**
```bash
npx supabase@latest functions deploy voz-stream
npx supabase@latest functions deploy intake-publico artemis-chat
npm run build
```
> O `config.toml` já traz `[functions.voz-stream] verify_jwt = false`. Se o provedor de voz não for o Gemini, o streaming degrada com elegância: o áudio vem em um único pedaço.

---

## CORREÇÃO — dados inventados na transcrição (nomes, CPF, números)

**Causa raiz (regressão de uma otimização anterior):** para ganhar latência, a voz passou a fazer *uma única chamada* que transcrevia **e** respondia, recebendo o histórico junto. Com o contexto da pergunta anterior à vista, o modelo gerava uma transcrição **plausível** em vez de fiel — se acabara de perguntar "qual seu nome?", inventava um nome.

**Correções (precisão acima de latência — em cartório, dado errado é inaceitável):**
1. **Transcrição isolada**: volta a ser uma chamada separada, **cega ao histórico e ao contexto** — só o áudio. O modelo não tem como "adivinhar" a resposta esperada.
2. **Instrução anti-invenção** (`temperature: 0`): proibido completar, corrigir ou adivinhar; trechos duvidosos são marcados `[?]`; sem fala audível responde `(vazio)`.
3. **Descarte de transcrição duvidosa**: se houver `[?]` demais (frase curta ou >30% incerta), o turno é tratado como não compreendido — a Artemis pede para repetir em vez de registrar errado.
4. **VAD menos agressivo**: silêncio de fim de fala de volta a **1,2s** (estava em 0,7s, que cortava o ditado no meio — e áudio truncado leva o modelo a "completar" o que não ouviu). Fragmentos abaixo de ~6KB são descartados.
5. **Confirmação obrigatória de dado crítico**: por voz, a Artemis **repete de volta** nome, CPF/CNPJ, RG, matrícula, endereço, valor e data antes de registrar ("Anotei César Augusto Mendes — está correto?"); números lidos dígito a dígito. Só registra após confirmação; se a fala vier truncada, pede para repetir aquele dado.

> A fluidez percebida continua garantida pelo **streaming de áudio** (a Artemis fala já no primeiro pedaço). O que voltou a ser sequencial é apenas a transcrição — o preço certo a pagar por fidelidade.

**Deploy:** `functions deploy artemis-chat intake-publico voz-stream` + `npm run build`.

---

## Cockpit do cartório (painel interno por função)

O painel interno deixou de ser uma lista e passou a ser um **cockpit operacional**, com o que cada função precisa ver e fazer hoje.

**Sem mudança de banco** — usa as colunas do fluxo (`etapa`, `responsavel_papel`, `exigencia_atual`, `complexidade`, `financeiro_status`, `updated_at`). Basta `npm run build`.

**Estrutura:**
1. **Cabeçalho do dia** — saudação, data por extenso e a carga pessoal ("7 aguardam você · 2 com exigência").
2. **Faixa de competência** — as quatro etapas do fluxo com a carga de cada uma; as etapas em que o usuário **pode agir** ficam destacadas (barra dourada e "com você"), e o topo informa até que complexidade ele aprova. É o monitoramento do cartório e o lugar de quem olha, na mesma peça.
3. **Fila priorizada** — ordenada por urgência real: exigência devolvida primeiro (+100), depois tempo parado (10/dia), finalização pronta (+25), financeiro pendente (+20) e alta complexidade (+15). Cada linha mostra a idade com faixa de cor (hoje / até 2d / até 5d / +5d) e marca "sua vez" quando a competência é do usuário.
4. **Painel da função** — métricas próprias de cada papel:
   - *Escrevente*: exigências a corrigir, em elaboração, prontos para entregar, sem classificar.
   - *Financeiro*: aguardando validação, valor a conferir, concluídos hoje/mês.
   - *Tabelião Substituto*: aprovações que lhe cabem, quantas são alta (do Oficial), tempo médio.
   - *Tabelião Oficial*: alta complexidade, parados +5 dias, produção e tempo médio do mês.
5. **Requer atenção** — exigências pendentes, atos parados, falta de classificação e pendências do Financeiro.

**Níveis de acesso:** a navegação lateral agora é filtrada por papel (o Financeiro não vê "Nova solicitação"; "Uso e faturamento" fica com Financeiro/Oficial/Admin), e o rodapé mostra a função do usuário por extenso. Na fila, itens fora da competência aparecem como *"aguarda [papel]"* — visíveis para acompanhamento, sem ação. O Tabelião Oficial, detentor da fé pública, vê e age em tudo.

---

## Mensagens de erro específicas (fim do "non-2xx status code")

**Problema:** `supabase.functions.invoke()` só devolve `"Edge Function returned a non-2xx status code"` quando o status não é 2xx. A mensagem real — e o nosso código `E-XXXX` — fica no **corpo** da resposta, em `error.context` (um `Response`), que o cliente não lê sozinho. O usuário via um texto técnico inútil no lugar de, por exemplo, *"Não localizamos uma solicitação com esse protocolo e WhatsApp"*.

**Solução:** novo módulo `src/lib/erros.ts` com `mensagemErroFuncao(error, data)`, aplicado nos **12 pontos de chamada** (workflow, faturamento, atendimento, portal, registro, documentos, artemis, acervo). Ele:
1. Abre o corpo da resposta e extrai `error` + `codigo` (nosso padrão de erro).
2. Trata erro de negócio devolvido com status 200 (`{ error }` no corpo).
3. Quando não há corpo legível, traduz por status: 401/403 → acesso negado; 404 → não encontrado / função não publicada; 429 → excesso de requisições; 5xx → instabilidade momentânea.
4. Distingue falha de rede/função não publicada ("Failed to send a request").

Nada muda no backend: as funções já respondem `{ error, codigo, contexto }` — agora essa mensagem chega ao usuário. Basta `npm run build`.

---

## Melhorias de UX: partes múltiplas, WhatsApp, passo 1, modelo padrão, consulta jurídica e busca

**Banco:** rode `supabase/melhorias_ux.sql` (9ª migration).
**Funções:** `npx supabase@latest functions deploy consulta-juridica whatsapp-enviar`
**Front:** `npm run build`

### 1. Múltiplas partes por ato
Um ato pode ter N partes em cada papel (dois vendedores, três compradores, anuentes). O editor agrupa por papel — "Outorgante Vendedor · 2 pessoas" — com **+ adicionar** dentro do grupo e um campo livre para papéis não previstos no tipo de ato. A qualificação completa (estado civil, regime, profissão, RG, endereço, e-mail) fica recolhida por padrão, para não poluir a tela. Coluna `ordem` preserva a sequência na minuta.

### 2. WhatsApp na abertura interna + acionamento oficial
"Nova solicitação" passou a ter **Contato do solicitante** (nome + WhatsApp). No ato, uma faixa no topo mostra o contato e traz **Falar no WhatsApp**, que envia mensagem pela API oficial (nova ação `texto` em `whatsapp-enviar`), com atalhos ("Documentos", "Exigência", "Pronto"). Fora da janela de 24h, a mensagem de erro explica que só templates aprovados são aceitos.

### 3. Leitura de documentos como Passo 1
O card de documentos foi para o **topo** da solicitação, com numeração explícita: **1 · Leitura dos documentos** (a IA lê e pré-preenche) e **2 · Partes e dados do ato**. É a ordem real de trabalho do escrevente.

### 4. Modelo padrão do acervo por tipo de ato
No Acervo, modelos com tipo de ato têm **☆ tornar padrão**. Um índice único e um gatilho garantem **um padrão por tipo de ato, por cartório** — marcar um desmarca o anterior. `modelosDoTipo()` devolve o padrão primeiro, depois os específicos do tipo e por fim os genéricos.

### 5. Consulta jurídica (acervo × legislação)
Nova função `consulta-juridica` e página **/juridico**, além de um card em cada solicitação. A Artemis seleciona por relevância as jurisprudências e orientações do acervo do cartório e as **confronta com a legislação notarial** (Lei 8.935/94, CC arts. 108/215/1.647, Lei 7.433/85, LRP, Lei 14.382/22, Provimentos CNJ/CNN, NSCGJ, LGPD). Retorna parecer, fundamentos (norma + dispositivo + aplicação), fontes do acervo marcadas como *convergente/divergente/complementar*, **divergências entre a orientação interna e a lei** e ressalvas. Tudo gravado em `consultas_juridicas` e na custódia.

### 6. Busca interna
Uma caixa só, que identifica sozinha o que foi digitado — **protocolo**, **CPF/CNPJ** ou **nome de parte** — mais um filtro de status. Implementada na função SQL `buscar_solicitacoes` (SECURITY DEFINER, restrita à equipe do cartório), com índices em `lower(nome)` e no CPF sem pontuação. Fica no topo do cockpit: ao digitar, os resultados substituem a fila.

---

## CORREÇÃO — laço de "não entendi o nome" na voz

**Causa raiz (regressão do ajuste anterior):** o filtro criado para impedir nomes inventados descartava a transcrição inteira quando havia qualquer marca de dúvida `[?]` em falas de até 3 palavras:

```js
if (incertos > 0 && (palavras <= 3 || incertos / palavras > 0.3)) return ""
```

Um nome — "César Augusto Mendes" — tem exatamente 3 palavras, e nomes próprios são justamente o que o modelo mais marca com `[?]`, por não serem palavras de dicionário. Resultado: toda tentativa de ditar o nome era rejeitada → "não entendi, repita" → laço infinito.

**Correções:**
1. **Descarte só quando não há conteúdo**: a transcrição agora é rejeitada apenas se, retiradas as marcas, não sobrar nenhuma letra ou número. `"César Augusto [?]"` passa; `"[?]"` pede repetição.
2. **A Artemis pergunta só sobre o trecho duvidoso**: com `[?]` na transcrição, ela aproveita o que veio claro e questiona apenas a parte marcada ("Anotei César Augusto — só não peguei o sobrenome, pode repetir só ele?"), sem nunca ler "[?]" em voz alta.
3. **Anti-repetição**: proibido repetir a mesma pergunta com as mesmas palavras; na segunda tentativa ela muda a estratégia (pedir em partes, soletrar, ou digitar).
4. **Limiar de áudio corrigido**: fragmentos eram descartados abaixo de 6 KB, mas um nome curto em Opus gera 5–8 KB — o próprio limiar cortava a fala. Agora 2,5 KB.
5. **Saída elegante na interface**: após duas falhas seguidas, aparece o convite para **Digitar**, que troca o canal para texto. Nome próprio é o caso mais difícil de qualquer transcrição — a alternativa precisa estar à mão.

**Deploy:** `functions deploy artemis-chat intake-publico voz-stream` + `npm run build`.

---

## Correção — foco do cursor saía do campo no modo texto

**Causa:** o campo de mensagem tinha `disabled={loading}`. Ao enviar, ele era desabilitado enquanto a Artemis respondia — e **um elemento desabilitado não pode manter o foco**: o navegador o descarta e não o devolve quando o campo é reabilitado. Resultado: a cada turno era preciso clicar de novo no campo.

**Correções (portal do cliente e assistente interno):**
1. O campo **permanece habilitado** durante a resposta — dá para ir digitando a próxima mensagem, como em qualquer chat. Só o botão *Enviar* fica bloqueado.
2. **Foco devolvido automaticamente** quando a resposta chega (`useEffect` sobre `loading`), mais `autoFocus` na entrada da conversa.
3. **Guarda contra envio duplicado** (`loadingRef`): como o Enter agora funciona a qualquer momento, um segundo envio durante o turno em andamento é ignorado.
4. Rolagem automática passou a usar `block: 'nearest'`, para não arrastar o campo para fora da vista (e, no celular, não fechar o teclado).

**Deploy:** só front — `npm run build`.

---

## CORREÇÃO CRÍTICA — voz parava na segunda fala ("não consegui ouvir" em laço)

**Causa raiz:** o `MediaRecorder` do navegador só emite o **cabeçalho do container** (EBML/webm) no primeiro chunk de cada sessão de gravação. O VAD descartava o buffer com `chunks = []` no `pause()` e no `resume()` **sem reiniciar o gravador** — e o chunk descartado era justamente o do cabeçalho.

Resultado: o primeiro trecho de fala era um arquivo válido; do segundo em diante, o blob saía **sem cabeçalho**, o modelo não conseguia decodificar o áudio e devolvia nada. O sistema interpretava como "não ouvi" e pedia para repetir — indefinidamente. Daí o sintoma exato: *funciona na primeira fala e trava a partir da segunda*.

**Correções:**
1. **Todo descarte reinicia o gravador.** `chunks = []` nunca mais aparece sozinho: `pause()` encerra a gravação e `resume()` abre uma sessão nova — assim **todo trecho enviado é um arquivo completo**, com cabeçalho.
2. **Um blob por fala:** `rec.start()` sem `timeslice`; o arquivo completo chega de uma vez no `stop()`, eliminando a classe inteira de erros de concatenação.
3. **Container conforme o navegador:** escolha por `MediaRecorder.isTypeSupported` entre webm/opus, webm, mp4 e ogg — o Safari/iOS não grava webm e antes caía no mesmo problema.
4. **Pausa real durante a fala da Artemis:** o gravador é encerrado enquanto ela responde, o que também evita captar a própria voz dela.
5. **Contexto de domínio no reconhecimento:** a transcrição recebe uma dica estática (atendimento de cartório; é comum ouvir nomes completos, CPF, matrícula, valores) — melhora a grafia **sem** passar o histórico da conversa, que era o que fazia o modelo adivinhar respostas.
6. **Diagnóstico:** quando a transcrição vem vazia, o log registra `[iNotario:stt]` com mime e tamanho do áudio — o rastro que teria identificado este bug de imediato.

**Deploy:** `functions deploy artemis-chat intake-publico voz-stream` + `npm run build`.

---

## Mensagem de erro agora nomeia a função (e o comando para publicá-la)

O aviso genérico "Não foi possível falar com o servidor" não dizia **qual** função falhou — e a causa quase sempre é uma função nova ainda não publicada. Agora a mensagem nomeia a função e traz o comando:

> Não foi possível falar com a função "consulta-juridica". Se a conexão está boa, ela provavelmente ainda não foi publicada — rode: `npx supabase functions deploy consulta-juridica`

Aplicado nos 14 pontos de chamada. Só front — `npm run build`.

### Checklist: publiquei todas as funções?
```bash
npx supabase@latest functions deploy artemis-chat artemis-compile artemis-intake artemis-extract \
  cliente-portal intake-publico workflow-acao whatsapp-enviar admin-plataforma \
  registro-prequalificar voz-stream consulta-juridica
```

---

## Cockpit: data viva · Nova solicitação: fluxo em duas fases

### 1. Data e saudação congeladas
O cabeçalho calculava data e saudação **uma única vez, na renderização**. Como o cockpit fica aberto o dia inteiro, ele mostrava "Bom dia" às 20h e, após a virada, a data de ontem. Agora há um relógio que recalcula a cada 30 s e também ao voltar para a aba (`visibilitychange`). O **ano** passou a aparecer.

### 2. Abertura interna em duas fases
Antes era um formulário único: só dava para anexar documentos depois de salvar. Agora:

**Fase 1 — Abertura:** tipo de ato, título e contato do solicitante → **abre o protocolo**.

**Fase 2 — Instrução**, com três caminhos que se somam:
- **A · Já tem os documentos?** — o card de documentos aparece aqui, no início: anexe RG/CNH/matrícula e a IA lê e preenche partes e dados (é o ganho de agilidade para quem já chega com tudo em mãos).
- **B · Prefere que o cliente preencha?** — gera o **link do solicitante** ali mesmo, com botão de copiar e envio direto por WhatsApp (usa o contato da fase 1). O que o cliente enviar cai no mesmo protocolo.
- **C · Partes e dados** — confere o que a IA trouxe ou preenche à mão, com o editor de múltiplas partes.

Botões finais: *Salvar e abrir o ato*, *Deixar para depois* e **Descartar protocolo** — este último evita protocolos vazios quando a abertura é abandonada.

**Deploy:** só front — `npm run build`.

---

## Data do cartório, mesclagem de partes e leitura automática

### 1. Data no cabeçalho estava errada (fuso do aparelho)
O cockpit formatava a data com `toLocaleDateString('pt-BR')` **sem fuso**, ou seja, usava a configuração do aparelho de quem olhava. Numa máquina em UTC, a partir das 21h no horário de Brasília o cabeçalho já mostrava o dia seguinte — e a saudação virava "Bom dia" às 22h.

Num cartório a data tem efeito jurídico, então ela não pode depender do relógio do computador. Novo módulo **`src/lib/tempo.ts`** ancora tudo no fuso civil do cartório (`America/Sao_Paulo` por padrão), aplicado ao cabeçalho **e às outras 15 exibições de data** do sistema (workflow, custódia, faturas, pareceres, acompanhamento).

Cartório fora de Brasília: defina no `.env.local`
```
VITE_TZ_CARTORIO=America/Manaus     # ou America/Rio_Branco, America/Noronha
```

### 2. Papéis sumiam da tela ao aplicar um documento
Na abertura da solicitação, ao aplicar os dados lidos de um documento, `recarregar()` substituía a lista inteira de partes pelo que estava no banco — e os papéis ainda não preenchidos (ex.: "Outorgado Comprador") **desapareciam do editor**. Agora a lista é **mesclada**: o que a IA gravou (autoritativo, com id) mais os papéis do tipo de ato ainda pendentes.

### 3. Leitura da IA dispara no upload
Anexar o documento agora já aciona a extração, poupando um clique. A **aplicação** dos dados continua manual: a conferência humana antes de qualquer dado entrar no ato permanece obrigatória. Se a leitura automática falhar, o documento fica anexado e o botão "Extrair dados (IA)" continua disponível.

**Deploy:** só front — `npm run build`.

---

## Vertical de incorporação (construtoras, empreendimentos, cláusulas e vigência)

**Banco:** rode `supabase/construtoras.sql` (10ª migration).
**Funções:** `npx supabase@latest functions deploy artemis-extract artemis-intake artemis-compile intake-publico voz-stream`
**Front:** `npm run build`

Seis melhorias que se apoiam numa base comum: o cadastro da construtora alimenta a qualificação automática, o modelo da escritura e os alertas de vigência.

### 1. Cadastro de construtoras e empreendimentos — `/construtoras`
- **Construtora**: razão social, CNPJ, endereço, contrato social (arquivo) e **modelo padrão de escritura**.
- **Representantes legais**: qualificação completa (estado civil, regime, profissão, RG, endereço) + **procuração outorgada com data de validade**.
- **Certidões**: tipo, número, emissão e **validade** — entram nos alertas dos atos do empreendimento.
- **Empreendimentos**: nome, endereço, matrícula mãe, cartório de RI, registro da incorporação, **número de unidades** e modelo próprio (precede o da construtora).

### 2. Venda de construtora no atendimento externo
- O **catálogo de empreendimentos** vai no prompt: a Artemis reconhece quando o cliente cita um deles.
- Citados empreendimento e unidade, o servidor consulta `unidade_em_uso` de forma **determinística** (não depende de o modelo acertar) e injeta o aviso para a Artemis relatar: *"já existe o protocolo X para essa unidade — é a mesma negociação ou uma nova?"*. O front também exibe o alerta.
- Empreendimento cadastrado ⇒ a **vendedora não é perguntada**: `aplicar_vendedor_construtora` materializa a parte "Outorgante Vendedor" com a construtora e seu representante, e a ficha da conversa descarta qualquer vendedor capturado em duplicidade.
- Internamente, o mesmo pelo card **Venda de construtora** na tela do ato.

### 3. Trilha rápida orientada a documentos
Na entrada do `/atender`: *"Você já tem os documentos em mãos?"*. No caminho rápido a Artemis abre pedindo RG/CNH, contrato e matrícula; se a resposta for **não**, oferece continuar mesmo assim ou voltar depois — e respeita a escolha. Com os documentos, orienta o anexo e pergunta apenas **estado civil, nome, telefone e e-mail** antes de gerar o protocolo.

### 4. Escritura a partir do modelo da construtora
`modelo_para_solicitacao` resolve a precedência **empreendimento → construtora → acervo padrão do tipo de ato** e injeta o texto na compilação, com instrução para preservar estrutura, ordem das cláusulas e terminologia. A resposta traz `modelo_fonte`, indicando de onde veio a base.

### 5. Cláusulas especiais no acervo
Tabela `clausulas_especiais`, **semeada** com sete cláusulas clássicas já redigidas e fundamentadas: retrovenda (CC 505-508), reversão (CC 547), perempção, condição resolutiva (CC 127-128), inalienabilidade/impenhorabilidade/incomunicabilidade (CC 1.848 e 1.911), reserva de usufruto (CC 1.390+) e arras (CC 417-420). No ato, o card permite revisar o texto e inserir; as escolhidas entram na próxima compilação.

### 6. Vigência de certidões e procurações
- Novos tipos de documento: **certidão**, **procuração** e **compromisso de compra e venda**, com extração por IA específica.
- A validade é gravada em **coluna própria** (`documentos.validade`) — e quando a certidão informa só o prazo em dias, o vencimento é **calculado** a partir da emissão.
- `vencimentos_solicitacao` reúne documentos do ato + procuração do representante + certidões da construtora, com alerta a partir de **10 dias**.
- A triagem recebe esse quadro e trata **vencido como exigência bloqueante**; o card no topo do ato mostra tudo, com o aviso de não lavrar antes de regularizar.
- A extração do **compromisso** traz partes e objeto — é o documento que sustenta a trilha rápida do item 3.

---

## Portal da construtora (dashboards e validação jurídica)

**Banco:** rode `supabase/construtora_portal.sql` (11ª migration).
**Funções:** `npx supabase@latest functions deploy workflow-acao`
**Front:** `npm run build`

### CORREÇÃO DE RLS incluída (importante)
`is_equipe` ainda aceitava apenas `('tabeliao','escrevente')`, mas o enum de papéis ganhou `tabeliao_substituto`, `financeiro` e `tabeliao_oficial` em migrations posteriores — **três papéis do fluxo estavam sem acesso via RLS**. A migration corrige a função. Se o cockpit aparecia vazio para o Financeiro ou o Substituto, era isto.

### Decisão de arquitetura: gate ortogonal, não uma nova etapa
A validação da construtora **não** virou uma quinta etapa do fluxo interno. Ela é um gate paralelo, com a mesma mecânica do `financeiro_status`, por dois motivos: (1) a cadeia de etapas do cartório é competência legal, enquanto a aprovação da construtora é comercial — misturá-las confunde responsabilidades; (2) evita ricochete no cockpit, na matriz de competência e nos rótulos.

Coluna `validacao_construtora`: `nao_aplicavel | pendente | enviada | aprovada | ressalvas | reprovada`.

### O fluxo completo
1. Cartório vincula o ato ao empreendimento e gera a minuta (a partir do modelo da construtora).
2. **Enviar minuta para validação** → status `enviada`, rodada registrada em `validacoes_construtora`.
3. O **jurídico da construtora** abre o portal, lê a minuta e decide: **aprovar**, **devolver com ressalvas** ou **reprovar** (as duas últimas exigem observações).
4. Devolvida → o cartório trata e **reenvia** (nova rodada, histórico preservado).
5. Aprovada → **libera a finalização** e o **agendamento da assinatura** com o comprador.
6. `agendar_assinatura` recusa o agendamento enquanto não houver aprovação.

O avanço `aprovação → finalização` fica bloqueado no `workflow-acao` com mensagem específica para cada situação.

### Nova classe de usuário
`construtora_usuarios` vincula um usuário do Auth a uma construtora, com papel **jurídico** (decide) ou **gestor** (acompanha). Esses usuários:
- têm `profiles.papel = 'construtora'` e **não** têm `cartorio_id` — logo nunca passam em `is_equipe`;
- são redirecionados para `/construtora` e não acessam nenhuma tela do cartório;
- enxergam somente os atos dos empreendimentos da própria construtora (RLS via `is_construtora`);
- leem a minuta, mas **não podem editá-la**;
- só o jurídico grava decisão (`pode_validar_construtora`).

### Dashboards
- **Interno — `/painel-construtoras`**: filtro por construtora, uma linha por empreendimento com o funil (atos, em elaboração, na construtora, com ressalvas, aprovadas, agendadas, concluídas) e a próxima assinatura. Os números que exigem ação — *na construtora* e *com ressalvas* — vêm destacados.
- **Externo — `/construtora`**: fila do que aguarda decisão do jurídico, assinaturas agendadas e o panorama por empreendimento (unidade, protocolo, comprador, situação, data da assinatura), com leitura da minuta e histórico das rodadas.

### Cadastro dos acessos
O vínculo é administrado pelo cartório (`construtora_usuarios`). Crie o usuário no Authentication do Supabase, defina `profiles.papel = 'construtora'` e `cartorio_id = null`, e insira o vínculo:
```sql
update public.profiles set papel = 'construtora', cartorio_id = null
where id = (select id from auth.users where email = 'juridico@construtora.com');

insert into public.construtora_usuarios (construtora_id, user_id, nome, email, papel_construtora)
values ('<UUID_DA_CONSTRUTORA>',
        (select id from auth.users where email = 'juridico@construtora.com'),
        'Nome do Jurídico', 'juridico@construtora.com', 'juridico');
```

---

## Administração de usuários, tarefas designadas e diagnóstico do WhatsApp

**Banco:** `supabase/admin_tarefas.sql` (12ª migration)
**Funções:** `npx supabase@latest functions deploy admin-usuarios whatsapp-enviar`
**Front:** `npm run build`

### 1. Hierarquia em dois níveis (N cartórios)
- **admin_plataforma** (iAdvoga) → cria e libera o **administrador de cada cartório** (`liberar_admin_cartorio`).
- **admin_cartorio** → cria e administra os usuários **do próprio cartório**. Nunca alcança outro: a função valida o `cartorio_id` do alvo e recusa e-mail já vinculado a outra casa.
- Trava de segurança: não é possível desativar ou rebaixar o **último administrador ativo** do cartório.

### 2. Três eixos distintos — de propósito
| Eixo | O que é | Exemplos |
|---|---|---|
| **Função** (papel) | Competência no fluxo — matéria legal | escrevente, conferente, financeiro, substituto, oficial |
| **Nível** (1-4) | Alcance administrativo | 1 consulta · 2 operação · 3 supervisão · 4 administração |
| **Grupo** | Organização da equipe | Escreventes, Analistas financeiros, Conferentes, Tabeliães substitutos, Tabeliães oficiais |

Separar função de nível é intencional: um conferente e um escrevente podem ter a mesma competência de etapa e alcances administrativos diferentes. Ao escolher o grupo, função e nível vêm preenchidos e podem ser ajustados caso a caso. Os cinco grupos são **semeados por cartório**.

### 3. Data limite de acesso
`profiles.acesso_ate` + `ativo`. O corte é feito **dentro do `is_equipe`** — logo vale para todas as tabelas de uma vez, sem tocar em cada política. Vencido ou desativado = sem acesso, imediatamente.

### 4. Tarefas designadas entre usuários
Complementa o fluxo de etapas sem substituí-lo: **a etapa diz de quem é a vez; a tarefa diz o que fazer, por quem e até quando.**
- Qualquer usuário designa uma tarefa a outro, vinculada ao protocolo, com prazo e prioridade.
- Ao concluir, o usuário **já designa o próximo do fluxo** (`concluir_tarefa` com o próximo responsável) — a bola nunca fica no chão. O encadeamento fica registrado em `origem_tarefa`.
- Histórico completo em `tarefa_eventos`: criada, reatribuída, concluída, com autor e observação.
- "Tarefas designadas a você" aparece no cockpit, com destaque para atrasadas.

### 5. WhatsApp — diagnóstico
Em **Usuários e acessos → Integração com o WhatsApp → Testar conexão**, o sistema chama a Meta e aponta a causa em português. Causas mais comuns, nesta ordem:

1. **Token expirado** (código 190) — o token do painel dura **24 horas**. É preciso gerar um token permanente de **Usuário do Sistema (System User)** com as permissões `whatsapp_business_messaging` e `whatsapp_business_management`, e dar a ele acesso ao ativo (WABA).
2. **PHONE_ID errado** (código 100) — deve ser o **Phone number ID** (numérico) do painel, não o número de telefone nem o WABA ID.
3. **Número do destinatário fora da lista de testes** (código 131030) — enquanto o app estiver em **modo de desenvolvimento**, só números cadastrados recebem.
4. **Janela de 24 horas** (131047/131051) — fora dela a Meta só entrega **templates aprovados**. Peça ao cliente que envie qualquer mensagem para reabrir a conversa.

---

## Atendimento: campos preenchidos pela Artemis e abertura pela construtora

**Deploy:** `npx supabase@latest functions deploy intake-publico voz-stream` + `npm run build` (sem migration).

### 1. A Artemis preenche os campos da tela
Ao ouvir nome, telefone, e-mail, empreendimento ou unidade, o modelo anexa um marcador ao fim da fala:
```
[[campos: nome=César Augusto Mendes; telefone=19999998888]]
```
O servidor **extrai e remove** o marcador antes de exibir ou sintetizar — o cliente nunca o vê nem o ouve (removido também dentro de `sanitizarResposta`, como rede de segurança). O front atualiza os campos e a Artemis pede a confirmação: *"Preenchi aqui na tela: … — está certinho?"*. A confirmação continua sendo do cliente: há o botão **Confirmar**, e editar qualquer campo reabre a confirmação.

### 2. Campos já preenchidos são reconhecidos, não repetidos
O estado atual da tela vai no prompt a cada turno. Havendo nome ou telefone, a Artemis diz algo como *"Vejo que você, [nome], já informou seus dados de contato na tela — confere?"* e segue, com instrução explícita de **nunca repetir a pergunta de um dado que já está lá**.

### 3. Primeira pergunta: origem do imóvel
O roteiro foi reordenado — a abertura passou a ser *"sua compra foi de uma construtora? qual o empreendimento?"*, com três caminhos:

| Situação | Comportamento |
|---|---|
| **Empreendimento no cadastro** | *"Certinho, já localizei aqui"* → pergunta a unidade → vai direto ao comprador. **Não pede nada da construtora** (razão social, CNPJ, endereço, representante) — já está no cartório. |
| **Empreendimento não cadastrado** | Acolhe sem constrangimento (*"não encontrei no nosso cadastro, mas seguimos normalmente"*) e **avisa que vai precisar também dos dados do vendedor**. Fluxo completo. |
| **Não é de construtora** | Fluxo comum: vendedor e comprador. |

A confirmação do cadastro **não depende do modelo**: o servidor compara o que o cliente disse com o catálogo e injeta o fato confirmado no prompt, além de devolvê-lo ao front, que mostra o selo verde do empreendimento localizado.

---

## Minuta assistida, agenda de assinaturas e navegação no celular

**Banco:** `supabase/agendamentos.sql` (13ª migration)
**Funções:** `npx supabase@latest functions deploy minuta-assistente`
**Front:** `npm run build`

### 1. Atualizar minuta e analisar ressalvas
Nova função **`minuta-assistente`**, com duas ações:

- **`recompilar`** — botão **↻ Atualizar minuta** ao lado das cláusulas especiais. Regera o texto a partir dos **dados atuais** do ato: partes, imóvel, modelo aplicável (empreendimento → construtora → acervo) e cláusulas já escolhidas. Não depende do histórico de conversa do assistente, então funciona mesmo em outra sessão. Devolve a versão, os alertas e os **campos que ficaram pendentes** — e grava na cadeia de custódia.
- **`analisar_ressalvas`** — botão **✦ Analisar ressalvas com a IA**, que aparece quando a construtora devolve a minuta. A Artemis lê as observações do jurídico e a minuta atual e propõe, para cada ressalva: o **trecho atual**, o **texto sugerido** (com botão copiar) e a justificativa.

Duas salvaguardas deliberadas nessa análise:
- Ela **não altera a minuta** — propõe, e o cartório aplica. Mantém a regra de validação humana que sustenta o sistema.
- Ressalva **juridicamente inviável não é acatada**: vai para o campo *objeções*, com o motivo e uma alternativa compatível. A conveniência comercial da construtora não se sobrepõe à legalidade do ato.

### 2. Agenda de assinaturas — `/agendamentos`
- **Pauta por dia**, no fuso do cartório, com hora, tipo de ato, protocolo, empreendimento/unidade, **partes**, local e contato.
- Selo de **minuta aprovada** (ou o motivo da pendência) e leitura da minuta na própria tela.
- **Remarcar** direto da pauta.
- Bloco **Prontos para agendar**: atos aprovados ainda sem data — havendo construtora, só entram depois da aprovação do jurídico, respeitando o mesmo gate do fluxo.

### 3. Navegação no celular
O menu lateral era uma coluna fixa de 240px, sempre visível — com nove itens, inviável num telefone. Agora:
- **Desktop (>900px)**: coluna fixa, como antes.
- **Celular**: barra superior com **menu sanduíche**, atalho para nova solicitação, e a navegação como **gaveta deslizante** com fundo escurecido, que fecha sozinha ao navegar.
- Conteúdo com margens menores, cards mais compactos e tabelas roláveis em vez de espremidas.

---

## Data única, atendimento manual, foco do Financeiro e trilha de passos

**Banco:** `supabase/data_cartorio.sql` (14ª migration)
**Front:** `npm run build` (sem função nova)

### 1. A data — causa raiz encontrada
O cockpit estava certo (já usava o fuso do cartório), mas **o banco não**. O Postgres do Supabase roda em **UTC**, e havia sete comparações com `current_date` nas regras de negócio. Entre 21h e meia-noite (Brasília), banco e interface ficavam em dias diferentes:

- tarefa com prazo para **hoje** aparecia como **atrasada**;
- certidão que vence **hoje** aparecia como **vencida**;
- acesso com data limite de hoje era cortado horas antes;
- o cockpit exibia um dia e os cálculos usavam outro — o "conflito com outras áreas".

**Correção:** `data_cartorio()` passa a ser a **única referência de dia civil**, usada em `vencimentos_solicitacao`, `acesso_vigente`, `minhas_tarefas`, `equipe_do_cartorio` e `criar_tarefa`. O fuso fica em `config_sistema` (padrão `America/Sao_Paulo`), ajustável sem tocar no código.

Além disso, **o cockpit passou a buscar a data do servidor** — não do relógio do aparelho. Se o computador estiver em outra data, aparece um aviso e o sistema usa a data do cartório. Uma fonte de verdade só.

### 2. Atendimento: opção de preencher manualmente
Quem escolhe *"já tenho os documentos"* recebe a pergunta: **digitar os dados ou falar com a Artemis?**
- **Formulário**: solicitante, partes (N pessoas, com papel, CPF, RG e estado civil), objeto (descrição, matrícula, cartório de RI, endereço, valor), contrato e observações. Ao enviar, os dados entram na conversa e o restante do fluxo (resumo, LGPD, protocolo) segue igual.
- **Conversa**: mantém o comportamento atual — a Artemis preenche os campos na tela conforme a pessoa informa.
- Dá para voltar do formulário para a conversa a qualquer momento.

### 3. Tela objetiva para o Financeiro
Com papel `financeiro`, a tela do ato esconde o que é do escrevente e do tabelião — pré-qualificação registral, consulta jurídica e cláusulas especiais — e a trilha de passos mostra apenas: **Solicitante · Documentos · Emolumentos e guias · Tarefas**, com alerta quando há valor pendente de validação.

### 4. Aviso de minuta atualizada
Ao atualizar a minuta pelas cláusulas, aparece um **pop-up com o número da nova versão** e a base usada (modelo do empreendimento, da construtora ou do acervo). O botão leva direto ao bloco da minuta, que já vem recarregado.

### 5. Trilha de passos na tela do ato
A tela passou de dez blocos empilhados. Agora há uma **barra fixa no topo** com a ordem do trabalho — Solicitante · Documentos · Partes · Pré-qualificação · Cláusulas · Minuta · Construtora · Fluxo · Tarefas — marcando o passo atual, o que já está pronto e saltando direto para cada bloco. No celular, mostra só o ícone do passo ativo.

### 6. Quem aprovou ou fez ressalvas
`decidir_validacao_construtora` passou a gravar o nome do usuário do jurídico automaticamente. O painel interno ganhou o bloco **Decisões do jurídico**, com unidade, protocolo, decisão, **quem decidiu**, a observação e quando — para retomar a conversa direto com a pessoa certa.

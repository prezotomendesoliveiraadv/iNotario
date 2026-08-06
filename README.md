# iNotário · MVP

Plataforma de **IA notarial** para criação e validação de **escrituras públicas**: o cliente preenche os dados das partes, o **motor Artemis** gera a minuta e um **parecer de qualificação preventiva**, o cartório acompanha tudo por um **dashboard**, e cada alteração fica registrada numa **cadeia de custódia auditável**.

> Nome de produto provisório. Uma solução do ecossistema iAdvoga.

## Stack

- **Front:** React 18 + TypeScript + Vite + Tailwind CSS + React Router
- **Back:** Supabase (PostgreSQL + Auth + RLS + triggers)
- **Motor Artemis (MVP):** geração de minuta por template + qualificador heurístico determinístico, com ponto de extensão para LLM real

---

## 1. Configurar o Supabase

> ⚠️ **A fonte da verdade para implantar é o `iNotario_guia_implantacao.docx`.**
> Este README descreve a origem do projeto e continua útil para entender a
> arquitetura, mas o passo a passo abaixo é a versão resumida.

1. Crie um projeto em [supabase.com](https://supabase.com).
2. Abra **SQL Editor → New query** e rode as **14 migrations na ordem**, uma por vez
   (`schema.sql` é apenas a primeira delas). A ordem é crítica: as migrations 11, 12 e 14
   reescrevem funções criadas nas anteriores, e `data_cartorio.sql` tem de ser **sempre a
   última**. A lista numerada está na seção 2 do Guia de Implantação.
   - A primeira cria tabelas, enums, RLS, triggers (protocolo, `updated_at`, cadeia de custódia encadeada por hash) e faz o *seed* de 3 tipos de ato (compra e venda, doação, procuração).
3. Em **Project Settings → API**, copie a **Project URL** e a **anon public key**.

## 2. Configurar o front

```bash
npm install
cp .env.example .env.local
# edite .env.local com VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY
npm run dev
```

Abra `http://localhost:5173`.

## 3. Criar o primeiro usuário e vinculá-lo a um cartório

1. Na tela inicial, clique em **Cadastre-se** e crie sua conta (e-mail + senha).
   - Se a confirmação por e-mail estiver ativa no Supabase, confirme antes de entrar (ou desative em **Authentication → Providers → Email**).
2. No **SQL Editor** do Supabase, crie um cartório e promova seu usuário a **tabelião** (troque o e-mail):

```sql
insert into public.cartorios (nome, cns, comarca, uf)
values ('1º Tabelionato de Notas — Campinas', '000000', 'Campinas', 'SP');

update public.profiles set
  papel = 'tabeliao',
  cartorio_id = (select id from public.cartorios limit 1)
where id = (select id from auth.users where email = 'voce@exemplo.com');
```

3. Recarregue o app. O dashboard do cartório aparece.

---

## Fluxo de uso

1. **Nova solicitação** → escolha o tipo de ato, preencha as partes e os dados.
2. Abra a solicitação → **Gerar minuta provisória** (motor Artemis).
3. Confira a **minuta** e o **parecer de qualificação** (itens OK / atenção / pendente, com fundamento).
4. Ajuste o que for preciso, **gere a definitiva**, mude o **status** até *concluída*.
5. Acompanhe a **cadeia de custódia** — cada evento encadeado por hash.

---

## Onde está a IA (e como ligar a generativa real)

No MVP, `src/lib/minutaEngine.ts` é **determinístico**: monta a minuta a partir do `template` do tipo de ato e roda regras notariais/registrais (partes qualificadas, campos essenciais, ITBI, vênia conjugal, dação em pagamento, matrícula etc.).

Para plugar a IA generativa (linha Artemis / Claude), substitua `gerarConteudo` por uma chamada a uma **Supabase Edge Function** que invoque o LLM — mantendo a chave **fora do front**. O restante do fluxo (qualificação, hash, versionamento, custódia) permanece igual.

---

## Estrutura

```
inotario/
├─ supabase/
│  ├─ *.sql                   # 14 migrations — rodar NA ORDEM do Guia
│  └─ functions/              # 15 Edge Functions (Deno) + _shared/
├─ src/
│  ├─ lib/                    # supabase client, types, motores e chamadas às functions
│  ├─ context/AuthContext.tsx # sessão + perfil
│  ├─ components/             # ui.tsx (Layout, StatusBadge, ProtectedRoute) e cards
│  └─ pages/
│     └─ atendimento/         # /atender decomposto: hook de estado + telas
├─ _legado/                   # código fora da implantação (ver _legado/LEIA-ME.md)
├─ .env.example
└─ package.json
```

---

## Notas importantes

- **Fé pública indelegável.** A IA é assistente; a decisão e a responsabilidade são do tabelião. O fluxo sempre prevê revisão humana antes da minuta definitiva.
- Os **templates de minuta são ilustrativos** — não constituem modelos jurídicos finais nem dispensam a revisão do delegatário e a conformidade com o CNN/CNJ e o e-Notariado.
- Conformidade plena (videoconferência, ICP-Brasil, CENSEC) e integração ao e-Notariado entram nas fases seguintes do roadmap.

---

## IA Artemis (Edge Functions · texto e voz)

Além do motor determinístico, o app integra a **Artemis com IA** via duas Supabase Edge Functions:

- `supabase/functions/artemis-chat` — conversa por **texto ou voz** (STT + TTS).
- `supabase/functions/artemis-compile` — compila a minuta editável + relatório de qualificação, grava em `minutas` (com hash) e dispara a **cadeia de custódia**.

No app: abra uma solicitação → **Abrir assistente (IA)** → converse/fale → **Compilar minuta**. Passo a passo de deploy e segredos em **`supabase/functions/DEPLOY.md`**.

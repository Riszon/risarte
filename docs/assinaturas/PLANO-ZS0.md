# Plano ZS0 — Integração ZapSign no riSZon (assinatura digital)

_Aprovado pelo dono em 31/10/2026. Fases ZS1–ZS8, uma por sessão. Este arquivo é a referência de cada fase; o estado de cada entrega vai para `ESTADO_DO_PROJETO.md`._

## 1. Contexto

O riSZon ainda não assina nada digitalmente. Hoje a venda do paciente fecha com "Contrato assinado" marcado **à mão** (`commercial_close_step`, `closing-panel.tsx`), e o contrato do Risarte Empresarial sai como página para imprimir (`/empresarial/funil/[leadId]/contrato`). O dono quer: enviar um documento ou pacote em poucos cliques, status atualizado sozinho pelo webhook, PDF assinado guardado e visível no riSZon, indicadores por rede/unidade e tudo configurável pela tela. A ZapSign já era a decisão registrada (`CLAUDE.md` §4).

Este documento é o plano aprovado para as fases ZS1–ZS8. Nada de código antes do OK.

## 2. O que já existe no código (reuso e conflitos encontrados)

**Reutilizar (não reescrever):**
- Padrão de modelo com `{{campos}}`: `empresarial.contract_templates` (`preamble`, `sections jsonb`, `closing`) + `src/lib/empresarial/contrato.ts` (`CAMPOS_DO_CONTRATO`, `preencher`, `camposDesconhecidos`, teste que confere cada campo contra o catálogo). O módulo novo copia essa forma para `signature_templates`, e o contrato de adesão **lê o texto que já está em `contract_templates`** (o jurídico do dono já aprovou aquele texto; a 1037 é o modelo atual).
- Dados da contratada (Risarte Administração): `empresarial.contract_settings` (razão social, CNPJ, representante, RG, CPF, Sr./Sra.) — `lerContratada()`.
- Menor de idade: `ehMenorDeIdade` (`src/lib/idade.ts`), `client_guardians` (responsável legal — **sem e-mail hoje**; ganha coluna `email`).
- Valor do orçamento: `numerosDoOrcamento` (`src/lib/orcamento.ts`) → `totalCents` = `plan_negotiations.final_cents`.
- Matriz de permissões configurável: `src/lib/permissions.ts` (`CAPACIDADES`), `permission_matrix` (0246), `pode()` em `auth.ts`, painel `/admin/permissoes` desenha o catálogo sozinho.
- Avisos internos: só por função `security definer` (regra 0316), padrão `_ortho_case_notify` + tabela de dedupe; categoria por prefixo de link em `src/lib/notifications.ts`.
- Storage privado + URL assinada curta: padrão de `empresarial/[companyId]/document-actions.ts` (`getFileUrl`, 300 s) e do bucket `system-reports` (limite de tamanho e MIME na criação do bucket).
- Link do WhatsApp pronto: `linkDoWhatsApp` + `montarMensagem` (`src/lib/empresarial/envio.ts`) → sobem para `src/lib/whatsapp.ts` (mesmo movimento feito com `print.ts`), o Empresarial reexporta.
- Auditoria: `logAudit()` (ids só), `audit_attach_all()`, `auditoria-catalogo.ts`, `audit-labels.ts`.
- Realtime: padrão do chat (`.channel().on("postgres_changes")`, `alter publication supabase_realtime add table`).
- pg_cron: padrão `do $$ perform cron.schedule(...) exception when others then null end $$`, função de rotina com `revoke … from public, anon, authenticated`.
- Testemunhas e representantes com CPF/telefone/e-mail: `staff_members` (Risartanos; `cpf`, `whatsapp`, `email`, `user_id` desde a 0079). `profiles` não tem CPF.
- Marca: `public/marca/*.svg`, fontes Inter em `docs/marca/extraido/`.

**Conflitos com o prompt (decididos abaixo, §4):**
1. Esboço antigo de ZapSign no Empresarial (`src/lib/empresarial/zapsign.ts`, Edge Function `supabase/functions/zapsign-webhook`, `empresarial.contracts`, `empresarial.zapsign_webhook_events`, RPC `mark_contract_signed`). Nunca enviou nada (a aba Contratos chama `sendContract` sem PDF). O prompt pede Route Handler na Vercel.
2. O contrato de adesão hoje nasce no **funil (lead)**, antes de a empresa existir; a empresa só é criada depois dos dois selos (`contract_signed_at` + `implantation_paid_at`, AP39). O prompt fala em "ficha da empresa".
3. **Consultor RisLife vê todas as empresas hoje** (`empresarial.is_program_manager()` inclui qualquer `rislife_consultant`; `assigned_consultant_id` não restringe nada para ele). O prompt exige, no módulo de assinaturas, acesso só às empresas em que ele é o consultor responsável, por RLS.
4. Não existe serviço de e-mail; o Empresarial declara "O SISTEMA NÃO ENVIA E-MAIL". O prompt pede relatório mensal e alertas por e-mail.
5. Rotinas agendadas são **pg_cron** no banco; não há `vercel.json` nem `src/app/api`. Reconciliação e e-mail precisam sair do banco (HTTP) → Vercel Cron.
6. A ficha do paciente **já tem a aba "Documentos"** (documentos clínicos: prescrição, atestado…), com permissão de dentista/coordenador.
7. RLS do projeto **não lê** `permission_matrix` (decisão da 0246: a matriz só gera a interface; o banco usa funções por papel fixas). O prompt pede "garantido por RLS" **e** "liberar qualquer papel no painel sem mudar código".
8. Papel "Financeiro": só existe `finance_franchisor` (Financeiro da Franqueadora). Não há financeiro de unidade. "Admin" e "Admin Master" são a mesma flag `is_admin_master`; o titular é `profiles.is_owner`.

## 3. O que a documentação da ZapSign confirma (docs.zapsign.com.br, lido em 31/10/2026)

| Tema | O que existe | Observação |
|---|---|---|
| Criar documento por PDF | `POST /api/v1/docs/` com `base64_pdf` ou `url_pdf` (≤10 MB), `name`, `external_id`, `folder_path`, `lang`, `disable_signer_emails`, `date_limit_to_sign`, `signature_order_active`, `reminder_every_n_days`, `allow_refuse_signature`, `observers[]`, `metadata[]`, `signers[]` | Token em `Authorization: Bearer`. Resposta: `token` do doc, `signers[].token` + `sign_url`. |
| Signatário | `name`, `email`, `phone_country`/`phone_number`, `auth_mode`, `order_group`, `qualification` ("testemunha"), `external_id`, `cpf` + `require_cpf`/`validate_cpf`, `require_selfie_photo`, `require_document_photo`, `selfie_validation_type`, `send_automatic_email`, `send_automatic_whatsapp`, `send_automatic_whatsapp_signed_file`, `lock_*`, `redirect_link` | `auth_mode`: `assinaturaTela`, `tokenEmail`, `assinaturaTela-tokenEmail`, `tokenSms`, `assinaturaTela-tokenSms`, `tokenWhatsapp`, `assinaturaTela-tokenWhatsapp`, `certificadoDigital`. |
| Ordem de assinatura | `signature_order_active: true` + `order_group` (1, 2, 3…); o grupo seguinte é liberado quando o anterior conclui | ⚠️ **Exige ligar "Bloquear assinatura fora da ordem definida" em Configurações → Organização → Preferências da conta** — sem isso a ordem é só sugestão. Vai no checklist de produção (ZS8). |
| Selfie + token (decisão 8) | `require_selfie_photo: true` + `auth_mode: "assinaturaTela-tokenWhatsapp"` (ou `tokenEmail`), **sem** `require_document_photo` | Token por WhatsApp/SMS tem custo por envio no plano; selfie depende do plano. |
| Posição de assinatura e rubrica | `POST /api/v1/docs/{token}/place-signatures/` com `rubricas[]`: `{ page (0-based), relative_position_left/bottom (0–100, origem no canto inferior esquerdo), relative_size_x/y, type: "signature" \| "visto", signer_token }` | **Um objeto por página por signatário** (não há "todas as páginas"). Tamanhos sugeridos A4 vertical: assinatura 19,55 × 9,42; rubrica 13,76 de largura. Cada chamada substitui todas as anteriores. |
| Consultar documento | `GET /api/v1/docs/{token}/` | `status`: `pending` \| `signed` \| `refused`. Signatário: `new` \| `link-opened` \| `signed`. `original_file`/`signed_file` **expiram em 60 min**. |
| Listar documentos | `GET /api/v1/docs/?created_from=&created_to=&status=` → `count` | Conferência do consumo do mês. |
| Adicionar / atualizar / remover signatário | `POST /docs/{token}/add-signer/`; `POST /signers/{signer_token}/`; `DELETE /signer/{signer_token}/remove/` | Só quem ainda não assinou; não o único signatário. |
| Reenviar notificação | `POST /docs/{token}/resend-notifications-bulk/` (todos os pendentes, respeita a ordem; 429 em cooldown) | **Não há reenvio por signatário.** O nosso reenvio é pelo link (WhatsApp/copiar). |
| Cancelar | `POST /api/v1/refuse/` com `doc_token`, `rejected_reason`, `notify_signer` | Só em andamento; **assinado não cancela** (403 `document_already_signed`) — bate com a decisão 13. |
| Excluir | `DELETE /docs/{token}/` (soft delete) | Não vamos usar. |
| Plano | `GET /api/v1/info-plan` → `name`, `number_of_credits`, `status`, `period`, `current_period_end` | **Não informa documentos usados no mês.** Consumo é contado pelo riSZon (pacotes enviados no mês), com conferência pelo `count` da listagem. |
| Webhooks | Cadastro no painel ou `POST /user/company/webhook/` (`url`, `type`, `headers[]`); header custom via `POST …/webhook/header/` | **Não há HMAC nem lista de IPs.** Validação = header secreto nosso (`x-riszon-webhook-secret`). Retentativa se não responder 200 (cronograma não documentado). Reprocessar: `POST /docs/{token}/reprocess-doc/` `{send_webhook: true}`. |
| Eventos | `doc_created`, `doc_signed` (**um por assinatura**; traz `signer_who_signed` e `status` do doc = `signed` quando foi o último), `doc_refused` (`rejected_reason`; o documento inteiro fica recusado), `doc_deleted`, `doc_viewed`, `doc_read_confirmation`, `signature_notification_sent`, `email_bounce`, `signer_authentication_failed`, `doc_expired`, `doc_expiration_alert` (7, 3 e 1 dia antes) | Payload: `token`, `external_id`, `status`, `signed_file` (60 min), `signers[]` com `status`, `signed_at`, `auth_mode`. |
| Sandbox | `https://sandbox.api.zapsign.com.br/api/v1/`, conta própria em sandbox.app.zapsign.com.br; "replica a produção", sem validade jurídica, sem plano; webhooks funcionam | A doc não garante e-mail/selfie no sandbox — provar na ZS8. |
| Rate limit | 500 req/min por token | |
| Consumo | Documento conta **ao ser criado**; cancelado não devolve crédito | Pacote mesclado = 1 documento (reforça a decisão 3). |

**O que a documentação NÃO tem:**
- **E-mail automático com o PDF assinado aos signatários ao final** — não documentado (só `observers[]` recebem e-mail ao concluir; `send_automatic_whatsapp_signed_file` custa por envio). → Decisão 12 fica com o riSZon: ele guarda o PDF e manda a cópia pelo seu canal (e-mail via adaptador; WhatsApp quando existir).
- **Assinatura automática do signatário interno** — o que existe é "Assinar em lote via API" (`POST /api/v1/sign/`, **add-on pago do plano API**): assina em nome de um **usuário da conta ZapSign** (`user_token`), só com `assinaturaTela` (+ selfie opcional), e o e-mail do signatário tem de ser o do usuário. Prós/contras em §4.2.
- `signed_file_only_finished` aparece nas respostas sem explicação — não usar.
- Tamanho máximo do `base64_pdf` não documentado (só os 10 MB de `url_pdf`) → validar 10 MB antes de enviar.

## 4. Decisões propostas (os "pontos que ainda preciso que você proponha" + os conflitos)

> **Confirmado pelo dono em 31/10/2026:** (1) não automatizar a assinatura do representante — fica "Minhas assinaturas pendentes"; (2) contrato de adesão sai do funil (lead) **e** da ficha da empresa; (3) a RLS deste módulo lê a `permission_matrix` (`signature_can`), exceção à 0246 restrita ao módulo; (4) as assinaturas entram na aba "Documentos" já existente da ficha do paciente.

### 4.1 Representante da Risarte por modelo — estrutura
Cada modelo guarda **como achar quem assina** (`risarte_signer_mode`) e o detalhe:

| Modo | Significado | Resolvido no envio como |
|---|---|---|
| `role` | Por papel, relativo à unidade emissora | `owner` (titular Admin), `unit_manager` (gerente da unidade emissora), `finance_franchisor`, `franchisor_staff`, `rislife_consultant` (o consultor responsável pela empresa) |
| `sender` | Quem está enviando | o próprio usuário logado |
| `user` | Pessoa fixa | `risarte_signer_user_id` |
| `none` | O modelo não leva assinatura da Risarte | (ex.: autorização de uso de imagem, se o dono quiser) |

Regras: o papel pode resolver em várias pessoas → o modal mostra a lista e quem envia escolhe (padrão: a primeira ativa); zero pessoas → o envio é bloqueado com a mensagem do que falta. CPF/telefone/e-mail do representante vêm de `staff_members` (ligado por `user_id`); se faltar, o modal pede e grava em `signature_signers` (não altera o cadastro). Padrões iniciais: contrato de prestação → `unit_manager`; TCLE → `unit_manager`; orçamento aprovado → `sender`; autorização de imagem → `unit_manager`; adesão empresarial → `owner`. Tudo editável na tela.

### 4.2 Assinatura automática do representante — prós, contras e requisitos (o dono decide)
**Como seria:** quando chega a vez da Risarte, o riSZon chama `POST /api/v1/sign/` com o `user_token` do representante. O representante precisa ser **usuário da conta ZapSign da franqueadora** com perfil completo (nome, telefone, assinatura e rubrica desenhadas, "assinar via API" ligado) e o e-mail do signatário no documento tem de ser o dele.
- **Prós:** zero fila para o representante; pacote conclui minutos após a última assinatura externa; sem crédito extra por assinatura.
- **Contras:** add-on pago do plano API; cada representante vira usuário ZapSign (gerente de unidade, consultor…); só funciona com `assinaturaTela` (pacotes com selfie+token exigiriam `selfie_photo` no envio — inviável automático); o riSZon passa a guardar `user_token` de pessoas (segredo por pessoa, criptografado); juridicamente é "o sistema assinou por mim" — a vontade de assinar deixa de ser um ato da pessoa naquele momento.
- **Recomendação:** **não** automatizar agora. Construir "Minhas assinaturas pendentes" (ZS3) com assinatura em sequência (abre cada link, o status atualiza pelo webhook e avança para o próximo) e aviso interno. Deixar a porta aberta: o cliente ZapSign terá `signInBatch()` tipado; ligar depois é uma configuração por representante.

### 4.3 Painel de permissões — integrar ao existente, e fazer a RLS ler a matriz
- Chaves novas em `CAPACIDADES` (`src/lib/permissions.ts`), grupo "Assinaturas digitais": `modulo.assinaturas` (menu/painel), `acao.assinaturas.enviar`, `acao.assinaturas.cancelar`, `acao.assinaturas.visualizar`, `acao.assinaturas.baixar`, `acao.assinaturas.painel_unidade`, `acao.assinaturas.painel_rede`, `acao.assinaturas.configurar`. Padrões = matriz do prompt (semeados na migração com `on conflict do nothing`, guardados por `if exists`, como a 0318). "Admin" = flag `is_admin_master` (sempre pode); "Financeiro" = `finance_franchisor`.
- **Novidade proposta para este módulo:** uma função `public.signature_can(p_capability text, p_clinic_id uuid)` (security definer) que responde `is_admin_master()` **ou** "algum papel que a pessoa tem nessa unidade (ou na franqueadora com escopo sobre ela) está marcado na `permission_matrix` para essa capacidade" (cai nos padrões em código se a matriz estiver vazia, igual ao app). Todas as policies e RPCs do módulo usam essa função. Assim mudar um papel no painel muda o banco também, sem código — é o que o prompt pede. Fica registrado no `CLAUDE.md` como exceção à regra da 0246, restrita ao módulo.
- A regra do Consultor RisLife (só as empresas/leads em que é o responsável) **não passa pela matriz**: é fixa em `empresarial.is_consultant_of_company(company_id)` / `…_of_lead(lead_id)` e combinada por `and` na policy. Fora do módulo, o Empresarial continua como está (não é escopo daqui; registrar em `docs/BACKLOG.md`).

### 4.4 E-mail — proposta: Resend
Não há serviço. Proposta: **Resend** (API HTTP simples, roda em Server Action/Route Handler/cron da Vercel, 3.000 e-mails/mês no plano gratuito, domínio verificado por DNS). Adaptador `src/lib/notify/email.ts` atrás da mesma interface dos canais (§5.4); sem `RESEND_API_KEY` o sistema **diz** que o e-mail não está configurado e não promete envio (regra do projeto). Usos: cópia assinada ao cliente (ZS3), alerta de consumo (ZS6), relatório mensal (ZS7). Pré-requisito do dono: domínio de envio (ex.: `risarte.com.br`) e os registros DNS que a Resend pedir.

### 4.5 Webhook e cron — Route Handler na Vercel + `vercel.json` com `crons`
- Webhook: `src/app/api/webhooks/zapsign/route.ts` (como o prompt). A Edge Function `zapsign-webhook` é **retirada** (nunca foi publicada), junto com `src/lib/empresarial/zapsign.ts` (vira reexport de `lib/zapsign`), para não haver dois caminhos.
- `src/proxy.ts`: `/api/webhooks/` e `/api/cron/` entram em `PUBLIC_PATHS` (sem login); cada rota valida o seu segredo (`ZAPSIGN_WEBHOOK_SECRET`; `CRON_SECRET` que a própria Vercel envia como `Authorization: Bearer`).
- Cron: `vercel.json` só com `crons` (não mexe em região). `/api/cron/signatures-hourly` (reconciliação + e-mails pendentes) e `/api/cron/signatures-monthly` (dia 1º, 06:00 BRT). O que é só banco (expirar, lembretes, limite do plano) fica em **pg_cron** (`signature_daily_run()`), no padrão do projeto. Observação: a Vercel exige plano Pro para cron mais frequente que diário — o projeto está em Pro.

### 4.6 Empresarial — origem do contrato de adesão
Duas origens, mesmo módulo: **funil (lead)** — botão "Enviar para assinatura" na tela do contrato (`/empresarial/funil/[leadId]/contrato`), que já tem texto, dados e Anexo I prontos; e **ficha da empresa** (aba Contratos) para aditivos e outros documentos. Pacote assinado com origem no lead → o webhook marca o selo `contract_signed_at` sozinho (hoje é à mão) e, quando a empresa é criada, o pacote passa a aparecer na aba Documentos dela (`company_id` preenchido pelo `convertLeadToCompany`). O consultor responsável do lead é `commercial_leads.consultant_id`; da empresa, `companies.assigned_consultant_id`.

### 4.7 Aba "Documentos" da ficha do paciente
Reaproveitar a aba existente: bloco **"Assinaturas digitais"** no topo (lista de pacotes, status, ações) e, abaixo, o bloco atual "Documentos clínicos". A aba aparece se a pessoa tem **qualquer** das duas permissões; cada bloco respeita a sua. (Alternativa, se o dono preferir: aba própria "Assinaturas".)

### 4.8 Integração com o fechamento da venda do paciente
Pacote com origem `plan_negotiation` que contém o modelo "orçamento aprovado" ou "contrato de prestação": ao ficar **Assinado**, o webhook chama `commercial_close_step(..., 'contract', true)` em nome do sistema. O toggle manual continua existindo (venda fechada fora do fluxo digital), com o texto "marcado pela assinatura digital em dd/mm" quando foi automático.

## 5. Arquitetura

### 5.1 Cliente ZapSign — `src/lib/zapsign/` (server-only)
- `env.ts`: `ZAPSIGN_API_TOKEN`, `ZAPSIGN_ENV` (`sandbox` \| `production`; só produção na Vercel de produção), `ZAPSIGN_WEBHOOK_SECRET`; base URL por ambiente; `isZapsignConfigured()`.
- `client.ts`: `fetch` com `Authorization`, `User-Agent: riSZon`, timeout, 1 retry em 5xx/429 com espera, erro tipado `ZapsignError { code, httpStatus, messagePt, logMessage }` (mensagem pt-BR para a tela; log técnico em inglês sem dado pessoal).
- `types.ts`: tipos dos payloads (documento, signatário, webhook, `rubricas[]`).
- Funções: `createDocumentFromPdf()`, `getDocument()`, `listDocuments()`, `addSigner()`, `updateSigner()`, `removeSigner()`, `placeSignatures()`, `resendNotifications()`, `refuseDocument()` (cancelar), `getPlanInfo()`, `reprocessWebhook()`, `signInBatch()` (só tipado; desligado).
- `webhook.ts`: `parseWebhook(body)` → evento normalizado; `webhookEventKey()` para idempotência.
- Testes: `src/lib/__tests__/zapsign.test.ts` com `fetch` falso (montagem do corpo, ordem, auth, erros).

### 5.2 Geração e mesclagem de PDF — `src/lib/signatures/pdf/`
- Bibliotecas (novas, puras em JS, compatíveis com a Vercel): **`@react-pdf/renderer`** (renderiza cada modelo em PDF A4 no servidor, com Inter embutida de `docs/marca/extraido`) e **`pdf-lib`** (capa, mesclagem, contagem de páginas, bloco de assinaturas, rubrica, "cópia não assinada"). Sem Chromium.
- `render-template.ts`: modelo + valores → PDF (título, preâmbulo, cláusulas, fecho, Anexo quando houver). Marca d'água "TEXTO PROVISÓRIO" quando `is_provisional_text`.
- `signature-block.ts`: após mesclar, para cada documento do pacote, desenha na **última página** (ou numa página extra se não couber) o bloco "Assinaturas" com uma caixa por signatário (nome, CPF, qualificação) e devolve as coordenadas → vira `rubricas[]` do `place-signatures` (`type: "signature"`). Rubrica (`type: "visto"`) no rodapé direito de **todas** as páginas, para todos os signatários. Tudo em coordenadas relativas (0–100, origem inferior esquerda), como a ZapSign pede.
- `cover.ts`: capa/índice (logo PNG gerado dos SVGs da marca uma vez, nome do cliente, data, lista dos documentos com a página inicial, texto curto "leia antes de assinar").
- `merge.ts`: `[capa, doc1, doc2, …, PDFs avulsos]` → um PDF; registra `first_page`/`last_page` de cada item; valida PDFs avulsos (abre com pdf-lib, recusa criptografado), limite total 10 MB.
- `copy.ts`: cópia individual de consulta a partir do PDF **mesclado original** (nunca do assinado), com faixa "CÓPIA — não assinada digitalmente — pacote nº …" em cada página.
- Pré-visualização = o PDF mesclado gerado e gravado como rascunho no Storage, aberto no visualizador antes do envio.

### 5.3 Fluxo de envio — `src/lib/signatures/` + `src/app/(app)/assinaturas/actions.ts`
- `signers.ts` (puro, testado): monta a lista de signatários a partir dos modelos do pacote: cliente (ou responsável legal se menor — bloqueio sem responsável), outros do lado do cliente, testemunhas (dedupe por CPF), representantes (um por modelo, dedupe), `order_group` 1/2/3, qualificação.
- `auth-level.ts` (puro, testado): nível = `strong` se algum modelo exige ou se `linked_amount_cents > threshold`; devolve o motivo para a tela.
- `validate.ts` (puro, testado): CPF válido (`isValidCpf` novo em `src/lib/masks.ts`), telefone ou e-mail presente, testemunhas definidas quando o modelo pede, PDFs anexos válidos.
- `variables.ts`: catálogo de campos `{{…}}` por público (paciente: nome, CPF, nascimento, responsável, endereço, unidade, CNPJ da unidade, procedimentos, valores, parcelas…; empresa: os de `CAMPOS_DO_CONTRATO`), com teste que confere os 5 modelos semeados contra o catálogo (igual ao Empresarial).
- `send.ts` (servidor): 1) guarda (`signature_can('enviar', clinic)`); 2) cria pacote `draft` + itens + signatários; 3) gera e mescla o PDF, grava `merged.pdf`; 4) `createDocumentFromPdf` (base64, `external_id = package_id`, `signature_order_active`, `date_limit_to_sign`, `disable_signer_emails` conforme configuração, `lang pt-br`, `metadata`); 5) `placeSignatures`; 6) grava tokens e `sign_url`, status `sent`, `plan_month`; 7) `signature_events` + `logAudit`; 8) devolve os links por signatário para o modal escolher o canal. Falha depois do passo 4 → cancela na ZapSign (`refuse`) para não deixar documento órfão consumindo crédito… (não devolve o crédito, mas evita assinatura solta) e volta o pacote para `draft` com o erro.

### 5.4 Camada de canais — `src/lib/notify/`
```ts
interface NotificationChannel {
  id: "whatsapp_link" | "copy_link" | "sign_now" | "email" | "whatsapp_api";
  isConfigured(): boolean;
  send(msg: { to: Signer; text: string; link?: string; attachment?: { path: string; name: string } }): Promise<ChannelResult>;
}
```
Adaptadores agora: `whatsapp-link.ts` (gera `wa.me` com a mensagem padrão preenchida — o usuário dispara), `copy-link.ts`, `sign-now.ts` (abre o link na clínica), `email.ts` (Resend; cópia assinada e avisos). Futuro: `whatsapp-api.ts` — só um arquivo novo. `templates.ts`: mensagem padrão com `{{nome}}`, `{{link}}`, `{{unidade}}`, `{{prazo}}` (editável nas configurações).

### 5.5 Webhook — `src/app/api/webhooks/zapsign/route.ts`
1. Compara `x-riszon-webhook-secret` com `ZAPSIGN_WEBHOOK_SECRET` (resposta 401 sem log do corpo).
2. `parseWebhook`; ignora `sandbox: true` em produção e vice-versa.
3. Idempotência: `insert into signature_events (event_key …) on conflict do nothing` — repetido responde 200 e para.
4. Cliente admin (service role), tudo dentro de uma RPC `signature_apply_webhook(payload)` (security definer, `revoke` de anon/authenticated): atualiza signatário (`status`, `signed_at`), recalcula `status`/`current_stage` do pacote, grava `client_signed_at` quando o grupo 1 termina, dispara avisos internos de "é a sua vez" (testemunhas/representante), marca `completed_at`. `doc_refused` → `refused` + motivo; `doc_expired` → `expired` + aviso a quem enviou; `doc_deleted` → `cancelled` (só se não estava assinado).
5. Se `status = signed`: baixa `signed_file` **na hora** (expira em 60 min), grava `signed.pdf` em `signature-documents/{clinic}/{audience}/{package}/`, `signed_pdf_path`; se o download falhar, enfileira (`signature_events` tipo `pending_download`) para o cron hourly tentar com `getDocument()`.
6. Efeitos de negócio: selo do lead (`contract_signed_at`), `commercial_close_step('contract')`, cópia ao cliente pelo canal (e-mail se configurado; senão fica pendente com aviso a quem enviou).
7. Responde 200 sempre que o corpo foi aceito, mesmo que um efeito tenha falhado (fica registrado em `signature_events` com `error`), para a ZapSign não reenviar em laço.

### 5.6 Tempo real
`signature_packages` e `signature_signers` entram na publicação `supabase_realtime`; o detalhe do pacote e as listas assinam `postgres_changes` filtrado por `id`/`clinic_id` (RLS vale no Realtime) e chamam `router.refresh()`; fallback de 60 s quando a aba está visível (padrão da auditoria).

### 5.7 Rotinas
- **pg_cron diário (05:10)** `public.signature_daily_run()`: expira pacotes vencidos sem webhook; cria aviso de lembrete a quem enviou nos dias configurados (dedupe em `signature_reminders`); confere consumo do mês × limite e avisa Admin Masters em 80 % e 100 % (dedupe em `signature_plan_alerts`); grava o que precisa de e-mail em `signature_outbox`.
- **Vercel Cron horário** `/api/cron/signatures-hourly`: reconciliação (pacotes `sent`/`partially_signed` há mais de X h sem evento nas últimas Y h → `getDocument()` e aplica como se fosse webhook); downloads pendentes; envia a `signature_outbox` por e-mail.
- **Vercel Cron mensal** `/api/cron/signatures-monthly` (dia 1º, 06:00 BRT): gera o relatório do mês anterior (PDF + CSV) por destinatário configurado, envia por e-mail, registra em `signature_events`/`audit_logs`.

## 6. Modelo de dados (schema `public`, prefixo `signature_`, migrações do core a partir do **próximo número livre da faixa 0–999** (em 31/10/2026 a 0339 já está tomada por trabalho do core ainda não commitado — conferir `ls supabase/migrations` no início de cada fase))

Todas com `clinic_id`, RLS, `audit_attach_all()` (exceto registros técnicos, declarados em `audit_excluded_tables`) e nome em português em `src/lib/auditoria-catalogo.ts`. Dinheiro em centavos. Nenhuma tabela nova no schema `empresarial`: a ligação com a empresa é por coluna.

| Tabela | Para quê | Colunas principais |
|---|---|---|
| `signature_settings` | Parâmetros da rede (1 linha, `id boolean = true`) | `strong_auth_threshold_cents` (500000), `patient_expiry_days` (7), `company_expiry_days` (15), `reminder_days int[]` ({2,5}), `waiting_buckets_days int[]` ({2,5,7}), `default_message`, `zapsign_emails_enabled` (false), `zapsign_plan_name`, `zapsign_monthly_limit`, `zapsign_alert_percent` (80), `monthly_report_recipients jsonb`, `reconcile_after_hours` (6), `updated_by` |
| `signature_templates` | Modelos | `code` (único), `name`, `audience` (`patient`\|`company`), `kind` (`contract`\|`consent`\|`budget`\|`image_release`\|`adhesion`\|`other`), `body jsonb` (`{preamble, sections[{title, body}], closing}`), `variables text[]`, `auth_level` (`simple`\|`strong`\|`by_amount`), `witness_count` (0–2), `witness_mode` (`fixed`\|`choose_at_send`), `default_witness_staff_ids uuid[]`, `risarte_signer_mode`, `risarte_signer_role`, `risarte_signer_user_id`, `is_active`, `is_provisional_text`, `sort_order`, `updated_by`. O de adesão tem `body = null` e `source = 'empresarial_contract_templates'` (lê o texto da rede/empresa já existente). |
| `signature_kits` / `signature_kit_items` | Kits (começam vazios) | kit: `name`, `audience`, `is_active`; item: `kit_id`, `template_id`, `sort_order` |
| `signature_packages` | O envio (= 1 documento na ZapSign) | `clinic_id` (emissora), `issuer_cnpj`, `audience`, `origin_type` (`client`\|`plan_negotiation`\|`treatment_plan`\|`company`\|`company_document`\|`commercial_lead`), `origin_id`, `client_id`, `company_id`, `lead_id`, `company_document_id`, `zapsign_doc_token` (único), `zapsign_open_id`, `status` (`draft`\|`sent`\|`partially_signed`\|`signed`\|`refused`\|`expired`\|`cancelled`), `current_stage` (`client`\|`witnesses`\|`risarte`\|`done`), `linked_amount_cents`, `auth_level_applied`, `auth_reason`, `sent_at`, `client_signed_at`, `expires_at`, `completed_at`, `merged_pdf_path`, `signed_pdf_path`, `merged_page_count`, `sent_by`, `cancel_reason`, `cancelled_by`, `cancelled_at`, `refused_reason`, `resent_from_package_id`, `plan_month`, `cover_data jsonb`, `channel_used`, `number` (sequencial legível, ex. `ASS-000123`) |
| `signature_package_items` | Cada documento do pacote | `package_id`, `sort_order`, `template_id` (nulo = PDF avulso), `title`, `source_pdf_path`, `rendered_data jsonb` (snapshot dos valores — "qual versão foi assinada"), `first_page`, `last_page`, `origin_type`, `origin_id` |
| `signature_signers` | Signatários | `package_id`, `sort_order`, `order_group`, `signer_type` (`client`\|`legal_guardian`\|`company_representative`\|`witness`\|`risarte_representative`\|`other`), `name`, `cpf`, `email`, `phone`, `user_id`, `staff_member_id`, `zapsign_signer_token`, `sign_url`, `status` (`pending`\|`link_opened`\|`signed`\|`refused`), `signed_at`, `last_notified_at`, `auth_mode_applied` |
| `signature_events` | Log imutável | `package_id`, `event_type`, `event_key` (único — idempotência), `payload jsonb` (mínimo), `actor_user_id`, `error`, `created_at`. Gatilho recusa UPDATE/DELETE. Em `audit_excluded_tables`. |
| `signature_reminders`, `signature_plan_alerts`, `signature_outbox` | Dedupe de lembretes/alertas e fila de e-mail | registros técnicos (excluídos da auditoria) |

**Colunas novas fora do módulo:** `client_guardians.email` (migração da ZS1; e campo na tela de cadastro do responsável); `empresarial.commercial_leads.contract_package_id` e `empresarial.companies` nada (o pacote aponta para a empresa).

**Blindagens no banco:**
- Sem policy de DELETE em nenhuma tabela do módulo + gatilho `signature_packages_no_delete` (recusa sempre, inclusive com service role).
- Gatilho `signature_packages_guard_signed`: pacote `signed` só aceita UPDATE em `signed_pdf_path`/`completed_at`/colunas técnicas; nunca sai de `signed`.
- Storage: bucket privado `signature-documents` (limite 10 MB, só `application/pdf`); leitura por `public.signature_can_view_package(package_id)`; **sem** policy de DELETE/UPDATE para `authenticated`; gravação só pela chave de serviço (os PDFs nascem no servidor).
- Realtime respeita RLS.

**RLS (resumo):**
- SELECT em pacotes/itens/signatários/eventos: `signature_can('visualizar', clinic_id)` **e** (não é RisLife, ou `is_consultant_of_company/lead`). `painel_rede` libera todas as unidades; `painel_unidade` só as da pessoa.
- INSERT/UPDATE: pelo app via RPCs `security definer` que chamam `signature_can('enviar'/'cancelar', …)`; sem policy direta de escrita para `authenticated`.
- "Minhas assinaturas pendentes": policy adicional em `signature_signers` `user_id = auth.uid()` (vê só a própria linha + o pacote resumido via view `signature_my_pending`).

**Indicadores no banco** (tela e relatório leem a mesma função):
- View `signature_package_facts` (security invoker): uma linha por pacote com `client_response_hours`, `total_hours`, `waiting_days`, `waiting_on` (`client`\|`internal`), `near_expiry`, `bucket` conforme `waiting_buckets_days`.
- `signature_dashboard(p_from, p_to, p_clinic_ids, p_audience, p_template_id, p_sent_by, p_per_document bool)` → json (cartões, série, faixas, pendências, motivos de cancelamento, consumo).
- `signature_report_rows(mesmos filtros)` → linhas por pacote (e por item quando `p_per_document`).

## 7. Signatários, ordem, menor de idade, autenticação (regras puras, testadas)
- Ordem fixa: grupo 1 = cliente (paciente/responsável/representante da empresa + outros do lado do cliente, em paralelo); grupo 2 = testemunhas; grupo 3 = representantes da Risarte (todos, em paralelo). `signature_order_active: true`.
- Menor: `ehMenorDeIdade(birth_date, hoje)` → assina o responsável legal (`client_guardians`, nome do paciente no documento: `{{paciente_nome}}` + `{{responsavel_nome}}`); sem responsável → bloqueio com link "Cadastrar responsável".
- Autenticação: `simple` = `assinaturaTela`; `strong` = `assinaturaTela-tokenWhatsapp` (sem telefone → `assinaturaTela-tokenEmail`) + `require_selfie_photo: true`, `require_document_photo: false`. Testemunhas e Risarte: sempre `assinaturaTela` (a reforçada é do cliente). O modal mostra "Autenticação: reforçada (valor R$ 7.300,00 acima do corte)".
- Validações: CPF válido (dígitos verificadores), telefone **ou** e-mail; testemunhas com CPF e telefone/e-mail; `lock_name/cpf` ligados; `qualification` "Testemunha", "Representante da Risarte", "Responsável legal".

## 8. Permissões — matriz inicial (semeada) e papéis do código

| Capacidade | Padrão |
|---|---|
| `modulo.assinaturas` (menu "Assinaturas", painel) | commercial_consultant, rislife_consultant, commercial_assistant, finance_franchisor, unit_manager, clinical_coordinator |
| `acao.assinaturas.enviar` | commercial_consultant, rislife_consultant, commercial_assistant, finance_franchisor, unit_manager |
| `acao.assinaturas.cancelar` | os mesmos de enviar |
| `acao.assinaturas.visualizar` | os mesmos de baixar |
| `acao.assinaturas.baixar` | enviar + clinical_coordinator |
| `acao.assinaturas.painel_unidade` | os mesmos de enviar |
| `acao.assinaturas.painel_rede` | finance_franchisor (Admin Master pela flag) |
| `acao.assinaturas.configurar` | nenhum papel (só Admin Master pela flag; liberável no painel) |

Admin Master: tudo pela flag (a matriz não o limita). Titular (`is_owner`) idem. Consultor RisLife: além da matriz, a trava fixa por empresa/lead. Cada capacidade é uma linha no painel `/admin/permissoes` (aparece sozinha ao entrar em `CAPACIDADES`).

## 9. Indicadores — como cada um é calculado (por pacote; "por documento" soma os itens)
- **Enviados**: pacotes com `sent_at` no período (status ≠ draft).
- **Assinados**: `completed_at` no período (contagem por data de conclusão) — o relatório mostra também "enviados no período que já assinaram" como taxa.
- **Aguardando**: status `sent`/`partially_signed` **agora** (não depende do período) — separado por `waiting_on`: `client` (stage = client) × `internal` (witnesses/risarte).
- **Por faixa de tempo**: `waiting_days = hoje − sent_at` nas faixas de `waiting_buckets_days` (≤2, 3–5, 6–7, >7); `near_expiry` = `expires_at − hoje ≤ 1 dia`.
- **Tempo de resposta do cliente** (principal): `client_signed_at − sent_at`, média e mediana (`percentile_cont(0.5)`), em horas e dias, só pacotes com `client_signed_at` no período.
- **Tempo total**: `completed_at − sent_at`, média e mediana.
- **Recusados / expirados / cancelados**: por status e data do evento no período; cancelados agrupados por `cancel_reason`.
- **Taxa de assinatura**: assinados ÷ enviados, ambos pelos pacotes **enviados** no período (coorte), para não misturar meses.
- **Consumo do plano**: pacotes com `plan_month = mês` (todos os status, porque a ZapSign cobra na criação) × `zapsign_monthly_limit`.
- Filtros: período, unidade(s), público, modelo (pacote contém o modelo), quem enviou. Visão: franqueadora = rede + comparativo por unidade + linha "Franqueadora" (`clinic_id` = franqueadora); unidade = só a sua; RisLife = só os seus (RLS).

## 10. Telas (todas pt-BR, shadcn/Base UI, funcionam no celular)
- `/assinaturas` — painel (cartões, gráfico enviados × assinados, gráfico por faixa, tabela de pendências ordenada por espera; clique no número abre a lista; cartão do plano). `/assinaturas/pacotes?…` — lista filtrada. `/assinaturas/pacotes/[id]` — detalhe (etapa atual, signatários com status, visualizador, ações). `/assinaturas/minhas` — Minhas assinaturas pendentes. `/assinaturas/relatorios` — gerar PDF/CSV. `/assinaturas/configuracoes` (Admin Master) — parâmetros, modelos (editor de texto no formato do Empresarial, campos permitidos, testemunhas, representante), kits, plano, destinatários.
- Modal "Enviar para assinatura" (3 passos): 1) o que enviar (modelos/kit/PDFs + ordem); 2) dados e signatários (revisão, menor, testemunhas, representante, nível de autenticação, o que falta); 3) pré-visualização + canal + enviar → tela de links (WhatsApp, copiar, assinar agora).
- Botões "Enviar para assinatura": ficha do paciente (cabeçalho e aba Documentos), painel de fechamento (`/apresentacao/[clientId]`, ao lado de "Imprimir orçamento"), aba Plano, tela do contrato do funil, aba Contratos da empresa.
- Visualizador: componente `PdfViewer` (react-pdf/pdf.js, worker servido de `public/`), páginas, zoom, índice do pacote (pula para `first_page`), status dos signatários ao lado; URL assinada de 60 s obtida por Server Action que registra a visualização; sem botão de download para quem só visualiza.
- Status (badges, `src/lib/signatures/status.ts`): Rascunho (cinza), Enviado (azul), Parcialmente assinado (âmbar), Assinado (verde), Recusado (vermelho), Expirado (laranja), Cancelado (cinza escuro).
- Menu: item "Assinaturas" (`ASSINATURAS_ITEM`, prop `canViewAssinaturas` no layout), `NOME_DA_TELA`, `ajuda-das-telas.ts`, categoria de aviso por prefixo `/assinaturas`.

## 11. Fases (uma por sessão; cada uma termina com `npm run verificar`, `npm test`, `npm run lint`, `check-migrations`, `migrar:teste`, commit rotulado `feat(assinaturas): …`, `ESTADO_DO_PROJETO.md`, manual + `changelog.ts` quando a equipe percebe, bump de `APP_VERSION`/`LATEST_MIGRATION`)

| Fase | Entrega | Migrações | Arquivos principais |
|---|---|---|---|
| **ZS1** | Tabelas, RLS, `signature_can`, gatilhos de bloqueio, bucket, permissões no catálogo + semeadas, `signature_settings` + tela de configurações (parâmetros, plano, destinatários), cliente `lib/zapsign/` + testes, env sandbox, `proxy.ts` público para `/api/`, `vercel.json` | 2 migrações do core: módulo + `client_guardians.email` | `src/lib/zapsign/*`, `src/lib/permissions.ts`, `src/app/(app)/assinaturas/configuracoes/*`, `src/lib/auditoria-catalogo.ts`, `.env.example`, `docs/PRODUCAO-ONLINE.md` |
| **ZS2** | Modelos (5 iniciais, texto provisório) e kits; catálogo de variáveis; `@react-pdf/renderer` + `pdf-lib`; capa, mesclagem, bloco de assinatura, rubrica; fluxo de envio para pacientes (ficha, fechamento, plano); canais (link WhatsApp, copiar, assinar agora); `isValidCpf`; `src/lib/whatsapp.ts` | 1 migração do core (seed dos modelos) | `src/lib/signatures/*`, `src/lib/notify/*`, `src/app/(app)/assinaturas/enviar-dialog.tsx`, `actions.ts` |
| **ZS3** | Webhook + idempotência + RPC `signature_apply_webhook`; ordem; avisos internos; "Minhas assinaturas pendentes"; download do assinado para o Storage; cópia ao cliente (adaptador de e-mail Resend); Realtime; integração com `commercial_close_step`; retirada da Edge Function | 1 migração do core (RPC, publicação realtime, avisos) | `src/app/api/webhooks/zapsign/route.ts`, `src/app/(app)/assinaturas/minhas/*`, `src/lib/notify/email.ts` |
| **ZS4** | Bloco na aba Documentos; detalhe do pacote; `PdfViewer`; downloads (assinado + cópias); reenviar (link/WhatsApp/`resend-notifications-bulk` quando e-mail ligado); cancelar com motivo; reenviar expirado como novo pacote; auditoria de visualizar/baixar | — | `src/components/pdf-viewer.tsx`, `src/app/(app)/assinaturas/pacotes/[id]/*`, `prontuarios/[id]/documents-section.tsx` |
| **ZS5** | Empresarial: envio a partir do contrato do funil e da aba Contratos; modelo de adesão lendo `contract_templates`; responsável principal + CNPJ emissor escolhido entre `company_documents`; selo automático; `is_consultant_of_company/lead` + RLS do RisLife; pacotes assinados na aba Documentos da empresa; `empresarial.contracts` passa a espelhar o pacote (coluna `package_id`) | 1038 (Empresarial) | `src/app/(app)/empresarial/funil/[leadId]/contrato/*`, `[companyId]/contratos-tab.tsx`, `documentos-tab.tsx` |
| **ZS6** | pg_cron diário (expiração, lembretes como alerta, consumo 80 %/100 %); cron horário (reconciliação, downloads pendentes, outbox de e-mail); alerta de consumo por e-mail | 1 migração do core (rotina + cron) | `src/app/api/cron/signatures-hourly/route.ts` |
| **ZS7** | Painel `/assinaturas` (rede, unidade, RisLife), lista filtrada, pendências por espera, `signature_dashboard`/`signature_report_rows`, relatório PDF (react-pdf, identidade visual) e CSV/Excel (exceljs já existe), relatório mensal por e-mail (cron mensal), auditoria de relatório | 1 migração do core (views e funções) | `src/app/(app)/assinaturas/page.tsx`, `relatorios/*`, `src/app/api/cron/signatures-monthly/route.ts` |
| **ZS8** | Testes ponta a ponta no sandbox (webhooks simulados por script, ordem, menor, recusa, expiração, permissões por papel via `check:telas`), E2E Playwright do envio, checklist de produção, `CLAUDE.md` + `ESTADO_DO_PROJETO.md` + manual | — | `e2e/16-assinaturas.spec.ts`, `scripts/zapsign-simular-webhook.mjs`, `docs/assinaturas/CHECKLIST-PRODUCAO.md` |

## 12. Variáveis de ambiente e conta ZapSign (nomes, nunca valores)
| Variável | Onde | Observação |
|---|---|---|
| `ZAPSIGN_API_TOKEN` | Vercel (Secret) + `.env.local` | sandbox no dev/preview; produção só no projeto de produção |
| `ZAPSIGN_ENV` | Vercel | `sandbox` \| `production` |
| `ZAPSIGN_WEBHOOK_SECRET` | Vercel (Secret) | o mesmo valor cadastrado como header custom no webhook da ZapSign |
| `CRON_SECRET` | Vercel | a Vercel manda sozinha nos crons |
| `RESEND_API_KEY`, `EMAIL_FROM` | Vercel (Secret) | e-mail; sem a chave o sistema avisa que não envia |
| `NEXT_PUBLIC_APP_URL` | Vercel | para links nos e-mails (produção × treino) |

Na conta ZapSign (checklist ZS8): plano API; webhook cadastrado (URL + header secreto) para `doc_signed`, `doc_refused`, `doc_expired`, `doc_deleted`, `email_bounce`; "Bloquear assinatura fora da ordem" ligado; e-mails da ZapSign desligados por padrão (`disable_signer_emails`, controlado pela configuração); conta sandbox separada para o treino.

## 13. Verificação (como provar cada fase)
- Unitários (Vitest): regras puras (`signers`, `auth-level`, `validate`, `status`, `variables` × modelos semeados, `zapsign` com fetch falso, `webhook` parse/idempotência, `pdf` páginas/índice/coordenadas, matriz de permissões do módulo, `tela-segue-o-banco`).
- Migração: `node scripts/check-migrations.mjs <número da migração>` + `npm run migrar:teste` + provas em transação desfeita (RLS por papel, gatilho de não-exclusão, pacote assinado não cancela).
- Telas: `npm run check:telas` com os papéis (RisLife não abre pacote de empresa alheia; dentista/recepção não veem o módulo).
- Sandbox (ZS8): envio real com 1 cliente + 2 testemunhas + 1 representante; assinar na ordem; conferir webhook, download do assinado, cópia; recusa; expiração curta; `scripts/zapsign-simular-webhook.mjs` (POST com o segredo) para os eventos difíceis de provocar.
- E2E: `e2e/16-assinaturas.spec.ts` — abrir modal, validar menor sem responsável, enviar (ZapSign falsa via `ZAPSIGN_ENV=fake`), webhook simulado → status na tela.

## 14. Riscos e limites declarados
- Sem Chromium: layout dos modelos é o do react-pdf (texto corrido, tabelas simples) — suficiente para contratos; não reproduz as páginas HTML atuais pixel a pixel.
- `base64_pdf` de 10 MB → pacotes com muitos anexos escaneados podem passar; a tela avisa o tamanho antes de enviar.
- O visualizador "sem download" impede o botão, não o navegador (quem tem a URL por 60 s consegue salvar). Limite aceito; o registro de visualização fica na auditoria.
- E-mail da cópia ao cliente depende do Resend configurado; até lá o pacote assinado mostra "cópia não enviada — reenviar pelo WhatsApp".
- Vercel Cron depende do plano Pro; sem ele, o horário cai para diário.
- Ordem só é obrigatória com a preferência ligada na conta ZapSign (não há campo na API).

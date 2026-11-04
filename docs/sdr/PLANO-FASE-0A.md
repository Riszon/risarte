# Plano 2 — Fase 0A da Rita: base de dados e segurança

_Proposta de 03/11/2026, para aprovação. Sem código escrito. Base: `SDR_KICKOFF.md`, `docs/sdr/LEVANTAMENTO_DADOS_RITA_RESULTADO.md` e `docs/sdr/DECISOES_RITA.md` (§1, §3). Escopo da 0A, como decidido: identidade da Rita (opção iii), `rita_settings` (interruptor, modo, portão), consentimento e opt-out, dados públicos das unidades, dados da avaliação, rotas de escalonamento, `_rita_notify`, tela "O que a Rita sabe". **Nenhum canal de WhatsApp nesta fase** (é a 0B)._

---

## 0. Os números das seis consultas (03/11/2026, só contagens, API com chave de serviço)

| # | Pergunta | Produção | Treino |
|---|---|---|---|
| 1 | Unidades ativas (`franchise_unit`) · com endereço+CEP · com telefone | 2 · 2 · 2 | 4 · 0 · 0 |
| 2 | `clinic_agenda_settings`: linhas de unidade · linha da rede | 2 · 1 | 4 · 1 |
| 3 | Procedimento `AVAL` do seed: total · ativos (catálogo inteiro) | 0 · 0 (375) | 0 · 0 (379) |
| 4 | Indicações por status · registrada/validada sem aceite e sem cadastro | nenhuma (0) · 0 | registrada 10, validada 1, recusada 8 (19) · 2 |
| 5 | Empresas ACTIVE · titulares ativos · sem contato de boas-vindas | 1 · 6 · 6 | 11 · 12 · 9 |
| 6 | Clientes não anonimizados · com telefone · com 10 ou 11 dígitos | 1 · 1 · 1 | 77 · 76 · 76 |

O que isso muda no plano:

- **O seed `AVAL` não existe em nenhum banco** (B5 confirmado): a avaliação como procedimento oficial nasce do zero, sem conflito de código ou nome.
- **A produção está quase vazia** (1 cliente, 0 indicações, 1 empresa com 6 titulares): toda migração da 0A entra sem dado legado a tratar. O treino tem o suficiente para ensaiar o portão (4 unidades, nenhuma com endereço nem telefone: a tela "O que a Rita sabe" vai nascer mostrando lacunas de verdade).
- **As duas unidades da produção já têm linha própria de agenda** (horário configurado): o AP98 (almoço da rede não herdado) as afeta se o almoço estiver só na linha da rede.
- Telefones dos clientes estão todos com DDD (10 ou 11 dígitos): a coluna `phone_e164` gerada (Fase 1) não vai encontrar lixo.
- Os 6 titulares da produção ainda não foram contatados: é a primeira lista real da Rita quando a 3.4 do kickoff chegar.

---

## 1. Decisões de arquitetura que precisam do seu OK antes de começar

| # | Decisão | Proposta | Por quê |
|---|---|---|---|
| **DA1** | Faixa de migração e schema | Schema **`rita`**, migrações **3000+**, versão própria `RITA_VERSION`/`RITA_MIGRATION` em `src/lib/version.ts`, estado em `docs/sdr/ESTADO.md` | É o mesmo desenho do Indica (schema `indica`, 2000+). Evita colidir com core/Empresarial/Indica e isola RLS e grants. O que é dado da **unidade** (endereço público, horário por dia, feriados, avaliação) fica no `public`, porque é do core e outras telas vão ler. |
| **DA2** | A identidade da Rita | Um usuário técnico no `auth.users` (**sem senha e com login bloqueado**, `banned_until = 'infinity'`), com `profiles.full_name = 'Rita (assistente virtual)'`, coluna nova `profiles.kind` (`person` / `agent`) para as listas de pessoas o esconderem, **sem nenhuma linha em `user_clinic_roles_all`** (zero direito por RLS). Ele é só **autor**: aparece em `created_by`, `registrado_por`, `contacted_by`, na linha do tempo e na auditoria. Toda escrita da Rita entra por funções `rita.*` `security definer` chamadas com a chave de serviço, que carregam esse id como autor. | `profiles.id` referencia `auth.users(id)`: não existe perfil sem usuário. Sem papel, a conta não passa em policy nenhuma, então mesmo um JWT dela não leria nada. A opção (i) do levantamento (papel `sdr_agent` + JWT) fica descartada. |
| **DA3** | Auditoria com autora nominal | `audit_capture` (0288) passa a ler `current_setting('rita.actor', true)`: quando preenchido, `actor = 'assistente'` (valor novo no check) e `user_id` = o perfil da Rita. Toda função `rita.*` faz `set_config('rita.actor', <id>, true)` no início da transação. A tela de Auditoria traduz como "Rita (assistente virtual)". | É a única forma de a trilha 0288 não dizer "Sistema (em nome de alguém)". Mexe numa função do core → migração core 0351+. |
| **DA4** | Onde a Rita escreve e lê | **Nunca em tabela direta.** Só por funções `rita.*` (escrita) e views `rita.v_*` (leitura), todas com `revoke … from public, anon, authenticated` e `grant … to service_role`. Cada função confere `rita.enabled(unidade)` antes de agir. | Regra 7 do `check-migrations`; padrão do Indica público e da ZapSign. É o que torna a chave de serviço aceitável: ela só alcança o que as funções permitem. |
| **DA5** | Quem edita os dados que a Rita usa | Admin Master (rede e unidade) e `unit_manager` (só a própria unidade), pela policy já usada em `clinic_agenda_settings` (0044:55-70). Todas as tabelas de configuração entram na auditoria 0288. Tabelas de registro (`rita.actions`, `rita.notices`) entram em `audit_excluded_tables`. | Proteção 2 do kickoff. |
| **DA6** | Ligar e desligar | Ligar: só Admin Master, e só se o portão estiver completo. Desligar (pânico): Admin Master ou `unit_manager` da unidade, a qualquer hora. Unidade não liga com a rede desligada. Se um campo essencial for apagado depois, a Rita pausa sozinha naquela unidade (gatilho) e avisa Gerente + Admin. | Decisão 3 e proteção 3 do kickoff. |
| **DA7** | Tela "O que a Rita sabe" | Rota **`/rita`** (módulo próprio, `src/app/(app)/rita/`, capacidade `modulo.rita` na matriz: Admin, `unit_manager`, `franchisor_staff` em leitura), com uma página por unidade. Em 0A ela só **mostra** (o que a Rita vai informar, as lacunas, a data da última alteração de cada item) e tem o interruptor. "Testar pergunta" fica para a Fase 1 (precisa do modelo). | Proteção 4 do kickoff. Montada pelas **mesmas views** `rita.v_*` que a Rita vai usar, para a tela nunca mostrar o que a Rita não lê. |

---

## 2. Entregas, na ordem (cada uma é uma sessão, um commit e uma migração)

### 0A.1 — Identidade e auditoria (core **0351** + primeiro passo do schema `rita`, **3000**)

> ✅ **Feita em 04/11/2026 como core 0365 + rita 3000** (core 0.397.0, Rita
> 0.1.0). Duas diferenças do texto abaixo: o usuário técnico nasce por
> `scripts/rita-criar-identidade.mjs` em cada banco (o espelho só copia
> Risartanos), e o id dela é lido por `rita.agent_id()` (perfil `agent`, um por
> banco), não guardado em `rita.settings`. Detalhe em `docs/sdr/ESTADO.md`.

- 0351 (core): `profiles.kind` (`person` default, `agent`); `audit_capture` lê `rita.actor`; check de `actor` ganha `'assistente'`; `auditoria-alteracoes.ts` e a tela traduzem.
- 3000 (rita): `create schema rita`; `grant usage to service_role` (e a `authenticated` só para as views da tela); tabela `rita.settings` nasce vazia aqui? **Não** — fica na 0A.2 para a migração ser pequena e provável.
- Criar o usuário técnico **na produção** pelo Admin (API de auth com a chave de serviço, como `check-screens` faz para o link de uso único; sem senha; `banned_until = infinity`) e deixar o espelho (0260) copiá-lo para o treino. O id fica em `rita.settings` da rede (0A.2), **não** em variável de ambiente.
- **Prova:** transação desfeita no treino: `set_config('rita.actor', <id>)` + update em `clinics` → `audit_changes.actor = 'assistente'` e `user_id` = o perfil; sem o `set_config`, continua `servico`. De fora: `rita.*` recusa sem login.
- **Mexe em arquivo do core** (`audit_capture`, `profiles`): avisar no ESTADO do core e rotular `feat(rita)` + `chore(core)` separados? Não: uma migração só não se divide. Commit único `feat(rita): 0A.1`, com a linha no ESTADO do core dizendo o que mudou lá.

### 0A.2 — Interruptor, modo e portão (**3001**)

> ✅ **Feita em 04/11/2026 (Rita 0.2.0).** Diferenças: os itens do portão que
> dependem das entregas 0A.4–0A.6 ficam como **pendentes** (`rita._pending_items`)
> até cada uma; a pausa automática hoje vigia `clinics`,
> `clinic_agenda_settings`, `user_clinic_roles_all` e `profiles` (as demais
> tabelas entram com as entregas que as criam); o aviso da pausa vem na 0A.6.
> Também `rita.set_mode` e `rita.effective_mode`. Detalhe em `docs/sdr/ESTADO.md`.

- `rita.settings` em cascata (`clinic_id null` = rede; `unique nulls not distinct`): `enabled bool default false`, `mode` (`off` / `sombra` / `ativo`, default `sombra`), `activated_by`, `activated_at`, `paused_at`, `paused_reason`, `paused_by`, `agent_profile_id` (só na linha da rede), `after_hours_urgent_message text` (decisão 28, texto do RT), `privacy_policy_url`, `dpo_name`, `dpo_email`, `dpo_phone` (rede; ❓ decisão 30 ainda aberta — ficam vazios).
- `rita.enabled(p_clinic) returns boolean` = rede ligada **e** unidade ligada **e** `mode <> 'off'`.
- `rita.activation_gaps(p_clinic) returns table(item, ok, detalhe)`: a lista do portão (kickoff, proteção 3): endereço, link do Maps, horário por dia, dias/horários de avaliação (0A: "há coordenador com agenda na unidade"), duração, valor ou gratuidade, "o que a avaliação inclui", responsável pelas transferências em horário comercial. É a mesma função que a tela usa.
- `rita.set_enabled(p_clinic, p_enabled, p_reason)` `security definer` com guarda **por pessoa** (esta função é chamada pela tela, logada): ligar exige `is_admin_master()` e `activation_gaps` vazio; desligar aceita `is_admin_master()` ou `has_role_in_clinic(p_clinic, '{unit_manager}')`. Grava `activated_*`/`paused_*` e um aviso (0A.6).
- Gatilho de **pausa automática**: em `clinics`, `clinic_public_info`, `clinic_weekday_hours`, `clinic_agenda_settings`, `patient_texts` e `rita.escalation_routes`, after update/delete → se `activation_gaps` deixou de ser vazio e a unidade estava ligada, `enabled=false`, `paused_reason='campo essencial apagado: …'` e aviso a Gerente + Admin. Blindado (`exception when others` → `rita.falhas`), como os gatilhos do Indica.
- **Prova:** ligar com lacuna → recusa com a lista; ligar completo → ok; apagar o Maps → pausa sozinha com o motivo; `unit_manager` de outra unidade não desliga; sem login, nada.

### 0A.3 — Consentimento de contato e opt-out (**3002**)

- `rita.contact_consents`: `phone_e164 text not null`, `person_kind` (`client` / `guardian` / `lead` / `employee` / `dependent`), `person_id uuid`, `channel` (`whatsapp`), `purpose` (`contato` / `marketing`), `text_version text`, `granted_at`, `granted_via` (`whatsapp` / `presencial` / `telefone` / `evento` / `importacao` / `portal`), `evidence jsonb` (id da mensagem, arquivo da lista, quem registrou), `revoked_at`, `revoked_via`, `registered_by → profiles`. Índice por `phone_e164`. Auditada.
- `rita.opt_outs`: `phone_e164 pk`, `opted_out_at`, `via`, `note`, `registered_by`. **Nunca se apaga**; voltar atrás é linha nova em `contact_consents` com data posterior. Auditada.
- Funções (`security definer`, grant `service_role`; e uma versão para a tela, logada, com guarda de unidade): `rita.register_consent(...)`, `rita.revoke_consent(...)`, `rita.register_opt_out(phone, via, note)`, `rita.can_contact(phone_e164, purpose) returns (allowed bool, reason text)` — devolve `false` para opt-out vigente, sem consentimento, ou (decisão 18) telefone com recusa "não quero contato" no Indica.
- **Integração com o Indica (decisão 17/18):** `rita.can_contact` consulta `indica.consentimentos` (aceite do indicado conta como consentimento de contato daquele telefone) e as indicações `recusada` com motivo padrão "não quis contato" (bloqueio). Isso é **leitura**; nada muda no Indica aqui.
- **Normalização:** `rita.phone_e164(text)` (imutável): só dígitos, 55 na frente, 10 ou 11 dígitos depois do DDI; recusa o resto. Vai ser reaproveitada na Fase 1 para `clients.phone_e164`.
- ❓ **Decisão 30 (aberta):** a `text_version` do consentimento fica obrigatória, mas o texto em si (com o DPO) ainda não existe — a tabela nasce com `text_version` livre e a Rita não grava consentimento novo até o texto ser aprovado.
- **Prova:** `test:rita` (novo, no molde do `test:indica`): opt-out bloqueia; consentimento posterior reabre; aceite do Indica conta; telefone sem DDD é recusado pela normalização.

### 0A.4 — Dados públicos da unidade, horário por dia e feriados (core **0352**)

Tudo no `public`, porque é dado da unidade que outras telas vão ler.

- `clinic_public_info (clinic_id pk, landmark, maps_url, parking, accessibility, whatsapp_e164, public_name, min_child_age smallint, updated_at, updated_by)` — `min_child_age` é a decisão 41 (idade mínima varia por unidade; vazio = a Rita não promete e escala); `clinic_service_areas (clinic_id, city, state, neighborhood)`. Leitura `using (true)` a `authenticated` (como `clinics`); escrita Admin + `unit_manager` da unidade. Auditadas.
- `clinic_weekday_hours (clinic_id null | uuid, weekday 0-6, open_time, close_time, lunch_start, lunch_end, closed bool)`, `unique nulls not distinct (clinic_id, weekday)`. Semente: a rede copia o `open_time/close_time/weekdays/lunch_*` da linha da rede de `clinic_agenda_settings` para os 7 dias; cada unidade com linha própria ganha as suas 7. ❓ **Decisão DA8:** a agenda (`resolveAgendaSettings`, `getNextAvailableSlots`) passa a ler a tabela nova **já na 0A** ou **só na Fase 1**? Proposta: **Fase 1**, junto com a RPC de horários livres, para a 0A não mexer na agenda da equipe; na 0A só a Rita e a tela leem. O AP98 (almoço por linha inteira) se resolve na mesma passagem.
- `holidays (date, name, scope national|state|city, state, city)`: semeada com os 12 nacionais de `src/lib/holidays.ts` para os próximos 3 anos (função pura reaproveitada para gerar a semente), e editável por Admin (rede) e `unit_manager` (estadual/municipal da sua unidade, decisão 9). `clinic_holiday_decisions` continua; **para a Rita, feriado sem decisão = fechado** (decisão 9) — regra na view `rita.v_unit_calendar`, não na agenda da equipe (que continua "sem decisão = aberto" até o dono mandar mudar).
- Telas: a janela da unidade (`admin/clinicas/clinic-form-dialog.tsx`) ganha a aba "Dados públicos" (Admin) e a Configuração da agenda ganha "Horário por dia" e "Feriados da unidade" (Gerente). ⚠️ **A sessão da razão social (AP96, 0350) está mexendo nessa janela agora**: a 0A.4 espera ela terminar.
- **Prova:** `check:telas` (janela em toda rota de Admin); `activation_gaps` passa a enxergar os campos; treino: as 4 unidades sem endereço aparecem com lacuna.

### 0A.5 — A avaliação como dado (core **035x** + rita **3003**) — _revisada em 03/11/2026 à noite (decisões 38–42)_

- **Nenhum procedimento novo** (decisão 38): o catálogo já tem, nos dois bancos, **"Consulta odontológica inicial"** (R$ 300,00) = avaliação de quem é novo, e **"Consulta odontológica"** (R$ 300,00) = consulta de quem já é cliente; as duas "de Urgência" (R$ 0,00) a Rita reconhece e escala. A migração acrescenta `procedures.rita_role` (`evaluation_new` / `evaluation_returning` / `urgency` / `null`), com índice único parcial por papel, e **marca os quatro pelo `code`/nome** (idempotente; se o nome não casar, falha alto em vez de marcar errado). O preço é o deles: `default_price_cents` e `clinic_procedure_prices` (hoje **nenhum** preço por unidade cadastrado nos dois bancos). Os benefícios por procedimento do Empresarial e do PPR+ já os alcançam.
- **Rol da Rita** (decisão 39): `procedures.rita_can_offer boolean default false` (**só o Admin Master marca**, na tela de Procedimentos) e `procedures.patient_name text` (nome amigável). A Rita só informa o que está no rol; preço de tratamento, nunca.
- **Oferta por unidade** (decisão 40, subiu da Fase 1): `clinic_procedure_availability (clinic_id, procedure_id, offered bool default false, note, updated_by)`; **sem linha = a unidade oferece**; o Gerente marca o que a unidade não faz. View `rita.v_catalog(p_clinic)` = rol ∩ oferta da unidade, com `patient_name`.
- `clinic_agenda_settings.evaluation_minutes integer default 60` (cascata já existente; decisão 7).
- `patient_texts (key, clinic_id null|uuid, content, status draft|approved, approved_by, approved_at, version)` para `evaluation_includes` e `evaluation_bring` (B7/B8) — aprovação do Admin Master (decisão 29). Cascata rede→unidade.
- **Campanhas de isenção** (decisão 5): `rita.evaluation_fee_campaigns (clinic_ids uuid[] | null = rede, title, approved_text, starts_on, ends_on, status draft|active|ended, approved_by, approved_at, created_by)`; só Admin aprova; `rita.v_evaluation_fee(p_clinic)` devolve preço, gratuidades por origem (Indica: sempre; Empresarial: por `procedure_benefits` do procedimento Avaliação; PPR+: `ppr_plan_benefits`) e a campanha ativa, se houver. A Rita **só informa**; nunca isenta.
- ✅ **DA9 (aprovada):** o valor por unidade é editado em **Procedimentos → preço da unidade** (`setUnitPrice`, já existe); a tela "O que a Rita sabe" mostra o valor e um link para lá.
- **Políticas padrão** (decisão 42): `patient_texts` nasce com `late_tolerance` ("15 minutos"), `reschedule_policy` (a qualquer hora pela Rita), `no_show_policy` (não bloqueia; a Rita oferece reagendar uma vez) e `minors_policy` (só com o responsável), todos `status = 'approved'` pelo Admin, editáveis na tela.
- **Prova:** preço da unidade de teste = R$ X → `v_evaluation_fee` devolve X; campanha ativa → aparece; vencida → some; `activation_gaps` acusa preço zero sem campanha como lacuna.

### 0A.6 — Escalonamento, avisos e o registro da Rita (rita **3004**)

- `rita.escalation_routes (clinic_id null|uuid, business_hours_roles user_role[] default '{receptionist}', sla_alert_roles user_role[] default '{unit_manager}', sla_escalate_to_admin_after_minutes int, fallback_profile_id)` — decisão 28: **fora do horário não há rota**: a mensagem de urgência (0A.2) vai ao paciente e o pedido fica na fila para a abertura; por isso não há `after_hours_roles`.
- `rita.notices (clinic_id, kind, dedupe_key, created_at)` + `rita._notify(p_clinic, p_roles user_role[], p_title, p_body, p_link, p_dedupe_key)` (interna, `revoke … from public, anon, authenticated`): resolve destinatários por `user_clinic_roles_all` + `profiles.is_active` (molde `_ortho_recipients`, 0336), insere em `public.notifications` uma linha por pessoa, título "Rita: …", link `/rita/...`; `src/lib/notifications.ts` ganha a categoria `rita` pelo link.
- `rita.actions (id, clinic_id, kind, subject_kind, subject_id, summary, payload jsonb, created_at)` **append-only** (gatilho que recusa update/delete, como `indicacao_eventos`), fora da auditoria 0288 ("registro técnico"). Toda função `rita.*` de escrita grava aqui. É o `log_interaction` do kickoff, sem o conteúdo das mensagens (isso é da 0B).
- `rita.falhas` (molde `indica.falhas_automacao`) para os gatilhos blindados.
- **Prova:** `_notify` para `{unit_manager}` da unidade de teste cria N linhas (N = gerentes ativos), repetir com a mesma `dedupe_key` não cria; sem login, recusa; `rita.actions` não aceita update.

### 0A.7 — Tela "O que a Rita sabe" (sem migração; permissão semeada na 3004)

- `src/app/(app)/rita/page.tsx` (lista de unidades com o estado: desligada / pronta para ligar / ligada / pausada) e `rita/[clinicId]/page.tsx`: cartões por tema (Unidade, Horários e feriados, Avaliação, Consentimento, Escalonamento), cada item com o valor que a Rita vai dizer, **a lacuna em destaque** e "alterado em … por …" (lido de `audit_changes` pela porta `rita.v_last_change(table, row)`, só Admin; para o Gerente, `updated_at`). Interruptor com a regra DA6 e o motivo da pausa.
- Capacidade `modulo.rita` em `permissions.ts` (padrão: Admin passa sempre; `unit_manager` e `franchisor_staff`), semeada na 3004; `NOME_DA_TELA` (régua "tela nova precisa de nome"); `ajuda-das-telas.ts` com os passos; `ESTADO`/manual/changelog.
- **Prova:** `check:telas` (Admin na Franqueadora e na unidade, Gerente, Recepção barrada); tela aberta no treino mostrando as lacunas reais das 4 unidades.

---

## 3. O que fica explicitamente fora da 0A

Canal e envio (webhook da Meta, `rita_outbox`/`rita_inbox`, `RITA_MODE`, segredos): **0B**. RPCs de leitura para o agente (horários livres, status do cliente, campos faltantes, fila do Indica, elegibilidade do Empresarial, benefícios), FAQ, termos proibidos, templates, janelas de envio, pré-cadastro (decisão 12), canais de origem (decisão 14), parcerias por unidade (decisão 31): **Fase 1**, cada uma com migração própria. Dependente sem CPF (decisão 27) e situação de contato ampliada (F6): **Fase 2 / 3B**, no Empresarial.

---

## 4. Riscos e dependências

1. **Arquivos compartilhados do core** tocados pela 0A: `audit_capture` (0288), `profiles`, `clinics` (janela), `clinic_agenda_settings`, `procedures`, `permissions.ts`, `notifications.ts`, `version.ts`, `app-sidebar.tsx`. Regra 5 do CLAUDE.md: mudanças mínimas e aditivas, uma linha no ESTADO do core por migração do core.
2. **Sessão paralela da razão social (0350, uncommitted hoje)**: a 0A.4 edita a mesma janela de unidade. A 0A.4 só começa depois do commit dela, e a numeração do core (0351+) é conferida na hora.
3. **Espelho do treino (0260)**: `profiles` e `user_clinic_roles` são cópia da produção; o usuário técnico da Rita nasce na produção e viaja; a trava do espelho recusa criá-lo direto no treino. Até a cópia rodar, a 0A.1 no treino usa um perfil de teste `@example.com` como autora.
4. **`audit_capture` é um gatilho em 195 tabelas**: a mudança da 0A.1 precisa ser provada em transação desfeita e com a regra "nunca derruba a operação" intacta (todo erro vira `raise warning`).
5. **Portão de entrega por sessão**: `check-migrations`, `migrar:teste`, `npm run verificar`, `npm test`, `npm run lint`, `check:telas` (0A.4 e 0A.7 mexem em tela montada em toda rota de Admin), `test:indica` (0A.3 lê o Indica; 0A.5 toca `procedures`, que os gatilhos do Indica não usam, mas a régua roda igual).
6. **Nada da 0A envia mensagem nem lê prontuário**: a Rita não existe como processo ainda; a chave de serviço só passa a ser usada por um processo na 0B.

---

## 5. Perguntas novas que a 0A levanta (além das DA1–DA9)

1. Quem aprova o texto de `patient_texts` e as campanhas de isenção: só Admin Master (decisão 29) ou o Gerente propõe e o Admin aprova (fluxo `draft → approved`)? Proposta: Gerente propõe, Admin aprova.
2. A unidade pode ter área atendida (`clinic_service_areas`) vazia e mesmo assim ligar a Rita? Proposta: **sim** (não é essencial no portão; sem área, a regra "fora da região" do score não desconta).
3. O usuário técnico da Rita precisa de e-mail real? Proposta: `rita@risarte.local` (o `handle_new_user` copia para `profiles.email`; nenhum e-mail é enviado).

---

## 6. Ordem, sessões e o que você verá

| Entrega | Migrações | O que aparece na tela | Decisões necessárias antes |
|---|---|---|---|
| 0A.1 Identidade e auditoria | 0351, 3000 | Auditoria mostra "Rita (assistente virtual)" quando houver gravação dela (ainda não há) | DA1, DA2, DA3 |
| 0A.2 Interruptor e portão | 3001 | nada ainda (funções) | DA4, DA5, DA6 |
| 0A.3 Consentimento e opt-out | 3002 | nada ainda | — (30 aberta) |
| 0A.4 Unidade, horários, feriados | 0352 | aba "Dados públicos" na unidade; "Horário por dia" e "Feriados" na agenda | DA8; esperar a 0350 |
| 0A.5 Avaliação | 035x, 3003 | marcas nas consultas do catálogo; rol da Rita e nome amigável; oferta por unidade; textos e políticas; campanhas de isenção | — (DA9 e decisões 38–42 fechadas) |
| 0A.6 Escalonamento e avisos | 3004 | avisos "Rita: …" no sino | — |
| 0A.7 "O que a Rita sabe" | — | módulo **Rita** no menu (Admin, Gerente, Rede) | DA7 |

Sete sessões curtas, cada uma com migração aplicada no treino, provada em transação desfeita, e o dono rodando na produção antes do push quando a assinatura de algo que o app lê mudar (0A.1 e 0A.4). Ao fim da 0A, o portão de ativação de uma unidade pode ser preenchido e a tela mostra o que falta; a Rita ainda não fala com ninguém.

**O que peço para aprovar:** DA1 a DA9 e a ordem acima. Com o OK, a primeira sessão é a 0A.1.

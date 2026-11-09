# Estado da Rita — assistente virtual de SDR

Documento de quem constrói a Rita (decisão DA1 do `PLANO-FASE-0A.md`).
O produto e as decisões do dono ficam em `DECISOES_RITA.md`; o plano, em
`PLANO-FASE-0A.md`; o que os dados do riSZon têm ou não têm, em
`LEVANTAMENTO_DADOS_RITA_RESULTADO.md`.

- **Schema:** `rita` · **Migrações:** faixa **3000+** ·
  **Versão:** `RITA_VERSION` / `RITA_MIGRATION` em `src/lib/version.ts`.
- **A Rita ainda não fala com ninguém.** A Fase 0A prepara os dados; o canal
  (WhatsApp) é a 0B.

## Onde estamos

| Entrega | Situação | Migrações |
|---|---|---|
| Plano 1 (correções da seção 2, itens 1–7) | ✅ concluído em 04/11/2026 | 0362–0364, 2009–2010, sem migração no item 1 e no 6 |
| **0A.1 Identidade e auditoria** | ✅ concluída: código, treino e produção (04/11/2026) | core **0365**, rita **3000** |
| **0A.2 Interruptor, modo e portão** | ✅ concluída: código, treino e produção (04/11/2026) | **3001** |
| **0A.3 Consentimento e descadastro** | ✅ concluída: código, treino e produção (09/11/2026) | **3002** |
| **0A.4 Unidade, horários, feriados** | ✅ no código e no treino; ⏳ produção com o dono | core **0368**, rita **3003** |
| 0A.5 Avaliação como dado | próxima | core 036x + 3004 |
| 0A.6 Escalonamento e avisos | — | 3004 |
| 0A.7 "O que a Rita sabe" | — | — |

## 0A.1 — Identidade e auditoria (Rita 0.1.0, 04/11/2026)

**Quem é a Rita no banco.** Um login técnico `rita@risarte.local`, **sem
senha e com o login bloqueado**, cujo perfil é `full_name = 'Rita (assistente
virtual)'` e `kind = 'agent'`. Nenhuma linha em `user_clinic_roles_all`: pela
regra de linha ela não lê nada. Ela é só **autora**.

- Criada por `scripts/rita-criar-identidade.mjs` (exige `--confirmar`; sem ele,
  só diz o que faria; rodar de novo só confere). **Uma por banco**, cada uma
  com o seu id: o espelho do treino (0260) só copia Risartanos, não a Rita.
- Treino (`bsnptybalszjjbhxeejo`): criada em 04/11/2026.
- Produção (`hvhbijctanrrkxhemlza`): criada pelo dono em 04/11/2026, depois da
  0365 e da 3000 (conferências 1·1·true·true·0 e 1·2·0).

**Como ela vira autora.** Toda função `rita.*` que gravar começa por
`rita.begin_as_agent()`: ela faz `set_config('rita.actor', <id>, true)` e a
auditoria (`public.audit_capture`, 0365) registra `actor = 'assistente'` e
`user_id` = a Rita. Regras da captura:

1. Pessoa logada é sempre ela mesma — `rita.actor` é ignorado.
2. Só vale o id de um perfil `kind = 'agent'`; qualquer outro valor é ignorado
   (cai em `servico`/`sistema`).
3. A auditoria continua sem derrubar a operação.

**Travas.** `rita.*` fechado a `anon` e `authenticated` (schema e funções);
`begin_as_agent` recusa pessoa logada (`NOT_ALLOWED`) e recusa sem a Rita
criada (`RITA_AGENT_MISSING`). `profiles.kind` só muda pela chave de serviço
(`PROFILE_KIND_LOCKED`); uma assistente por banco (`profiles_one_agent`).

**Na tela.** Auditoria: "Rita (assistente virtual)" (`quemFez`,
`NOME_DA_ASSISTENTE`). Risartanos (logins sem cadastro) e a contagem do Chat
a escondem.

**Provas.** Treino, transação desfeita, 12/12 (roteiro na pasta temporária da
sessão, descrito no ESTADO do core, bloco 0.397.0). Quebrando: sem a conferência
do tipo `agent`, a conferência 3 reprova. Régua `rita-identidade.test.ts` (8
testes) provada quebrando 3 vezes (tipo, tela, permissão).

**Diferenças em relação ao plano.** Os números mudaram (o plano dizia 0351; o
core já estava na 0364). O id da Rita **não** foi para `rita.settings` (0A.2):
`rita.agent_id()` lê o perfil `agent`, e a unicidade é do índice.

## 0A.2 — Interruptor, modo e portão (Rita 0.2.0, 04/11/2026)

**`rita.settings`**, em cascata: a linha da **rede** (`clinic_id` nulo, nasce
desligada) e uma por unidade (nasce quando alguém liga ou desliga). `enabled`
(padrão desligado) e `mode`: `off`, `sombra` (padrão: a Rita prepara, uma
pessoa envia) ou `ativo`. Campos da rede ainda vazios: mensagem de urgência
fora do horário (decisão 28), política de privacidade e encarregado de dados
(decisão 30, aberta). Tabela sem permissão para quem loga; só pelas funções.

| Função | Quem chama | O que faz |
|---|---|---|
| `rita.enabled(unidade)` | só a chave de serviço | rede ligada E unidade ligada E nenhuma em `off` |
| `rita.effective_mode(unidade)` | só a chave de serviço | `off`, `sombra` ou `ativo` — o mais cauteloso entre rede e unidade |
| `rita.activation_gaps(unidade)` | tela (Admin, ou quem tem a unidade no escopo) e chave | o portão, item a item: `ordem, item, rotulo, ok, detalhe` |
| `rita.set_enabled(unidade, ligar, motivo)` | tela, pessoa logada | ligar: só Admin Master, rede ligada (`NETWORK_OFF`), portão completo (`ACTIVATION_GAPS:<itens>`). Desligar: Admin Master ou Gerente da unidade. Unidade nula = a rede (só Admin) |
| `rita.set_mode(unidade, modo)` | tela, só Admin Master | muda o modo (`INVALID_INPUT` se não for um dos três) |
| `rita._pause_if_gaps(unidade, origem)` | gatilhos e chave de serviço | pausa a unidade ligada cujo portão deixou de estar completo |

**O portão** (`rita._gaps`). Conferidos de verdade desde já: a Rita existe,
unidade ativa (não a Franqueadora), endereço completo, agenda configurada
(abertura, fechamento, dias) e um Coordenador clínico ativo. **Pendentes**
(`rita._pending_items`, sempre `ok = false`): link do Maps e horário por dia
(0A.4), duração/valor e "o que inclui" da avaliação (0A.5), quem recebe as
transferências (0A.6). **Enquanto houver pendente, nenhuma unidade liga.**
Cada entrega recria `_pending_items` sem o item dela e põe a conferência real
em `_gaps`.

**Pausa automática.** Gatilho `rita_recheck` em `clinics`,
`clinic_agenda_settings` e `user_clinic_roles_all` (depois de alterar ou
apagar) e `rita_recheck_profile` em `profiles` (pessoa desativada que
coordena): unidade ligada com o portão incompleto desliga sozinha,
`paused_by` nulo e `paused_reason = 'Pausada sozinha (<tabela>). Falta: …'`.
Blindado: erro vai para `rita.falhas` (fora da auditoria) e a gravação de
quem mexeu segue. **O aviso ao Gerente e ao Admin vem na 0A.6.**

**Auditoria.** `rita.settings` entra na trilha (com quem mexeu);
`rita.falhas` é registro técnico, declarado fora. O schema `rita` passou a
dar `usage` a quem loga — sem nenhuma tabela nem função interna aberta.

**Provas.** Treino, transação desfeita, **16/16**: sem login recusa; só as
três funções da tela abrem para quem loga; portão com 10 itens e os 5
pendentes; pessoa de fora não lê; rede desligada recusa; Gerente não liga
rede nem unidade; portão incompleto recusa com a lista; com as entregas
simuladas e a unidade completa o Admin liga (modo sombra); Gerente de outra
unidade não desliga, o desta desliga com motivo; endereço apagado e
coordenador removido pausam sozinhos; pausa quebrada não derruba a gravação
e vai para `rita.falhas`; modo (Gerente recusado, ativo/sombra/off,
inválido); `rita.settings` auditada. **Quebrando:** deixar o Gerente ligar
reprova a 8. Régua `rita-portao.test.ts` (13 testes) provada quebrando 3
vezes (Gerente liga, gatilho que devolve o erro, `enabled` aberta).

**Na produção:** ✅ **3001 aplicada pelo dono em 04/11/2026.** A rede e todas
as unidades seguem desligadas.

## 0A.3 — Consentimento e descadastro (Rita 0.3.0, 09/11/2026)

**Telefone.** `rita.phone_e164(texto)` devolve `+55DDNÚMERO` ou nulo (sem DDD,
curto, longo). Tira zeros de discagem e o 55 repetido. Será reusada na Fase 1
para o telefone do cliente.

**Tabelas** (todas auditadas, nenhuma se apaga — `RITA_NEVER_DELETE`, nem pela
chave de serviço):

- `rita.consent_texts` — as versões do TEXTO do consentimento. **Nasce vazia
  (decisão 30 aberta).** Só o Admin Master aprova
  (`rita.approve_consent_text(versão, finalidade, texto)`); texto aprovado não
  muda (`CONSENT_TEXT_EXISTS`: versão nova).
- `rita.contact_consents` — telefone, finalidade (`contato`/`marketing`),
  versão do texto, por onde veio, evidência, quem registrou; revogar marca
  `revoked_at`.
- `rita.opt_outs` — cada "não quero mais receber", em linhas.

**Portas** (chave de serviço = a Rita como autora; pessoa logada = ela):

| Função | Quem |
|---|---|
| `rita.register_consent(fone, finalidade, versão, via, unidade, …)` | a Rita (só `via = 'whatsapp'`) ou quem tem a unidade no escopo. **Sem texto aprovado: `CONSENT_TEXT_NOT_APPROVED`** |
| `rita.revoke_consent(fone, finalidade, via)` | a Rita ou qualquer pessoa da equipe (proteger nunca depende do escopo) |
| `rita.register_opt_out(fone, via, nota)` | a Rita ou qualquer pessoa da equipe |
| `rita.can_contact(fone, finalidade)` → `allowed, reason` | a Rita ou qualquer pessoa da equipe |

**A regra do "pode contatar"** (`rita._can_contact`): vale o **fato mais
recente** sobre o telefone; no empate, quem bloqueia ganha. Liberam: o
consentimento da Rita (`consentimento`) e o aceite do indicado no Indica
(`aceite_indica`, **só para contato**, decisão 17). Bloqueiam: revogação
(`consentimento_revogado`, `aceite_indica_revogado`) e descadastro
(`descadastro`). Sem fato nenhum: `sem_consentimento`. Os horários usam o
relógio de cada comando (`clock_timestamp()`), para "descadastrou e depois
consentiu" ficar na ordem certa até dentro de uma transação.

**"Não quero contato" (decisão 18):** a Rita registra o descadastro do
telefone — o bloqueio vale para qualquer abordagem nova, inclusive nova
indicação. As recusas do Indica têm motivo em texto livre e **não** são lidas.

**Limite conhecido:** celular gravado com 10 dígitos (sem o 9) e com 11 viram
telefones diferentes. A Fase 1 decide se normaliza o nono dígito.

**Provas.** `npm run test:rita` (novo, no molde do `test:indica`; uma
transação desfeita no treino, com as seções 0A.1, 0A.2 e 0A.3): **43/43**.
`RITA_REAPLICAR=3002` reaplica a migração do disco dentro da transação;
quebrando de propósito (aceite do Indica valendo para marketing; empate
liberando; gravar sem texto aprovado) caem 1, 4 e 1 conferências. Régua
estática `rita-consentimento.test.ts` (9 testes), provada quebrando 3 vezes.

**Na produção:** ✅ **3002 aplicada pelo dono em 09/11/2026** (`audit_attach_all` = 3: as três tabelas novas na auditoria). `rita.consent_texts` segue vazia (decisão 30).

## 0A.4 — Unidade, horário por dia e feriados (Rita 0.4.0, 09/11/2026)

**No core (0368)** — tudo no `public`, todos leem:
`clinic_public_info` (nome público, **link do mapa**, referência,
estacionamento, acessibilidade, WhatsApp, `min_child_age` — decisão 41) e
`clinic_service_areas` (Admin ou Gerente da unidade);
`clinic_weekday_hours` em cascata (a rede só o Admin); `holidays` (48
nacionais de 2026–2029; estadual/municipal pelo Gerente do estado/cidade).
**A agenda da equipe não lê o horário por dia** (DA8).

**Na Rita (3003):**

| Função | O que faz |
|---|---|
| `rita.weekday_hours(unidade)` | os 7 dias que valem (da unidade, senão da rede), com `origem` |
| `rita.unit_day(unidade, data)` | `is_open`, horário, almoço, `holiday_name` e `reason`: `aberto`, `dia_fechado`, `feriado_sem_decisao`, `feriado_fechado`, `feriado_com_atendimento` |

**Feriado sem decisão do Gerente = fechado para a Rita** (decisão 9). Ainda
**não** entram no `unit_day`: o fechamento por período do Planejamento anual,
os dias avulsos e as salas/profissionais — isso é dos horários livres (Fase 1).

**O portão** passou a conferir o **link do mapa** e **ao menos um dia aberto**
no horário por dia. Pendentes agora: avaliação (duração/valor e o que inclui,
0A.5) e transferências (0A.6). A pausa automática vigia
`clinic_public_info` e `clinic_weekday_hours`; mudar o horário da REDE
confere todas as unidades ligadas.

**Telas:** Configurar agenda → "Horário por dia da semana" e "Feriados da
unidade" (Gerente; a decisão é a de sempre); na Franqueadora, o horário padrão
da rede (só o Admin muda); Administração → Clínicas → "Dados públicos" (Admin).

**Provas:** `test:rita` **66/66** (seção 0A.4 com as regras de linha valendo,
papel `authenticated`); quebrando a 0368 (qualquer um grava dados públicos) e
a 3003 (feriado sem decisão abre) caem 2 e 2. Régua `unidade-publica.test.ts`.
Visto na tela pelo servidor local de teste, nada salvo.

**Na produção:** ⏳ **0368** e depois **3003**, antes do push.

## Regras para as próximas entregas

- **Rodar `npm run test:rita`** em toda entrega da Rita e acrescentar a seção
  dela no `scripts/rita-testes-sql.mjs`.

- Tabela nova no schema `rita` termina com `select public.audit_attach_all();`
  (a 0365 já incluiu o schema) ou declara o motivo em
  `public.audit_excluded_tables`.
- Função `rita.*`: `security definer`, `set search_path = ''`,
  `revoke execute … from public, anon, authenticated`, `grant … to service_role`,
  e confere `rita.enabled(unidade)` antes de agir (DA4, a partir da 0A.2).
- A API só enxerga o schema `rita` depois de ele entrar em **Exposed schemas**
  no painel do Supabase — necessário só quando um processo chamar `rita.*` pela
  API (0B). Até lá, não expor.

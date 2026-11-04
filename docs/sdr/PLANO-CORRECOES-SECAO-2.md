# Plano 1 — Correções do sistema atual (seção 2 do DECISOES_RITA.md)

_Proposta de 03/11/2026, para aprovação. Sem código escrito. Base: `docs/sdr/LEVANTAMENTO_DADOS_RITA_RESULTADO.md` (seção 5) e `docs/sdr/DECISOES_RITA.md` (seção 2). Itens do BACKLOG: AP99, AP87, AP100, AP101, AP103, AP104, AP97 e o item 7 (comissões, ainda sem AP)._

Regra que vale para todo item: **cada correção é uma sessão e um commit próprios**, rotulados pelo projeto dono (`fix(core)`, `fix(indica)`, `fix(empresarial)`), com migração na faixa do projeto, conferida por `check-migrations`, aplicada no treino por `migrar:teste` e provada em transação desfeita antes de ir ao dono. Nada aqui é da Rita; tudo melhora o sistema de hoje.

**Numeração de migrações prevista** (próximo número livre em 03/11/2026; conferir na hora): core **0351+** (a 0350 está em obra na sessão da razão social), Indica **2009+**, Empresarial **1039+**.

---

## 1. Webhook do Asaas (AP99) — primeiro

### O que foi conferido agora (03/11/2026, só leitura)

- A Edge Function `asaas-webhook` **não está publicada em nenhum dos dois projetos**: `GET` e `POST` em `https://<ref>.supabase.co/functions/v1/asaas-webhook` respondem `404 {"code":"NOT_FOUND"}` na produção e no treino.
- O cabeçalho do arquivo diz que o deploy é do dono "quando tiver a chave", com `--no-verify-jwt` (o Asaas não manda JWT). A integração do app (`src/lib/empresarial/asaas.ts`) também está dormente: sem `ASAAS_API_KEY`, `isAsaasConfigured()` é falso e a cobrança fica local com baixa manual.
- **Conclusão:** o risco é latente. Hoje ninguém consegue chamar o webhook porque ele não existe no ar. Ele vira risco real no dia em que alguém publicar a função sem antes cadastrar `ASAAS_WEBHOOK_TOKEN` nos segredos do Supabase.
- **Não dá para conferir de fora se o segredo está cadastrado** (segredo de Edge Function não aparece na API). Como a função não está publicada, isso hoje não importa; passa a importar no deploy.

### O que mudar

1. **Fechar quando a variável faltar** (`supabase/functions/asaas-webhook/index.ts`): sem `ASAAS_WEBHOOK_TOKEN`, responder `500` com texto "webhook não configurado" e registrar no log, **antes** de ler o corpo. Mesmo padrão do cron da Vercel (`src/lib/cron-auth.ts`: sem `CRON_SECRET`, nada roda).
2. **Comparar o token em tempo constante** (`crypto.subtle` / `timingSafeEqual` do Deno), em vez de `!==`. De carona, o mesmo ajuste em `src/app/api/webhooks/zapsign/route.ts:20` (`!==` no `x-riszon-webhook-secret`), que é o único outro webhook do sistema.
3. **Idempotência antes do corpo**: manter como está (insere em `asaas_webhook_events` e para em `23505`). Só acrescentar que corpo sem `id` **não** ganha `crypto.randomUUID()` (hoje ganha, e um corpo inválido repetido viraria evento novo a cada vez): sem `id`, responder `400`.
4. **Documentar** em `docs/PRODUCAO-ONLINE.md`: linha para `ASAAS_WEBHOOK_TOKEN` (segredo da Edge Function, não da Vercel), `ASAAS_API_KEY` e `ASAAS_BASE_URL` (Vercel), e a ordem obrigatória: **cadastrar o segredo → publicar a função → cadastrar a URL no painel do Asaas**. Fecha também o AP105 para essas três variáveis.
5. **Régua**: teste unitário que lê o arquivo da função e reprova se a leitura do corpo (`req.json()`) aparecer antes da conferência do token, ou se o `if (expected)` voltar (padrão já usado em `cpf-invalido.test.ts`, `avisos-pela-porta-do-banco.test.ts`).

### Prova

- Sem publicar: teste da régua verde, e **provado quebrando** (devolver o `if (expected)` reprova).
- Se o dono quiser publicar no **treino** para ensaiar: `supabase functions deploy asaas-webhook --no-verify-jwt --project-ref bsnptybalszjjbhxeejo` sem o segredo → a sondagem de fora (POST com corpo inválido) tem de responder `500`; com o segredo cadastrado e sem o cabeçalho → `401`; com o cabeçalho certo e corpo inválido → `400`, e `asaas_webhook_events` continua vazia.

### Projeto, migração, manual

Empresarial. **Sem migração.** Sem manual (a equipe não vê). `EMPRESARIAL_VERSION` sobe; novidade no `changelog.ts`.

---

## 2. Indica +Risos avisa quem indicou sem autorização do indicado (E10; decisão 20)

### Hoje

`indica.mensagens_dos_eventos()` (2006:183-239) enfileira para o Embaixador as mensagens `registrada`, `compareceu`, `fechou` e `convertida` com o **primeiro nome do indicado**, a menos que `indicacoes.desvinculada_em` esteja preenchida — e **nenhuma função grava essa coluna**. Não existe evento nem modelo "agendou".

### O que mudar (migração **2009**, projeto Indica)

1. **Coluna de autorização** em `indica.indicacoes`: `autoriza_avisar_indicador_em timestamptz`, `autoriza_avisar_canal text` (mesmo check de `consentimentos.canal`: `link, whatsapp, presencial, telefone, portal`), `autoriza_avisar_por uuid → profiles`, e `autoriza_avisar_revogado_em`. Fica na indicação (não em `consentimentos`), porque é outra pergunta: "posso contar a quem te indicou?" ≠ "posso te contatar?".
2. **Funções do motor** (`security definer`, grant a `authenticated` e `service_role`, guarda `eh_risartano` quando há usuário, como `registrar_aceite`): `indica.registrar_autorizacao_aviso(p_indicacao_id, p_canal)` e `indica.revogar_autorizacao_aviso(p_indicacao_id, p_motivo)`. As duas gravam um evento na linha do tempo (hoje o aceite não grava; aqui gravar).
3. **Onde a recepção pergunta:** `registrar_indicacao` ganha a chave `autoriza_avisar` no `p_dados` (a janela "Nova indicação" pergunta junto com o aceite presencial/por telefone); o detalhe da indicação ganha o botão "Autorizou avisar quem indicou" ao lado do aceite (`indicacoes/[id]/aceite.tsx`). O convite público `/c/[token]` ganha a segunda pergunta ("Podemos avisar quem te indicou quando você vier?") e `aceitar_convite` grava as duas.
4. **`mensagens_dos_eventos`**: para `agendada`, `compareceu`, `fechou` e `convertida`, o `{indicado}` passa a ser o primeiro nome **só com autorização vigente** (`autoriza_avisar_indicador_em not null and autoriza_avisar_revogado_em is null`); sem ela, "a pessoa que você indicou" (o ramo que hoje depende de `desvinculada_em`). A mensagem `registrada` (obrigado) não cita o indicado e continua igual.
5. **Evento e modelo "agendou"**: `agendada` entra na lista do gatilho; nova chave `msg_agendou_embaixador` em `indica.config` (grupo `mensagens`, rede, `travado=false`), sem data nem horário no texto (kickoff 3.3). O índice único `(indicacao_id, evento)` já impede repetição; "trocar a avaliação" (agendada → agendada) não gera segunda mensagem.
6. **`desvinculada_em`**: passa a ser gravada por `revogar_autorizacao_aviso` quando o motivo for "não quero ser ligado a quem indicou" (hoje é coluna morta). Alternativa: apagar a coluna — não recomendo, três lugares a leem.
7. **Dados existentes:** nenhuma indicação tem autorização → as mensagens futuras saem sem nome, até alguém registrar. Não há mensagem retroativa.

### ❓ Decisão que o item precisa

**Sem autorização, a mensagem sai sem o nome (como proposto) ou não sai?** A decisão 20 diz as duas coisas ("só é avisado com autorização" e "sem autorização, as mensagens não citam o nome"). Proposta: **sai sem o nome**, porque "alguém que você indicou compareceu, +150 Riso Coins" ainda é informação do próprio Embaixador (os pontos dele). Se o dono preferir não enviar, o gatilho só pula o `_enfileirar`.

### Prova

`npm run test:indica` com conferências novas: aceite sem autorização → texto sem nome; com autorização → com nome; revogação → volta a sem nome; `agendada` gera uma mensagem só; `/c/[token]` grava as duas respostas. **Provado quebrando:** tirar a condição do nome derruba a conferência.

### Manual

Sim (a recepção vê a pergunta nova e o botão): seção do Indica no manual + `changelog.ts`. `INDICA_VERSION` sobe.

---

## 3. Anonimização não limpa a fila; token do convite em claro (AP101, AP100)

### Hoje

- Rotina diária (2006:785-800 e 855-868): zera `indicado_nome/telefone/cpf/email` em `indicacoes`, mas em `indica.mensagens` só marca `a_enviar → descartada`; `nome`, `telefone`, `texto` e `link_caminho` ficam.
- `_gerar_convite` (2006:270-310) guarda o `sha256` do token em `indicacoes.convite_token_hash` e grava **o token em claro** em `mensagens.link_caminho = '/c/<token>'`; a tela "Mensagens" (`mensagens/page.tsx:90`) monta o link a partir dele. Qualquer Risartano da unidade lê a fila (`mensagens_ler`) e consegue aceitar em nome do indicado.

### O que mudar (migração **2010**, projeto Indica)

**3a. Anonimizar a fila junto.** Nos passos (0) e (5) da `rotina_diaria`, para cada indicação anonimizada: `update indica.mensagens set nome = 'Anonimizado', telefone = '', texto = '', link_caminho = null, status = case when status = 'a_enviar' then 'descartada' else status end where indicacao_id = r.id`. Também na recusa manual com motivo "não quis contato"? **Não**: a anonimização continua pela rotina (12 meses), como a diretriz manda; só a fila acompanha.

**3b. Tirar o token da fila.** Duas opções:

| | Opção A — tabela só da chave de serviço | Opção B — resolver o link na hora |
|---|---|---|
| Como | Nova tabela `indica.convites_tokens (indicacao_id pk, token text, criado_em)`, **sem policy de leitura** para `authenticated` (só `service_role`, como `signature_*`), fora da auditoria ("registro técnico"). `_gerar_convite` grava lá e deixa `mensagens.link_caminho = '/c/'` (sem token). | Guardar só o hash (como hoje) e gerar **outro** token a cada abertura do link pela tela, invalidando o anterior. |
| Tela "Abrir WhatsApp" | Chama uma server action que, pela chave de serviço, lê `indica.link_do_convite(p_mensagem_id)` (`security definer`, só `service_role`, devolve `'/c/'||token` e registra quem pediu em `rita`/`audit_logs`). | A mesma action, mas o link muda a cada clique e o anterior deixa de valer. |
| Risco | Quem tem a chave de serviço lê tudo (já lê hoje). | Mensagem já copiada pelo Risartano para o WhatsApp deixa de abrir se alguém clicar de novo. |
| **Recomendação** | **A.** Simples, preserva "uma mensagem = um link", e o rastro de quem abriu o link fica registrado. | — |

Limpeza na mesma migração: as mensagens existentes com `link_caminho like '/c/%'` têm o token **movido** para a tabela nova e o caminho trocado por `'/c/'` (é `update`, não `delete`; nada se apaga). A tela de Mensagens passa a chamar a action para abrir o link, em vez de ler `link_caminho`.

### Prova

`test:indica`: após a rotina, `mensagens` da indicação anonimizada sem nome/telefone/texto/link; `mensagens.link_caminho` nunca contém 64 hex; `link_do_convite` recusa sem `service_role` (prova de fora: "permission denied"); a conferência "a página não vira consulta de paciente" continua verde. `check:destrutivo` não acusa (não há delete).

### Manual

Só se o botão "Abrir WhatsApp" mudar de comportamento visível (não deve). `changelog.ts` sim.

---

## 4. Consultor RisLife vê todas as empresas (AP87; decisão 4) — **plano próprio, a aprovar depois**

A decisão 4 pede tarefa separada. O que este plano faz é **dimensionar** para o plano próprio:

1. **Inventário (só leitura, primeiro passo do plano próprio):** listar todas as policies e funções dos schemas `empresarial` e `public` que chamam `empresarial.is_program_manager()` ou `accessible_company_ids()`, e as telas que usam `isProgramManager` (`src/lib/empresarial/access.ts:12-17`). Sem isso, qualquer mudança é palpite.
2. **Desenho provável:** `is_program_manager()` deixa de incluir `rislife_consultant`; nasce `is_rislife_consultant()`; `accessible_company_ids()` já devolve as empresas de `assigned_consultant_id = auth.uid()`, então a leitura por empresa continua; o que muda é o que hoje passa por "gestor": criar empresa, mudar status, benefícios da empresa, cobranças, o funil inteiro (`commercial_leads.consultant_id`), os avisos da 1026 (hoje para **todos** os consultores) e o painel.
3. **Decisões que o plano próprio vai pedir:** quem cria a empresa (consultor ou só gestor), se o consultor vê o painel da rede, se o funil mostra só os leads dele, e o que acontece com empresa sem consultor atribuído.
4. **Prova:** conta `rislife@example.com` do treino (ou criar uma com duas empresas, uma dele e uma de outro) → vê só a dele; `check:telas` para o papel.

Projeto Empresarial, migração 1039+, manual do Empresarial (a equipe percebe).

---

## 5. Agendamento sem trava real + suspeita de fuso nos horários livres (AP103, AP104; decisão 5)

### 5a. Provar o fuso antes de corrigir (AP104)

1. **Extrair a conta pura** de `getNextAvailableSlots` (`src/app/(app)/agenda/actions.ts:2314-2520`) para `src/lib/horarios-livres.ts`: entrada = configuração efetiva, fechamentos, dias avulsos, decisões de feriado, itens do plano, agendamentos ocupados, `agora`; saída = lista de horários. **Refatoração sem mudar comportamento** (o servidor passa a chamar a função pura com os mesmos dados).
2. **Teste que roda com `TZ=UTC`** (`vitest` aceita `env: { TZ: 'UTC' }` no config, ou um arquivo de teste que define `process.env.TZ` antes do primeiro `new Date`): unidade fechada no sábado, `agora` = sexta 22h de Brasília (= sábado 01h UTC) → a função de hoje deve oferecer **sexta** (ainda falta um pedaço do dia? não: `now` já passou do horário) e **segunda**; se oferecer **sábado** ou pular a segunda, o defeito está provado.
3. **Se provado:** `winStart` passa a `startOfTodayInBrazil()`, `day.getDay()` passa a `weekdayOf(dateOnly)` (`src/lib/dates.ts`), e a régua `dates.test.ts` ganha o formato `new Date(ano, mês, dia)` na lista do que reprova em código de servidor (hoje ela só pega `new Date("texto")`).
4. **Se não provado:** fechar o AP104 como "não reproduz", mantendo o teste como régua.

### 5b. Trava de verdade no agendamento (AP103)

Hoje `check_appointment_conflict` (0171:26-95) é um `exists` sem serialização, e sala/fechamento/feriado/horário só são conferidos em `checkAgendaRules` (`agenda/actions.ts:364-636`).

**Proposta (migração core 0351+), em duas camadas:**

1. **Serializar no gatilho** (mínimo, sem mudar o modelo): no início de `check_appointment_conflict`, `perform pg_advisory_xact_lock(hashtext('appt:provider:' || new.provider_user_id))`, o mesmo para `new.room_id` e `new.client_id` quando preenchidos. Dois inserts simultâneos para o mesmo profissional passam a entrar um de cada vez, e o segundo vê o primeiro. O custo é um lock por transação, só na escrita da agenda.
2. **Conflito de SALA no banco**: hoje é só na action (`AG`). Entra no mesmo gatilho (`ROOM_TIME_CONFLICT`), com a mesma exceção de urgência/emergência. `appointments.room_id` existe desde a 0045.
3. **Fora, de propósito:** fechamento de agenda, feriado, horário de funcionamento, almoço e plano anual continuam na action (são regras de "deve", não de integridade; a RPC `book_evaluation` da Rita vai revalidá-las na Fase 1). `exclude using gist` (btree_gist + `tstzrange`) fica como alternativa futura: exigiria extensão nova, não cobre `appointment_participants` e muda a mensagem de erro que a tela traduz.

**Prova:** transação desfeita no treino com duas sessões `pg` concorrentes (o mesmo roteiro do `test:indica`): sem o lock, as duas gravam; com o lock, a segunda recebe `PROVIDER_TIME_CONFLICT`. Sala: inserir dois na mesma sala e horário → `ROOM_TIME_CONFLICT`. `npm run test:indica` (gatilhos blindados em `appointments`). E2E da agenda ajustado.

**Manual:** não (a equipe só vê a mesma mensagem de conflito, agora também para sala — uma linha no manual da agenda). `changelog.ts` sim.

---

## 6. `importEmployees` ignora o limite contratado (AP97; decisão 26 mantém `joined_at`)

### O que mudar (projeto Empresarial, sem migração)

1. **Uma conferência só**: extrair de `createEmployee` (`employee-actions.ts:80-138`) a função `vagasParaTitulares(db, companyId, quantosNovos)` que lê `limite_de_titulares`, `max_adhesions`/`adhesion_limit_target`, conta os ativos (com a regra AP11: erro de leitura = recusa, nunca zero) e devolve `{ ok, vagas, motivo }`. `createEmployee` passa a chamá-la com `1`.
2. **`importEmployees`** chama a mesma função com o número de **CPFs novos** (os que ainda não existem na empresa — o upsert por `(company_id, cpf)` não cria vaga para quem já está). Se não couber: **recusa a importação inteira** com a frase "A planilha tem N titulares novos e a empresa tem só M vagas; renegocie o limite ou reduza a lista", em vez de importar parte (importar parte deixaria o RH sem saber quem ficou de fora).
3. **Telefone vazio** deixa de virar `""`: a linha vai para `errors` com o motivo ("sem telefone"), como já acontece com CPF inválido. A coluna é `not null` e a Rita precisa do telefone; um titular sem telefone não tem como receber boas-vindas.
4. **Régua**: teste que importa `rows` com telefone vazio e espera `errors` = 1; teste da função de vagas com limite 5, 4 ativos e 2 novos → recusa.

### ❓ Decisão

Recusar a importação inteira (proposto) ou importar até a vaga e listar quem ficou de fora? Importar parte é mais cômodo e mais perigoso (a lista "quem sobrou" some com a tela).

**Manual do Empresarial:** sim (a mensagem de recusa é nova). `EMPRESARIAL_VERSION` sobe.

---

## 7. `procedures` com leitura liberada expõe comissões (item 7; sem AP ainda)

### Hoje

`procedures_select` é `using (true)` para `authenticated` (0036). As colunas `commission_percent` e `commission_fixed_cents` (0039) são lidas por: `procedimentos/page.tsx` e `actions.ts` (Admin), `planejamento/[clientId]/page.tsx` (Planner), `prontuarios/[id]/page.tsx`, `src/lib/finance/repasse-percentual.ts`. Qualquer logado (recepção, TSB) consegue `select commission_percent from procedures` pela API.

### Opções

| | A — tabela irmã | B — view pública + policy restrita | C — privilégio por coluna |
|---|---|---|---|
| Como | `procedure_commissions (procedure_id pk, commission_percent, commission_fixed_cents)` com RLS Admin + Planner + Financeiro; as duas colunas saem de `procedures` (migração move os dados **antes** de derrubar, como a 0332 fez com `ortho_case_terms`). | `procedures_select` passa a Admin/Planner/Financeiro; nasce a view `procedures_catalog` (`security_invoker` desligado, sem as duas colunas) com `grant select to authenticated`, e as telas gerais passam a ler a view. | `revoke select (commission_percent, commission_fixed_cents) on procedures from authenticated` + `grant` só a … — **não funciona**: o Admin também é `authenticated`; privilégio de coluna não enxerga papel. |
| Custo | Migração destrutiva declarada (`-- DESTRUTIVO`), 5 arquivos do app, `auditoria-catalogo.ts`, histórico `procedure_changes`. | Trocar `.from("procedures")` em todo leitor que não é Admin/Planner/Financeiro (a medir no inventário: dezenas de lugares), e **todo embed** `procedures ( name )` em outras tabelas quebra para quem perder a policy. | — |
| **Recomendação** | **A.** É o mesmo padrão já usado para tirar dinheiro de uma tabela lida por todos (ortodontia: `ortho_case_terms`, 0332, R13). Os embeds `procedures ( name, … )` continuam funcionando para todos. | — | — |

**Passo 1 obrigatório:** inventário de quem lê as duas colunas e de quem faz embed em `procedures` (os cinco arquivos acima são os que citam o nome; `select *` em `procedures` pode haver mais). **Migração core 0351+**, `-- DESTRUTIVO: colunas movidas para procedure_commissions`, `check:destrutivo` e `check:alcance` rodados. A tabela nova entra na auditoria (`audit_attach_all`) e em `auditoria-catalogo.ts`.

**Prova:** de fora, sem login, `procedure_commissions` não entrega nada; a recepção de teste lê `procedures` sem as colunas (não existem mais); o Planner lê a irmã; `repasse-percentual.test.ts` verde; `check:telas` nas telas de Procedimentos, Planejamento e Prontuário.

**Manual:** não (nenhuma tela muda para a equipe). `changelog.ts` sim.

---

## Ordem proposta e esforço

| # | Item | Projeto | Migração | Sessões | Decisão pendente |
|---|---|---|---|---|---|
| 1 | Webhook Asaas + comparação constante (ZapSign de carona) + docs | Empresarial/core | não | 1 curta | — |
| 2 | Autorização para avisar quem indicou + evento "agendou" | Indica | 2009 | 1 | sem autorização: sem nome **ou** sem mensagem |
| 3 | Anonimizar a fila + token fora da fila | Indica | 2010 | 1 | opção A (recomendada) ou B |
| 6 | Limite na importação de titulares | Empresarial | não | 1 curta | recusar tudo (recomendado) ou importar parte |
| 5a | Provar o fuso (extrair conta pura + teste em UTC) | core | não | 1 | — |
| 5b | Lock no gatilho + conflito de sala no banco | core | 0351+ | 1 | — |
| 7 | Comissões em tabela irmã | core | 0351+ (destrutiva declarada) | 1 (com inventário) | opção A (recomendada) |
| 4 | Escopo do RisLife | Empresarial | 1039+ | plano próprio | várias (ver item 4) |

Itens 1, 2, 3 e 6 não dependem de nada e podem sair antes da Fase 0A. Itens 5 e 7 tocam `appointments` e `procedures`, que a Fase 1 da Rita também vai tocar: melhor fechá-los **antes** da Fase 1, não necessariamente antes da 0A. O item 4 segue o ritmo do Empresarial.

**O que peço para aprovar:** a ordem acima e as quatro decisões marcadas. Com o OK, começo pelo item 1.

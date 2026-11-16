# Mais de uma função por pessoa na mesma unidade — plano

*Pedido do dono em 16/11/2026: "em alguns casos possa ser liberado mais de uma
função por pessoa e por unidade. Existem situações que em uma unidade alguém
precisa ajudar em outra função quando alguém está ausente ou não tem quem
desempenha aquela função."*

Situação: **APROVADO pelo dono em 16/11/2026, D1 a D15 como recomendado**
("Sim, como recomendado"). Ordem de execução: F1 → F2 → F3 → F4 (seção 8).

| Entrega | Situação |
|---|---|
| F1 | ✅ 0.461.0, migrações 0413 e 2012 (16/11/2026; nos dois bancos, publicada). Ficaram para a F3, por só aparecerem com duas funções: o rótulo da função no chat e no aviso de mudança de fase (já hoje escolhem uma função qualquer entre unidades), a lista de Risartanos sem unidade repetida e a contagem da equipe da certificação. `unit_scheduling_staff` não precisou mudar: a agenda já junta as funções por pessoa. |
| F2 | a fazer |
| F3 | a fazer |
| F4 | a fazer |

---

## 1. Resumo em uma página

**Hoje:** o banco aceita **uma** função por pessoa em cada unidade. A trava é
a regra `user_clinic_roles_user_clinic_key` (`unique (user_id, clinic_id)`),
criada na migração 0003. A tela de Risartanos repete a trava: *"Esta pessoa já
tem uma função nesta clínica. Remova a atual antes de adicionar outra."*

**A proposta:** criar a **função de apoio**. A pessoa continua com a sua função
**principal** (o cargo dela) e pode receber, com motivo, mais uma ou duas
funções **de apoio** naquela unidade:

- **Cobertura temporária** — com data de início e de fim. Exemplo: *Celma (ASB)
  cobre a Recepção de Cambé de 18/11 a 29/11, férias da recepcionista.* No dia
  seguinte ao fim, a função de apoio sai sozinha.
- **Acúmulo fixo** — sem data de fim, para unidade que não tem quem faça
  aquela função. Exemplo: *o Coordenador de Londrina também faz a Recepção.*

Enquanto vale, a pessoa **soma** o que as duas funções podem fazer. No alto da
tela aparece *"Você está cobrindo Recepção até 29/11"*.

**Por que precisa de cuidado:** quase todo o sistema já lê a lista de funções
de cada pessoa por unidade, e por isso funcionaria sem mudança. Mas há
**lugares onde uma segunda função causaria erro calado**, e alguns envolvem
dinheiro:

| Onde | O que aconteceria hoje com duas funções | Gravidade |
|---|---|---|
| Relatório e histórico de repasse dos dentistas | Cada repasse aparece **duas vezes** e o total **dobra** | 🔴 dinheiro |
| Nível de carreira do dentista (o valor do repasse) | O sistema pega **qualquer uma** das linhas; pode cair na sem nível e pagar pela tabela errada | 🔴 dinheiro |
| Prêmio da equipe no Indica +Risos | A pessoa recebe **dois prêmios** | 🔴 dinheiro |
| Portão do sistema real (tranca por unidade) | Certificada numa função e não na outra, a **unidade inteira fecha** para ela, nas duas funções | 🟠 trava o trabalho |
| Liberar/tirar acesso na ficha | Libera uma função qualquer; tirar tira todas | 🟠 |
| 12 avisos do sino (chegada do paciente, conta a pagar, cancelamento…) | A pessoa recebe o **mesmo aviso duas vezes** | 🟡 incômodo |
| Agenda (lista de quem atende), lista de repasses, lista de Risartanos | A pessoa **aparece duas vezes** | 🟡 |
| Rótulo da função no chat, em Compras, no aviso de mudança de fase | Mostra uma função qualquer | 🟢 texto |

**Ordem segura:** primeiro corrigir tudo o que está nesta tabela (sem mudar nada
para ninguém, porque hoje ninguém tem duas funções). Só depois soltar a trava e
ligar o botão **"Adicionar função de apoio"**.

**Tamanho:** 4 entregas (seção 8). Cada uma passa pelo treino e por você antes
da produção.

---

## 2. O que existe hoje (medido em 16/11/2026)

### Na produção

- 13 pessoas, 18 funções. Ninguém tem duas funções na mesma unidade (a trava
  não deixa).
- Cinco dentistas atendem em Londrina **e** Cambé (uma função em cada; isso já
  funciona e não muda).
- Cada unidade tem **1 recepcionista, 1 ASB, 1 Coordenador e 5 dentistas**, e
  nenhuma tem Gerente. Basta uma pessoa faltar para a função ficar sem
  ninguém. É exatamente o caso do pedido.

### No código (levantamento completo do banco e do app)

**O que já funciona com várias funções, sem mudança:**

- **A sessão de quem entra** já guarda uma **lista** de funções por unidade
  (`rolesByClinic: Record<string, UserRole[]>`, `src/lib/auth.ts:77`). Não
  existe "a função ativa".
- **As permissões da tela** (`podeComPapeis`, `permissions.ts:766`) já somam as
  funções: *pode se alguma das funções pode*.
- **As ~130 regras de segurança do banco** usam funções de apoio que já
  aceitam várias linhas (`has_role_in_clinic`, `user_full_access_clinic_ids`,
  `is_planner`, `signature_can`, `providers_with_access`…). Nenhuma quebra.
- **Certificação** já é por (pessoa, **função**): missão, certificado,
  liberação (`system_clinic_access`, chave `(user_id, clinic_id, role)`) e a
  dispensa automática da 0411.
- **O limite de inatividade** já pega o menor entre as funções da pessoa.

**O que precisa mudar:** está nas seções 5 e 6, item por item, com o arquivo.

---

## 3. Como vai funcionar para quem usa

### 3.1 Para o Admin (na ficha do Risartano)

Na seção **Funções** da ficha, ao lado de **Nova função**, um botão novo:
**Adicionar função de apoio**. Ele pede:

1. **Unidade** — só as unidades onde a pessoa já tem a função principal.
2. **Função de apoio** — só as funções do tipo daquela unidade (de unidade
   numa franquia, de rede na Franqueadora), menos as que ela já tem lá e menos
   as combinações proibidas (decisão D4).
3. **Tipo** — *Cobertura temporária* (pede **de** e **até**) ou *Acúmulo
   fixo*.
4. **Motivo** — obrigatório. Exemplo: *"Férias da Erika"*, *"Unidade sem
   recepcionista"*.
5. **Acesso ao sistema real** — conforme a decisão D6 (certificação).

A lista de funções da ficha mostra as duas:

> **Recepcionista** · Cambé — *principal*
> **ASB** · Cambé — *apoio até 29/11 (férias da Erika)* · [Encerrar agora]

### 3.2 Para quem cobre

- No **Início** e no alto do menu: *"Você está cobrindo **Recepção** em Cambé
  até 29/11."*
- O menu e as telas passam a mostrar o que a Recepção pode fazer, **somado** ao
  que ela já fazia. Não existe "trocar de função": as duas valem ao mesmo
  tempo (decisão D5).
- Recebe um aviso no sino quando a cobertura começa, **2 dias antes** de
  acabar e quando acaba.

### 3.3 Para a unidade

- O Gerente (quando houver) e o Admin veem, na ficha da unidade e na lista de
  Risartanos, quem está cobrindo o quê e até quando. A lista mostra **um selo**,
  e não a pessoa repetida.

---

## 4. O desenho no banco

### 4.1 A cobertura tem registro próprio

Tabela nova **`role_coverages`**, que é o pedido e o histórico:

| Coluna | O que é |
|---|---|
| `id`, `code` (`AP-00001`) | identificação |
| `user_id`, `clinic_id`, `role` | quem, onde, qual função de apoio |
| `kind` | `temporaria` ou `fixa` |
| `starts_on`, `ends_on` | dias, no calendário brasileiro; `ends_on` nulo só na fixa |
| `reason` | motivo (obrigatório) |
| `status` | `agendada` → `ativa` → `encerrada` (ou `cancelada`) |
| `granted_by`, `ended_by`, `ended_at`, `end_reason` | quem fez, quem encerrou e por quê |

**Nada se apaga.** A cobertura encerrada fica para sempre. Isso responde,
anos depois, *"quem fazia a Recepção de Cambé em novembro?"*, e é a prova do
período se um dia houver questão trabalhista (ver D11).

### 4.2 A função de apoio vira uma linha de função de verdade

Enquanto a cobertura está **ativa**, ela tem **uma linha em
`user_clinic_roles_all`**, marcada:

- `assignment_kind` = `principal` | `apoio` (as 18 de hoje viram `principal`);
- `coverage_id` = a cobertura de origem;
- `ends_at` = o fim (cópia, para a trava de segurança abaixo).

**Por que uma linha de verdade, e não "uma regra a mais":** as 130 regras de
segurança, as 70 funções e o app inteiro já leem essa tabela. Pondo a função de
apoio lá dentro, **tudo passa a obedecer a ela sem ser reescrito**: é o mesmo
truque que fez a tranca da 0277 funcionar.

### 4.3 As travas novas (no banco, não só na tela)

- Sai `unique (user_id, clinic_id)`.
- Entra `unique (user_id, clinic_id, role)`: a mesma função duas vezes,
  nunca.
- **Uma principal por pessoa por unidade:** índice único em
  `(user_id, clinic_id) where assignment_kind = 'principal'`.
- **Limite de apoio** (D3): gatilho recusa a terceira (`TOO_MANY_SUPPORT_ROLES`).
- **Combinações proibidas** (D4): tabela `role_incompatibilities`, conferida
  pelo gatilho (`ROLE_COMBINATION_NOT_ALLOWED`).
- **Unidade × Franqueadora:** a regra que já existe (`user_clinic_roles_environment`,
  0011/0239) continua: a função de apoio também tem de ser do tipo da unidade.
- **Linha de apoio só nasce de uma cobertura** (`coverage_id` obrigatório
  quando `assignment_kind = 'apoio'`).

### 4.4 Começar e acabar sozinho

- **Começa:** se `starts_on` é hoje, a linha nasce na hora. Se for no futuro,
  a cobertura fica `agendada` e a **rotina diária** (00:05, horário de
  Brasília, no `pg_cron`, como as outras rotinas) cria a linha no dia.
- **Acaba:** a rotina diária **tira a linha** no dia seguinte a `ends_on` e
  marca a cobertura `encerrada`. Tirar a linha dispara o que já existe: a
  dispensa automática da turma de certificação (0411) e o recálculo da tranca.
- **Trava de segurança:** se a rotina falhar uma noite, a janela
  `user_clinic_roles` (a que as regras leem) também esconde a linha com
  `ends_at` vencido. Assim a cobertura nunca dura mais do que o combinado.
  Régua de teste prende isso.
- **Encerrar antes:** botão na ficha (Admin), com motivo. Tira a linha na hora.

### 4.5 Quem pode

Funções novas no banco, todas com guarda própria e `revoke … from anon`:

- `grant_role_coverage(user, clinic, role, kind, starts_on, ends_on, reason)`
- `end_role_coverage(coverage_id, reason)`
- `cancel_role_coverage(coverage_id, reason)` (a agendada que não chegou a
  começar)

Quem pode chamar: decisão D1.

---

## 5. Correções no banco antes de soltar a trava

Todas sem efeito hoje (ninguém tem duas funções); são o que impede o erro calado.

### 5.1 Dinheiro (prioridade máxima)

| Função | Problema | Correção |
|---|---|---|
| `payout_rate_for` (0387:96) | `career_level_id … limit 1` sem ordem | Ler o nível **da linha principal** (D8) |
| `payout_report_generate` (0400:798) | o mesmo | idem |
| `payout_report_candidates` (0400:733) e `payout_history` (0401:196) | `left join` com todas as linhas de função → **soma em dobro** | Juntar só a linha principal |
| `indica.aprovar_apuracao` (2007:960) | um prêmio por linha → **dois prêmios** | Um prêmio por pessoa, pelo grupo da função principal |
| App `setProviderLevel` (`financeiro/repasses/actions.ts:94`) | grava o nível em todas as linhas da pessoa | Gravar só na principal |

### 5.2 O portão do sistema real

| Onde | Problema | Correção |
|---|---|---|
| `refresh_system_closed` (0277:297) e `system_closed_clinics` | fecha por (pessoa, unidade), sem a função | A tabela ganha `role`; a janela `user_clinic_roles` esconde **só a função fechada** |
| `grant_clinic_access` (0277:253) | escolhe uma função qualquer | Recebe a função (`p_role`) |
| `revoke_clinic_access` (0276:281) | tira todas | Recebe a função |
| App `aplicarTranca` (`acesso-por-unidade.ts:128`) e `auth.ts:290` | chave por unidade; apaga todas as funções da unidade fechada | Chave por (unidade, função) |

### 5.3 Avisos em dobro

Doze funções mandam aviso para "quem tem a função X ou Y na unidade" sem
`distinct`: `check_in_appointment` (0032), `share_client_with_unit` (0038),
`end_client_share` (0042), `transfer_client` (0089),
`commercial_transfer_followup` e `commercial_log_followup_attempt` (0155),
`save_payable` (0194), `cancel_negotiation` (0205), `raise_finance_alert`
(0230), `_ortho_open_from_sale` (0335), `apply_plan_cancellation` (4017a),
`_ppr_refresh_delinquency_raw` (4018). Correção: `distinct` no destinatário.

As 4017a e 4018 são da sessão do Asaas: a correção entra por combinação com
ela (regra 1 do CLAUDE.md).

### 5.4 Listas e rótulos

- `unit_scheduling_staff` (0021): uma linha por pessoa, com as funções juntas.
- `chat_channel_people` (0123), `chat_contacts` (0353), `purchase_request_authors`
  (0323), `move_client_phase` (0266): mostrar **a função principal** (hoje
  `limit 1` sem ordem).

---

## 6. Correções no app

| Área | Arquivo | Mudança |
|---|---|---|
| Dar a função | `risartanos/acesso-actions.ts` | `parseAssignments` deixa de recusar a 2ª na mesma unidade (só para apoio); `createUser` acha o escopo por (unidade, função) e não só pela unidade (linha 261); mensagem do erro 23505 nova |
| Tela da ficha | `risartanos/acesso.tsx` | Botão e janela "Adicionar função de apoio"; filtros por (unidade, função) (linhas 396, 881); lista mostra principal × apoio, prazo e "Encerrar agora" |
| Tranca | `acesso-por-unidade.ts`, `auth.ts` | Por (unidade, função) — ver 5.2 |
| Repasses | `financeiro/repasses/page.tsx:127`, `actions.ts:94` | Uma linha por dentista; nível na principal |
| Lista de Risartanos | `risartanos/dados.ts:232` | Unidades sem repetição; selo "apoio" |
| Equipe da certificação | `certificacao-equipe.ts:74` | Contar conforme D7 |
| "Só dentista" | `app-sidebar.tsx:427`, `jornada/page.tsx:71`, `isDentistRestricted`, `isSdrRestricted`, `ortodontia/access.ts:97`, Empresarial "só RisLife" | Com a soma (D5), o dentista que cobre a Recepção deixa de ser "só dentista" e passa a ver o que a Recepção vê. Conferir tela por tela que é isso que se quer |
| Aviso de cobertura | Início e barra do alto | "Você está cobrindo X até dd/mm" |
| Treino | `espelho-treino.ts:318`, `scripts/seed-test.mjs:186` | O espelho copia a função de apoio; a semente deixa de sobrescrever com `on conflict (user_id, clinic_id)` |

**Cargo da ficha** (`staff_members.role_title`): continua **um só**, o cargo
contratual. A função de apoio não muda o cargo.

---

## 7. Como vamos provar que funciona

1. **Ensaio no treino** (transação desfeita), com uma pessoa com principal +
   apoio em cada situação: repasse (soma não dobra), Indica (um prêmio), portão
   (certificada numa e não na outra: só a outra fecha), avisos (um só), agenda
   (aparece uma vez), início e fim pela rotina, a trava de segurança com a
   rotina parada.
2. **Réguas de teste novas**, provadas quebrando:
   - nenhuma função do banco lê `career_level_id` ou `role` de
     `user_clinic_roles_all` com `limit 1` sem filtrar a principal;
   - os avisos para "quem tem a função X" usam `distinct`;
   - a janela `user_clinic_roles` esconde a linha vencida.
3. **Varredura das telas** (`check:telas`) com a conta de teste em cobertura.
4. **Você testa no treino** com uma cobertura de verdade antes da produção.

---

## 8. Entregas

| # | Entrega | Migração | O que muda para a equipe |
|---|---|---|---|
| **F1** | Corrigir os leitores: dinheiro, portão por função, avisos, listas, rótulos (seções 5 e 6, menos a tela nova) | 1 core (+ 1 combinada com a sessão do Asaas para 4017a/4018; + 1 do Indica para o prêmio) | Nada visível. A tranca passa a ser por função |
| **F2** | O modelo: `role_coverages`, as travas novas, as funções de dar/encerrar, a rotina diária | 1 core | Nada visível (sem botão ainda) |
| **F3** | As telas: ficha (dar, ver, encerrar), Início e barra do alto, avisos de início/fim, manual | sem migração | O Admin passa a dar função de apoio |
| **F4** | Certificação da função de apoio (D6/D7), o painel **"Equipe e coberturas"** no Painel da rede e os avisos à Franqueadora (seção 10) | 1 core | A Franqueadora acompanha equipe enxuta e sobrecarga |

A F1 vai primeiro **de propósito**: ela é segura sozinha e é a que evita
pagar em dobro.

---

## 9. Decisões do dono

**D1 — Quem pode dar uma função de apoio?**
- **A (recomendado):** só o **Admin Master**, nas duas formas (temporária e
  fixa). Hoje nenhuma unidade tem Gerente; com Gerente, liberar para ele a
  **temporária na própria unidade** vira uma permissão da matriz, sem obra.
- B: Admin e Gerente da unidade desde já.

**D2 — Os dois tipos**
- **Recomendado:** *cobertura temporária* (fim obrigatório, **até 90 dias**,
  renovável criando outra) e *acúmulo fixo* (sem fim, motivo obrigatório,
  revisto quando você quiser na lista de coberturas).

**D3 — Quantas funções de apoio por pessoa, por unidade?**
- **Recomendado: até 2** (a principal + 2). Mais que isso é sinal de que falta
  gente, não de que falta função no sistema.

**D4 — Combinações proibidas**
- **Recomendado:** proibir **Comprador + Financeiro da Franqueadora** (quem
  compra não paga: regra de controle que o sistema já segue). Todo o resto
  liberado, porque as travas de "ninguém aprova o próprio" já são **por
  pessoa**, não por função, e continuam valendo (repasse, compras, plano).
- A lista fica numa tabela: incluir outra combinação depois é um ajuste, sem
  obra.

**D5 — A pessoa soma as funções ou "troca de chapéu"?**
- **A (recomendado): soma.** As regras de segurança do banco já somam. Uma
  "troca de função" exigiria reescrever as 130 regras para olhar uma escolha
  da sessão, e a pessoa que cobre a Recepção numa manhã corrida teria de
  trocar de chapéu a cada paciente.
- B: trocar de função como se troca de unidade. Muito mais caro, e com risco de
  regra esquecida.

**D6 — A função de apoio exige certificação?** (o portão do sistema real)
- **A (recomendado):**
  - **Temporária: não exige.** Ao dar a cobertura, o Admin libera o acesso
    daquela função na unidade **pelo período**, registrado como "liberado sem
    missão — cobertura AP-00001". Cobertura de emergência não pode esperar uma
    missão.
  - **Fixa: segue o portão como qualquer função.** A pessoa é convocada numa
    turma e, com o AP172, aproveita as tarefas em comum com a certificação que
    já tem.
- B: as duas exigem certificação.
- C: nenhuma exige.

**D7 — Na certificação coletiva, a cobertura segura a unidade?**
- **Recomendado: a temporária não** (não entra em turma nem conta no "N de M").
  A fixa conta como qualquer função.

**D8 — Dinheiro: repasse, nível de carreira, metas e prêmios**
- **Recomendado:** tudo fica na **função principal**. O dentista que cobre a
  Coordenação continua recebendo repasse como dentista, pelo nível dele. Metas
  e prêmio do Indica: **uma vez por pessoa**, pelo grupo da principal.
- *Pagar algo a mais pela cobertura* é assunto de folha, fora do riSZon (D11).

**D9 — Agenda**
- **Recomendado:** a pessoa aparece **uma vez**. Ela entra como profissional
  que atende só se uma das funções for de atendimento (dentista, Coordenador).

**D10 — Fim da cobertura**
- **Recomendado:** sai **sozinha** no dia seguinte ao fim. A pessoa e o Admin
  recebem aviso **2 dias antes** e no dia. O Admin pode encerrar antes, com
  motivo.

**D11 — Observação trabalhista (não é decisão de sistema)**
- Acúmulo de função pode gerar direito a adicional, conforme o contrato e a
  convenção coletiva. O sistema vai guardar **quem, o quê, de quando a quando e
  por quê**, que é a prova do período. **Vale confirmar com a contabilidade ou
  o jurídico** como tratar o pagamento, principalmente no **acúmulo fixo**.

---

## 10. Acompanhamento pela Franqueadora: equipe enxuta e sobrecarga

*Pergunta do dono (16/11/2026): "como é possível pela franqueadora saber se tem
unidade 'abusando' desta possibilidade, isso pode promover unidade que querem
uma equipe 'mais enxuta' e como possibilidade de sobrecarregar a equipe, como
consigo visualizar/acompanhar isso?"*

A cobertura é um **registro com datas, motivo e quem deu** (seção 4.1). Por
isso dá para medir o abuso em vez de adivinhar. O acompanhamento tem três
partes: **impedir** o abuso fácil, **mostrar** os números e **avisar** quando
um limite é passado.

### 10.1 Impedir (as travas)

- **Quem dá a cobertura.** Hoje só o Admin (D1), então a Franqueadora controla
  na origem. Quando a unidade (Gerente ou Franqueado) puder agir, ela **pede**
  e a Franqueadora **aprova** o acúmulo fixo. A temporária curta pode ficar com
  a unidade (D12).
- **Motivo em lista fechada**, mais o texto livre: *férias, licença, falta,
  desligamento (vaga aberta), unidade sem a função, outro*. É isso que permite
  separar "a recepcionista está de férias" de "a unidade nunca contratou
  recepcionista".
- **A temporária não vira fixa por emenda.** Cobertura nova da mesma pessoa,
  na mesma função, que começa até 7 dias depois do fim da anterior **conta como
  a mesma** para o limite de 90 dias (D2). Passou de 90, só como acúmulo fixo,
  que exige a aprovação da Franqueadora.
- **O acúmulo fixo vence.** Ele tem **revisão a cada 90 dias** (D14). Sem
  revisão, vira pendência no painel e no sino.
- **Limites da rede, configuráveis** (como as outras configurações em cascata,
  rede → unidade): no máximo **X coberturas ao mesmo tempo por unidade** e
  **Y% da equipe em acúmulo**. Passou do limite, a nova cobertura é recusada
  (ou só avisa, conforme D13).

### 10.2 Mostrar: o painel "Coberturas"

Uma aba nova, **Equipe e coberturas**, no **Painel da rede** (onde já ficam
Contas a pagar, Recebíveis, Fluxo de caixa e DRE por unidade). Funciona como as
outras abas: o mês no alto, uma linha por unidade, a cor e uma frase, e um
**Abrir na unidade** para ver o detalhe.

**Sinais de equipe enxuta** (por unidade, no mês):

| Indicador | O que mostra | Por que importa |
|---|---|---|
| **Função sem titular** | Função feita **só** por apoio (ninguém a tem como principal) e há quantos dias | É o sinal mais forte de vaga que não está sendo preenchida |
| **% do mês coberto, por função** | Ex.: *"Recepção de Cambé: 22 de 30 dias por cobertura"* | Separa a ausência pontual da ausência crônica |
| **Dias-pessoa de cobertura** | Soma dos dias de todas as coberturas | Mostra o tamanho do buraco, comparável entre unidades |
| **% da equipe em acúmulo** | Quantas pessoas da unidade têm função de apoio | Uma pessoa cobrindo é normal; metade da equipe, não |
| **Coberturas emendadas** | Temporárias que se renovam em sequência, com os dias contínuos | É a "fixa disfarçada" |
| **Fixas sem revisão** | Acúmulos com a revisão vencida | Acúmulo esquecido |
| **Motivos** | Distribuição por motivo | "Férias" é diferente de "vaga aberta há 4 meses" |

**Sinais de sobrecarga** (por pessoa em cobertura). O sistema já registra o
uso de cada pessoa: tempo ativo por dia (`access_sessions`, desde a 0287) e as
ações por hora (painel de uso da Auditoria, 0290). A aba compara a pessoa
**antes e durante** a cobertura:

| Indicador | O que mostra |
|---|---|
| **Tempo ativo por dia** | Ex.: *"Celma: 5h10/dia antes, 7h40/dia na cobertura"* |
| **Uso fora do horário da unidade** | Acessos antes da abertura ou depois do fechamento, pelo horário cadastrado da unidade. Sinal de hora extra |
| **A função principal caiu?** | As ações da função principal dela (as mesmas que a certificação conta) antes e durante. Se caíram muito, a cobertura está tirando a pessoa do próprio trabalho |
| **Duas coberturas ao mesmo tempo** | Quem está com as 2 funções de apoio, e há quanto tempo |

**Comparativo da rede:** as unidades em ordem pelo *% de funções cobertas por
apoio* e pelos *dias-pessoa de cobertura por pessoa da equipe*. Verde, amarelo
ou vermelho pelos limites da D13.

**⚠️ O limite honesto deste painel:** o riSZon vê o que acontece **dentro do
sistema**. O tempo ativo e o horário de acesso indicam carga, mas **não são
ponto eletrônico**. Hora extra de verdade se confere na folha. O painel serve
para **saber para onde olhar**; a conclusão sobre uma unidade continua sendo uma
conversa com ela.

### 10.3 Avisar (o sino da Franqueadora)

A rotina diária (a mesma do início e fim das coberturas) avisa o Admin e quem
a D12 definir:

- **Função sem titular** há mais de **30 dias**;
- **Cobertura emendada** passando de **60 dias** contínuos;
- **Acúmulo fixo** com a revisão vencida;
- **Unidade acima do limite** de coberturas ou de % da equipe em acúmulo;
- **Pessoa em sobrecarga:** tempo ativo médio na cobertura **30% acima** do
  dela antes, ou acesso fora do horário em **5 ou mais dias** do mês.

Um aviso por assunto e por fato, como os avisos da Ortodontia e das Metas:
o mesmo alerta não se repete todo dia.

### 10.4 Novas decisões

**D12 — Quem vê o painel e recebe os avisos**
- **Recomendado:** o **Admin Master** e a função **Franqueadora/Rede**, vendo
  a rede inteira. O **Franqueado** e o **Gerente** veem **só a própria
  unidade**, com os mesmos números (transparência ajuda a corrigir antes do
  alerta). A pessoa em cobertura vê **o próprio** tempo, nunca o dos colegas.

**D13 — Os limites da rede, e se eles travam ou só avisam**
- **Recomendado, para começar:** no máximo **2 coberturas ao mesmo tempo por
  unidade** e **30% da equipe em acúmulo**. Nos primeiros 3 meses, os limites
  **só avisam**: assim você calibra os números com a operação de verdade antes
  de travar alguém. Depois, você decide se passam a travar.

**D14 — Revisão do acúmulo fixo**
- **Recomendado:** a cada **90 dias**. Sem revisão em 15 dias depois do
  vencimento, o acúmulo **continua** (para não parar a unidade), mas fica
  **vermelho** no painel e o aviso se repete toda semana até alguém revisar.

**D15 — Os motivos**
- **Recomendado:** a lista fechada da 10.1 mais o texto livre. "Desligamento
  (vaga aberta)" pede a **previsão de contratação**; vencida a previsão, a
  unidade aparece no painel.

### 10.5 Onde entra nas entregas

- **F2** ganha as colunas do motivo (categoria), da revisão e da aprovação, a
  regra da emenda e os limites da rede.
- **F4** passa a ser **o painel "Equipe e coberturas" e os avisos da 10.3**,
  no lugar do relatório simples.
- Os sinais de sobrecarga **não precisam de tabela nova**: saem do que o
  sistema já grava (coberturas, `access_sessions`, auditoria, horário da
  unidade).

---

## 11. O que fica de fora (e por quê)

- **"Agiu como Recepção" em cada registro.** A auditoria guarda **quem** fez,
  não **com qual função**. Com a soma (D5), separar exigiria a "troca de
  chapéu". Dá para responder pelo período da cobertura (seção 4.1).
- **Pedido de cobertura feito pela unidade**, com aprovação do Admin. Pode vir
  depois, sobre a mesma tabela, se você quiser que o Gerente peça e o Admin
  aprove.
- **Função em outra unidade** já existe hoje (os dentistas de Londrina e
  Cambé). Este plano trata só da **mesma** unidade.

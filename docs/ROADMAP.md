# Roadmap de construção — o que falta e como será feito

_Criado em 04/07/2026, após o teste geral do MVP e a entrega dos Grupos 1, 2 e
do H4.4. **Ordem decidida pelo dono:** H3.1 → H3.15 em sequência numérica,
depois H4.1 → H4.14 (pulando o H4.4, já entregue)._

Legenda: **[P]** pequeno (horas) · **[M]** médio (1 lote) · **[G]** grande
(vários lotes) · 🗄️ = precisa de migração no banco.

> Itens detalhados também em `docs/BACKLOG.md` (LOTE H). Ao concluir um item,
> marcar lá E atualizar este arquivo. Cada lote segue o ritual: plano curto →
> OK do dono → código → build+lint → commit → roteiro de teste numerado.

## Onde estamos (09/07/2026) — versão 0.25.0 · migração 0095

> **H4.5 Cockpit 2.0 COMPLETO** com o **Lote 5 — Alertas e lembretes** (v0.25.0 ·
> migração 0095): no painel da Fase 5, selos **"Atrasada"** (data prevista passou,
> não agendada) e **"Em breve"** (≤3 dias) por sessão + faixa de aviso; a Recepção
> recebe notificações (em 2º plano, deduplicadas/dia) de **sessão atrasada** e
> **plano parado** (`notify_treatment_alerts`). Falta do H4.5 só o **Pedido 3**
> (baixa parcial), que combinamos para o **H4.6**.

> **Atendimentos 2.0 (ajustes do dono, v0.24.0 · migração 0094):** na área
> "Atendimentos e sequência do tratamento" do cockpit o Planner agora (1) edita o
> **tempo** de cada sessão (`plan_session_joins.minutes_override`), (2) define a
> **sequência** dos atendimentos por **arrastar + setas** (`block_order` →
> `treatment_sessions.plan_order`, respeitado no painel e na sugestão de datas), e
> (3) vê/troca o **profissional** por sessão (`provider_override`), com aviso
> quando um atendimento tem profissionais divergentes.

> **Cockpit — Planner junta sessões (Pedido 2, v0.23.0 · migração 0093):** no
> cockpit, a área **"Atendimentos (juntar sessões)"** lista as sessões projetadas
> (via `option_session_rows`/`project_option_sessions` — mesma lógica da geração)
> e o Planner agrupa **sessão a sessão** dando o mesmo nº de atendimento
> (`plan_session_joins`). Ao iniciar o tratamento, cada sessão herda o `join_key`
> e, no painel da Fase 5, as sessões do mesmo atendimento já vêm marcadas
> ("Atendimento conjunto") — o "Agendar juntas" seleciona o grupo inteiro.
> Falta: **Lote 5** (alertas) e o **Pedido 3** (baixa parcial, no H4.6).

> **Cockpit — Planner indica o profissional (Pedido 1, v0.22.0 · migração 0092):**
> no editor do plano, cada procedimento tem "Profissional indicado" (dentistas da
> unidade do cliente). A sessão gerada herda a indicação; ao agendar, ela é
> **priorizada** na sugestão — mas só vale se o indicado **atende a unidade atual**
> do cliente (se ele mudou de unidade e o dentista não atende lá, cai na regra
> automática do Lote 3). Pedidos 2 (juntar sessões no planejamento) e 3 (baixa
> parcial, no H4.6) ainda por fazer.

> **Conserto da transferência (0.20.2 · migração 0090):** um **gatilho** move o
> plano (plano/opções/itens/etapas/sessões) para a unidade nova **sempre que a
> unidade do cliente muda** (não só via `transfer_client`), e um **backfill**
> conserta os planos de clientes **já transferidos** (que ficaram na unidade
> errada). As **considerações clínicas** passam a mostrar **autor + unidade** —
> a unidade de destino sabe que a avaliação/reavaliação foi feita na de origem.

> **Transferência A→B (0.20.1 · migração 0089):** o plano de tratamento
> (plano/opções/itens/etapas/sessões) **acompanha o cliente** — `transfer_client`
> move o plano para a unidade de destino, some da unidade A e o **Coordenador de
> B** passa a ver e a **aprovar** (recebe notificação com origem/avaliador/data;
> o Coordenador de A é avisado do handoff). A **avaliação clínica, a anamnese e
> os arquivos** ficam legíveis para a unidade atual via o histórico do cliente
> (`user_has_client_history_access`) — A mantém, B ganha; a ficha/cockpit
> carregam a anamnese de todas as unidades do histórico.

> **Perf (0.19.2):** login/troca de usuário mais rápidos — `getSessionContext`
> agora roda 1×/request (React `cache()`) em vez de 2–3×, e o aviso de
> aniversariantes saiu do render da home (roda em segundo plano). Sem migração.
> **Ajustes (0.20.0):** (1) as sessões geradas em Início de Tratamento usam o
> **nome e o tempo reais de cada sessão do protocolo** (procedure_sessions,
> unidade > rede) em vez de dividir o tempo total igualmente — migração 0088
> reescreve `ensure_treatment_sessions` (só vale para séries geradas a partir de
> agora); (2) o **resumo** do tratamento mostra **Previsto × Realizado** em
> Sessões, Tempo de cadeira e Duração; (3) o **login** não bloqueia mais na
> auditoria (best-effort em 2º plano) e não renderiza a home 2× — botão
> "Entrando..." libera mais rápido.

**FEITO (LOTE H + ajustes + Grupo 4 até H4.3):**
- **H1.1–H1.10** (bugs/segurança) · **H2.1–H2.12** (ajustes rápidos) ·
  **H3.1–H3.15 COMPLETO** (Grupo 3) · **AJ1–AJ11** (ajustes pré/pós-Grupo 4) ·
  **H4.4** (central de Planos de Tratamento).
- **GRUPO 4:**
  - **H4.1 Risartanos COMPLETO** — módulo base, foto (no cadastro), vínculo com
    cliente por CPF, vínculo com login por e-mail, multi-unidade + status por
    unidade, auditoria de acessos/ações. (migrações 0076–0081)
  - **H4.2 Anamnese 2.0 COMPLETO** — gênero do cliente; uma ficha atual por tipo
    + histórico por tipo; perguntas obrigatórias; perguntas por gênero + campos
    condicionais. (migrações 0082–0083)
  - **H4.3 Protocolo 2.0 + agendamento em série COMPLETO** — intervalo mínimo
    entre sessões; sugerir as datas de toda a série ao agendar; intervalo médio
    real + previsão de conclusão; Planner **propõe** mudança de protocolo
    definitivo (Coordenador/Admin confirmam). (migrações 0084–0086)

**EM ANDAMENTO — H4.5 Cockpit 2.0** (5 lotes): **Lote 1 — Etapas do tratamento**
✅ (v0.19.0, migração 0087) — o Planner divide cada opção do plano em **etapas**;
procedimentos e sessões agrupados por etapa. **Lote 2 — Cockpit redesenhado +
linha do tempo** ✅ (v0.19.1, sem migração) — o painel de sessões virou **linha do
tempo por etapa** com **resumo** (sessões, tempo de cadeira, intervalo médio real,
previsão de conclusão, duração prevista) e intervalo entre sessões; o cockpit do
Planner ganhou o card **"Resumo do tratamento"** (projeção por etapa). **Lote 3 —
Sugerir profissional por sessão** ✅ (v0.21.0, migração 0091) — Risartano com
**especialidades**; a ficha sugere o profissional por sessão (especialidade →
continuidade → histórico) e pré-seleciona ao agendar. **Lote 4 — Juntar sessões**
✅ (v0.21.1, sem migração) — checkbox por sessão pendente na linha do tempo +
"Agendar juntas no mesmo horário" (motor do H1.5). **Lote 5 — Alertas e
lembretes** ✅ (v0.25.0, migração 0095) — selos Atrasada/Em breve + notificações à
Recepção (sessão atrasada / plano parado). **H4.5 COMPLETO.** Ajustes do dono no
caminho: Planner indica profissional por item (0092); junta sessões no
planejamento sessão a sessão + tempo/sequência/profissional editáveis (0093–0094);
**Pedido 3** (baixa parcial) movido para o **H4.6**.

**FALTA (Grupo 4, ordem numérica):**
- **H4.6–H4.14** — ver abaixo.

**Migrações:** **0001–0090 aplicadas** (o dono confirmou); **0091–0095 pendentes**
(especialidades do Risartano).

**Pendências operacionais do dono:** `GAMMA_API_KEY` na Vercel; **limpeza de dados
de teste antes do lançamento** (manter login Admin + catálogo + fichas; backup
antes).

## GRUPO 3 — próximo (H3.1 → H3.15)

- [x] **H3.1 Formulário de agendamento reordenado** ✅ (04/07, v0.11.2) —
      cliente → tipo → profissional → sala → sessões → duração → observações →
      **data/horário/sugestões por último**, com o título "Quando será o
      atendimento?" abrindo a etapa final.
- [x] **H3.2 "Ver agenda" rica** ✅ (04/07, v0.11.3) — pop-up do mês mostra por
      dia: nº de agendamentos, nº de **horários livres** (verde/vermelho, para o
      profissional/sala/duração do formulário), feriados (decidido/a confirmar),
      fechados, dias avulsos e bloqueios do planejamento anual (com legenda);
      dias fechados/bloqueados não são clicáveis; clicar num dia disponível
      preenche a data e o seletor lista os horários livres. Action
      `getMonthAgendaPeek` substituiu `getMonthDayCounts`.
- [x] **H3.3 Seletor de dias [M]** ✅ (04/07, v0.11.4) — régua rolável
      (`day-strip.tsx`, 42 dias a partir de hoje) no topo da agenda: por dia,
      bolinha verde (tem sala livre) / vermelha (lotado), nº de agendamentos,
      Fechado/Feriado/Avulso/Bloqueado evidentes, tooltip com o motivo e
      legenda; clicar abre a visão Dia daquela data (preserva filtro de salas).
- [x] **H3.4b Atendimento não resolvido carrega para o dia (v0.11.8, migração
      0065)** — pendências de dias anteriores (a chegar / em espera / em
      atendimento) são **trazidas para o painel de hoje** com selo vermelho
      **"Pendente desde DD/MM"** (registra o dia de origem) + banner; um
      **"em atendimento" não concluído bloqueia a cadeira e o profissional**
      (`PROVIDER_BUSY`/`ROOM_BUSY` em `update_attendance`): não dá para chamar
      outro cliente naquela sala/profissional até concluir — força resolver.
- [x] **H3.4 Status de atendimento** ✅ (04/07, v0.11.5, migração 0063) —
      "A chegar" ganhou menu **Faltou / Cancelou em cima da hora**; "Em espera"
      ganhou **Desistiu** (estado `gave_up` → status cancelado + aviso ao
      profissional; aparece nos Concluídos com selo vermelho); **limite de
      espera configurável** (Configurar agenda, padrão 20 min) — acima dele o
      timer fica vermelho "Espera longa" e `notify_attendance_alerts` dispara
      avisos que **repetem a cada 15 min** (recepção/coordenador/gerente/
      profissional, dedupe pelo link); atendimentos de **dias anteriores** não
      concluídos geram aviso diário + banner vermelho no painel.
- [x] **H3.5 Check-in com confirmação** ✅ (04/07, v0.11.6) — "Registrar
      chegada" abre um pop-up confirmando **cliente, horário/tipo, profissional
      e sala** antes de concluir (SELECT do painel ganhou sala/ONLINE). Prepara
      o auto check-in do cliente no futuro.
- [x] **H3.6 Troca de profissional de última hora** ✅ (04/07, v0.11.7,
      migração 0064) — "Trocar profissional" no A chegar / Em espera
      (recepção/gerente/admin) → escolhe outro profissional (filtrado pela
      função do tipo) + motivo; RPC `swap_appointment_provider` grava em
      `appointment_provider_swaps`, valida conflito de horário e notifica o
      profissional anterior, o novo, o coordenador e a gerente; ≥5 trocas no
      mês na unidade disparam alerta de frequência a coordenador/gerente.
- [x] **H3.7 Visibilidade da SDR** ✅ (04/07, v0.11.9, migração 0066) — função
      `sdr_accessible_client_ids()` (clientes que a SDR cadastrou/editou/
      agendou/transferiu); Prontuários e Jornada da SDR "pura" passam a mostrar
      só esse conjunto; a **ficha** bloqueia cliente que não é dela ("Acesso
      restrito"); a **Agenda continua completa**, mas o nome de cliente que não
      é da SDR aparece **sem link** (decisão do dono: mostrar o nome, não abrir
      a ficha). `isSdrRestricted` só restringe a SDR "pura" (sem outro papel
      amplo).
- [x] **H3.8 WhatsApp aniversariantes** ✅ (04/07, v0.12.0) — painel
      "Parabenizar por WhatsApp" na aba Aniversariantes (mensagem editável com
      `{nome}` + botão por cliente = individual e em massa) e botão
      "Parabenizar no WhatsApp" no prontuário quando é o aniversário hoje;
      `src/lib/whatsapp.ts` (wa.me com 55+DDD). Envio manual; automação = Fase 3.
- [x] **H3.9 Notificações ampliadas** ✅ (04/07, v0.12.1, migração 0067) — a
      transferência passa a notificar SEMPRE a unidade de DESTINO (Recepção,
      Gerente e Coordenador: "Cliente transferido para a sua unidade"), além da
      origem que já era avisada; o compartilhamento já notificava os 3 papéis
      das duas unidades (0038). Só mudança de banco (`transfer_client`).
- [x] **H3.10 Fluxo pós-avaliação do Coordenador** ✅ (04/07, v0.12.2, migração
      0068) — "Enviar ao Centro de Planejamento" agora (a) **conclui o
      atendimento em curso** do cliente automaticamente e avisa a Recepção
      p/ agendar a apresentação (`send_to_planning_followup`), e (b) abre um
      **pop-up** oferecendo agendar a apresentação comercial (recepção/SDR
      agenda ali; senão avisa que a Recepção foi notificada). Action
      `sendToPlanningCenter`.
- [x] **H3.11 Informações complementares** ✅ (04/07, v0.12.3, migração 0069) —
      card "Informações complementares ao Centro de Planejamento" na ficha
      (Coordenador escreve → `add_planning_supplement` notifica o Planner);
      tabela `planning_supplements`; na fila `/planejamento` o cliente ganha o
      selo "nova info" até o Planner abrir o cockpit (que mostra as infos e
      chama `mark_planning_supplements_seen`).
- [x] **H3.12 Mídias: excluir, renomear e anotar** ✅ (04/07, v0.12.4, migração
      0070; ajustes v0.12.5) — cada foto/arquivo ganhou **nome editável** +
      **anotação** (colunas `display_name`/`note` + policy de update;
      `updateClinicalMedia`) na galeria (lista, grid de fotos com selo de
      anotação e no lightbox); **excluir** por foto/arquivo. Coordenador/Admin
      editam; tudo auditado. **Ajustes (v0.12.5):** botão excluir também em cada
      **foto** do grid; corrigido o bug de foco no editor (digitava 1 letra por
      vez — os subcomponentes viraram funções `renderX`); editor reorganizado
      com rótulos; confirmação de exclusão virou **diálogo do sistema** (não o
      `window.confirm` do navegador). **Ajuste v0.12.6:** editar virou um **pop-up**
      com a **prévia da foto/arquivo** e campos grandes (nome + anotação com 5
      linhas) — o editor inline espremido na coluna da foto saiu.
- [x] **H3.13 Centro/cockpit — melhorias leves** ✅ (04/07, v0.12.7) — card de
      **Anamnese** (leitura) no cockpit com alertas; **filtros por unidade e por
      pilar** na fila `/planejamento`; as duas colunas do cockpit têm **rolagem
      independente** (não rola a página inteira). (Redesign completo = H4.5.)
- [x] **H3.14 Sessões com data + profissional** ✅ (06/07, v0.12.8) — no card
      "Sessões do tratamento" da ficha, a sessão agendada mostra **quando e com
      quem** ("DD/MM às HH:MM · Profissional") e é **clicável → abre os detalhes
      do agendamento** (data, horário, local, profissional, situação). Sem
      migração.
- [x] **H3.15 Comercial: prontos para apresentação** ✅ (06/07, v0.12.9,
      migração 0071) — ao enviar o caso à Conversão Comercial, o sistema
      verifica se há apresentação comercial **futura agendada**: avisa
      Consultor + Assistente (com a data, ou "sem apresentação"); se **não**
      houver, dispara **aviso forte à recepção** + avisa **gerente e
      coordenador**. `/planos` ganha **banner vermelho** + selo "sem
      apresentação" nas linhas da fase comercial. Nova categoria **Comercial**
      na central de notificações.

**GRUPO 3 (H3.1–H3.15) COMPLETO.**

## AJUSTES PRÉ-GRUPO 4 (feedback do dono, antes dos módulos novos)

- [x] **AJ1 Excluir cadeira (só Admin)** ✅ (06/07, v0.12.10, migração 0072) —
      o Admin exclui uma cadeira (soft delete): some do agendamento futuro, mas
      os agendamentos passados mantêm a cadeira marcada "(excluída)". Botão só
      para o Admin; mantém ≥1 cadeira viva; lista de excluídas na config.
- [x] **AJ1b Cadeiras numa casa só** ✅ (06/07, v0.12.11, sem migração) — as
      cadeiras deixam de aparecer em 3 lugares: removido o campo "Cadeiras"
      (número, legado) de `/admin/agenda` e o campo do **cadastro da clínica**;
      o **limite máximo** virou um campo **só do Admin** dentro de "Configurar
      agenda", junto da lista de cadeiras. Agora tudo sobre cadeiras vive em
      "Configurar agenda".
- [x] **AJ2 Agendamento fora do horário — permite com alerta** ✅ (06/07,
      v0.12.12, migração 0073) — o **início** tem de estar dentro do horário; o
      **fim pode passar** do fechamento ou avançar sobre o almoço. Quem agenda
      recebe um **alerta** (toast) e o **profissional** recebe uma **notificação**
      (RPC `notify_appointment_overrun`). Seletor de horário e regras do servidor
      atualizados juntos.
- [x] **AJ3 Comercial agendado SEM plano pronto — destaque + cronômetro** ✅
      (06/07, v0.12.13, sem migração) — componente `PresentationCountdown`
      (regressivo, vermelho a <2 dias) na **fila do /planejamento**, no **cockpit**
      (banner "apresentação marcada e plano não pronto") e no **/planos** (banner
      + cronômetro nas linhas em planejamento/aprovação). Cobre Consultor
      (via /planos), Planner e Coordenador.
- [x] **AJ4 Alerta clicável + "Pedir agendamento" + pop-up recepção** ✅ (06/07,
      v0.12.14, migração 0074) — o banner vermelho de `/planos` vira **clicável →
      filtra** só os casos sem apresentação; cada linha ganha **"Pedir
      agendamento"** (RPC `request_commercial_scheduling`, com dedup) que avisa a
      recepção; a recepção vê um **pop-up** (`UrgentSchedulingPopup`, verifica a
      cada 45s) com "Abrir agenda" / "Já agendei".
- [x] **AJ5 Vitrine "Prontos para apresentar" p/ o Consultor** ✅ (06/07,
      v0.12.15, sem migração) — card destacado (dourado) no topo de `/planos`
      com os casos na fase comercial, selo **"novo"** (entrou há <3 dias),
      contador de novos e acesso rápido (**Apresentação** p/ o Consultor +
      **Ver plano**); marca também os que estão sem apresentação.

**AJUSTES PRÉ-GRUPO 4 COMPLETOS (AJ1–AJ5).**

## AJUSTES 2 PRÉ-GRUPO 4 (2ª rodada de feedback)

- [x] **AJ6 Pop-up da recepção organizado** ✅ (06/07, v0.12.16, sem migração) —
      altura limitada + rolagem + nome do cliente enxuto + botão **"Marcar todos
      como agendados"** (`markNotificationsRead`) para não bagunçar com vários.
- [x] **AJ7 Liberar horário/período avulso** ✅ (07/07, v0.12.21, sem migração)
      — "Liberar dia avulso" agora também **estende o horário de um dia normal**:
      num dia normal, o dia avulso **une** com o horário normal (começar antes /
      terminar depois); fim opcional (vazio = até a abertura); bloqueia liberar o
      que já é normal; mesma notificação; segue com a Gerência. Helper
      `effectiveDayHours` aplicado no servidor (checkAgendaRules), seletor de
      horário, sugestões, faixa de dias e visão Dia. (Visão Semana: agendamentos
      estendidos aparecem; refino da faixa cinza fica p/ a rodada visual.)
- [x] **AJ8 Marcar visualmente horários não permitidos** ✅ (06/07, v0.12.18,
      sem migração) — faixas cinza tracejadas (antes da abertura / depois do
      fechamento) na visão Dia e Semana, como o almoço em âmbar.
- [x] **AJ9 Primeiro horário não some** ✅ (06/07, v0.12.18, sem migração) —
      `TOP_PAD_PX` no topo da grade (Dia e Semana) para o primeiro horário não
      colar na linha do cabeçalho.
- [x] **AJ10 Linha do tempo (faixa de dias)** ✅ (06/07, v0.12.19, sem migração)
      — faixa de 30 dias de passado + 365 à frente; abre no dia de hoje; navega
      com o **scroll do mouse**; mês em **todos os dias** (v0.12.20). Dia com agenda **toda fechada**
      mostra **o motivo** (não "lotado"); **fechamento parcial** (sala/profissional/
      período) vira **alerta de atenção** (âmbar). Divide `DayStrip` (dados,
      servidor) + `DayStripView` (rolagem, cliente).
- [x] **AJ11 Consultor recebe notificação** ✅ (06/07, v0.12.17, migração 0075) —
      `move_client_phase` agora avisa Consultor/Assistente via
      `providers_with_access` (inclui os da Franqueadora com escopo — antes o
      consultor da matriz não recebia nada); e novo RPC
      `notify_commercial_presentation` avisa o Consultor quando uma apresentação
      é agendada (para cobrar o Centro de Planejamento).

**AJUSTES 2 PRÉ-GRUPO 4 COMPLETOS (AJ6–AJ11).** Próximo: GRUPO 4 (módulos novos).

## GRUPO 4 — módulos novos (H4.1 em diante; H4.4 ✅)

- [~] **H4.1 Risartanos [G] 🗄️** — cadastro do colaborador. Acesso: Admin +
      Gerente + Franqueadora (RH).
  - [x] **Lote 1 — módulo base** ✅ (07/07, v0.13.0, migração 0076) — tabela
        `staff_members` (+ código automático `RIS-0000`, RLS), tela `/risartanos`
        (lista + busca + filtros unidade/regime/situação), cadastro/edição com
        todos os campos (dados pessoais, cônjuge, contato, endereço, regime
        CLT/PJ/Estagiário/Autônomo, cargo, "como quer ser chamado"),
        ativar/inativar e **histórico de alterações** (`staff_member_changes`).
        Menu: `/admin/usuarios` relabelado "Usuários (acesso)"; novo "Risartanos".
  - [x] **Lote 1b — foto** ✅ (07/07, v0.13.1, migração 0077) — bucket privado
        `staff-photos` (RLS por unidade), upload no navegador + URL assinada;
        avatar na lista e no cadastro; trocar/remover foto.
  - [x] **Lote 2 — vínculo com cliente** ✅ (07/07, v0.14.0, migração 0078) —
        liga `clients` ao `staff_members` pelo CPF via gatilhos automáticos
        (`staff_member_id`, `risartano_active`); cadastro de cliente autopreenche
        com os dados de RH (`lookup_risartano_by_cpf`, escopo por unidade); a
        ficha destaca **"★ É um Risartano"** / **"★ Ex-Risartano (inativo)"**; a
        inativação/reativação do colaborador é registrada no histórico do
        prontuário (`client_changes`).
  - [x] **Ajustes multi-unidade** ✅ (08/07, v0.14.2, migração 0080) —
        permissão corrigida (Gerente/Franqueado cadastram só na unidade ativa;
        Admin e Franqueadora/RH escolhem a unidade; recepção bloqueada);
        **cargo/função vem do acesso** (por unidade, não é mais campo); cônjuge
        só quando casado(a)/união estável; **todos os campos obrigatórios**;
        **não cria dois Risartanos** (bloqueio por CPF na rede); cadastro
        **visível às unidades vinculadas** com a lista Unidade→Cargo
        (`can_see_staff`/`can_manage_staff` na RLS).
  - [x] **Ajuste multi-unidade (visibilidade + status por unidade)** ✅ (08/07,
        v0.15.1, migração 0081) — corrigido o bug de a lista filtrar pela
        "unidade de origem" (agora a RLS é que escopa → aparece para o Gerente de
        TODA unidade onde o Risartano tem acesso); lista e cadastro mostram
        **todas as unidades** (com "outra unidade" para as que o gestor não gere);
        **status Ativo/Inativo por unidade** (`inactive_unit_ids` +
        `setStaffUnitActive`) — inativar numa unidade não afeta as demais.
  - [x] **Lote 2b — vínculo com o usuário de acesso** ✅ (07/07, v0.14.1,
        migração 0079) — `staff_members.user_id` ligado a `profiles` por
        **e-mail** (gatilhos + backfill; nome sincroniza nos dois sentidos);
        tela Risartanos ganhou coluna **Acesso** (com/sem login, "Login ainda
        ativo" quando o colaborador está inativo) e seção *Acesso ao sistema*
        no cadastro (Admin: **Criar acesso** pré-preenchido, **Vincular usuário
        existente**, Desvincular, Gerenciar acesso); tela `/admin/usuarios`
        corrigida para "Usuários (acesso)" + coluna **Risartano** (código RIS
        com link) + aviso "colaborador inativo" no editor. Pré-requisito do
        Lote 3.
  - [x] **Lote 3 — auditoria** ✅ (08/07, v0.15.0, sem migração) — tela
        `/admin/auditoria` (só Admin): **últimos acessos** (last_sign_in_at via
        service role) + **registro de atividades** da trilha `audit_logs` com
        filtros (colaborador / ação / tipo de registro / período) e rótulos
        pt-BR (`src/lib/audit-labels.ts`); **login passa a ser registrado**
        (`recordLogin` no formulário → ação `login`); atalho "Ver auditoria" no
        cadastro do Risartano. **H4.1 COMPLETO.**
- [x] **H4.2 Anamnese 2.0 [G] 🗄️ COMPLETO** — múltiplas fichas (1 por tipo; atualizar
      não troca o tipo); perguntas obrigatórias; perguntas por gênero
      (pré-requisito: campo gênero no cliente — item adiado entra aqui);
      respostas com opções; campos condicionais; histórico.
  - [x] **Lote 1 — gênero do cliente** ✅ (08/07, v0.16.0, migração 0082) —
        campo **gênero** no cadastro/ficha do cliente (`clients.gender`,
        `src/lib/gender.ts`) + autopreenchimento por CPF; base das perguntas por
        gênero (Lote 3).
  - [x] **Lote 2 — uma ficha atual por tipo + obrigatórias + histórico por
        tipo** ✅ (08/07, v0.16.1, sem migração) — o prontuário mostra **uma
        ficha atual por tipo** (Geral, Ortodôntica…), cada uma com seu próprio
        histórico; **Atualizar** cria nova versão **no mesmo tipo** (o seletor de
        tipo saiu do modo edição); **Preencher outra ficha** para tipos ainda não
        preenchidos; perguntas obrigatórias já eram exigidas ao salvar; "sem
        alterações" agora compara com a última versão do mesmo tipo.
  - [x] **Lote 3 — perguntas por gênero + campos condicionais** ✅ (08/07,
        v0.17.0, migração 0083) — cada pergunta pode ser **direcionada a um
        gênero** (usa `clients.gender`) e/ou **condicional** (só aparece se a
        pergunta gatilho foi respondida de um jeito); construtor com o bloco
        "Exibição"; preenchimento mostra/esconde as perguntas dinamicamente e só
        salva/valida as visíveis (`isQuestionVisible` em `src/lib/anamnesis.ts`;
        colunas `gender`/`condition_question_id`/`condition_values`).
- [x] **H4.3 Protocolo 2.0 + agendamento em série [G] 🗄️ COMPLETO** — tempo mínimo
      entre sessões (rede → caso); médias reais do intervalo; previsão de
      conclusão; sugerir as datas de TODAS as sessões ao agendar; Planner
      propõe mudança de protocolo (unidade com confirmação + notificação ao
      coordenador; rede → notifica Admin).
  - [x] **Lote 1 — intervalo mínimo entre sessões no protocolo** ✅ (08/07,
        v0.17.1, migração 0084) — `procedure_sessions.min_interval_days` (dias
        após a sessão anterior; null na 1ª), editável em Procedimentos por sessão
        (rede/unidade, cascata); resumo do protocolo mostra "a cada X dias"
        (`intervalSummary` em `src/lib/pricing.ts`). Base do Lote 2.
  - [x] **Lote 2 — sugerir as datas de TODAS as sessões ao agendar** ✅ (08/07,
        v0.17.2, migração 0085) — `treatment_sessions.planned_date`; ação
        `suggestTreatmentSeries` (data inicial → datas de toda a série pelo
        intervalo mínimo do protocolo, pulando dias fechados/feriados); painel
        de sessões mostra "prevista DD/MM" e o **Agendar** já abre na data
        sugerida (`initialDate`).
  - [x] **Lote 3 — médias reais do intervalo + previsão de conclusão** ✅ (08/07,
        v0.17.3, sem migração) — no painel de sessões: **intervalo médio real**
        entre as sessões já feitas do paciente (datas dos agendamentos) e
        **previsão de conclusão** (última data entre as sessões não concluídas —
        agendadas + previstas; marca "parcial" se faltam datas).
  - [x] **Lote 4 — Planner propõe mudança de protocolo** ✅ (08/07, v0.18.0,
        migração 0086) — o protocolo do **caso** segue direto no plano; o
        protocolo **definitivo** o Planner só **propõe** (`protocol_change_proposals`):
        unidade → notifica/confirma **Coordenador**; rede → **Admin** (RPCs de
        notificação). Editor mostra "Propor alteração" (+ justificativa) ao
        Planner; painel "Propostas pendentes" em `/procedimentos` com
        Aprovar/Recusar; RLS tira do Planner a escrita direta do protocolo.
- [x] **H4.4 Tela de Planos de Tratamento** ✅ (v0.11.1).
- [ ] **H4.5 Cockpit 2.0 [G] 🗄️** — redesign; etapas + sessões; sugerir
      profissional; juntar sessões; tempo por/entre sessões; previsão de
      término; alertas/lembretes por sessão e do plano.
  - [x] **Lote 1 — Etapas do tratamento** ✅ (v0.19.0, migração 0087) — o Planner
        divide cada opção em **etapas** (`treatment_plan_stages`, item
        `stage_id`); editor agrupa os procedimentos por etapa (adicionar/
        renomear/mover/remover; mover item de etapa); as sessões herdam a etapa
        (`treatment_sessions.stage_name/stage_order`, `ensure_treatment_sessions`)
        e o painel de sessões / cockpit agrupam por etapa.
  - [x] **Lote 2 — Cockpit redesenhado + linha do tempo** ✅ (v0.19.1, sem
        migração) — o painel do prontuário virou **linha do tempo por etapa**
        (`treatment-sessions-panel`): resumo (sessões, tempo de cadeira, intervalo
        médio real, previsão de conclusão, duração prevista início→término),
        cabeçalho por etapa (sessões · tempo · janela de datas) e o intervalo em
        dias entre uma sessão e a anterior; o cockpit do Planner ganhou o card
        **"Resumo do tratamento"** (`treatment-summary.tsx`), projeção por etapa
        da opção principal (sessões + tempo de cadeira). Reaproveita a H4.3.
  - [x] **Lote 3 — Sugerir profissional por sessão** ✅ (v0.21.0, migração 0091) —
        o Risartano ganhou **especialidades** (`staff_members.specialties`,
        marcadas no cadastro a partir das especialidades dos procedimentos); a
        ficha (Fase 5) sugere, por sessão, o profissional (especialidade
        cadastrada → continuidade do tratamento → histórico de quem executou na
        unidade) e o **pré-seleciona** ao agendar (`initialProviderId`).
  - [x] **Lote 4 — Juntar sessões no mesmo horário** ✅ (v0.21.1, sem migração) —
        o motor já existia (H1.5: um agendamento vincula N sessões e a conclusão
        rateia o tempo); agora a **linha do tempo** do tratamento tem **checkbox
        por sessão pendente** e a barra **"Agendar juntas no mesmo horário"** que
        abre o agendamento com as sessões pré-marcadas, a **duração somada** e o
        profissional sugerido pré-selecionado (`AppointmentFormDialog.initialSessionIds`).
  - [x] **Lote 5 — Alertas e lembretes (sessão e plano)** ✅ (v0.25.0, migração
        0095) — selos "Atrasada"/"Em breve" por sessão + faixa de aviso no painel;
        notificações à Recepção (2º plano, deduplicadas/dia): sessão atrasada e
        plano parado (`notify_treatment_alerts`, disparado no `BirthdayNotifier`).
        **H4.5 COMPLETO** (falta só o Pedido 3 do dono, movido para o H4.6).
- [x] **H4.6 Módulo do Dentista [G] 🗄️ COMPLETO** — a "casa" do dentista executor.
      Plano detalhado e aprovado (10/07). Ordem: **A1 → A2 → A3 → B1/B2 → B3 →
      C → D → E** (E = agenda multi-unidade, vira item próprio depois). Decisões:
      quadro "O que foi feito hoje?" sempre que houver sessões; só o Dentista
      (ou Admin) confirma a baixa; motivo opcional; tela nova "Meu Dia";
      prontuário só dos pacientes que ele atende; reavaliação só sugere/avisa o
      Coordenador; revisão do plano avisa o Coordenador com alerta insistente.
      Integrações adiadas (não esquecer): prescrição digital/Memed, base de
      medicamentos, envio externo, NPS por dentista, push semanal.
  - [x] **A1 — Baixa PARCIAL das sessões + alerta à Recepção** ✅ (v0.35.0,
        migração 0105) — ao concluir um atendimento COM sessões, abre "O que foi
        feito hoje?": só o Dentista/Admin confirma quais sessões foram feitas;
        as confirmadas são liquidadas (tempo real rateado só entre elas), as não
        feitas voltam para "a agendar" (motivo opcional) e a Recepção é avisada
        (`conclude_attendance_partial`; `treatment_sessions.reopen_reason/
        reopened_at/reopened_by`; diálogo no painel de Atendimento).
  - [x] **A2 — Desenvolvimento Clínico** ✅ (v0.36.0, migração 0106) — no
        prontuário, o Dentista escreve as anotações do atendimento com
        **salvamento automático** (selo "Salvo às HH:MM"); as anotações formam
        uma **linha do tempo** (autor + unidade + data) visível a dentistas,
        Coordenador e Planner. `clinical_progress_notes` (RLS espelha a anamnese:
        libera o dentista, que `user_full_access_clinic_ids` não cobre) +
        `saveProgressNote` + `clinical-progress-section`. Sem DELETE (registro
        clínico, append-only).
  - [x] **A3 — Procedimentos do cliente** ✅ (v0.37.0, migração 0107) — seção
        "Procedimentos" no prontuário agrupando as sessões do tratamento em **Em
        aberto / Agendados / Finalizados** (agendados mostram data + profissional;
        finalizados mostram quando + quem concluiu). O Dentista tem o botão
        **"Solicitar agendamento à Recepção"** (`request_session_scheduling`,
        notifica a Recepção 1x/dia; `client-procedures-section`). Visível a
        dentista/coordenador/recepção/gestão/planner/admin.
  - [x] **B1/B2 — "Meu Dia" + prontuário do dentista + plano resumido** ✅
        (v0.38.0, sem migração) — **B1:** rota `/meu-dia` (item no menu p/ quem é
        dentista na unidade) com Hoje / Próximos (14 dias) / Procedimentos em
        aberto destinados a ele (`planner_provider_id`). **B2:** prontuário do
        dentista já é restrito aos pacientes que ele atende **pela RLS**
        (`clients_select_member` libera pelo agendamento como profissional) —
        adicionada a mensagem amigável "Acesso restrito" (`isDentistRestricted`);
        e o **plano resumido SEM valores** (`plan-summary-section`: diagnóstico +
        objetivos + procedimentos por etapa, profissional indicado) para o
        dentista, que não vê a PlanningSection com orçamento.
  - [x] **B3 — Dashboard de produção do dentista** ✅ (v0.39.0, sem migração) —
        bloco "Minha produção" na tela Meu Dia com filtro de período (Hoje/
        Semana/Mês/específico): atendimentos concluídos, sessões finalizadas,
        tempo em cadeira (realizado × previsto pela rede = actual×planned),
        espera média do cliente (check-in→chamada), procedimentos em aberto,
        atendimentos futuros e NPS ("ainda não disponível" até a Fase 2).
  - [x] **C — Documentos clínicos** ✅ (v0.40.0, migração 0108) — o Dentista/
        Coordenador emite **prescrição, atestado, declaração e orientações** no
        prontuário (seção "Documentos"): escolhe o tipo, um **modelo** (opcional)
        e ajusta o texto; ao emitir, abre a versão para **impressão / salvar em
        PDF** (rota `/documentos/[id]/imprimir`, fora do `(app)`, sem barra
        lateral). Modelos em `document_templates` (cascata: rede/franqueadora +
        unidade; seeds de orientações/atestado/declaração); documentos em
        `clinical_documents` (append-only, RLS espelha os registros clínicos).
        Tela **`/admin/documentos`** (Admin) para a franqueadora criar/editar/
        (des)ativar os modelos da rede. **Simples de propósito:** sem assinatura
        digital/Memed nem envio externo (adiado — [[risarte-h46-deferred-integrations]]).
  - [x] **D — Falar com quem planeja** ✅ (v0.41.0, migração 0109) — seção
        "Pedidos ao coordenador" no prontuário: o Dentista **sugere reavaliação**
        (avisa o Coordenador; não move de fase) e **pede revisão do plano** com
        **alerta insistente** (faixa fixa no cliente + re-aviso diário ao
        Coordenador via `notify_insistent_requests` no `BirthdayNotifier`, até
        ser resolvido). Ambos com **anexos** (foto/vídeo/áudio/RX) no bucket
        `clinical-media` (storage liberado p/ o dentista). O Coordenador
        **resolve** (avisa quem pediu). `clinical_requests` +
        `clinical_request_media` + RPCs `create_/resolve_clinical_request`.
  - **E — Agenda multi-unidade do dentista** (4 partes; aviso forte de conflito,
        não bloqueio):
    - [x] **E1 — Dias prioritários por unidade** ✅ (v0.45.0, migração 0112) — no
          cadastro do Risartano, botão "Dias" (por dentista) abre um diálogo para
          definir, em cada unidade que ele atende, os **dias da semana** + **datas
          específicas** + nota. `staff_clinic_schedule` (Admin/Gerente editam);
          `saveStaffSchedule`; `staff-schedule-dialog`. (Quinzenal/X-por-mês via
          nota por ora.)
    - [x] **E2 — Aviso de conflito entre unidades** ✅ (v0.46.0, migração 0113) —
          ao agendar um dentista, se ele já tem atendimento em OUTRA unidade no
          mesmo dia, o formulário mostra um **aviso vermelho** à Recepção (não
          bloqueia) e, ao agendar, o Dentista é **notificado**. Também avisa
          (âmbar) se o dia não é dia dele nesta unidade (E1). RPCs SECURITY
          DEFINER `provider_cross_unit_check` (formulário) e
          `notify_provider_cross_unit` (chamado no `createAppointment`).
    - [x] **E3 — Agenda consolidada multi-unidade** ✅ (v0.47.0, migração 0114) —
          rota `/minha-agenda` (menu do dentista): a semana com os atendimentos
          de TODAS as unidades numa só tela, **cor por unidade** + filtro por
          unidade + navegação de semana. RPC SECURITY DEFINER
          `provider_multi_unit_agenda` (traz só os atendimentos do próprio
          dentista em todas as unidades).
    - [x] **E4 — Previsão semanal** ✅ (v0.48.0, migração 0115) — o informativo
          dos próximos atendimentos é a tela "Minha Agenda" (E3); o E4 acrescenta
          o **aviso proativo no fim de semana** (sáb/dom) com a **próxima semana**
          (nº de atendimentos + unidades), disparado ao abrir o Meu Dia (2º plano),
          deduplicado por semana, apontando para Minha Agenda. `notify_weekly_forecast`
          + `WeeklyForecastNotifier`. Sem envio externo (adiado). **Bloco E COMPLETO
          → H4.6 (Módulo do Dentista) COMPLETO.**
- [ ] **H4.7 Atendimento conjunto [G] 🗄️** — 2+ profissionais no mesmo
      atendimento (agenda de todos, 1 sala, responsável principal por tipo,
      limite = nº de cadeiras).
- [ ] **H4.8 Planejamento anual da rede [M/G] 🗄️** — feriados/eventos/
      campanhas da franqueadora com flag "decisão travada ou da unidade";
      almoço padrão da rede (cascata).
- [ ] **H4.9 Chat interno [G] 🗄️** — canal da unidade + 1:1; franqueadora ↔
      unidade conectadas; pop-up + som; áudio/arquivos; insiste até visualizar;
      recibo de leitura; histórico. Supabase Realtime; dividir em lotes
      (texto → arquivos → som/insistência).
- [x] **H4.10 Prontuário em abas + menu fixo [M]** ✅ (v0.43.0, sem migração) —
      barra lateral **fixa** (sticky, sempre visível ao rolar); ficha do cliente
      em **abas** (`prontuario-tabs`: Cadastro · Jornada · Clínico · Plano ·
      Sessões & Procedimentos · Documentos · Pedidos · Histórico), abas vazias
      não aparecem, estado dos editores preservado (esconde em vez de desmontar).
- [ ] **H4.11 Apresentação 2.0 + fotos no Gamma [M]** — layout mais rico e
      responsivo; testar fotos no Gamma via links assinados embutidos no texto;
      padrão visual dos decks.
- [x] **H4.12 Câmera intraoral [M]** ✅ (v0.44.0, migração 0111) — na aba
      Clínico, botão "Capturar da câmera": escolhe a câmera (getUserMedia +
      enumerateDevices), tira a foto e salva direto no prontuário (bucket
      clínico, link assinado). Coordenador E Dentista (0111 libera o dentista na
      `clinical_media`: select+insert; storage já liberado na 0109). Exige
      consentimento e HTTPS. `clinical-images-section` + `recordCameraCapture`.
- [ ] **H4.13 Especialidades + comissionamento [M] 🗄️** — cadastro de
      especialidades (lista padronizada, como o pilar); reajuste em massa do
      comissionamento fixo; regra "comissão só com procedimento finalizado"
      documentada (aplicação = módulo financeiro, Fase 2).
- [x] **H4.14 Definições de status [P]** ✅ (v0.42.0, migração 0110) — na Fase 5,
      "Início de Tratamento" = plano aprovado e nada executado; passa a "Em
      Tratamento" **automaticamente** quando a 1ª sessão recebe baixa (gatilho
      `mark_in_treatment` em treatment_sessions; o status já era definido como
      "Aguardando Iniciar Tratamento" ao entrar na fase pela 0017). Consistente
      em Jornada/Agenda/ficha, sem marcação manual.

## Fora do LOTE H (não esquecer)

| Item | Quando |
|---|---|
| Limpeza dos dados de teste (mantém Admin do dono + catálogo/fichas; backup antes; script avulso, NÃO em migrations/) | Antes de publicar na web (adiado pelo dono) |
| Rodada de refinamento visual (tela por tela, dono guiando) | Depois do LOTE H |
| Fase 2 Comercial: apresentação gravada, ZapSign, ASAAS (regra de ouro), NPS, dashboards com metas | Depois do MVP validado |
| Fase 3: WhatsApp automático, transcrição/resumo por IA | Depois da Fase 2 |
| Adiados antigos: semana começando no domingo; esconder fim de semana vazio; offline/PWA | Encaixar quando fizer sentido |

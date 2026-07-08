# Roadmap de construção — o que falta e como será feito

_Criado em 04/07/2026, após o teste geral do MVP e a entrega dos Grupos 1, 2 e
do H4.4. **Ordem decidida pelo dono:** H3.1 → H3.15 em sequência numérica,
depois H4.1 → H4.14 (pulando o H4.4, já entregue)._

Legenda: **[P]** pequeno (horas) · **[M]** médio (1 lote) · **[G]** grande
(vários lotes) · 🗄️ = precisa de migração no banco.

> Itens detalhados também em `docs/BACKLOG.md` (LOTE H). Ao concluir um item,
> marcar lá E atualizar este arquivo. Cada lote segue o ritual: plano curto →
> OK do dono → código → build+lint → commit → roteiro de teste numerado.

## Onde estamos (07/07/2026) — versão 0.13.0 · migração 0076

**FEITO (LOTE H completo + ajustes + início do Grupo 4):**
- **H1.1–H1.10** (bugs/segurança) · **H2.1–H2.12** (ajustes rápidos) ·
  **H4.4** (central de Planos de Tratamento).
- **GRUPO 3 — H3.1–H3.15 COMPLETO** (agendamento reordenado; "ver agenda" rica;
  faixa de dias; fluxo de atendimento/carry-forward; check-in; troca de
  profissional; SDR vê clientes que tocou; aniversário WhatsApp; transferência
  notifica destino; enviar ao Planejamento conclui atendimento; informações
  complementares; mídias renomear/anotar/excluir; cockpit anamnese+filtros;
  sessões com data/profissional clicável; comercial "prontos para apresentação").
- **AJUSTES pré-Grupo 4 (AJ1–AJ5)**: excluir cadeira (soft delete); cadeiras numa
  casa só; agendamento fora do horário com alerta; comercial sem plano pronto
  (cronômetro); alerta clicável + pop-up recepção; vitrine "prontos p/ apresentar".
- **AJUSTES 2 (AJ6–AJ11)**: pop-up recepção organizado; Consultor recebe
  notificações; horários fora do expediente marcados + respiro no topo; linha do
  tempo (passado/1 ano, scroll, motivo do fechamento); liberar horário avulso
  (estender dia).
- **GRUPO 4 — H4.1 Risartanos**: módulo base (Lote 1), foto (Lote 1b) e
  **vínculo com o cliente por CPF (Lote 2)**.

**FALTA (Grupo 4, ordem H4.1→H4.14):**
- **H4.1** Lote 3 (auditoria de acessos/ações por colaborador).
- **H4.2–H4.14** — ver abaixo.

**Pendências operacionais do dono:** aplicar as migrações **0072–0078** (se ainda
não rodou alguma); `GAMMA_API_KEY` na Vercel; **limpeza de dados de teste antes do
lançamento** (manter login Admin + catálogo + fichas; backup antes).

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
  - [ ] **Lote 3 — auditoria** de acessos/logins e ações (por colaborador com
        login vinculado).
- [ ] **H4.2 Anamnese 2.0 [G] 🗄️** — múltiplas fichas (1 por tipo; atualizar
      não troca o tipo); perguntas obrigatórias; perguntas por gênero
      (pré-requisito: campo gênero no cliente — item adiado entra aqui);
      respostas com opções; campos condicionais; histórico.
- [ ] **H4.3 Protocolo 2.0 + agendamento em série [G] 🗄️** — tempo mínimo
      entre sessões (rede → caso); médias reais do intervalo; previsão de
      conclusão; sugerir as datas de TODAS as sessões ao agendar; Planner
      propõe mudança de protocolo (unidade com confirmação + notificação ao
      coordenador; rede → notifica Admin).
- [x] **H4.4 Tela de Planos de Tratamento** ✅ (v0.11.1).
- [ ] **H4.5 Cockpit 2.0 [G] 🗄️** — redesign; etapas + sessões; sugerir
      profissional; juntar sessões; tempo por/entre sessões; previsão de
      término; alertas/lembretes por sessão e do plano.
- [ ] **H4.6 Módulo do Dentista [G] 🗄️** — dashboard, execução/baixa,
      pendências; histórico do cliente; plano resumido SEM valores; sugestões
      p/ reavaliação (visíveis ao coordenador); pedir revisão do planejamento
      (alerta insistente até resolver).
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
- [ ] **H4.10 Prontuário em abas + menu fixo [M]** — ficha em abas na sequência
      do fluxo; barra lateral fixa em todas as telas.
- [ ] **H4.11 Apresentação 2.0 + fotos no Gamma [M]** — layout mais rico e
      responsivo; testar fotos no Gamma via links assinados embutidos no texto;
      padrão visual dos decks.
- [ ] **H4.12 Câmera intraoral [M]** — capturar da câmera conectada
      (getUserMedia) e salvar direto no prontuário (bucket clínico).
- [ ] **H4.13 Especialidades + comissionamento [M] 🗄️** — cadastro de
      especialidades (lista padronizada, como o pilar); reajuste em massa do
      comissionamento fixo; regra "comissão só com procedimento finalizado"
      documentada (aplicação = módulo financeiro, Fase 2).
- [ ] **H4.14 Definições de status [P]** — "Início de Tratamento" = plano
      aprovado e nada executado; "Sessão" = já iniciou (consistente em
      agenda/jornada).

## Fora do LOTE H (não esquecer)

| Item | Quando |
|---|---|
| Limpeza dos dados de teste (mantém Admin do dono + catálogo/fichas; backup antes; script avulso, NÃO em migrations/) | Antes de publicar na web (adiado pelo dono) |
| Rodada de refinamento visual (tela por tela, dono guiando) | Depois do LOTE H |
| Fase 2 Comercial: apresentação gravada, ZapSign, ASAAS (regra de ouro), NPS, dashboards com metas | Depois do MVP validado |
| Fase 3: WhatsApp automático, transcrição/resumo por IA | Depois da Fase 2 |
| Adiados antigos: semana começando no domingo; esconder fim de semana vazio; offline/PWA | Encaixar quando fizer sentido |

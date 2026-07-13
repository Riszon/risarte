# Estado do Projeto — Risarte Odontologia (MVP RIZON)

_Atualizado em: 13/07/2026 · Versão do sistema: **0.56.0** · Última migração: **0123**_

> **H4.9 Chat Hub — Correções R2 ✅ (v0.56.0 · migração 0123):** (1) **recibos**
> agora comparam **por data** (timestamp banco `+00:00` × JS `Z` quebrava a
> comparação por texto) → **Lida** fica azul e **Entregue** não volta pra Enviada;
> (2) **nomes**: mensagens de quem é da franqueadora (Admin/Planner) apareciam
> como "colega"/sem nome porque a RLS de `profiles` barra → agora via RPC
> `chat_channel_people`/`chat_display_names` (SECURITY DEFINER, só p/ membros do
> canal); (3) **presença 3 estados**: online (verde) / **ausente** (âmbar, após 5
> min parado) / offline (**"visto por último"**, `getLastSeen` atualiza a cada 12s);
> (4) **carregamento mais rápido** (consultas por canal em paralelo); (5) dot de
> presença **na lista de contatos**; (6) **"Ver membros"** da equipe; (7) **busca**
> de pessoa/unidade e **filtro** de conversas; (8) **contagem online/ausente/offline
> para o Admin**. **Faltam:** R3 (reagir + responder mensagem), R4 (Admin → unidade
> específica + config de contato unidade↔franqueadora), depois **Lote 2** e **3**.
> Migração a rodar: **0123**.

> **H4.9 Chat Hub — Refinamentos R2 ✅ (v0.55.0 · migração 0122):** **presença** —
> **online agora** (bolinha verde) via Supabase Realtime Presence (canal
> "online-users"; o item do menu marca o usuário e faz ping) + **"visto por
> último"** persistido em `user_presence` (`touch_presence` a cada 60s). **Recibos**
> nas minhas mensagens: **✓ Enviada** → **✓✓ Entregue** (o outro está online ou foi
> visto após) → **✓✓ Lida** (azul, leu após). Cabeçalho da conversa direta mostra
> "online agora"/"visto por último…". `getChannelPeople` traz `lastSeenAt`. **Faltam:**
> R3 (reagir + responder mensagem), R4 (Admin → unidade específica + config de
> contato unidade↔franqueadora), depois **Lote 2** (áudio/arquivos) e **Lote 3**.
> Migração a rodar: **0122**.

> **H4.9 Chat Hub — Refinamentos R1 ✅ (v0.54.0 · migração 0121):** corrigido o
> **contador fantasma** (Admin/franqueadora mostravam dezenas de "não lidas" sem
> mensagens) — badge e lista agora usam o MESMO conjunto (`chat_my_channel_ids`):
> minhas equipes (todas as unidades onde tenho função) + escopo da franqueadora
> (exceto Admin) + diretos + já abertos. **Todas as equipes aparecem** mesmo logado
> em outra unidade. Cada mensagem/cabeçalho mostra **nome** (**"Você"** nas minhas),
> **função + unidade** e **foto** (bucket staff-photos; leitura liberada a
> autenticados). `getChannelPeople` (nome/função/unidade/foto assinada). **Faltam:**
> R2 (presença online + "visto por último" + entregue/lida), R3 (reagir + responder
> mensagem), R4 (Admin → unidade específica + config de contato unidade↔
> franqueadora). Migração a rodar: **0121**.

> **H4.9 Chat interno ("Chat Hub") — Lote 1 (texto) ✅ (v0.53.0 · migração 0120):**
> conversas internas da equipe em **/chat**. **Canal da unidade** (todos com acesso
> à unidade ativa) + **mensagens diretas 1:1**; a franqueadora fica conectada às
> unidades (vê/participa dos canais das unidades pelo escopo pleno). **Tempo real**
> via Supabase Realtime (a publicação é ligada na própria migração). **Badge de não
> lidas** no menu + **pop-up + som** quando chega mensagem (na tela do chat, o
> próprio Chat Hub cuida; fora dela, o item do menu). **Recibo de leitura** (visto)
> e **histórico**. Tabelas `chat_channels`/`chat_channel_members`/`chat_messages`/
> `chat_reads`; RLS por `can_access_chat_channel`; criação por RPC
> (`ensure_unit_chat_channel`/`ensure_direct_chat_channel`); badge por
> `chat_unread_total`. **Falta Lote 2** (áudio/arquivos) e **Lote 3** (insistência
> até visualizar). Migração a rodar: **0120**.

> **H4.8 Planejamento anual da REDE — COMPLETO (Blocos 1 e 2).** **Bloco 1
> (v0.51.0 · migração 0118):** a franqueadora define um calendário que vale para
> **todas** as unidades. Itens da rede = `agenda_plan_items` com `clinic_id NULL` +
> coluna `locked` (trava) + novo tipo `campaign` (informativo, não fecha). Em
> `/agenda/planejamento-anual` a franqueadora cria/edita (RPCs
> `create/update/delete_network_plan_item`, guarda `can_manage_network_plan` =
> Admin ou gestor da franqueadora). Cada item desce para a agenda de todas as
> unidades e bloqueia conforme a trava: **travado** = a unidade não abre por cima;
> **decisão da unidade** = pode liberar um dia avulso; **campanha** = só aviso. A
> tela de planejamento da unidade mostra o calendário da rede em leitura;
> `checkAgendaRules`/`day-strip`/agenda incluem os itens da rede. **Bloco 2
> (v0.52.0 · migração 0119):** **almoço padrão da rede** — a franqueadora define em
> `/agenda/configuracao` (linha `clinic_id NULL` de `clinic_agenda_settings`,
> `saveNetworkLunch`; a policy de escrita foi ampliada para permitir a linha NULL a
> quem gerencia a rede); a unidade herda por cascata e pode personalizar o próprio
> (o editor da unidade mostra o padrão da rede como referência). Migrações a rodar:
> **0118 e 0119**.

> **H4.7 Atendimento conjunto — COMPLETO (Blocos 1 e 2).** Um atendimento pode
> ter 2+ profissionais (cirurgia com auxiliar, 2 especialistas). **Bloco 1 (v0.49.0
> · migração 0116):** continua o **responsável principal** (pelo tipo); no
> agendamento há o campo **"Outros profissionais neste atendimento"**
> (dentistas/coordenadores da unidade, menos o principal); uma sala só; o **limite**
> de profissionais = **nº de cadeiras** da unidade; cada incluído recebe **aviso**
> (`notify_appointment_participants`); o detalhe do agendamento mostra o
> "Atendimento conjunto". Tabela `appointment_participants` + RLS. **Bloco 2 (v0.50.0
> · migração 0117):** o conjunto aparece na agenda de **TODOS** os participantes —
> na **Minha Agenda** do dentista (`provider_multi_unit_agenda` reescrita: traz
> também onde ele é adicional, com selo e papel) e nos **cards da agenda** (selo
> "Conjunto +N"); **aviso suave** se um profissional adicional já estiver ocupado no
> horário (`checkParticipantsBusy`, mesma unidade). Migrações a rodar: **0116 e 0117**.

> **H4.6 Bloco E — agenda multi-unidade (em andamento):** **E1 ✅ (v0.45.0,
> migração 0112)** — dias de atendimento do dentista por unidade (dias da semana
> + datas), no cadastro do Risartano (`staff_clinic_schedule`). **E2 ✅ (0113):**
> aviso de conflito entre unidades no agendamento (Recepção vê aviso vermelho;
> dentista é notificado). **E3 ✅ (0114):** agenda consolidada multi-unidade do
> dentista (`/minha-agenda`, cor por unidade). **E4 ✅ (0115):** aviso da próxima
> semana no fim de semana (aponta p/ Minha Agenda). **Bloco E e o H4.6 (Módulo do
> Dentista) COMPLETOS.**

> **H4.10 / H4.12 / H4.14 ✅ (paralelos ao teste do H4.6):** H4.14 (0110) status
> "Em Tratamento" automático na 1ª baixa; H4.10 (0.43.0) ficha em abas + barra
> lateral fixa; H4.12 (0111) câmera intraoral (captura → prontuário, Coordenador
> e Dentista). Migrações a rodar: **0110 e 0111**.

> **MÓDULO RISARTE EMPRESARIAL — CONSTRUÍDO (Fases 0–8, aguardando teste do dono).**
> Camada B2B (empresas parceiras → colaboradores viram clientes da Jornada), schema
> próprio `empresarial`. Plano aprovado 10/07/2026 (`docs/risarte-empresarial/`).
> Migrações **0096–0103**. Roteiro de teste: `docs/risarte-empresarial/ROTEIRO-TESTE.md`.
>
> - **Fase 0** — fundação: schema + 11 tabelas + RLS + papel `rislife_consultant` (0096–0097).
> - **Fase 1** — cadastros: menu Empresarial; empresas (KPIs/filtros); tela em abas;
>   colaboradores + dependentes; **ponte colaborador→cliente** por CPF (`complete_employee`/
>   `link_dependent`, copia `clinic_id`); **selo** na ficha (0098); import Excel; saída.
> - **Fase 2** — benefícios/preços: config da rede (`/empresarial/configuracoes`) +
>   override por empresa (aba Plano); **motor de benefícios** (cobertura/desconto/
>   frequência/limite/carência/parcelamento); mensalidade + simulador.
> - **Fase 3** — orçamento com benefício: `benefits.ts` (carência/frequência/limite);
>   valor cheio × com programa na ficha; registro de uso ao concluir sessão (0099).
> - **Fase 6** — comercial: funil kanban (`/empresarial/funil`) + linha do tempo +
>   "Hoje do consultor" + fechar→cria empresa; papel RisLife com RLS (0100).
> - **Fase 7** — dashboards: painel do cliente (uso/economia) na ficha; painel
>   consolidado (`/empresarial/painel`); economia por empresa na aba Financeiro.
> - **Fase 8** — Riso+ Social (aba, gatilhos, regra integral/parcial/nenhum) +
>   retenção 5 anos/anonimização (`run_retention`, cron) (0101).
> - **Fase 4** — financeiro/ASAAS: cobrança + split (`settle_billing`) + inadimplência
>   (`mark_overdue_and_suspend`, suspende + bloqueia benefícios); webhook idempotente
>   + Edge Function `asaas-webhook`; **pronto para plugar** `ASAAS_API_KEY` (0102).
> - **Fase 5** — contratos/ZapSign + proposta Gamma: aba Contratos; `zapsign.ts` +
>   Edge Function `zapsign-webhook`; proposta via Gamma (reusa a integração) (0103).
>
> **Pendências do dono:** aplicar **0096→0103** em ordem no SQL Editor + **Settings →
> API → Exposed schemas → `empresarial`**. Para ligar ASAAS/ZapSign/Gamma: cadastrar
> as chaves (`ASAAS_API_KEY`, `ZAPSIGN_API_TOKEN`, `GAMMA_API_KEY`) e fazer deploy das
> Edge Functions. Detalhe do motor de benefícios em `ADENDO-01-motor-de-beneficios.md`.

> **H4.5 Cockpit 2.0 — COMPLETO (Grupo 4).** Lotes 1–5: etapas; linha do tempo +
> resumo (previsto×realizado); sugerir profissional por sessão; juntar sessões
> (na Fase 5 e no planejamento, sessão a sessão, com tempo/sequência/profissional
> editáveis no cockpit); alertas/lembretes (selos + notificações à Recepção).
> Migrações 0087–0095. **Falta só o Pedido 3 do dono** (baixa parcial das sessões
> pelo dentista executor), combinado para o **H4.6**. Detalhe em `docs/ROADMAP.md`
> (fonte da verdade). Próximo: **H4.6 (Módulo do Dentista)**.

> **H4.6 Módulo do Dentista — EM ANDAMENTO.** Plano detalhado aprovado (10/07):
> a "casa" do dentista em blocos **A1 → A2 → A3 → B1/B2 → B3 → C → D → E** (E =
> agenda multi-unidade, item próprio depois). **A1 — Baixa parcial das sessões
> ✅ (v0.35.0, migração 0105):** ao concluir um atendimento COM sessões, abre "O
> que foi feito hoje?"; só o Dentista/Admin confirma o que foi feito; as
> confirmadas são liquidadas (tempo real rateado só entre elas), as não feitas
> voltam para "a agendar" (motivo opcional) e a Recepção é avisada
> (`conclude_attendance_partial`). **A2 — Desenvolvimento Clínico ✅ (v0.36.0,
> migração 0106):** no prontuário, o Dentista escreve as anotações do atendimento
> com salvamento automático ("Salvo às HH:MM"); as anotações viram uma linha do
> tempo (autor + unidade + data) visível a dentistas/Coordenador/Planner
> (`clinical_progress_notes`, append-only). **A3 — Procedimentos do cliente ✅
> (v0.37.0, migração 0107):** seção "Procedimentos" agrupando as sessões em Em
> aberto / Agendados / Finalizados; o Dentista tem o botão "Solicitar agendamento
> à Recepção" (`request_session_scheduling`, notifica a Recepção). **B1/B2 ✅
> (v0.38.0, sem migração):** rota `/meu-dia` (Hoje / Próximos / procedimentos em
> aberto do dentista); prontuário do dentista restrito aos seus pacientes (RLS +
> mensagem amigável `isDentistRestricted`); plano resumido SEM valores
> (`plan-summary-section`). **B3 ✅ (v0.39.0, sem migração):** bloco "Minha
> produção" na tela Meu Dia (filtro de período): concluídos, sessões finalizadas,
> tempo em cadeira realizado × previsto, espera média, em aberto, futuros, NPS
> ("ainda não disponível"). **Bloco B completo.** **Bloco C — Documentos ✅
> (v0.40.0, migração 0108):** o Dentista/Coordenador emite prescrição, atestado,
> declaração e orientações no prontuário (com modelos), e imprime/salva em PDF
> (`/documentos/[id]/imprimir`); modelos da rede geridos em `/admin/documentos`
> (franqueadora). Sem assinatura digital/envio (adiado). **Bloco D — Falar com
> quem planeja ✅ (v0.41.0, migração 0109):** seção "Pedidos ao coordenador"
> (sugerir reavaliação / pedir revisão do plano com alerta insistente + anexos);
> o Coordenador resolve (`clinical_requests`/`clinical_request_media` + RPCs).
> **H4.6 (Módulo do Dentista) COMPLETO** nos blocos A–D. **Falta:** o Bloco E
> (agenda multi-unidade, item próprio depois) e o **teste geral detalhado do
> H4.6** pedido pelo dono.

> Documento de continuidade entre sessões. Regras de negócio detalhadas ficam em
> `CLAUDE.md`; regras de código em `docs/ARQUITETURA-TECNICA.md`; jornada em
> `docs/JORNADA.md`; fila de pendências em `docs/BACKLOG.md`.

## 1. Fase atual e o que já foi concluído

Fase do plano: **MVP — núcleo clínico (completo)**. A espinha dorsal (Jornada do
Cliente em 7 fases + Centro de Planejamento) está pronta.

**Concluído e validado pelo dono:**
- Etapa 1 — Fundação (Next 16, login, RLS).
- Etapa 2 — Cadastros (clínicas, usuários, clientes, SLAs, máscaras).
- Etapa 3 — Base da Jornada (kanban, agenda, notificações, check-in, atendimento,
  decisões da Fase 5, ativo/inativo).
- LOTE D — ajustes do teste geral.
- Etapa 4 (4.1+4.2) — Coordenador Clínico (consentimento, fotos/exames/vídeo/áudio,
  considerações).
- LOTE E — correções pré-Etapa 5 (modelo SDR, jornada, conflitos de agenda,
  edição/transferência, compartilhamento entre unidades).

**Entregue (aguardando teste final do dono):**
- **Etapa 5 — Centro de Planejamento (completa):** 5.1 fila + estrutura do plano;
  5.2 orçamento por tabela de preços; 5.3/4.3 aprovação por opção + envio ao Comercial.
- **LOTE F (F1–F7):** filtros automáticos; ficha em leitura + botão Editar;
  autopreenchimento no cadastro; compartilhamento (notifica as 2 unidades +
  histórico + encerramento sem 404); **Procedimentos** (campos completos,
  busca/filtros, importação Excel, reajuste em massa, histórico, exclusão =
  desativar); aprovação por opção; fila por situação; central de notificações
  categorizada; **cockpit do Planner**.
- **LOTE B (B1–B6):** agenda **Dia/Semana/Mês**; **config de agenda por unidade**
  (horário + cadeiras); **Relatórios** (resumo de agendamentos, rede por fase sem
  nomes, contadores do Planner).

Migrações **0001–0045** escritas; **0001–0043 aplicadas**; **0044–0045 pendentes**.

## 2. O que está em andamento agora

**LOTE G — Agenda (em curso).** Entregue e aguardando teste do dono:
- **G1 — Salas + configuração na unidade:** nova tabela `clinic_rooms` (salas com
  nome por unidade), sala do Coordenador Clínico em `clinic_agenda_settings`,
  configuração da agenda liberada para a **Gerente de Unidade** (RLS + tela em
  `/agenda/configuracao`), e contagem de salas exibida na agenda. Migração 0044.
- **G2 — Agendar com sala:** agendamento passa a ter **sala** (`appointments.room_id`)
  e marca **ONLINE** (`is_online`) para apresentação comercial; regra de ocupação
  **por sala** (uma sala = um cliente por vez); o horário só oferece os **slots
  configurados** (15 min, dentro do funcionamento e dias abertos); encaixe
  (urgência/emergência) livre; sala/ONLINE aparece no **card**; sala padrão do
  Coordenador em avaliação/reavaliação. Migração 0045.

- **G3.1 — Grade de tempo + salas:** visão **Dia** vira grade com **colunas por
  sala** (+ coluna ONLINE / "Sem sala" quando houver) e **régua de tempo** lateral
  (hora + tiques de 15 min); **filtro de salas** por chips (`?salas=id,id,online`,
  vazio = todas) que vale para Dia/Semana/Mês (`day-room-grid.tsx`,
  `room-filter.tsx`). Sem nova migração.
- **G3.2 — Agendamento rápido:** clicar num espaço vazio de uma sala (visão Dia)
  abre o formulário já com **sala + data + horário** preenchidos; o formulário
  ganhou abertura controlada + valores iniciais. Sem nova migração.
- **G3.3 — Arrastar para remarcar:** card **futuro** pode ser arrastado para
  outro horário/sala na visão Dia (chama `updateAppointment`, mantendo duração).
  Filtro de salas agora **preservado** ao trocar de visão/navegar (`agendaHref`
  leva `salas`); mensagem da grade orienta quando não há apresentação ONLINE no
  dia. Sem nova migração.

- **G4 — Fechar agenda:** tabela `agenda_closures` (+ salas/profissionais) e
  `appointments.needs_reschedule`. Botão "Fechar agenda" (Recepção/Gerente/Admin)
  bloqueia período por **unidade / salas / profissionais** (motivo: pessoal,
  evento, manutenção, treinamento) via RPCs SECURITY DEFINER `create_agenda_closure`
  / `delete_agenda_closure`. Bloqueia novos agendamentos **inclusive encaixe**;
  agendamentos existentes no período são **sinalizados** (ícone de alerta no card)
  e geram **notificação** (categoria "Agenda") para a recepção remarcar; remarcar
  com sucesso limpa o alerta. Faixas de fechamento aparecem na visão Dia + banner
  com remover. Migração 0046.

Decisões do dono na G4: Recepção+Gerente+Admin fecham; fechamento bloqueia todos
(inclusive encaixe); afetados são sinalizados (sem cancelamento automático).

- **G5 — Dias de atendimento, feriados e dia avulso:** a agenda mostra **só os
  dias configurados** (Semana esconde dias sem atendimento; Dia mostra aviso
  "não atende"). **Liberar dia avulso** na Configurar agenda (uma ou várias
  datas + escalar quem atende, que recebe notificação) — tabela `agenda_open_days`
  (+ staff). **Feriados nacionais** (fixos + móveis via Páscoa, `lib/holidays.ts`)
  marcados na agenda; a Gerente **confirma** (haverá atendimento? Sim/Não →
  `clinic_holiday_decisions`) e recebe **notificação** de feriados próximos
  pendentes (`notify_pending_holidays`, idempotente). Feriado "não atende"
  bloqueia novos agendamentos; pendente apenas avisa (decisão do dono). RPCs
  `open_special_days`/`remove_special_day`/`decide_holiday`. Migração 0047.

- **G6 — Retornos e controles:** rota `/agenda/retornos` (botão na agenda, para
  Recepção/Gerente/Admin) — lista os **retornos e controles agendados** (tipos
  Retorno/Reavaliação no futuro) e os clientes em **Acompanhamento/Reavaliação
  sem agendamento futuro** ("a lembrar de reagendar", com última visita e botão
  Agendar). Sem nova migração.

**LOTE G (Agenda) COMPLETO (G1–G6).** Migrações do Lote G: **0044–0047**.

**Refinamentos da Agenda — GR1+GR2+GR5 entregues (sem migração, v0.8.0):**
- **GR1 — Agendamento inteligente:** duração mín. 15 min; **próximos horários
  disponíveis** (`getNextAvailableSlots`, 3 + "ver mais", clique confirma) por
  tipo/duração/profissional/sala respeitando dias/horários/feriados/fechamentos/
  ocupação; **"Ver agenda"** virou pop-up de mês com contagem por dia
  (`agenda-peek-dialog`, `getMonthDayCounts`) — clicar no dia preenche a data.
- **GR2 — Cards e arrastar:** ícone **i** no card abre detalhes em leitura
  (`appointment-info-dialog`); ao **arrastar** mostra o horário-alvo; visão
  **Semana** virou **grade de tempo** com régua hora/15min (`week-time-grid`,
  dias em colunas, só dias de atendimento).
- **GR5 — Retornos:** "a lembrar" mostra **dias sem atendimento** com cores/ícones
  pela inatividade do SLA (`resolveInactivity`), **ordenação** (padrão maior
  tempo primeiro) e **quem atendeu por último**.

- **GR3 — Fechamento de agenda (refino, migração 0048):** seletor de data+hora
  igual ao agendamento; **não permite período passado**; **editar** fechamento
  (`update_agenda_closure` com confirmação + histórico antes/depois em
  `agenda_closure_history` + recalcula afetados + notifica); **confirmar** antes
  de remover (`closure-controls`); clicar em área fechada **não abre** agendamento
  — só **aviso** (toast) com motivo e até quando; **ícones de fechamento** na
  Semana (`week-time-grid`) e no Mês (`month-grid`); feriados/dias avulsos também
  marcados no Mês.

- **GR4 — Dia avulso + almoço (migração 0049):** dia avulso ganha **horário de
  início/fim** (selects); **carimbo** (quem/quando liberou + antecedência do
  aviso); **editar** dias futuros (`update_special_day` com histórico
  `agenda_open_day_history` + notifica envolvidos), passados viram **histórico**
  (não edita/remove — bloqueado no RPC); botão **"Ver"** o dia na agenda;
  **horário de almoço** na config (`saveLunchBreak` + colunas em
  `clinic_agenda_settings`) bloqueia agendamento normal no almoço (encaixe livre)
  e aparece como **faixa "Almoço"** no Dia e na Semana; dia avulso em **destaque**
  no Dia/Semana/Mês. Admin Master também faz tudo (RPCs e telas liberadas).

- **GR6 — Planejamento Anual de Atendimento (migração 0050):** tela
  `/agenda/planejamento-anual` (Gerente/Admin) com seletor de ano, **resumo**
  (dias trabalháveis, horas estimadas, contadores por tipo, feriados
  trabalha/fecha/a-decidir), **visão dos 12 meses**, **confirmar feriados** ali,
  e **itens** (`agenda_plan_items`): Recesso, Férias coletivas, Férias
  individuais, Evento, Treinamento, Manutenção — com período, pessoas (férias
  individuais), histórico (`agenda_plan_item_history`) e notificação. Itens
  **fecham a agenda** no período (individuais = só as pessoas), inclusive
  encaixe; um **dia avulso** liberado passa por cima. Só edita/remove futuro.
  Marcação na agenda Dia (banner)/Semana/Mês. RPCs create/update/delete_plan_item.

**Refinamentos GR1–GR6 COMPLETOS.**

- **LOTE H — Cronômetros do Atendimento (sem migração, v0.8.4):** o painel
  `/atendimento` agora tem cronômetros **em tempo real** (tick a cada segundo,
  `attendance-panel.tsx`): **A chegar** liga cronômetro de **atraso** a partir do
  horário se não houve check-in; **Em espera** mostra **há quanto tempo** espera
  (desde o check-in) + se **chegou adiantado/atrasado** e a hora do check-in;
  **Em atendimento** mostra **há quanto tempo** está em atendimento (desde a
  chamada); **Concluído** mostra só o **horário de conclusão** + durações. Usa os
  carimbos já existentes (`checked_in_at`/`called_at`/`done_at`).

**LOTE PRONTUÁRIOS — em curso.**
- **P1 — Renomear + abas (sem migração, v0.8.5):** "Clientes" virou **Prontuários**
  no menu e nos títulos; a **rota** mudou de `/clientes` para `/prontuarios`
  (pasta renomeada + redirecionamento no `next.config.ts` para os links antigos
  não darem 404). A lista virou **abas** (usuário de unidade): **Ativos** (lista +
  filtros + aviso de início de tratamento), **Aniversariantes** (Hoje / Esta
  semana = próximos 7 dias / Este mês, com idade e telefone — `src/lib/birthdays.ts`),
  **Transferidos** e **Compartilhados** (antes eram blocos soltos no rodapé). O
  aviso automático de aniversário para a Recepção é a P2. Franqueadora segue com
  a visão de rede (sem abas de unidade). Sem nova migração.

- **P2 — Aniversariantes + aviso da Recepção (migração 0051, v0.8.6):** ao abrir
  o sistema (página **Início** e aba **Prontuários**), a **Recepção** da unidade
  recebe — **uma vez por dia** — uma notificação com os aniversariantes a
  parabenizar. **Antecipa fim de semana/feriado:** cobre hoje + a sequência de
  dias fechados imediatamente à frente, até o próximo dia de atendimento (usa a
  config da agenda + feriados + dias avulsos). RPC SECURITY DEFINER
  `notify_birthday_clients` (idempotente: dedupe pelo `link` com a data do dia).
  Nova categoria **"Aniversários"** na central de notificações.

- **P3 — Anamnese (migração 0052, v0.8.7):** nova seção **Anamnese** na ficha
  (logo abaixo da Avaliação clínica), preenchida pelo **Coordenador Clínico**
  (ou Admin) com 4 campos livres — **queixa principal, histórico de saúde,
  histórico odontológico, estilo de vida**. Atrás do **consentimento** (LGPD);
  **leitura** para Planner/Gerente/Admin (mesma RLS das considerações). Abre em
  **leitura** com botão **Editar**; guarda **versões anteriores**
  (`clinical_anamnesis_revisions`, "Histórico de versões"). Uma anamnese por
  cliente **por unidade** (a unidade compartilhada mantém a sua). Tabelas
  `clinical_anamnesis` (+ revisões) + RLS.

**LOTE PRONTUÁRIOS COMPLETO (P1–P3).** Migrações: **0051–0052**.

**LOTE ANAMNESE configurável (em curso) — feedback do dono + PDF da ficha.**
Decisões: Admin Master cria as **fichas-padrão da rede**; o Coordenador pode
**acrescentar perguntas** da sua unidade às fichas existentes (sem excluir as da
rede, sem criar fichas próprias). A anamnese de 4 campos (P3) será **substituída**.
- **A1 — Bug do consentimento (v0.8.8, sem migração):** botão **"Preencher
  anamnese"** libera o formulário ao registrar o consentimento, sem recarregar.
- **A2 — Configurador de fichas + ficha "Geral" (migração 0053, v0.8.9):** tabelas
  `anamnesis_templates` + `anamnesis_questions` (clinic_id NULL = pergunta da
  rede; preenchido = acréscimo da unidade) + RLS (Admin escreve a rede;
  Coordenador só acréscimos da sua unidade). Tela **Administração → Fichas de
  Anamnese** (`/admin/anamnese`) para criar/editar fichas e perguntas (tipos:
  Sim/Não, Sim/Não/Não sei, escolha única, lista de marcar, texto curto/longo),
  marcar **campo de detalhe ao "Sim"**, **obrigatória** e **alerta** (com
  mensagem/condição). Ficha **"Geral"** já semeada com as perguntas do PDF.
- **A3 — Preenchimento no prontuário (migração 0054, v0.9.0):** tabelas
  `anamnesis_fills` (versão imutável por preenchimento) + `anamnesis_answers`
  (respostas com a pergunta carimbada) + RLS — **Dentista** entra como
  visualizador (além de Planner/Gerente/Admin); Coordenador preenche. Na ficha,
  o componente `anamnesis-fill.tsx` substitui a anamnese de 4 campos: o
  Coordenador **escolhe a ficha**, responde **clicando** (Sim/Não, listas,
  texto), e pode **adicionar pergunta** (só para o cliente ou salvando na ficha
  da unidade via checkbox → vira pergunta `clinic_id` da unidade). **Alertas**
  das respostas aparecem numa **faixa no topo do prontuário** (`evaluateAlerts`).
  Cada save cria uma **nova versão** (histórico). A anamnese antiga (P3) saiu.
- **A4 — Obrigatoriedade + reavaliação + "sem alterações" (sem migração,
  v0.9.1):** envio ao **Centro de Planejamento** **bloqueado** (botão desabilitado
  + aviso na Avaliação clínica) enquanto a anamnese não estiver preenchida
  (1ª consulta) ou estiver vencida na **reavaliação** (Fase 6, >12 meses). Aviso
  no topo do prontuário cobrando o preenchimento/atualização. "Atualizar" abre a
  ficha **pré-preenchida** (já vinha da A3). Ao salvar sem mudar nada, registra a
  versão como **"sem alterações"** (`no_changes`, comparando a assinatura das
  respostas) — aparece no histórico e no aviso.

**LOTE ANAMNESE COMPLETO (A1–A4).** Migrações: **0053–0054**.

**LOTE PROCEDIMENTOS (em curso) — tempo estimado.**
- **PR1 — Tempo estimado no cadastro (migração 0055, v0.9.2):** coluna
  `procedures.estimated_minutes`; campo **"Tempo estimado (min)"** no cadastro/
  edição, exibição na lista, e na **importação Excel** (nova coluna "Tempo
  Estimado (min)" + larguras de coluna + aba "Instruções" no modelo). Tipo
  `Procedure.estimatedMinutes` propagado (ficha + cockpit do plano).
  Obs.: cabeçalho em negrito/cor no Excel exigiria trocar a lib (exceljs).

**Ampliação (feedback do dono) — "Protocolo de sessões".** Decisões: protocolo
**padrão da Rede** (Admin/Planner) + **personalização por unidade** (Coordenador
Clínico **e** Planner); o dentista **só marca finalizado** e o sistema **calcula
o tempo real** pelo atendimento (Lote H), **rateando por procedimento** quando o
agendamento tem vários. Etapas: **E1** protocolo da Rede; **E2** override por
unidade; **E3** planejamento com sugestões + médias reais (Rede/Unidade/dentista);
**E4** agendamento por sessão; **E5** execução/auditoria + médias derivadas.
- **E1 — Protocolo de sessões da Rede (migração 0056, v0.9.3):** tabela
  `procedure_sessions` (clinic_id NULL = Rede; preenchido = unidade) + RLS
  (Rede=Admin/Planner; unidade=Admin/Planner/Coordenador). No cadastro, botão
  **relógio** abre o **protocolo**: "sessão única" ou "várias sessões", cada
  sessão com **nome** + **tempo (seletor 15/15 min)**, com **soma automática** e
  contagem; salvar recalcula `procedures.estimated_minutes` (total da Rede). O
  campo solto de tempo do PR1 saiu do formulário (o total vem do protocolo; a
  importação ainda define um tempo de sessão única). Lista mostra "N sessões · Xh".
- **E2 + ajustes (sem migração, v0.9.4):** **protocolo por unidade** — no modo
  unidade, o relógio abre o protocolo da unidade (base = padrão da Rede; salvar
  cria a personalização; "Remover personalização" volta ao padrão). RLS já cobria
  (Admin/Planner/Coordenador). O **Coordenador Clínico** agora acessa
  `/procedimentos` **só no modo unidade** (sem catálogo/preços), restrito às suas
  unidades. Ajustes: o **relógio do protocolo** e o **histórico** ficam acessíveis
  também ao **editar** o procedimento; o **histórico** vira um painel reutilizável
  mostrado **só ao clicar** (`ChangeHistory`). Action `clearProcedureSessions`.
  Mais 2 ajustes (v0.9.5): concordância "1 sessão/2 sessões" e linha
  **Rede/Unidade** abaixo do nome do procedimento.
- **E3 — Planejamento com sugestões (migração 0057, v0.9.6):** o item do plano
  (`treatment_plan_option_items`) ganhou **planned_sessions** + **planned_total_minutes**.
  No editor do plano (ficha + cockpit), ao escolher um procedimento o sistema
  **sugere** sessões/tempo da **Unidade** (ou da **Rede**); o Planner **ajusta**
  por procedimento. Mostra a **base sugerida (Rede/Unidade)** e as **médias reais
  (unidade/dentista)** como "sem histórico ainda" (serão preenchidas na E5). Os
  valores planejados seguem para o agendamento por sessão (E4). `protocolByProcedure`
  carregado nas duas páginas; `BudgetItem` ganhou plannedSessions/plannedMinutes.
  Próximas: **E4** (agendamento por sessão), **E5** (execução/auditoria + médias).
- **Ajustes do planejamento (sem migração, v0.9.7):** **botão "Abrir cockpit"**
  na ficha (Planner); **Pilar da Metodologia** no editor do plano com **sugestão
  automática** (maior soma de valor por pilar, entre Saúde/Função/Estética/
  Prevenção) e **confirmação do pilar no envio** ao Coordenador (o Planner pode
  alterar; decisão final é dele) — `suggestTreatmentPillar` + `setTreatmentPillar`;
  ao colocar **2× o mesmo procedimento**, a sugestão de sessões/tempo **reescala
  (base × qtd)** e pede confirmação. (A visualização das sessões pelo Coordenador
  já veio na E3.)
- **E4a — Sessões a agendar na ficha (migração 0058, v0.9.8):** decisões do dono:
  agendar **nos dois lugares** (ficha + agenda) e **gerar na Fase 5**. Tabela
  `treatment_sessions` + `appointments.treatment_session_id` + RPC idempotente
  `ensure_treatment_sessions` (gera uma linha por sessão planejada da **opção
  principal aprovada** quando o cliente entra em Início de Tratamento, com o
  tempo de cada sessão). Painel **"Sessões do tratamento a agendar"** na ficha
  (`treatment-sessions-panel.tsx`): lista por procedimento + status; **"Agendar"**
  abre o formulário já com a **duração** da sessão (`AppointmentFormDialog` ganhou
  `initialDuration`). **E4b** (vínculo sessão↔agendamento + status + sugestão na
  agenda) e **E5** (execução + médias) a seguir.
- **E4b — Vínculo + sugestão na agenda (sem migração, v0.9.9):** ao agendar uma
  sessão, o `createAppointment` grava `appointments.treatment_session_id` e marca
  a sessão como **agendada** (`status='scheduled'`, `appointment_id`). No
  formulário da **Agenda**, ao escolher um cliente, aparecem **chips das sessões
  pendentes do plano** (`getClientPendingSessions`) — clicar preenche a duração e
  vincula o agendamento à sessão. `AppointmentFormDialog` ganhou
  `treatmentSessionId`. **E5** (execução + médias reais) a seguir.
- **E5 — Execução das sessões + médias reais (migração 0059, v0.10.0):** quando o
  dentista **conclui o atendimento** (painel `/atendimento` → `update_attendance`),
  as sessões ligadas ao agendamento viram **"Concluído"** com o **tempo real** de
  atendimento (chamada→conclusão). Quando o agendamento executou **mais de uma
  sessão/procedimento**, o tempo é **rateado** proporcionalmente ao tempo
  planejado de cada um (rateio igual quando não há tempo planejado) — helper
  `settle_treatment_sessions` chamado de dentro do `update_attendance`; colunas
  novas `treatment_sessions.actual_minutes` + `executed_by`. As médias reais
  alimentam: (a) o **editor do plano** — placeholder "sem histórico ainda" agora
  mostra a **média realizada na unidade** (`procedure_real_stats`, considera só
  tratamentos totalmente concluídos); (b) a **agenda** — ao marcar sessões + um
  dentista, mostra a **média real daquele dentista** por procedimento
  (`provider_procedure_minutes` / `getProviderProcedureStats`). O formulário da
  agenda passou a permitir **marcar mais de uma sessão** no mesmo horário (chips
  multi-seleção, duração soma sozinha → cria o caso do rateio;
  `createAppointment` lê `treatment_session_ids`). O painel da ficha mostra
  **"Concluído · durou X min"**. **Lote Procedimentos completo.**
- **Apresentação do plano — Camada 1 (interna) (sem migração, v0.10.1):** decisão
  do dono — **gerar pode ser interno OU externo (Gamma)**; **focar agora na
  Camada 1 (interna)**, deixando a integração com o Gamma para a Camada 2.
  Tela **"Modo Apresentação"** (`/apresentacao/[clientId]` + `presentation-view.tsx`)
  montada da **opção principal aprovada**: capa (cliente/unidade/data/**pilar do
  tratamento**), queixa/condição (diagnóstico + considerações clínicas), imagens
  (URLs assinadas, só dentro do sistema — LGPD), proposta (procedimentos,
  sessões, tempo, valor total) e próximas etapas. Botão **Baixar PDF** (impressão
  isolada via `@media print`). Entrada: botão **"Apresentação"** na ficha
  (Planner/Coordenador/Gerente/**Comercial**, quando o plano está aprovado) e no
  cabeçalho do **cockpit**. Acesso na página: Planner, Comercial, Coordenador,
  Gerente, Admin.
- **Apresentação — Camada 1.1 (mais detalhe) (migração 0060, v0.10.2):** o
  Planner passa a registrar **Objetivos do tratamento** e **Considerações do
  planejamento** no editor do plano (`treatment_plans.objectives` +
  `planning_notes`, action `savePlanNarrative`). A apresentação ganhou as seções
  **Objetivos**, **Considerações do planejamento** e **"Plano de tratamento —
  sessão por sessão"** (lista numerada de todas as sessões, com o nome/o que será
  feito + tempo, puxada do **protocolo** de cada procedimento — unidade > Rede;
  sem protocolo, cai na contagem planejada). Linguagem voltada ao cliente +
  **aviso de fluxo** (só na tela): "plano montado pelo Planner; o Consultor
  Comercial apresenta".
- **Apresentação — Camada 2 (Gamma) (sem migração, v0.10.3):** botão **"Gerar no
  Gamma"** na tela de apresentação. Integração com a **Generate API do Gamma**
  (`https://public-api.gamma.app/**v1.0**/generations`, header `X-API-KEY`,
  `GAMMA_API_KEY` em env): POST devolve `generationId`; o navegador faz **polling**
  de `getGammaStatus` até `completed`, que traz o **gammaUrl** (deck editável).
  Carregamento dos dados extraído para `presentation-data.ts` (compartilhado
  page+action); `actions.ts` monta o texto (markdown, 1 card por bloco com
  `---`), `imageOptions.source=noImages`, `textOptions.language=pt-br`. **Decisão
  do dono (achado técnico):** a API do Gamma **não insere as fotos específicas do
  paciente** — o deck é gerado **sem imagens**; o usuário **abre o gammaUrl,
  adiciona as fotos e exporta PPTX/PDF lá** (as fotos com qualidade seguem no PDF
  interno da Camada 1). Cada geração consome ~**3 créditos** da conta Gamma.
  `logAudit` action `export` entityType `presentation`. **Apresentação do plano
  (lote original) COMPLETA.** Pendência operacional: o dono deve cadastrar
  `GAMMA_API_KEY` nas **Environment Variables da Vercel** para funcionar no ar
  (no local já está no `.env.local`, fora do git).

**TESTE GERAL DO MVP (04/07/2026):** o dono rodou o roteiro completo
(`docs/ROTEIRO-TESTE-GERAL.md`) e devolveu ~60 pontos, todos registrados no
**LOTE H** do `docs/BACKLOG.md` em 4 grupos: **H1** bugs/segurança (10),
**H2** ajustes rápidos (12), **H3** melhorias médias (15), **H4** módulos novos
(14). Ordem combinada: H1 → H2 → priorizar H3/H4 com o dono.

**LOTE H1 — bugs do teste geral (em curso).**
- **H1a — Permissão/acesso (sem migração, v0.10.4):** corrige os 2 itens de
  acesso. **H1.1 Relatórios:** a tela `/relatorios` avaliava o papel de gestão
  em QUALQUER unidade do usuário e confiava só na RLS — uma recepcionista que é
  gerente em outra unidade via a rede toda. Agora o papel vale na **clínica
  ativa** (Admin = tudo; Franqueadora staff/planner/consultor = escopo de
  unidades via `user_full_access_clinic_ids`; Gerente = a unidade ativa;
  Franqueado = as suas) e TODAS as consultas (agendamentos, clientes, planos,
  seletor de unidade) filtram por `clinic_id` dentro do escopo; o item de menu
  (layout) segue a mesma regra. **H1.2 Apresentação p/ o Comercial:** o papel do
  Consultor fica na **Franqueadora** (com escopo de unidades), nunca na clínica
  do cliente — a checagem `hasRoleInClinic(clínica do cliente)` sempre falhava.
  Novo helper `hasRoleWithScopeForClinic` (`src/lib/auth.ts`, usa a RPC
  `user_full_access_clinic_ids`) aplicado em `presentation-data.ts` (acesso à
  tela/Gamma) e no `canPresent` da ficha (botão "Apresentação").
- **H1b — Regras de chamada no atendimento (migração 0061, v0.10.5):**
  **H1.3** um cliente não pode estar em **dois atendimentos ao mesmo tempo** —
  chamar quem já está "Em atendimento" em outro agendamento é bloqueado no
  banco (`CLIENT_BUSY`) e o card em espera troca o botão por "Em atendimento
  com outro profissional". **H1.4** quem chama o cliente é o **profissional do
  agendamento** (ou Admin); o Coordenador vê a sala de espera mas não chama
  cliente de outro profissional (`NOT_PROVIDER`; sem profissional definido vale
  a regra antiga por função). `update_attendance` reescrita (corpo da 0059 +
  travas); botão "Chamar" por linha no painel (`canCallRow`); mensagens pt-BR
  na action `updateAttendance`.
- **H1c — Sessões no agendamento + dia avulso (sem migração, v0.10.6):**
  **H1.5** as sessões do tratamento não "somem" mais: o pop-up **"i"** do card
  mostra as sessões vinculadas (`getAppointmentSessionOptions`); a **edição** do
  agendamento carrega os chips com as sessões vinculadas pré-marcadas + as
  pendentes do cliente (desmarcar devolve a sessão para "a agendar");
  `updateAppointment` sincroniza os vínculos (link/unlink + referência
  principal em `appointments.treatment_session_id`), só quando o formulário
  enviou o campo (arrastar para remarcar não mexe) e registra a mudança no
  audit. **H1.6** o seletor de horário do formulário passou a conhecer o **dia
  avulso** (oferece a janela própria do dia mesmo em dia da semana fechado) e o
  **feriado sem atendimento** (`getDaySchedule`), com aviso na hora de escolher
  a data ("Dia avulso liberado — atendimento das X às Y" / "Feriado sem
  atendimento nesta unidade", adiantando parte do H2.9). A grade do Dia passa
  `activeClinicId` ao editar.
- **H1d — Troca de unidade + autopreenchimento (sem migração, v0.10.7):**
  **H1.7** trocar de unidade no seletor agora **fecha a tela da unidade
  anterior** (`router.push("/")`, para uma ficha da unidade A não continuar
  aberta na B); e o usuário com **mais de uma unidade** (sem Franqueadora, que
  entra direto) **escolhe a unidade no login** numa tela de boas-vindas
  (`ChooseClinicWelcome`, mostrada pelo layout quando não há escolha explícita
  ainda) — `SessionContext.activeClinicExplicit` distingue a escolha real do
  padrão, e o padrão passou a priorizar a **Franqueadora**. **H1.9** o
  autopreenchimento por CPF agora traz **todos os dados** do cliente já
  existente (e-mail, endereço completo, etc.), não só nome/telefone/nascimento
  — `lookupCpfForRegistration` devolve um `ClientAutofill` (respeitando a RLS:
  sem acesso, campos vazios) e o formulário virou controlado nesses campos.

- **H1e — Teto de cadeiras pelo Admin (migração 0062, v0.10.8):** **H1.10** quem
  define quantas salas/cadeiras a unidade tem é o **Admin Master**, no cadastro
  da clínica (`clinics.max_rooms`, campo "Salas de atendimento (cadeiras)" só
  para unidades). A **Gerente** continua nomeando/ativando/desativando e
  escolhendo a sala do Coordenador em "Configurar agenda", mas o botão
  **"Adicionar sala"** some ao atingir o teto e a action `addRoom` bloqueia no
  servidor; o editor mostra "N de M cadeiras". Editar a clínica não deixa
  **reduzir** o teto abaixo das salas já criadas. Backfill: unidades existentes
  recebem `greatest(salas atuais, 4)`.
- **H1f — Encerrar compartilhamento na lista (sem migração, v0.10.9):** **H1.8**
  a aba **Compartilhados** dos Prontuários agora lista os compartilhamentos
  ativos da unidade nos **dois sentidos** (recebidos da outra unidade + enviados
  para outra) com **detalhes** (cliente, clínica dona, unidade compartilhada,
  motivo, desde quando, quem compartilhou) e um botão **Encerrar** por linha
  (`shared-clients-list.tsx` + `endClientShare`). Quem encerra: Recepção,
  Coordenador, Gerente ou Admin (o banco já permitia ambos os lados e já
  **notifica as duas unidades** ao iniciar/encerrar — migração 0038, nada novo
  no banco). O card da ficha (`ClientShares`) já tinha o Encerrar; o problema era
  achá-lo na lista. **LOTE H1 (Grupo 1 — bugs/segurança) COMPLETO (H1.1–H1.10).**

**LOTE H2 — ajustes rápidos do teste geral COMPLETO (sem migração, v0.11.0):**
**H2.1** aba "Ativos" → **"Clientes"** (a contagem soma ativos+inativos).
**H2.2** "Usuários" → **"Risartanos"** (menu + título; rota mantida). **H2.3**
envio do plano **sem etapa de confirmação** do pilar — só exige o pilar definido
(botão desabilitado + dica). **H2.4** depois de ir ao Comercial o **"Reabrir
para edição" some** (`canReopen` exige Fase 3; nota explicativa no lugar).
**H2.5/H2.6** trocar de visão na agenda parte de **HOJE** (Dia abre o dia de
hoje; Mês abre o mês atual) — `AgendaToolbar` usa `todayIso`. **H2.7** na visão
Semana, **clicar no dia** (cabeçalho) abre a visão Dia. **H2.8** card de **15
min** virou compacto de uma linha com o **nome do cliente** visível (Dia +
Semana; `compact` quando altura < 40px). **H2.9** encaixe em dia fechado mostra
**alerta âmbar na escolha da data** (complementa o aviso de feriado/dia avulso
do H1c). **H2.10** clicar em **dia/horário passado** não abre o pop-up — só um
aviso (Dia + Semana). **H2.11** o pop-up **"i"** ganhou **"Alterar situação"**
(cancelar/faltou etc.) para Recepção/Gerente/Admin em qualquer visão — e
cancelamento/falta **devolve as sessões do tratamento** para "a agendar"
(`updateAppointmentStatus`). **H2.12** já saíra no H1c (sessões no "i").

**H4.4 — Tela de Planos de Tratamento (sem migração, v0.11.1):** nova central
**"Planos de Tratamento"** no menu (`/planos`), para gestão/planner/comercial
(escopo por papel na clínica ativa, como /relatorios: Admin = tudo;
Franqueadora = escopo; Coordenador/Gerente = a unidade; Franqueado = as dele).
**Chips coloridos com contadores** por situação — Em planejamento / Aguardando
aprovação / Aprovado—no Centro / Fase comercial / Aguardando iniciar / Em
tratamento / Finalizado — clicáveis para filtrar (situação = status do plano +
fase/sub-status da jornada, `classify()`); **busca por cliente** + filtro de
unidade; tabela com selo colorido, fase, datas e ações (Ficha / Cockpit p/
Planner-Admin); bloco **"Relatório dos planos"**: totais (aprovados, chegaram
ao tratamento Fase 5+, ainda em negociação Fases 3–4) + quadro unidade ×
situação. Decisão do dono: H4.4 primeiro; depois seguir a ordem numérica do
backlog (H3.1 em diante).

## 3. Próximos passos (ordem de prioridade)

> **Roadmap completo com o "como construir" de cada item: `docs/ROADMAP.md`**
> (criado em 04/07/2026 a pedido do dono — ler antes de iniciar cada lote).

1. **H3 em ordem numérica** (decisão do dono, 04/07): ~~H3.1~~ ✅ (v0.11.2,
   formulário reordenado); ~~H3.2~~ ✅ (v0.11.3, "Ver agenda" rica — por dia:
   agendamentos, horários livres p/ o contexto do formulário, feriados,
   fechados, dias avulsos, bloqueios do planejamento anual, com legenda;
   `getMonthAgendaPeek`); ~~H3.3~~ ✅ (v0.11.4, seletor de dias — régua rolável
   `day-strip.tsx` no topo da agenda com disponibilidade verde/vermelho por
   dia, feriados/fechados/avulsos/bloqueios evidentes; clicar abre a visão
   Dia); ~~H3.4~~ ✅ (v0.11.5, migração 0063 — Faltou/Cancelou no "A chegar",
   Desistiu na espera com estado `gave_up`, limite de espera configurável +
   alerta vermelho + notificações repetidas a cada 15 min via
   `notify_attendance_alerts`, aviso diário + banner p/ pendências de dias
   anteriores); ~~H3.5~~ ✅ (v0.11.6, check-in com confirmação — pop-up mostra
   cliente, horário/tipo, profissional e sala antes de registrar a chegada);
   ~~H3.6~~ ✅ (v0.11.7, migração 0064 — troca de profissional de última hora
   no A chegar/Em espera via `swap_appointment_provider`, registro +
   notificações + alerta de frequência); **H3.4b** ✅ (v0.11.8, migração 0065 —
   pendências de dias anteriores carregam para o painel de hoje com "Pendente
   desde DD/MM"; "em atendimento" não concluído bloqueia cadeira+profissional
   via PROVIDER_BUSY/ROOM_BUSY); ~~H3.7~~ ✅ (v0.11.9, migração 0066 —
   visibilidade da SDR: `sdr_accessible_client_ids`; Prontuários/Jornada da SDR
   "pura" só os clientes que ela tocou; ficha bloqueia os demais; agenda
   completa mas nome sem link p/ não-permitidos); ~~H3.8~~ ✅ (v0.12.0, WhatsApp
   manual p/ aniversariantes — painel na aba Aniversariantes com mensagem
   editável {nome} + botão por cliente, e botão no prontuário no dia do
   aniversário; `src/lib/whatsapp.ts`); ~~H3.9~~ ✅ (v0.12.1, migração 0067 — transferência
   notifica sempre o destino, recepção/gerente/coordenador; compartilhamento
   já cobria os 3 papéis das 2 unidades); ~~H3.10~~ ✅ (v0.12.2, migração 0068 —
   enviar ao Planejamento conclui o atendimento automaticamente + avisa a
   recepção + pop-up para agendar a apresentação comercial); ~~H3.11~~ ✅ (v0.12.3, migração 0069 — informações
   complementares ao Centro de Planejamento: card na ficha + notifica o Planner
   + selo "nova info" na fila até abrir o cockpit); ~~H3.12~~ ✅ (v0.12.4, migração
   0070 — mídias: renomear + anotar por foto/arquivo na galeria, excluir com
   confirmação); ~~H3.13~~ ✅ (v0.12.7, cockpit — anamnese em leitura + filtros
   unidade/pilar na fila + rolagem independente das colunas); ~~H3.14~~ ✅
   (v0.12.8, sem migração — sessão agendada na ficha mostra quando/com quem e é
   clicável → abre os detalhes do agendamento); ~~H3.15~~ ✅ (v0.12.9, migração
   0071 — Conversão Comercial verifica apresentação agendada: avisa
   consultor/assistente; sem agendamento → aviso forte à recepção + gerente +
   coordenador; banner/selo no `/planos`; categoria Comercial nas notificações).
   **GRUPO 3 (H3.1–H3.15) COMPLETO**. Em andamento: **AJUSTES PRÉ-GRUPO 4**
   (5 itens do dono) — ~~AJ1~~ ✅ (v0.12.10, migração 0072 — Admin exclui
   cadeira por soft delete; some do futuro, passado marca "(excluída)"); ~~AJ1b~~
   ✅ (v0.12.11, sem migração — cadeiras numa casa só: removido o número de
   `/admin/agenda` e o campo do cadastro da clínica; limite virou campo só do
   Admin em "Configurar agenda"); ~~AJ2~~ ✅ (v0.12.12, migração 0073 —
   agendamento fora do horário permitido: início dentro do horário, fim pode
   passar; alerta a quem agenda + notifica o profissional); ~~AJ3~~ ✅ (v0.12.13,
   sem migração — apresentação marcada + plano não pronto: cronômetro regressivo
   na fila/cockpit/planos, destaque vermelho); ~~AJ4~~ ✅ (v0.12.14, migração 0074
   — banner de /planos clicável filtra; botão "Pedir agendamento" avisa a
   recepção; pop-up na recepção verifica a cada 45s); ~~AJ5~~ ✅ (v0.12.15, sem
   migração — vitrine "Prontos para apresentar" no topo de /planos com selo
   "novo" + acesso rápido). **AJUSTES PRÉ-GRUPO 4 COMPLETOS (AJ1–AJ5).** Em
   andamento: **AJUSTES 2** — ~~AJ6~~ ✅ (v0.12.16, pop-up da recepção
   organizado); ~~AJ11~~ ✅ (v0.12.17, migração 0075 — Consultor recebe
   notificação de plano pronto, incl. franqueadora com escopo, + aviso de
   apresentação agendada); ~~AJ8~~+~~AJ9~~ ✅ (v0.12.18, sem migração — faixas
   cinza dos horários fora do expediente + respiro no topo da grade, Dia e
   Semana); ~~AJ10~~ ✅ (v0.12.19, sem migração — faixa de dias passado/1 ano,
   scroll do mouse, dia fechado mostra motivo + fechamento parcial = alerta);
   ~~AJ7~~ ✅ (v0.12.21, sem migração — "liberar dia avulso" também estende o
   horário de um dia normal: une com o normal, fim opcional, bloqueia o que já é
   normal; helper `effectiveDayHours` no servidor/seletor/faixa/visão Dia).
   **AJUSTES 2 COMPLETOS (AJ6–AJ11).** Iniciado o **GRUPO 4**: **H4.1 Risartanos
   Lote 1** ✅ (v0.13.0, migração 0076 — módulo base `/risartanos`: tabela
   `staff_members`, código automático, cadastro completo, histórico, ativar/
   inativar; acesso Admin+Gerente+Franqueadora); ~~Lote 1b~~ ✅ (v0.13.1,
   migração 0077 — foto do colaborador: bucket privado staff-photos + upload +
   URL assinada + avatar na lista, também no cadastro/v0.13.2); ~~Lote 2~~ ✅
   (v0.14.0, migração 0078 — vínculo Risartano↔cliente por CPF: colunas
   `staff_member_id`/`risartano_active` + gatilhos automáticos; cadastro
   autopreenche do RH (`lookup_risartano_by_cpf`); ficha destaca "★ É um
   Risartano"/"★ Ex-Risartano (inativo)"; inativação registrada no histórico do
   prontuário); ~~Lote 2b~~ ✅ (v0.14.1, migração 0079 — vínculo Risartano↔
   usuário de acesso por e-mail: `staff_members.user_id` + gatilhos + nome
   sincronizado; coluna Acesso em Risartanos, "Criar acesso" pré-preenchido,
   vincular/desvincular manual; `/admin/usuarios` renomeado "Usuários (acesso)"
   com coluna Risartano). Próximo: H4.1 Lote 3 (auditoria); depois H4.2+
   (módulos novos), um a um com o dono (`docs/ROADMAP.md`).
2. Depois, **H4 restantes** (módulos novos) na ordem numérica (H4.4 já feito).
3. **Rodada de refinamento visual** — tela por tela, guiada pelo dono.
2. **LOTE H2 (ajustes rápidos)** — 12 itens no `docs/BACKLOG.md`.
3. **H3/H4** — priorizar com o dono (melhorias médias + módulos novos).
4. **Rodada de refinamento visual** — tela por tela, guiada pelo dono.
5. **Fase 2 — módulo comercial e além:** apresentação gravada; assinatura digital
   (**ZapSign**) + pagamento (**ASAAS**) com a regra de ouro; **NPS**; WhatsApp
   manual; transcrição/resumo por **IA**; **dashboards com metas**.

## 4. Decisões de arquitetura importantes (com justificativa)

- **Stack fixa:** Next.js 16 (App Router) + Supabase + Vercel, região São Paulo.
  → integração simples, custo previsível, dado de saúde no Brasil (LGPD).
- **Banco único multi-tenant** (`clinic_id` + RLS em toda tabela de negócio).
  → pensado para 200 unidades sem refazer.
- **Segurança em 2 camadas, só o banco é confiável:** RLS do Postgres (barreira
  real) + guardas no app (esconder botões / erros amigáveis).
- **Config por unidade em cascata:** padrão da rede (clinic_id nulo) → override
  por unidade. Usado em SLA, prazos, tabela de preços e agenda.
- **Dinheiro em centavos (inteiro).** → evita erro de arredondamento.
- **LGPD:** consentimento antes de coletar; exclusão = anonimização (nunca apagar);
  mídia com URL assinada; relatórios da rede sem nomes; nunca dado pessoal em
  log/URL.
- **Sem migração de dados** (entrada dupla no início); **migrações aplicadas à
  mão** (SQL numerado, copiado em UTF-8, o dono cola no SQL Editor do Supabase).

## 5. Pendências, dúvidas em aberto e pontos de atenção

- **Migrações 0001–0060 aplicadas** (confirmado no teste geral de 04/07/2026).
- **Decisões tomadas pelo assistente no LOTE B (o dono confirma no teste):**
  cadeira lotada **bloqueia** o agendamento (exceto urgência/emergência) — se
  preferir só *avisar*, dá para mudar; tempo médio do Planner = criação→aprovação.
- **Fuso horário:** horários são guardados como digitados; pode haver pequena
  diferença em filtros de "hoje/semana" (servidor roda em UTC). Atenção na Fase 2.
- **Infra:** `gh` não funciona nesta rede; push por SSH
  (`git@github.com:Riszon/risarte.git`); operações de repositório o dono faz na web.

## 6. Como retomar numa próxima sessão

1. Pasta do projeto: `C:\Users\Jeferson\MVP RIZON\risarte` (git, branch `main`).
2. Ler `CLAUDE.md` (regras de negócio) e este `ESTADO_DO_PROJETO.md` (onde paramos).
3. Conferir, no rodapé da barra lateral, **versão** e **última migração**; se não
   baterem com este arquivo, aplicar as migrações pendentes.
4. Rodar o app: duplo-clique em **"Iniciar Risarte.bat"** (servidor independente
   do assistente).
5. Banco: o assistente escreve a migração e copia em UTF-8; o dono cola no SQL
   Editor do Supabase, **em ordem**.
6. Fluxo de trabalho: o assistente apresenta um plano curto → espera o OK →
   codifica → dá o roteiro de teste. **Backup definitivo = commit no Git.**

## 7. Protocolo de continuidade (combinado em 22/06/2026)

- **No início de cada sessão:** ler `CLAUDE.md` + este arquivo e dizer, em uma
  frase, onde paramos.
- **Ao final de cada etapa relevante:** atualizar este arquivo (o que foi feito +
  próximos passos).
- **Ao final da sessão:** lembrar o dono de **salvar no Git (commit)** — é o backup
  definitivo.
- **Idioma:** interface e textos em **pt-BR**; código em **inglês**.

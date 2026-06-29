# Estado do Projeto — Risarte Odontologia (MVP RIZON)

_Atualizado em: 24/06/2026 · Versão do sistema: **0.8.4** · Última migração: **0050**_

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
  Próximas: **A3** (preenchimento por clique no prontuário + Dentista/Planner
  visualizam + alertas + pergunta específica/ad-hoc); **A4** (obrigatória na 1ª
  consulta, atualização na reavaliação >12 meses, histórico completo).

Lotes seguintes da lista original do dono (a fazer): **Procedimentos** (tempo
estimado → ajusta duração no agendamento e tempo total do plano; planilha-modelo);
**Apresentação do plano** (PPT/PDF para o Comercial).

## 3. Próximos passos (ordem de prioridade)

1. Aplicar a **migração 0043** e fazer o **teste final do LOTE B**.
2. **Rodada de refinamento visual** — tela por tela, guiada pelo dono (cores,
   espaçamento, textos), agora que o fluxo está completo.
3. **Fase 2 — módulo comercial e além:** apresentação gravada; assinatura digital
   (**ZapSign**) + pagamento (**ASAAS**) com a regra de ouro (venda só com
   documento assinado **E** pagamento confirmado); **NPS** pós-fechamento;
   WhatsApp manual; transcrição/resumo por **IA**; **dashboards com metas**.
4. **Polimentos adiados** (em `docs/BACKLOG.md`): semana começando no domingo +
   esconder fim de semana sem agendamento; foto por webcam; gênero + rótulos;
   offline/sync (PWA).

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

- **Migração 0043 pendente** de aplicação.
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

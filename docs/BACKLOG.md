# Backlog Risarte — feedback do proprietário (2026-06-12)

Itens organizados por momento de implementação. Fonte: revisão do proprietário
após a Etapa 3. Nada daqui pode ser perdido; ao concluir um item, marcá-lo.

## Princípios que mudam o modelo (valem para tudo daqui em diante)

- **Risarte Franchising NÃO é uma clínica** — é a franqueadora, o "guarda-chuva"
  da rede. Quando o contexto ativo é a Franchising, as telas mostram a REDE
  (consolidados, todas as clínicas), não uma unidade.
- **Cliente é único na rede** (nunca duplicar). Ele pertence a UMA unidade por
  vez e pode ser transferido entre unidades, com histórico preservado.
- **Quem move o cliente de fase depende da função** (matriz abaixo).
- **Dentista Planner trabalha só no Centro de Planejamento (Franchising)** e
  enxerga consolidados da rede.

## LOTE A — antes da Etapa 4 ✅ CONCLUÍDO em 2026-06-12 (migrações 0005 + 0006)

Tudo abaixo implementado: Fase 1 no kanban (novos cadastros entram nela),
matriz de movimentação no banco + UI, visão de rede de clientes na
Franchising, cliente único com CPF + transferência com consentimento +
selo/histórico de unidades, agenda com profissional responsável (e
notificação), edição registrada, cores por status, 5 em 5 min, sem passado,
mesmo horário lado a lado, botões na Jornada, Franchising sem agenda própria
(aviso até a visão consolidada do Lote B), notificações enriquecidas
(clínica, pilar, remetente com função, fase de origem).

### A1. Fase 1 (Aquisição) no kanban
- [ ] Adicionar `acquisition` ao enum `journey_phase` (antes de
      `clinical_conversion`) e coluna no kanban.
- [ ] Definir fase de entrada de novos cadastros (pergunta aberta ao dono).

### A2. Matriz de movimentação de fase por função (banco + UI)
| De → Para | Quem move |
|---|---|
| 1 Aquisição → 2 Conversão Clínica | Recepcionista |
| 2 Conversão Clínica → 3 Centro de Planejamento | Coordenador Clínico |
| 3 Centro de Planejamento → 4 Conversão Comercial | Dentista Planner |
| 4 Conversão Comercial → 5 Início de Tratamento | Consultor Comercial |
| 5 Início de Tratamento → 6 Reavaliação ou 7 Acompanhamento | Recepcionista |
| 5 Início de Tratamento → 3 Centro de Planejamento | Coordenador Clínico |
| 6 Reavaliação → 7 Acompanhamento ou 3 Centro de Planejamento | Coordenador Clínico |

Admin Master pode tudo. Enforçar na função `move_client_phase` (banco) e
refletir nos botões da UI.

### A3. Visão de rede no ambiente Franchising
- [ ] Tela Clientes com contexto Franchising = clientes de TODA a rede, com
      coluna/filtro por clínica e busca.

### A4. Cliente único na rede (transferência)
- [ ] Detecção de duplicado no cadastro (identificador: pergunta aberta — CPF?).
- [ ] Ao detectar: avisar "já cadastrado na unidade X" e oferecer
      **transferência** (não duplicar). Registro de quem transferiu/quando +
      consentimento do cliente (exigência do brief original).
- [ ] Tabela `client_clinic_history` (unidade, de quando, até quando).
- [ ] Acesso: unidade atual vê tudo; unidade antiga continua vendo o cliente e
      OS REGISTROS QUE ELA MESMA CRIOU (os registros-filhos têm clinic_id
      próprio, então isso sai naturalmente); se o cliente voltar, ela volta a
      ser a unidade atual.
- [ ] Selo visível "Transferido para [unidade]" na ficha e nas listas da
      unidade antiga; evento de transferência na linha do tempo da jornada.

### A5. Agenda — correções e melhorias diretas
- [ ] **Profissional responsável** no agendamento (`provider_user_id`):
      Avaliação/Reavaliação/Retorno → Coordenador Clínico; Apresentação
      Comercial → Consultor Comercial; Início/Sessão de Tratamento → Dentista
      (função nova — pergunta aberta). Notificar o profissional escolhido.
- [ ] **Editar/remarcar** agendamento; toda alteração registrada (audit_logs +
      visível).
- [ ] **Cores por status** nos cartões (agendado/confirmado/realizado/
      cancelado/faltou) + legenda.
- [ ] Horário com minutos **de 5 em 5**.
- [ ] **Bloquear agendamento no passado.**
- [ ] Agendamentos no **mesmo horário empilhados** lado a lado no mesmo nível.
- [ ] Botões "Cadastrar cliente" e "Novo agendamento" na tela **Jornada**.
- [ ] Bug: no ambiente Franchising, campo de cliente do novo agendamento
      mostra código em vez do nome (investigar; possivelmente o ambiente
      Franchising nem deve agendar — confirmar comportamento).

### A6. Notificações — informações adicionais
- [ ] Incluir em cada notificação: clínica de origem, pilar da metodologia,
      enviado por quem (usuário + função), fase de origem da jornada.
- [ ] Consultor Comercial notificado quando: apresentação agendada com ele;
      planner finaliza planejamento (transição 3→4 já notifica — manter).

## LOTE A.2 — feedback do dono após teste do Lote A ✅ CONCLUÍDO em 2026-06-12
## (migrações 0007 + 0008; itens abaixo todos implementados, exceto "Adiado")

### Correções
- [ ] Bug: salvar nome em perfis falha ("infinite recursion" na policy
      `profiles_update_own` — trocar subquery por `public.is_admin_master()`).
- [ ] Horário de agendamento: trocar input time por lista de horários de 5 em
      5 min (o step do input nativo é ignorado pelo navegador).
- [ ] Card de agendamento: exibir horário de início E fim (duração).
- [ ] Notificações enriquecidas funcionam (verificado no banco); "Por:" vazio
      era consequência do bug do nome.

### Cadastro de clientes
- [ ] Campos obrigatórios: nome, CPF, nascimento, telefone, e-mail, endereço,
      número, bairro, cidade, UF, CEP (complemento opcional — assunção).
- [ ] Botão "Cadastrar cliente" na coluna Aquisição do kanban.
- [ ] Responsáveis para menores de 18 (OBRIGATÓRIO): múltiplos responsáveis,
      campos nome/CPF/nascimento/parentesco/contato; se o CPF do responsável
      for cliente Risarte, auto-preencher; ficha do menor mostra responsáveis;
      ficha do responsável mostra dependentes (tabela client_guardians).
- [ ] Código do cliente: gerado automaticamente, identifica cliente + unidade
      (formato CODIGO-UNIDADE-SEQUENCIA, ex.: CBE-00023).
- [ ] Código da unidade: campo `code` em clinics (auto-sugerido, editável).

### Funções e acessos
- [ ] Nova função Encantador(a) (SDR): cadastra clientes, agenda, move 1→2 e
      7→6 (acompanhamento → reavaliação).
- [ ] Sidebar: mostrar a(s) função(ões) do usuário na unidade ativa.
- [ ] Página "Meu perfil": usuário edita os próprios dados não-críticos.
- [ ] Dentista: vê SOMENTE clientes agendados com ele (clientes, jornada e
      agenda filtrados); não vê a agenda dos outros profissionais.

### Agenda × Jornada (automação)
- [ ] Tipo de agendamento automático pela fase da jornada do cliente
      (1ª vez = Avaliação; quem já é cliente e volta = Reavaliação; fase 4 =
      Apresentação; fase 5 = Início/Sessão; etc.), exibindo fase atual →
      próxima no diálogo. Não alterar tipos de agendamentos passados.
- [ ] Se o último agendamento foi cancelado/faltou: mostrar aviso de que o
      cliente continua na fase atual (reagendamento).
- [ ] Tipos Urgência e Emergência: sinalizados no agendamento, destaque no
      card e permissão de encaixe (pode sobrepor horários).
- [ ] Ao mover de fase: notificar TAMBÉM a recepção para agendar o próximo
      compromisso (fases que exigem agendamento).

### Transferência de clientes
- [ ] Cancelar automaticamente os agendamentos futuros da unidade antiga;
      mostrar na unidade nova quais horários foram cancelados, sugerindo
      reagendar.
- [ ] Notificar também Gerente e Coordenador Clínico da unidade que perdeu o
      cliente (hoje só recepção).
- [ ] Histórico de unidades e linha do tempo: mostrar data + HORA + usuário.
- [ ] Unidade antiga sem ações na jornada e linha do tempo limitada até a
      transferência — JÁ FUNCIONA por construção (RLS por clinic_id nas
      tabelas-filhas); validar no teste.

### Adiado
- [ ] Consolidação financeira na transferência (realizado × pago × aberto)
      → Fase 3, junto com o módulo financeiro (decisão do dono).

## LOTE A.3 — feedback do dono após teste do Lote A.2 (2026-06-13)

### Bugs corrigidos já (migração 0009 + código)
- [x] Dentista via TODOS os clientes da clínica (acesso por histórico de
      unidade usava user_clinic_ids incl. dentista) → usa full-access.
- [x] Dentista Planner não conseguia abrir ficha/jornada do cliente → is_planner()
      adicionado às policies de clients/journey/appointments.
- [x] Notificações com símbolos (`Â·`, `ClÃ­nica`) → causa: cópia do SQL para
      o clipboard relia UTF-8 como Latin-1. Funções recriadas com texto correto
      e entrega via UTF-8; notificações antigas limpas.
- [x] Seletor de clínica mostrando código no cadastro de usuário → SelectValue
      com função que resolve o rótulo.

### Cadastro de clientes (próximo lote a construir)
- [ ] CPF em PRIMEIRO no cadastro: ao informar, verificar duplicado ANTES de
      preencher o resto (evita refazer tudo).
- [ ] Base de "prospects" (não-clientes): responsáveis que não são clientes
      entram nela; ao cadastrar futuro cliente com aquele CPF, auto-preencher;
      e logo após cadastrar, mostrar os dependentes já vinculados.
- [ ] Responsável deve ter 18+ (validação).

### Agenda / atendimento (parte vira detalhamento da Jornada)
- [ ] Notificação de atraso (passou do horário): recepção, coordenador,
      gerente e dentista (só os seus) + destaque visual no card exigindo
      mudar status.
- [ ] Registrar CHEGADA do cliente no card.
- [ ] Tela de fluxo de atendimento: chegada → sala de espera (lista) →
      chamar → em atendimento. (Pertence ao detalhamento da Jornada.)
- [ ] Cadeiras de atendimento por clínica (2/3/4) e agenda dimensionada por
      cadeiras disponíveis.
- [ ] Visões da agenda: dia / semana / mês; domingo como 1º dia da semana,
      sábado/domingo só aparecem se houver agendamento; nº da semana (ex.: 25/53).
- [ ] Destaque para a lista de horários cancelados na transferência.

### Usuários e RBAC
- [ ] Cadastro de usuário: CPF (único, sem duplicar, auto-preenche se já
      existe), nascimento, telefone, endereço, data de cadastro, histórico de
      alterações, código de identificação do usuário.
- [ ] Admin Master pode editar o e-mail após o cadastro.
- [ ] Coordenador Clínico e Gerente podem cadastrar Recepcionista e Dentista
      na sua unidade.
- [ ] Restrição de funções por tipo de clínica:
      - Franqueadora: Dentista Planner, Consultor Comercial, Assistente
        Comercial, SDR.
      - Unidades: Coordenador Clínico, Gerente de Unidade, Recepcionista,
        Dentista.

### Notificações
- [ ] Por padrão, mostrar só as da unidade ATIVA; botão "ver todas".
- [ ] Ao abrir notificação de outra unidade: confirmar troca de unidade e
      trocar contexto (unidade + função) automaticamente.

### Jornada (detalhamento solicitado pelo dono — fazer ANTES da Etapa 4)
- [ ] Detalhar o passo a passo de cada fase conforme o brief original
      (recepção → consulta → coleta de dados → ... ; o fluxo de atendimento
      sala de espera/em atendimento entra aqui). É a espinha dorsal; alinhar
      com o dono antes de construir Etapas 4 e 5.

## JORNADA — desenho detalhado (2026-06-13) → ver docs/JORNADA.md

Documento-fonte do dono em `docs/JORNADA-fonte.md`; spec consolidada em
`docs/JORNADA.md`. Decisões: pilar auto por fase + treatment_pillar do Planner;
criar TSB/ASB + travar função por ambiente; check-in automático + sub-status;
construir a BASE da jornada antes dos módulos clínicos.

**Lote Base da Jornada (próximo a construir, nesta ordem):**
- [ ] Funções `tsb`/`asb` + trava de atribuição por tipo de clínica.
- [ ] Pilar automático por fase + `treatment_pillar` (renomear sentido de
      methodology_pillar) + exibição calculada.
- [ ] `journey_status` (sub-status por fase) automático + exibição.
- [ ] Check-in nos agendamentos + transições automáticas (1→2, 1→5 urg/emerg,
      4→5, 7→6, 7→5) + painel de sala de espera (chegada/em espera/em atendimento).
- [ ] Decisões obrigatórias da fase 5 (tarefa bloqueante + escalonamento ao
      Coordenador + avisos ao Gerente).
- [ ] Regras automáticas de ativo/inativo (limites configuráveis no SLA).

**OFFLINE/SYNC (não esquecer — fase dedicada depois do núcleo):** PWA + motor
offline-first (avaliar PowerSync/ElectricSQL para Supabase) ou PWA+outbox.
Manter modelo sync-friendly desde já.

## LOTE ACESSO FRANQUEADORA (2026-06-13) — escopo de unidades por usuário

No cadastro de QUALQUER função da Franqueadora, escolher o acesso às unidades
franqueadas: **Todas** / **Unidades específicas (várias)** / **Nenhuma**.
O acesso (jornada, agenda, clientes) das funções da matriz passa a respeitar
esse escopo (hoje veem tudo). Dados existentes migram como "Todas" para não
quebrar. Modelo: coluna `unit_scope` na atribuição da função na Franqueadora +
tabela de unidades específicas. RLS passa a usar "unidades acessíveis".

Listas/acessos por função (dentro das unidades permitidas):
- **SDR:** agenda nas unidades permitidas; cadastra clientes; vê a jornada dos
  clientes que ELA cadastrou; lista = clientes que a própria SDR cadastrou nas
  unidades permitidas, nas FASE 1 e 2 (até o check-in) e FASE 5
  (urgência/emergência até o check-in).
- **Consultor Comercial:** vê agenda e jornada das unidades permitidas; ao
  agendar apresentação comercial, poder escolher o Consultor com permissão
  naquela unidade (hoje o seletor de profissional busca só a equipe da unidade —
  precisa buscar os consultores da matriz com acesso à unidade); lista =
  clientes das unidades permitidas em FASE 3, 4 e 5 (status "aguardando início
  do tratamento").
- **Dentista Planner:** faz planejamentos das unidades permitidas; vê agenda e
  jornada das unidades permitidas; lista = clientes das unidades permitidas em
  FASE 2, 3, 4 e 6.

## LOTE C + AJUSTES (2026-06-13) — decisões e itens

Decisões do dono: (1) Consultor vê SÓ seus clientes (agendados p/ ele + que ele
apresentou) até o check-in na Fase 5; (2) Recepcionista edita QUALQUER
agendamento da sua unidade; (3) cliente cadastrado pela SDR pertence à
Franqueadora (código FRA) + unidade preferida, aparece na lista da unidade sem
duplicar, transfere para a unidade no check-in.

### Feito agora
- [x] Planner define pilar só na Fase 3; obrigatório antes de F3→F4; fora da
      Fase 3 só Admin Master altera (migração 0015 + app + UI).
- [x] Card de agendamento mostra o nome do Consultor (resolvido pela lista de
      profissionais, contornando a RLS de profiles).
- [x] Ao agendar hoje, horários passados não aparecem como opção.
- [x] Agendamento passado não pode ser editado — só ajuste de status.
- [x] Agenda do Consultor = só os agendamentos no nome dele (não vê F2/F6, nem
      agenda de outro consultor).

### A fazer na sequência (Lote C / ajustes)
- [ ] Listas por função: Consultor = só seus clientes até check-in F5; Planner =
      F2/3/4/6 das unidades permitidas; SDR = clientes que ELA cadastrou em
      F1/F2 (até check-in) e F5 (urgência/emergência até check-in).
- [ ] Edição por dono: SDR edita só os agendamentos que ela criou; Recepcionista
      edita qualquer um da sua unidade. (SDR vê toda a agenda das unidades dela.)
- [ ] SDR: botões de cadastrar cliente e agendar (com escolha da unidade entre
      as que ela tem acesso); cliente cadastrado pela SDR = clinic_id
      Franqueadora (código FRA) + `preferred_clinic_id`; aparece na lista da
      unidade preferida sem duplicar (ajustar RLS e listas).
- [ ] Recepcionista/SDR recebem notificação de agendamentos passados que elas
      criaram e que ficaram sem atualização de status (ex.: faltou/cancelado) —
      precisa de verificação automática (cron) ou destaque na agenda. Fazer
      destaque visual já; notificação por job depois.

### Adiado (não esquecer)
- [ ] Configuração de horário de funcionamento/agenda por unidade.
- [ ] Cadeiras de atendimento por unidade (2/3/4) e agenda dimensionada por
      cadeiras + profissionais.
- [ ] Gênero (M/F) no cadastro de usuário e de cliente, com tratamento das
      funções/textos conforme o gênero (Coordenadora/Coordenador, O/A cliente).
      Adicionar o campo e aplicar os rótulos gradualmente.

## LOTE D — feedback do teste geral da Base da Jornada (2026-06-14)

### Feito agora (migração 0021)
- [x] BUG: SDR agendando não via o Coordenador (RLS bloqueava ler a equipe da
      unidade) → função definer unit_scheduling_staff().
- [x] Passo 5: "Não sei" só aparece para o profissional original; ao escalar
      para o Coordenador, só Sim/Não.
- [x] Agendar: aparecem também clientes inativos (marcados como "inativo").
- [x] Clientes: filtro Ativos / Inativos.
- [x] Ficha: idade detalhada (anos, meses, dias) + quem cadastrou o cliente.
- [x] Atendimento: quem CHAMOU é quem CONCLUI; Coordenador/Dentista/Consultor
      podem chamar; ao chamar abre a ficha; done → agenda "Realizado".
- [x] Notificação ao profissional quando o cliente fica "Em espera".

### Etapa 1 — Status do cliente e tratamento ✅ (migração 0022 + código)
- [x] Cliente em tratamento: novo agendamento já vem como "Sessão de Tratamento"
      (default por journey_status in_treatment); ao concluir uma sessão sem
      próxima sessão agendada, a recepção é notificada (update_attendance 0022).
- [x] "Aguardando iniciar tratamento" sem agendamento futuro → banner em destaque
      + ícone de alerta na lista de clientes (computado na página de clientes).
      (Notificação push persistente "até agendar" ficaria com o job diário —
      avaliar depois; o banner/ícone já é o sinal confiável.)
- [x] Botão "Novo agendamento" dentro da ficha do cliente (recepção/SDR) —
      AppointmentFormDialog com fixedClinicId (unidade preferida quando SDR).

### Etapa 2 — Tela de Atendimento ✅ (migração 0023 + código)
- [x] Consultor Comercial enxerga a tela Atendimento (só os clientes agendados
      com ele, na visão "Seus atendimentos" do contexto Franqueadora).
- [x] Atendimento: filtros por dia/semana/mês e por profissional.
- [x] Atendimento: histórico por atendimento (tempo em espera, em atendimento,
      quem movimentou) — carimbos checked_in_by/called_at/done_at/done_by (0023).
- [x] Sincronização agenda↔atendimento nos rótulos intermediários: o card da
      agenda mostra "Aguardando atendimento" / "Em atendimento" / "Realizado"
      conforme o attendance (displayedStatus no week-grid).

### Etapa 3 — Cadastro com CPF primeiro ✅ (migração 0024 + código)
- [x] CPF no topo do cadastro, com checagem ao sair do campo (formato escolhido
      pelo dono: formulário único, CPF no topo). Cliente já existente → card
      "já cadastrado" com Abrir ficha / Transferir (consentimento), reaproveitando
      o fluxo de duplicado. Prospect/responsável (find_prospect_by_cpf, 0024) →
      auto-preenche nome, nascimento e telefone. A checagem no salvar permanece
      como rede de segurança.

### Adiado (não esquecer)
- [ ] Foto do cliente por webcam (captura + Storage) — agora pode reusar o
      bucket privado clinical-media criado na Etapa 4.

## ETAPA 4 — Módulo do Coordenador Clínico

### Etapa 4.1 — Fundação ✅ (migração 0025 + código)
- [x] Storage privado (bucket clinical-media) + RLS por clínica (links assinados).
- [x] Consentimento (client_consents) registrado antes de coletar dados (LGPD).
- [x] Upload de fotos/radiografias/escaneamento/exames/documentos (clinical_media,
      upload direto do navegador; só Coordenador da clínica).
- [x] Considerações clínicas (clinical_notes).
- [x] Botão "Enviar ao Centro de Planejamento" na seção (reusa move_client_phase).
- [x] Seção "Avaliação clínica" na ficha: edição p/ Coordenador, leitura p/
      Planner/Gerente/Admin.

### Etapa 4.2 — Gravação de áudio ✅ (só código, sem migração)
- [x] Gravação de áudio da consulta no navegador (MediaRecorder), liberada após
      o consentimento, enviada ao bucket clinical-media (kind 'audio'). Player de
      áudio inline na lista de arquivos.
- [ ] Transcrição/resumo por IA do áudio → FASE 2 (serviço isolado e trocável).

### Etapa 4.3 — junto com a Etapa 5
- [ ] Aprovar/Reprovar plano (depende do plano criado no Centro de Planejamento).

## LOTE E — considerações/correções antes da Etapa 5 (2026-06-19)

### E-modelo — Opção A ✅ (migração 0026 + código) — raiz de E0/E1/E2
Confirmado: a migração 0025 ESTÁ aplicada (tabelas + bucket existem). O bug era
o modelo: cliente da SDR pertencia à Franqueadora. Opção A: o cliente da SDR
passa a PERTENCER À UNIDADE escolhida (clinic_id = unidade), código mantém o
prefixo FRA (next_client_code da Franqueadora, gerado no app). Migração 0026:
policy de INSERT libera a SDR-com-acesso a criar na unidade + move os clientes
"da Franqueadora" existentes para a unidade de preferência. Isso conserta:
- [x] E0: anexar/ler arquivos clínicos (clinic_id = unidade → Coordenador tem papel).
- [x] E1: cliente da SDR aparece na Jornada da unidade (clinic_id = unidade).
- [x] E2 (parte): cliente mostra a unidade certa, não "Franqueadora".

### E1 — Jornada (regras de visibilidade e fases) ✅ (código)
- [x] Tirar os botões de mover fase da SDR (removida do PHASE_TRANSITIONS — vale
      jornada e ficha). 7→6 e 1→2 passam a ser por recepção/check-in.
- [x] Dentista NÃO tem a tela Jornada (escondida no menu + rota redireciona).
- [x] Todos os usuários da unidade (exceto Dentista) veem a Jornada.
- [x] cliente cadastrado pela SDR aparece na Jornada da unidade — resolvido pela
      Opção A (clinic_id = unidade).
- [x] Clientes inativos aparecem na Jornada, identificados ("Inativo" + opacidade)
      + filtro Ativos/Inativos.

### E2 — Clientes (lista e ficha) — unidade visível p/ Franqueadora ✅ (código)
- [x] Lista de Clientes: coluna Unidade na visão Franqueadora já mostra a unidade
      do cliente (após Opção A, clinic_id = unidade, sem "Franqueadora").
- [x] Ficha: mostra "Unidade: X" no cabeçalho (embed clinics!clients_clinic_id_fkey).
- [x] Indicador de quantidade de clientes na tela Clientes (contador no título).

### E3 — Agendamento (conflitos e clareza da unidade) ✅ (migração 0029 + código)
- [x] Trava de conflito (trigger 0029): mesmo profissional não pode ter 2 no
      mesmo horário (Urgência/Emergência permitem encaixe); mesmo cliente não
      pode 2x no mesmo horário. Mensagens claras no app.
- [x] Novo Agendamento (SDR): rótulo "Agendando na unidade: X" + troca de unidade
      no seletor (agendar em outra unidade); botão "Ver agenda" (link p/ a agenda
      da unidade); horários já ocupados não aparecem na lista (getDayBusyTimes).
- [x] Ficha (SDR): unidade já mostrada (feito no E2).

### E4 — Cadastro de novo cliente (SDR/Recepção) — cliente já existente ✅ (migração 0030 + código)
- [x] Cliente já existe → card mostra "já é cliente da unidade X" (destaque) +
      "Abrir a ficha". SDR/Recepção podem EDITAR (RLS + guard liberados p/ SDR).
- [x] Histórico de alterações cadastrais na ficha (client_changes: quem, quando,
      quais campos — LGPD: campos, não valores).
- [x] SDR: nunca transfere p/ Franqueadora. Card pede a unidade de preferência;
      se for diferente da atual, mostra "transferir da unidade A para a B" com
      autorização/consentimento (transferClientToUnit → unidade escolhida).

### E5 — Atendimento do Consultor Comercial ✅ (migração 0032 + código)
- [x] Consultor vê atendimento consolidado das suas unidades, com a unidade no
      card + FILTRO por unidade específica.
- [x] Consultor movimenta o cliente em TODAS as etapas: registrar chegada
      (check_in liberado para o profissional responsável — 0032), chamar e
      concluir (já permitidos).

### CORREÇÃO transferência (migração 0031)
- [x] BUG: SDR transferindo A→B dava "não foi possível" — transfer_client exigia
      papel NA clínica de destino. Agora aceita SDR-com-acesso. Também corrigido
      o fuso ('America/Sao_Paulo') do resumo de cancelados.

### E6 — Avaliação Clínica (melhorias) ✅ (migração 0027 + código)
- [x] Upload de MÚLTIPLOS arquivos de uma vez (tipo por arquivo, adivinhado pelo
      tipo do arquivo). Upload robusto: id seguro (sem crypto.randomUUID em
      contexto inseguro) + try/catch que SEMPRE mostra o erro real (corrige o
      "botão não funciona" silencioso).
- [x] Link externo (ex.: escaneamento) como item de mídia (clinical_media.
      external_url; storage_path nulo para links).
- [x] Considerações clínicas EDITÁVEIS, com histórico (clinical_note_revisions +
      updated_at/updated_by) e marca "editado em ... por ...".
- [x] (ligado ao E-modelo) anexar/acessar arquivos do cliente da SDR — resolvido
      ao cliente pertencer à unidade (0026).
- [x] Upload confirmado funcionando pelo dono.
- [x] Botão "Escolher arquivos" (input nativo escondido) no lugar do input cru.
- [x] Visualizar sem baixar: preview inline de imagem (foto/radiografia), vídeo e
      áudio (por content_type/kind); documentos abrem no navegador (link).
- [x] Vídeo como tipo de mídia (migração 0028) + player inline. Link assinado de
      1h para não expirar durante a reprodução.
- [x] Documentos (PDF) visualizáveis sem baixar (iframe embutido "Visualizar");
      clicar no nome não baixa mais (download é botão explícito).
- [x] Galeria de fotos (MediaGallery): miniaturas → lightbox com navegação por
      seta do teclado, botões (mouse) e deslize (toque).
- [x] Mídia agrupada por categoria: Fotos, Vídeos, Áudios, Radiografias, Exames,
      Documentos, Escaneamento — sempre com quem enviou, quando e tamanho.

### E7 — Cliente atendido em mais de uma unidade simultaneamente
Decisões do dono: qualquer unidade (A ou B) pode iniciar; a B vê só o necessário
(identidade + agendar/atender + registros da própria B), sem plano/clínico/
financeiro da A. Regras: trava de conflito (0029) já impede agendamento
simultâneo; registros separados por clinic_id próprio → não misturam.

#### E7.1 — Base do compartilhamento ✅ (migração 0033 + código)
- [x] Tabela client_shares (compartilhamento ativo) + funções share_client_with_unit
      / end_client_share (qualquer unidade A ou B inicia: papel na origem OU destino).
- [x] RLS de clients estendida: a unidade B enxerga o cliente compartilhado.
- [x] Ficha: card "Compartilhamento entre unidades" (compartilhar + encerrar) +
      agendamento da B vai para a B (scheduleClinicId = unidade ativa quando é a
      origem ou uma unidade compartilhada).
- [x] Lista de Clientes: seção "Compartilhados com a unidade" (a B encontra o cliente).

#### CORREÇÃO (migração 0034) — recursão de RLS
- [x] BUG: a 0033 recriou clients_select_member com `exists client_shares` inline,
      causando recursão infinita com a policy de client_shares → nenhum cliente
      aparecia (lista/jornada/agenda). Corrigido com a função SECURITY DEFINER
      client_shared_with_user() na policy de clients.

#### E7.2 — Fecho do compartilhamento ✅ (só código, sem migração)
- [x] B INICIAR por CPF: botão "Compartilhar cliente" na lista de Clientes da
      unidade → diálogo CPF + motivo (shareClientByCpf → find_client_basic_by_cpf
      + share_client_with_unit para a unidade ativa).
- [x] B registra a PRÓPRIA avaliação clínica do compartilhado: requireCoordinator
      aceita o Coordenador de uma unidade compartilhada e devolve a clínica certa
      (prefere a ativa); a ficha usa scheduleClinicId na seção clínica; a RLS já
      separa os registros por clinic_id (A não vê os de B e vice-versa).
- [x] Encerrar pelo lado da B: canEnd inclui a equipe da unidade compartilhada.

LOTE E COMPLETO (E0–E7).

## LOTE B — agenda avançada e consolidados (junto/logo após Etapas 4-5)

- [ ] **Configurações de agenda por unidade** (dias da semana, horário de
      funcionamento/agendamento) — padrão cascata como SLAs.
- [ ] Visões **diária / semanal / mensal** da agenda (anual: ver Fase 2).
- [ ] **Quadro-resumo por unidade**: total de agendamentos por tipo, status,
      dia, semana, mês (depois comparado com metas).
- [ ] **Visão de rede da agenda (Franchising/Admin Master)**: sem nomes de
      pacientes — quantidades por clínica/tipo/status, botão para abrir a
      agenda da clínica, resumo da rede (total, por status, por tipo, por
      dia/semana/mês).
- [ ] **Visões do Dentista Planner**: jornada = consolidado da rede
      (quantidade por fase + por pilar, filtro por clínica); agenda =
      consolidado da rede com foco em avaliações (F2), reavaliações (F6) e
      apresentações comerciais (F4); clientes = acesso de leitura aos clientes
      da rede que passaram pelo Centro de Planejamento.

## ETAPA 5 do MVP (Centro de Planejamento) — incorporar

- [ ] **Fila priorizada** de casos no Centro de Planejamento: prioridade =
      apresentação comercial agendada mais próxima; empate = quem chegou
      primeiro à fase 3.
- [ ] Central de notificações/casos do Admin Master: todas as notificações do
      Centro de Planejamento organizadas por fase, com filtros por unidade,
      por planner, por usuário, por pilar.

## FASE 2 (com dashboards) — incorporar

- [ ] **Módulo de Metas/Objetivos/Combinados**: criados no ambiente
      Franchising; escopo = só Franchising, toda a rede ou unidades
      específicas; unidades apenas visualizam. Comparativos
      realizado × meta (começando por agendamentos).
- [ ] Visão **anual** da agenda (agregados por mês).
- [ ] Quadros-resumo comparados com metas (rede e por unidade).

## Decisões do dono (2026-06-12)

1. **Função "Dentista" (executor): CRIAR AGORA.** Atua na unidade; vê agenda e
   seus pacientes; acessa o plano de tratamento aprovado; não move fases, não
   negocia, não planeja. Tipos de agendamento Início/Sessão de Tratamento (e
   Retorno, junto com Coordenador) apontam para ela.
2. **Duplicados: CPF obrigatório** no cadastro de clientes (identificador
   único da rede). Sem CPF (ex.: criança), avisar quando houver nome + data de
   nascimento iguais.
3. **Novos cadastros entram na Fase 1 (Aquisição).** Clientes existentes
   permanecem na fase em que estão.
4. **Metas: versão completa na Fase 2** com os dashboards. Quadros-resumo de
   agendamentos (sem metas) chegam antes, no Lote B.

## LOTE F — feedback pós-teste da Etapa 5 (2026-06-22)

Organizado em sub-etapas (ordem sugerida: F1 ganhos rápidos → F7 cockpit do
Planner, o maior). Cada sub-etapa só inicia com o OK do dono.

### F1 — Ganhos rápidos (correções de UX)
- [ ] **Cadastro SDR na própria unidade:** quando o cliente já está cadastrado na
      UNIDADE A e a SDR tenta cadastrá-lo na UNIDADE A, o sistema deve identificar
      que já é cliente daquela unidade e fazer o preenchimento automático
      (hoje não dispara o esperado — investigar `lookupCpfForRegistration` /
      `find_duplicate_client` no fluxo SDR mesma-unidade).
- [ ] **Ficha do cliente abre em modo leitura:** SDR/recepcionista veem a ficha
      somente-leitura ao abrir, com um botão **"Editar"** que libera a edição dos
      dados (hoje abre já editável).
- [ ] **Filtros aplicam automaticamente** ao selecionar a opção (sem botão
      "Filtrar"). Vale para Jornada, Clientes, Agenda, Notificações, Atendimento,
      Procedimentos e onde mais houver filtro.

### F2 — Compartilhamento de cliente entre unidades
- [ ] Ao **iniciar e ao encerrar** o compartilhamento, **notificar os usuários das
      DUAS unidades** (A origem e B compartilhada).
- [ ] Toda movimentação de compartilhamento (iniciar/encerrar) fica registrada no
      **histórico do cliente** (na ficha).

### F3 — Procedimentos (renomear "Tabela de Preços" → "Procedimentos")
- [ ] Renomear o módulo para **Procedimentos**.
- [ ] Campos do procedimento: Nome, **Código Interno (automático)**, **Código
      TUSS**, **Especialidade**, **Preço Padrão**, **Preço Mínimo**, **Preço
      Máximo**, **Comissionamento**, **Pilar da Metodologia**.
- [ ] **Importar planilha** com todos os procedimentos (cadastro em massa).
- [ ] Acesso/edição: **Admin Master e Dentista Planner** (hoje só Admin).
- [ ] **Campo de busca** de procedimento.
- [ ] **Filtros:** por Especialidade, Ativo/Inativo, e por Pilar da Metodologia.
- [ ] **Histórico** de alterações/atualizações dos procedimentos.
- [ ] **Reajuste de preço em massa:** todos, ou específicos, ou por Especialidade,
      ou por Pilar (percentual).
- [ ] Editar procedimento → abre **todos os campos** editáveis.
- [ ] **Excluir = desativar** (soft): não apagar procedimentos usados em planos
      passados/aprovados/finalizados/planejados; apenas impedir uso futuro.

### F4 — Plano de Tratamento (aprovação)
- [ ] Coordenador aprova/reprova **cada opção** do plano (não o plano inteiro).
- [ ] O **plano principal** sempre aparece **primeiro e com mais destaque**.
- [ ] Na aprovação, o Coordenador vê **apenas o valor total** dos procedimentos de
      cada opção (não o preço item a item).
- [ ] O Coordenador **não edita** o plano nem o orçamento do Planner (confirmar
      somente-leitura).
- [ ] O Coordenador pode **enviar considerações também ao aprovar** (não só ao
      devolver).

### F5 — Centro de Planejamento (fila do Planner)
- [ ] O Planner visualiza, separadas, as situações: aguardando planejamento;
      aguardando aprovação do Coordenador; retornados para revisão; aprovados;
      enviados ao Consultor Comercial.
- [ ] Visualização por **Dia / Semana / Mês / período específico**.

### F6 — Central de Notificações
- [ ] Lugar específico e de fácil visualização, com notificações categorizadas:
      aprovação/revisão de plano; compartilhamento de cliente; **início de
      tratamento** (clientes que fecharam com o comercial); **transferência** de
      clientes.

### F7 — Módulo/cockpit do Dentista Planner (o maior)
- [ ] Tela dedicada onde o Planner cria o planejamento com agilidade, abrindo as
      informações do cliente em **pop-ups** (fotos, radiografias, resumos,
      documentos, escaneamento, vídeos, áudios) **sem trocar de tela**. Ele
      seleciona o que quer visualizar enquanto escreve o plano.

**Decisões do dono (2026-06-22):**
- Ordem: começar por **F1 + F2**.
- **Comissionamento:** ter **os dois** campos — porcentagem (%) **e** valor fixo
  (R$) — e o comissionamento é **condicionado à conclusão do procedimento** (só
  conta/realiza quando o procedimento é concluído). [F3]
- **Aprovação por opção:** o plano só vai ao Comercial quando **todas as opções
  tiverem decisão** (aprovada ou reprovada) **e houver ao menos uma aprovada**. [F4]
- **Importação:** planilha **Excel (.xlsx)**. [F3]

## LOTE B — Agenda avançada e consolidados (2026-06-22, consolidado)

Após o LOTE F. Sub-etapas (ordem sugerida; cada uma só inicia com o OK do dono):

### B1 — Visões da agenda: Dia / Semana / Mês
- [ ] Hoje a agenda é só semanal. Adicionar visão **Dia** e **Mês**, com
      navegação (anterior/hoje/próximo) e **nº da semana** (ex.: 25/53).
- [ ] Domingo como 1º dia; **sábado/domingo só aparecem se houver agendamento**.

### B2 — Configuração da agenda por unidade
- [ ] **Horário de funcionamento** (abertura/fechamento e dias) por unidade,
      no padrão cascata (padrão da rede → override por unidade); a grade da
      agenda passa a respeitar esse horário.

### B3 — Cadeiras de atendimento por unidade
- [ ] **Nº de cadeiras (2/3/4)** por unidade; a agenda/atendimento considera a
      **capacidade** (avisar/limitar agendamentos simultâneos por cadeira).

### B4 — Quadros-resumo de agendamentos
- [ ] Painel com **totais** de agendamentos por período / unidade / tipo /
      profissional (sem metas ainda — metas completas ficam na Fase 2).

### B5 — Visão de rede (consolidada, sem nomes de pacientes)
- [ ] Consolidado da rede por **unidade/fase** com **contagens**, **sem expor
      nomes** de pacientes (privacidade/LGPD), para a Franqueadora.

### B6 — Contadores de produtividade do Dentista Planner
- [ ] Versão leve: planos criados / enviados / aprovados / devolvidos, tempo
      médio até planejar (o gargalo do negócio). Dashboards completos = Fase 2.

**Decisões a confirmar ao chegar em cada item:** B3 = avisar ou bloquear ao
estourar a capacidade de cadeiras; B6 = quais métricas exatas; B2 = horário
único por unidade ou por dia da semana.

## LOTE H — feedback do TESTE GERAL do MVP (2026-07-04)

Fonte: `docs/ROTEIRO-TESTE-GERAL.md` preenchido pelo dono após o teste geral
por papel. Organizado em 4 grupos por prioridade (H1 bugs → H4 módulos novos).
Nada daqui pode ser perdido; ao concluir um item, marcá-lo.

> **Ordem de construção + "como fazer" de cada item: `docs/ROADMAP.md`**
> (decisão do dono: H3.1 → H3.15 em sequência, depois H4.1 → H4.14).

### H1 — Bugs e segurança ✅ COMPLETO (04/07/2026, migrações 0061–0062)
- [x] **H1.1 Relatórios vazando escopo (SEGURANÇA):** papel de gestão vale na
      clínica ativa + todas as consultas filtram pelo escopo (v0.10.4).
- [x] **H1.2 Comercial não vê a Apresentação:** helper `hasRoleWithScopeForClinic`
      considera o escopo de unidades da Franqueadora (v0.10.4).
- [x] **H1.3 Cliente em 2 atendimentos ao mesmo tempo:** bloqueado no banco
      (`CLIENT_BUSY`) + card em espera sem botão (migração 0061, v0.10.5).
- [x] **H1.4 Coordenador chama cliente de outro dentista:** só o profissional do
      agendamento chama (`NOT_PROVIDER` + `canCallRow`) (0061, v0.10.5).
- [x] **H1.5 Sessões somem do agendamento:** pop-up "i" + edição mostram/editam
      as sessões vinculadas; `updateAppointment` sincroniza (v0.10.6).
- [x] **H1.6 Dia avulso sem horários:** seletor conhece dia avulso/feriado
      (`getDaySchedule`) e oferece a janela do dia (v0.10.6).
- [x] **H1.7 Troca de unidade não fecha a tela anterior:** redireciona ao Início +
      tela de boas-vindas escolhe a unidade no login (v0.10.7).
- [x] **H1.8 Encerrar compartilhamento:** aba Compartilhados lista os 2 sentidos
      com detalhes + botão Encerrar (recepção/coordenador/gerente/admin); banco já
      notifica as 2 unidades (v0.10.9).
- [x] **H1.9 Autopreenchimento por CPF incompleto:** traz todos os dados do
      cliente (e-mail, endereço, etc.) via `ClientAutofill` (v0.10.7).
- [x] **H1.10 Cadeiras — máximo definido pelo Admin:** `clinics.max_rooms` no
      cadastro; a Gerente não cria acima do teto (migração 0062, v0.10.8).

### H2 — Ajustes rápidos ✅ COMPLETO (04/07/2026, sem migração, v0.11.0)
- [x] H2.1 Aba "Ativos" → "Clientes" (o número soma ativos+inativos).
- [x] H2.2 "Usuários" → "Risartanos" (menu + título; rota mantida).
- [x] H2.3 Pilar: sem etapa de confirmação; envio só exige o pilar definido.
- [x] H2.4 Depois de enviar ao Comercial: "Reabrir para edição" some (volta se
      o caso retornar ao Centro de Planejamento).
- [x] H2.5 Trocar para a visão Dia abre HOJE (toolbar parte de hoje).
- [x] H2.6 A visão Mês abre o mês ATUAL (idem — toolbar parte de hoje).
- [x] H2.7 Na visão Semana, clicar no dia (cabeçalho) abre a visão Dia.
- [x] H2.8 Card de 15 min compacto com o nome do cliente (Dia + Semana).
- [x] H2.9 Alerta na escolha da data: dia fechado/feriado/dia avulso + alerta
      âmbar quando urgência/emergência em dia fechado (liberado com aviso).
- [x] H2.10 Dia/horário passado não abre o pop-up de agendamento; só avisa.
- [x] H2.11 Alterar situação (cancelar/faltou) pelo pop-up "i" em qualquer
      visão; cancelamento devolve as sessões do tratamento para "a agendar".
- [x] H2.12 Pop-up "i" mostra as sessões/procedimentos do agendamento (via H1c).

### H3 — Melhorias médias
- [x] H3.1 Formulário de agendamento reordenado ✅ (v0.11.2): data/horário/
      sugestões como ÚLTIMA etapa, sob o título "Quando será o atendimento?".
- [x] H3.2 "Ver agenda" rica ✅ (v0.11.3): bloqueios, feriados, dias abertos/
      fechados/avulsos + nº de agendamentos e de horários livres por dia (para
      o profissional/sala/duração escolhidos); clicar no dia preenche a data e
      o seletor lista os horários livres.
- [x] H3.3 Seletor de dias na agenda ✅ (v0.11.4): régua rolável de 42 dias com
      disponibilidade (verde/vermelho), nº de agendamentos e feriados/fechados/
      avulsos/bloqueios evidentes; clicar abre a visão Dia.
- [x] H3.4 Status de atendimento ✅ (v0.11.5, migração 0063): faltou / cancelou
      em cima da hora / desistiu da espera (gave_up); espera longa (limite
      configurável, padrão 20 min) destaca em vermelho e notifica a cada 15 min;
      pendências de dias anteriores geram aviso diário + banner no painel.
- [x] H3.4b Atendimento não resolvido carrega para o dia ✅ (v0.11.8, migração
      0065): pendentes (a chegar/em espera/em atendimento) de dias anteriores
      aparecem no painel de hoje com "Pendente desde DD/MM"; "em atendimento"
      não concluído bloqueia a cadeira e o profissional até concluir.
- [x] H3.5 Check-in com confirmação ✅ (v0.11.6): pop-up confirma cliente,
      horário/tipo, profissional e sala antes de registrar a chegada.
- [x] H3.6 Troca de profissional de última hora ✅ (v0.11.7, migração 0064):
      recepção/gerente troca no A chegar/Em espera; registra em
      appointment_provider_swaps; notifica os 2 profissionais + coordenador +
      gerente; ≥5 trocas no mês na unidade dispara alerta de frequência.
- [x] H3.7 SDR ✅ (v0.11.9, migração 0066): vê os clientes que tocou
      (cadastrou/editou/agendou/transferiu) em Prontuários e Jornada; ficha
      bloqueia cliente que não é dela; Agenda completa, mas o nome de cliente
      não permitido aparece sem link (decisão do dono: mostrar o nome).
- [x] H3.8 WhatsApp manual aniversariantes ✅ (v0.12.0): painel na aba
      Aniversariantes (mensagem editável {nome} + botão por cliente = individual
      e em massa) + botão no prontuário quando é o aniversário. Automação = Fase 3.
- [x] H3.9 Notificações ampliadas ✅ (v0.12.1, migração 0067): transferência
      notifica sempre o DESTINO (recepção/gerente/coordenador) além da origem;
      compartilhamento já notificava os 3 papéis das duas unidades (0038).
- [x] H3.10 Coordenador ao finalizar a avaliação ✅ (v0.12.2, migração 0068):
      enviar ao Centro de Planejamento conclui o atendimento "Em atendimento"
      automaticamente + pop-up para agendar a apresentação com o Comercial +
      aviso à Recepção.
- [x] H3.11 Informações complementares ✅ (v0.12.3, migração 0069): card na
      ficha para o coordenador enviar mais info ao Planner (notifica); selo
      "nova info" na fila /planejamento até o Planner abrir o cockpit.
- [x] H3.12 Mídias: excluir, renomear e anotar ✅ (v0.12.4, migração 0070):
      nome editável + anotação por foto/arquivo na galeria; excluir com
      confirmação; Coordenador/Admin editam; auditado.
- [x] H3.13 Centro de Planejamento/cockpit ✅ (v0.12.7): anamnese (leitura) no
      cockpit; filtros por unidade e por pilar na fila; colunas do cockpit com
      rolagem independente. (Botão "Abrir cockpit" na fila já existia; nome do
      cliente na fila já leva ao cockpit.)
- [x] H3.14 Sessões do plano com mais detalhe: quando agendada, mostrar data e
      profissional; no prontuário, sessão agendada é clicável → abre o agendamento.
      ✅ (06/07, v0.12.8, sem migração)
- [x] H3.15 Comercial: central de planos prontos para apresentação +
      notificações dos casos aguardando; ao receber plano SEM agendamento com o
      comercial → aviso forte à recepção + notificação a gerente e coordenador.
      ✅ (06/07, v0.12.9, migração 0071 — move_client_phase enriquecido +
      banner/selo no /planos + categoria Comercial nas notificações)

### H4 — Módulos novos (planejar um a um com o dono)
- [ ] H4.1 **Risartanos** (colaboradores): código automático; CPF, nascimento,
      gênero, estado civil (cônjuge: nome+telefone), WhatsApp, endereço; foto +
      "como quer ser chamado"; regime de contrato (CLT, PJ, Estagiário,
      Autônomo…); histórico de alterações; auditoria de acessos/logins e ações;
      vínculo com o cadastro de cliente (autopreenche; prontuário destaca que o
      cliente "é um Risartano"; inativo vai para o histórico do prontuário).
- [ ] H4.2 **Anamnese 2.0:** múltiplas fichas por cliente (1 de cada tipo;
      atualizar NÃO troca o tipo); todas as perguntas obrigatórias (não finaliza
      incompleta); perguntas condicionais por gênero (só p/ mulheres); respostas
      com opções (tipo sanguíneo, tempo de gestação); campos condicionais de
      texto ("sim" → qual remédio / "não soube informar"; idade do bebê);
      histórico de alterações com quem/quando.
- [ ] H4.3 **Protocolo 2.0 + agendamento em série:** tempo mínimo entre sessões
      (padrão da rede; Planner ajusta por caso; senão vale o padrão); médias
      reais rede/unidade do intervalo; previsão de data de conclusão do
      tratamento; ao agendar, SUGERIR AS DATAS DE TODAS as sessões com o
      dentista designado; Planner pode propor alteração de protocolo para a
      unidade (pop-up de confirmação + notifica o coordenador da unidade) ou
      sugerir para a rede (notifica o Admin Master); só nas unidades sob sua
      responsabilidade.
- [x] H4.4 **Tela de Planos de Tratamento** ✅ (04/07/2026, v0.11.1, sem
      migração): `/planos` no menu; chips coloridos com contadores por situação
      (7, clicáveis); busca + filtro de unidade; escopo por papel; tabela com
      Ficha/Cockpit; relatório (totais + evolução aprovados → tratamento +
      quadro unidade × situação).
- [ ] H4.5 **Cockpit 2.0 (redesign):** menos rolagem, mais intuitivo; organizar
      o tratamento em ETAPAS + sessões; sugerir profissional por procedimento;
      propor juntar sessões num único atendimento; ajustar tempo por sessão e
      entre sessões; previsão de término; alertas/observações/lembretes por
      sessão e do plano como um todo.
- [ ] H4.6 **Módulo do Dentista (atendimento clínico):** dashboard
      (dia/semana/mês/período), execução e baixa de procedimentos, pendências
      (procedimentos/clientes em aberto); histórico/evolução do cliente; plano
      RESUMIDO SEM VALORES financeiros; sugestões/orientações p/ a reavaliação
      (evidentes ao coordenador na reavaliação); pedir REVISÃO do planejamento
      (alerta insistente ao coordenador até resolver; tudo registrado).
- [ ] H4.7 **Atendimento conjunto:** 2+ profissionais no mesmo atendimento;
      aparece na agenda de todos; 1 sala; responsável principal (avaliação =
      coordenador; tratamento = dentista executor; vários procedimentos =
      responsável por procedimento); limite de profissionais = nº de cadeiras.
- [ ] H4.8 **Planejamento anual da rede:** feriados/datas comemorativas/eventos/
      campanhas definidos pela franqueadora; por data, marcar se a decisão é da
      franqueadora (travada p/ a unidade) ou da unidade; horário de ALMOÇO
      configurável (padrão rede → unidade).
- [ ] H4.9 **Chat interno:** canal da unidade + conversas 1:1; franqueadora ↔
      unidade quando conectadas; pop-up + som ao receber; áudio e arquivos
      (fotos/vídeos); insiste até ser visualizado; registro de leitura (quando
      visualizou); histórico de conversas.
- [ ] H4.10 **Prontuário em abas/cards** (menos rolagem, sequência lógica do
      fluxo do cliente) + **barra lateral FIXA** em todas as telas (rolagem
      independente do conteúdo).
- [ ] H4.11 **Apresentação 2.0:** mais rica em informação; otimizada para
      computador E celular; FOTOS NO GAMMA (testar links assinados embutidos no
      texto de entrada) + padrão visual definido para os decks.
- [ ] H4.12 **Câmera intraoral:** reconhecer a câmera conectada, capturar e
      salvar direto no sistema (reusa o adiado "foto por webcam").
- [ ] H4.13 **Especialidades + comissionamento:** cadastro de especialidades
      (lista padrão ao criar/editar procedimento, como o pilar, evitando erro de
      digitação); reajuste em massa do comissionamento FIXO; regra de negócio:
      comissão só é devida com o procedimento FINALIZADO (todas as sessões
      concluídas) — vale para o futuro módulo financeiro.
- [ ] H4.14 **Definições de status:** "Iniciar tratamento" = plano aprovado e
      NENHUM procedimento executado; "Sessão de tratamento" = tratamento já
      iniciado (aplicar de forma consistente em agenda/jornada).

---

## ⚠️ INVENTÁRIO DO APAGAMENTO — o que, no sistema inteiro, consegue apagar dado

**Ordem do dono, 25/09/2026:** *"Você deve garantir que nenhum dado será
apagado, a não ser quando solicitado."*

Não é uma pendência: é o **retrato conferido** de todo caminho que apaga
alguma coisa, levantado **medindo** (varredura dos scripts + leitura das
funções agendadas no banco), não por memória. Serve para responder à pergunta
"o que pode apagar meu dado?" sem refazer a busca — e para que quem acrescentar
um caminho novo saiba que existe uma lista onde ele precisa entrar.

| Caminho | Alcança | Apaga o quê | Exige o quê |
|---|---|---|---|
| `scripts/reset-test.mjs` | **treino** | movimento (30 tabelas) | `RISARTE_APAGAR_TREINO=sim` ou `CI` |
| `scripts/limpar-arquivos-de-teste.mjs` | **produção** (lê `.env.local`) | arquivos de teste no Storage | `--confirmar` (sem ele, só simula) |
| `src/lib/espelho-treino.ts` | **treino** | papéis, agenda da equipe e matriz de permissões, antes de copiar | é a própria ação pedida pelo Admin |
| Migrações (`supabase/migrations/`) | onde forem rodadas | o que o arquivo declarar | `npm run check:destrutivo` reprova o não declarado |
| `empresarial.run_retention()` (agendada) | produção e treino | **NADA** — anonimiza com `update` | — |
| `recompute_client_activity` (agendada) | produção e treino | **NADA** — recalcula | — |

**As três conclusões que importam:**

1. **Nenhum caminho automático apaga cadastro.** As duas rotinas que rodam
   sozinhas no banco (retenção e atividade do cliente) foram lidas uma a uma:
   a retenção **anonimiza** (apaga nome e CPF, mantém o histórico, como a LGPD
   manda) e a outra recalcula um campo. Nenhuma das duas tem `delete`.
2. **Nada que apaga alcança a produção sem passar por gente.** O único
   script que fala com a produção é o de arquivos, e ele **simula por padrão**
   — sem `--confirmar` imprime "NADA FOI APAGADO".
3. **A garantia virou portão**, não promessa:
   `src/lib/__tests__/apagar-com-autorizacao.test.ts` varre `scripts/*.mjs`,
   encontra quem executa apagamento e **reprova a entrega** se não houver
   leitura de autorização. Script novo que apague calado não passa.

⚠️ **A PRIMEIRA VERSÃO DESSA RÉGUA PASSOU VERDE COM A TRAVA ARRANCADA.** Ela
procurava a palavra `RISARTE_APAGAR_TREINO` no arquivo, e a palavra continuava
lá — **dentro do texto da mensagem de erro**, ensinando como autorizar.
Ensinar como autorizar não é exigir autorização. A régua passou a exigir a
marca no **papel de leitura** (`process.env.X`, `process.argv`), e isso só
apareceu porque a régua foi **provada quebrando o código de propósito**.
É o mesmo erro do `--pat-branco` (§0d do `CLAUDE.md`): perguntar se a string
existe quando o que importa é se ela existe **naquele papel**.

**Limites declarados** (o que esta garantia NÃO cobre):

- **Apagamento pela tela** — botões de excluir do próprio sistema. Esses são
  pedidos pelo usuário por definição, e cada um tem a sua regra (cliente nunca
  é apagado, vira anonimizado; item de estoque com movimento vira inativo).
- **`espelho-treino.ts`** apaga como parte do ato que o Admin pediu ("copiar a
  produção para o treino"); a régua não o cobre porque não é script, e o
  caminho até ele é a tela de Administração.
- **Apagamento feito à mão no painel do Supabase.** Nenhum código alcança isso.

---

## ACHADOS DE PASSAGEM — encontrados fazendo outra coisa (fila viva)

⚠️ **POR QUE ESTA SEÇÃO EXISTE** (ordem do dono, 25/09/2026): *"se encontrar e
não registrar para lembrar depois do que precisamos corrigir, podemos esquecer
e o relato de ter encontrado não teve utilidade nenhuma."*

Quase todo defeito caro deste projeto foi visto por alguém **antes** de doer —
e se perdeu porque foi dito de passagem, numa conversa, em vez de virar linha
numa lista que alguém relê. Achado que mora só no chat **não existe**: a
conversa termina, a sessão fecha, e o que sobrou foi o custo de ter procurado
sem o benefício de ter achado.

**A regra:** achado fora do escopo do que se está fazendo **não entra no
commit da vez** (misturar dois assuntos esconde os dois) — entra **aqui**, no
mesmo dia, com o que já se sabe e o que falta confirmar. O que está confirmado
vem separado do que é suspeita: item que mistura os dois faz alguém "corrigir"
um palpite.

### AP1. ✅ RESOLVIDO em 25/09/2026 — o vencimento usava o relógio do servidor
*(encontrado em 24/09/2026, lendo `billing-actions.ts` para os relatos
OC-00055/OC-00057. Não relatado por ninguém.)*

- **Onde:** `nextDue()` em
  `src/app/(app)/empresarial/[companyId]/billing-actions.ts`.
- **O que está confirmado:** a função usa `new Date()` e
  `toISOString().slice(0,10)` para montar o vencimento e o **mês de
  referência**. Na Vercel o servidor roda em **UTC**.
- **A consequência esperada:** entre 21h e meia-noite (horário de Brasília) o
  servidor já está no dia seguinte. Gerar uma cobrança nesse intervalo no
  último dia do mês pode gravar o **mês de referência errado** — e no dia 31
  pode escolher o vencimento do mês seguinte.
- **Por que não foi corrigido na hora:** apareceu no meio da entrega da
  implantação (Bloco K). Misturar um conserto de fuso com uma mudança de regra
  comercial esconderia os dois.
- **O conserto:** trocar por `todayInBrazil()` / `startOfDayInBrazil()` de
  `src/lib/dates.ts`, como manda a lição de fuso do `CLAUDE.md`. **Há teste que
  varre `src/app`** procurando esse padrão — conferir por que ele não pegou
  este caso, porque uma régua que deixa passar é tão grave quanto o defeito.
- **Tamanho:** pequeno. Cabe no próximo lote do Empresarial.

**A RESOLUÇÃO**

Corrigido em **Empresarial 0.69.0**. A conta saiu da server action e virou
`src/lib/empresarial/vencimento.ts`, pura e com **15 testes**.

**Eram DOIS defeitos, não um.** O segundo apareceu ao reescrever a função:
`new Date(2026, 1, 31)` é **3 de março**, não 28 de fevereiro — e `due_day`
aceita 1 a 31 no banco, sem trava. A empresa com vencimento no dia 31 recebia,
em fevereiro, um boleto para março. Agora o dia é preso ao último dia do mês.

**E um TERCEIRO, na mesma função:** o rótulo do mês da mensalidade saía de
`new Date(mes + "T00:00:00").toLocaleDateString(...)`. Data-só sem fuso é lida
no relógio da máquina; na Vercel (UTC) isso volta três horas ao ser mostrado em
São Paulo e **cai no mês anterior** — a mensalidade de setembro sairia descrita
como *"agosto de 2026"*, só no servidor.

⚠️ **A régua nasceu cega e foi consertada.** Os 13 primeiros testes passavam a
data de propósito (para não depender do dia em que rodam) e por isso **nenhum**
exercitava o valor padrão — que é justamente onde o defeito morava. Provado:
com o defeito original recolocado, os 13 continuaram VERDES. Entraram dois
testes com o **relógio congelado** na janela das 21h à meia-noite, e aí a régua
acusa.


### AP2. ✅ RESOLVIDO em 25/09/2026 — a ficha do Risartano recusava o código que o próprio sistema gera
*(encontrado em 25/09/2026, na varredura `npm run check:telas` rodada por
causa da correção do tema escuro. Sem relação com ela.)*

- **O que está confirmado:** no **treino**, logado como Admin Master,
  `GET /risartanos/RIS-000007-TREINO` devolve **404**, e existem **12**
  registros em `public.staff_members`. A varredura acusa: *"404 para o Admin
  Master é rota quebrada, não permissão"*.
- **O que é SUSPEITA, não confirmado:** os códigos do treino têm sufixo
  `-TREINO` (posto por semeadura/anonimização), e a página pode estar
  procurando por um formato que não casa com isso. **Se for só isso, é defeito
  do ambiente de treino**; se não for, a ficha de RH está quebrada também na
  produção.
- **O que fazer:** ler `src/app/(app)/risartanos/[codigo]/page.tsx` (por qual
  coluna busca, onde chama `notFound()`); conferir na **produção, só leitura**,
  com um código sem sufixo. Defeito real → corrigir e prender com teste;
  dado de treino → corrigir a semeadura.
- **Gravidade:** alta se alcançar a produção (é a tela de RH), nenhuma se for
  só o treino. **É justamente por não saber ainda que precisa estar escrito.**

### AP3. ✅ RESOLVIDO em 25/09/2026 — data-só virando instante no servidor
*(medido em 25/09/2026, ao corrigir o AP1. **9 arquivos, 15 ocorrências.**)*

- **O que está confirmado:** `new Date("2026-09-01T00:00:00")` — data sem fuso
  — é lida no relógio da **máquina**. Na Vercel isso é UTC; ao ser mostrada em
  São Paulo, a data **volta três horas** e cai no dia anterior. Varredura feita
  só em arquivos de **servidor** (os `"use client"` ficam de fora de propósito:
  no navegador da equipe o fuso já é o certo).
- **Onde** (`src/app`, servidor):
  - `prontuarios/[id]/page.tsx` (3×) e `prontuarios/actions.ts` — **data de
    nascimento**. É o mais visível: o paciente nascido em 04/03 aparece como
    03/03, e a idade calculada erra no dia do aniversário.
  - `ppr/mensalidades/page.tsx` (3×), `ppr/adesoes/[id]/page.tsx`,
    `ppr/adesoes/[id]/contrato/page.tsx`, `ppr/painel/page.tsx` — vencimentos,
    mês de referência e o **contrato impresso**.
  - `agenda/planejamento-anual/page.tsx` (4×) — datas do calendário do ano.
- **Por que não foi corrigido junto com o AP1:** são três módulos diferentes
  (prontuário, PPR, agenda), cada um com o seu teste e a sua conferência.
  Misturar com a cobrança do Empresarial esconderia os dois — a mesma razão
  que criou esta seção.
- **O conserto:** `startOfDayInBrazil()` / `formatInBrazil()` de
  `src/lib/dates.ts`, ou ler a data como número quando o que se quer é
  calendário (foi o que `rotuloDoMes` passou a fazer).
- ⚠️ **A régua entra JUNTO com o conserto, nunca antes.** A varredura de
  `dates.test.ts` hoje só reconhece duas formas, ambas com template literal
  (`new Date(\`...T${hora}\`)`); a forma desta família escapa. Acrescentar a
  terceira forma agora deixaria o teste **vermelho** nos 9 arquivos — e teste
  que nasce vermelho é teste que alguém desliga.
- **Tamanho:** médio. Vale como lote próprio, e o mais urgente dele é a data de
  nascimento do prontuário.

**A RESOLUÇÃO DO AP3** (core 0.278.0)

Os 9 arquivos foram corrigidos e a varredura de `src/app` (servidor) foi de
**15 ocorrências a ZERO**. Entraram três funções puras e testadas:
`formatIsoDateBr`, `formatIsoMonthBr` e `formatIsoDayMonthBr` em
`src/lib/dates.ts`, mais `src/lib/idade.ts` — que juntou **quatro cópias** da
conta de idade espalhadas pelo prontuário.

**Três coisas apareceram no caminho, e nenhuma tinha sido relatada:**

- **A idade era calculada com o relógio da máquina.** No servidor em UTC, das
  21h à meia-noite, quem faz aniversário amanhã já aparecia com a idade nova.
- **`idadeDetalhada` devolvia dias NEGATIVOS.** De 31/01 a 01/03 saía
  *"0 anos, 1 mês e -2 dias"*: o empréstimo pegava os 28 dias de fevereiro de
  uma diferença de −30. Achado pelo teste, não por relato.
- **O atraso do PPR contava cedo demais.** A comparação era de instantes, então
  a mensalidade virava "em atraso" às 21h do dia ANTERIOR no servidor — e, pela
  regra do projeto (CLAUDE.md §8b), atraso conta no dia SEGUINTE ao vencimento.
  Agora é comparação de data civil.

**A régua entrou junto**, como estava combinado: `dates.test.ts` ganhou a
terceira forma (`T00:00:00` escrito à mão) e passou a **descartar comentários**
— sem isso ela acusaria a própria explicação do defeito. Provada recolocando o
defeito no prontuário: ela aponta o arquivo pelo nome.

⚠️ **A CONFERÊNCIA NO FUSO DO BRASIL DEU VERDE POR ACASO.** A primeira medição
na tela passou — porque esta máquina está em Brasília, que é onde o defeito não
existe. Subindo o servidor de treino com **`TZ=UTC`**, como na Vercel, a mesma
tela acusou: *"03/03/2004"* ainda aparecia. **Para defeito de fuso, medir na
máquina de quem programa é medir o lugar onde ele não está.**

### AP4. ✅ RESOLVIDO em 25/09/2026 — componentes de navegador também desenham no servidor
*(descoberto em 25/09/2026, ao medir o AP3 com `TZ=UTC`.)*

- **O que está confirmado:** a varredura de `dates.test.ts` pula arquivos
  `"use client"` de propósito — a premissa é que "no navegador o fuso é o da
  pessoa". **A premissa está incompleta:** o Next desenha o HTML desses
  componentes no SERVIDOR primeiro, e só depois o navegador hidrata. Foi assim
  que a ficha do paciente continuou chegando com *03/03* mesmo depois de o
  AP3 ser corrigido: o valor vinha de `client-data-section.tsx`, um componente
  de navegador.
- **Quantos:** **13 arquivos** `"use client"` ainda com a forma (agenda,
  atendimento, notificações, empresarial, PPR). O 14º — a data de nascimento
  do prontuário — foi corrigido junto com o AP3, por ser o mesmo campo.
- **Gravidade: MENOR que a do AP3, e por isso ficou para depois.** Depois da
  hidratação o navegador recalcula e mostra a data certa; o estrago é o
  "pisca" e o aviso de hidratação. Mas em **documento impresso** e em qualquer
  leitura do HTML cru, o valor errado é o que vale.
- **O que fazer:** trocar pelas mesmas funções de data civil e então decidir se
  a varredura passa a incluir os `"use client"` — hoje ela os exclui por uma
  razão que era boa e virou meia-verdade.

**AP2 — MEDIDO em 25/09/2026, e a suspeita estava certa**

Com a rota aquecida (compilada), no treino:

| código | resultado |
|---|---|
| `RIS-000007-TREINO` | **404** |
| `RIS-000002` | abre |
| `RIS-000009` | abre |

**Não é rota quebrada: é o sufixo `-TREINO` nos códigos semeados.** A ficha
procura pelo código exato, e o código com sufixo não existe como tal. Logo,
**a produção não é afetada** — lá os códigos não têm sufixo.

O que falta é pequeno e fica aqui: corrigir a semeadura do treino (ou fazer a
busca tolerar o sufixo), para a varredura parar de acusar.

### AP5. ✅ RESOLVIDO em 25/09/2026 — a varredura de telas acusava rota certa
*(medido em 25/09/2026, três execuções seguidas.)*

- **O que está confirmado:** `npm run check:telas` contra um servidor de
  desenvolvimento **recém-iniciado** devolve 404 em rotas que funcionam. Três
  execuções acusaram **conjuntos DIFERENTES**: uma o `/financeiro/*` inteiro,
  outra o `/admin/*` inteiro, outra nenhum. Conferidas uma a uma logo depois,
  com a rota já compilada, **todas as oito abriram (200)**.
- **A causa:** em desenvolvimento o Next compila cada rota **na primeira
  visita**. A varredura chega antes da compilação terminar e lê o 404
  temporário. Ela está medindo o compilador, não o sistema.
- **Por que isto importa mais do que parece:** é a régua acusando o que está
  certo — o defeito que o `CLAUDE.md` §0d registra como pior que não ter régua.
  Eu mesmo, nesta sessão, quase saí atrás de um defeito no Financeiro que não
  existia, e só não fui porque conferi rota por rota.
- **O que fazer:** aquecer cada rota antes de medir (uma visita descartada), ou
  repetir o 404 uma vez antes de acusar; e a varredura deveria **dizer** que
  está contra servidor de desenvolvimento. Contra o site publicado (onde tudo
  já está compilado) o problema não existe.
- **Enquanto não for feito:** 404 isolado na varredura **não é diagnóstico** —
  conferir a rota à mão antes de acreditar.

**A RESOLUÇÃO DO AP4** (core 0.279.0)

Os 13 arquivos `"use client"` foram corrigidos, mais **três regras puras em
`src/lib`** que a varredura nem olhava — e que eram as piores do lote, porque
regra pura é usada por tudo:

- `annual-plan.ts` — o contador de dias do planejamento anual.
- `clients.ts` — `isMinorOn`, que virou casca de `ehMenorDeIdade`.
- `ppr/rules.ts` — os dias de atraso da mensalidade.

**A régua cresceu junto**, e em três direções:

1. Passou a varrer **`src/lib`** além de `src/app`.
2. A terceira forma passou a incluir os `"use client"` — as duas primeiras
   continuam só no servidor, porque são sobre HORA, e hora de navegador é a da
   pessoa. **Data é diferente: o SSR desenha no servidor.**
3. Ganhou a exceção do **`Z`**: `new Date("...T00:00:00Z")` é instante absoluto
   e é código CERTO (`notification-list.tsx` usa de propósito). Sem a exceção a
   régua acusaria código bom — o jeito mais rápido de ensinar a equipe a
   ignorá-la.

Provada recolocando o defeito num componente de navegador: ela acusa pelo nome
do arquivo. Varredura de `src` inteira: **zero**.

**A RESOLUÇÃO DO AP2** (core 0.280.0)

**A causa não era dado de treino: era o sistema discordando de si mesmo.**

O padrão que decide o endereço da ficha era `^RIS-\d{1,10}$` — só dígitos. Mas
quem gera os códigos com sufixo é o **próprio sistema**: ao espelhar a produção
no treino, `codigoAfastado` renomeia a ficha LOCAL que ocupa o número para
`RIS-000007-TREINO`, liberando-o sem apagar nada. Duas regras do mesmo sistema
com ideias diferentes sobre o que é um código.

**Dois sintomas, e o segundo é o que ninguém veria:**

1. `/risartanos/RIS-000007-TREINO` respondia **404**.
2. `enderecoDaFicha` caía para o endereço por **id** — então, clicando na
   lista, ninguém tropeçava. O código simplesmente **deixava de servir de
   endereço**, em silêncio, contra a regra de que o código do documento nunca
   some (CLAUDE.md §8b).

**O conserto** foi o padrão passar a aceitar as duas formas que o espelho cria
(`-TREINO` e `-TREINO-A1B2C3`) — e **não** sufixo inventado.

⚠️ **A trava contra voltar a divergir é o formato do teste, não o seu valor.**
`espelho.test.ts` agora pega o que `codigoAfastado` **gera** e exige que
`chaveDaFicha` e `enderecoDaFicha` **aceitem**. Não confere um texto fixo:
confere que os dois lados combinam. Provado devolvendo o padrão antigo — caem
quatro asserções, uma para cada sintoma.

**Conferido na tela do treino:** as quatro fichas com sufixo abrem pelo código.
⚠️ E a primeira medição acusou uma delas por engano: eu procurava o nome no
texto visível, e ali ele mora no `value=` de um campo — a mesma armadilha que
já tinha me pegado nesta sessão. Passou a procurar no HTML cru.

**A RESOLUÇÃO DO AP5** (core 0.281.0)

⚠️ **A HIPÓTESE QUE EU TINHA ESCRITO AQUI ESTAVA ERRADA, e ela fica registrada
de propósito.** Eu havia anotado: *"em desenvolvimento o Next compila a rota na
primeira visita, a varredura chega antes e lê o 404 temporário"*. Medi: rota
fria responde **200**, só devagar — 7,4s no `/financeiro` recém-iniciado, 2,8s
no `/estoque`. **Nunca 404.** Diagnóstico plausível e não medido é palpite com
cara de conclusão, e este ficou dois dias no papel parecendo fato.

**O que a medição encontrou:**

1. **A acusação MENTIA sobre o que viu.** O veredito `bloqueado` cobre duas
   coisas — responder **404** e **mandar de volta para a raiz** — e a frase
   dizia "404" nas duas. Foi ela que me mandou procurar um defeito no
   Financeiro que não existia. Agora a evidência viaja com o veredito e a
   frase repete o que foi visto. **Preso por teste**: a frase da raiz não pode
   conter "404".
2. **Uma falha passageira virava acusação.** Nesta máquina houve várias quedas
   de rede no mesmo dia (DNS, busca de fonte) — e a guarda da tela, sem
   resposta do banco, nega. Agora a tela que **vira acusação** é visitada uma
   segunda vez; se passar, não é falha, e a oscilação é **dita** em vez de
   silenciada.
   ⚠️ A primeira versão deste conserto repetia TODA tela bloqueada e travou a
   varredura: quase todo bloqueio ali é permissão funcionando. Repetir só o
   que acusa custa quase nada.
3. **Quando quase tudo falha, quem falhou foi a medição.** Uma execução acusou
   **100 de 101 telas** com "resposta 500" — e o sistema estava inteiro: o
   servidor de desenvolvimento tinha ficado num estado quebrado (a armadilha do
   `.next-test`). A varredura agora reconhece isso (≥80% de falhas) e **grita
   sobre si mesma** em vez de listar cem telas. É a regra da "régua vazia
   grita" pelo outro lado: **zero resultado e resultado total são o mesmo tipo
   de sintoma.**

**Fica a lição operacional:** contra servidor de desenvolvimento, a varredura
mede um ambiente que está sendo montado enquanto é medido. Contra o site
publicado — onde tudo já está compilado — nada disso acontece.

**AP5 — o que foi medido DEPOIS do conserto**

Primeira varredura com a frase honesta: as seis telas acusadas para o Admin
Master não diziam mais "404", diziam **"mandou de volta para a raiz"** — e
abertas à mão, logo depois, **todas responderam 200**. Ou seja: eram falsas, e
a causa é a mesma queda de rede que derrubou o login de **sete dos oito
perfis** na mesma execução.

Duas lições que isso acrescentou ao conserto:

- **Uma repetição de 400ms era curta demais.** Queda de rede dura segundos.
  Passaram a ser duas, com espera crescente (600ms e 1,5s) — e só em tela que
  vira acusação, nunca em toda tela bloqueada.
- **Perfil que não conseguiu ENTRAR não é perfil aprovado.** Antes, falhar no
  login contava como falha de tela (culpando o sistema por um cabo); agora é
  marcado como ambiente, e o resultado final avisa quantos perfis **não foram
  conferidos** — a mesma regra do "invariante sem dado" da camada 1.

### AP6. Três perfis barrados de telas que a regra escrita manda abrir
*(encontrado em 25/09/2026, pela varredura JÁ CONSERTADA — é o primeiro achado
que ela entrega depois de parar de acusar tela boa.)*

- **O que está confirmado**, com a varredura e à mão:

  | perfil | tela | regra escrita (CLAUDE.md) | o que acontece |
  |---|---|---|---|
  | Gerente de Unidade | `/financeiro/dre` | *"o gerente vê o financeiro da PRÓPRIA unidade"* | manda para a raiz |
  | Financeiro da Franqueadora | `/financeiro/dre` | *"é o financeiro da rede"* | manda para a raiz |
  | Comprador da Franqueadora | `/compras/rodadas` | *"a mesa de negociação é o trabalho do comprador (C2)"* | manda para a raiz |

  O do gerente foi conferido à mão, logado: **307 para `/`, com E sem unidade
  ativa no cookie**. Não é falta de unidade escolhida.
- **O que NÃO se sabe ainda:** se a guarda da tela está errada, se a regra
  escrita envelheceu, ou se falta papel/permissão nos usuários do TREINO
  (estes três perfis existem só lá, criados para a varredura). A terceira
  hipótese é a mais barata de testar e tem de vir primeiro.
- **Por que não foi corrigido junto:** o AP5 era sobre a régua mentir; isto é
  sobre permissão. Misturar esconderia os dois — e mexer em guarda de tela sem
  saber qual das três hipóteses vale é trocar um defeito por outro.
- ⚠️ **Se for a primeira hipótese, é grave:** gerente sem DRE não enxerga o
  resultado da própria unidade, que é a tela pela qual ele responde.

### AP7. ⚠️ EU APAGUEI OS DADOS DE TESTE DO DONO (relato OC-00088, 25/09/2026)

**Não foi defeito do sistema: foi a suíte de testes, rodada por mim.**

O preparo do teste ponta a ponta chama `limparMovimento`, que esvazia o
MOVIMENTO do banco de **treino** — `clients`, `appointments`,
`treatment_plans` e mais 27 tabelas. Rodei a suíte várias vezes em 25/09 para
provar dois consertos (o cadastro que abria sujo e a caixa de seleção no tema
escuro). Cada execução apagou o que havia ali.

**Medido depois do relato:**

| | treino | produção |
|---|---|---|
| `clients` | 0 | 0 |
| `appointments` | 0 | 0 |
| `treatment_plans` | 0 | 0 |
| `staff_members` | 12 | 7 |
| `audit_logs` | 134 | — |

**A PRODUÇÃO NUNCA ESTEVE EM RISCO, e isso é verificável:** `reset-test.mjs` só
conecta por `test-db.mjs`, que **recusa** qualquer endereço contendo o
identificador do projeto de produção — nos dois endereços, o da API e o do
banco. A mesma recusa se repete em `playwright.config.ts` e em `e2e/apoio.ts`.
A produção tem 0 clientes porque ainda não entrou em uso real, não porque algo
os apagou.

**O que faltava** não era trava contra a produção — era trava contra apagar o
**treino**. O script tratava aquele banco como rascunho; o dono o usa como
ambiente de trabalho. Duas ideias diferentes sobre o mesmo banco, e quem perdeu
foi quem não sabia da primeira.

**O conserto** (core 0.283.0): apagar passou a exigir autorização escrita
(`RISARTE_APAGAR_TREINO=sim`, ou `CI` na integração contínua). Sem ela a suíte
**recusa e mostra quantas linhas seriam apagadas**, para ninguém descobrir a
perda dias depois. Provado nos dois caminhos: recusa sem a variável, roda com.

**O que NÃO dá para fazer:** devolver o que foi apagado. `truncate` não deixa
rastro e não há cópia do treino. A única via seria a recuperação por ponto no
tempo do Supabase (recurso do plano pago) — decisão do dono, não minha.

⚠️ **A lição, que é a terceira aparição da mesma família neste projeto** (§0 do
CLAUDE.md: o truncate que levou o Risarte Academy; 11/09: o comentário que
descrevia a lista e não o efeito): **antes de apagar em massa, pergunte quem
está usando aquele banco — não só o que o comando alcança.**

**DECISÃO DO DONO, 25/09/2026 — NÃO RECUPERAR.** *"Por ser um ambiente teste
não vamos tentar recuperar."* A recuperação por ponto no tempo do Supabase
**não será tentada**, e o item está encerrado: o que se perdeu foi cadastro de
treino, e recadastrar custa menos que restaurar o banco inteiro — a restauração
voltaria TUDO ao estado anterior, inclusive o que foi feito de bom depois.

**Fica registrado para quem ler isto depois:** a decisão foi barata **porque
era treino**. No ambiente REAL ela não existiria — e é por isso que a trava, e
não a recuperação, é a resposta certa para este relato.

**ENCERRADO em 25/09/2026** — core 0.283.0 (a trava) e 0.284.0 (a garantia
geral; ver *Inventário do apagamento*, no topo deste arquivo).

---

### AP8. Dois arquivos de TESTE não passam na conferência de tipos (25/09/2026)

**Confirmado, medindo:** `npx tsc --noEmit` acusa 8 erros, todos dentro de
`src/lib/__tests__/briefing.test.ts` e `src/lib/__tests__/screens.test.ts` —
campo `ambiente` faltando num objeto `Relato`, e `string` atribuída onde o tipo
é `null | undefined`.

**Por que ninguém viu até agora:** o `npm run verificar` (build do Next) **não
confere os arquivos de teste**, e o Vitest **não confere tipos** — ele executa.
Os dois portões passam, e ninguém dos dois olha para este canto. Foi achado de
raspão, rodando `tsc` à mão para conferir um arquivo novo.

**Por que importa:** o tipo é a régua que diz se o teste está montando o objeto
que o sistema realmente usa. Teste que monta um `Relato` sem `ambiente` pode
estar exercitando um formato que não existe mais — e passar verde por isso.

**O que falta decidir:** se o `tsc --noEmit` entra no portão de entrega. Entrar
é o certo, e **não é de graça**: enquanto os 8 erros existirem, o portão fica
vermelho. Corrigir primeiro, prender depois.

**Não confirmado:** se os testes desses dois arquivos ainda medem o que
prometem. Os erros de tipo sugerem que o formato mudou embaixo deles, mas isso
é suspeita — só a leitura de cada caso confirma.

---

### AP9. ⚠️ `<>` com `auth.uid()` deixava a trava ABERTA (26/09/2026 — corrigido)

**Achado por sonda, não por relato**, escrevendo a 0273. A guarda "só a própria
pessoa inicia a missão" era `if v_user <> auth.uid() then raise`. Quando
`auth.uid()` é **nulo** — chamada sem sessão: chave de serviço, conexão direta,
tarefa agendada — `<>` devolve **nulo**, e `if NULO then` **não dispara**.

A trava ficava aberta **justamente para quem não estava logado**, numa função
`security definer`, que roda como dona do banco. A sonda mostrou
`PASSOU — ERRADO` na primeira execução.

**Corrigido** com `is distinct from`, que trata o nulo como valor. Provado: a
chamada sem sessão passou a ser recusada com `ONLY_THE_PERSON_STARTS`.

**Varrido o histórico inteiro:** era o único caso nas 296 migrações.

**Virou régua:** `scripts/check-migrations.mjs` ganhou a Regra 5, que reprova
qualquer comparação de `auth.uid()` com `<>` ou `!=`. Provada quebrando a 0273
de propósito — acusou e explicou o porquê.

⚠️ **A lição, que é irmã da régua vazia (§0d):** em SQL, comparar com `<>` um
valor que pode ser nulo não dá "verdadeiro" nem "falso" — dá **nulo**, e nulo
num `if` se comporta como falso. Guarda de segurança escrita assim falha
**aberta**, que é o pior jeito de falhar.

---

### AP10. `check-migrations` não pegou um erro que o Postgres pega (26/09/2026)

A 0273 foi aprovada pelo `check-migrations.mjs` e **quebrou no banco**:
`operator does not exist: user_role = user_role[]` — um `= any((select ...))`
sobre coluna de enum. Custou uma ida e volta.

**Não confirmado:** se vale a pena ensinar o script a pegar esta classe. Ele lê
texto, não tem catálogo de tipos; pegar isto exigiria entender a consulta.
Pode ser que o caminho certo seja outro — rodar a migração contra um banco
descartável antes de mandar para o dono. Fica anotado como ideia, não como
tarefa: a decisão precisa de alguém pensando no custo.

---

### AP11. ⚠️ `count ?? 0` depois de `head: true` pode fazer TRAVA falhar aberta (26/09/2026)

**Achado escrevendo a medição da certificação (Etapa 2), não por relato.**

**CONFIRMADO, medindo contra o banco de treino:** pedindo só a contagem ao
Supabase (`select("*", { count: "exact", head: true })`), uma tabela que **não
existe** volta com **`error: null` e `count: null`** — sem erro nenhum. O
tempo-limite volta como erro comum, com `status: 0`.

**CONFIRMADO, lendo o código:** 14 lugares do sistema fazem `count ?? 0` logo
depois de uma contagem assim. Nenhum deles foi conferido caso a caso.

**O risco não é igual nos 14.** Onde o zero só alimenta um número na tela
(`chat/page.tsx`, `notification-nav-item.tsx`), o pior caso é um contador
errado. Onde o zero **libera uma ação**, a trava **falha aberta** — mesma
família do AP9:

| Arquivo | O que o zero falso faria |
|---|---|
| `procedimentos/actions.ts:294` | apagar procedimento que está em uso (a regra é inativar) |
| `empresarial/[companyId]/employee-actions.ts:104` | passar do teto da quantidade contratada (I4) |
| `empresarial/[companyId]/document-actions.ts:215` | (conferir o que a trava protege) |
| `agenda/configuracao/actions.ts:224, 278, 342` | (conferir: parecem travas de "o último não pode sair") |
| `ppr/actions.ts:776` | (conferir) |
| `prontuarios/[id]/page.tsx:2434` | `hasApprovedPlan` falso por erro de leitura |

**NÃO CONFIRMADO:** se algum desses já recebeu contagem nula na prática. As
tabelas existem, então o nulo só viria de um erro — e alguns desses lugares
podem já conferir `error` antes. **Cada um precisa ser lido**, não trocado em
massa: em alguns o zero é mesmo a resposta certa quando não há linha.

**O conserto provável** é o mesmo da `certificacao-contagem.ts`: tratar
`count === null` como "não consegui contar" e, nas travas, **recusar a ação**
nesse caso. Guarda que não consegue conferir tem de fechar, não abrir.
**✅ RESOLVIDO em 26/09/2026** (core 0.292.0, Empresarial 0.70.0). Cada caso
foi LIDO antes de mexer — e a leitura achou mais do que a busca.

**Consertados — deixavam passar o que devia barrar (16):**

| Onde | O que a falha fazia | O banco segurava? |
|---|---|---|
| Empresarial · cobrança mensal | **cobrava a mesma empresa duas vezes no mês** | **não** — não há índice único; o código era a única trava |
| Empresarial · titular: limite contratado, teto da proposta, contagem | o teto contratado sumia | não |
| Empresarial · dependente: limite, teto e `dependentes_ativos` | o teto sumia — ⚠️ **este eu escrevi com a 1021** | não |
| Empresarial · remover documento | titulares perdiam a ligação **em silêncio** | não (`on delete set null`) |
| Empresarial · documento novo | virava principal sozinho, tirando o posto do verdadeiro | não |
| PPR+ · recalcular mensalidade | gravava "zero dependentes" — **cobrava menos**, em silêncio | não |
| PPR+ · limite de dependentes do plano | deixava passar | não |
| Agenda · teto de salas / baixar o limite de cadeiras | deixava passar | não |
| Procedimentos · excluir | ia pelo caminho de APAGAR | **sim** — a ligação com orçamentos impede; virava erro sem explicação |
| Cadastro de cliente **sem CPF** | o mesmo paciente nascia duas vezes | não (CPF tem índice único; nome + nascimento não) |
| Cadastro de Risartano | a mesma pessoa ganhava dois cadastros | **não há índice único de CPF para Risartano** |

⚠️ **A busca inicial (`count ?? 0`) achou 9 desses.** Os outros 7 estavam
escritos de outro jeito — ler só o `data` de uma função do banco e ignorar o
`error` —, e só apareceram lendo as funções uma a uma. Onde o vazio tem
significado de propósito (`limite_de_titulares` devolve nulo quando o contrato
não tem quantidade), a falha virava "sem trava". **Lição: o defeito é "não
consegui ler" virando uma resposta; a forma de escrever varia.**

**Já falhavam FECHADOS — só a frase mentia (2):** desativar a última sala e
excluir a última cadeira. Barravam corretamente, mas diziam "a unidade precisa
de ao menos uma sala" para uma unidade que talvez tivesse cinco.

**Zero é aceitável e ficou ESCRITO (5):** posição na lista (3, no plano de
tratamento), contador de não lidas do chat, e o pedido de responsável do
menor — ali a falha pede um dado a mais, que é o erro seguro.

**Conferidos e deixados como estão:**

- **5 buscas de duplicado só por CPF** (PPR+, Empresarial, autopreencher do
  cadastro): o índice único de CPF do banco segura. A falha vira uma mensagem
  de erro pouco clara no momento de gravar — não vira duplicado.
- **`next_client_code_prefixed`** (cliente que entra pelo PPR+): se falhar, o
  gatilho `on_client_created_code` preenche o código — o cliente sai com o
  prefixo da UNIDADE em vez de `PPR-`. O código nunca some; o prefixo erra.
- **Buscas do chat e de autopreencher:** a falha só mostra menos coisa.

**A régua:** `src/lib/__tests__/contagem-nas-acoes.test.ts` reprova `count ?? 0`
em qualquer arquivo de ação. Provada devolvendo EXATAMENTE o defeito da
cobrança em dobro: acusou o arquivo e a linha.

**O que a régua NÃO pega, e fica declarado:**

1. **O segundo jeito de escrever** (ler só o `data` e ignorar o `error`): tem
   usos legítimos demais para uma régua de texto separar. Foi varrido à mão
   nas 18 chamadas de função de arquivos de ação; código novo depende de
   leitura.
2. **As telas.** `inicio-dados.ts` (as pendências do Início), `compras/trilha-
   dados.ts` e os contadores de relatos ainda fazem `?? 0`: se a contagem
   falhar, o Início diz **"0 esperando por você"** quando há trabalho parado.
   Não libera ação nenhuma — mas é a régua vazia respondendo "não" na tela que
   a equipe mais olha. Vale uma passada própria.


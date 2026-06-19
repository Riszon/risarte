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

### E1 — Jornada (regras de visibilidade e fases)
- [ ] Tirar os botões de mover fase da SDR (jornada e ficha).
- [ ] Dentista NÃO tem a tela Jornada (esconder no menu + bloquear rota).
- [ ] Todos os usuários da unidade (exceto Dentista) veem a Jornada do cliente.
- [ ] BUG: cliente cadastrado pela SDR com unidade de preferência não aparece na
      Jornada da unidade (kanban filtra só por clinic_id; incluir
      preferred_clinic_id, como já é na lista de Clientes).
- [ ] Clientes inativos aparecem na Jornada, identificados como inativos +
      filtro Ativo/Inativo na Jornada.

### E2 — Clientes (lista e ficha) — unidade visível p/ Franqueadora
- [ ] Lista de Clientes: para SDR e usuários da Franqueadora, mostrar em qual
      unidade franqueada o cliente está cadastrado (cliente da SDR mostra a
      unidade de preferência, não "Franqueadora").
- [ ] Ficha: para usuários da Franqueadora, mostrar claramente a unidade do
      cliente; para a SDR, mostrar a unidade de PREFERÊNCIA.
- [ ] Indicador de quantidade de clientes na tela Clientes.

### E3 — Agendamento (conflitos e clareza da unidade)
- [ ] Não permitir 2 clientes diferentes no mesmo horário com o MESMO
      profissional. Não permitir o MESMO cliente 2x no mesmo horário.
- [ ] Novo Agendamento (SDR): mostrar claramente em qual unidade está sendo
      agendado; opção de agendar em OUTRA unidade (desejo do cliente); sugerir
      horários disponíveis e/ou botão "ver agenda".
- [ ] Ficha do cliente (SDR): mostrar a unidade de preferência.

### E4 — Cadastro de novo cliente (SDR/Recepção) — cliente já existente
- [ ] Cliente já existe na rede → abrir a ficha com a unidade em DESTAQUE; SDR/
      Recepção podem EDITAR os dados; toda alteração no histórico.
- [ ] SDR cadastrando cliente que já pertence a uma unidade: NÃO pedir
      transferência para a Franqueadora. Pedir confirmação da unidade de
      preferência; se escolher unidade diferente da atual, exibir mensagem de
      autorização/confirmação de transferência da unidade A → B.

### E5 — Atendimento do Consultor Comercial
- [ ] Consultor vê atendimento consolidado das suas unidades (apresentações do
      dia), identificando a unidade de cada cliente (parcial: visão já existe +
      clinicName no card). Falta: filtro por unidade específica; e o Consultor
      poder movimentar o cliente em TODAS as etapas do atendimento (inclusive
      registrar chegada das suas apresentações).

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
- NOTA: se o upload ainda falhar após a 0027, o erro real agora aparece em
      vermelho — pedir ao dono a mensagem exata para diagnóstico fino.

### E7 — GRANDE: cliente atendido em mais de uma unidade simultaneamente
- [ ] Compartilhar o mesmo cliente temporariamente entre unidades (ex.: cliente
      da Clínica A precisa de urgência/emergência ou procedimento que a A não
      oferece, vai à Clínica B sem sair da A).
- [ ] Regras: sem agendamentos simultâneos em duas unidades; NÃO misturar planos
      de tratamento nem financeiro entre unidades; compartilhamento temporário.
- [ ] Requer design próprio (modelo cliente ↔ múltiplas unidades, escopo de
      registros por unidade). Tratar como etapa separada, com plano dedicado.

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

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

## LOTE A.2 — feedback do dono após teste do Lote A (2026-06-12)

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
- [ ] Nova função Encantador(a) (SDR): cadastra clientes, agenda, move 1→2.
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

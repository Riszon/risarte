# Jornada do Cliente Risarte — especificação do sistema

> Documento consolidado (fonte do proprietário + decisões). É a referência de
> implementação da espinha dorsal. Fonte bruta: `JORNADA-fonte.md`.
> Decisões do proprietário em 2026-06-13:
> 1. Pilar automático por fase + pilar de tratamento escolhido pelo Planner.
> 2. Criar funções TSB e ASB + travar funções por ambiente.
> 3. Check-in automático + sub-status por fase.
> 4. Construir a BASE da jornada primeiro, depois os módulos clínicos.

## 1. As 7 fases (estado principal do cliente)

| # | Fase (enum) | Onde | Responsável | Pilar automático |
|---|---|---|---|---|
| 1 | `acquisition` | Franqueadora/Unidade | SDR / Recepcionista | a definir |
| 2 | `clinical_conversion` | Unidade | Coordenador Clínico | Diagnóstico |
| 3 | `planning_center` | Franqueadora | Dentista Planner | Planejamento |
| 4 | `commercial_conversion` | Franqueadora | Consultor Comercial | (tratamento) |
| 5 | `treatment_start` | Unidade | Coordenador Clínico | (tratamento) |
| 6 | `reevaluation` | Unidade | Coordenador Clínico | Diagnóstico |
| 7 | `follow_up` | Unidade | Coordenador Clínico | Prevenção |

## 2. Pilar da metodologia (decisão 1)

- **Pilar exibido = automático pela fase** (tabela acima): Diagnóstico (2 e 6),
  Planejamento (3), Prevenção (7), a definir (1).
- **Pilar de tratamento** = escolhido pelo Dentista Planner na fase 3, um de
  Saúde/Função/Estética/Prevenção. Passa a ser o pilar exibido nas fases **4 e 5**.
- Campo no banco: `clients.treatment_pillar` (nullable). O pilar exibido é
  calculado: fases 4/5 → `treatment_pillar` (ou "a definir"); demais fases → o
  pilar automático da fase. (Hoje o campo chama `methodology_pillar`; vira
  `treatment_pillar` no significado.)

## 3. Sub-status por fase (decisão 3)

Campo `clients.journey_status` (enum), definido automaticamente pelas ações:
- Fase 2: `awaiting_send_to_planning` ("Aguardando o Envio para Planejamento").
- Fase 3: `in_planning` ("Em Planejamento") → `awaiting_plan_approval`
  ("Aguardando Aprovação do Planejamento") → se devolvido
  `revision_with_coordinator` ("Revisão com Coordenador Clínico").
- Fase 5: `awaiting_treatment_start` ("Aguardando Iniciar Tratamento") →
  `in_treatment` ("Em Tratamento") → `treatment_finished` ("Tratamento
  Finalizado") / `treatment_cancelled` ("Tratamento Cancelado") /
  `treatment_partially_cancelled` ("Tratamento Cancelado Parcialmente").
- Fase 6: `awaiting_send_to_planning` (se "Necessita novo planejamento" = SIM).
- Fases 1/4/7: status operacionais conforme os módulos forem construídos.

## 4. Check-in e gatilhos de transição (decisão 3)

Cada agendamento ganha `checked_in_at` (chegada/check-in pela Recepcionista).
Transições **automáticas por check-in**:
- Fase 1 → Fase 2: check-in numa avaliação (agendamento tipo Avaliação).
- Fase 1 → Fase 5: check-in quando o agendamento é Urgência/Emergência.
- Fase 4 → Fase 5: check-in na 1ª sessão de tratamento.
- Fase 7 → Fase 6: check-in numa reavaliação (após decisão "Necessita
  reavaliação" = SIM).
- Fase 7 → Fase 5: check-in numa sessão (após decisão = NÃO).

Transições por **ação de função** (não check-in):
- Fase 2 → Fase 3: Coordenador envia os dados ao Centro de Planejamento.
- Fase 3 → Fase 4: Planner finaliza → Coordenador **aprova** → orçamento →
  Planner envia ao Consultor (Etapa 5).
- Fase 3 → Fase 2 / Fase 6: Planner devolve (com campo de orientações).
- Fase 5 → Fase 6 / Fase 7 / Fase 3: pelas decisões obrigatórias (abaixo).
- Fase 6 → Fase 7 / Fase 3: decisão "Necessita novo planejamento".

Fluxo de atendimento (sala de espera): check-in → "Em espera" → Coordenador/
Dentista "chama" → "Em atendimento" → conclui. (Tela de painel da unidade.)

## 5. Decisões obrigatórias (fim do tratamento, fase 5)

Ao concluir todos os procedimentos, abre uma decisão **bloqueante** (não fecha
sem responder) para o profissional do último procedimento:
"O cliente necessita de consulta de reavaliação com o Coordenador?"
- SIM → Recepcionista agenda reavaliação → Fase 6.
- NÃO → alerta ao Coordenador: "Necessita de Novo Planejamento?"
  - NÃO → Recepcionista agenda em controle de retorno → Fase 7.
  - SIM → Coordenador envia ao Centro de Planejamento (Fase 3); Recepcionista
    agenda apresentação (Fase 4).
- NÃO SEI → vai ao Coordenador decidir (mesmo desdobramento). Aviso em destaque,
  não some até decidir; aparece nas notificações do Gerente.

## 6. Funções por ambiente (decisão 2)

Travar atribuição por tipo de clínica:
- **Franqueadora:** `sdr`, `planner_dentist`, `commercial_consultant`,
  `commercial_assistant` (+ `franchisor_staff` leitura; `admin_master` global).
- **Unidade:** `receptionist`, `clinical_coordinator`, `dentist`, `unit_manager`,
  `tsb` (novo), `asb` (novo) (+ `franchisee` leitura).

Novas funções:
- **TSB (Técnica em Saúde Bucal):** vê fichas/jornada (leitura) e agenda dos
  clientes agendados; não agenda; executa procedimentos específicos com
  autorização do Coordenador.
- **ASB (Auxiliar em Saúde Bucal):** vê fichas/jornada (leitura) e agenda dos
  clientes agendados; não agenda; não executa procedimentos.

Funções da Franqueadora não acessam o ambiente das unidades, mas acessam
Jornada, Agenda, Financeiro e fichas dos clientes das unidades relacionadas.

## 7. Cliente Ativo/Inativo (regras automáticas, configuráveis no SLA)

Calculado por regras com limites editáveis na tela de Prazos:
- ATIVO: em atendimento; atendimento há < 12 meses (exceto fases 1/2); fase 1 <
  60 dias; fase 2 < 90 dias.
- INATIVO: > 12 meses sem atendimento; fase 1 > 60 dias sem ir à 2; fase 2 > 90
  dias sem ir à 4; fase 4 > 90 dias sem ir à 5; fases 5/6 > 90 dias sem
  agendamento e sem futuro; fase 7 > 12 meses sem atividade.

## 8. Plano de construção da BASE da jornada (decisão 4)

Antes dos módulos clínicos (Etapas 4 e 5), a base estrutural:
1. Funções TSB/ASB + trava de função por ambiente.
2. Pilar automático por fase + `treatment_pillar` do Planner.
3. `journey_status` (sub-status) + exibição na ficha/kanban/agenda.
4. Check-in nos agendamentos + transições automáticas (1→2, 1→5, 4→5, 7→6, 7→5)
   e painel de sala de espera (chegada → em espera → em atendimento).
5. Decisões obrigatórias da fase 5 (estrutura de "tarefa bloqueante" + escalonar
   ao Coordenador + avisos ao Gerente).
6. Regras automáticas de ativo/inativo (limites no SLA).
Depois: Etapa 4 (módulo do Coordenador) e Etapa 5 (Centro de Planejamento, com
aprovação do plano e orçamento).

## 9. Offline / sincronização (capturado — fazer depois)

Requisito: usar o sistema com internet instável/sem internet e sincronizar ao
reconectar. **Recomendação:** fase dedicada APÓS o núcleo da jornada, com app
**PWA** (instalável) + motor de sincronização offline-first para Supabase
(avaliar **PowerSync** ou **ElectricSQL**, feitos para Postgres/Supabase) ou,
se mais simples bastar, PWA + fila de envios (outbox) local. Manter o modelo de
dados compatível desde já: `updated_at` em todas as tabelas (ok), sem exclusão
física (ok), IDs estáveis. Decidir a tecnologia exata no início dessa fase.

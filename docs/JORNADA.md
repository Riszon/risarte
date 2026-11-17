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

## 4. Como e quando o cliente anda na jornada (0266)

**A fase é CONSEQUÊNCIA do trabalho, nunca um campo que alguém arrasta.** Desde
a 0266 existem só três maneiras de o cliente mudar de fase, nesta ordem de
importância:

### 4.1. Sozinho, por um fato que aconteceu (a regra)

| De → Para | O que faz acontecer | Onde mora |
|---|---|---|
| 1 → 2 | check-in num agendamento de **Avaliação** | `check_in_appointment` |
| 4 → 5 | **venda fechada** (contrato assinado **e** pagamento confirmado) | `commercial_close_step` |
| 4 → 5 | check-in na **1ª sessão** de tratamento | `check_in_appointment` |
| 4 → 7 | negociação marcada como **perdida/cancelada** | `commercial_lost_moves_to_followup` |
| 5 → 6 | fim do tratamento + resposta **Sim** (ou o Coordenador: **chamar para revisar**) | `answer_treatment_closure`, `register_closure_contact` (0418) |
| 5 → 7 | fim do tratamento + resposta **Não** + o Coordenador: **aguardar o retorno** ou **sem contato** (3 tentativas) | `register_closure_contact` (0418) |
| 5 → 3 | fim do tratamento + o Coordenador: **precisa de novo planejamento** | `register_closure_contact` (0418) |
| 7 → 6 | check-in numa **Reavaliação** | `check_in_appointment` |
| 7 → 5 | check-in numa **sessão** de tratamento | `check_in_appointment` |
| → 6 ou 7 | **cancelamento de plano efetivado** (destino escolhido pelo Gerente) | `apply_plan_cancellation` |

**Desde a 0418 (17/11/2026), a urgência não leva mais 1 → 5** (decisão do dono,
D13): quem chega pela urgência não tem tratamento. O check-in não muda a fase;
ao concluir, nasce a tarefa da Recepção "agendar a avaliação completa", e o
check-in da avaliação faz o 1 → 2 de sempre.

Ninguém aperta "mover" em nenhuma dessas linhas — e é por isso que elas saíram
da matriz. Enquanto estavam lá, existia um atalho para pular justamente o
trabalho que as dispara: dava para pôr o cliente em "Início de Tratamento" sem
venda fechada, ou em "Reavaliação" sem ninguém ter chegado à clínica.

### 4.2. Pelos ATOS do fluxo (a exceção, e são só quatro)

Aqui mover **é** o botão, porque a passagem é a consequência imediata do que a
pessoa acabou de fazer na tela:

| Ato | De → Para | Quem |
|---|---|---|
| **Enviar ao Centro de Planejamento** | 2 → 3 e 6 → 3 | Coordenador Clínico |
| **Concluir a reavaliação** | 6 → 7 | Coordenador Clínico |
| **Enviar ao Comercial** (exige pilar e plano aprovado) | 3 → 4 | Dentista Planner |
| **Devolver ao Coordenador** (exige motivo) | 3 → 2 e 3 → 6 | Dentista Planner |
| **Devolver ao Planejamento** (exige considerações) | 4 → 3 | Consultor Comercial |

O último é diferente dos outros e merece atenção: **quem move é o ato, não a
pessoa**. `return_commercial_to_planning` reabre o plano, encerra a negociação,
avisa o Planner e só então marca a transação (`risarte.ato`) para que o
`move_client_phase` aceite o 4 → 3. Chamar o movimento cru continua recusado —
ele moveria a fase e deixaria o plano aprovado e a negociação de pé.

### 4.3. Forçado pelo Admin Master (a válvula)

**Só o Admin Master força qualquer passagem** (ordem do dono, 21/09/2026), e o
botão de mover no kanban e na ficha só aparece para ele. Toda passagem vai para
a auditoria com `{from, to, forcado}` — `forcado = true` é exatamente "não foi
trabalho, foi mão". É o que permite descobrir depois que uma fase andou sem o
fato que deveria tê-la movido.

Fluxo de atendimento (sala de espera): check-in → "Em espera" → Coordenador/
Dentista "chama" → "Em atendimento" → conclui. (Tela de painel da unidade.)

## 5. O fim do tratamento (desde a 0418, 17/11/2026)

**Plano completo, achados e as 30 decisões do dono:**
`docs/jornada/FIM-DO-TRATAMENTO-PLANO.md`. Princípios do dono (16/11/2026): **o
cliente não pode ser esquecido nunca**, e **o principal responsável pelo sucesso
do tratamento é o Coordenador Clínico**.

O desenho original (0019) esperava o sub-status "Tratamento Finalizado", que só
o botão manual marcava: a pergunta nunca abriu. Agora:

1. **A última sessão concluída de cada plano** (original, complemento, venda
   direta) ou a **entrega da contenção** na ortodontia abre um **fechamento**
   (`treatment_closures`), uma tarefa com dono que só some quando é resolvida.
2. **Quem executou responde** (janela que não fecha sem resposta): "Este cliente
   necessita de consulta de reavaliação com o Coordenador Clínico?" Procedimento
   com **reavaliação obrigatória** no catálogo responde "Sim" sozinho.
   - **Sim** → Recepção agenda a reavaliação.
   - **Não** → o Coordenador contata o cliente e registra: chamar para revisar,
     aguardar o retorno (+6 meses sugeridos) ou novo planejamento; 3 tentativas
     sem falar → "sem contato".
   - **Não sei** → o Coordenador decide. Ele também muda a resposta enquanto
     nada aconteceu.
3. **A fase só muda no fim do tratamento**, quando não sobra nada
   (`_tratamento_em_aberto`): nenhuma sessão por fazer, nenhum complemento em
   andamento, nenhuma ortodontia aguardando início/em tratamento/suspensa. Com
   algo sobrando, a reavaliação acontece **dentro da Fase 5**.

Próximas etapas do plano: avaliação de qualidade em cinco níveis e satisfação
do cliente; abandono de tratamento e a lista "Clientes sem próximo passo"; o
cancelamento passando pelo Coordenador; prazos por dia útil da unidade.

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

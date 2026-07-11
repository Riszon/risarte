# Adendo 01 ao Briefing — Motor de benefícios, carência e painéis de uso/economia

**10 de julho de 2026.** Exigências acrescentadas pelo dono na aprovação do plano,
a serem embutidas **desde a Fase 0** (mudam o modelo de dados). Complementa o
`Briefing_Executavel_Risarte_Empresarial.md`. Dinheiro sempre em **centavos
inteiros** (corrige o `DECIMAL` do briefing original).

## 1. Proposta personalizável por empresa
Cada empresa pode ter regra própria (diferente do padrão da rede) tanto na
**mensalidade** quanto nos **benefícios**. Mantém o padrão **cascata**:
`company_id NULL` = padrão da rede; linha com `company_id` = override da empresa.
Vale para `adhesion_pricing`, `split_rules` e `procedure_benefits`.

## 2. Motor de benefícios por procedimento (`procedure_benefits` enriquecida)
Por procedimento (global ou por empresa):
- **Cobertura:** `benefit_type` = `DISCOUNT_PERCENT | DISCOUNT_AMOUNT | FREE | NOT_COVERED`.
  - `FREE` = sem custo ao cliente; `NOT_COVERED` = fora do programa (paga cheio);
    desconto = paga parcial.
- **Desconto:** `benefit_value` (% quando percent; centavos quando amount).
- **Quantidade de usos:** `usage_limit_count` (NULL = ilimitado).
- **Frequência:** `usage_period_months` (NULL = sem janela; ex.: 6 = a cada 6 meses).
  Regra: até `usage_limit_count` usos a cada `usage_period_months` meses.
- **Carência do benefício (colaborador):** `grace_period_months` contada da entrada
  do colaborador no programa.
- **Pagamento:** `max_installments` (parcelamento do procedimento); meios de
  pagamento herdados da empresa (`companies.payment_methods`).

## 3. Carência em dois níveis
- **Empresa:** `companies.contract_started_at` + `companies.grace_period_days` —
  antes disso, nenhum benefício vale para os colaboradores dela.
- **Colaborador:** `employees.joined_at` + carência do colaborador
  (`employees.grace_period_days`, senão `companies.employee_grace_period_days`),
  e ainda a carência específica do benefício (item 2).
- O benefício só libera quando **todas** as carências aplicáveis já passaram.

## 4. Acompanhamento de uso + alertas (`benefit_usage`)
- Cada uso de benefício é registrado em `empresarial.benefit_usage`
  (`client_id`, `clinic_id`, `company_id`, `procedure_id`, `benefit_id`,
  `member_role`, `used_at`, `appointment_id`, `amount_full_cents`,
  `amount_charged_cents`, `amount_saved_cents`).
- **Bloqueio:** ao orçar/agendar um procedimento com benefício de frequência,
  se ainda está dentro da janela (ex.: limpeza < 6 meses) e o limite de usos foi
  atingido, o benefício **não se aplica** (avisa o motivo; o procedimento pode
  seguir como pago normal).
- **Lembrete de uso:** rotina que encontra colaboradores cujo benefício recorrente
  **venceu a janela sem novo uso** e gera **notificação** (categoria "Empresarial")
  + **WhatsApp manual** (padrão dos aniversariantes) para chamar o colaborador.

## 5. Painéis de uso e economia (Fase 7)
- **Ficha do cliente:** aba "Programa Empresarial" — benefícios do plano, o que já
  usou, próximos disponíveis (com data de liberação por carência/frequência) e a
  **economia acumulada** (Σ `amount_saved_cents`).
- **Por empresa:** uso agregado, economia total gerada aos colaboradores, taxa de
  adesão aos benefícios e lista de quem ainda não usou os recorrentes (para ação).

## 6. Onde cada item entra
- **Fase 0:** tabelas já com todos os campos acima (`procedure_benefits`
  enriquecida, `benefit_usage`, campos de carência/pagamento em `companies` e
  `employees`).
- **Fase 2:** telas de configuração (rede + override por empresa) de tudo isso.
- **Fase 3:** aplicar benefício no orçamento respeitando carência/frequência/limite;
  registrar `benefit_usage` na execução (concluir sessão no riSZon).
- **Fase 7:** painéis de uso/economia (cliente e empresa) + rotina de lembrete.

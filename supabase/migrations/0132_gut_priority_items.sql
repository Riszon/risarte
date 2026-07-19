-- =============================================================================
-- 0132 — Prioridade GUT por procedimento do plano (Gravidade/Urgência/Tendência)
-- -----------------------------------------------------------------------------
-- O Dentista Planner define, por item do orçamento, a prioridade de execução
-- pela Matriz GUT: três notas de 1 a 5 (gravidade, urgência, tendência). A
-- prioridade final é o produto G×U×T (1..125), calculado na aplicação. Campos
-- opcionais (null = sem prioridade definida) — não travam o envio do plano.
-- Idempotente.
-- =============================================================================

alter table public.treatment_plan_option_items
  add column if not exists gut_gravity smallint,
  add column if not exists gut_urgency smallint,
  add column if not exists gut_tendency smallint;

do $$ begin
  alter table public.treatment_plan_option_items
    add constraint tpoi_gut_gravity_range
    check (gut_gravity is null or gut_gravity between 1 and 5);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.treatment_plan_option_items
    add constraint tpoi_gut_urgency_range
    check (gut_urgency is null or gut_urgency between 1 and 5);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.treatment_plan_option_items
    add constraint tpoi_gut_tendency_range
    check (gut_tendency is null or gut_tendency between 1 and 5);
exception when duplicate_object then null; end $$;

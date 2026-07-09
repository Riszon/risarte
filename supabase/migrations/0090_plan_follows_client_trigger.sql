-- =============================================================================
-- 0090 — O plano SEMPRE acompanha o cliente (gatilho + conserto retroativo)
-- -----------------------------------------------------------------------------
-- A 0089 movia o plano dentro do transfer_client, mas: (a) só valia para
-- transferências feitas DEPOIS de aplicá-la, e (b) casos já transferidos antes
-- ficaram com o plano preso na unidade de origem (o cliente aparecia em "Planos
-- de Tratamento" da unidade errada e o Coordenador de destino não conseguia
-- aprovar).
--
-- Aqui:
--  (1) GATILHO: sempre que a unidade do cliente muda (clients.clinic_id), o
--      plano inteiro (plano/opções/itens/etapas) e as sessões acompanham — não
--      importa por qual caminho a unidade mudou.
--  (2) BACKFILL: conserta de uma vez os planos de clientes já transferidos que
--      ficaram na unidade errada.
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Gatilho: move o plano do cliente para a unidade nova.
-- -----------------------------------------------------------------------------
create or replace function public.move_plan_on_clinic_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.treatment_plans
    set clinic_id = new.clinic_id
  where client_id = new.id;

  update public.treatment_plan_options o
    set clinic_id = new.clinic_id
  where o.plan_id in (
    select tp.id from public.treatment_plans tp where tp.client_id = new.id
  );

  update public.treatment_plan_option_items i
    set clinic_id = new.clinic_id
  where i.option_id in (
    select o.id from public.treatment_plan_options o
    join public.treatment_plans tp on tp.id = o.plan_id
    where tp.client_id = new.id
  );

  update public.treatment_plan_stages s
    set clinic_id = new.clinic_id
  where s.option_id in (
    select o.id from public.treatment_plan_options o
    join public.treatment_plans tp on tp.id = o.plan_id
    where tp.client_id = new.id
  );

  update public.treatment_sessions
    set clinic_id = new.clinic_id
  where client_id = new.id;

  return new;
end $$;

drop trigger if exists clients_move_plan_on_clinic_change on public.clients;
create trigger clients_move_plan_on_clinic_change
  after update of clinic_id on public.clients
  for each row
  when (old.clinic_id is distinct from new.clinic_id)
  execute function public.move_plan_on_clinic_change();

-- -----------------------------------------------------------------------------
-- Conserto retroativo: alinha o plano (e o encadeamento) à unidade ATUAL do
-- cliente. Ordem: plano → opções → itens/etapas → sessões.
-- -----------------------------------------------------------------------------
update public.treatment_plans tp
  set clinic_id = c.clinic_id
from public.clients c
where c.id = tp.client_id and tp.clinic_id is distinct from c.clinic_id;

update public.treatment_plan_options o
  set clinic_id = tp.clinic_id
from public.treatment_plans tp
where tp.id = o.plan_id and o.clinic_id is distinct from tp.clinic_id;

update public.treatment_plan_option_items i
  set clinic_id = o.clinic_id
from public.treatment_plan_options o
where o.id = i.option_id and i.clinic_id is distinct from o.clinic_id;

update public.treatment_plan_stages s
  set clinic_id = o.clinic_id
from public.treatment_plan_options o
where o.id = s.option_id and s.clinic_id is distinct from o.clinic_id;

update public.treatment_sessions ts
  set clinic_id = c.clinic_id
from public.clients c
where c.id = ts.client_id and ts.clinic_id is distinct from c.clinic_id;

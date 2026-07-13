-- =============================================================================
-- 0118 — Planejamento anual da REDE (H4.8 Bloco 1)
-- -----------------------------------------------------------------------------
-- A franqueadora define itens de calendário que valem para TODAS as unidades
-- (agenda_plan_items com clinic_id NULL = item da rede), com uma TRAVA:
--   locked = true  → a unidade NÃO pode abrir por cima (fecha em todas).
--   locked = false → a unidade pode liberar um dia avulso por cima.
-- Novo tipo "campaign" (campanha): informativo, NÃO fecha a agenda.
-- Idempotente.
-- =============================================================================

-- 1) Novo valor de enum (idempotente). Em PG 15 pode rodar junto do resto desde
--    que o valor não seja USADO neste mesmo script (não é — só a app o usa).
alter type public.plan_item_type add value if not exists 'campaign';

-- 2) Item da rede = clinic_id NULL; + coluna de trava (só importa p/ item da rede).
alter table public.agenda_plan_items alter column clinic_id drop not null;
alter table public.agenda_plan_items
  add column if not exists locked boolean not null default true;

create index if not exists agenda_plan_items_network_idx
  on public.agenda_plan_items (starts_date) where clinic_id is null;

-- 3) Quem gerencia o calendário da REDE: Admin Master ou um gestor
--    (Gerente/Franqueado) numa clínica do tipo franqueadora.
create or replace function public.can_manage_network_plan()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin_master() or exists (
    select 1
    from public.user_clinic_roles ucr
    join public.clinics c on c.id = ucr.clinic_id
    where ucr.user_id = (select auth.uid())
      and c.type = 'franchisor'
      and ucr.role in ('unit_manager', 'franchisee')
  );
$$;

grant execute on function public.can_manage_network_plan() to authenticated;

-- 4) RPCs do calendário da rede (SECURITY DEFINER; a RLS de select já é ampla).
create or replace function public.create_network_plan_item(
  p_type public.plan_item_type,
  p_starts date,
  p_ends date,
  p_title text,
  p_note text,
  p_locked boolean
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not public.can_manage_network_plan() then raise exception 'NOT_ALLOWED'; end if;
  if p_ends < p_starts then raise exception 'INVALID_PERIOD'; end if;
  if p_ends < current_date then raise exception 'PERIOD_IN_PAST'; end if;
  if p_type = 'individual_vacation' then raise exception 'INVALID_TYPE'; end if;

  insert into public.agenda_plan_items
    (clinic_id, type, starts_date, ends_date, title, note, locked, created_by)
  values (
    null, p_type, p_starts, p_ends,
    nullif(btrim(coalesce(p_title, '')), ''),
    nullif(btrim(coalesce(p_note, '')), ''),
    coalesce(p_locked, true),
    (select auth.uid())
  )
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.update_network_plan_item(
  p_id uuid,
  p_type public.plan_item_type,
  p_starts date,
  p_ends date,
  p_title text,
  p_note text,
  p_locked boolean
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic uuid;
  v_end date;
  v_is_network boolean;
begin
  if not public.can_manage_network_plan() then raise exception 'NOT_ALLOWED'; end if;
  select clinic_id, ends_date, (clinic_id is null)
    into v_clinic, v_end, v_is_network
  from public.agenda_plan_items where id = p_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  if not v_is_network then raise exception 'NOT_NETWORK'; end if;
  if v_end < current_date or p_ends < current_date then
    raise exception 'PERIOD_IN_PAST';
  end if;
  if p_ends < p_starts then raise exception 'INVALID_PERIOD'; end if;
  if p_type = 'individual_vacation' then raise exception 'INVALID_TYPE'; end if;

  update public.agenda_plan_items
  set type = p_type, starts_date = p_starts, ends_date = p_ends,
      title = nullif(btrim(coalesce(p_title, '')), ''),
      note = nullif(btrim(coalesce(p_note, '')), ''),
      locked = coalesce(p_locked, true)
  where id = p_id;
end $$;

create or replace function public.delete_network_plan_item(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_end date;
  v_is_network boolean;
begin
  if not public.can_manage_network_plan() then raise exception 'NOT_ALLOWED'; end if;
  select ends_date, (clinic_id is null) into v_end, v_is_network
  from public.agenda_plan_items where id = p_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  if not v_is_network then raise exception 'NOT_NETWORK'; end if;
  if v_end < current_date then raise exception 'PERIOD_IN_PAST'; end if;
  delete from public.agenda_plan_items where id = p_id;
end $$;

grant execute on function public.create_network_plan_item(
  public.plan_item_type, date, date, text, text, boolean) to authenticated;
grant execute on function public.update_network_plan_item(
  uuid, public.plan_item_type, date, date, text, text, boolean) to authenticated;
grant execute on function public.delete_network_plan_item(uuid) to authenticated;

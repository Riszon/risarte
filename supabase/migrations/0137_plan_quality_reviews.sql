-- =============================================================================
-- Risarte Odontologia — Migration 0137 (Cockpit do Coordenador — Bloco D)
-- Checklist de qualidade da REAVALIAÇÃO.
--
-- Na reavaliação, o Coordenador confere o último plano CONCLUÍDO procedimento a
-- procedimento, marcando cada um como Aprovado / Revisão / Reprovado. Quando o
-- plano fica 100% APROVADO, ele é TRAVADO (`quality_locked`) e não é mais pedido
-- para revisar/reprovar. Revisões/reprovações ficam registradas no plano.
--
-- O checklist usa os itens da OPÇÃO PRINCIPAL do plano (a que foi executada).
-- Idempotente.
-- =============================================================================

-- 1) Trava do controle de qualidade no plano. ---------------------------------
alter table public.treatment_plans
  add column if not exists quality_locked boolean not null default false;
alter table public.treatment_plans
  add column if not exists quality_locked_at timestamptz;

-- 2) Revisão de qualidade por procedimento (item do orçamento). ---------------
create table if not exists public.plan_quality_reviews (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.treatment_plans (id) on delete cascade,
  item_id uuid not null references public.treatment_plan_option_items (id) on delete cascade,
  clinic_id uuid not null references public.clinics (id),
  status text not null check (status in ('aprovado', 'revisao', 'reprovado')),
  note text,
  reviewed_by uuid references public.profiles (id),
  reviewed_at timestamptz not null default now(),
  unique (item_id)
);
create index if not exists plan_quality_reviews_plan_idx
  on public.plan_quality_reviews (plan_id);
alter table public.plan_quality_reviews enable row level security;

-- Leitura: mesmo escopo dos demais registros clínicos do plano.
drop policy if exists "plan_quality_reviews_select" on public.plan_quality_reviews;
create policy "plan_quality_reviews_select" on public.plan_quality_reviews
  for select to authenticated
  using (
    public.is_admin_master()
    or clinic_id in (select public.user_full_access_clinic_ids())
    or public.is_planner()
    or public.has_role_in_clinic(clinic_id, array['dentist','clinical_coordinator']::public.user_role[])
    or public.user_has_client_history_access(
         (select tp.client_id from public.treatment_plans tp where tp.id = plan_id))
  );

-- Escrita direta só Coordenador/Admin (a RPC abaixo é SECURITY DEFINER).
drop policy if exists "plan_quality_reviews_write" on public.plan_quality_reviews;
create policy "plan_quality_reviews_write" on public.plan_quality_reviews
  for all to authenticated
  using (
    public.is_admin_master()
    or public.has_role_in_clinic(clinic_id, array['clinical_coordinator']::public.user_role[])
  )
  with check (
    public.is_admin_master()
    or public.has_role_in_clinic(clinic_id, array['clinical_coordinator']::public.user_role[])
  );

-- 3) RPC: marca a qualidade de um procedimento e trava o plano se 100% aprovado.
create or replace function public.set_plan_item_quality(
  p_item_id uuid,
  p_status text,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan uuid;
  v_clinic uuid;
  v_locked boolean;
  v_primary_option uuid;
  v_total int;
  v_approved int;
  v_user uuid := (select auth.uid());
begin
  if p_status not in ('aprovado', 'revisao', 'reprovado') then
    raise exception 'INVALID_STATUS';
  end if;

  select o.plan_id, i.clinic_id into v_plan, v_clinic
  from public.treatment_plan_option_items i
  join public.treatment_plan_options o on o.id = i.option_id
  where i.id = p_item_id;
  if v_plan is null then raise exception 'ITEM_NOT_FOUND'; end if;

  if not (
    public.is_admin_master()
    or public.has_role_in_clinic(
         v_clinic, array['clinical_coordinator']::public.user_role[])
  ) then
    raise exception 'NOT_ALLOWED';
  end if;

  select quality_locked into v_locked from public.treatment_plans where id = v_plan;
  if v_locked then raise exception 'LOCKED'; end if;

  insert into public.plan_quality_reviews
    (plan_id, item_id, clinic_id, status, note, reviewed_by, reviewed_at)
  values (v_plan, p_item_id, v_clinic, p_status, nullif(btrim(p_note), ''), v_user, now())
  on conflict (item_id) do update
    set status = excluded.status, note = excluded.note,
        reviewed_by = excluded.reviewed_by, reviewed_at = now();

  -- Opção principal (executada) do plano.
  select id into v_primary_option from public.treatment_plan_options
    where plan_id = v_plan order by is_primary desc, sort_order limit 1;

  select count(*) into v_total from public.treatment_plan_option_items
    where option_id = v_primary_option;
  select count(*) into v_approved
    from public.plan_quality_reviews r
    join public.treatment_plan_option_items i on i.id = r.item_id
    where i.option_id = v_primary_option and r.status = 'aprovado';

  if v_total > 0 and v_approved = v_total then
    update public.treatment_plans
      set quality_locked = true, quality_locked_at = now()
    where id = v_plan;
  end if;

  insert into public.audit_logs
    (user_id, clinic_id, action, entity_type, entity_id, details)
  values (v_user, v_clinic, 'update', 'plan_quality_review', p_item_id::text,
    jsonb_build_object('status', p_status));
end;
$$;

revoke all on function public.set_plan_item_quality(uuid, text, text) from public;
grant execute on function public.set_plan_item_quality(uuid, text, text) to authenticated;

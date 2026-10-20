-- =============================================================================
-- 0312 — D6 NO PLANO + O ACHADO "A TRATAR" EM VERMELHO
--
-- Decisões do dono (20/10/2026):
--   * D6 (OD0): o Admin Master que NÃO é o titular perde "montar plano" — só
--     o Planner e o titular (Admin Principal, is_owner) criam, editam e enviam
--     o plano. O Admin continua VENDO tudo (as regras de leitura não mudam).
--   * Cor: o achado que PEDE TRATAMENTO (cárie, fratura, lesão…) aparece em
--     VERMELHO já no diagnóstico. Qual situação é "a tratar" é configuração da
--     rede (Administração → Odontograma → Situações), semeada aqui.
--
-- Idempotente. Nada apaga dado.
-- =============================================================================

-- 1) D6: gravar no plano = titular OU Planner -----------------------------------
-- (antes: is_admin_master() OR is_planner())
drop policy if exists treatment_plans_insert on public.treatment_plans;
create policy treatment_plans_insert on public.treatment_plans
  for insert to authenticated
  with check (public.is_owner() or (public.is_planner() and clinic_id in (select public.user_full_access_clinic_ids())));
drop policy if exists treatment_plans_update on public.treatment_plans;
create policy treatment_plans_update on public.treatment_plans
  for update to authenticated
  using (public.is_owner() or public.is_planner()
         or public.has_role_in_clinic(clinic_id, array['clinical_coordinator']::public.user_role[]));
drop policy if exists treatment_plans_delete on public.treatment_plans;
create policy treatment_plans_delete on public.treatment_plans
  for delete to authenticated
  using (public.is_owner() or public.is_planner());

drop policy if exists treatment_plan_options_insert on public.treatment_plan_options;
create policy treatment_plan_options_insert on public.treatment_plan_options
  for insert to authenticated
  with check (public.is_owner() or (public.is_planner() and clinic_id in (select public.user_full_access_clinic_ids())));
drop policy if exists treatment_plan_options_update on public.treatment_plan_options;
create policy treatment_plan_options_update on public.treatment_plan_options
  for update to authenticated
  using (public.is_owner() or public.is_planner());
drop policy if exists treatment_plan_options_delete on public.treatment_plan_options;
create policy treatment_plan_options_delete on public.treatment_plan_options
  for delete to authenticated
  using (public.is_owner() or public.is_planner());

drop policy if exists tpo_items_insert on public.treatment_plan_option_items;
create policy tpo_items_insert on public.treatment_plan_option_items
  for insert to authenticated
  with check (public.is_owner() or (public.is_planner() and clinic_id in (select public.user_full_access_clinic_ids())));
drop policy if exists tpo_items_update on public.treatment_plan_option_items;
create policy tpo_items_update on public.treatment_plan_option_items
  for update to authenticated
  using (public.is_owner() or public.is_planner());
drop policy if exists tpo_items_delete on public.treatment_plan_option_items;
create policy tpo_items_delete on public.treatment_plan_option_items
  for delete to authenticated
  using (public.is_owner() or public.is_planner());

drop policy if exists tp_stages_insert on public.treatment_plan_stages;
create policy tp_stages_insert on public.treatment_plan_stages
  for insert to authenticated
  with check (public.is_owner() or (public.is_planner() and clinic_id in (select public.user_full_access_clinic_ids())));
drop policy if exists tp_stages_update on public.treatment_plan_stages;
create policy tp_stages_update on public.treatment_plan_stages
  for update to authenticated
  using (public.is_owner() or public.is_planner());
drop policy if exists tp_stages_delete on public.treatment_plan_stages;
create policy tp_stages_delete on public.treatment_plan_stages
  for delete to authenticated
  using (public.is_owner() or public.is_planner());

drop policy if exists plan_session_joins_write on public.plan_session_joins;
create policy plan_session_joins_write on public.plan_session_joins
  for all to authenticated
  using (public.is_owner() or public.is_planner())
  with check (public.is_owner() or (public.is_planner() and clinic_id in (select public.user_full_access_clinic_ids())));

-- O envio para aprovação: mesma função da 0311, com a D6 na guarda.
create or replace function public.submit_treatment_plan(p_plan_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client uuid;
  v_clinic uuid;
  v_phase public.journey_phase;
  v_diagnosis text;
  v_options integer;
  v_name text;
  v_superseded timestamptz;
  v_user uuid := (select auth.uid());
begin
  select tp.client_id, tp.clinic_id, tp.diagnosis, tp.superseded_at
    into v_client, v_clinic, v_diagnosis, v_superseded
  from public.treatment_plans tp where tp.id = p_plan_id;
  if v_client is null then raise exception 'PLAN_NOT_FOUND'; end if;

  -- D6: o titular ou o Planner (o Admin que não é o titular só vê).
  if v_user is null or not (public.is_owner() or public.is_planner()) then
    raise exception 'NOT_ALLOWED';
  end if;
  if v_superseded is not null then raise exception 'PLAN_SUPERSEDED'; end if;

  select journey_phase, full_name into v_phase, v_name
  from public.clients where id = v_client;
  if v_phase <> 'planning_center' then raise exception 'WRONG_PHASE'; end if;

  if coalesce(btrim(v_diagnosis), '') = '' then
    raise exception 'DIAGNOSIS_REQUIRED';
  end if;

  -- E2: o plano se monta sobre o diagnóstico DEFINIDO.
  if exists (select 1 from public.tooth_findings
              where client_id = v_client and status = 'suggested') then
    raise exception 'DIAGNOSIS_PENDING_SUGGESTIONS';
  end if;
  if not exists (select 1 from public.clinical_evaluations
                  where client_id = v_client and diagnosis_finalized_at is not null) then
    raise exception 'DIAGNOSIS_NOT_FINALIZED';
  end if;

  select count(*) into v_options
  from public.treatment_plan_options where plan_id = p_plan_id;
  if v_options = 0 then raise exception 'OPTIONS_REQUIRED'; end if;

  if exists (
    select 1 from public.treatment_plan_options o
    where o.plan_id = p_plan_id
      and not exists (
        select 1 from public.treatment_plan_option_items i
        where i.option_id = o.id
      )
  ) then
    raise exception 'OPTION_NEEDS_ITEMS';
  end if;

  if exists (
    select 1
      from public.treatment_plan_option_items i
      join public.treatment_plan_options o on o.id = i.option_id
      join public.procedure_dental_rules r on r.procedure_id = i.procedure_id
     where o.plan_id = p_plan_id
       and r.application_level <> 'none'
       and i.tooth_code is null and i.region_code is null
  ) then
    raise exception 'ITEM_LOCATION_REQUIRED';
  end if;

  -- F3: o preço de cada item é o do catálogo NO DIA DO ENVIO.
  update public.treatment_plan_option_items i
     set unit_price_cents = public.catalog_price_for(i.clinic_id, i.procedure_id)
    from public.treatment_plan_options o
   where o.id = i.option_id
     and o.plan_id = p_plan_id
     and i.procedure_id is not null
     and i.unit_price_cents is distinct from public.catalog_price_for(i.clinic_id, i.procedure_id);

  update public.treatment_plan_options
    set review_status = 'pending', reviewed_by = null, reviewed_at = null,
        review_notes = null
  where plan_id = p_plan_id;

  update public.treatment_plans
    set status = 'submitted', submitted_at = now(), updated_at = now(),
        reviewed_by = null, reviewed_at = null, review_notes = null,
        prices_frozen_at = now()
  where id = p_plan_id;

  update public.clients
    set journey_status = 'awaiting_plan_approval'
  where id = v_client;

  insert into public.notifications (user_id, clinic_id, title, body, link)
  select ucr.user_id, v_clinic,
         'Plano aguardando aprovação',
         coalesce(v_name, 'Cliente') ||
           ' — o Planner enviou o plano de tratamento para sua aprovação.',
         '/clientes/' || v_client
  from public.user_clinic_roles ucr
  where ucr.clinic_id = v_clinic and ucr.role = 'clinical_coordinator';

  insert into public.audit_logs
    (user_id, clinic_id, action, entity_type, entity_id, details)
  values (v_user, v_clinic, 'update', 'treatment_plan', p_plan_id::text,
          jsonb_build_object('status', 'submitted'));
end;
$$;
revoke execute on function public.submit_treatment_plan(uuid) from public, anon, authenticated;
grant execute on function public.submit_treatment_plan(uuid) to authenticated;

-- 2) O achado "a tratar" (vermelho no diagnóstico) --------------------------------
-- Semeado UMA vez (quando a coluna nasce): rodar de novo não desfaz o que o
-- Admin ajustou na tela.
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'dental_conditions'
                    and column_name = 'needs_treatment') then
    alter table public.dental_conditions add column needs_treatment boolean not null default false;
    update public.dental_conditions set needs_treatment = true
     where code in ('C', 'E', 'RZ-RESTINS', 'RZ-CARINC', 'RZ-NCC', 'RZ-FRATURA', 'RZ-ENDOINS',
                    'RZ-RAIZRES', 'RZ-MOBILIDADE', 'RZ-RECESSAO', 'RZ-BOLSA', 'RZ-FURCA');
  end if;
end $$;

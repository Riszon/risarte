-- =============================================================================
-- 0099 — Risarte Empresarial (Fase 3): registro de uso do benefício
-- -----------------------------------------------------------------------------
-- Quando uma sessão do tratamento é CONCLUÍDA (public.treatment_sessions.status
-- = 'done') e o cliente é membro ativo do programa, registra o uso do benefício
-- do procedimento em empresarial.benefit_usage (para frequência/limite valerem e
-- para o painel de economia). Idempotente por (client_id, procedure_id,
-- appointment_id). Cross-schema, SECURITY DEFINER.
-- =============================================================================

create or replace function empresarial.record_benefit_usage(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sess record;
  v_company uuid;
  v_active boolean;
  v_ben record;
  v_full bigint;
  v_saved bigint;
  v_role text;
begin
  select ts.client_id, ts.clinic_id, ts.procedure_id, ts.item_id, ts.appointment_id
    into v_sess
  from public.treatment_sessions ts
  where ts.id = p_session_id;
  if not found or v_sess.procedure_id is null then
    return;
  end if;

  -- Cliente é membro ativo do programa?
  select empresarial_company_id, empresarial_active
    into v_company, v_active
  from public.clients where id = v_sess.client_id;
  if v_company is null or v_active is not true then
    return;
  end if;

  -- Já registrado para este agendamento+procedimento?
  if exists (
    select 1 from empresarial.benefit_usage
    where client_id = v_sess.client_id
      and procedure_id = v_sess.procedure_id
      and appointment_id is not distinct from v_sess.appointment_id
  ) then
    return;
  end if;

  -- Benefício efetivo (empresa > rede).
  select * into v_ben
  from empresarial.procedure_benefits
  where procedure_id = v_sess.procedure_id
    and (company_id = v_company or company_id is null)
  order by (company_id = v_company) desc
  limit 1;
  if not found or v_ben.benefit_type = 'NOT_COVERED' then
    return;
  end if;

  -- Preço cheio do item (unitário × quantidade).
  select coalesce(unit_price_cents * quantity, 0) into v_full
  from public.treatment_plan_option_items where id = v_sess.item_id;
  v_full := coalesce(v_full, 0);

  v_saved := case v_ben.benefit_type
    when 'FREE' then v_full
    when 'DISCOUNT_PERCENT' then round(v_full * coalesce(v_ben.benefit_value, 0) / 100.0)
    when 'DISCOUNT_AMOUNT' then least(v_full, coalesce(v_ben.benefit_value, 0))::bigint
    else 0
  end;

  v_role := case
    when exists (
      select 1 from empresarial.employees
      where client_id = v_sess.client_id and company_id = v_company
    ) then 'HOLDER' else 'DEPENDENT' end;

  insert into empresarial.benefit_usage
    (client_id, clinic_id, company_id, procedure_id, benefit_id, member_role,
     used_at, appointment_id, amount_full_cents, amount_charged_cents, amount_saved_cents)
  values
    (v_sess.client_id, v_sess.clinic_id, v_company, v_sess.procedure_id, v_ben.id,
     v_role, now(), v_sess.appointment_id, v_full, v_full - v_saved, v_saved);
end $$;

create or replace function empresarial.treatment_session_usage_trg()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'done'
     and (tg_op = 'INSERT' or old.status is distinct from 'done') then
    perform empresarial.record_benefit_usage(new.id);
  end if;
  return null;
end $$;

drop trigger if exists treatment_session_benefit_usage on public.treatment_sessions;
create trigger treatment_session_benefit_usage
  after insert or update of status on public.treatment_sessions
  for each row execute function empresarial.treatment_session_usage_trg();

grant execute on function empresarial.record_benefit_usage(uuid) to authenticated;

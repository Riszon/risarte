-- =============================================================================
-- 0333 — ORTODONTIA (ORTO7): DO CLÍNICO AO PLANO
--
-- Pedido do dono em 28/10/2026 (docs/ortodontia/ORTO-PLANO.md §5, regras R3,
-- R5 (parte clínica), R6, R10 e decisão Q3):
--   * R3: o Coordenador INDICA/SUGERE ortodontia na avaliação ou na
--     reavaliação (`clinical_evaluations.ortho_indicated` + observação); o
--     Planner vê a indicação no cockpit dele.
--   * R3/R5: o Planner define as CARACTERÍSTICAS do caso na opção do plano
--     (`treatment_plan_ortho`: tipo de aparelho, meses previstos — referência —,
--     intervalo das manutenções, tipo de contenção final, observações); o
--     Coordenador aprova junto com a opção (`review_plan_option`, sem passo
--     novo); o Comercial recebe tudo com o plano.
--   * R10/Q3: o termo fala de QUEM INICIA; o responsável pode ser trocado ao
--     longo do tratamento (fica no histórico); sem ortodontista escolhido, o
--     dentista do agendamento de instalação assume.
--   * R6 (prazo como referência) é só texto — `orthoClauses`.
--
-- Idempotente. Assinaturas das funções existentes NÃO mudam.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) R3 — A INDICAÇÃO DE ORTODONTIA NA AVALIAÇÃO / REAVALIAÇÃO
-- -----------------------------------------------------------------------------
alter table public.clinical_evaluations
  add column if not exists ortho_indicated boolean not null default false,
  add column if not exists ortho_indication_note text,
  add column if not exists ortho_indicated_by uuid references public.profiles (id),
  add column if not exists ortho_indicated_at timestamptz;
create index if not exists clinical_evaluations_ortho_idx
  on public.clinical_evaluations (client_id, ortho_indicated) where ortho_indicated;

-- O Coordenador (da unidade do paciente ou de uma unidade compartilhada) marca
-- a indicação na rodada ABERTA (cria uma se não houver — `ensure_open_evaluation`).
-- Rodada com o diagnóstico finalizado (0310) não muda: EVALUATION_LOCKED.
create or replace function public.set_evaluation_ortho_indication(
  p_client uuid,
  p_clinic uuid,
  p_indicated boolean,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_eval uuid;
  v_finalized timestamptz;
begin
  if v_user is null then raise exception 'NOT_ALLOWED'; end if;
  if not (public.is_admin_master()
          or public.has_role_in_clinic(p_clinic, array['clinical_coordinator']::public.user_role[])) then
    raise exception 'NOT_ALLOWED';
  end if;
  if not exists (select 1 from public.clients c where c.id = p_client
                   and (c.clinic_id = p_clinic
                        or exists (select 1 from public.client_shares s
                                    where s.client_id = c.id and s.clinic_id = p_clinic and s.ended_at is null))) then
    raise exception 'CLIENT_NOT_IN_CLINIC';
  end if;

  v_eval := public.ensure_open_evaluation(p_client, p_clinic);
  if v_eval is null then raise exception 'EVALUATION_NOT_FOUND'; end if;
  select diagnosis_finalized_at into v_finalized from public.clinical_evaluations where id = v_eval;
  if v_finalized is not null then raise exception 'EVALUATION_LOCKED'; end if;

  update public.clinical_evaluations set
    ortho_indicated = coalesce(p_indicated, false),
    ortho_indication_note = case when coalesce(p_indicated, false) then nullif(btrim(p_note), '') else null end,
    ortho_indicated_by = case when coalesce(p_indicated, false) then v_user else null end,
    ortho_indicated_at = case when coalesce(p_indicated, false) then now() else null end
  where id = v_eval;
  return v_eval;
end;
$$;
revoke execute on function public.set_evaluation_ortho_indication(uuid, uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.set_evaluation_ortho_indication(uuid, uuid, boolean, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 2) R3/R5 — A PROPOSTA ORTODÔNTICA DA OPÇÃO DO PLANO (o Planner define)
-- -----------------------------------------------------------------------------
create table if not exists public.treatment_plan_ortho (
  option_id uuid primary key,
  plan_id uuid not null references public.treatment_plans (id) on delete cascade,
  clinic_id uuid not null references public.clinics (id),
  client_id uuid not null references public.clients (id) on delete cascade,
  treatment_kind text not null default 'aparelho_fixo'
    check (treatment_kind in ('aparelho_fixo','alinhadores','aparelho_removivel','contencao','outro')),
  -- Referência, não compromisso (R6): o termo diz isso.
  planned_months integer not null default 24 check (planned_months between 1 and 120),
  maintenance_interval_days integer not null default 30
    check (maintenance_interval_days between 7 and 180),
  retainer_kind text not null default 'a_definir'
    check (retainer_kind in ('placa_removivel','fixa_colada','ambas','a_definir')),
  notes text,
  created_by uuid references public.profiles (id),
  updated_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- A ligação com nome fixo: o app embute `ortho:treatment_plan_ortho!treatment_plan_ortho_option_id_fkey`.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'treatment_plan_ortho_option_id_fkey') then
    alter table public.treatment_plan_ortho
      add constraint treatment_plan_ortho_option_id_fkey
      foreign key (option_id) references public.treatment_plan_options (id) on delete cascade;
  end if;
end $$;
create index if not exists treatment_plan_ortho_plan_idx on public.treatment_plan_ortho (plan_id);
create index if not exists treatment_plan_ortho_client_idx on public.treatment_plan_ortho (client_id);

alter table public.treatment_plan_ortho enable row level security;
-- Lê quem lê a opção do plano (0035): a unidade (escopo da Franqueadora
-- incluso — o Consultor chega por aí), o Planner e o Admin.
drop policy if exists "treatment_plan_ortho_select" on public.treatment_plan_ortho;
create policy "treatment_plan_ortho_select" on public.treatment_plan_ortho
  for select to authenticated
  using (
    public.is_admin_master()
    or clinic_id in (select public.user_full_access_clinic_ids())
    or public.is_planner()
  );
-- Gravar: só pelas funções. Direto, só o Admin.
drop policy if exists "treatment_plan_ortho_write" on public.treatment_plan_ortho;
create policy "treatment_plan_ortho_write" on public.treatment_plan_ortho
  for all to authenticated
  using (public.is_admin_master()) with check (public.is_admin_master());

-- Quem monta o plano (0312: o Planner e o titular) define a proposta — e só
-- enquanto o plano está editável (rascunho/devolvido, 0311). Depois de
-- enviado/aprovado, a proposta vai junto com a opção, trancada.
create or replace function public.save_plan_option_ortho(
  p_option_id uuid,
  p_treatment_kind text,
  p_planned_months integer,
  p_retainer_kind text,
  p_interval_days integer default null,
  p_notes text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_o record;
  v_client uuid;
begin
  if v_user is null then raise exception 'NOT_ALLOWED'; end if;
  if not (public.is_planner() or public.is_owner()) then raise exception 'NOT_ALLOWED'; end if;
  select o.id, o.plan_id, o.clinic_id into v_o from public.treatment_plan_options o where o.id = p_option_id;
  if v_o.id is null then raise exception 'OPTION_NOT_FOUND'; end if;
  if not public._plan_is_editable(v_o.plan_id) then raise exception 'PLAN_LOCKED'; end if;
  select client_id into v_client from public.treatment_plans where id = v_o.plan_id;

  insert into public.treatment_plan_ortho
    (option_id, plan_id, clinic_id, client_id, treatment_kind, planned_months,
     maintenance_interval_days, retainer_kind, notes, created_by, updated_by)
  values
    (p_option_id, v_o.plan_id, v_o.clinic_id, v_client,
     coalesce(p_treatment_kind, 'aparelho_fixo'), coalesce(p_planned_months, 24),
     coalesce(p_interval_days, 30), coalesce(p_retainer_kind, 'a_definir'),
     nullif(btrim(p_notes), ''), v_user, v_user)
  on conflict (option_id) do update set
    treatment_kind = excluded.treatment_kind,
    planned_months = excluded.planned_months,
    maintenance_interval_days = excluded.maintenance_interval_days,
    retainer_kind = excluded.retainer_kind,
    notes = excluded.notes,
    updated_by = v_user,
    updated_at = now();
end;
$$;
revoke execute on function public.save_plan_option_ortho(uuid, text, integer, text, integer, text) from public, anon, authenticated;
grant execute on function public.save_plan_option_ortho(uuid, text, integer, text, integer, text) to authenticated;

create or replace function public.delete_plan_option_ortho(p_option_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan uuid;
begin
  if (select auth.uid()) is null then raise exception 'NOT_ALLOWED'; end if;
  if not (public.is_planner() or public.is_owner()) then raise exception 'NOT_ALLOWED'; end if;
  select plan_id into v_plan from public.treatment_plan_ortho where option_id = p_option_id;
  if v_plan is null then return; end if;
  if not public._plan_is_editable(v_plan) then raise exception 'PLAN_LOCKED'; end if;
  delete from public.treatment_plan_ortho where option_id = p_option_id;
end;
$$;
revoke execute on function public.delete_plan_option_ortho(uuid) from public, anon, authenticated;
grant execute on function public.delete_plan_option_ortho(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 3) R10 — QUEM INICIA: a troca de ortodontista fica no histórico do caso
-- -----------------------------------------------------------------------------
create or replace function public.ortho_update_case(
  p_case_id uuid,
  p_orthodontist_id uuid,
  p_treatment_kind text,
  p_start_date date,
  p_planned_months integer,
  p_interval_days integer,
  p_monthly_fee_cents integer,
  p_billing_day integer,
  p_installation_fee_cents integer,
  p_maintenance_procedure_id uuid,
  p_next_reevaluation_date date,
  p_notes text,
  p_retainer_charged boolean default null,
  p_retainer_fee_cents integer default null,
  p_retainer_terms text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_c public.ortho_cases;
  v_old_name text;
  v_new_name text;
begin
  select * into v_c from public.ortho_cases where id = p_case_id;
  if v_c.id is null then raise exception 'NOT_FOUND'; end if;
  if not public.ortho_can_manage(v_c.clinic_id) then raise exception 'NOT_ALLOWED'; end if;

  update public.ortho_cases set
    orthodontist_id = p_orthodontist_id,
    treatment_kind = coalesce(p_treatment_kind, treatment_kind),
    start_date = p_start_date,
    planned_months = coalesce(p_planned_months, planned_months),
    maintenance_interval_days = coalesce(p_interval_days, maintenance_interval_days),
    maintenance_procedure_id = p_maintenance_procedure_id,
    next_reevaluation_date = p_next_reevaluation_date,
    notes = nullif(btrim(p_notes), '')
  where id = p_case_id;

  insert into public.ortho_case_terms (case_id, clinic_id) values (p_case_id, v_c.clinic_id)
  on conflict (case_id) do nothing;
  update public.ortho_case_terms set
    monthly_fee_cents = coalesce(p_monthly_fee_cents, monthly_fee_cents),
    billing_day = coalesce(p_billing_day, billing_day),
    installation_fee_cents = coalesce(p_installation_fee_cents, installation_fee_cents),
    retainer_charged = coalesce(p_retainer_charged, retainer_charged),
    retainer_fee_cents = coalesce(p_retainer_fee_cents, retainer_fee_cents),
    retainer_terms = nullif(btrim(p_retainer_terms), ''),
    updated_by = (select auth.uid())
  where case_id = p_case_id;

  -- Mudou o intervalo: a prorrogação das faltas muda junto.
  if v_c.maintenance_interval_days is distinct from coalesce(p_interval_days, v_c.maintenance_interval_days) then
    perform public._ortho_recompute_extension(p_case_id);
  end if;

  -- Mudou o cronograma: as previstas FUTURAS sem agendamento são refeitas; o
  -- que já aconteceu ou já está agendado fica.
  if v_c.status = 'em_tratamento'
     and (v_c.start_date is distinct from p_start_date
          or v_c.planned_months is distinct from coalesce(p_planned_months, v_c.planned_months)
          or v_c.maintenance_interval_days is distinct from coalesce(p_interval_days, v_c.maintenance_interval_days)) then
    delete from public.ortho_maintenances
     where case_id = p_case_id and status = 'prevista' and appointment_id is null
       and planned_date > public.today_br();
    perform public.ortho_plan_maintenances(p_case_id);
  end if;

  -- R10: trocar o responsável é um fato do caso, com nome (de profissional,
  -- não de paciente) — o termo diz quem INICIA e que outro pode continuar.
  if v_c.orthodontist_id is distinct from p_orthodontist_id then
    select full_name into v_old_name from public.profiles where id = v_c.orthodontist_id;
    select full_name into v_new_name from public.profiles where id = p_orthodontist_id;
    perform public._ortho_log(p_case_id, 'ortodontista_alterado',
      'Ortodontista responsável: ' || coalesce(v_old_name, 'a definir')
      || ' → ' || coalesce(v_new_name, 'a definir'));
  end if;

  perform public._ortho_log(p_case_id, 'caso_editado', 'Dados do caso alterados');
end;
$$;
revoke execute on function public.ortho_update_case(uuid, uuid, text, date, integer, integer, integer, integer, integer, uuid, date, text, boolean, integer, text) from public, anon, authenticated;
grant execute on function public.ortho_update_case(uuid, uuid, text, date, integer, integer, integer, integer, integer, uuid, date, text, boolean, integer, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 4) Q3 — SEM ORTODONTISTA ESCOLHIDO, O DENTISTA DA INSTALAÇÃO ASSUME
-- -----------------------------------------------------------------------------
-- O gatilho da agenda (0329/0331) só ligava o agendamento quando o
-- profissional ERA o ortodontista do caso. Agora: caso sem ortodontista +
-- agendamento de início/sessão com um dentista da unidade → ele vira o
-- responsável (e fica no histórico) — e o agendamento liga como sempre.
create or replace function public.ortho_appointment_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_m public.ortho_maintenances;
  v_c public.ortho_cases;
  v_date date;
  v_name text;
begin
  begin
    select * into v_m from public.ortho_maintenances where appointment_id = new.id;

    if v_m.id is null then
      if new.status::text = 'cancelled' then return null; end if;
      if new.type::text not in ('treatment_session','treatment_start','return_visit') then
        return null;
      end if;
      if new.provider_user_id is null then return null; end if;
      select * into v_c from public.ortho_cases c
       where c.client_id = new.client_id
         and c.status in ('aguardando_inicio','em_tratamento','contencao')
       order by c.created_at desc limit 1;
      if v_c.id is null then return null; end if;

      -- Q3: ninguém escolheu o ortodontista ainda → quem instala assume.
      if v_c.orthodontist_id is null
         and new.type::text in ('treatment_start','treatment_session')
         and v_c.status in ('aguardando_inicio','em_tratamento')
         and exists (select 1 from public.user_clinic_roles r
                      where r.user_id = new.provider_user_id and r.clinic_id = v_c.clinic_id
                        and r.role in ('dentist','clinical_coordinator')) then
        update public.ortho_cases set orthodontist_id = new.provider_user_id where id = v_c.id;
        v_c.orthodontist_id := new.provider_user_id;
        select full_name into v_name from public.profiles where id = new.provider_user_id;
        perform public._ortho_log(v_c.id, 'ortodontista_definido',
          'Ortodontista responsável assumido do agendamento de instalação: ' || coalesce(v_name, '—'));
      end if;

      if v_c.orthodontist_id is distinct from new.provider_user_id then
        return null;
      end if;
      v_date := (new.starts_at at time zone 'America/Sao_Paulo')::date;

      select * into v_m from public.ortho_maintenances m
       where m.case_id = v_c.id and m.status = 'prevista' and m.appointment_id is null
         and m.planned_date is not null and abs(m.planned_date - v_date) <= 45
       order by abs(m.planned_date - v_date), m.seq limit 1;

      if v_m.id is null then
        insert into public.ortho_maintenances
          (case_id, clinic_id, client_id, seq, planned_date, status, appointment_id)
        values (v_c.id, v_c.clinic_id, v_c.client_id,
                coalesce((select max(seq) from public.ortho_maintenances where case_id = v_c.id), 0) + 1,
                v_date, 'agendada', new.id)
        returning * into v_m;
      else
        update public.ortho_maintenances
           set appointment_id = new.id, status = 'agendada', updated_at = now()
         where id = v_m.id;
      end if;
    end if;

    if new.status::text = 'completed' then
      perform public._ortho_complete_maintenance(v_m.id, coalesce(new.done_at, new.starts_at), new.provider_user_id);
    elsif new.status::text = 'no_show' then
      update public.ortho_maintenances set status = 'faltou', updated_at = now()
       where id = v_m.id and status <> 'realizada';
      perform public.ortho_plan_maintenances(v_m.case_id);
    elsif new.status::text = 'cancelled' then
      update public.ortho_maintenances
         set status = case when status = 'agendada' then 'prevista' else status end,
             appointment_id = null, updated_at = now()
       where id = v_m.id and status in ('agendada','faltou');
    elsif v_m.status in ('prevista','faltou') then
      update public.ortho_maintenances set status = 'agendada', updated_at = now()
       where id = v_m.id;
    end if;
  exception when others then
    raise warning 'ortho_appointment_sync (% em %): %', tg_op, new.id, sqlerrm;
  end;
  return null;
end;
$$;
revoke execute on function public.ortho_appointment_sync() from public, anon, authenticated;

drop trigger if exists appointments_ortho_sync on public.appointments;
create trigger appointments_ortho_sync
  after insert or update of status, provider_user_id, starts_at, type on public.appointments
  for each row execute function public.ortho_appointment_sync();

-- -----------------------------------------------------------------------------
-- 5) O CASO ABERTO A PARTIR DA VENDA HERDA A PROPOSTA (o que a tela não mandar)
-- -----------------------------------------------------------------------------
create or replace function public.ortho_create_case(
  p_client_id uuid,
  p_orthodontist_id uuid,
  p_treatment_kind text,
  p_start_date date,
  p_planned_months integer,
  p_interval_days integer,
  p_monthly_fee_cents integer,
  p_billing_day integer,
  p_installation_fee_cents integer default 0,
  p_maintenance_procedure_id uuid default null,
  p_negotiation_id uuid default null,
  p_notes text default null,
  p_start_now boolean default false,
  p_retainer_charged boolean default null,
  p_retainer_fee_cents integer default null,
  p_retainer_terms text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic uuid;
  v_id uuid;
  v_status text := 'aguardando_inicio';
  v_s record;
  v_plan uuid;
  v_option uuid;
  v_p record;
begin
  select clinic_id into v_clinic from public.clients where id = p_client_id;
  if v_clinic is null then raise exception 'CLIENT_NOT_FOUND'; end if;
  if not public.ortho_can_manage(v_clinic) then raise exception 'NOT_ALLOWED'; end if;
  if exists (select 1 from public.ortho_cases
              where client_id = p_client_id
                and status in ('aguardando_inicio','em_tratamento','contencao')) then
    raise exception 'CASE_ALREADY_OPEN';
  end if;
  if p_start_now and p_start_date is not null and p_start_date <= public.today_br() then
    v_status := 'em_tratamento';
  end if;

  select * into v_s from public.ortho_effective_settings(v_clinic);
  if p_negotiation_id is not null then
    select plan_id, option_id into v_plan, v_option from public.plan_negotiations where id = p_negotiation_id;
    if v_option is not null then
      select * into v_p from public.treatment_plan_ortho where option_id = v_option;
    end if;
  end if;

  insert into public.ortho_cases
    (clinic_id, client_id, orthodontist_id, treatment_kind, status, start_date,
     planned_months, maintenance_interval_days, next_reevaluation_date,
     maintenance_procedure_id, plan_id, negotiation_id, notes, created_by)
  values
    (v_clinic, p_client_id, p_orthodontist_id,
     coalesce(p_treatment_kind, v_p.treatment_kind, 'aparelho_fixo'),
     v_status, p_start_date,
     coalesce(p_planned_months, v_p.planned_months, 24),
     coalesce(p_interval_days, v_p.maintenance_interval_days, 30),
     case when p_start_date is not null
          then (p_start_date + make_interval(months => coalesce(v_s.reevaluation_interval_months, 6)))::date end,
     p_maintenance_procedure_id, v_plan, p_negotiation_id, nullif(btrim(p_notes), ''),
     (select auth.uid()))
  returning id into v_id;

  -- O dinheiro do caso: na irmã, só para quem vê dinheiro (R13, 0332).
  insert into public.ortho_case_terms
    (case_id, clinic_id, monthly_fee_cents, billing_day, installation_fee_cents,
     retainer_charged, retainer_fee_cents, retainer_terms, updated_by)
  values
    (v_id, v_clinic,
     coalesce(p_monthly_fee_cents, 0), coalesce(p_billing_day, 10),
     coalesce(p_installation_fee_cents, 0),
     coalesce(p_retainer_charged, v_s.retainer_charge_enabled, false),
     coalesce(p_retainer_fee_cents, v_s.retainer_fee_cents, 0),
     coalesce(nullif(btrim(p_retainer_terms), ''), v_s.retainer_terms),
     (select auth.uid()))
  on conflict (case_id) do update set
    monthly_fee_cents = excluded.monthly_fee_cents,
    billing_day = excluded.billing_day,
    installation_fee_cents = excluded.installation_fee_cents,
    retainer_charged = excluded.retainer_charged,
    retainer_fee_cents = excluded.retainer_fee_cents,
    retainer_terms = excluded.retainer_terms,
    updated_by = excluded.updated_by;

  perform public._ortho_log(v_id, 'caso_aberto',
    'Caso aberto' || case when v_status = 'em_tratamento' then ' — tratamento iniciado' else '' end
    || case when v_p.option_id is not null then ' — características da proposta ortodôntica do plano' else '' end);
  if v_status = 'em_tratamento' then
    perform public.ortho_plan_maintenances(v_id);
  end if;
  return v_id;
end;
$$;
revoke execute on function public.ortho_create_case(uuid, uuid, text, date, integer, integer, integer, integer, integer, uuid, uuid, text, boolean, boolean, integer, text) from public, anon, authenticated;
grant execute on function public.ortho_create_case(uuid, uuid, text, date, integer, integer, integer, integer, integer, uuid, uuid, text, boolean, boolean, integer, text) to authenticated;

-- Tabela nova entra na auditoria de alterações (0288).
select public.audit_attach_all();

-- -----------------------------------------------------------------------------
-- Conferência (só contagens — nenhum dado pessoal)
-- -----------------------------------------------------------------------------
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'clinical_evaluations'
      and column_name in ('ortho_indicated','ortho_indication_note','ortho_indicated_by','ortho_indicated_at')) as indicacao_na_avaliacao,
  (select count(*) from information_schema.tables
    where table_schema = 'public' and table_name = 'treatment_plan_ortho') as proposta_no_plano,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('set_evaluation_ortho_indication','save_plan_option_ortho','delete_plan_option_ortho')) as funcoes_novas,
  (select count(*) from pg_constraint where conname = 'treatment_plan_ortho_option_id_fkey') as ligacao_da_opcao,
  (select count(*) from pg_trigger where tgname = 'appointments_ortho_sync') as gatilho_da_agenda,
  (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
    where c.relname = 'treatment_plan_ortho' and t.tgname like 'audit%') as auditoria_na_proposta;
-- Esperado: 4 · 1 · 3 · 1 · 1 · 1

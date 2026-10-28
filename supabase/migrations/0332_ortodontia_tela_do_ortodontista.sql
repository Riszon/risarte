-- =============================================================================
-- 0332 — ORTODONTIA (ORTO6): A TELA DO ORTODONTISTA
--
-- Pedido do dono em 28/10/2026 (docs/ortodontia/ORTO-PLANO.md §5, regras
-- R11, R12, R13 e decisão Q8):
--   * R13: o ortodontista NÃO VÊ VALORES (mensalidade nem nada pago pelo
--     paciente). Até aqui a barreira era só a tela: `ortho_cases` carregava a
--     mensalidade e `ortho_charges` era legível por toda a equipe da unidade.
--     Agora o dinheiro do caso vive numa tabela irmã, `ortho_case_terms`, com
--     regra de linha só para quem vê dinheiro — e as cobranças idem. O
--     dentista não consegue ler valor nem pela API.
--   * Q8: o Coordenador Clínico VÊ os valores (não dá baixa — O2 segue:
--     Gerente e Financeiro).
--   * R11: a evolução registrada pelo ortodontista vai TAMBÉM para o
--     Desenvolvimento Clínico (`clinical_progress_notes`), respeitando a
--     tranca da 0315: anotação trancada ganha ADENDO, nunca muda.
--   * R12 (alertas da anamnese e atalhos na ficha) é só tela.
--
-- Idempotente. Assinaturas das funções NÃO mudam (create or replace).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) QUEM VÊ DINHEIRO: Admin, rede, Financeiro da Franqueadora, Gerente,
--    Coordenador (Q8), Recepção e Franqueado (O2: veem sem dar baixa).
-- -----------------------------------------------------------------------------
create or replace function public.ortho_can_see_money(p_clinic_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin_master()
      or public.is_network_viewer()
      or exists (
           select 1
           from public.user_clinic_roles ucr
           join public.clinics c on c.id = ucr.clinic_id
           where ucr.user_id = (select auth.uid())
             and c.type = 'franchisor'
             and ucr.role = 'finance_franchisor')
      or public.has_role_in_clinic(p_clinic_id,
           array['unit_manager','clinical_coordinator','receptionist','franchisee']::public.user_role[]);
$$;
revoke execute on function public.ortho_can_see_money(uuid) from public, anon, authenticated;
grant execute on function public.ortho_can_see_money(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 2) AS CONDIÇÕES FINANCEIRAS DO CASO saem de `ortho_cases` para a irmã
-- -----------------------------------------------------------------------------
create table if not exists public.ortho_case_terms (
  case_id uuid primary key,
  clinic_id uuid not null references public.clinics (id),
  monthly_fee_cents integer not null default 0 check (monthly_fee_cents >= 0),
  billing_day integer not null default 10 check (billing_day between 1 and 28),
  installation_fee_cents integer not null default 0 check (installation_fee_cents >= 0),
  retainer_charged boolean not null default false,
  retainer_fee_cents integer not null default 0 check (retainer_fee_cents >= 0),
  retainer_terms text,
  updated_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- A ligação com nome fixo: o app embute `terms:ortho_case_terms!ortho_case_terms_case_id_fkey`.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ortho_case_terms_case_id_fkey') then
    alter table public.ortho_case_terms
      add constraint ortho_case_terms_case_id_fkey
      foreign key (case_id) references public.ortho_cases (id) on delete cascade;
  end if;
end $$;
create index if not exists ortho_case_terms_clinic_idx on public.ortho_case_terms (clinic_id);

alter table public.ortho_case_terms enable row level security;
drop policy if exists "ortho_case_terms_select" on public.ortho_case_terms;
create policy "ortho_case_terms_select" on public.ortho_case_terms
  for select to authenticated using (public.ortho_can_see_money(clinic_id));
-- Gravar: só pelas funções (security definer). Direto, só o Admin.
drop policy if exists "ortho_case_terms_write" on public.ortho_case_terms;
create policy "ortho_case_terms_write" on public.ortho_case_terms
  for all to authenticated
  using (public.is_admin_master()) with check (public.is_admin_master());

-- Copia o que já existe (só enquanto as colunas antigas ainda estão lá — na
-- segunda rodada elas já se foram e este bloco não faz nada).
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'ortho_cases'
                and column_name = 'monthly_fee_cents') then
    execute $q$
      insert into public.ortho_case_terms
        (case_id, clinic_id, monthly_fee_cents, billing_day, installation_fee_cents,
         retainer_charged, retainer_fee_cents, retainer_terms, updated_by)
      select c.id, c.clinic_id, c.monthly_fee_cents, c.billing_day, c.installation_fee_cents,
             c.retainer_charged, c.retainer_fee_cents, c.retainer_terms, c.created_by
        from public.ortho_cases c
      on conflict (case_id) do nothing
    $q$;
  end if;
end $$;
-- Caso sem condições (não deveria existir): ganha a linha com os padrões.
insert into public.ortho_case_terms (case_id, clinic_id)
select c.id, c.clinic_id from public.ortho_cases c
 where not exists (select 1 from public.ortho_case_terms t where t.case_id = c.id);

alter table public.ortho_cases drop column if exists monthly_fee_cents;
alter table public.ortho_cases drop column if exists billing_day;
alter table public.ortho_cases drop column if exists installation_fee_cents;
alter table public.ortho_cases drop column if exists retainer_charged;
alter table public.ortho_cases drop column if exists retainer_fee_cents;
alter table public.ortho_cases drop column if exists retainer_terms;

-- A hora da alteração, como nas outras tabelas da ortodontia.
create or replace function public.ortho_case_terms_touch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function public.ortho_case_terms_touch() from public, anon, authenticated;
drop trigger if exists ortho_case_terms_touch on public.ortho_case_terms;
create trigger ortho_case_terms_touch
  before update on public.ortho_case_terms
  for each row execute function public.ortho_case_terms_touch();

-- -----------------------------------------------------------------------------
-- 3) AS COBRANÇAS E A CONFIGURAÇÃO: leitura só para quem vê dinheiro
-- -----------------------------------------------------------------------------
drop policy if exists "ortho_charges_select" on public.ortho_charges;
create policy "ortho_charges_select" on public.ortho_charges
  for select to authenticated using (public.ortho_can_see_money(clinic_id));

-- A configuração (valores padrão) era lida por qualquer logado. Passa a ser
-- lida por quem gere ou vê dinheiro em alguma unidade (a tela Configuração é
-- do Admin e do Gerente; as outras telas usam a função `ortho_effective_settings`).
drop policy if exists "ortho_settings_select" on public.ortho_settings;
create policy "ortho_settings_select" on public.ortho_settings
  for select to authenticated
  using (
    public.is_admin_master()
    or public.is_network_viewer()
    or exists (
         select 1 from public.user_clinic_roles ucr
          where ucr.user_id = (select auth.uid())
            and ucr.role in ('unit_manager','clinical_coordinator','receptionist',
                             'franchisee','finance_franchisor'))
  );

-- Marcar atrasadas: só quem dá baixa (era "quem vê o módulo").
create or replace function public.ortho_refresh_delinquency(p_clinic_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
begin
  if not (public.is_admin_master()
          or (p_clinic_id is not null and public.ortho_can_settle(p_clinic_id))) then
    raise exception 'NOT_ALLOWED';
  end if;
  update public.ortho_charges set status = 'atrasada', updated_at = now()
   where status = 'em_aberto' and due_date < public.today_br()
     and (p_clinic_id is null or clinic_id = p_clinic_id);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke execute on function public.ortho_refresh_delinquency(uuid) from public, anon, authenticated;
grant execute on function public.ortho_refresh_delinquency(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 4) AS FUNÇÕES QUE LIAM/GRAVAVAM O DINHEIRO DO CASO (mesmas assinaturas)
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
    select plan_id into v_plan from public.plan_negotiations where id = p_negotiation_id;
  end if;

  insert into public.ortho_cases
    (clinic_id, client_id, orthodontist_id, treatment_kind, status, start_date,
     planned_months, maintenance_interval_days, next_reevaluation_date,
     maintenance_procedure_id, plan_id, negotiation_id, notes, created_by)
  values
    (v_clinic, p_client_id, p_orthodontist_id, coalesce(p_treatment_kind, 'aparelho_fixo'),
     v_status, p_start_date,
     coalesce(p_planned_months, 24), coalesce(p_interval_days, 30),
     case when p_start_date is not null
          then (p_start_date + make_interval(months => coalesce(v_s.reevaluation_interval_months, 6)))::date end,
     p_maintenance_procedure_id, v_plan, p_negotiation_id, nullif(btrim(p_notes), ''),
     (select auth.uid()))
  returning id into v_id;

  -- O dinheiro do caso: na irmã, só para quem vê dinheiro (R13).
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
    'Caso aberto' || case when v_status = 'em_tratamento' then ' — tratamento iniciado' else '' end);
  if v_status = 'em_tratamento' then
    perform public.ortho_plan_maintenances(v_id);
  end if;
  return v_id;
end;
$$;
revoke execute on function public.ortho_create_case(uuid, uuid, text, date, integer, integer, integer, integer, integer, uuid, uuid, text, boolean, boolean, integer, text) from public, anon, authenticated;
grant execute on function public.ortho_create_case(uuid, uuid, text, date, integer, integer, integer, integer, integer, uuid, uuid, text, boolean, boolean, integer, text) to authenticated;

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

  perform public._ortho_log(p_case_id, 'caso_editado', 'Dados do caso alterados');
end;
$$;
revoke execute on function public.ortho_update_case(uuid, uuid, text, date, integer, integer, integer, integer, integer, uuid, date, text, boolean, integer, text) from public, anon, authenticated;
grant execute on function public.ortho_update_case(uuid, uuid, text, date, integer, integer, integer, integer, integer, uuid, date, text, boolean, integer, text) to authenticated;

-- ACHADO NO ENSAIO (defeito da 0329): concluir a manutenção de um caso SEM
-- procedimento de manutenção (nem no caso, nem na configuração) quebrava com
-- `record "v_rate" is not assigned yet` — e, como a agenda chama esta função ao
-- concluir o atendimento, concluir o atendimento também quebrava. Agora sem
-- procedimento o repasse nasce com ZERO (a regra da O5), como já dizia o comentário.
create or replace function public._ortho_complete_maintenance(
  p_maintenance_id uuid,
  p_done_at timestamptz,
  p_done_by uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_m public.ortho_maintenances;
  v_c public.ortho_cases;
  v_provider uuid;
  v_proc uuid;
  v_proc_name text;
  v_when date;
  v_amount integer := 0;
  v_rate_id uuid := null;
  v_payout uuid;
begin
  select * into v_m from public.ortho_maintenances where id = p_maintenance_id;
  if v_m.id is null then return; end if;
  select * into v_c from public.ortho_cases where id = v_m.case_id;

  v_provider := coalesce(p_done_by, v_m.done_by, v_c.orthodontist_id);
  v_when := coalesce((coalesce(p_done_at, v_m.done_at, now()) at time zone 'America/Sao_Paulo')::date, public.today_br());

  update public.ortho_maintenances set
    status = 'realizada',
    done_at = coalesce(p_done_at, done_at, now()),
    done_by = v_provider,
    updated_at = now()
  where id = p_maintenance_id;

  -- O procedimento que define o valor: o do caso, senão o da configuração.
  v_proc := coalesce(
    v_c.maintenance_procedure_id,
    (select s.maintenance_procedure_id from public.ortho_effective_settings(v_c.clinic_id) s));
  select p.name into v_proc_name from public.procedures p where p.id = v_proc;

  if v_provider is not null then
    if v_proc is not null then
      select r.amount_cents, r.rate_id into v_amount, v_rate_id
        from public.payout_rate_for(v_proc, v_provider, v_c.clinic_id, v_when) r;
    end if;
    -- Sem tabela (ou sem procedimento): registra ZERO em vez de não registrar
    -- (a mesma regra do repasse por sessão) — silêncio aqui viraria
    -- ortodontista recebendo a menos.
    insert into public.provider_payouts
      (clinic_id, provider_id, ortho_maintenance_id, procedure_id, procedure_name,
       accrual_date, amount_cents, rate_id)
    values
      (v_c.clinic_id, v_provider, p_maintenance_id, v_proc,
       coalesce(v_proc_name, 'Manutenção ortodôntica'),
       v_when, coalesce(v_amount, 0), v_rate_id)
    on conflict (ortho_maintenance_id) where ortho_maintenance_id is not null do nothing;

    select id into v_payout from public.provider_payouts where ortho_maintenance_id = p_maintenance_id;
    update public.ortho_maintenances set payout_id = v_payout where id = p_maintenance_id;
  end if;

  if v_m.status <> 'realizada' then
    perform public._ortho_log(v_m.case_id, 'manutencao_realizada',
      'Manutenção ' || v_m.seq || ' realizada em ' || to_char(v_when, 'DD/MM/YYYY'));
  end if;
end;
$$;
revoke execute on function public._ortho_complete_maintenance(uuid, timestamptz, uuid) from public, anon, authenticated;

-- Gerar as mensalidades do mês: a mensalidade vem da irmã.
create or replace function public.ortho_generate_charges(
  p_month date default null,
  p_clinic_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_month date := date_trunc('month', coalesce(p_month, public.today_br()))::date;
  v_count integer := 0;
begin
  if not (public.is_admin_master()
          or (p_clinic_id is not null and public.ortho_can_settle(p_clinic_id))) then
    raise exception 'NOT_ALLOWED';
  end if;

  insert into public.ortho_charges
    (case_id, clinic_id, client_id, kind, reference_month, due_date, amount_cents, status, created_by)
  select
    c.id, c.clinic_id, c.client_id, 'mensalidade', v_month,
    (v_month + (t.billing_day - 1)),
    t.monthly_fee_cents, 'em_aberto', (select auth.uid())
  from public.ortho_cases c
  join public.ortho_case_terms t on t.case_id = c.id
  where c.status = 'em_tratamento'
    and t.monthly_fee_cents > 0
    and (c.start_date is null or date_trunc('month', c.start_date)::date <= v_month)
    and (p_clinic_id is null or c.clinic_id = p_clinic_id)
  on conflict (case_id, reference_month, kind) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke execute on function public.ortho_generate_charges(date, uuid) from public, anon, authenticated;
grant execute on function public.ortho_generate_charges(date, uuid) to authenticated;

-- Entregar as contenções: a contenção combinada vem da irmã; o histórico do
-- caso (que o dentista lê) deixa de carregar o valor.
create or replace function public.ortho_deliver_retainers(
  p_case_id uuid,
  p_date date default null,
  p_charge boolean default null,
  p_amount_cents integer default null,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_c public.ortho_cases;
  v_t public.ortho_case_terms;
  v_date date := coalesce(p_date, public.today_br());
  v_charge boolean;
  v_amount integer;
  v_reeval integer;
begin
  select * into v_c from public.ortho_cases where id = p_case_id;
  if v_c.id is null then raise exception 'NOT_FOUND'; end if;
  if not public.ortho_can_manage(v_c.clinic_id) then raise exception 'NOT_ALLOWED'; end if;
  if v_c.status <> 'em_tratamento' then raise exception 'INVALID_TRANSITION'; end if;

  insert into public.ortho_case_terms (case_id, clinic_id) values (p_case_id, v_c.clinic_id)
  on conflict (case_id) do nothing;
  select * into v_t from public.ortho_case_terms where case_id = p_case_id;

  v_charge := coalesce(p_charge, v_t.retainer_charged, false);
  v_amount := greatest(0, coalesce(p_amount_cents, v_t.retainer_fee_cents, 0));
  select s.reevaluation_interval_months into v_reeval
    from public.ortho_effective_settings(v_c.clinic_id) s;

  update public.ortho_cases set
    status = 'contencao',
    finished_at = v_date,
    retainer_delivered_at = v_date,
    discharged_at = null,
    finish_reason = nullif(btrim(p_reason), ''),
    -- O primeiro controle da contenção: daqui a um intervalo de reavaliação.
    next_reevaluation_date = (v_date + make_interval(months => coalesce(v_reeval, 6)))::date
  where id = p_case_id;

  update public.ortho_case_terms set
    retainer_charged = v_charge,
    retainer_fee_cents = case when v_charge then v_amount else retainer_fee_cents end,
    updated_by = (select auth.uid())
  where case_id = p_case_id;

  -- O cronograma ativo acaba; a mensalidade dos meses seguintes sai (O1).
  update public.ortho_maintenances set status = 'cancelada', updated_at = now()
   where case_id = p_case_id and status = 'prevista' and appointment_id is null;
  update public.ortho_charges set status = 'cancelada', updated_at = now()
   where case_id = p_case_id and kind = 'mensalidade'
     and status in ('em_aberto','atrasada')
     and reference_month > date_trunc('month', v_date)::date;

  -- A contenção cobrada: uma cobrança própria, vencendo na entrega.
  if v_charge and v_amount > 0 then
    insert into public.ortho_charges
      (case_id, clinic_id, client_id, kind, reference_month, due_date, amount_cents, status, notes, created_by)
    values
      (p_case_id, v_c.clinic_id, v_c.client_id, 'contencao',
       date_trunc('month', v_date)::date, v_date, v_amount, 'em_aberto',
       nullif(btrim(v_t.retainer_terms), ''), (select auth.uid()))
    on conflict (case_id, reference_month, kind) do nothing;
  end if;

  perform public._ortho_log(p_case_id, 'contencoes_entregues',
    'Contenções entregues em ' || to_char(v_date, 'DD/MM/YYYY')
    || ' — tratamento finalizado; segue em acompanhamento'
    || case when v_charge and v_amount > 0 then ' (contenção cobrada)' else '' end
    || coalesce(' — ' || nullif(btrim(p_reason), ''), ''));
end;
$$;
revoke execute on function public.ortho_deliver_retainers(uuid, date, boolean, integer, text) from public, anon, authenticated;
grant execute on function public.ortho_deliver_retainers(uuid, date, boolean, integer, text) to authenticated;

-- O histórico já gravado pela 0331 carregava o valor da contenção: sai.
update public.ortho_events
   set description = regexp_replace(description, ' \(contenção cobrada: R\$ [^)]*\)', ' (contenção cobrada)')
 where event_type = 'contencoes_entregues'
   and description like '%contenção cobrada: R$%';

-- -----------------------------------------------------------------------------
-- 5) R11 — A EVOLUÇÃO VAI TAMBÉM PARA O DESENVOLVIMENTO CLÍNICO
-- -----------------------------------------------------------------------------
alter table public.clinical_progress_notes
  add column if not exists ortho_maintenance_id uuid
    references public.ortho_maintenances (id) on delete set null;
create index if not exists clinical_progress_notes_ortho_idx
  on public.clinical_progress_notes (ortho_maintenance_id) where ortho_maintenance_id is not null;

-- Espelha a evolução da manutenção numa anotação do Desenvolvimento Clínico.
-- Regras (0315): a anotação aberta é atualizada; a trancada ganha ADENDO; se o
-- atendimento da manutenção já tem a anotação de quem atendeu, a evolução
-- entra como adendo dela (uma anotação por atendimento). Nada se apaga.
-- Interna: só `ortho_save_evolution` chama.
create or replace function public._ortho_mirror_evolution(p_maintenance_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_m public.ortho_maintenances;
  v_c public.ortho_cases;
  v_user uuid := (select auth.uid());
  v_body text;
  v_note record;
  v_appt_note uuid;
  v_root uuid;
begin
  select * into v_m from public.ortho_maintenances where id = p_maintenance_id;
  if v_m.id is null then return; end if;
  select * into v_c from public.ortho_cases where id = v_m.case_id;
  if v_c.id is null then return; end if;
  -- Nada registrado ainda: nada a espelhar.
  if v_m.arch_wire is null and v_m.notes is null and v_m.next_steps is null
     and v_m.status <> 'realizada' then
    return;
  end if;
  v_user := coalesce(v_user, v_c.orthodontist_id);
  if v_user is null then return; end if;

  v_body := 'Ortodontia — manutenção ' || v_m.seq
    || case when v_m.status = 'realizada' and v_m.done_at is not null
            then ' realizada em ' || to_char(v_m.done_at at time zone 'America/Sao_Paulo', 'DD/MM/YYYY')
            else '' end
    || coalesce(E'\nFio/arco: ' || v_m.arch_wire, '')
    || coalesce(E'\nObservações: ' || v_m.notes, '')
    || coalesce(E'\nPróximo passo: ' || v_m.next_steps, '');

  -- A anotação desta manutenção (a original ou o último adendo).
  select n.id, n.body, n.appointment_id, n.created_at, n.addendum_of
    into v_note
    from public.clinical_progress_notes n
   where n.ortho_maintenance_id = p_maintenance_id
   order by n.created_at desc
   limit 1;

  if v_note.id is not null then
    if v_note.body = v_body then return; end if;
    if not public._progress_note_locked(v_note.addendum_of, v_note.appointment_id, v_note.created_at) then
      update public.clinical_progress_notes
         set body = v_body, updated_at = now()
       where id = v_note.id;
    else
      v_root := coalesce(v_note.addendum_of, v_note.id);
      insert into public.clinical_progress_notes
        (client_id, clinic_id, author_id, appointment_id, body, addendum_of, addendum_reason, ortho_maintenance_id)
      values
        (v_c.client_id, v_c.clinic_id, v_user, null, v_body, v_root,
         'Evolução ortodôntica atualizada depois de a anotação trancar', p_maintenance_id);
    end if;
    return;
  end if;

  -- Primeira vez: o atendimento já tem a anotação de quem atendeu?
  v_appt_note := null;
  if v_m.appointment_id is not null then
    select n.id into v_appt_note
      from public.clinical_progress_notes n
     where n.appointment_id = v_m.appointment_id and n.addendum_of is null
     limit 1;
  end if;

  if v_appt_note is not null then
    insert into public.clinical_progress_notes
      (client_id, clinic_id, author_id, appointment_id, body, addendum_of, addendum_reason, ortho_maintenance_id)
    values
      (v_c.client_id, v_c.clinic_id, v_user, null, v_body, v_appt_note,
       'Evolução ortodôntica da manutenção ' || v_m.seq, p_maintenance_id);
  else
    insert into public.clinical_progress_notes
      (client_id, clinic_id, author_id, appointment_id, body, ortho_maintenance_id)
    values
      (v_c.client_id, v_c.clinic_id, v_user, v_m.appointment_id, v_body, p_maintenance_id);
  end if;
end;
$$;
revoke execute on function public._ortho_mirror_evolution(uuid) from public, anon, authenticated;

-- Salva a evolução (mesma assinatura da 0329) e espelha no prontuário.
create or replace function public.ortho_save_evolution(
  p_maintenance_id uuid,
  p_done boolean,
  p_done_at timestamptz,
  p_arch_wire text,
  p_notes text,
  p_next_steps text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_m public.ortho_maintenances;
  v_c public.ortho_cases;
  v_user uuid := (select auth.uid());
  v_by uuid;
begin
  select * into v_m from public.ortho_maintenances where id = p_maintenance_id;
  if v_m.id is null then raise exception 'NOT_FOUND'; end if;
  if not public.ortho_can_evolve(v_m.case_id) then raise exception 'NOT_ALLOWED'; end if;
  if v_m.status = 'cancelada' then raise exception 'MAINTENANCE_CANCELLED'; end if;
  select * into v_c from public.ortho_cases where id = v_m.case_id;

  update public.ortho_maintenances set
    arch_wire = nullif(btrim(p_arch_wire), ''),
    notes = nullif(btrim(p_notes), ''),
    next_steps = nullif(btrim(p_next_steps), ''),
    updated_at = now()
  where id = p_maintenance_id;

  if p_done and v_m.status <> 'realizada' then
    -- Quem fez: o dentista logado quando é ele; senão o ortodontista do caso.
    v_by := case when public.has_role_in_clinic(v_c.clinic_id, array['dentist']::public.user_role[])
                 then v_user else v_c.orthodontist_id end;
    perform public._ortho_complete_maintenance(p_maintenance_id, coalesce(p_done_at, now()), v_by);
  elsif not p_done and v_m.status = 'realizada' then
    -- Desfazer: só quem gere, e só se o repasse ainda não foi fechado.
    if not public.ortho_can_manage(v_c.clinic_id) then raise exception 'NOT_ALLOWED'; end if;
    if exists (select 1 from public.provider_payouts p
                where p.ortho_maintenance_id = p_maintenance_id and p.closing_id is not null) then
      raise exception 'PAYOUT_CLOSED';
    end if;
    delete from public.provider_payouts where ortho_maintenance_id = p_maintenance_id;
    update public.ortho_maintenances set
      status = case when appointment_id is not null then 'agendada' else 'prevista' end,
      done_at = null, done_by = null, payout_id = null, updated_at = now()
    where id = p_maintenance_id;
    perform public._ortho_log(v_m.case_id, 'manutencao_desfeita',
      'Manutenção ' || v_m.seq || ' voltou a não realizada');
  end if;

  -- R11: a evolução vai também para o Desenvolvimento Clínico.
  perform public._ortho_mirror_evolution(p_maintenance_id);
end;
$$;
revoke execute on function public.ortho_save_evolution(uuid, boolean, timestamptz, text, text, text) from public, anon, authenticated;
grant execute on function public.ortho_save_evolution(uuid, boolean, timestamptz, text, text, text) to authenticated;

-- Tabela nova entra na auditoria de alterações (0288).
select public.audit_attach_all();

-- -----------------------------------------------------------------------------
-- Conferência (só contagens — nenhum dado pessoal)
-- -----------------------------------------------------------------------------
select
  (select count(*) from information_schema.tables
    where table_schema = 'public' and table_name = 'ortho_case_terms') as tabela_irma,
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'ortho_cases'
      and column_name in ('monthly_fee_cents','billing_day','installation_fee_cents',
                          'retainer_charged','retainer_fee_cents','retainer_terms')) as dinheiro_no_caso,
  (select count(*) from public.ortho_cases c
    where not exists (select 1 from public.ortho_case_terms t where t.case_id = c.id)) as casos_sem_condicoes,
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'ortho_charges' and policyname = 'ortho_charges_select'
      and qual like '%ortho_can_see_money%') as cobranca_so_quem_ve_dinheiro,
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'clinical_progress_notes'
      and column_name = 'ortho_maintenance_id') as elo_no_prontuario,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = '_ortho_mirror_evolution') as funcao_espelho,
  (select count(*) from public.ortho_events
    where event_type = 'contencoes_entregues' and description like '%R$%') as historico_com_valor;
-- Esperado: 1 · 0 · 0 · 1 · 1 · 1 · 0

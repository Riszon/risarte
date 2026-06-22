-- =============================================================================
-- Risarte Odontologia — Migration 0035 (Etapa 5.1 — Centro de Planejamento)
-- Estrutura do plano de tratamento criado pelo Dentista Planner na Fase 3:
--   - treatment_plans         : um plano por cliente (diagnóstico + status)
--   - treatment_plan_options  : plano principal + alternativos
-- O pilar de tratamento continua em clients.methodology_pillar (set_treatment_pillar).
-- O orçamento por tabela de preços chega na Etapa 5.2; aprovar/reprovar na 5.3.
-- submit_treatment_plan(): o Planner envia para aprovação → define o sub-status
-- 'Aguardando Aprovação do Planejamento' e notifica o Coordenador da unidade.
-- Idempotente.
-- =============================================================================

do $$ begin
  if not exists (select 1 from pg_type where typname = 'treatment_plan_status') then
    create type public.treatment_plan_status as enum
      ('draft', 'submitted', 'approved', 'returned');
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Plano de tratamento. clinic_id = unidade do cliente (quem aprova é o
-- Coordenador daquela unidade; o Planner enxerga via is_planner()).
-- -----------------------------------------------------------------------------
create table if not exists public.treatment_plans (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  clinic_id uuid not null references public.clinics (id),
  status public.treatment_plan_status not null default 'draft',
  diagnosis text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  submitted_at timestamptz,
  reviewed_by uuid references public.profiles (id),
  reviewed_at timestamptz,
  review_notes text
);
create index if not exists treatment_plans_client_idx
  on public.treatment_plans (client_id);
alter table public.treatment_plans enable row level security;

-- -----------------------------------------------------------------------------
-- Opções do plano (principal + alternativos). clinic_id denormalizado para a
-- RLS ser autossuficiente (sem subconsulta cruzada → sem risco de recursão).
-- -----------------------------------------------------------------------------
create table if not exists public.treatment_plan_options (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.treatment_plans (id) on delete cascade,
  clinic_id uuid not null references public.clinics (id),
  is_primary boolean not null default false,
  title text not null,
  description text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists treatment_plan_options_plan_idx
  on public.treatment_plan_options (plan_id);
alter table public.treatment_plan_options enable row level security;

-- -----------------------------------------------------------------------------
-- RLS. Leitura: membros da unidade (escopo da Franqueadora incluso) + Planner +
-- Admin. Escrita do conteúdo: Planner (com acesso à unidade) + Admin. A revisão
-- (aprovar/reprovar) do Coordenador entra na Etapa 5.3 — por isso o UPDATE de
-- treatment_plans já admite o Coordenador da unidade.
-- -----------------------------------------------------------------------------
drop policy if exists "treatment_plans_select" on public.treatment_plans;
create policy "treatment_plans_select" on public.treatment_plans
  for select to authenticated
  using (
    public.is_admin_master()
    or clinic_id in (select public.user_full_access_clinic_ids())
    or public.is_planner()
  );

drop policy if exists "treatment_plans_insert" on public.treatment_plans;
create policy "treatment_plans_insert" on public.treatment_plans
  for insert to authenticated
  with check (
    public.is_admin_master()
    or (public.is_planner() and clinic_id in (select public.user_full_access_clinic_ids()))
  );

drop policy if exists "treatment_plans_update" on public.treatment_plans;
create policy "treatment_plans_update" on public.treatment_plans
  for update to authenticated
  using (
    public.is_admin_master()
    or public.is_planner()
    or public.has_role_in_clinic(clinic_id, array['clinical_coordinator']::public.user_role[])
  );

drop policy if exists "treatment_plans_delete" on public.treatment_plans;
create policy "treatment_plans_delete" on public.treatment_plans
  for delete to authenticated
  using (public.is_admin_master() or public.is_planner());

drop policy if exists "treatment_plan_options_select" on public.treatment_plan_options;
create policy "treatment_plan_options_select" on public.treatment_plan_options
  for select to authenticated
  using (
    public.is_admin_master()
    or clinic_id in (select public.user_full_access_clinic_ids())
    or public.is_planner()
  );

drop policy if exists "treatment_plan_options_insert" on public.treatment_plan_options;
create policy "treatment_plan_options_insert" on public.treatment_plan_options
  for insert to authenticated
  with check (
    public.is_admin_master()
    or (public.is_planner() and clinic_id in (select public.user_full_access_clinic_ids()))
  );

drop policy if exists "treatment_plan_options_update" on public.treatment_plan_options;
create policy "treatment_plan_options_update" on public.treatment_plan_options
  for update to authenticated
  using (public.is_admin_master() or public.is_planner());

drop policy if exists "treatment_plan_options_delete" on public.treatment_plan_options;
create policy "treatment_plan_options_delete" on public.treatment_plan_options
  for delete to authenticated
  using (public.is_admin_master() or public.is_planner());

-- -----------------------------------------------------------------------------
-- submit_treatment_plan: o Planner envia o plano para aprovação do Coordenador.
-- Exige diagnóstico e ao menos uma opção; o cliente precisa estar na Fase 3.
-- Define o sub-status 'awaiting_plan_approval' e notifica o Coordenador.
-- -----------------------------------------------------------------------------
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
  v_user uuid := (select auth.uid());
begin
  select tp.client_id, tp.clinic_id, tp.diagnosis
    into v_client, v_clinic, v_diagnosis
  from public.treatment_plans tp where tp.id = p_plan_id;
  if v_client is null then raise exception 'PLAN_NOT_FOUND'; end if;

  if not (public.is_admin_master() or public.is_planner()) then
    raise exception 'NOT_ALLOWED';
  end if;

  select journey_phase, full_name into v_phase, v_name
  from public.clients where id = v_client;
  if v_phase <> 'planning_center' then raise exception 'WRONG_PHASE'; end if;

  if coalesce(btrim(v_diagnosis), '') = '' then
    raise exception 'DIAGNOSIS_REQUIRED';
  end if;

  select count(*) into v_options
  from public.treatment_plan_options where plan_id = p_plan_id;
  if v_options = 0 then raise exception 'OPTIONS_REQUIRED'; end if;

  update public.treatment_plans
    set status = 'submitted', submitted_at = now(), updated_at = now()
  where id = p_plan_id;

  -- Sub-status dirigido pela ação (substitui o "Definir status" manual).
  update public.clients
    set journey_status = 'awaiting_plan_approval'
  where id = v_client;

  -- Notifica o(s) Coordenador(es) Clínico(s) da unidade para aprovar.
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

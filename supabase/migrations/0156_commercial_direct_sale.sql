-- =============================================================================
-- Risarte Odontologia — Migration 0156 (Módulo Comercial — COM5: Venda direta)
--
-- 1) Detalhe de "Perdido"/"Cancelado": grava data e AUTOR (outcome_at/by) ao
--    marcar o cartão — para aparecer na lista de detalhes.
-- 2) Venda direta na unidade (fluxo excepcional): urgência/consulta avulsa/
--    limpeza etc. Lista CONFIGURÁVEL de procedimentos "vendáveis" direto na
--    clínica (procedures.direct_sale). A Recepção fecha (pagamento), o
--    Coordenador lança (procedimento), o Gerente faz os dois. Nada trava.
--    Tudo registrado (entra nos números do comercial).
-- Idempotente.
-- =============================================================================

-- 1) Autor/data do encerramento do cartão --------------------------------------
alter table public.commercial_cards
  add column if not exists outcome_at timestamptz;
alter table public.commercial_cards
  add column if not exists outcome_by uuid references public.profiles (id);

create or replace function public.commercial_set_stage(
  p_client_id uuid,
  p_stage text,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic uuid;
  v_card uuid;
  v_user uuid := (select auth.uid());
  v_desc text;
begin
  select clinic_id into v_clinic from public.clients where id = p_client_id;
  if v_clinic is null then raise exception 'CLIENT_NOT_FOUND'; end if;
  if not public.commercial_is_team(v_clinic) then raise exception 'NOT_ALLOWED'; end if;
  if p_stage not in ('a_apresentar','acontecendo_agora','apresentado','follow_up','cancelado','perdido') then
    raise exception 'INVALID_STAGE';
  end if;
  if p_stage in ('cancelado','perdido') and coalesce(btrim(p_reason), '') = '' then
    raise exception 'REASON_REQUIRED';
  end if;

  v_card := public.commercial_ensure_card(p_client_id);
  update public.commercial_cards set
    stage = p_stage,
    outcome_reason = case when p_stage in ('cancelado','perdido') then btrim(p_reason) else outcome_reason end,
    outcome_at = case when p_stage in ('cancelado','perdido') then now() else outcome_at end,
    outcome_by = case when p_stage in ('cancelado','perdido') then v_user else outcome_by end,
    presenting_since = case when p_stage = 'acontecendo_agora' then now() else null end,
    followup_by_clinic = case when p_stage = 'follow_up' then followup_by_clinic else false end,
    updated_by = v_user,
    updated_at = now()
  where id = v_card;

  v_desc := case p_stage
    when 'acontecendo_agora' then 'Apresentação iniciada'
    when 'apresentado' then 'Marcado como apresentado'
    when 'follow_up' then 'Follow-up (funil)'
    when 'a_apresentar' then 'Voltou para "A apresentar"'
    when 'cancelado' then 'Cancelado — ' || coalesce(btrim(p_reason), '')
    when 'perdido' then 'Perdido — ' || coalesce(btrim(p_reason), '')
    else p_stage
  end;
  perform public.commercial_log_card_event(v_card, p_client_id, v_clinic, p_stage, v_desc);

  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values (v_user, v_clinic, 'update', 'commercial_card', p_client_id::text,
    jsonb_build_object('stage', p_stage));
end;
$$;

-- 2) Lista configurável de procedimentos vendáveis direto na clínica -----------
alter table public.procedures
  add column if not exists direct_sale boolean not null default false;

-- 3) Venda direta na unidade ---------------------------------------------------
create table if not exists public.direct_sales (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id),
  client_id uuid references public.clients (id),
  client_name text,
  procedure_id uuid references public.procedures (id),
  description text not null,
  value_cents integer not null default 0,
  payment_method text
    check (payment_method is null or payment_method in
      ('pix','boleto','cartao','cartao_parcelado','credito_recorrente','deposito_avista')),
  paid boolean not null default false,
  paid_by uuid references public.profiles (id),
  paid_at timestamptz,
  launched boolean not null default false,
  launched_by uuid references public.profiles (id),
  launched_at timestamptz,
  cancelled boolean not null default false,
  notes text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists direct_sales_clinic_idx
  on public.direct_sales (clinic_id, created_at);

alter table public.direct_sales enable row level security;

-- Leitura: gestão/rede + equipe da unidade + comercial com escopo.
drop policy if exists "direct_sales_select" on public.direct_sales;
create policy "direct_sales_select" on public.direct_sales
  for select to authenticated
  using (
    public.is_admin_master()
    or clinic_id in (select public.user_full_access_clinic_ids())
    or public.is_network_viewer()
    or public.has_role_in_clinic(clinic_id,
         array['unit_manager','franchisee','clinical_coordinator','receptionist']::public.user_role[])
    or exists (select 1 from public.providers_with_access(clinic_id, 'commercial_consultant') p
               where p.user_id = (select auth.uid()))
    or exists (select 1 from public.providers_with_access(clinic_id, 'commercial_assistant') p
               where p.user_id = (select auth.uid()))
  );

-- Escrita: Recepção, Coordenador Clínico, Gerente da unidade (ou Admin).
-- A ausência de um papel não trava — qualquer um dos três pode registrar/marcar.
drop policy if exists "direct_sales_write" on public.direct_sales;
create policy "direct_sales_write" on public.direct_sales
  for all to authenticated
  using (
    public.is_admin_master()
    or public.has_role_in_clinic(clinic_id,
         array['receptionist','clinical_coordinator','unit_manager']::public.user_role[])
  )
  with check (
    public.is_admin_master()
    or public.has_role_in_clinic(clinic_id,
         array['receptionist','clinical_coordinator','unit_manager']::public.user_role[])
  );

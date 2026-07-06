-- =============================================================================
-- 0069 — Informações complementares ao Centro de Planejamento (LOTE H3: H3.11)
-- -----------------------------------------------------------------------------
-- Depois de enviar o cliente ao Centro de Planejamento, o Coordenador pode
-- mandar mais informações/observações ao Dentista Planner. Ao enviar, o Planner
-- é notificado; no Centro de Planejamento aparece um ícone "nova informação"
-- no cliente enquanto o Planner não abrir o caso (cockpit) para ver.
-- Idempotente.
-- =============================================================================

create table if not exists public.planning_supplements (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  clinic_id uuid not null references public.clinics (id),
  body text not null,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  seen_at timestamptz,
  seen_by uuid references public.profiles (id)
);
create index if not exists planning_supplements_client_idx
  on public.planning_supplements (client_id, created_at);

alter table public.planning_supplements enable row level security;

-- Leitura: Planner (rede), Admin, e a equipe clínica/gestão da unidade.
drop policy if exists "planning_supplements_select" on public.planning_supplements;
create policy "planning_supplements_select" on public.planning_supplements
  for select to authenticated
  using (
    public.is_admin_master()
    or public.is_planner()
    or clinic_id in (select public.user_full_access_clinic_ids())
    or public.has_role_in_clinic(
      clinic_id,
      array['clinical_coordinator', 'unit_manager']::public.user_role[]
    )
  );

-- -----------------------------------------------------------------------------
-- add_planning_supplement: registra a informação e notifica o(s) Planner(s).
-- -----------------------------------------------------------------------------
create or replace function public.add_planning_supplement(
  p_client_id uuid,
  p_body text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic uuid;
  v_name text;
  v_user uuid := (select auth.uid());
begin
  if p_body is null or btrim(p_body) = '' then
    raise exception 'EMPTY_BODY';
  end if;

  select clinic_id, full_name into v_clinic, v_name
  from public.clients where id = p_client_id;
  if v_clinic is null then raise exception 'CLIENT_NOT_FOUND'; end if;

  if not (
    public.is_admin_master()
    or public.has_role_in_clinic(
      v_clinic, array['clinical_coordinator']::public.user_role[]
    )
  ) then
    raise exception 'NOT_ALLOWED';
  end if;

  insert into public.planning_supplements (client_id, clinic_id, body, created_by)
  values (p_client_id, v_clinic, btrim(p_body), v_user);

  -- Notifica os Dentistas Planner (veem a fila da rede).
  insert into public.notifications (user_id, clinic_id, title, body, link)
  select ucr.user_id, v_clinic,
         'Nova informação do Coordenador',
         'Chegou informação complementar sobre ' || coalesce(v_name, 'um cliente')
           || ' no Centro de Planejamento.',
         '/planejamento/' || p_client_id
  from public.user_clinic_roles ucr
  where ucr.role = 'planner_dentist'
    and ucr.user_id is distinct from v_user;
end;
$$;

grant execute on function public.add_planning_supplement(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- mark_planning_supplements_seen: o Planner (ou Admin) marca as informações do
-- cliente como vistas — limpa o ícone no Centro de Planejamento.
-- -----------------------------------------------------------------------------
create or replace function public.mark_planning_supplements_seen(p_client_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if not (public.is_admin_master() or public.is_planner()) then
    return;
  end if;
  update public.planning_supplements
  set seen_at = now(), seen_by = v_user
  where client_id = p_client_id and seen_at is null;
end;
$$;

grant execute on function public.mark_planning_supplements_seen(uuid) to authenticated;

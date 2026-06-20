-- =============================================================================
-- Risarte Odontologia — Migration 0033 (LOTE E — E7, base do compartilhamento)
-- Cliente atendido em mais de uma unidade SIMULTANEAMENTE, de forma temporária,
-- SEM sair da unidade de origem (A). A unidade compartilhada (B) ganha acesso à
-- IDENTIDADE do cliente e pode agendar/atender; os registros de cada unidade
-- (agendamento, avaliação, futuro plano/financeiro) continuam separados pelo
-- clinic_id próprio, então NÃO se misturam. A trava de conflito (0029) já impede
-- agendamento simultâneo em duas unidades (mesmo cliente sobreposto).
-- Idempotente.
-- =============================================================================

create table if not exists public.client_shares (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  clinic_id uuid not null references public.clinics (id),  -- unidade B que ganha acesso
  reason text,
  shared_by uuid references public.profiles (id),
  started_at timestamptz not null default now(),
  ended_at timestamptz,                                    -- null = compartilhamento ativo
  notes text
);
create unique index if not exists client_shares_active_unique
  on public.client_shares (client_id, clinic_id) where ended_at is null;
create index if not exists client_shares_client_idx on public.client_shares (client_id);
alter table public.client_shares enable row level security;

-- Leem: Admin, a unidade B (destino) e a unidade A (origem do cliente).
drop policy if exists "client_shares_select" on public.client_shares;
create policy "client_shares_select" on public.client_shares
  for select to authenticated
  using (
    public.is_admin_master()
    or clinic_id in (select public.user_full_access_clinic_ids())
    or exists (
      select 1 from public.clients c
      where c.id = client_shares.client_id
        and c.clinic_id in (select public.user_full_access_clinic_ids())
    )
  );
-- Escrita só pelas funções definer abaixo.

-- -----------------------------------------------------------------------------
-- A unidade B passa a ENXERGAR o cliente compartilhado (identidade). Recria a
-- policy de leitura de clientes acrescentando o compartilhamento ativo.
-- -----------------------------------------------------------------------------
drop policy if exists "clients_select_member" on public.clients;
create policy "clients_select_member"
  on public.clients for select
  to authenticated
  using (
    public.is_admin_master()
    or clinic_id in (select public.user_full_access_clinic_ids())
    or preferred_clinic_id in (select public.user_full_access_clinic_ids())
    or public.user_has_client_history_access(id)
    or exists (
      select 1 from public.appointments a
      where a.client_id = clients.id
        and a.provider_user_id = (select auth.uid())
    )
    or exists (
      select 1 from public.client_shares s
      where s.client_id = clients.id
        and s.ended_at is null
        and s.clinic_id in (select public.user_full_access_clinic_ids())
    )
  );

-- -----------------------------------------------------------------------------
-- Compartilhar / encerrar (qualquer unidade A ou B pode iniciar: o usuário
-- precisa ter papel de equipe NA unidade de origem OU NA unidade de destino).
-- -----------------------------------------------------------------------------
create or replace function public.share_client_with_unit(
  p_client_id uuid,
  p_target_clinic_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_home uuid;
  v_name text;
  v_target_type public.clinic_type;
  v_user uuid := (select auth.uid());
begin
  select clinic_id, full_name into v_home, v_name
  from public.clients where id = p_client_id;
  if v_home is null then raise exception 'CLIENT_NOT_FOUND'; end if;

  select type into v_target_type from public.clinics where id = p_target_clinic_id;
  if v_target_type is distinct from 'franchise_unit' then
    raise exception 'TARGET_NOT_UNIT';
  end if;
  if p_target_clinic_id = v_home then raise exception 'SAME_CLINIC'; end if;

  if not (
    public.is_admin_master()
    or public.has_role_in_clinic(v_home, array['receptionist','clinical_coordinator','unit_manager']::public.user_role[])
    or public.has_role_in_clinic(p_target_clinic_id, array['receptionist','clinical_coordinator','unit_manager']::public.user_role[])
  ) then
    raise exception 'NOT_ALLOWED';
  end if;

  insert into public.client_shares (client_id, clinic_id, reason, shared_by)
  values (p_client_id, p_target_clinic_id, p_reason, v_user)
  on conflict (client_id, clinic_id) where ended_at is null do nothing;

  insert into public.notifications (user_id, clinic_id, title, body, link)
  select ucr.user_id, p_target_clinic_id,
         'Cliente compartilhado com sua unidade',
         v_name || ' foi compartilhado(a) temporariamente para atendimento.',
         '/clientes/' || p_client_id
  from public.user_clinic_roles ucr
  where ucr.clinic_id = p_target_clinic_id
    and ucr.role in ('receptionist','clinical_coordinator','unit_manager');

  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values (v_user, p_target_clinic_id, 'update', 'client_share', p_client_id::text,
          jsonb_build_object('from_clinic', v_home, 'to_clinic', p_target_clinic_id, 'reason', p_reason));
end;
$$;

create or replace function public.end_client_share(p_share_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_home uuid;
  v_target uuid;
  v_client uuid;
begin
  select s.clinic_id, s.client_id, c.clinic_id
    into v_target, v_client, v_home
  from public.client_shares s
  join public.clients c on c.id = s.client_id
  where s.id = p_share_id and s.ended_at is null;
  if v_client is null then raise exception 'SHARE_NOT_FOUND'; end if;

  if not (
    public.is_admin_master()
    or public.has_role_in_clinic(v_home, array['receptionist','clinical_coordinator','unit_manager']::public.user_role[])
    or public.has_role_in_clinic(v_target, array['receptionist','clinical_coordinator','unit_manager']::public.user_role[])
  ) then
    raise exception 'NOT_ALLOWED';
  end if;

  update public.client_shares set ended_at = now() where id = p_share_id;
end;
$$;

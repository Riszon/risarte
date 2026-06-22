-- =============================================================================
-- Risarte Odontologia — Migration 0038 (LOTE F — F2: compartilhamento)
-- Ao INICIAR e ao ENCERRAR o compartilhamento de um cliente, notificar os
-- usuários das DUAS unidades (A = origem do cliente e B = unidade compartilhada).
-- O histórico fica em client_shares (started_at/ended_at) — a ficha lista tudo.
-- Recria share_client_with_unit e end_client_share (create or replace).
-- Idempotente.
-- =============================================================================

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
  v_home_name text;
  v_target_name text;
  v_target_type public.clinic_type;
  v_user uuid := (select auth.uid());
begin
  select clinic_id, full_name into v_home, v_name
  from public.clients where id = p_client_id;
  if v_home is null then raise exception 'CLIENT_NOT_FOUND'; end if;

  select type, name into v_target_type, v_target_name
  from public.clinics where id = p_target_clinic_id;
  if v_target_type is distinct from 'franchise_unit' then
    raise exception 'TARGET_NOT_UNIT';
  end if;
  if p_target_clinic_id = v_home then raise exception 'SAME_CLINIC'; end if;

  select name into v_home_name from public.clinics where id = v_home;

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

  -- Unidade B (destino): passou a ter acesso ao cliente.
  insert into public.notifications (user_id, clinic_id, title, body, link)
  select ucr.user_id, p_target_clinic_id,
         'Cliente compartilhado com sua unidade',
         v_name || ' foi compartilhado(a) temporariamente pela unidade ' ||
           coalesce(v_home_name, 'de origem') || ' para atendimento.',
         '/clientes/' || p_client_id
  from public.user_clinic_roles ucr
  where ucr.clinic_id = p_target_clinic_id
    and ucr.role in ('receptionist','clinical_coordinator','unit_manager');

  -- Unidade A (origem): registro de que compartilhou.
  insert into public.notifications (user_id, clinic_id, title, body, link)
  select ucr.user_id, v_home,
         'Cliente compartilhado com outra unidade',
         v_name || ' foi compartilhado(a) com a unidade ' ||
           coalesce(v_target_name, 'destino') || '.',
         '/clientes/' || p_client_id
  from public.user_clinic_roles ucr
  where ucr.clinic_id = v_home
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
  v_name text;
  v_home_name text;
  v_target_name text;
  v_user uuid := (select auth.uid());
begin
  select s.clinic_id, s.client_id, c.clinic_id, c.full_name
    into v_target, v_client, v_home, v_name
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

  select name into v_home_name from public.clinics where id = v_home;
  select name into v_target_name from public.clinics where id = v_target;

  -- Unidade B (destino): perdeu o acesso.
  insert into public.notifications (user_id, clinic_id, title, body, link)
  select ucr.user_id, v_target,
         'Compartilhamento encerrado',
         v_name || ' não está mais compartilhado(a) com sua unidade.',
         '/clientes/' || v_client
  from public.user_clinic_roles ucr
  where ucr.clinic_id = v_target
    and ucr.role in ('receptionist','clinical_coordinator','unit_manager');

  -- Unidade A (origem): registro do encerramento.
  insert into public.notifications (user_id, clinic_id, title, body, link)
  select ucr.user_id, v_home,
         'Compartilhamento encerrado',
         v_name || ' deixou de ser compartilhado(a) com a unidade ' ||
           coalesce(v_target_name, 'destino') || '.',
         '/clientes/' || v_client
  from public.user_clinic_roles ucr
  where ucr.clinic_id = v_home
    and ucr.role in ('receptionist','clinical_coordinator','unit_manager');

  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values (v_user, v_target, 'update', 'client_share', v_client::text,
          jsonb_build_object('ended', true, 'from_clinic', v_home, 'to_clinic', v_target));
end;
$$;

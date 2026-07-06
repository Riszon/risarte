-- =============================================================================
-- 0074 — Pedir agendamento da apresentação comercial (Ajuste pré-Grupo 4 #4/AJ4)
-- -----------------------------------------------------------------------------
-- Na central de Planos, o caso "fase comercial SEM apresentação agendada" ganha
-- um botão "Pedir agendamento". Ele dispara esta função, que cria um aviso FORTE
-- para as recepcionistas da unidade (mesmo título "URGENTE: agendar apresentação
-- comercial" que o pop-up da recepção reconhece). Deduplica: não cria um segundo
-- aviso não lido para o mesmo cliente. Idempotente (create or replace).
-- =============================================================================

create or replace function public.request_commercial_scheduling(p_client_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic uuid;
  v_name text;
  v_requester text;
  v_uid uuid := (select auth.uid());
begin
  select clinic_id, full_name into v_clinic, v_name
  from public.clients where id = p_client_id;
  if v_clinic is null then return; end if;

  -- Quem pede precisa ter acesso à unidade do cliente (gestão/rede/planner).
  if not (
    public.is_admin_master()
    or v_clinic in (select public.user_full_access_clinic_ids())
    or exists (
      select 1 from public.user_clinic_roles ucr
      where ucr.clinic_id = v_clinic and ucr.user_id = v_uid
    )
  ) then
    raise exception 'NOT_ALLOWED';
  end if;

  select full_name into v_requester from public.profiles where id = v_uid;

  insert into public.notifications (user_id, clinic_id, title, body, link)
  select distinct ucr.user_id, v_clinic,
    'URGENTE: agendar apresentação comercial',
    coalesce(v_name, 'Cliente') || ' — agende a apresentação comercial.'
      || coalesce(' Pedido por ' || nullif(v_requester, '') || '.', ''),
    '/agenda?cliente=' || p_client_id
  from public.user_clinic_roles ucr
  where ucr.clinic_id = v_clinic
    and ucr.role = 'receptionist'
    and ucr.user_id <> v_uid
    and not exists (
      select 1 from public.notifications n
      where n.user_id = ucr.user_id
        and n.read_at is null
        and n.link = '/agenda?cliente=' || p_client_id
        and n.title like 'URGENTE%'
    );
end;
$$;

grant execute on function public.request_commercial_scheduling(uuid) to authenticated;

-- =============================================================================
-- 0107 — Solicitar agendamento à Recepção (H4.6 A3 — Módulo do Dentista)
-- -----------------------------------------------------------------------------
-- Na seção "Procedimentos" do prontuário, o Dentista vê o que está em aberto e
-- pode pedir para a Recepção agendar as sessões pendentes. Como a tabela
-- notifications não tem policy de insert entre usuários, a notificação é criada
-- por uma RPC SECURITY DEFINER. Deduplicada por dia. Idempotente.
-- =============================================================================

create or replace function public.request_session_scheduling(p_client_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic uuid;
  v_name text;
  v_requester text;
  v_pending int;
begin
  select clinic_id, full_name into v_clinic, v_name
  from public.clients where id = p_client_id;
  if v_clinic is null then raise exception 'CLIENT_NOT_FOUND'; end if;

  -- Só o Dentista (ou Admin) solicita o agendamento.
  if not (
    public.is_admin_master()
    or public.has_role_in_clinic(v_clinic, array['dentist']::public.user_role[])
  ) then
    raise exception 'NOT_ALLOWED';
  end if;

  -- Só faz sentido se houver sessão pendente ainda sem agendamento.
  select count(*) into v_pending
  from public.treatment_sessions ts
  where ts.client_id = p_client_id
    and ts.status = 'pending'
    and ts.appointment_id is null;
  if v_pending = 0 then return; end if;

  select full_name into v_requester
  from public.profiles where id = (select auth.uid());

  -- Notifica a Recepção da unidade (deduplicado por dia).
  insert into public.notifications (user_id, clinic_id, title, body, link)
  select ucr.user_id, v_clinic,
         'Agendar sessões: ' || v_name,
         coalesce(v_requester, 'O dentista') || ' solicitou o agendamento de '
           || v_pending || ' sessão(ões) pendente(s) de ' || v_name || '.',
         '/clientes/' || p_client_id
  from public.user_clinic_roles ucr
  where ucr.clinic_id = v_clinic and ucr.role = 'receptionist'
    and not exists (
      select 1 from public.notifications n
      where n.user_id = ucr.user_id
        and n.title = 'Agendar sessões: ' || v_name
        and n.created_at >= current_date
    );
end;
$$;

grant execute on function public.request_session_scheduling(uuid) to authenticated;

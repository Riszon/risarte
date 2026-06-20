-- =============================================================================
-- Risarte Odontologia — Migration 0034 (CORREÇÃO URGENTE da 0033)
-- A 0033 recriou clients_select_member com um `exists (... client_shares ...)`
-- inline. Como a policy de client_shares também referencia clients, criou-se
-- RECURSÃO INFINITA entre as duas policies → a consulta de clients falha e
-- NENHUM cliente aparece (lista, jornada, agenda). Correção: usar uma função
-- SECURITY DEFINER (que lê client_shares ignorando RLS), quebrando o ciclo.
-- Idempotente.
-- =============================================================================

create or replace function public.client_shared_with_user(p_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.client_shares s
    where s.client_id = p_client_id
      and s.ended_at is null
      and s.clinic_id in (select public.user_full_access_clinic_ids())
  );
$$;

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
    or public.client_shared_with_user(id)
  );

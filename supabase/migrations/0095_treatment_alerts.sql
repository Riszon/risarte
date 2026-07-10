-- =============================================================================
-- 0095 — Alertas e lembretes do tratamento (H4.5 Lote 5)
-- -----------------------------------------------------------------------------
-- Avisa a Recepção quando algo do tratamento precisa de atenção:
--  (1) SESSÃO ATRASADA — o cliente tem sessão pendente cuja data prevista já
--      passou e ninguém agendou.
--  (2) PLANO PARADO — cliente em tratamento com sessões pendentes, sem sessão
--      futura agendada e sem atividade (sessão) há mais de 30 dias.
-- É best-effort e roda em segundo plano quando a Recepção abre o sistema (como
-- os aniversariantes); os avisos são deduplicados por cliente/tipo/dia.
-- Selos "Atrasada/Em breve" na própria tela ficam no app (sem migração).
-- Idempotente.
-- =============================================================================

create or replace function public.notify_treatment_alerts(p_clinic_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if not (
    public.is_admin_master()
    or exists (
      select 1 from public.user_clinic_roles ucr
      where ucr.clinic_id = p_clinic_id and ucr.user_id = v_user
    )
  ) then
    return;
  end if;

  -- (1) Sessões atrasadas — um aviso por cliente (não por sessão).
  insert into public.notifications (user_id, clinic_id, title, body, link)
  select distinct ucr.user_id, p_clinic_id,
         'Sessão atrasada: ' || c.full_name,
         'Uma ou mais sessões previstas já passaram da data e ainda não foram '
           || 'agendadas. Reveja os agendamentos do cliente.',
         '/clientes/' || c.id
  from public.clients c
  join public.user_clinic_roles ucr
    on ucr.clinic_id = p_clinic_id and ucr.role = 'receptionist'
  where c.clinic_id = p_clinic_id
    and c.status = 'active'
    and exists (
      select 1 from public.treatment_sessions ts
      where ts.client_id = c.id
        and ts.status = 'pending'
        and ts.appointment_id is null
        and ts.planned_date is not null
        and ts.planned_date < current_date
    )
    and not exists (
      select 1 from public.notifications n
      where n.user_id = ucr.user_id
        and n.link = '/clientes/' || c.id
        and n.title like 'Sessão atrasada:%'
        and n.created_at >= current_date
    );

  -- (2) Plano parado — em tratamento, tem pendentes, sem próxima agendada e sem
  -- atividade (sessão de tratamento) há mais de 30 dias.
  insert into public.notifications (user_id, clinic_id, title, body, link)
  select distinct ucr.user_id, p_clinic_id,
         'Plano parado: ' || c.full_name,
         c.full_name || ' está em tratamento, mas não tem sessão feita há mais '
           || 'de 30 dias nem próxima agendada. Reveja os agendamentos.',
         '/clientes/' || c.id
  from public.clients c
  join public.user_clinic_roles ucr
    on ucr.clinic_id = p_clinic_id and ucr.role = 'receptionist'
  where c.clinic_id = p_clinic_id
    and c.status = 'active'
    and exists (
      select 1 from public.treatment_sessions ts
      where ts.client_id = c.id and ts.status = 'pending'
    )
    and not exists (
      select 1 from public.appointments a
      where a.client_id = c.id
        and a.type = 'treatment_session'
        and a.starts_at > now()
        and a.status in ('scheduled', 'confirmed')
    )
    and coalesce(
      (select max(a.starts_at) from public.appointments a
        where a.client_id = c.id and a.type = 'treatment_session'),
      c.phase_entered_at
    ) < now() - interval '30 days'
    and not exists (
      select 1 from public.notifications n
      where n.user_id = ucr.user_id
        and n.link = '/clientes/' || c.id
        and n.title like 'Plano parado:%'
        and n.created_at >= current_date
    );
end $$;

grant execute on function public.notify_treatment_alerts(uuid) to authenticated;

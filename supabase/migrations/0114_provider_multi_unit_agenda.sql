-- =============================================================================
-- 0114 — Agenda consolidada multi-unidade do dentista (H4.6 E3)
-- -----------------------------------------------------------------------------
-- O dentista que atende em várias unidades vê sua agenda consolidada (todas as
-- unidades numa só, cor por unidade). Como a RLS de appointments é por unidade,
-- usamos uma RPC SECURITY DEFINER que devolve SÓ os atendimentos do próprio
-- usuário (provider = auth.uid()) em todas as unidades, com o nome da unidade e
-- do paciente (que é paciente dele). Idempotente.
-- =============================================================================

create or replace function public.provider_multi_unit_agenda(
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  id uuid,
  clinic_id uuid,
  clinic_name text,
  starts_at timestamptz,
  ends_at timestamptz,
  type text,
  status text,
  attendance text,
  client_id uuid,
  client_name text
)
language sql
security definer
set search_path = ''
as $$
  select a.id, a.clinic_id, c.name, a.starts_at, a.ends_at,
         a.type::text, a.status::text, a.attendance::text,
         a.client_id, cl.full_name
  from public.appointments a
  join public.clinics c on c.id = a.clinic_id
  left join public.clients cl on cl.id = a.client_id
  where a.provider_user_id = (select auth.uid())
    and a.starts_at >= p_from
    and a.starts_at < p_to
    and a.status not in ('cancelled', 'no_show')
  order by a.starts_at;
$$;

grant execute on function public.provider_multi_unit_agenda(timestamptz, timestamptz)
  to authenticated;

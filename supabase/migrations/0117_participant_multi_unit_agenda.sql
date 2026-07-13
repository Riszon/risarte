-- =============================================================================
-- 0117 — Minha Agenda inclui os atendimentos conjuntos (H4.7 Bloco 2)
-- -----------------------------------------------------------------------------
-- A agenda consolidada do dentista passa a trazer TAMBÉM os atendimentos em que
-- ele entra como profissional ADICIONAL (appointment_participants), não só os
-- que ele é o responsável principal. Devolve o papel (principal/participante) e
-- se o atendimento é conjunto (tem adicionais). Muda a assinatura de saída, por
-- isso derruba a função antiga antes de recriar. Idempotente.
-- =============================================================================

drop function if exists public.provider_multi_unit_agenda(timestamptz, timestamptz);

create function public.provider_multi_unit_agenda(
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
  client_name text,
  role text,
  is_joint boolean
)
language sql
security definer
set search_path = ''
as $$
  select a.id, a.clinic_id, c.name, a.starts_at, a.ends_at,
         a.type::text, a.status::text, a.attendance::text,
         a.client_id, cl.full_name,
         case
           when a.provider_user_id = (select auth.uid()) then 'principal'
           else 'participante'
         end as role,
         exists (
           select 1 from public.appointment_participants ap2
           where ap2.appointment_id = a.id
         ) as is_joint
  from public.appointments a
  join public.clinics c on c.id = a.clinic_id
  left join public.clients cl on cl.id = a.client_id
  where a.starts_at >= p_from
    and a.starts_at < p_to
    and a.status not in ('cancelled', 'no_show')
    and (
      a.provider_user_id = (select auth.uid())
      or exists (
        select 1 from public.appointment_participants ap
        where ap.appointment_id = a.id
          and ap.provider_user_id = (select auth.uid())
      )
    )
  order by a.starts_at;
$$;

grant execute on function public.provider_multi_unit_agenda(timestamptz, timestamptz)
  to authenticated;

-- =============================================================================
-- 0338 — A SEQUÊNCIA CHEGA A QUEM DECIDE (OC-00006, OC-00007)
--
-- Causa confirmada na produção (30/10/2026): a 0337 liberou a leitura com
-- `has_role_in_clinic`, que só olha a própria unidade. O Consultor Comercial tem
-- o papel na Franqueadora, com escopo de unidades (o único da produção está lá):
-- a função devolvia vazio para ele, sem erro nenhum.
--
-- Decisões do dono (30/10/2026, todas como recomendado):
--   o Consultor vê os totais e a sequência; o Coordenador aprova com ela aberta;
--   o número da sequência vale em todas as telas, inclusive na apresentação.
--   O Gerente entra porque abre a apresentação. O Assistente comercial continua
--   fora (D8).
--
-- Idempotente.
-- =============================================================================

create or replace function public.project_option_sessions(p_option_id uuid)
returns table (
  item_id uuid, session_index int, procedure_name text, name text,
  planned_minutes int, group_no int, block_order int, provider_id uuid
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_clinic uuid;
  v_papeis public.user_role[] :=
    array['clinical_coordinator', 'commercial_consultant', 'unit_manager']::public.user_role[];
begin
  select c.clinic_id into v_clinic
  from public.treatment_plan_options o
  join public.treatment_plans tp on tp.id = o.plan_id
  join public.clients c on c.id = tp.client_id
  where o.id = p_option_id;
  if v_clinic is null then return; end if;

  if not (
    public.is_admin_master()
    or public.is_planner()
    or public.has_role_in_clinic(v_clinic, v_papeis)
    -- O papel na Franqueadora vale nas unidades do escopo da pessoa.
    or (
      v_clinic in (select public.user_full_access_clinic_ids())
      and exists (
        select 1
        from public.user_clinic_roles ucr
        join public.clinics fc on fc.id = ucr.clinic_id
        where ucr.user_id = (select auth.uid())
          and fc.type = 'franchisor'
          and ucr.role = any (v_papeis)
      )
    )
  ) then
    return;
  end if;

  return query
  select r.item_id, r.session_index, r.procedure_name, r.name,
         coalesce(psj.minutes_override, r.planned_minutes) as planned_minutes,
         psj.group_no,
         psj.block_order,
         coalesce(psj.provider_override, r.suggested_provider_id) as provider_id
  from public.option_session_rows(p_option_id, v_clinic) r
  left join public.plan_session_joins psj
    on psj.item_id = r.item_id and psj.session_index = r.session_index
  order by coalesce(psj.block_order, 9999), r.procedure_name, r.session_index;
end $$;
revoke execute on function public.project_option_sessions(uuid) from public, anon, authenticated;
grant execute on function public.project_option_sessions(uuid) to authenticated;

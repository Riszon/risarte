-- =============================================================================
-- 0307 — QUANTO CADA PROCEDIMENTO É USADO (pedido do dono, 19/10/2026)
--
-- A lista de Procedimentos ganhou, em cada procedimento, "em quantos planos
-- ele entrou nos últimos 90 dias" — para ajudar a decidir o que desativar e o
-- que completar primeiro.
--
-- Conta PLANOS distintos (um plano com o procedimento em duas opções conta
-- uma vez), pela data em que o item foi lançado no orçamento. Devolve só
-- números por procedimento — nenhum dado de paciente sai daqui.
--
-- Quem lê: quem enxerga o catálogo (Admin Master e Planner). Unidade
-- escolhida = só os planos dela; sem unidade = a rede toda.
-- Idempotente; não grava nada.
-- =============================================================================

create or replace function public.procedure_usage_counts(p_clinic_id uuid, p_days integer)
returns table (procedure_id uuid, plans integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then raise exception 'NOT_ALLOWED'; end if;
  if not (public.is_admin_master() or public.is_planner()) then raise exception 'NOT_ALLOWED'; end if;
  if coalesce(p_days, 0) < 1 or p_days > 3650 then raise exception 'INVALID_DAYS'; end if;

  return query
    select i.procedure_id, count(distinct o.plan_id)::integer
      from public.treatment_plan_option_items i
      join public.treatment_plan_options o on o.id = i.option_id
     where i.procedure_id is not null
       and i.created_at >= now() - make_interval(days => p_days)
       and (p_clinic_id is null or i.clinic_id = p_clinic_id)
     group by i.procedure_id;
end;
$$;

revoke execute on function public.procedure_usage_counts(uuid, integer) from public, anon, authenticated;
grant execute on function public.procedure_usage_counts(uuid, integer) to authenticated;

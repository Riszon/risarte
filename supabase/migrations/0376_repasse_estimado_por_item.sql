-- =============================================================================
-- 0376 — O REPASSE ESTIMADO DA OPÇÃO, ITEM A ITEM (AP81)
-- -----------------------------------------------------------------------------
-- O alerta de margem da negociação desconta do preço os itens que o cliente
-- TIROU (compra parcial), mas o repasse vinha de `estimated_option_payout`,
-- que soma TODOS os itens da opção. O repasse do que saiu continuava na conta
-- e a margem aparecia menor do que é.
--
-- Função nova, que devolve o repasse POR ITEM. A tela soma só os itens aceitos.
-- A conta de cada linha é a MESMA de `_estimated_option_payout_raw` (0210):
-- `payout_rate_for(procedimento, profissional sugerido, unidade, hoje)` ×
-- quantidade. A soma das linhas é igual ao total da função de sempre — a
-- conferência no fim prova isso em todas as opções do banco.
--
-- `estimated_option_payout` NÃO muda (continua existindo; a tela cai nela se
-- esta migração ainda não rodou).
-- Idempotente.
-- =============================================================================

create or replace function public.estimated_option_payout_by_item(p_option_id uuid, p_clinic_id uuid)
returns table (item_id uuid, payout_cents bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  -- A mesma guarda de unidade da porta `estimated_option_payout` (0282).
  if p_clinic_id is not null and not public.can_read_clinic_data(p_clinic_id) then
    raise exception 'NOT_ALLOWED';
  end if;
  return query
    select oi.id,
           (coalesce((select r.amount_cents from public.payout_rate_for(
              oi.procedure_id, oi.suggested_provider_id, p_clinic_id, public.today_br()) r), 0)
            * greatest(1, coalesce(oi.quantity, 1)))::bigint
      from public.treatment_plan_option_items oi
     where oi.option_id = p_option_id and oi.procedure_id is not null;
end;
$$;

revoke execute on function public.estimated_option_payout_by_item(uuid, uuid) from public, anon, authenticated;
grant execute on function public.estimated_option_payout_by_item(uuid, uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Conferência (só contagens)
-- -----------------------------------------------------------------------------
select
  has_function_privilege('anon', 'public.estimated_option_payout_by_item(uuid, uuid)', 'execute')
    as sem_login_executa_esperado_false,
  has_function_privilege('authenticated', 'public.estimated_option_payout_by_item(uuid, uuid)', 'execute')
    as logado_executa_esperado_true,
  (select count(*) from public.treatment_plan_options) as opcoes_no_banco;

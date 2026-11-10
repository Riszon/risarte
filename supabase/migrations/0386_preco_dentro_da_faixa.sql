-- =============================================================================
-- 0386 — O PREÇO DENTRO DA FAIXA DO PROCEDIMENTO (AP79)
--
-- DECISÃO DO DONO (10/11/2026): "travar os dois" — a venda direta passa a
-- recusar preço abaixo do MÍNIMO, e nada é cobrado acima do MÁXIMO.
--
-- O QUE ESTAVA ERRADO (lido no código):
--   • `procedures.min_price_cents` trava a negociação desde a 0327, mas a
--     VENDA DIRETA não conferia: o desconto manual podia levar qualquer
--     procedimento abaixo do mínimo;
--   • `max_price_cents` não era conferido em lugar nenhum.
--
-- ONDE O MÁXIMO PODE SER PASSADO, medido no código:
--   • na NEGOCIAÇÃO o acréscimo é recusado desde a 0205 (SURCHARGE_NOT_ALLOWED)
--     e o preço do item é o do catálogo (0306). Então o preço só passa do
--     máximo se o PREÇO DA UNIDADE (ou o padrão) estiver acima dele — e é aí
--     que a trava entra;
--   • na VENDA DIRETA existe o acréscimo do Gerente — trava na hora de gravar
--     as condições.
--
-- O QUE MUDA:
--   1) preço da unidade (e o agendado para a unidade) acima do máximo da rede
--      é recusado: PRICE_ABOVE_MAX;
--   2) preço padrão acima do máximo é recusado no cadastro;
--   3) `direct_sale_set_conditions` virou PORTA sobre
--      `_direct_sale_set_conditions_raw`: antes de gravar, confere cada
--      procedimento — cobrado abaixo do mínimo ou acima do máximo recusa
--      (PRICE_OUT_OF_RANGE). A conta das condições mora na crua.
--
-- AS REGRAS DA FAIXA (as mesmas da 0327, PM2):
--   • piso = o MENOR entre o mínimo e o preço do item (a unidade com preço
--     próprio abaixo do mínimo já decidiu aquele preço; só o desconto abaixo
--     dele é recusado);
--   • teto = o MAIOR entre o máximo e o preço do item (preço já gravado acima
--     do máximo, de antes desta trava, não trava a venda; só o acréscimo);
--   • o desconto e o acréscimo manuais se repartem pelos itens na proporção
--     do valor de cada um. O benefício do programa não conta.
--
-- ⚠️ As travas das tabelas valem SÓ para o que chega pela API (`security
-- invoker` + `current_user`, lição da 0306): o reajuste agendado aplicado pela
-- rotina da madrugada não é recusado (ele foi conferido ao ser agendado).
--
-- Nada é apagado. Preço já gravado fora da faixa não é mexido. Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) O preço da unidade não passa do máximo da rede
-- -----------------------------------------------------------------------------
create or replace function public.clinic_price_max_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_max integer;
begin
  if current_user <> 'authenticated' or new.clinic_id is null then
    return new;
  end if;
  select p.max_price_cents into v_max from public.procedures p where p.id = new.procedure_id;
  if v_max is not null and new.price_cents > v_max then
    raise exception 'PRICE_ABOVE_MAX:%', v_max;
  end if;
  return new;
end;
$$;
revoke execute on function public.clinic_price_max_guard() from public, anon, authenticated;

drop trigger if exists clinic_procedure_prices_max_guard on public.clinic_procedure_prices;
create trigger clinic_procedure_prices_max_guard
  before insert or update of price_cents on public.clinic_procedure_prices
  for each row execute function public.clinic_price_max_guard();

drop trigger if exists procedure_price_schedule_max_guard on public.procedure_price_schedule;
create trigger procedure_price_schedule_max_guard
  before insert or update of price_cents on public.procedure_price_schedule
  for each row execute function public.clinic_price_max_guard();

-- -----------------------------------------------------------------------------
-- 2) O preço padrão também não passa do máximo
-- -----------------------------------------------------------------------------
create or replace function public.procedure_default_price_max_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user <> 'authenticated' then
    return new;
  end if;
  if new.max_price_cents is not null and new.default_price_cents > new.max_price_cents then
    raise exception 'PRICE_ABOVE_MAX:%', new.max_price_cents;
  end if;
  return new;
end;
$$;
revoke execute on function public.procedure_default_price_max_guard() from public, anon, authenticated;

drop trigger if exists procedures_default_price_max_guard on public.procedures;
create trigger procedures_default_price_max_guard
  before insert or update of default_price_cents, max_price_cents on public.procedures
  for each row execute function public.procedure_default_price_max_guard();

-- -----------------------------------------------------------------------------
-- 3) A venda direta confere a faixa de cada procedimento
-- -----------------------------------------------------------------------------
-- A tela mostra a mensagem do banco (a lista sai já em português).
create or replace function public._direct_sale_price_violations(
  p_sale_id uuid,
  p_discount integer,
  p_surcharge integer
)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  with itens as (
    select p.id, p.name, p.min_price_cents, p.max_price_cents,
           i.quantity, i.unit_price_cents
      from public.direct_sale_items i
      join public.procedures p on p.id = i.procedure_id
     where i.sale_id = p_sale_id
  ),
  base as (
    select coalesce(sum(quantity * unit_price_cents), 0)::numeric as total from itens
  ),
  c as (
    select id, name,
           sum(quantity * unit_price_cents)::numeric
             + case when b.total > 0
                    then round((coalesce(p_surcharge, 0) - coalesce(p_discount, 0))::numeric
                               * sum(quantity * unit_price_cents) / b.total)
                    else 0 end as cobrado,
           case when bool_and(min_price_cents is not null)
                then sum(quantity * least(min_price_cents, unit_price_cents))::numeric end as piso,
           case when bool_and(max_price_cents is not null)
                then sum(quantity * greatest(max_price_cents, unit_price_cents))::numeric end as teto
      from itens, base b
     group by id, name, b.total
  )
  select coalesce(array_agg(m order by m), '{}'::text[])
    from (
      select format('%s abaixo do mínimo: %s (mínimo %s)',
                    name, public.brl(cobrado::bigint), public.brl(piso::bigint)) as m
        from c where piso is not null and cobrado < piso
      union all
      select format('%s acima do máximo: %s (máximo %s)',
                    name, public.brl(cobrado::bigint), public.brl(teto::bigint))
        from c where teto is not null and cobrado > teto
    ) x;
$$;
revoke execute on function public._direct_sale_price_violations(uuid, integer, integer) from public, anon, authenticated;

do $$
begin
  if to_regprocedure('public._direct_sale_set_conditions_raw(uuid, text, integer, integer, integer)') is null then
    alter function public.direct_sale_set_conditions(uuid, text, integer, integer, integer)
      rename to _direct_sale_set_conditions_raw;
  end if;
end $$;
revoke execute on function public._direct_sale_set_conditions_raw(uuid, text, integer, integer, integer) from public, anon, authenticated;

create or replace function public.direct_sale_set_conditions(
  p_sale_id uuid,
  p_payment_method text,
  p_installments integer,
  p_discount_cents integer,
  p_surcharge_cents integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic uuid;
  v_closed timestamptz;
  v_violations text[];
begin
  select clinic_id, closed_at into v_clinic, v_closed from public.direct_sales where id = p_sale_id;
  -- Quem não pode fechar a venda não fica sabendo dos preços dela: a crua
  -- responde NOT_FOUND / NOT_ALLOWED / ALREADY_CLOSED como sempre.
  if v_clinic is not null and v_closed is null and public.direct_sale_can_close(v_clinic) then
    v_violations := public._direct_sale_price_violations(p_sale_id, p_discount_cents, p_surcharge_cents);
    if array_length(v_violations, 1) > 0 then
      raise exception 'PRICE_OUT_OF_RANGE:%', array_to_string(v_violations, '; ');
    end if;
  end if;
  perform public._direct_sale_set_conditions_raw(
    p_sale_id, p_payment_method, p_installments, p_discount_cents, p_surcharge_cents);
end;
$$;
revoke execute on function public.direct_sale_set_conditions(uuid, text, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.direct_sale_set_conditions(uuid, text, integer, integer, integer) to authenticated;

-- CONFERÊNCIA (só leitura). Esperado: travas = 3, porta = true, crua_fechada =
-- true; os três últimos números dizem quantos preços JÁ gravados estão fora
-- da faixa (não são mexidos).
select
  (select count(*) from pg_trigger where tgname in (
     'clinic_procedure_prices_max_guard', 'procedure_price_schedule_max_guard',
     'procedures_default_price_max_guard')) as travas,
  position('_direct_sale_price_violations' in
    pg_get_functiondef('public.direct_sale_set_conditions(uuid, text, integer, integer, integer)'::regprocedure)) > 0 as porta,
  not has_function_privilege('authenticated',
    'public._direct_sale_set_conditions_raw(uuid, text, integer, integer, integer)'::regprocedure, 'execute') as crua_fechada,
  (select count(*) from public.procedures where max_price_cents is not null) as procedimentos_com_maximo,
  (select count(*) from public.procedures where max_price_cents is not null and default_price_cents > max_price_cents) as padrao_acima_do_maximo,
  (select count(*) from public.clinic_procedure_prices c join public.procedures p on p.id = c.procedure_id
    where p.max_price_cents is not null and c.price_cents > p.max_price_cents) as unidade_acima_do_maximo;

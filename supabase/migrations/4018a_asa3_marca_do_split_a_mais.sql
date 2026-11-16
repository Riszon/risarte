-- =============================================================================
-- 4018a — ASA3: a marca do "split a mais" (spec 20.17.9, aprovada em 16/11/2026)
-- -----------------------------------------------------------------------------
-- O defeito (achado no treino: R$ 90,76 marcados em 4 mensalidades): na
-- mensalidade do PPR+ e da Ortodontia (4018), o aviso do split liquidado chega
-- antes de as linhas de taxa nascerem. `_gateway_split_retention` conferia com
-- o devido = 0, marcava o valor INTEIRO recebido como "a mais" e avisava o
-- Financeiro; depois, com as linhas, nunca limpava a marca. O dinheiro (retido,
-- conta a pagar e razão) sempre esteve certo: a rede recebeu 1 centavo a menos.
--
-- A correção:
--   * sem linha de taxa ligada à cobrança, a conferência espera as linhas;
--   * a marca é sempre recalculada (o maior entre recebido − devido e zero);
--   * o aviso só sai quando o "a mais" passa da tolerância da Central (R$ 0,10);
--   * as marcas que já existem são recalculadas (só a marca; nada mais muda).
--
-- Só redefine uma função e recalcula uma coluna. Idempotente. Não apaga dado.
-- =============================================================================

CREATE OR REPLACE FUNCTION public._gateway_split_retention(p_charge_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  c public.charges%rowtype;
  v_tol bigint;
  v_short bigint := 0;
  s record;
  w record;
  v_new bigint;
  v_settled date;
  v_touched text[] := '{}';
  v_key text;
  v_frozen boolean;
  v_excess bigint;
begin
  select * into c from public.charges where id = p_charge_id;
  if not found or not c.split_applied then return; end if;
  if c.receipt_id is null and c.source_id is null then return; end if;
  select tolerance_cents into v_tol from public.gateway_split_settings where id;
  v_tol := coalesce(v_tol, 10);

  update public.split_charges set charge_id = c.id
   where ((c.receipt_id is not null and source_type = 'receipt' and source_id = c.receipt_id)
       or (c.source_id is not null and source_type = c.source_type and source_id = c.source_id))
     and charge_id is distinct from c.id;

  -- 4018a: sem linha de taxa ligada a esta cobrança, não há o que conferir. Na
  -- mensalidade (4018), o aviso do split liquidado chega ANTES da baixa que cria
  -- as linhas; conferir agora daria "devido = 0" e marcaria tudo como "a mais".
  if not exists (select 1 from public.split_charges where charge_id = c.id) then return; end if;

  for w in
    select cs.*,
           (select coalesce(sum(sc.amount_cents), 0) from public.split_charges sc
             where sc.charge_id = c.id and not sc.reversed and cs.fees ? sc.fee) as expected
      from public.charge_splits cs where cs.charge_id = c.id
  loop
    if w.status = 'liquidado' and w.settled_cents is not null then
      v_short := v_short + greatest(w.expected - w.settled_cents, 0);
      -- 4018a: a marca é sempre recalculada (limpa quando as linhas chegam), e o
      -- aviso só sai acima da tolerância da Central.
      v_excess := greatest(w.settled_cents - w.expected, 0);
      if w.excess_cents is distinct from v_excess then
        update public.charge_splits set excess_cents = v_excess, updated_at = now() where id = w.id;
      end if;
      if v_excess > v_tol and w.excess_cents is distinct from v_excess then
        perform public._gateway_notify(c.gateway_account_id, 'repasse_a_maior', w.id::text, c.clinic_id, false, true, true,
          'Split: repasse acima do devido',
          'Uma cobrança repassou à rede mais do que as taxas vigentes no dia do pagamento (provável mudança de taxa com a cobrança em aberto). Confira no Painel de repasses e decida entre abater ou dispensar.',
          '/prontuarios/' || c.client_id::text);
      end if;
    end if;
  end loop;
  -- 18.7.2: paga enquanto esperava a fila só por tarifa — a falta é absorvida.
  if c.split_absorb_tariff then v_short := 0; end if;

  for s in
    select sc.*, cs.status as w_status, cs.settled_cents as w_settled, cs.settled_at as w_settled_at,
           (select coalesce(sum(x.amount_cents), 0) from public.split_charges x
             where x.charge_id = c.id and not x.reversed and cs.fees ? x.fee) as w_expected
      from public.split_charges sc
      left join public.charge_splits cs on cs.charge_id = c.id and cs.fees ? sc.fee
     where sc.charge_id = c.id
  loop
    v_frozen := s.w_status = 'liquidado' and exists (
      select 1 from public.financial_entries f
       where f.source_type = 'split_retained' and f.source_id = s.id and f.status = 'settled');
    continue when v_frozen;
    v_new := case
      when s.reversed or s.w_status is null then 0
      when s.w_status in ('cancelado', 'recusado', 'estornado') then 0
      when s.w_status = 'liquidado' and s.w_settled is not null and v_short > v_tol and s.w_expected > 0
        then floor(s.amount_cents * least(s.w_settled, s.w_expected)::numeric / s.w_expected)::bigint
      else s.amount_cents
    end;
    v_settled := case when s.w_status = 'liquidado' then (s.w_settled_at at time zone 'America/Sao_Paulo')::date end;
    if v_new is distinct from s.retained_cents then
      update public.split_charges set retained_cents = v_new where id = s.id;
      v_key := s.fee || '|' || s.period_month::text;
      if not (v_key = any (v_touched)) then v_touched := v_touched || v_key; end if;
    end if;
    if v_new > 0 or exists (select 1 from public.financial_entries f where f.source_type = 'split_retained' and f.source_id = s.id) then
      perform public._gateway_split_ledger(s.id, v_settled);
    end if;
  end loop;

  foreach v_key in array v_touched loop
    perform public.refresh_network_fee_payable(c.clinic_id, split_part(v_key, '|', 1), split_part(v_key, '|', 2)::date);
  end loop;
end;
$function$;

-- As marcas que já existem: recalculadas pela mesma conta (só a coluna da marca).
update public.charge_splits cs
   set excess_cents = greatest(cs.settled_cents - d.devido, 0), updated_at = now()
  from (
    select x.id, (select coalesce(sum(sc.amount_cents), 0) from public.split_charges sc
                   where sc.charge_id = x.charge_id and not sc.reversed and x.fees ? sc.fee) as devido
      from public.charge_splits x
     where x.status = 'liquidado' and x.settled_cents is not null and x.excess_cents > 0
  ) d
 where d.id = cs.id
   and exists (select 1 from public.split_charges sc where sc.charge_id = cs.charge_id)
   and cs.excess_cents is distinct from greatest(cs.settled_cents - d.devido, 0);

revoke execute on function public._gateway_split_retention(uuid) from public, anon, authenticated;

notify pgrst, 'reload schema';

-- Conferência: a regra nova ligada e quantas marcas "a mais" sobraram.
select
  position('4018a' in pg_get_functiondef('public._gateway_split_retention(uuid)'::regprocedure)) > 0 as regra_nova,
  (select count(*) from public.charge_splits where status = 'liquidado' and excess_cents > 0) as marcas_a_mais,
  (select coalesce(sum(excess_cents), 0) from public.charge_splits where status = 'liquidado') as centavos_marcados;

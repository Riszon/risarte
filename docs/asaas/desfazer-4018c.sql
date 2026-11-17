-- DESFAZER a 4018c (só se precisar). Roda inteiro, de uma vez, no SQL Editor.
-- Tira o gatilho que roda a conferência do split quando a linha de taxa nasce, e volta
-- as duas leituras do Painel de repasses à versão anterior (sem as mensalidades).
-- Os lançamentos que a 4018c fez no razão FICAM: eles corrigem o razão (a despesa da
-- taxa retida na unidade e a receita na franqueadora).

drop trigger if exists split_charges_after_born on public.split_charges;
drop function if exists public._split_charges_after_born();

CREATE OR REPLACE FUNCTION public._franchise_payout_receipts(p_from date, p_to date, p_clinics uuid[], p_clinic uuid)
 RETURNS TABLE(receipt_id uuid, clinic_id uuid, received_at date, amount_cents bigint, category text, skip_reason text, due_cents bigint, retained_cents bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select r.id, r.clinic_id, r.received_at,
         case when coalesce(r.reversed, false) then 0 else r.amount_cents end,
         case
           when coalesce(r.reversed, false) then 'estornado'
           when r.reference like 'Asaas %' then
             case when ch.split_applied then 'split' else 'asaas_sem_split' end
           when r.payment_method = 'permuta' then 'permuta'
           when exists (select 1 from public.charges x
                         where x.payment_installment_id = r.installment_id
                           and x.is_external and x.status <> 'cancelada') then 'externa'
           when r.payment_method = 'dinheiro' then 'dinheiro'
           when r.payment_method in ('cartao', 'cartao_parcelado', 'credito_recorrente') then 'cartao'
           when r.payment_method in ('pix', 'deposito_avista') then 'deposito_pix'
           else 'externa'
         end,
         case when r.reference like 'Asaas %' and not coalesce(ch.split_applied, false)
              then coalesce(ch.split_skip_reason, 'antes_do_split') end,
         coalesce((select sum(sc.amount_cents) from public.split_charges sc
                    where sc.source_type = 'receipt' and sc.source_id = r.id and not sc.reversed), 0)::bigint,
         coalesce((select sum(sc.retained_cents) from public.split_charges sc
                    where sc.source_type = 'receipt' and sc.source_id = r.id and not sc.reversed), 0)::bigint
    from public.payment_receipts r
    left join lateral (
      select c.split_applied, c.split_skip_reason from public.charges c
       where r.reference like 'Asaas %' and c.asaas_payment_id = substr(r.reference, 7)
       limit 1
    ) ch on true
   where r.reversal_of is null
     and (not coalesce(r.reversed, false) or exists (
           select 1 from public.split_charges k
            where k.source_type = 'receipt' and k.source_id = r.id and not k.reversed))
     and r.received_at between p_from and p_to
     and (p_clinic is null or r.clinic_id = p_clinic)
     and (p_clinics is null or r.clinic_id = any (p_clinics));
$function$;
revoke execute on function public._franchise_payout_receipts(date, date, uuid[], uuid) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public._franchise_payout_charge_fees(p_from date, p_to date, p_clinics uuid[], p_clinic uuid)
 RETURNS TABLE(charge_id uuid, clinic_id uuid, client_id uuid, billing_type text, charge_status text, paid_on date, credit_date date, wallet_split_id uuid, wallet_label text, wallet_status text, fee text, due_cents bigint, retained_cents bigint, settled_cents bigint, settled_on date, charge_short_cents bigint, wallet_excess_cents bigint, situation text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with cfg as (
    select coalesce((select s.tolerance_cents from public.gateway_split_settings s where s.id), 10) as tol
  ), ch as (
    select c.* from public.charges c
     where c.split_applied and c.receipt_id is not null and c.paid_on is not null
       and (p_from is null or c.paid_on >= p_from)
       and (p_to is null or c.paid_on <= p_to)
       and (p_clinic is null or c.clinic_id = p_clinic)
       and (p_clinics is null or c.clinic_id = any (p_clinics))
  ), w as (
    select cs.id, cs.charge_id, cs.fees, cs.status, cs.settled_cents, cs.settled_at, cs.percentual_value,
           cs.excess_cents, ga.label,
           (select coalesce(sum(sc.amount_cents), 0) from public.split_charges sc
             where sc.charge_id = cs.charge_id and not sc.reversed and cs.fees ? sc.fee) as expected
      from public.charge_splits cs
      join ch on ch.id = cs.charge_id
      left join public.gateway_accounts ga on ga.id = cs.destination_account_id
  ), wc as (
    select w.charge_id,
           sum(case when w.status = 'liquidado' and w.settled_cents is not null
                    then greatest(w.expected - w.settled_cents, 0) else 0 end)::bigint as short,
           (ceil(sum(w.percentual_value) / 100 * 99) + count(*))::bigint as msg_cap
      from w group by w.charge_id
  ), f as (
    select sc.charge_id, sc.fee, sc.amount_cents, sc.retained_cents,
           w.id as wid, w.label, w.status as wstatus, w.settled_cents as wsettled, w.settled_at,
           w.expected, w.excess_cents,
           case when w.status = 'liquidado' and w.settled_cents is not null and w.expected > 0
                then floor(sc.amount_cents * w.settled_cents::numeric / w.expected)::bigint end as share,
           case when w.status = 'liquidado' and w.settled_cents is not null and w.expected > 0
                then sc.amount_cents * w.settled_cents::numeric / w.expected
                     - floor(sc.amount_cents * w.settled_cents::numeric / w.expected) end as frac
      from public.split_charges sc
      join w on w.charge_id = sc.charge_id and w.fees ? sc.fee
     where not sc.reversed
  ), f2 as (
    -- Maior resto: os centavos que sobram do arredondamento vão, um a um, para
    -- as taxas com a maior fração; nenhuma taxa recebe mais que 1 centavo extra.
    select f.*,
           f.wsettled - sum(f.share) over (partition by f.wid) as leftover,
           row_number() over (partition by f.wid order by f.frac desc nulls last, f.amount_cents desc, f.fee) as rn
      from f
  )
  select ch.id, ch.clinic_id, ch.client_id, ch.billing_type, ch.status,
         ch.paid_on, ch.credit_date, f2.wid, f2.label, f2.wstatus,
         f2.fee, f2.amount_cents, f2.retained_cents,
         case when f2.share is not null then f2.share + case when f2.rn <= coalesce(f2.leftover, 0) then 1 else 0 end end,
         (f2.settled_at at time zone 'America/Sao_Paulo')::date,
         wc.short, f2.excess_cents,
         case
           when ch.status = 'estornada' or f2.wstatus = 'estornado' then 'estornado'
           when f2.wstatus in ('enviado', 'bloqueado') then 'a_receber'
           when f2.wstatus in ('cancelado', 'recusado') then 'cancelado'
           when f2.wsettled is null then 'a_receber'
           when f2.wsettled > f2.expected then 'a_maior'
           when wc.short = 0 then 'ok'
           when wc.short <= cfg.tol then 'absorvida'
           when wc.short <= wc.msg_cap and exists (
                  select 1 from public.gateway_notification_units u
                   where u.clinic_id = ch.clinic_id and u.enabled) then 'mensageria'
           else 'conta_a_pagar'
         end
    from f2
    join ch on ch.id = f2.charge_id
    join wc on wc.charge_id = ch.id
    cross join cfg;
$function$;
revoke execute on function public._franchise_payout_charge_fees(date, date, uuid[], uuid) from public, anon, authenticated;

notify pgrst, 'reload schema';

select (select count(*) from pg_trigger where tgname = 'split_charges_after_born') as gatilho_restante;

-- =============================================================================
-- 4018c — ASA3: a linha de taxa que nasce retida passa pela conferência do split
-- (achado do ensaio da 4010 em 17/11/2026; aprovada pelo dono em 17/11/2026)
-- -----------------------------------------------------------------------------
-- A CAUSA (a terceira vez, nas mensalidades do PPR+ e da Ortodontia, 4018):
-- o aviso do split do Asaas pode chegar ANTES da baixa que cria as linhas de
-- taxa. A conferência do split (`_gateway_split_retention`) roda no aviso e,
-- na parcela comum, de novo quando o recebimento é ligado à cobrança
-- (`charges.receipt_id`). Na mensalidade a cobrança não liga recebimento (usa a
-- origem): depois que as linhas nascem, nada roda a conferência. A linha nasce
-- "retida" (gatilho da 4018), mas ficam sem fazer:
--   * o razão: a despesa da taxa na unidade e a receita na franqueadora;
--   * a retenção menor quando o Asaas repassou menos (a falta do split);
--   * a marca e o aviso de "split a mais" com as linhas presentes;
--   * a conta a pagar de taxa recalculada pela retenção certa.
--
-- A CORREÇÃO (na causa, para qualquer origem): toda vez que nascem linhas de
-- taxa ligadas a uma cobrança, a conferência do split roda para essa cobrança
-- no fim da transação, com todas as linhas da baixa presentes (gatilho
-- adiado). Assim a ordem dos avisos deixa de importar: aviso antes da baixa e
-- baixa antes do aviso dão o mesmo resultado.
--
-- AS LINHAS QUE JÁ EXISTEM: as retidas sem lançamento no razão passam pela
-- conferência (no treino, 16 linhas das provas de 15 e 16/11; na produção,
-- nenhuma unidade tem conta Asaas: deve dar 0). Linha de mês fechado não é
-- lançada aqui: continua contada em `linhas_sem_razao` e aparece na
-- Conferência das taxas (4021a, divergência "sem lançamento no razão").
--
-- AS LEITURAS QUE DEPENDIAM DE A LINHA EXISTIR NO AVISO (levantamento, spec 19.40):
-- o razão, a falta e a sobra do split e a conta a pagar (corrigidos pelo gatilho);
-- o Painel de repasses (corrigido aqui). A Conferência das taxas ganha a
-- divergência "sem lançamento no razão" na 4021a.
--
-- Cria um gatilho e uma função e redefine duas leituras do painel; sem tabela
-- temporária. Idempotente. Não apaga dado.
-- =============================================================================

create or replace function public._split_charges_after_born()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Roda no FIM da transação (gatilho adiado): todas as linhas daquela baixa já
  -- existem. Rodar a cada linha inserida conferiria um pedaço das linhas (a
  -- primeira congelaria e daria um "split a mais" falso, como na 4018a).
  if new.charge_id is not null and not new.reversed then
    perform public._gateway_split_retention(new.charge_id);
  end if;
  return null;
end;
$$;
revoke execute on function public._split_charges_after_born() from public, anon, authenticated;

drop trigger if exists split_charges_after_born on public.split_charges;
create constraint trigger split_charges_after_born
  after insert on public.split_charges
  deferrable initially deferred
  for each row execute function public._split_charges_after_born();

-- -----------------------------------------------------------------------------
-- O PAINEL DE REPASSES (4010) passa a ver as mensalidades. Ele foi feito sobre
-- os recebimentos das parcelas (antes da 4018) e não contava a mensalidade: nem
-- o recebido, nem o devido, nem o liquidado pelo split, nem o "a receber". As
-- mensalidades pagas pelo Asaas entram em "Asaas com split"/"Asaas sem split";
-- as pagas fora do Asaas, na categoria "Mensalidade (fora do Asaas)".
-- -----------------------------------------------------------------------------
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
     and (p_clinics is null or r.clinic_id = any (p_clinics))
  union all
  -- 4018c: as mensalidades (PPR+, Ortodontia e qualquer origem nova de linha de
  -- taxa): um "recebimento" por mensalidade paga, pela cobrança do Asaas quando
  -- houver (a data do pagamento), senão pela data em que a taxa nasceu.
  select m.source_id, m.clinic_id, m.received_at, m.amount_cents,
         case when m.charge_id is null then 'mensalidade'
              when m.split_applied then 'split' else 'asaas_sem_split' end,
         case when m.charge_id is not null and not coalesce(m.split_applied, false)
              then coalesce(m.split_skip_reason, 'antes_do_split') end,
         m.due_cents, m.retained_cents
    from (
      select sc.source_id, sc.clinic_id,
             coalesce(ch.paid_on, (min(sc.created_at) at time zone 'America/Sao_Paulo')::date) as received_at,
             max(sc.base_cents)::bigint as amount_cents,
             ch.id as charge_id, ch.split_applied, ch.split_skip_reason,
             sum(sc.amount_cents)::bigint as due_cents,
             sum(sc.retained_cents)::bigint as retained_cents
        from public.split_charges sc
        left join lateral (
          select c.id, c.paid_on, c.split_applied, c.split_skip_reason from public.charges c
           where c.source_type = sc.source_type and c.source_id = sc.source_id
             and c.status in ('paga', 'liquidada', 'em_contestacao')
           order by c.paid_on desc nulls last limit 1
        ) ch on true
       where sc.source_type <> 'receipt' and not sc.reversed
         and (p_clinic is null or sc.clinic_id = p_clinic)
         and (p_clinics is null or sc.clinic_id = any (p_clinics))
       group by sc.source_type, sc.source_id, sc.clinic_id, ch.id, ch.paid_on, ch.split_applied, ch.split_skip_reason
    ) m
   where m.received_at between p_from and p_to;
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
     -- 4018c: também as cobranças de mensalidade (sem recebimento ligado, pela origem).
     where c.split_applied and (c.receipt_id is not null or c.source_id is not null) and c.paid_on is not null
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

-- As linhas retidas que já existem sem o lançamento no razão.
do $$
declare
  v_charge uuid;
begin
  for v_charge in
    select distinct sc.charge_id
      from public.split_charges sc
     where sc.charge_id is not null and not sc.reversed and sc.retained_cents > 0
       and not exists (select 1 from public.financial_entries f
                        where f.source_type = 'split_retained' and f.source_id = sc.id and f.status in ('open', 'settled'))
  loop
    begin
      perform public._gateway_split_retention(v_charge);
    exception when others then
      -- mês fechado (ou outro bloqueio do razão): a linha continua sem lançamento
      -- e aparece na Conferência das taxas; nada mais desta cobrança muda.
      null;
    end;
  end loop;
end;
$$;

notify pgrst, 'reload schema';

select
  (select count(*) from pg_trigger where tgname = 'split_charges_after_born' and tgrelid = 'public.split_charges'::regclass) as gatilho_novo,
  (select count(*) from public.split_charges sc
    where sc.charge_id is not null and not sc.reversed and sc.retained_cents > 0
      and not exists (select 1 from public.financial_entries f
                       where f.source_type = 'split_retained' and f.source_id = sc.id and f.status in ('open', 'settled'))) as linhas_sem_razao;

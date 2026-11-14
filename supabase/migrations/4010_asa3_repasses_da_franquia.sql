-- =============================================================================
-- 4010 — ASA3, entrega 3: REPASSES DA FRANQUIA (spec 18.8; plano aprovado pelo
-- Jeferson em 13/11/2026, com os ajustes 1 a 6)
-- -----------------------------------------------------------------------------
-- Um painel que LÊ o que as entregas 1 e 2 já gravam. Nenhuma tabela nova:
--   * `split_charges`   — a taxa devida, recibo a recibo e taxa a taxa
--                         (`amount_cents`), e quanto dela foi retido no split
--                         (`retained_cents`);
--   * `charge_splits`   — o que foi enviado ao Asaas por carteira e o que o
--                         Asaas LIQUIDOU (`settled_cents`, `settled_at`);
--   * `payables`        — a conta a pagar de taxa do mês;
--   * `payment_waivers` — as dispensas (quitação por valor menor e arredondamento).
--
-- A CONFERÊNCIA É POR COBRANÇA (ajuste 1): o devido e o liquidado das MESMAS
-- cobranças, filtradas pela data do pagamento. O que o Asaas ainda não liquidou
-- é "a receber", não diferença. O liquidado de cada carteira é rateado entre as
-- taxas dela na proporção do devido (o resto do arredondamento fica com a
-- maior taxa), para a soma por taxa bater com o que o Asaas pagou.
--
-- QUEM VÊ: a permissão nova `modulo.repasses_franquia`. Nasce só com o Admin
-- Master (P2); o teto é Gerente, Franqueado e Financeiro da Franqueadora. O
-- Financeiro da Franqueadora vê a rede inteira; Gerente e Franqueado, a própria
-- unidade. O saldo da conta Asaas da franqueadora só aparece para quem vê a rede.
--
-- A PLANILHA passa pela mesma porta (`p_export`), e cada download vira um
-- registro de auditoria (quem, quando, qual parte e os filtros).
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) A PERMISSÃO
-- -----------------------------------------------------------------------------
create or replace function public._gateway_cap_default_roles(p_capability text)
returns public.user_role[]
language sql
immutable
set search_path = ''
as $$
  select case p_capability
    when 'acao.cobranca.selo_atraso' then array['unit_manager','franchisee']::public.user_role[]
    when 'modulo.painel_cobrancas' then '{}'::public.user_role[]
    when 'acao.cobranca.estorno' then array['franchisee','unit_manager']::public.user_role[]
    when 'modulo.repasses_franquia' then '{}'::public.user_role[]
    else '{}'::public.user_role[]
  end;
$$;
revoke execute on function public._gateway_cap_default_roles(text) from public, anon, authenticated;

create or replace function public._gateway_cap_ceiling(p_capability text)
returns public.user_role[]
language sql
immutable
set search_path = ''
as $$
  select case p_capability
    when 'acao.cobranca.selo_atraso' then
      array['unit_manager','franchisee','receptionist','commercial_consultant',
            'commercial_assistant','finance_franchisor']::public.user_role[]
    when 'modulo.painel_cobrancas' then
      array['unit_manager','franchisee','finance_franchisor']::public.user_role[]
    when 'acao.cobranca.estorno' then
      array['franchisee','unit_manager']::public.user_role[]
    when 'modulo.repasses_franquia' then
      array['unit_manager','franchisee','finance_franchisor']::public.user_role[]
    else '{}'::public.user_role[]
  end;
$$;
revoke execute on function public._gateway_cap_ceiling(text) from public, anon, authenticated;

insert into public.permission_defaults (capability, roles)
values ('modulo.repasses_franquia', public._gateway_cap_default_roles('modulo.repasses_franquia'))
on conflict (capability) do nothing;

-- -----------------------------------------------------------------------------
-- 2) AS COBRANÇAS COM SPLIT, TAXA A TAXA (a base das partes 0, 2, 3 e 4)
-- -----------------------------------------------------------------------------
-- Uma linha por cobrança × carteira × taxa. `p_from`/`p_to` pela DATA DO
-- PAGAMENTO; os dois nulos = todas (o "a receber" de hoje).
-- Situação da linha:
--   a_receber     — o Asaas ainda não liquidou a carteira (enviado ou bloqueado)
--   ok            — liquidado igual ao devido
--   absorvida     — falta da cobrança dentro da tolerância (S5)
--   mensageria    — falta acima da tolerância, mas no tamanho da tarifa de
--                   mensageria (até p × R$ 0,99) e com a régua da unidade ligada:
--                   provável mensageria descontada do líquido (ajuste 5)
--   conta_a_pagar — falta acima da tolerância: o que faltou voltou à conta a pagar
--   a_maior       — o Asaas repassou mais que o devido
--   cancelado     — split cancelado ou recusado: a taxa voltou à conta a pagar
--   estornado     — cobrança estornada (D13: a taxa continua devida, na conta a pagar)
create or replace function public._franchise_payout_charge_fees(
  p_from date, p_to date, p_clinics uuid[], p_clinic uuid
)
returns table (
  charge_id uuid, clinic_id uuid, client_id uuid, billing_type text, charge_status text,
  paid_on date, credit_date date, wallet_split_id uuid, wallet_label text, wallet_status text,
  fee text, due_cents bigint, retained_cents bigint, settled_cents bigint, settled_on date,
  charge_short_cents bigint, wallet_excess_cents bigint, situation text
)
language sql
stable
security definer
set search_path = ''
as $$
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
$$;
revoke execute on function public._franchise_payout_charge_fees(date, date, uuid[], uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3) OS RECEBIMENTOS DO PERÍODO, POR CATEGORIA (a parte 1)
-- -----------------------------------------------------------------------------
-- split          — baixa do Asaas de cobrança com split
-- asaas_sem_split — baixa do Asaas sem split (com o motivo)
-- dinheiro; cartao (maquininha e outros cartões); deposito_pix (depósito e Pix
-- manual); externa (cobrança feita fora do riSZon, e boleto de outro banco).
-- estornado     — recebimento estornado cuja taxa CONTINUA devida (D13): o
--                 dinheiro não conta como recebido (valor 0), mas a taxa conta
--                 no devido e na conta a pagar. Estorno sem taxa mantida some.
--                 (O estorno também aparece nas divergências.)
create or replace function public._franchise_payout_receipts(
  p_from date, p_to date, p_clinics uuid[], p_clinic uuid
)
returns table (
  receipt_id uuid, clinic_id uuid, received_at date, amount_cents bigint,
  category text, skip_reason text, due_cents bigint, retained_cents bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.clinic_id, r.received_at,
         case when coalesce(r.reversed, false) then 0 else r.amount_cents end,
         case
           when coalesce(r.reversed, false) then 'estornado'
           when r.reference like 'Asaas %' then
             case when ch.split_applied then 'split' else 'asaas_sem_split' end
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
$$;
revoke execute on function public._franchise_payout_receipts(date, date, uuid[], uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4) A PORTA DO PAINEL (e da planilha)
-- -----------------------------------------------------------------------------
-- Devolve tudo de uma vez, em jsonb:
--   resumo          — parte 0 (uma linha por unidade)
--   saldo           — parte 0, só para quem vê a rede (ajuste 6)
--   recebido        — parte 1 (unidade × categoria) + media_rede (ajuste 2)
--   motivos_sem_split
--   taxas           — parte 2 (unidade × taxa) e cobrancas (as linhas)
--   a_receber       — parte 3 (todas as pendentes hoje, de qualquer período)
--   liquidado_no_periodo — parte 3 (pela data em que o Asaas liquidou, P3)
--   divergencias    — parte 4
--   dispensas       — parte 5
-- p_export = nome da parte baixada: grava a auditoria (P6).
create or replace function public.franchise_payouts_read(
  p_from date,
  p_to date,
  p_clinic_id uuid default null,
  p_export text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinics uuid[] := public._gateway_cap_clinics('modulo.repasses_franquia');
  v_today date := public.today_br();
  v_rede boolean;
  v_out jsonb;
  v_tol integer;
begin
  if v_clinics is not null and coalesce(array_length(v_clinics, 1), 0) = 0 then
    raise exception 'NOT_ALLOWED';
  end if;
  if p_clinic_id is not null and v_clinics is not null and not (p_clinic_id = any (v_clinics)) then
    raise exception 'NOT_ALLOWED';
  end if;
  if p_from is null or p_to is null or p_to < p_from then raise exception 'INVALID_PERIOD'; end if;
  if p_to - p_from > 400 then raise exception 'PERIOD_TOO_LONG'; end if;
  if p_export is not null and p_export not in
     ('resumo', 'recebido', 'taxas', 'cobrancas', 'a_receber', 'divergencias', 'dispensas') then
    raise exception 'INVALID_EXPORT';
  end if;
  v_rede := v_clinics is null;
  select coalesce(s.tolerance_cents, 10) into v_tol from public.gateway_split_settings s where s.id;
  v_tol := coalesce(v_tol, 10);

  create temporary table if not exists _fp_fees on commit drop as
    select * from public._franchise_payout_charge_fees(null, null, '{}'::uuid[], null) limit 0;
  truncate _fp_fees;
  insert into _fp_fees select * from public._franchise_payout_charge_fees(p_from, p_to, v_clinics, p_clinic_id);

  create temporary table if not exists _fp_rec on commit drop as
    select * from public._franchise_payout_receipts(p_from, p_to, '{}'::uuid[], null) limit 0;
  truncate _fp_rec;
  insert into _fp_rec select * from public._franchise_payout_receipts(p_from, p_to, v_clinics, p_clinic_id);

  with
  units as (
    select distinct x.clinic_id from (
      select clinic_id from _fp_rec union select clinic_id from _fp_fees
      union
      select p.clinic_id from public.payables p
       where p.network_fee is not null
         and p.fee_period between date_trunc('month', p_from)::date and date_trunc('month', p_to)::date
         and p.status in ('aberta', 'parcial', 'aguardando_autorizacao')
         and (p_clinic_id is null or p.clinic_id = p_clinic_id)
         and (v_clinics is null or p.clinic_id = any (v_clinics))
    ) x
  ),
  pay as (
    select p.clinic_id,
           sum(case when p.due_date >= v_today then p.amount_cents - coalesce(p.paid_amount_cents, 0) else 0 end)::bigint as aberta,
           sum(case when p.due_date <  v_today then p.amount_cents - coalesce(p.paid_amount_cents, 0) else 0 end)::bigint as vencida
      from public.payables p
     where p.network_fee is not null
       and p.fee_period between date_trunc('month', p_from)::date and date_trunc('month', p_to)::date
       and p.status in ('aberta', 'parcial', 'aguardando_autorizacao')
       and (p_clinic_id is null or p.clinic_id = p_clinic_id)
       and (v_clinics is null or p.clinic_id = any (v_clinics))
     group by p.clinic_id
  ),
  resumo as (
    select u.clinic_id, cl.name,
           coalesce((select sum(r.due_cents) from _fp_rec r where r.clinic_id = u.clinic_id), 0)::bigint as devido,
           coalesce((select sum(f.retained_cents) from _fp_fees f where f.clinic_id = u.clinic_id
                      and f.situation in ('ok', 'absorvida', 'mensageria', 'conta_a_pagar', 'a_maior')), 0)::bigint as pago_no_split,
           coalesce((select sum(f.retained_cents) from _fp_fees f where f.clinic_id = u.clinic_id
                      and f.situation = 'a_receber'), 0)::bigint as a_receber,
           coalesce((select sum(r.due_cents - r.retained_cents) from _fp_rec r where r.clinic_id = u.clinic_id), 0)::bigint as foi_para_conta_a_pagar,
           coalesce(pay.aberta, 0) as conta_a_pagar_aberta,
           coalesce(pay.vencida, 0) as conta_a_pagar_vencida
      from units u
      join public.clinics cl on cl.id = u.clinic_id
      left join pay on pay.clinic_id = u.clinic_id
  ),
  rec as (
    select r.clinic_id, r.category,
           count(*)::integer as n,
           sum(r.amount_cents)::bigint as recebido,
           sum(r.due_cents)::bigint as devido,
           sum(r.retained_cents)::bigint as pago_no_split,
           sum(r.due_cents - r.retained_cents)::bigint as conta_a_pagar,
           round(100.0 * sum(r.amount_cents) / nullif(sum(sum(r.amount_cents)) over (partition by r.clinic_id), 0), 2) as percentual
      from _fp_rec r group by r.clinic_id, r.category
  ),
  -- A média da rede (ajuste 2): só percentuais, de todas as unidades.
  rede_cat as (
    select x.category, round(100.0 * sum(x.amount_cents) / nullif(sum(sum(x.amount_cents)) over (), 0), 2) as percentual
      from public._franchise_payout_receipts(p_from, p_to, null, null) x
     group by x.category
  ),
  taxas as (
    select f.clinic_id, f.fee,
           sum(f.due_cents) filter (where f.situation not in ('a_receber', 'cancelado', 'estornado'))::bigint as devido_liquidadas,
           sum(f.settled_cents) filter (where f.situation not in ('a_receber', 'cancelado', 'estornado'))::bigint as liquidado,
           sum(f.due_cents) filter (where f.situation = 'a_receber')::bigint as a_receber,
           sum(f.due_cents) filter (where f.situation in ('cancelado', 'estornado'))::bigint as fora_do_split,
           count(*) filter (where f.situation = 'absorvida')::integer as absorvidas,
           count(*) filter (where f.situation = 'mensageria')::integer as mensageria,
           count(*) filter (where f.situation in ('conta_a_pagar', 'a_maior', 'cancelado'))::integer as divergentes
      from _fp_fees f group by f.clinic_id, f.fee
  ),
  pend as (
    select * from public._franchise_payout_charge_fees(null, null, v_clinics, p_clinic_id) f
     where f.situation = 'a_receber'
  ),
  liq as (
    select f.clinic_id, f.fee, sum(f.settled_cents)::bigint as liquidado, count(distinct f.charge_id)::integer as cobrancas
      from public._franchise_payout_charge_fees(p_from - 120, p_to, v_clinics, p_clinic_id) f
     where f.settled_on between p_from and p_to and f.settled_cents is not null
       and f.situation not in ('cancelado', 'estornado')
     group by f.clinic_id, f.fee
  ),
  div as (
    -- falta acima da tolerância, mensageria, a maior, cancelado/recusado, bloqueado
    select distinct on (f.charge_id, f.wallet_split_id)
           f.clinic_id, f.charge_id, f.client_id, f.paid_on as data,
           case when f.situation = 'a_receber' then 'bloqueado' else f.situation end as tipo,
           case
             when f.situation = 'a_maior' then f.wallet_excess_cents
             when f.situation in ('conta_a_pagar', 'mensageria') then f.charge_short_cents
             else (select sum(g.due_cents) from _fp_fees g
                    where g.charge_id = f.charge_id and g.wallet_split_id = f.wallet_split_id) end::bigint as valor,
           f.wallet_label as detalhe, null::text as autor, null::text as motivo
      from _fp_fees f
     where f.situation in ('conta_a_pagar', 'mensageria', 'a_maior', 'cancelado')
        or f.wallet_status = 'bloqueado'
    union all
    -- estornos concluídos no período: a taxa continua devida (D13)
    select ch.clinic_id, ch.id, ch.client_id, (rf.finished_at at time zone 'America/Sao_Paulo')::date,
           'estorno',
           coalesce((select sum(sc.amount_cents) from public.split_charges sc
                      where sc.source_type = 'receipt' and sc.source_id = ch.receipt_id
                        and sc.kept_after_refund and sc.waived_at is null), 0)::bigint,
           null, pr.full_name, rf.reason
      from public.charge_refunds rf
      join public.charges ch on ch.id = rf.charge_id
      left join public.profiles pr on pr.id = rf.requested_by
     where rf.status = 'concluido'
       and (rf.finished_at at time zone 'America/Sao_Paulo')::date between p_from and p_to
       and (p_clinic_id is null or ch.clinic_id = p_clinic_id)
       and (v_clinics is null or ch.clinic_id = any (v_clinics))
    union all
    -- taxa dispensada depois do estorno
    select sc.clinic_id, max(sc.charge_id::text)::uuid, max(pi.client_id::text)::uuid,
           (max(sc.waived_at) at time zone 'America/Sao_Paulo')::date,
           'dispensa_taxa', sum(sc.amount_cents)::bigint, null, max(pr.full_name), max(sc.waived_reason)
      from public.split_charges sc
      left join public.payment_receipts r on r.id = sc.receipt_id
      left join public.payment_installments pi on pi.id = r.installment_id
      left join public.profiles pr on pr.id = sc.waived_by
     where sc.waived_at is not null
       and (sc.waived_at at time zone 'America/Sao_Paulo')::date between p_from and p_to
       and (p_clinic_id is null or sc.clinic_id = p_clinic_id)
       and (v_clinics is null or sc.clinic_id = any (v_clinics))
     group by sc.clinic_id, sc.receipt_id
  ),
  disp as (
    select w.clinic_id, w.id, (w.created_at at time zone 'America/Sao_Paulo')::date as data, w.kind,
           w.principal_cents, w.benefit_cents, w.late_fee_cents, w.interest_cents, w.total_cents,
           pr.full_name as autor, w.reason, pi.client_id
      from public.payment_waivers w
      left join public.profiles pr on pr.id = w.created_by
      left join public.payment_installments pi on pi.id = w.installment_id
     where (w.created_at at time zone 'America/Sao_Paulo')::date between p_from and p_to
       and (p_clinic_id is null or w.clinic_id = p_clinic_id)
       and (v_clinics is null or w.clinic_id = any (v_clinics))
  )
  select jsonb_build_object(
    'de', p_from, 'ate', p_to, 'hoje', v_today, 'rede', v_rede, 'tolerancia_cents', v_tol,
    'resumo', coalesce((select jsonb_agg(to_jsonb(r) order by r.name) from resumo r), '[]'),
    'recebido', coalesce((select jsonb_agg(jsonb_build_object(
        'clinic_id', r.clinic_id, 'categoria', r.category, 'n', r.n, 'recebido', r.recebido,
        'devido', r.devido, 'pago_no_split', r.pago_no_split, 'conta_a_pagar', r.conta_a_pagar,
        'percentual', r.percentual)) from rec r), '[]'),
    'media_rede', coalesce((select jsonb_object_agg(c.category, c.percentual) from rede_cat c), '{}'),
    'motivos_sem_split', coalesce((select jsonb_agg(jsonb_build_object(
        'clinic_id', m.clinic_id, 'motivo', m.skip_reason, 'n', m.n, 'recebido', m.v))
        from (select r.clinic_id, r.skip_reason, count(*) n, sum(r.amount_cents) v
                from _fp_rec r where r.category = 'asaas_sem_split' group by 1, 2) m), '[]'),
    'taxas', coalesce((select jsonb_agg(to_jsonb(t)) from taxas t), '[]'),
    'cobrancas', coalesce((select jsonb_agg(jsonb_build_object(
        'charge_id', f.charge_id, 'clinic_id', f.clinic_id, 'client_id', f.client_id,
        'cliente', c.full_name, 'codigo', c.code, 'meio', f.billing_type, 'pago_em', f.paid_on,
        'credito_previsto', f.credit_date, 'carteira', f.wallet_label, 'taxa', f.fee,
        'devido', f.due_cents, 'liquidado', f.settled_cents, 'liquidado_em', f.settled_on,
        'situacao', f.situation) order by f.paid_on, c.full_name, f.fee)
        from _fp_fees f left join public.clients c on c.id = f.client_id), '[]'),
    'a_receber', coalesce((select jsonb_agg(jsonb_build_object(
        'charge_id', f.charge_id, 'clinic_id', f.clinic_id, 'client_id', f.client_id,
        'cliente', c.full_name, 'codigo', c.code, 'meio', f.billing_type, 'pago_em', f.paid_on,
        'previsto', f.credit_date, 'atrasado', f.credit_date < v_today, 'taxa', f.fee,
        'valor', f.retained_cents, 'bloqueado', f.wallet_status = 'bloqueado')
        order by f.credit_date nulls last, c.full_name, f.fee)
        from pend f left join public.clients c on c.id = f.client_id), '[]'),
    'liquidado_no_periodo', coalesce((select jsonb_agg(to_jsonb(l)) from liq l), '[]'),
    'divergencias', coalesce((select jsonb_agg(jsonb_build_object(
        'clinic_id', d.clinic_id, 'charge_id', d.charge_id, 'client_id', d.client_id,
        'cliente', c.full_name, 'codigo', c.code, 'data', d.data, 'tipo', d.tipo, 'valor', d.valor,
        'detalhe', d.detalhe, 'autor', d.autor, 'motivo', d.motivo) order by d.data, c.full_name)
        from div d left join public.clients c on c.id = d.client_id), '[]'),
    'dispensas', coalesce((select jsonb_agg(jsonb_build_object(
        'clinic_id', d.clinic_id, 'id', d.id, 'data', d.data, 'tipo', d.kind, 'principal', d.principal_cents,
        'beneficio', d.benefit_cents, 'multa', d.late_fee_cents, 'juros', d.interest_cents, 'total', d.total_cents,
        'autor', d.autor, 'motivo', d.reason, 'client_id', d.client_id, 'cliente', c.full_name, 'codigo', c.code)
        order by d.data, c.full_name)
        from disp d left join public.clients c on c.id = d.client_id), '[]'),
    'unidades', coalesce((select jsonb_object_agg(cl.id, cl.name) from public.clinics cl
        where cl.id in (select clinic_id from units union select clinic_id from disp union select clinic_id from div
                        union select clinic_id from pend)), '{}'),
    'saldo', case when v_rede then (
        select jsonb_build_object('conta', g.label, 'saldo_cents', g.balance_cents,
               'conferido_em', g.balance_checked_at,
               'minimo_cents', (select s.min_balance_cents from public.gateway_split_settings s where s.id),
               'alerta', case when g.balance_cents is null then null
                              when g.balance_cents < 0 then 'negativo'
                              when g.balance_cents < coalesce((select s.min_balance_cents from public.gateway_split_settings s where s.id), 0)
                                then 'abaixo_do_minimo' end)
          from public.gateway_accounts g
         where g.owner_type = 'franchisor' and g.disabled_at is null
         order by g.created_at limit 1) end
  ) into v_out;

  if p_export is not null then
    insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
    values ((select auth.uid()), p_clinic_id, 'export', 'franchise_payouts', null,
            jsonb_build_object('planilha', p_export, 'unidade', p_clinic_id, 'de', p_from, 'ate', p_to,
                               'linhas', jsonb_array_length(coalesce(v_out -> p_export, '[]'))));
  end if;
  return v_out;
end;
$$;
revoke execute on function public.franchise_payouts_read(date, date, uuid, text) from public, anon, authenticated;
grant execute on function public.franchise_payouts_read(date, date, uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 5) AUDITORIA E CONFERÊNCIA
-- -----------------------------------------------------------------------------
select public.audit_attach_all();

select
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'franchise_payouts_read', '_franchise_payout_charge_fees', '_franchise_payout_receipts')) as funcoes,
  (select roles from public.permission_defaults where capability = 'modulo.repasses_franquia') as quem_ve_de_fabrica,
  (select count(*) from public.charge_splits) as carteiras_com_split,
  (select count(*) from public.charge_splits where status = 'liquidado') as carteiras_liquidadas;

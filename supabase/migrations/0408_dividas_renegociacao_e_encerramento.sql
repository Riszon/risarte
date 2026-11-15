-- =============================================================================
-- 0408 — LEVANTAMENTO DE DÍVIDAS, FASE 5: RENEGOCIAÇÃO E ENCERRAMENTO
-- -----------------------------------------------------------------------------
-- Plano aprovado pelo dono em 13/11/2026: docs/Financeiro/DIVIDAS-PLANO.md
-- (1.3 "Renegociação no razão", 2.5, 3.2, 3.3, 4.1, 4.7; decisões D8, D9, D12
-- e o ajuste 1 — "credor restabeleceu a dívida").
--
--   * O ACORDO (`debt_agreements`, código AD-): cobre uma ou várias dívidas do
--     mesmo credor e devedor (`debt_agreement_debts`, com a base de cada uma).
--     As parcelas NÃO são tabela própria: são títulos do Contas a Pagar
--     (`payables.debt_agreement_id`, `debt_link = 'acordo'`), na 5.5.02 (fora
--     da DRE). Pagar é o "Registrar pagamento" de sempre.
--   * Ao valer, os títulos em aberto das dívidas viram `renegociada` (situação
--     nova do título): saem do "a pagar" e da projeção; o lançamento de
--     competência fica (nada se apaga). `renegotiated_by_agreement_id` diz qual
--     acordo os substituiu — é por ele que o "desfazer" devolve.
--   * DESCONTO OBTIDO (T < S → 4.1.03) e ENCARGOS (T > S → 4.2.01), nas duas
--     formas da rede, congeladas no acordo: na data do acordo (padrão) ou
--     proporcional a cada parcela paga (gatilho em `payable_payments`; a conta
--     é sempre "o que já devia estar reconhecido − o que já foi", então o
--     estorno de um pagamento desconta sozinho e a última parcela fecha no
--     centavo). "A validar com o contador."
--   * APROVAÇÃO (D8): total acima de `agreement_approval_threshold_cents` (nulo
--     = desligado) espera o Admin Master — nada nasce até aprovar; quem
--     registrou não aprova o próprio acordo.
--   * QUEBRA (D9): rotina diária. Parcela vencida → aviso no dia seguinte;
--     passada a tolerância (dias úteis, a do acordo ou a da rede) → "Acordo
--     quebrado" + aviso crítico (Admin Master também, D12). Pagou o atraso,
--     volta a "em andamento"; tudo pago, "cumprido".
--   * CREDOR RESTABELECEU A DÍVIDA (ajuste 1): as parcelas em aberto viram
--     `renegociada`, nasce o título "dívida restabelecida" de S − pago no
--     acordo, e o desconto (e os encargos) reconhecidos até ali são estornados
--     por um lançamento NOVO e oposto com data de HOJE — nunca no mês do
--     acordo, que pode estar fechado.
--   * DESFAZER: só sem nenhum pagamento nas parcelas do acordo. Cancela as
--     parcelas, cancela o desconto/encargos e devolve os títulos — numa
--     transação.
--   * SALDO E SITUAÇÃO NUMA REGRA SÓ: `_debt_positions` (saldo, pago, título
--     mais antigo em aberto, acordo vigente) alimenta `_debt_compute_status`,
--     a fotografia mensal e a tela (`debt_positions`).
--   * ENCERRAMENTO (3.3): ao quitar nasce o checklist só com o que se aplica
--     (quitação; baixa da negativação, com o prazo em dias úteis; protesto
--     cancelado; processo extinto). Tudo feito → "Quitada — encerrada".
--   * Permissão nova `acao.dividas.renegociar` (padrão e teto: Financeiro da
--     Franqueadora). Aprovar acordo: só o Admin Master (fixo no banco).
--
-- Idempotente. Não apaga dado. Recria (partindo da definição mais nova):
-- `_debt_cap_default_roles`/`_debt_cap_ceiling` (0407), `refresh_payable_payment`
-- (0235), `payables_debt_guard`, `_debt_compute_status`, `payables_debt_status_sync`,
-- `debts_finance_resync`, `debt_delete` (0406), `_debt_refresh_status` (0404),
-- `_debt_snapshot_month` e `debt_daily_run` (0407).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) A PERMISSÃO NOVA: renegociar (padrão e teto = Financeiro da Franqueadora)
-- -----------------------------------------------------------------------------
-- Padrões de fábrica (iguais a `src/lib/permissions.ts`; há teste comparando).
create or replace function public._debt_cap_default_roles(p_capability text)
returns public.user_role[]
language sql
immutable
set search_path = ''
as $$
  select case p_capability
    when 'modulo.dividas' then array['finance_franchisor']::public.user_role[]
    when 'acao.dividas.lancar' then array['finance_franchisor']::public.user_role[]
    when 'acao.dividas.excluir' then array['finance_franchisor']::public.user_role[]
    when 'acao.dividas.configurar' then array['finance_franchisor']::public.user_role[]
    when 'acao.dividas.importar' then array['finance_franchisor']::public.user_role[]
    when 'acao.dividas.renegociar' then array['finance_franchisor']::public.user_role[]
    else '{}'::public.user_role[]
  end;
$$;
revoke execute on function public._debt_cap_default_roles(text) from public, anon, authenticated;

create or replace function public._debt_cap_ceiling(p_capability text)
returns public.user_role[]
language sql
immutable
set search_path = ''
as $$
  select case
    when p_capability in ('modulo.dividas', 'acao.dividas.lancar',
                          'acao.dividas.excluir', 'acao.dividas.configurar',
                          'acao.dividas.importar', 'acao.dividas.renegociar')
      then array['finance_franchisor']::public.user_role[]
    else '{}'::public.user_role[]
  end;
$$;
revoke execute on function public._debt_cap_ceiling(text) from public, anon, authenticated;

do $$
begin
  if exists (select 1 from public.permission_matrix) then
    insert into public.permission_matrix (capability, role)
    select 'acao.dividas.renegociar', r
      from unnest(public._debt_cap_default_roles('acao.dividas.renegociar')) as r
    on conflict (capability, role) do nothing;
  end if;
end;
$$;
insert into public.permission_defaults (capability, roles)
values ('acao.dividas.renegociar', public._debt_cap_default_roles('acao.dividas.renegociar'))
on conflict (capability) do nothing;

-- -----------------------------------------------------------------------------
-- 2) O ACORDO
-- -----------------------------------------------------------------------------
create sequence if not exists public.debt_agreement_code_seq;

create table if not exists public.debt_agreements (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  primary_debt_id uuid not null references public.debts(id) on delete restrict,
  previous_agreement_id uuid references public.debt_agreements(id) on delete restrict,
  proposal_id uuid references public.debt_proposals(id) on delete set null,

  agreed_on date not null,
  base_cents bigint not null check (base_cents > 0),
  total_cents bigint not null check (total_cents > 0),
  down_payment_cents bigint not null default 0 check (down_payment_cents >= 0),
  installments integer not null check (installments between 1 and 360),
  schedule jsonb not null,
  method text check (method is null or method in ('pix', 'boleto', 'debito', 'cartao', 'transferencia', 'outro')),
  discount_cents bigint not null default 0 check (discount_cents >= 0),
  surcharge_cents bigint not null default 0 check (surcharge_cents >= 0),
  discount_recognition text not null check (discount_recognition in ('na_data_do_acordo', 'proporcional')),
  surcharge_recognition text not null check (surcharge_recognition in ('na_data_do_acordo', 'proporcional')),
  broken_tolerance_bdays integer check (broken_tolerance_bdays is null or broken_tolerance_bdays between 0 and 60),

  negotiated_by uuid references auth.users(id),
  contact_id uuid references public.debt_creditor_contacts(id) on delete set null,
  channel text check (channel is null or channel in ('ligacao', 'whatsapp', 'email', 'presencial', 'carta', 'outro')),
  notes text,

  status text not null check (status in (
    'aguardando_aprovacao', 'em_andamento', 'quebrado', 'restabelecido',
    'cumprido', 'substituido', 'desfeito', 'recusado')),
  status_reason text,
  status_changed_at timestamptz not null default now(),
  approval_required boolean not null default false,
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  restored_payable_id uuid references public.payables(id) on delete restrict,

  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint debt_agreements_discount_xor check (discount_cents = 0 or surcharge_cents = 0),
  constraint debt_agreements_math check (total_cents - base_cents = surcharge_cents - discount_cents),
  constraint debt_agreements_down check (down_payment_cents < total_cents or installments = 1)
);
comment on table public.debt_agreements is
  'Acordo de uma ou várias dívidas do mesmo credor e devedor (AD-). As parcelas são títulos do Contas a Pagar (payables.debt_agreement_id). base = S (o que faltava pagar), total = T; desconto/encargos e a forma de reconhecer ficam congelados (0408).';
comment on column public.debt_agreements.schedule is
  'As parcelas combinadas: [{no, due_date, amount_cents, entrada}]. Antes da aprovação é só o combinado; depois, cada uma é um título (0408).';
create index if not exists debt_agreements_clinic on public.debt_agreements (clinic_id, status);
create index if not exists debt_agreements_primary on public.debt_agreements (primary_debt_id);

create or replace function public.debt_agreement_set_code()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.code is null then
    new.code := 'AD-' || lpad(nextval('public.debt_agreement_code_seq')::text, 5, '0');
  end if;
  return new;
end;
$$;
drop trigger if exists debt_agreements_code on public.debt_agreements;
create trigger debt_agreements_code before insert on public.debt_agreements
  for each row execute function public.debt_agreement_set_code();

-- O combinado não muda depois de gravado: só a situação (e o rastro dela).
create or replace function public.debt_agreements_lock()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Acordo não se apaga: desfaça-o (fica no histórico).';
  end if;
  if (new.clinic_id, new.supplier_id, new.primary_debt_id, new.agreed_on, new.base_cents, new.total_cents,
      new.down_payment_cents, new.installments, new.schedule, new.discount_cents, new.surcharge_cents,
      new.discount_recognition, new.surcharge_recognition, new.created_by, new.created_at, new.code)
     is distinct from
     (old.clinic_id, old.supplier_id, old.primary_debt_id, old.agreed_on, old.base_cents, old.total_cents,
      old.down_payment_cents, old.installments, old.schedule, old.discount_cents, old.surcharge_cents,
      old.discount_recognition, old.surcharge_recognition, old.created_by, old.created_at, old.code) then
    raise exception 'O que foi combinado no acordo não muda: desfaça e registre outro.';
  end if;
  return new;
end;
$$;
drop trigger if exists debt_agreements_lock on public.debt_agreements;
create trigger debt_agreements_lock before update or delete on public.debt_agreements
  for each row execute function public.debt_agreements_lock();

create table if not exists public.debt_agreement_debts (
  agreement_id uuid not null references public.debt_agreements(id) on delete restrict,
  debt_id uuid not null references public.debts(id) on delete restrict,
  base_cents bigint not null check (base_cents >= 0),
  primary key (agreement_id, debt_id)
);
comment on table public.debt_agreement_debts is
  'As dívidas que um acordo cobre e quanto cada uma faltava pagar (a base dela). O saldo do acordo é repartido entre elas por essa base (0408).';
create index if not exists debt_agreement_debts_debt on public.debt_agreement_debts (debt_id);

create or replace function public.debt_agreement_debts_lock()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'As dívidas de um acordo não mudam depois de gravado.';
end;
$$;
drop trigger if exists debt_agreement_debts_lock on public.debt_agreement_debts;
create trigger debt_agreement_debts_lock before update or delete on public.debt_agreement_debts
  for each row execute function public.debt_agreement_debts_lock();

-- -----------------------------------------------------------------------------
-- 3) O TÍTULO: a situação "renegociada" e o vínculo com o acordo
-- -----------------------------------------------------------------------------
alter table public.payables drop constraint if exists payables_status_check;
alter table public.payables add constraint payables_status_check
  check (status in ('aguardando_autorizacao', 'aberta', 'parcial', 'paga', 'cancelada', 'recusada', 'renegociada'));
alter table public.payables add column if not exists debt_agreement_id uuid references public.debt_agreements(id) on delete restrict;
alter table public.payables add column if not exists debt_installment_no integer;
alter table public.payables add column if not exists renegotiated_by_agreement_id uuid references public.debt_agreements(id) on delete restrict;
alter table public.payables drop constraint if exists payables_debt_link_check;
alter table public.payables add constraint payables_debt_link_check
  check ((debt_id is null and debt_link is null and debt_agreement_id is null)
      or (debt_id is not null and debt_link in ('gerado', 'vinculado') and debt_agreement_id is null)
      or (debt_id is not null and debt_link in ('acordo', 'restabelecido') and debt_agreement_id is not null));
alter table public.payables drop constraint if exists payables_renegotiated_check;
alter table public.payables add constraint payables_renegotiated_check
  check ((status = 'renegociada') = (renegotiated_by_agreement_id is not null));
create index if not exists payables_debt_agreement_idx on public.payables (debt_agreement_id) where debt_agreement_id is not null;
create index if not exists payables_renegotiated_idx on public.payables (renegotiated_by_agreement_id) where renegotiated_by_agreement_id is not null;
comment on column public.payables.debt_agreement_id is
  'Acordo do Levantamento de Dívidas de que este título é parcela (acordo) ou o restabelecimento (restabelecido), 0408.';
comment on column public.payables.renegotiated_by_agreement_id is
  'Situação renegociada: o acordo que substituiu este título. Sai do "a pagar"; o lançamento de competência fica (0408).';

-- A situação do título segue os pagamentos — menos a "renegociada", que só o
-- acordo põe e tira (corpo da 0235 + a renegociada na lista do que não muda).
create or replace function public.refresh_payable_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := coalesce(new.payable_id, old.payable_id);
  v_paid bigint; v_fee bigint; v_int bigint; v_disc bigint;
  v_amount bigint; v_status text;
begin
  select coalesce(sum(p.amount_cents), 0), coalesce(sum(p.fee_cents), 0),
         coalesce(sum(p.interest_cents), 0),
         coalesce(sum(p.discount_cents), 0)
    into v_paid, v_fee, v_int, v_disc
  from public.payable_payments p
  where p.payable_id = v_id and not p.reversed and p.reversal_of is null;

  select amount_cents, status into v_amount, v_status
  from public.payables where id = v_id;

  update public.payables set
    paid_amount_cents = v_paid,
    paid_fee_cents = v_fee,
    paid_interest_cents = v_int,
    status = case
      when v_status in ('cancelada', 'recusada', 'aguardando_autorizacao', 'renegociada')
        then v_status
      when v_paid + v_disc >= v_amount then 'paga'
      when v_paid > 0 then 'parcial'
      else 'aberta'
    end,
    updated_at = now()
  where id = v_id;

  return null;
end;
$$;
revoke execute on function public.refresh_payable_payment() from public, anon, authenticated;

-- Título renegociado não recebe pagamento novo (o estorno de um antigo pode).
create or replace function public.payable_payments_renegotiated_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text;
begin
  if new.reversal_of is null and exists (
       select 1 from public.payables p where p.id = new.payable_id and p.status = 'renegociada') then
    select a.code into v_code from public.payables p
      join public.debt_agreements a on a.id = p.renegotiated_by_agreement_id
     where p.id = new.payable_id;
    raise exception 'PAYABLE_RENEGOTIATED: este título foi renegociado no acordo % — pague as parcelas do acordo.', coalesce(v_code, '');
  end if;
  return new;
end;
$$;
revoke execute on function public.payable_payments_renegotiated_guard() from public, anon, authenticated;
drop trigger if exists payable_payments_renegotiated_guard on public.payable_payments;
create trigger payable_payments_renegotiated_guard before insert on public.payable_payments
  for each row execute function public.payable_payments_renegotiated_guard();

-- O título da dívida (gerado, parcela do acordo, restabelecido) só muda pela
-- dívida; a renegociada, só pelo acordo. Pagar continua livre (corpo da 0406).
create or replace function public.payables_debt_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_code text;
begin
  if coalesce(current_setting('risarte.debt_sync', true), '') = 'on' then
    return new;
  end if;
  if (new.debt_id, new.debt_link, new.opening_balance, new.debt_agreement_id, new.debt_installment_no,
      new.renegotiated_by_agreement_id)
     is distinct from
     (old.debt_id, old.debt_link, old.opening_balance, old.debt_agreement_id, old.debt_installment_no,
      old.renegotiated_by_agreement_id) then
    raise exception 'O vínculo do título com a dívida só muda pela tela do Levantamento de Dívidas.';
  end if;
  if (new.status = 'renegociada') is distinct from (old.status = 'renegociada') then
    raise exception 'Título renegociado só muda pelo acordo, na tela do Levantamento de Dívidas.';
  end if;
  if old.debt_link in ('gerado', 'acordo', 'restabelecido') and (
       (new.amount_cents, new.due_date, new.account_code, new.accrual_date, new.clinic_id, new.supplier_id)
         is distinct from
       (old.amount_cents, old.due_date, old.account_code, old.accrual_date, old.clinic_id, old.supplier_id)
       or (new.status in ('cancelada', 'recusada') and old.status not in ('cancelada', 'recusada'))) then
    select code into v_code from public.debts where id = old.debt_id;
    raise exception 'Este título é da dívida %: altere ou exclua pela tela do Levantamento de Dívidas.', coalesce(v_code, '');
  end if;
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4) SALDO, PAGO E VENCIMENTO MAIS ANTIGO — uma regra só
-- -----------------------------------------------------------------------------
-- Por dívida: títulos próprios (gerado/vinculado) + a parte dela em cada
-- acordo (parcelas e restabelecimento), repartida pela base (o resto do
-- arredondamento fica na dívida principal do acordo). Sem título ainda, o
-- devido é o valor atualizado (ou o original).
create or replace function public._debt_positions(p_ids uuid[])
returns table (
  debt_id uuid,
  balance_cents bigint,
  paid_cents bigint,
  has_titles boolean,
  oldest_open_due date,
  agreement_id uuid,
  agreement_code text,
  agreement_status text
)
language sql
stable
security definer
set search_path = ''
as $$
  with d as (
    select x.id, coalesce(x.updated_cents, x.original_cents, 0)::bigint as devido
      from public.debts x where x.id = any (p_ids)
  ),
  own as (
    select p.debt_id,
           sum(case when p.status in ('aberta', 'parcial', 'aguardando_autorizacao')
                    then greatest(0, p.amount_cents - coalesce(p.paid_amount_cents, 0)) else 0 end)::bigint as open_c,
           sum(case when p.status not in ('cancelada', 'recusada') then coalesce(p.paid_amount_cents, 0) else 0 end)::bigint as paid_c,
           count(*) filter (where p.status not in ('cancelada', 'recusada')) as n,
           min(p.due_date) filter (where p.status in ('aberta', 'parcial', 'aguardando_autorizacao')) as due
      from public.payables p
     where p.debt_id = any (p_ids) and p.debt_link in ('gerado', 'vinculado')
     group by p.debt_id
  ),
  rel as (
    select distinct ad.agreement_id from public.debt_agreement_debts ad where ad.debt_id = any (p_ids)
  ),
  fam as (
    select p.debt_agreement_id as aid,
           sum(case when p.status in ('aberta', 'parcial')
                    then greatest(0, p.amount_cents - coalesce(p.paid_amount_cents, 0)) else 0 end)::bigint as open_c,
           sum(case when p.status not in ('cancelada', 'recusada') then coalesce(p.paid_amount_cents, 0) else 0 end)::bigint as paid_c,
           count(*) filter (where p.status not in ('cancelada', 'recusada')) as n,
           min(p.due_date) filter (where p.status in ('aberta', 'parcial')) as due
      from public.payables p
     where p.debt_agreement_id in (select agreement_id from rel)
       and p.debt_link in ('acordo', 'restabelecido')
     group by p.debt_agreement_id
  ),
  sh as (
    select ad.agreement_id, ad.debt_id, a.primary_debt_id,
           f.open_c, f.paid_c, f.n, f.due,
           ad.base_cents, (sum(ad.base_cents) over (partition by ad.agreement_id))::bigint as tb
      from public.debt_agreement_debts ad
      join public.debt_agreements a on a.id = ad.agreement_id
      join fam f on f.aid = ad.agreement_id
  ),
  sh2 as (
    select s.*,
           case when s.tb > 0 then (s.open_c * s.base_cents / s.tb) else 0 end::bigint as open_raw,
           case when s.tb > 0 then (s.paid_c * s.base_cents / s.tb) else 0 end::bigint as paid_raw
      from sh s
  ),
  sh3 as (
    select s.*,
           sum(s.open_raw) over (partition by s.agreement_id) as sum_open_raw,
           sum(s.paid_raw) over (partition by s.agreement_id) as sum_paid_raw
      from sh2 s
  ),
  shares as (
    select s.debt_id,
           sum(s.open_raw + case when s.debt_id = s.primary_debt_id then s.open_c - s.sum_open_raw else 0 end)::bigint as open_c,
           sum(s.paid_raw + case when s.debt_id = s.primary_debt_id then s.paid_c - s.sum_paid_raw else 0 end)::bigint as paid_c,
           sum(s.n) as n,
           min(s.due) as due
      from sh3 s
     where s.debt_id = any (p_ids)
     group by s.debt_id
  ),
  cur as (
    select distinct on (ad.debt_id) ad.debt_id, a.id, a.code, a.status
      from public.debt_agreement_debts ad
      join public.debt_agreements a on a.id = ad.agreement_id
     where ad.debt_id = any (p_ids)
       and a.status in ('aguardando_aprovacao', 'em_andamento', 'quebrado')
     order by ad.debt_id, a.created_at desc
  )
  select d.id,
         case when coalesce(o.n, 0) + coalesce(s.n, 0) = 0 then d.devido
              else coalesce(o.open_c, 0) + coalesce(s.open_c, 0) end,
         coalesce(o.paid_c, 0) + coalesce(s.paid_c, 0),
         coalesce(o.n, 0) + coalesce(s.n, 0) > 0,
         case when o.due is null then s.due when s.due is null then o.due else least(o.due, s.due) end,
         c.id, c.code, c.status
    from d
    left join own o on o.debt_id = d.id
    left join shares s on s.debt_id = d.id
    left join cur c on c.debt_id = d.id;
$$;
revoke execute on function public._debt_positions(uuid[]) from public, anon, authenticated;

-- A porta da tela: as posições de todas as dívidas que a pessoa enxerga.
create or replace function public.debt_positions()
returns table (
  debt_id uuid,
  balance_cents bigint,
  paid_cents bigint,
  has_titles boolean,
  oldest_open_due date,
  agreement_id uuid,
  agreement_code text,
  agreement_status text
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.debt_id, p.balance_cents, p.paid_cents, p.has_titles, p.oldest_open_due, p.agreement_id, p.agreement_code, p.agreement_status
    from public._debt_positions((
      select coalesce(array_agg(x.id), '{}') from public.debts x
       where x.deleted_at is null and public.debt_can('modulo.dividas', x.clinic_id))) p;
$$;
revoke execute on function public.debt_positions() from public, anon, authenticated;
grant execute on function public.debt_positions() to authenticated;

-- -----------------------------------------------------------------------------
-- 5) O CHECKLIST DE ENCERRAMENTO (3.3)
-- -----------------------------------------------------------------------------
create table if not exists public.debt_closing_items (
  id uuid primary key default gen_random_uuid(),
  debt_id uuid not null references public.debts(id) on delete restrict,
  item text not null check (item in ('quitacao', 'baixa_negativacao', 'protesto_cancelado', 'processo_extinto')),
  applicable boolean not null default true,
  not_applicable_reason text,
  due_on date,
  done_on date,
  done_by uuid references auth.users(id),
  attachment_id uuid references public.debt_attachments(id) on delete set null,
  note text,
  created_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  constraint debt_closing_items_one unique (debt_id, item),
  constraint debt_closing_items_reason check (applicable or coalesce(btrim(not_applicable_reason), '') <> '')
);
comment on table public.debt_closing_items is
  'Checklist da baixa depois de quitar (3.3): só os itens que se aplicam à dívida. Todos feitos (ou "não se aplica", com motivo) → Quitada — encerrada (0408).';

-- Nasce (ou completa) o checklist: só o que se aplica, uma vez por item.
create or replace function public._debt_closing_seed(p_debt_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.debts%rowtype;
  v_n integer := 0;
  v_k integer;
  v_last date;
  v_bdays integer;
begin
  select * into d from public.debts where id = p_debt_id;
  if not found then return 0; end if;

  insert into public.debt_closing_items (debt_id, item) values (d.id, 'quitacao')
  on conflict (debt_id, item) do nothing;
  get diagnostics v_k = row_count; v_n := v_n + v_k;

  if exists (select 1 from public.debt_negativations n
              where n.debt_id = d.id and n.removed_at is null and n.removal_confirmed_on is null) then
    -- Prazo do credor tirar o nome: dias úteis depois do último pagamento.
    select max(pp.paid_at) into v_last
      from public.payable_payments pp
      join public.payables p on p.id = pp.payable_id
     where (p.debt_id = d.id or p.debt_agreement_id in (
              select ad.agreement_id from public.debt_agreement_debts ad where ad.debt_id = d.id))
       and pp.reversal_of is null and not pp.reversed;
    v_bdays := coalesce(
      (select s.negativation_removal_bdays from public.debt_settings s where s.clinic_id = d.clinic_id),
      (select s.negativation_removal_bdays from public.debt_settings s where s.clinic_id is null), 5);
    insert into public.debt_closing_items (debt_id, item, due_on)
    values (d.id, 'baixa_negativacao', public._payout_add_business_days(coalesce(v_last, public.today_br()), v_bdays))
    on conflict (debt_id, item) do nothing;
    get diagnostics v_k = row_count; v_n := v_n + v_k;
  end if;

  if exists (select 1 from public.debt_protests pr
              where (pr.debt_id = d.id or (d.group_id is not null and pr.group_id = d.group_id))
                and pr.removed_at is null and pr.cancel_status <> 'cancelado') then
    insert into public.debt_closing_items (debt_id, item) values (d.id, 'protesto_cancelado')
    on conflict (debt_id, item) do nothing;
    get diagnostics v_k = row_count; v_n := v_n + v_k;
  end if;

  if exists (select 1 from public.debt_lawsuits l
              where l.debt_id = d.id and l.removed_at is null and l.closed_on is null) then
    insert into public.debt_closing_items (debt_id, item) values (d.id, 'processo_extinto')
    on conflict (debt_id, item) do nothing;
    get diagnostics v_k = row_count; v_n := v_n + v_k;
  end if;
  return v_n;
end;
$$;
revoke execute on function public._debt_closing_seed(uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 6) A SITUAÇÃO — agora com o acordo e o encerramento (precedência do 4.1)
--    (espelho: `situacaoDaDivida` em src/lib/finance/dividas.ts)
-- -----------------------------------------------------------------------------
create or replace function public._debt_compute_status(p_debt_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  d public.debts%rowtype;
  v_pos record;
  v_due date;
  v_late integer;
begin
  select * into d from public.debts where id = p_debt_id;
  if not found then return null; end if;

  if d.manual_stage = 'baixada' then return 'baixada'; end if;

  select * into v_pos from public._debt_positions(array[d.id]);

  -- Quitada: tem título e não falta nada (o acordo esperando aprovação ainda
  -- não pagou nada). Encerrada quando o checklist está todo feito.
  if v_pos.has_titles and v_pos.balance_cents = 0
     and coalesce(v_pos.agreement_status, '') <> 'aguardando_aprovacao' then
    if exists (select 1 from public.debt_closing_items c where c.debt_id = d.id)
       and not exists (select 1 from public.debt_closing_items c
                        where c.debt_id = d.id and c.applicable and c.done_on is null) then
      return 'quitada_encerrada';
    end if;
    return 'quitada_pendencias';
  end if;

  if d.manual_stage = 'contestada' then return 'contestada'; end if;
  if d.manual_stage = 'judicial' then return 'judicial'; end if;
  if v_pos.agreement_status = 'quebrado' then return 'acordo_quebrado'; end if;
  if v_pos.agreement_status in ('em_andamento', 'aguardando_aprovacao') then return 'acordo_em_andamento'; end if;
  if d.manual_stage = 'em_negociacao' then return 'em_negociacao'; end if;

  -- O atraso conta do título mais antigo em aberto (o restabelecido, por
  -- exemplo); sem título, do vencimento da dívida.
  v_due := coalesce(v_pos.oldest_open_due, d.due_date);
  v_late := public.today_br() - v_due;
  if v_late <= 0 then return 'a_vencer'; end if;
  if v_late <= public._debt_days_to_default(d.clinic_id, d.supplier_id) then return 'em_atraso'; end if;
  return 'inadimplente';
end;
$$;
revoke execute on function public._debt_compute_status(uuid) from public, anon, authenticated;

-- Grava a situação nova e registra (corpo da 0404 + o checklist ao quitar).
create or replace function public._debt_refresh_status(p_debt_id uuid, p_auto boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old text;
  v_new text;
begin
  select status into v_old from public.debts where id = p_debt_id and deleted_at is null for update;
  if not found then return null; end if;
  v_new := public._debt_compute_status(p_debt_id);
  if v_new = 'quitada_pendencias' and public._debt_closing_seed(p_debt_id) > 0 then
    v_new := public._debt_compute_status(p_debt_id);
  end if;
  if v_new is distinct from v_old then
    update public.debts set status = v_new, status_changed_at = now() where id = p_debt_id;
    insert into public.debt_events (debt_id, user_id, kind, from_status, to_status)
    values (p_debt_id, case when p_auto then null else (select auth.uid()) end,
            case when p_auto then 'situacao_automatica' else 'situacao' end, v_old, v_new);
  end if;
  return v_new;
end;
$$;
revoke execute on function public._debt_refresh_status(uuid, boolean) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 7) AVISOS (porta `_debt_notify`, uma vez por assunto — D12)
-- -----------------------------------------------------------------------------
create table if not exists public.debt_notices (
  subject_id uuid not null,
  kind text not null,
  key text not null default '',
  recipients integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (subject_id, kind, key)
);
comment on table public.debt_notices is
  'Avisos do Levantamento de Dívidas já mandados (um por assunto, tipo e referência) — para a rotina não repetir (0408).';

-- Quem recebe: o responsável da dívida; sem ele, os Financeiros da
-- Franqueadora. O Admin Master só nos críticos (D12). Nunca quem fez a ação.
create or replace function public._debt_notify(
  p_subject_id uuid,
  p_kind text,
  p_key text,
  p_clinic_id uuid,
  p_owner uuid,
  p_critical boolean,
  p_only_admins boolean,
  p_title text,
  p_body text,
  p_link text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_novo boolean;
  v_users uuid[];
  v_n integer := 0;
begin
  insert into public.debt_notices (subject_id, kind, key)
  values (p_subject_id, p_kind, coalesce(p_key, ''))
  on conflict (subject_id, kind, key) do nothing
  returning true into v_novo;
  if not coalesce(v_novo, false) then return 0; end if;

  select array_agg(distinct u) into v_users from (
    select p_owner as u where not p_only_admins and p_owner is not null
      and exists (select 1 from public.profiles p where p.id = p_owner and p.is_active)
    union
    select ucr.user_id
      from public.user_clinic_roles_all ucr
      join public.profiles p on p.id = ucr.user_id and p.is_active
     where not p_only_admins and p_owner is null and ucr.role = 'finance_franchisor'
    union
    select p.id from public.profiles p
     where (p_critical or p_only_admins) and p.is_admin_master and p.is_active
  ) t where u is not null and u is distinct from (select auth.uid());

  if v_users is null then return 0; end if;
  insert into public.notifications (user_id, clinic_id, title, body, link)
  select x, p_clinic_id, p_title, p_body, p_link from unnest(v_users) as x;
  get diagnostics v_n = row_count;
  update public.debt_notices set recipients = v_n
   where subject_id = p_subject_id and kind = p_kind and key = coalesce(p_key, '');
  return v_n;
end;
$$;
revoke execute on function public._debt_notify(uuid, text, text, uuid, uuid, boolean, boolean, text, text, text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 8) O RAZÃO DO ACORDO: desconto obtido e encargos
-- -----------------------------------------------------------------------------
create unique index if not exists financial_entries_debt_agreement_unique
  on public.financial_entries (source_type, source_id)
  where source_type in ('debt_agreement_discount', 'debt_agreement_surcharge',
                        'debt_agreement_discount_part', 'debt_agreement_surcharge_part');

-- Um lançamento de reconhecimento (não é caixa: competência só).
create or replace function public._debt_agreement_entry(
  a public.debt_agreements, p_kind text, p_amount bigint, p_date date, p_source_id uuid, p_desc text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(p_amount, 0) = 0 then return; end if;
  insert into public.financial_entries (
    clinic_id, account_code, accrual_date, cash_date, amount_cents, direction, status,
    source_type, source_id, description, created_by
  ) values (
    a.clinic_id,
    case when p_kind like 'debt_agreement_discount%' then '4.1.03' else '4.2.01' end,
    p_date, null, abs(p_amount),
    -- Desconto é receita (entra); encargo é despesa (sai). Negativo = volta.
    case when (p_kind like 'debt_agreement_discount%') = (p_amount > 0) then 'inflow' else 'outflow' end,
    'open', p_kind, p_source_id, p_desc, (select auth.uid())
  );
end;
$$;
revoke execute on function public._debt_agreement_entry(public.debt_agreements, text, bigint, date, uuid, text) from public, anon, authenticated;

-- O que já foi reconhecido de desconto (d) ou encargos (s), líquido.
create or replace function public._debt_agreement_recognized(p_agreement_id uuid, p_which text)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(case
           when (p_which = 'd') = (e.direction = 'inflow') then e.amount_cents else -e.amount_cents end), 0)::bigint
    from public.financial_entries e
   where e.status <> 'cancelled'
     and (
       (e.source_type = case p_which when 'd' then 'debt_agreement_discount' else 'debt_agreement_surcharge' end
          and e.source_id = p_agreement_id)
       or (e.source_type = case p_which when 'd' then 'debt_agreement_discount_part' else 'debt_agreement_surcharge_part' end
          and e.source_id in (select pp.id from public.payable_payments pp
                                join public.payables p on p.id = pp.payable_id
                               where p.debt_agreement_id = p_agreement_id))
       or (e.source_type = 'debt_agreement_reversal' and e.source_id = p_agreement_id
           and e.account_code = case p_which when 'd' then '4.1.03' else '4.2.01' end)
     );
$$;
revoke execute on function public._debt_agreement_recognized(uuid, text) from public, anon, authenticated;

-- Forma (b), proporcional: a cada pagamento (ou estorno) de parcela do
-- acordo, reconhece o que falta para chegar a D × pago ÷ T. A última parcela
-- fecha no centavo; o estorno volta o que tinha entrado.
create or replace function public._debt_agreement_recognize(p_agreement_id uuid, p_payment_id uuid, p_date date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.debt_agreements%rowtype;
  v_paid bigint;
  v_target bigint;
  v_delta bigint;
begin
  select * into a from public.debt_agreements where id = p_agreement_id;
  if not found or a.status not in ('em_andamento', 'quebrado', 'cumprido') then return; end if;

  select coalesce(sum(pp.amount_cents), 0) into v_paid
    from public.payable_payments pp
    join public.payables p on p.id = pp.payable_id
   where p.debt_agreement_id = a.id and p.debt_link = 'acordo'
     and pp.reversal_of is null and not pp.reversed;

  if a.discount_cents > 0 and a.discount_recognition = 'proporcional' then
    v_target := case when v_paid >= a.total_cents then a.discount_cents
                     else (a.discount_cents * v_paid / a.total_cents) end;
    v_delta := v_target - public._debt_agreement_recognized(a.id, 'd');
    perform public._debt_agreement_entry(a, 'debt_agreement_discount_part', v_delta, p_date, p_payment_id,
      'Desconto obtido (proporcional) — acordo ' || a.code);
  end if;
  if a.surcharge_cents > 0 and a.surcharge_recognition = 'proporcional' then
    v_target := case when v_paid >= a.total_cents then a.surcharge_cents
                     else (a.surcharge_cents * v_paid / a.total_cents) end;
    v_delta := v_target - public._debt_agreement_recognized(a.id, 's');
    perform public._debt_agreement_entry(a, 'debt_agreement_surcharge_part', v_delta, p_date, p_payment_id,
      'Encargos da renegociação (proporcional) — acordo ' || a.code);
  end if;
end;
$$;
revoke execute on function public._debt_agreement_recognize(uuid, uuid, date) from public, anon, authenticated;

create or replace function public.payable_payments_debt_agreement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_aid uuid;
begin
  select p.debt_agreement_id into v_aid from public.payables p
   where p.id = new.payable_id and p.debt_link = 'acordo';
  if v_aid is not null then
    perform public._debt_agreement_recognize(v_aid, new.id, coalesce(new.paid_at, public.today_br()));
  end if;
  return null;
end;
$$;
revoke execute on function public.payable_payments_debt_agreement() from public, anon, authenticated;
drop trigger if exists payable_payments_debt_agreement on public.payable_payments;
create trigger payable_payments_debt_agreement after insert on public.payable_payments
  for each row execute function public.payable_payments_debt_agreement();

-- Volta o que foi reconhecido. Mês aberto: cancela o lançamento; mês
-- fechado (ou restabelecimento): lançamento NOVO e oposto com data de hoje.
create or replace function public._debt_agreement_unrecognize(p_agreement_id uuid, p_force_new boolean, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.debt_agreements%rowtype;
  e record;
  v_today date := public.today_br();
  v_amt bigint;
begin
  select * into a from public.debt_agreements where id = p_agreement_id;
  if not p_force_new then
    for e in select f.id, f.clinic_id, f.accrual_date from public.financial_entries f
              where f.source_id = a.id and f.status = 'open'
                and f.source_type in ('debt_agreement_discount', 'debt_agreement_surcharge') loop
      if exists (select 1 from public.fiscal_periods fp
                  where fp.clinic_id = e.clinic_id and fp.status = 'closed'
                    and fp.year = extract(year from e.accrual_date)::integer
                    and fp.month = extract(month from e.accrual_date)::integer) then
        p_force_new := true;
        exit;
      end if;
    end loop;
  end if;

  if not p_force_new then
    update public.financial_entries set status = 'cancelled'
     where source_id = a.id and status = 'open'
       and source_type in ('debt_agreement_discount', 'debt_agreement_surcharge');
    return;
  end if;

  v_amt := public._debt_agreement_recognized(a.id, 'd');
  if v_amt <> 0 then
    insert into public.financial_entries (clinic_id, account_code, accrual_date, cash_date, amount_cents,
      direction, status, source_type, source_id, description, created_by)
    values (a.clinic_id, '4.1.03', v_today, null, abs(v_amt), case when v_amt > 0 then 'outflow' else 'inflow' end,
      'open', 'debt_agreement_reversal', a.id, 'Estorno do desconto obtido — acordo ' || a.code || ' (' || p_reason || ')',
      (select auth.uid()));
  end if;
  v_amt := public._debt_agreement_recognized(a.id, 's');
  if v_amt <> 0 then
    insert into public.financial_entries (clinic_id, account_code, accrual_date, cash_date, amount_cents,
      direction, status, source_type, source_id, description, created_by)
    values (a.clinic_id, '4.2.01', v_today, null, abs(v_amt), case when v_amt > 0 then 'inflow' else 'outflow' end,
      'open', 'debt_agreement_reversal', a.id, 'Estorno dos encargos da renegociação — acordo ' || a.code || ' (' || p_reason || ')',
      (select auth.uid()));
  end if;
end;
$$;
revoke execute on function public._debt_agreement_unrecognize(uuid, boolean, text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 9) A SITUAÇÃO DO ACORDO (em andamento · quebrado · cumprido), uma regra só
-- -----------------------------------------------------------------------------
create or replace function public._debt_agreement_tolerance(a public.debt_agreements)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(a.broken_tolerance_bdays,
    (select s.agreement_broken_tolerance_bdays from public.debt_settings s where s.clinic_id = a.clinic_id),
    (select s.agreement_broken_tolerance_bdays from public.debt_settings s where s.clinic_id is null), 3);
$$;
revoke execute on function public._debt_agreement_tolerance(public.debt_agreements) from public, anon, authenticated;

create or replace function public._debt_agreement_refresh(p_agreement_id uuid, p_auto boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.debt_agreements%rowtype;
  v_new text;
  v_today date := public.today_br();
  v_tol integer;
  v_late date;
  v_owner uuid;
  v_sup text;
  r record;
begin
  select * into a from public.debt_agreements where id = p_agreement_id for update;
  if not found then return null; end if;
  if a.status in ('em_andamento', 'quebrado', 'cumprido') then
    v_tol := public._debt_agreement_tolerance(a);
    select min(p.due_date) into v_late
      from public.payables p
     where p.debt_agreement_id = a.id and p.debt_link = 'acordo' and p.status in ('aberta', 'parcial')
       and v_today > public._payout_add_business_days(p.due_date, v_tol);
    if not exists (select 1 from public.payables p
                    where p.debt_agreement_id = a.id and p.debt_link = 'acordo' and p.status in ('aberta', 'parcial')) then
      v_new := 'cumprido';
    elsif v_late is not null then
      v_new := 'quebrado';
    else
      v_new := 'em_andamento';
    end if;

    if v_new is distinct from a.status then
      update public.debt_agreements set status = v_new, status_changed_at = now(), updated_at = now(),
             status_reason = case v_new when 'quebrado' then 'Parcela vencida em ' || to_char(v_late, 'DD/MM/YYYY')
                                  || ' sem pagamento além da tolerância de ' || v_tol || ' dia(s) útil(eis)' else null end
       where id = a.id;
      for r in select ad.debt_id from public.debt_agreement_debts ad where ad.agreement_id = a.id loop
        insert into public.debt_events (debt_id, user_id, kind, note, data)
        values (r.debt_id, case when p_auto then null else (select auth.uid()) end,
                case v_new when 'quebrado' then 'acordo_quebrado' when 'cumprido' then 'acordo_cumprido' else 'acordo_retomado' end,
                null, jsonb_build_object('agreement_id', a.id, 'code', a.code));
      end loop;
      if v_new = 'quebrado' then
        select owner_user_id into v_owner from public.debts where id = a.primary_debt_id;
        select s.name into v_sup from public.suppliers s where s.id = a.supplier_id;
        perform public._debt_notify(a.id, 'acordo_quebrado', to_char(v_late, 'YYYY-MM-DD'), a.clinic_id, v_owner, true, false,
          'Dívidas: acordo ' || a.code || ' quebrado',
          'A parcela que venceu em ' || to_char(v_late, 'DD/MM/YYYY') || ' passou da tolerância sem pagamento. Credor: '
            || coalesce(v_sup, '—') || '. Renegocie de novo ou registre que o credor restabeleceu a dívida.',
          '/financeiro/dividas/' || a.primary_debt_id || '?aba=acordos');
      end if;
    end if;
  else
    v_new := a.status;
  end if;

  for r in select ad.debt_id from public.debt_agreement_debts ad where ad.agreement_id = a.id loop
    perform public._debt_refresh_status(r.debt_id, p_auto);
  end loop;
  return v_new;
end;
$$;
revoke execute on function public._debt_agreement_refresh(uuid, boolean) from public, anon, authenticated;

-- Pagou (ou estornou) um título: a dívida — ou o acordo inteiro — acompanha.
-- Dentro de um ato do acordo (`risarte.debt_batch`), quem chama recalcula no fim.
create or replace function public.payables_debt_status_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(current_setting('risarte.debt_batch', true), '') = 'on' then
    return null;
  end if;
  if new.status is distinct from old.status then
    if new.debt_agreement_id is not null then
      perform public._debt_agreement_refresh(new.debt_agreement_id, false);
    elsif new.debt_id is not null then
      perform public._debt_refresh_status(new.debt_id, false);
    end if;
  end if;
  return null;
end;
$$;
revoke execute on function public.payables_debt_status_sync() from public, anon, authenticated;
drop trigger if exists payables_debt_status_sync on public.payables;
create trigger payables_debt_status_sync after update of status on public.payables
  for each row execute function public.payables_debt_status_sync();

-- -----------------------------------------------------------------------------
-- 10) O QUE ENTRA NO ACORDO E O IMPACTO — a conferência que a tela mostra e a
--     gravação refaz (espelho do texto: `fraseDoImpactoDoAcordo`)
-- -----------------------------------------------------------------------------
-- p: {debt_ids[], agreed_on, total_cents, schedule[{due_date, amount_cents,
--     entrada}], proposal_id, broken_tolerance_bdays}
create or replace function public._debt_agreement_check(p jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_clinic uuid;
  v_supplier uuid;
  v_n integer;
  v_prev uuid[];
  v_missing uuid[];
  v_base bigint := 0;
  v_total bigint := nullif(p ->> 'total_cents', '')::bigint;
  v_agreed date := nullif(p ->> 'agreed_on', '')::date;
  v_sched jsonb := coalesce(p -> 'schedule', '[]'::jsonb);
  v_sum bigint;
  v_cnt integer;
  v_bad integer;
  v_first date;
  v_thr bigint;
  v_titles integer := 0;
  v_titles_cents bigint := 0;
  v_cur record;
  v_problem text;
  v_disc_mode text;
  v_sur_mode text;
  v_prop uuid := nullif(p ->> 'proposal_id', '')::uuid;
  x record;
begin
  select coalesce(array_agg(distinct (j #>> '{}')::uuid), '{}') into v_ids
    from jsonb_array_elements(coalesce(p -> 'debt_ids', '[]'::jsonb)) j;
  if cardinality(v_ids) = 0 then
    return jsonb_build_object('problem', 'Escolha ao menos uma dívida.');
  end if;

  -- Acordo quebrado ou restabelecido de alguma delas: entram TODAS as dívidas
  -- dele (o saldo é do acordo inteiro).
  select coalesce(array_agg(distinct a.id), '{}') into v_prev
    from public.debt_agreement_debts ad
    join public.debt_agreements a on a.id = ad.agreement_id
   where ad.debt_id = any (v_ids) and a.status in ('quebrado', 'restabelecido');
  if cardinality(v_prev) > 0 then
    select coalesce(array_agg(distinct ad.debt_id), '{}') into v_missing
      from public.debt_agreement_debts ad where ad.agreement_id = any (v_prev) and not (ad.debt_id = any (v_ids));
    v_ids := v_ids || v_missing;
  end if;

  select count(*), min(clinic_id::text)::uuid, min(supplier_id::text)::uuid,
         count(distinct clinic_id), count(distinct supplier_id)
    into v_n, v_clinic, v_supplier, v_cnt, v_bad
    from public.debts where id = any (v_ids) and deleted_at is null;
  if v_n <> cardinality(v_ids) then
    return jsonb_build_object('problem', 'Alguma dívida não existe mais (ou foi excluída).');
  end if;
  if v_cnt > 1 or v_bad > 1 then
    return jsonb_build_object('problem', 'Um acordo junta só dívidas do mesmo devedor e do mesmo credor.');
  end if;

  for x in select id, code, status, finance_synced_at, origin from public.debts where id = any (v_ids) order by code loop
    if x.status in ('baixada', 'quitada_pendencias', 'quitada_encerrada') then
      v_problem := coalesce(v_problem, 'A dívida ' || x.code || ' está ' ||
        case x.status when 'baixada' then 'baixada' else 'quitada' end || ': não entra em acordo.');
    elsif x.finance_synced_at is null then
      v_problem := coalesce(v_problem, 'A dívida ' || x.code || ' ainda não está no Contas a Pagar: gere (ou vincule) os títulos dela antes de renegociar.');
    end if;
    select a.code, a.status into v_cur
      from public.debt_agreement_debts ad join public.debt_agreements a on a.id = ad.agreement_id
     where ad.debt_id = x.id and a.status in ('aguardando_aprovacao', 'em_andamento')
     limit 1;
    if found then
      v_problem := coalesce(v_problem, 'A dívida ' || x.code || ' já está no acordo ' || v_cur.code ||
        case v_cur.status when 'aguardando_aprovacao' then ' (aguardando aprovação)' else ' (em andamento)' end ||
        '. Para mudar, desfaça esse acordo (enquanto nada foi pago) ou espere ele quebrar.');
    end if;
  end loop;

  if exists (select 1 from public.payables p where p.debt_id = any (v_ids) and p.debt_link in ('gerado', 'vinculado')
              and p.status = 'aguardando_autorizacao') then
    v_problem := coalesce(v_problem, 'Há título destas dívidas aguardando autorização no Contas a Pagar: resolva antes.');
  end if;

  -- S: o que falta pagar, por título (próprios + os do acordo anterior).
  select count(*), coalesce(sum(greatest(0, p.amount_cents - coalesce(p.paid_amount_cents, 0))), 0)
    into v_titles, v_titles_cents
    from public.payables p
   where p.status in ('aberta', 'parcial')
     and ((p.debt_id = any (v_ids) and p.debt_link in ('gerado', 'vinculado'))
          or (p.debt_agreement_id = any (v_prev) and p.debt_link in ('acordo', 'restabelecido')));
  v_base := v_titles_cents;
  if v_problem is null and v_base <= 0 then
    v_problem := 'Não há nada em aberto nestas dívidas para renegociar.';
  end if;

  -- As condições.
  if v_agreed is null then
    v_problem := coalesce(v_problem, 'Informe a data do acordo.');
  elsif v_agreed > public.today_br() then
    v_problem := coalesce(v_problem, 'A data do acordo não pode ser futura.');
  elsif exists (select 1 from public.fiscal_periods fp
                 where fp.clinic_id = v_clinic and fp.status = 'closed'
                   and fp.year = extract(year from v_agreed)::integer
                   and fp.month = extract(month from v_agreed)::integer) then
    v_problem := coalesce(v_problem, 'A competência de ' || to_char(v_agreed, 'MM/YYYY') ||
      ' deste CNPJ está fechada: use uma data de acordo num mês aberto.');
  end if;
  if coalesce(v_total, 0) <= 0 then
    v_problem := coalesce(v_problem, 'Informe o total do acordo.');
  end if;
  select count(*), coalesce(sum(nullif(j ->> 'amount_cents', '')::bigint), 0),
         count(*) filter (where nullif(j ->> 'due_date', '') is null or coalesce(nullif(j ->> 'amount_cents', '')::bigint, 0) <= 0
                            or (v_agreed is not null and (j ->> 'due_date')::date < v_agreed)),
         min(nullif(j ->> 'due_date', '')::date)
    into v_cnt, v_sum, v_bad, v_first
    from jsonb_array_elements(v_sched) j;
  if v_cnt = 0 then
    v_problem := coalesce(v_problem, 'Monte as parcelas do acordo.');
  elsif v_cnt > 360 then
    v_problem := coalesce(v_problem, 'No máximo 360 parcelas.');
  elsif v_bad > 0 then
    v_problem := coalesce(v_problem, 'Toda parcela precisa de vencimento (a partir da data do acordo) e de valor.');
  elsif v_sum <> coalesce(v_total, 0) then
    v_problem := coalesce(v_problem, 'A soma das parcelas (' || public.brl(v_sum) || ') não fecha com o total (' ||
      public.brl(coalesce(v_total, 0)) || ').');
  end if;
  if (select count(*) filter (where (j ->> 'entrada')::boolean) from jsonb_array_elements(v_sched) j) > 1 then
    v_problem := coalesce(v_problem, 'Só uma parcela pode ser a entrada.');
  end if;

  if v_prop is not null and not exists (
       select 1 from public.debt_proposals pr
        where pr.id = v_prop and pr.status = 'ativa'
          and (pr.debt_id = any (v_ids) or pr.group_id in (select group_id from public.debts where id = any (v_ids)))) then
    v_problem := coalesce(v_problem, 'A proposta escolhida não está mais ativa para estas dívidas.');
  end if;

  select s.agreement_approval_threshold_cents, coalesce(s.discount_recognition, 'na_data_do_acordo'),
         coalesce(s.surcharge_recognition, 'na_data_do_acordo')
    into v_thr, v_disc_mode, v_sur_mode
    from public.debt_settings s where s.clinic_id is null;

  return jsonb_build_object(
    'problem', v_problem,
    'debt_ids', to_jsonb(v_ids),
    'added_debt_ids', to_jsonb(coalesce(v_missing, '{}')),
    'previous_agreement_ids', to_jsonb(v_prev),
    'clinic_id', v_clinic,
    'supplier_id', v_supplier,
    'titles', v_titles,
    'base_cents', v_base,
    'total_cents', coalesce(v_total, 0),
    'discount_cents', greatest(0, v_base - coalesce(v_total, 0)),
    'surcharge_cents', greatest(0, coalesce(v_total, 0) - v_base),
    'discount_recognition', coalesce(v_disc_mode, 'na_data_do_acordo'),
    'surcharge_recognition', coalesce(v_sur_mode, 'na_data_do_acordo'),
    'installments', v_cnt,
    'first_due', v_first,
    'threshold_cents', v_thr,
    'needs_approval', v_thr is not null and coalesce(v_total, 0) > v_thr,
    'tolerance_bdays', coalesce(nullif(p ->> 'broken_tolerance_bdays', '')::integer,
      (select s.agreement_broken_tolerance_bdays from public.debt_settings s where s.clinic_id = v_clinic),
      (select s.agreement_broken_tolerance_bdays from public.debt_settings s where s.clinic_id is null), 3)
  );
end;
$$;
revoke execute on function public._debt_agreement_check(jsonb) from public, anon, authenticated;

create or replace function public.debt_agreement_preview(p jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v jsonb := public._debt_agreement_check(p);
begin
  if v ->> 'clinic_id' is not null and not public.debt_can('acao.dividas.renegociar', (v ->> 'clinic_id')::uuid) then
    return jsonb_build_object('problem', 'Você não tem permissão para renegociar dívidas.');
  end if;
  return v;
end;
$$;
revoke execute on function public.debt_agreement_preview(jsonb) from public, anon, authenticated;
grant execute on function public.debt_agreement_preview(jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- 11) O ACORDO PASSA A VALER (na hora, ou quando o Admin Master aprova)
-- -----------------------------------------------------------------------------
create or replace function public._debt_agreement_activate(p_agreement_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  a public.debt_agreements%rowtype;
  j record;
  v_pid uuid;
  v_prev uuid[];
  r record;
  v_sup text;
begin
  select * into a from public.debt_agreements where id = p_agreement_id for update;
  if not found then raise exception 'Acordo não encontrado.'; end if;

  perform set_config('risarte.debt_sync', 'on', true);
  perform set_config('risarte.debt_batch', 'on', true);

  -- Os acordos quebrados/restabelecidos destas dívidas: as parcelas em aberto
  -- deles também viram "renegociada"; o quebrado vira "substituído".
  select coalesce(array_agg(distinct x.id), '{}') into v_prev
    from public.debt_agreement_debts ad
    join public.debt_agreements x on x.id = ad.agreement_id
   where ad.debt_id in (select debt_id from public.debt_agreement_debts where agreement_id = a.id)
     and x.id <> a.id and x.status in ('quebrado', 'restabelecido');

  update public.payables
     set status = 'renegociada', renegotiated_by_agreement_id = a.id, updated_at = now()
   where status in ('aberta', 'parcial')
     and ((debt_id in (select debt_id from public.debt_agreement_debts where agreement_id = a.id)
           and debt_link in ('gerado', 'vinculado'))
          or (debt_agreement_id = any (v_prev) and debt_link in ('acordo', 'restabelecido')));

  update public.debt_agreements set status = 'substituido', status_changed_at = now(), updated_at = now(),
         status_reason = 'Substituído pelo acordo ' || a.code
   where id = any (v_prev) and status = 'quebrado';

  select s.name into v_sup from public.suppliers s where s.id = a.supplier_id;
  for j in select (e ->> 'due_date')::date as due, (e ->> 'amount_cents')::bigint as amt,
                  coalesce((e ->> 'entrada')::boolean, false) as entrada, (e ->> 'no')::integer as n,
                  -- "parcela 1/4" conta só as parcelas (a entrada tem nome próprio).
                  row_number() over (partition by coalesce((e ->> 'entrada')::boolean, false)
                                     order by (e ->> 'no')::integer) as pn,
                  count(*) filter (where not coalesce((e ->> 'entrada')::boolean, false)) over () as total
             from jsonb_array_elements(a.schedule) e
            order by (e ->> 'no')::integer loop
    insert into public.payables (clinic_id, supplier_id, account_code, description, document_number,
      accrual_date, due_date, amount_cents, status, approval_mode, requires_approval, notes, created_by,
      debt_id, debt_link, opening_balance, debt_agreement_id, debt_installment_no)
    values (a.clinic_id, a.supplier_id, '5.5.02',
      'Acordo ' || a.code || ' · ' || case when j.entrada then 'entrada' else 'parcela ' || j.pn || '/' || j.total end
        || coalesce(' · ' || v_sup, ''),
      a.code, a.agreed_on, j.due, j.amt, 'aberta', 'automatica', false,
      'Parcela de acordo do Levantamento de Dívidas.', coalesce(a.created_by, v_uid),
      a.primary_debt_id, 'acordo', false, a.id, j.n)
    returning id into v_pid;
    perform public.post_payable_accrual(v_pid);
  end loop;

  -- Desconto obtido / encargos na data do acordo (forma "a"); a forma
  -- proporcional entra a cada pagamento.
  if a.discount_cents > 0 and a.discount_recognition = 'na_data_do_acordo' then
    perform public._debt_agreement_entry(a, 'debt_agreement_discount', a.discount_cents, a.agreed_on, a.id,
      'Desconto obtido — acordo ' || a.code);
  end if;
  if a.surcharge_cents > 0 and a.surcharge_recognition = 'na_data_do_acordo' then
    perform public._debt_agreement_entry(a, 'debt_agreement_surcharge', a.surcharge_cents, a.agreed_on, a.id,
      'Encargos da renegociação — acordo ' || a.code);
  end if;

  update public.debt_agreements set status = 'em_andamento', status_changed_at = now(), updated_at = now()
   where id = a.id;

  if a.proposal_id is not null then
    update public.debt_proposals set status = 'aceita', status_changed_at = now(), status_changed_by = v_uid,
           status_reason = 'Virou o acordo ' || a.code
     where id = a.proposal_id and status = 'ativa';
  end if;

  for r in select debt_id from public.debt_agreement_debts where agreement_id = a.id loop
    insert into public.debt_events (debt_id, user_id, kind, data)
    values (r.debt_id, v_uid, 'acordo_em_andamento', jsonb_build_object('agreement_id', a.id, 'code', a.code,
            'total_cents', a.total_cents, 'base_cents', a.base_cents, 'installments', a.installments));
  end loop;

  perform set_config('risarte.debt_sync', '', true);
  perform set_config('risarte.debt_batch', '', true);
  perform public._debt_agreement_refresh(a.id, false);
  for r in select x from unnest(v_prev) x loop
    perform public._debt_agreement_refresh(r.x, false);
  end loop;
end;
$$;
revoke execute on function public._debt_agreement_activate(uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 12) AS PORTAS: renegociar, aprovar/recusar, desfazer, restabelecer
-- -----------------------------------------------------------------------------
-- p: o da conferência + method, negotiated_by, contact_id, channel, notes
create or replace function public.debt_agreement_save(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v jsonb;
  v_ids uuid[];
  v_prev uuid[];
  v_clinic uuid;
  v_id uuid;
  v_primary uuid;
  v_sum bigint := 0;
  v_raw bigint;
  v_entrada bigint;
  r record;
  v_owner uuid;
  v_sup text;
begin
  v := public._debt_agreement_check(p);
  v_clinic := (v ->> 'clinic_id')::uuid;
  if v_clinic is null or not public.debt_can('acao.dividas.renegociar', v_clinic) then
    raise exception 'Você não tem permissão para renegociar dívidas.';
  end if;
  if v ->> 'problem' is not null then raise exception '%', v ->> 'problem'; end if;

  select array_agg((x #>> '{}')::uuid) into v_ids from jsonb_array_elements(v -> 'debt_ids') x;
  select coalesce(array_agg((x #>> '{}')::uuid), '{}') into v_prev from jsonb_array_elements(v -> 'previous_agreement_ids') x;
  -- Trava as dívidas: dois acordos ao mesmo tempo para a mesma dívida, não.
  perform 1 from public.debts where id = any (v_ids) for update;
  v := public._debt_agreement_check(p);
  if v ->> 'problem' is not null then raise exception '%', v ->> 'problem'; end if;

  -- A dívida principal: a escolhida primeiro (a da tela), senão a de menor código.
  v_primary := nullif(p ->> 'primary_debt_id', '')::uuid;
  if v_primary is null or not (v_primary = any (v_ids)) then
    select id into v_primary from public.debts where id = any (v_ids) order by code limit 1;
  end if;
  select coalesce(sum(nullif(j ->> 'amount_cents', '')::bigint) filter (where (j ->> 'entrada')::boolean), 0)
    into v_entrada from jsonb_array_elements(p -> 'schedule') j;

  insert into public.debt_agreements (clinic_id, supplier_id, primary_debt_id, previous_agreement_id, proposal_id,
    agreed_on, base_cents, total_cents, down_payment_cents, installments, schedule, method,
    discount_cents, surcharge_cents, discount_recognition, surcharge_recognition, broken_tolerance_bdays,
    negotiated_by, contact_id, channel, notes, status, approval_required, created_by)
  values (v_clinic, (v ->> 'supplier_id')::uuid, v_primary,
    (select x.id from public.debt_agreements x where x.id = any (v_prev) order by x.created_at desc limit 1),
    nullif(p ->> 'proposal_id', '')::uuid,
    (p ->> 'agreed_on')::date, (v ->> 'base_cents')::bigint, (v ->> 'total_cents')::bigint, v_entrada,
    (v ->> 'installments')::integer,
    (select jsonb_agg(jsonb_build_object('no', n, 'due_date', e ->> 'due_date',
                                         'amount_cents', (e ->> 'amount_cents')::bigint,
                                         'entrada', coalesce((e ->> 'entrada')::boolean, false)) order by n)
       from jsonb_array_elements(p -> 'schedule') with ordinality as t(e, n)),
    nullif(p ->> 'method', ''),
    (v ->> 'discount_cents')::bigint, (v ->> 'surcharge_cents')::bigint,
    v ->> 'discount_recognition', v ->> 'surcharge_recognition',
    nullif(p ->> 'broken_tolerance_bdays', '')::integer,
    coalesce(nullif(p ->> 'negotiated_by', '')::uuid, v_uid), nullif(p ->> 'contact_id', '')::uuid,
    nullif(p ->> 'channel', ''), nullif(btrim(p ->> 'notes'), ''),
    case when (v ->> 'needs_approval')::boolean then 'aguardando_aprovacao' else 'em_andamento' end,
    (v ->> 'needs_approval')::boolean, v_uid)
  returning id into v_id;

  -- A base de cada dívida (o que faltava nela), para repartir o saldo depois.
  -- O resto do arredondamento (acordo anterior repartido) fica na principal.
  insert into public.debt_agreement_debts (agreement_id, debt_id, base_cents)
  select v_id, x.id,
         x.b + case when x.id = v_primary then (v ->> 'base_cents')::bigint - sum(x.b) over () else 0 end
    from (
    select d.id,
           coalesce((select sum(greatest(0, p.amount_cents - coalesce(p.paid_amount_cents, 0))) from public.payables p
                      where p.debt_id = d.id and p.debt_link in ('gerado', 'vinculado') and p.status in ('aberta', 'parcial')), 0)
         + coalesce((select sum(case when ps.tb > 0 then ps.open_c * ps.base_cents / ps.tb else 0 end)
                       from (select ad.base_cents, (sum(ad.base_cents) over (partition by ad.agreement_id))::bigint tb,
                                    ad.debt_id, ad.agreement_id,
                                    (select coalesce(sum(greatest(0, p.amount_cents - coalesce(p.paid_amount_cents, 0))), 0)
                                       from public.payables p where p.debt_agreement_id = ad.agreement_id
                                        and p.debt_link in ('acordo', 'restabelecido') and p.status in ('aberta', 'parcial')) open_c
                               from public.debt_agreement_debts ad where ad.agreement_id = any (v_prev)) ps
                      where ps.debt_id = d.id), 0)::bigint as b
      from public.debts d where d.id = any (v_ids)
    ) x;

  if (v ->> 'needs_approval')::boolean then
    for r in select debt_id from public.debt_agreement_debts where agreement_id = v_id loop
      insert into public.debt_events (debt_id, user_id, kind, data)
      values (r.debt_id, v_uid, 'acordo_aguardando_aprovacao', jsonb_build_object('agreement_id', v_id,
              'total_cents', (v ->> 'total_cents')::bigint, 'threshold_cents', (v ->> 'threshold_cents')::bigint));
      perform public._debt_refresh_status(r.debt_id, false);
    end loop;
    select owner_user_id into v_owner from public.debts where id = v_primary;
    select s.name into v_sup from public.suppliers s where s.id = (v ->> 'supplier_id')::uuid;
    perform public._debt_notify(v_id, 'acordo_aguardando_aprovacao', '', v_clinic, v_owner, true, true,
      'Dívidas: acordo aguardando a sua aprovação',
      'Acordo de ' || public.brl((v ->> 'total_cents')::bigint) || ' com ' || coalesce(v_sup, 'o credor')
        || ', acima do valor que pede aprovação. Nada é gerado no Contas a Pagar até você decidir.',
      '/financeiro/dividas/' || v_primary || '?aba=acordos');
  else
    perform public._debt_agreement_activate(v_id);
  end if;
  return v_id;
end;
$$;
revoke execute on function public.debt_agreement_save(jsonb) from public, anon, authenticated;
grant execute on function public.debt_agreement_save(jsonb) to authenticated;

-- O Admin Master decide o acordo que esperava aprovação (D8). Quem registrou
-- não aprova o próprio acordo.
create or replace function public.debt_agreement_decide(p_agreement_id uuid, p_approve boolean, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  a public.debt_agreements%rowtype;
  r record;
begin
  select * into a from public.debt_agreements where id = p_agreement_id for update;
  if not found then raise exception 'Acordo não encontrado.'; end if;
  if not public.is_admin_master() then
    raise exception 'Só o Admin Master aprova acordo acima do valor de aprovação.';
  end if;
  if a.status <> 'aguardando_aprovacao' then raise exception 'Este acordo não está aguardando aprovação.'; end if;
  if a.created_by = v_uid then
    raise exception 'Quem registrou o acordo não pode aprová-lo: peça a outro Admin Master.';
  end if;
  if not p_approve and coalesce(length(btrim(p_reason)), 0) < 5 then
    raise exception 'Escreva o motivo da recusa.';
  end if;

  update public.debt_agreements
     set decided_by = v_uid, decided_at = now(), updated_at = now(),
         approved_by = case when p_approve then v_uid end, approved_at = case when p_approve then now() end,
         status = case when p_approve then status else 'recusado' end,
         status_reason = case when p_approve then nullif(btrim(p_reason), '') else btrim(p_reason) end,
         status_changed_at = case when p_approve then status_changed_at else now() end
   where id = a.id;

  for r in select debt_id from public.debt_agreement_debts where agreement_id = a.id loop
    insert into public.debt_events (debt_id, user_id, kind, note, data)
    values (r.debt_id, v_uid, case when p_approve then 'acordo_aprovado' else 'acordo_recusado' end,
            nullif(btrim(p_reason), ''), jsonb_build_object('agreement_id', a.id, 'code', a.code));
  end loop;

  if p_approve then
    -- Se a data do acordo caiu num mês que fechou enquanto esperava, recusa.
    if exists (select 1 from public.fiscal_periods fp
                where fp.clinic_id = a.clinic_id and fp.status = 'closed'
                  and fp.year = extract(year from a.agreed_on)::integer
                  and fp.month = extract(month from a.agreed_on)::integer) then
      raise exception 'A competência de % deste CNPJ foi fechada enquanto o acordo esperava: recuse e registre de novo com uma data num mês aberto.',
        to_char(a.agreed_on, 'MM/YYYY');
    end if;
    perform public._debt_agreement_activate(a.id);
  else
    for r in select debt_id from public.debt_agreement_debts where agreement_id = a.id loop
      perform public._debt_refresh_status(r.debt_id, false);
    end loop;
  end if;
end;
$$;
revoke execute on function public.debt_agreement_decide(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.debt_agreement_decide(uuid, boolean, text) to authenticated;

-- Desfazer: só enquanto nenhuma parcela do acordo foi paga. Tudo volta.
create or replace function public.debt_agreement_undo(p_agreement_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  a public.debt_agreements%rowtype;
  r record;
begin
  select * into a from public.debt_agreements where id = p_agreement_id for update;
  if not found then raise exception 'Acordo não encontrado.'; end if;
  if not public.debt_can('acao.dividas.renegociar', a.clinic_id) then
    raise exception 'Você não tem permissão para desfazer acordos.';
  end if;
  if a.status not in ('aguardando_aprovacao', 'em_andamento', 'quebrado') then
    raise exception 'Só um acordo em andamento, quebrado ou aguardando aprovação pode ser desfeito.';
  end if;
  if coalesce(length(btrim(p_reason)), 0) < 5 then raise exception 'Escreva o motivo para desfazer o acordo.'; end if;
  if exists (select 1 from public.payable_payments pp
               join public.payables p on p.id = pp.payable_id
              where p.debt_agreement_id = a.id and pp.reversal_of is null and not pp.reversed) then
    raise exception 'Já há parcela paga neste acordo: ele não pode mais ser desfeito. Se o credor não cumpriu, registre que ele restabeleceu a dívida.';
  end if;
  if a.status <> 'aguardando_aprovacao' and exists (
       select 1 from public.fiscal_periods fp
        where fp.clinic_id = a.clinic_id and fp.status = 'closed'
          and fp.year = extract(year from a.agreed_on)::integer
          and fp.month = extract(month from a.agreed_on)::integer) then
    raise exception 'A competência de % deste CNPJ (a do acordo) está fechada: reabra-a para desfazer, ou registre que o credor restabeleceu a dívida se o acordo quebrou.',
      to_char(a.agreed_on, 'MM/YYYY');
  end if;
  -- Outro acordo já substituiu este? Desfaça o mais novo primeiro.
  if exists (select 1 from public.payables p where p.debt_agreement_id = a.id and p.status = 'renegociada') then
    raise exception 'Este acordo já foi renegociado de novo: desfaça o acordo mais novo primeiro.';
  end if;

  perform set_config('risarte.debt_sync', 'on', true);
  perform set_config('risarte.debt_batch', 'on', true);

  for r in select id from public.payables where debt_agreement_id = a.id and status not in ('cancelada', 'recusada') loop
    update public.payables
       set status = 'cancelada', cancel_reason = 'Acordo ' || a.code || ' desfeito: ' || btrim(p_reason),
           cancelled_by = v_uid, cancelled_at = now(), updated_at = now()
     where id = r.id;
    update public.financial_entries set status = 'cancelled'
     where source_type = 'payable_accrual' and source_id = r.id;
  end loop;
  perform public._debt_agreement_unrecognize(a.id, false, 'acordo desfeito');

  -- Os títulos que este acordo tinha renegociado voltam ao que eram.
  update public.payables
     set status = case when coalesce(paid_amount_cents, 0) >= amount_cents then 'paga'
                       when coalesce(paid_amount_cents, 0) > 0 then 'parcial' else 'aberta' end,
         renegotiated_by_agreement_id = null, updated_at = now()
   where renegotiated_by_agreement_id = a.id;
  -- E o acordo que ele tinha substituído volta a ser o quebrado.
  update public.debt_agreements set status = 'quebrado', status_changed_at = now(), updated_at = now(),
         status_reason = 'O acordo ' || a.code || ' que o substituiu foi desfeito'
   where id = a.previous_agreement_id and status = 'substituido';

  update public.debt_agreements set status = 'desfeito', status_reason = btrim(p_reason),
         status_changed_at = now(), updated_at = now()
   where id = a.id;
  if a.proposal_id is not null then
    update public.debt_proposals pr
       set status = case when pr.valid_until is not null and pr.valid_until < public.today_br() then 'expirada' else 'ativa' end,
           status_changed_at = now(), status_changed_by = v_uid, status_reason = 'O acordo ' || a.code || ' foi desfeito'
     where pr.id = a.proposal_id and pr.status = 'aceita'
       and not exists (select 1 from public.debt_proposals o where o.status = 'ativa'
                        and ((pr.debt_id is not null and o.debt_id = pr.debt_id) or (pr.group_id is not null and o.group_id = pr.group_id)));
  end if;
  for r in select debt_id from public.debt_agreement_debts where agreement_id = a.id loop
    insert into public.debt_events (debt_id, user_id, kind, note, data)
    values (r.debt_id, v_uid, 'acordo_desfeito', btrim(p_reason), jsonb_build_object('agreement_id', a.id, 'code', a.code));
  end loop;

  perform set_config('risarte.debt_sync', '', true);
  perform set_config('risarte.debt_batch', '', true);
  if a.previous_agreement_id is not null then
    perform public._debt_agreement_refresh(a.previous_agreement_id, false);
  end if;
  for r in select debt_id from public.debt_agreement_debts where agreement_id = a.id loop
    perform public._debt_refresh_status(r.debt_id, false);
  end loop;
end;
$$;
revoke execute on function public.debt_agreement_undo(uuid, text) from public, anon, authenticated;
grant execute on function public.debt_agreement_undo(uuid, text) to authenticated;

-- O credor não aceitou o acordo quebrado e voltou a cobrar o saldo (ajuste 1).
-- p: {due_date, reason}
create or replace function public.debt_agreement_reestablish(p_agreement_id uuid, p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  a public.debt_agreements%rowtype;
  v_paid bigint;
  v_rest bigint;
  v_due date := coalesce(nullif(p ->> 'due_date', '')::date, public.today_br());
  v_reason text := btrim(coalesce(p ->> 'reason', ''));
  v_pid uuid;
  v_sup text;
  r record;
begin
  select * into a from public.debt_agreements where id = p_agreement_id for update;
  if not found then raise exception 'Acordo não encontrado.'; end if;
  if not public.debt_can('acao.dividas.renegociar', a.clinic_id) then
    raise exception 'Você não tem permissão para registrar o restabelecimento.';
  end if;
  if a.status <> 'quebrado' then raise exception 'Só um acordo quebrado pode ter a dívida restabelecida pelo credor.'; end if;
  if length(v_reason) < 5 then raise exception 'Escreva o que o credor informou (o motivo).'; end if;
  if exists (select 1 from public.fiscal_periods fp
              where fp.clinic_id = a.clinic_id and fp.status = 'closed'
                and fp.year = extract(year from public.today_br())::integer
                and fp.month = extract(month from public.today_br())::integer) then
    raise exception 'A competência deste mês está fechada neste CNPJ: reabra antes de registrar o restabelecimento.';
  end if;

  select coalesce(sum(coalesce(p.paid_amount_cents, 0)), 0) into v_paid
    from public.payables p
   where p.debt_agreement_id = a.id and p.debt_link = 'acordo' and p.status not in ('cancelada', 'recusada');
  v_rest := a.base_cents - v_paid;
  if v_rest <= 0 then
    raise exception 'O que já foi pago no acordo (%) cobre o que se devia antes dele (%): não há saldo para restabelecer.',
      public.brl(v_paid), public.brl(a.base_cents);
  end if;

  perform set_config('risarte.debt_sync', 'on', true);
  perform set_config('risarte.debt_batch', 'on', true);

  update public.payables
     set status = 'renegociada', renegotiated_by_agreement_id = a.id, updated_at = now()
   where debt_agreement_id = a.id and debt_link = 'acordo' and status in ('aberta', 'parcial');

  select s.name into v_sup from public.suppliers s where s.id = a.supplier_id;
  insert into public.payables (clinic_id, supplier_id, account_code, description, document_number,
    accrual_date, due_date, amount_cents, status, approval_mode, requires_approval, notes, created_by,
    debt_id, debt_link, opening_balance, debt_agreement_id)
  values (a.clinic_id, a.supplier_id, '5.5.02',
    'Dívida restabelecida · acordo ' || a.code || coalesce(' · ' || v_sup, ''), a.code,
    public.today_br(), v_due, v_rest, 'aberta', 'automatica', false,
    'O credor restabeleceu a dívida depois da quebra do acordo: ' || v_reason, v_uid,
    a.primary_debt_id, 'restabelecido', false, a.id)
  returning id into v_pid;
  perform public.post_payable_accrual(v_pid);

  -- O desconto (e os encargos) reconhecidos até aqui voltam — com data de hoje.
  perform public._debt_agreement_unrecognize(a.id, true, 'credor restabeleceu a dívida');

  update public.debt_agreements set status = 'restabelecido', status_reason = v_reason, restored_payable_id = v_pid,
         status_changed_at = now(), updated_at = now()
   where id = a.id;
  for r in select debt_id from public.debt_agreement_debts where agreement_id = a.id loop
    insert into public.debt_events (debt_id, user_id, kind, note, data)
    values (r.debt_id, v_uid, 'divida_restabelecida', v_reason,
            jsonb_build_object('agreement_id', a.id, 'code', a.code, 'payable_id', v_pid, 'amount_cents', v_rest));
  end loop;

  perform set_config('risarte.debt_sync', '', true);
  perform set_config('risarte.debt_batch', '', true);
  for r in select debt_id from public.debt_agreement_debts where agreement_id = a.id loop
    perform public._debt_refresh_status(r.debt_id, false);
  end loop;
  return v_pid;
end;
$$;
revoke execute on function public.debt_agreement_reestablish(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.debt_agreement_reestablish(uuid, jsonb) to authenticated;

-- O checklist de encerramento. p: {id, done (bool), done_on, applicable,
-- not_applicable_reason, attachment_id, note}
create or replace function public.debt_closing_save(p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  c public.debt_closing_items%rowtype;
  v_clinic uuid;
  v_app boolean := coalesce((p ->> 'applicable')::boolean, true);
  v_done boolean := coalesce((p ->> 'done')::boolean, false);
  v_old text;
  v_new text;
begin
  select * into c from public.debt_closing_items where id = nullif(p ->> 'id', '')::uuid for update;
  if not found then raise exception 'Item do checklist não encontrado.'; end if;
  v_clinic := public._debt_clinic(c.debt_id);
  if v_clinic is null or not public.debt_can('acao.dividas.lancar', v_clinic) then
    raise exception 'Você não tem permissão para mexer no encerramento da dívida.';
  end if;
  if not v_app and coalesce(length(btrim(p ->> 'not_applicable_reason')), 0) < 5 then
    raise exception 'Escreva por que este item não se aplica.';
  end if;
  if nullif(p ->> 'attachment_id', '') is not null and not exists (
       select 1 from public.debt_attachments x where x.id = (p ->> 'attachment_id')::uuid
         and x.debt_id = c.debt_id and x.removed_at is null) then
    raise exception 'O anexo escolhido não é desta dívida.';
  end if;

  update public.debt_closing_items
     set applicable = v_app,
         not_applicable_reason = case when v_app then null else btrim(p ->> 'not_applicable_reason') end,
         done_on = case when v_app and v_done then coalesce(nullif(p ->> 'done_on', '')::date, public.today_br()) end,
         done_by = case when v_app and v_done then v_uid end,
         attachment_id = nullif(p ->> 'attachment_id', '')::uuid,
         note = nullif(btrim(p ->> 'note'), ''),
         updated_by = v_uid, updated_at = now()
   where id = c.id;

  insert into public.debt_events (debt_id, user_id, kind, note, data)
  values (c.debt_id, v_uid, 'encerramento_item',
          case when not v_app then btrim(p ->> 'not_applicable_reason') else nullif(btrim(p ->> 'note'), '') end,
          jsonb_build_object('item', c.item, 'done', v_app and v_done, 'applicable', v_app));

  select status into v_old from public.debts where id = c.debt_id;
  v_new := public._debt_refresh_status(c.debt_id, false);
end;
$$;
revoke execute on function public.debt_closing_save(jsonb) from public, anon, authenticated;
grant execute on function public.debt_closing_save(jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- 13) A DÍVIDA RENEGOCIADA NÃO MUDA O QUE GEROU (nem é excluída)
-- -----------------------------------------------------------------------------
create or replace function public._debt_agreement_blocking(p_debt_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select a.code from public.debt_agreement_debts ad
    join public.debt_agreements a on a.id = ad.agreement_id
   where ad.debt_id = p_debt_id and a.status not in ('desfeito', 'recusado')
   order by a.created_at desc limit 1;
$$;
revoke execute on function public._debt_agreement_blocking(uuid) from public, anon, authenticated;

-- Corpo da 0406 + a trava do acordo.
create or replace function public.debts_finance_resync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text;
begin
  if new.deleted_at is not null or new.finance_synced_at is null or new.origin = 'C' then
    return null;
  end if;
  if new.origin is distinct from old.origin then
    raise exception 'A origem não muda depois de gerar os títulos: exclua a dívida e lance de novo.';
  end if;
  if (new.clinic_id, new.supplier_id, new.account_code, new.category_id, new.original_cents, new.updated_cents,
      new.due_date, new.accrual_month, new.issue_date, new.installment_label, new.contract_number)
     is distinct from
     (old.clinic_id, old.supplier_id, old.account_code, old.category_id, old.original_cents, old.updated_cents,
      old.due_date, old.accrual_month, old.issue_date, old.installment_label, old.contract_number) then
    v_code := public._debt_agreement_blocking(new.id);
    if v_code is not null then
      raise exception 'Esta dívida já foi renegociada (acordo %): valor, vencimento, conta e credor ficam como estavam — o que vale agora é o acordo.', v_code;
    end if;
    perform public._debt_sync_finance(new.id);
  end if;
  return null;
end;
$$;
revoke execute on function public.debts_finance_resync() from public, anon, authenticated;

-- Corpo da 0406 + a trava do acordo.
create or replace function public.debt_delete(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  d public.debts%rowtype;
  p record;
  v_code text;
begin
  select * into d from public.debts where id = p_id and deleted_at is null for update;
  if not found then raise exception 'Dívida não encontrada (ou já excluída).'; end if;
  if not public.debt_can('acao.dividas.excluir', d.clinic_id) then
    raise exception 'Você não tem permissão para excluir dívidas.';
  end if;
  if coalesce(length(btrim(p_reason)), 0) < 5 then
    raise exception 'Escreva o motivo da exclusão.';
  end if;
  v_code := public._debt_agreement_blocking(p_id);
  if v_code is not null then
    raise exception 'Esta dívida está no acordo %: desfaça o acordo antes de excluir (só enquanto nada foi pago nele).', v_code;
  end if;
  if exists (select 1 from public.payables
              where debt_id = p_id and debt_link = 'gerado' and coalesce(paid_amount_cents, 0) > 0
                and status not in ('cancelada', 'recusada')) then
    raise exception 'Esta dívida tem título com pagamento no Contas a Pagar: não pode ser excluída (o pagamento é do Financeiro). Estorne o pagamento antes, se foi lançado por engano.';
  end if;

  perform set_config('risarte.debt_sync', 'on', true);
  for p in select id from public.payables
            where debt_id = p_id and debt_link = 'gerado' and status not in ('cancelada', 'recusada') loop
    update public.payables
       set status = 'cancelada', cancel_reason = 'Dívida excluída: ' || btrim(p_reason),
           cancelled_by = v_uid, cancelled_at = now(), updated_at = now()
     where id = p.id;
    update public.financial_entries set status = 'cancelled'
     where source_type = 'payable_accrual' and source_id = p.id;
  end loop;
  update public.payables set debt_id = null, debt_link = null, updated_at = now()
   where debt_id = p_id and debt_link = 'vinculado';
  perform set_config('risarte.debt_sync', '', true);

  update public.debts
     set deleted_at = now(), deleted_by = v_uid, deleted_reason = btrim(p_reason),
         updated_by = v_uid, updated_at = now()
   where id = p_id;
  insert into public.debt_events (debt_id, user_id, kind, note)
  values (p_id, v_uid, 'excluida', btrim(p_reason));
end;
$$;
revoke execute on function public.debt_delete(uuid, text) from public, anon, authenticated;
grant execute on function public.debt_delete(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 14) A ROTINA DIÁRIA (corpo da 0407 + os acordos) e a fotografia com o saldo
--     da regra única
-- -----------------------------------------------------------------------------
create or replace function public._debt_snapshot_month(p_month date)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_m date := date_trunc('month', p_month)::date;
  v_end date := (date_trunc('month', p_month) + interval '1 month')::date;
  v_end_ts timestamptz := (v_end::timestamp at time zone 'America/Sao_Paulo');
  v_start_ts timestamptz := (v_m::timestamp at time zone 'America/Sao_Paulo');
  v_ids uuid[];
  v_n integer;
begin
  select coalesce(array_agg(d.id), '{}') into v_ids
    from public.debts d
   where d.created_at < v_end_ts and (d.deleted_at is null or d.deleted_at >= v_end_ts);

  insert into public.debt_month_positions (month, debt_id, clinic_id, supplier_id, status, category_id,
    subcategory_id, nature_code, tag_ids, updated_cents, balance_cents, paid_in_month_cents, new_in_month)
  select v_m, d.id, d.clinic_id, d.supplier_id, d.status, d.category_id, d.subcategory_id, d.nature_code,
         coalesce((select array_agg(l.tag_id order by l.tag_id) from public.debt_tag_links l where l.debt_id = d.id), '{}'),
         d.updated_cents,
         coalesce(pos.balance_cents, 0),
         coalesce((
           select sum(pp.amount_cents) from public.payable_payments pp
             join public.payables p on p.id = pp.payable_id
            where (p.debt_id = d.id and p.debt_link in ('gerado', 'vinculado'))
              and pp.reversal_of is null and not pp.reversed
              and pp.paid_at >= v_m and pp.paid_at < v_end), 0)
         + coalesce((
           select sum(pp.amount_cents * ad.base_cents / nullif(a.base_cents, 0)) from public.payable_payments pp
             join public.payables p on p.id = pp.payable_id
             join public.debt_agreements a on a.id = p.debt_agreement_id
             join public.debt_agreement_debts ad on ad.agreement_id = a.id and ad.debt_id = d.id
            where pp.reversal_of is null and not pp.reversed
              and pp.paid_at >= v_m and pp.paid_at < v_end), 0)::bigint,
         d.created_at >= v_start_ts
    from public.debts d
    left join public._debt_positions(v_ids) pos on pos.debt_id = d.id
   where d.id = any (v_ids)
  on conflict (month, debt_id) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke execute on function public._debt_snapshot_month(date) from public, anon, authenticated;

-- Os acordos de todo dia: quebra/retomada/cumprido e o aviso de parcela em
-- atraso no dia seguinte ao vencimento (D9).
create or replace function public._debt_agreements_daily()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_n integer := 0;
  v_owner uuid;
begin
  for r in select id from public.debt_agreements where status in ('em_andamento', 'quebrado', 'cumprido') loop
    perform public._debt_agreement_refresh(r.id, true);
  end loop;

  for r in
    select p.id, p.due_date, p.amount_cents - coalesce(p.paid_amount_cents, 0) as falta, a.id as aid, a.code,
           a.clinic_id, a.primary_debt_id, s.name as credor
      from public.payables p
      join public.debt_agreements a on a.id = p.debt_agreement_id
      left join public.suppliers s on s.id = a.supplier_id
     where p.debt_link = 'acordo' and p.status in ('aberta', 'parcial')
       and p.due_date < public.today_br() and a.status in ('em_andamento', 'quebrado')
  loop
    select owner_user_id into v_owner from public.debts where id = r.primary_debt_id;
    v_n := v_n + public._debt_notify(r.aid, 'parcela_em_atraso', r.id::text, r.clinic_id, v_owner, false, false,
      'Dívidas: parcela do acordo ' || r.code || ' em atraso',
      'Venceu em ' || to_char(r.due_date, 'DD/MM/YYYY') || ' e faltam ' || public.brl(r.falta) || '. Credor: '
        || coalesce(r.credor, '—') || '. Passada a tolerância, o acordo fica quebrado.',
      '/financeiro/dividas/' || r.primary_debt_id || '?aba=acordos');
  end loop;
  return v_n;
end;
$$;
revoke execute on function public._debt_agreements_daily() from public, anon, authenticated;

create or replace function public.debt_daily_run()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_n integer := 0;
  v_old text;
  v_d uuid;
  v_prev date := date_trunc('month', public.today_br() - interval '1 month')::date;
begin
  -- 0408: os acordos primeiro (a situação da dívida depende deles).
  perform public._debt_agreements_daily();

  for r in select id, status from public.debts where deleted_at is null loop
    v_old := r.status;
    if public._debt_refresh_status(r.id, true) is distinct from v_old then
      v_n := v_n + 1;
    end if;
  end loop;

  -- Proposta com validade vencida deixa de ser "ativa" (0405).
  for r in
    update public.debt_proposals
       set status = 'expirada', status_changed_at = now(), status_reason = 'Validade vencida'
     where status = 'ativa' and valid_until is not null and valid_until < public.today_br()
    returning id, debt_id, group_id
  loop
    for v_d in select id from public.debts where (id = r.debt_id or group_id = r.group_id) and deleted_at is null loop
      insert into public.debt_events (debt_id, user_id, kind, note, data)
      values (v_d, null, 'proposta_expirada', 'Validade vencida', jsonb_build_object('id', r.id));
    end loop;
  end loop;

  -- A fotografia do mês que fechou (0407): uma vez só.
  if not exists (select 1 from public.debt_month_positions where month = v_prev) then
    perform public._debt_snapshot_month(v_prev);
  end if;
  return v_n;
end;
$$;
revoke execute on function public.debt_daily_run() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 15) LEITURA (RLS) — só quem tem o módulo; nenhuma regra de escrita
-- -----------------------------------------------------------------------------
alter table public.debt_agreements enable row level security;
alter table public.debt_agreement_debts enable row level security;
alter table public.debt_closing_items enable row level security;
alter table public.debt_notices enable row level security;

drop policy if exists "debt_agreements_select" on public.debt_agreements;
create policy "debt_agreements_select" on public.debt_agreements for select to authenticated
  using (public.debt_can('modulo.dividas', clinic_id));
drop policy if exists "debt_agreement_debts_select" on public.debt_agreement_debts;
create policy "debt_agreement_debts_select" on public.debt_agreement_debts for select to authenticated
  using (exists (select 1 from public.debts d where d.id = debt_id));
drop policy if exists "debt_closing_items_select" on public.debt_closing_items;
create policy "debt_closing_items_select" on public.debt_closing_items for select to authenticated
  using (exists (select 1 from public.debts d where d.id = debt_id));
-- debt_notices: sem regra nenhuma (só a rotina lê e grava).

revoke all on public.debt_agreements, public.debt_agreement_debts, public.debt_closing_items, public.debt_notices
  from anon;

-- -----------------------------------------------------------------------------
-- 16) AUDITORIA
-- -----------------------------------------------------------------------------
insert into public.audit_excluded_tables (schema_name, table_name, motivo) values
  ('public', 'debt_notices', 'Registro técnico dos avisos já mandados pelo Levantamento de Dívidas (0408).')
on conflict (schema_name, table_name) do nothing;

select public.audit_attach_all();

-- -----------------------------------------------------------------------------
-- CONFERÊNCIA (rodar à parte, depois): o esperado é 3 · true · true · 7 · 0
-- -----------------------------------------------------------------------------
-- select
--   (select count(*) from pg_tables where schemaname = 'public'
--      and tablename in ('debt_agreements', 'debt_agreement_debts', 'debt_closing_items')) as tabelas,
--   (select 'acao.dividas.renegociar' = any (select capability from public.permission_defaults)) as permissao,
--   (select pg_get_constraintdef(oid) like '%renegociada%' from pg_constraint where conname = 'payables_status_check') as situacao_nova,
--   (select count(*) from pg_proc where proname in ('debt_agreement_save', 'debt_agreement_preview', 'debt_agreement_decide',
--      'debt_agreement_undo', 'debt_agreement_reestablish', 'debt_closing_save', 'debt_positions')) as portas,
--   (select count(*) from public.audit_missing_tables() t where t.table_name like 'debt%') as sem_auditoria;

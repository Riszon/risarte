-- =============================================================================
-- 4020 — ASA4, ENTREGA 6: o DISTRATO com checklist (spec 19.35, aprovada com
-- ajustes em 16/11/2026 — 19.35.13)
-- -----------------------------------------------------------------------------
--   * O distrato não é automático: o pedido registrado na ficha (Recepção,
--     Gerente, Comercial) ou o contrato em atraso há N dias (Central ›
--     Financeiro, padrão 60) avisam o Gerente, a cada 7 dias; ele abre o
--     distrato ou mantém o contrato, com o motivo (`distrato_requests`).
--   * A CHECKLIST (D12): 8 itens "Feito" ou "Não se aplica, com motivo", mais o
--     termo assinado. Sem ela, nada é cancelado (no Asaas nem no riSZon).
--   * O ACERTO conta, em todo acordo de renegociação da venda (a cadeia), a
--     PARTE da venda — a proporção do principal das parcelas de origem — no
--     pago e no aberto. No acordo de várias vendas, as parcelas abertas são
--     REDUZIDAS na proporção (o termo mostra antes e depois); no acordo só da
--     venda, elas caem e o acordo fica encerrado.
--   * VENDA DIRETA com algo pago passa pelo distrato: acerto sem multa, as
--     sessões feitas continuam feitas.
--   * A parcela PARCIAL cai com as outras; o pago dela está no acerto.
--   * A DEVOLUÇÃO (até a 4020a, só por Pix da conta da unidade): o Gerente pede
--     com o termo anexado; o Financeiro da Franqueadora ou o Admin Master
--     autorizam, e vira conta a pagar 1.9.03. A taxa da rede continua devida.
--   * ORTODONTIA: o caso da venda fica interrompido e as mensalidades futuras
--     caem (o servidor cancela no Asaas antes); as vencidas ficam como dívida.
--   * Indica +Risos como hoje (só a carência volta); o caso convertido aparece
--     para o Financeiro. Riso+ Social: o estorno de uma mensalidade do PPR+
--     pelo Asaas tira os pontos dela.
--   * O distrato aberto avisa o Gerente a cada 7 dias; depois de 30 dias, o
--     Financeiro da Franqueadora também. Nada expira sozinho.
--
-- Nenhuma chamada ao Asaas sai do banco. Idempotente. Não apaga dado.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) A CONFIGURAÇÃO E AS COLUNAS
-- -----------------------------------------------------------------------------
alter table public.finance_settings add column if not exists distrato_overdue_days integer not null default 60;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'finance_settings_distrato_overdue_days_check') then
    alter table public.finance_settings
      add constraint finance_settings_distrato_overdue_days_check check (distrato_overdue_days between 15 and 365);
  end if;
end;
$$;
comment on column public.finance_settings.distrato_overdue_days is
  '4020: dias de atraso do contrato que avisam o Gerente para decidir o distrato (rede; padrão 60).';

create or replace function public._distrato_overdue_days()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select s.distrato_overdue_days from public.finance_settings s where s.clinic_id is null limit 1),
    60
  );
$$;
revoke execute on function public._distrato_overdue_days() from public, anon, authenticated;

alter table public.plan_cancellations alter column negotiation_id drop not null;
alter table public.plan_cancellations add column if not exists direct_sale_id uuid references public.direct_sales (id);
alter table public.plan_cancellations add column if not exists kind text not null default 'contrato';
alter table public.plan_cancellations add column if not exists checklist_required boolean not null default false;
alter table public.plan_cancellations add column if not exists last_alert_at timestamptz;
alter table public.plan_cancellations add column if not exists finance_alerted_at timestamptz;
alter table public.plan_cancellations add column if not exists agreement_changes jsonb;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'plan_cancellations_kind_check') then
    alter table public.plan_cancellations add constraint plan_cancellations_kind_check check (
      (kind = 'contrato' and negotiation_id is not null and direct_sale_id is null)
      or (kind = 'venda_direta' and direct_sale_id is not null and negotiation_id is null));
  end if;
end;
$$;
create unique index if not exists plan_cancellations_direct_sale_open_uq
  on public.plan_cancellations (direct_sale_id) where status in ('rascunho', 'assinado') and direct_sale_id is not null;
comment on column public.plan_cancellations.checklist_required is
  '4020: o distrato com checklist (os abertos antes da 4020 seguem a regra antiga).';

-- CORREÇÃO achada no roteiro do dono (16/11/2026): regras de acesso que chamam
-- funções fechadas para o usuário logado falham com "permission denied" — o
-- "Anexar termo assinado" da renegociação (pasta `renegociacoes`, 4017) nunca
-- funcionava, e as leituras diretas da lista de exceções (4017a) e das listas da
-- forma 2 (4015) também caíam. As duas funções só respondem sim/não sobre a
-- própria pessoa logada: liberar a execução é seguro.
grant execute on function public._is_manager_or_admin(uuid) to authenticated;
grant execute on function public._boleto_mode_can(uuid, uuid) to authenticated;

-- O Gerente da unidade (ou, sem Gerente, os Admin Master): quem decide o distrato.
create or replace function public._distrato_managers(p_clinic_id uuid)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select array_agg(distinct ucr.user_id) from public.user_clinic_roles ucr
       join public.profiles p on p.id = ucr.user_id and p.is_active
      where ucr.clinic_id = p_clinic_id and ucr.role = 'unit_manager'),
    (select array_agg(p.id) from public.profiles p where p.is_admin_master and p.is_active),
    '{}'::uuid[]);
$$;
revoke execute on function public._distrato_managers(uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2) O PEDIDO DE DISTRATO E O AVISO DO ATRASO (o Gerente decide)
-- -----------------------------------------------------------------------------
create table if not exists public.distrato_requests (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id),
  client_id uuid not null references public.clients (id),
  negotiation_id uuid references public.plan_negotiations (id),
  direct_sale_id uuid references public.direct_sales (id),
  origin text not null check (origin in ('pedido', 'atraso')),
  reason text not null,
  requested_by uuid references public.profiles (id),
  requested_at timestamptz not null default now(),
  overdue_since date,
  status text not null default 'aberto' check (status in ('aberto', 'distrato', 'mantido')),
  decided_by uuid references public.profiles (id),
  decided_at timestamptz,
  decision_reason text,
  cancellation_id uuid references public.plan_cancellations (id),
  last_alert_at timestamptz,
  constraint distrato_requests_sale_check check ((negotiation_id is null) <> (direct_sale_id is null))
);
create unique index if not exists distrato_requests_open_uq
  on public.distrato_requests (coalesce(negotiation_id, direct_sale_id)) where status = 'aberto';
create index if not exists distrato_requests_clinic_idx on public.distrato_requests (clinic_id, status);
alter table public.distrato_requests enable row level security;
drop policy if exists distrato_requests_select on public.distrato_requests;
create policy distrato_requests_select on public.distrato_requests for select to authenticated
  using (public.is_admin_master() or public.is_finance_franchisor() or public.can_receive_payment(clinic_id));
comment on table public.distrato_requests is
  '4020: o pedido de distrato (registrado na ficha) ou o aviso do contrato em atraso; o Gerente abre o distrato ou mantém o contrato.';

-- Quem registra o pedido: quem atende (Recepção, Gerente, Coordenação, Comercial).
create or replace function public._distrato_can_request(p_clinic_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin_master()
      or public.has_role_in_clinic(p_clinic_id,
           array['receptionist', 'unit_manager', 'clinical_coordinator', 'commercial_consultant', 'commercial_assistant']::public.user_role[])
      or exists (select 1 from public.user_clinic_roles ucr
                  where ucr.user_id = (select auth.uid())
                    and ucr.role in ('commercial_consultant', 'commercial_assistant'));
$$;
revoke execute on function public._distrato_can_request(uuid) from public, anon, authenticated;

create or replace function public.distrato_request(p_negotiation_id uuid, p_direct_sale_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic uuid;
  v_client uuid;
  v_code text;
  v_id uuid;
  v_user uuid := (select auth.uid());
begin
  if (p_negotiation_id is null) = (p_direct_sale_id is null) then raise exception 'SALE_REQUIRED'; end if;
  if p_negotiation_id is not null then
    select n.clinic_id, n.client_id, n.code into v_clinic, v_client, v_code
      from public.plan_negotiations n where n.id = p_negotiation_id and n.status <> 'cancelada';
  else
    select s.clinic_id, s.client_id, s.code into v_clinic, v_client, v_code
      from public.direct_sales s where s.id = p_direct_sale_id and not coalesce(s.cancelled, false);
  end if;
  if v_clinic is null then raise exception 'NOT_FOUND'; end if;
  if not public._distrato_can_request(v_clinic) then raise exception 'NOT_ALLOWED'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'REASON_REQUIRED'; end if;
  if exists (select 1 from public.distrato_requests r where r.status = 'aberto'
              and coalesce(r.negotiation_id, r.direct_sale_id) = coalesce(p_negotiation_id, p_direct_sale_id)) then
    raise exception 'ALREADY_REQUESTED';
  end if;
  insert into public.distrato_requests (clinic_id, client_id, negotiation_id, direct_sale_id, origin, reason, requested_by, last_alert_at)
  values (v_clinic, v_client, p_negotiation_id, p_direct_sale_id, 'pedido', left(btrim(p_reason), 500), v_user, now())
  returning id into v_id;
  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values (v_user, v_clinic, 'create', 'distrato_request', v_id::text,
          jsonb_build_object('venda', v_code, 'motivo', btrim(p_reason)));
  perform public._notify_users('distrato_pedido', v_id::text, public._distrato_managers(v_clinic), v_clinic,
    'Pedido de distrato para decidir',
    'Foi registrado um pedido de distrato da venda ' || coalesce(v_code, '') || ': ' || left(btrim(p_reason), 200)
      || '. Abra o distrato ou mantenha o contrato, com o motivo.',
    '/prontuarios/' || v_client::text);
  return v_id;
end;
$$;
revoke execute on function public.distrato_request(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.distrato_request(uuid, uuid, text) to authenticated;

-- "Manter o contrato": o Gerente decide, com o motivo. O aviso do atraso para
-- até o próximo vencimento perdido.
create or replace function public.distrato_request_keep(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.distrato_requests%rowtype;
  v_user uuid := (select auth.uid());
begin
  select * into r from public.distrato_requests where id = p_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if not public._is_manager_or_admin(r.clinic_id) then raise exception 'NOT_ALLOWED'; end if;
  if r.status <> 'aberto' then raise exception 'ALREADY_DECIDED'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'REASON_REQUIRED'; end if;
  update public.distrato_requests
     set status = 'mantido', decided_by = v_user, decided_at = now(), decision_reason = left(btrim(p_reason), 500)
   where id = p_id;
  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values (v_user, r.clinic_id, 'update', 'distrato_request', p_id::text,
          jsonb_build_object('decisao', 'manter', 'motivo', btrim(p_reason), 'origem', r.origin));
  if r.requested_by is not null and r.requested_by is distinct from v_user then
    perform public._notify_users('distrato_mantido', p_id::text, array[r.requested_by], r.clinic_id,
      'Pedido de distrato: o contrato foi mantido',
      'O Gerente manteve o contrato: ' || left(btrim(p_reason), 200), '/prontuarios/' || r.client_id::text);
  end if;
end;
$$;
revoke execute on function public.distrato_request_keep(uuid, text) from public, anon, authenticated;
grant execute on function public.distrato_request_keep(uuid, text) to authenticated;

-- A rotina diária: o contrato em atraso há N dias e o distrato aberto.
create or replace function public._distrato_watch_run()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_days integer := public._distrato_overdue_days();
  v_today date := public.today_br();
  v_novos integer := 0;
  v_avisos integer := 0;
  v_abertos integer := 0;
  r record;
  v_id uuid;
begin
  -- (a) o contrato em atraso: a parcela mais antiga vencida da venda (em aberto
  -- ou parcial) há N dias ou mais. Sem pedido aberto e sem "manter" depois do
  -- último vencimento perdido, nasce o aviso; o aviso aberto se repete a cada 7 dias.
  for r in
    select coalesce(i.negotiation_id::text, i.direct_sale_id::text) as venda,
           i.negotiation_id, i.direct_sale_id, min(i.clinic_id::text)::uuid as clinic_id,
           min(i.client_id::text)::uuid as client_id, min(i.due_date) as desde, max(i.due_date) as ultimo
      from public.payment_installments i
     where i.status in ('em_aberto', 'parcial')
       and i.due_date <= v_today - v_days
       and (i.negotiation_id is not null or i.direct_sale_id is not null)
       and (i.negotiation_id is null or exists (
             select 1 from public.commercial_sales cs
              where cs.negotiation_id = i.negotiation_id and cs.closed_at is not null and cs.cancelled_at is null))
       and (i.direct_sale_id is null or exists (
             select 1 from public.direct_sales s where s.id = i.direct_sale_id and not coalesce(s.cancelled, false)))
       and not exists (select 1 from public.plan_cancellations pc
                        where pc.status in ('rascunho', 'assinado')
                          and (pc.negotiation_id = i.negotiation_id or pc.direct_sale_id = i.direct_sale_id))
     group by 1, 2, 3
  loop
    if exists (select 1 from public.distrato_requests d
                where coalesce(d.negotiation_id, d.direct_sale_id)::text = r.venda
                  and d.status = 'mantido' and d.decided_at::date >= (
                    select max(k.due_date) from public.payment_installments k
                     where coalesce(k.negotiation_id, k.direct_sale_id)::text = r.venda
                       and k.status in ('em_aberto', 'parcial') and k.due_date < v_today)) then
      continue;
    end if;
    select d.id into v_id from public.distrato_requests d
     where coalesce(d.negotiation_id, d.direct_sale_id)::text = r.venda and d.status = 'aberto';
    if v_id is null then
      insert into public.distrato_requests (clinic_id, client_id, negotiation_id, direct_sale_id, origin, reason, overdue_since)
      values (r.clinic_id, r.client_id, r.negotiation_id, r.direct_sale_id, 'atraso',
              'Contrato em atraso há ' || (v_today - r.desde) || ' dias (desde ' || to_char(r.desde, 'DD/MM/YYYY') || ').', r.desde)
      returning id into v_id;
      v_novos := v_novos + 1;
    end if;
    update public.distrato_requests d set overdue_since = coalesce(d.overdue_since, r.desde)
     where d.id = v_id and d.overdue_since is null;
    if exists (select 1 from public.distrato_requests d where d.id = v_id
                and (d.last_alert_at is null or d.last_alert_at < now() - interval '7 days')) then
      update public.distrato_requests set last_alert_at = now() where id = v_id;
      v_avisos := v_avisos + public._notify_users('distrato_atraso', v_id::text || ':' || v_today::text,
        public._distrato_managers(r.clinic_id), r.clinic_id,
        'Contrato em atraso: decidir o distrato',
        'Um contrato está em atraso há ' || (v_today - r.desde) || ' dias. Abra o distrato ou mantenha o contrato, com o motivo. O aviso se repete a cada 7 dias.',
        '/prontuarios/' || r.client_id::text);
    end if;
    v_id := null;
  end loop;

  -- (b) o pedido aberto (registrado na ficha) também se repete a cada 7 dias.
  for r in
    select d.* from public.distrato_requests d
     where d.status = 'aberto' and d.origin = 'pedido' and d.last_alert_at < now() - interval '7 days'
  loop
    update public.distrato_requests set last_alert_at = now() where id = r.id;
    v_avisos := v_avisos + public._notify_users('distrato_pedido_lembrete', r.id::text || ':' || v_today::text,
      public._distrato_managers(r.clinic_id), r.clinic_id,
      'Pedido de distrato ainda sem decisão',
      'Há um pedido de distrato esperando a sua decisão: ' || left(r.reason, 200), '/prontuarios/' || r.client_id::text);
  end loop;

  -- (c) o distrato aberto e não efetivado: o Gerente a cada 7 dias; depois de
  -- 30 dias, o Financeiro da Franqueadora também. Nada expira sozinho.
  for r in
    select pc.* from public.plan_cancellations pc
     where pc.checklist_required and pc.status in ('rascunho', 'assinado')
       and (pc.last_alert_at is null or pc.last_alert_at < now() - interval '7 days')
       and pc.created_at < now() - interval '7 days'
  loop
    update public.plan_cancellations set last_alert_at = now() where id = r.id;
    v_abertos := v_abertos + 1;
    perform public._notify_users('distrato_aberto', r.id::text || ':' || v_today::text,
      public._distrato_managers(r.clinic_id), r.clinic_id,
      'Distrato aberto sem efetivar',
      'O distrato ' || coalesce(r.code, '') || ' está aberto há ' || (v_today - (r.created_at at time zone 'America/Sao_Paulo')::date)
        || ' dias. Conclua a checklist e efetive, ou descarte com o motivo.',
      '/cancelamentos/' || r.id::text || '/termo');
    if r.created_at < now() - interval '30 days' then
      update public.plan_cancellations set finance_alerted_at = now() where id = r.id;
      perform public._notify_users('distrato_aberto_financeiro', r.id::text || ':' || v_today::text,
        public._admins_and_finance(), r.clinic_id,
        'Distrato aberto há mais de 30 dias',
        'O distrato ' || coalesce(r.code, '') || ' está aberto há mais de 30 dias, sem efetivar.',
        '/cancelamentos/' || r.id::text || '/termo');
    end if;
  end loop;
  return jsonb_build_object('pedidos_novos', v_novos, 'avisos', v_avisos, 'distratos_abertos_avisados', v_abertos);
end;
$$;
revoke execute on function public._distrato_watch_run() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3) A PARTE DA VENDA NOS ACORDOS (19.35.5): a proporção do principal das
--    parcelas de origem; na cadeia, a proporção se multiplica a cada elo.
-- -----------------------------------------------------------------------------
create or replace function public._distrato_share(p_reneg uuid, p_neg uuid, p_ds uuid, p_depth integer default 0)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_total numeric := 0;
  v_part numeric := 0;
  r record;
begin
  if p_depth > 20 then return 0; end if;
  for r in
    select i.negotiation_id, i.direct_sale_id, i.renegotiation_id,
           coalesce(nullif((select s.principal_rem_cents from public.payment_renegotiation_sources s
                             where s.renegotiation_id = p_reneg and s.installment_id = i.id), 0),
                    i.amount_cents)::numeric as base
      from public.payment_installments i
     where i.renegotiated_by_id = p_reneg
  loop
    v_total := v_total + r.base;
    if (p_neg is not null and r.negotiation_id = p_neg) or (p_ds is not null and r.direct_sale_id = p_ds) then
      v_part := v_part + r.base;
    elsif r.renegotiation_id is not null then
      v_part := v_part + r.base * public._distrato_share(r.renegotiation_id, p_neg, p_ds, p_depth + 1);
    end if;
  end loop;
  if v_total <= 0 then return 0; end if;
  return least(1, v_part / v_total);
end;
$$;
revoke execute on function public._distrato_share(uuid, uuid, uuid, integer) from public, anon, authenticated;

create or replace function public._distrato_agreements(p_neg uuid, p_ds uuid)
returns table (
  renegotiation_id uuid, code text, share numeric, pendente boolean, multi_venda boolean,
  aberto_cents bigint, pago_cents bigint, pago_parte_cents bigint, aberto_parte_cents bigint,
  cartao_a_receber_parte_cents bigint, abertas uuid[]
)
language sql
stable
security definer
set search_path = ''
as $$
  select a.renegotiation_id, a.code, s.share, a.pendente, a.multi_venda, a.aberto_cents, a.pago_cents,
         round(a.pago_cents * s.share)::bigint, round(a.aberto_cents * s.share)::bigint,
         round(a.cartao_a_receber_cents * s.share)::bigint, a.abertas
    from public._sale_agreements(p_neg, p_ds) a
    cross join lateral (select public._distrato_share(a.renegotiation_id, p_neg, p_ds) as share) s;
$$;
revoke execute on function public._distrato_agreements(uuid, uuid) from public, anon, authenticated;

-- O plano do acordo no distrato: o que cai (acordo só desta venda) e o que é
-- reduzido (acordo de várias vendas), parcela a parcela, antes e depois. A
-- redução total é a parte da venda no aberto; os centavos ficam na última.
create or replace function public._distrato_agreement_plan(p_neg uuid, p_ds uuid)
returns table (
  renegotiation_id uuid, code text, share numeric, acao text,
  installment_id uuid, seq integer, due_date date, antes_cents bigint, depois_cents bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  a record;
  k record;
  v_total bigint;
  v_cut bigint;
  v_done bigint;
  v_n integer;
  v_i integer;
  v_c bigint;
begin
  for a in select * from public._distrato_agreements(p_neg, p_ds) x
            where not x.pendente and array_length(x.abertas, 1) is not null and x.share > 0
  loop
    if a.share >= 0.9999 then
      for k in select i.id, i.seq, i.due_date, i.amount_cents from public.payment_installments i
                where i.id = any(a.abertas) order by i.due_date, i.seq
      loop
        renegotiation_id := a.renegotiation_id; code := a.code; share := a.share; acao := 'cancelar';
        installment_id := k.id; seq := k.seq; due_date := k.due_date; antes_cents := k.amount_cents; depois_cents := 0;
        return next;
      end loop;
    else
      select coalesce(sum(i.amount_cents), 0), count(*) into v_total, v_n
        from public.payment_installments i where i.id = any(a.abertas);
      v_cut := round(v_total * a.share);
      v_done := 0; v_i := 0;
      for k in select i.id, i.seq, i.due_date, i.amount_cents,
                      coalesce((select sum(rc.amount_cents) from public.payment_receipts rc
                                 where rc.installment_id = i.id and not coalesce(rc.reversed, false) and rc.reversal_of is null), 0) as pago
                 from public.payment_installments i
                where i.id = any(a.abertas) order by i.due_date, i.seq
      loop
        v_i := v_i + 1;
        v_c := case when v_i = v_n then v_cut - v_done else round(k.amount_cents * a.share) end;
        v_c := least(v_c, greatest(0, k.amount_cents - k.pago - 1));
        v_done := v_done + v_c;
        renegotiation_id := a.renegotiation_id; code := a.code; share := a.share; acao := 'reduzir';
        installment_id := k.id; seq := k.seq; due_date := k.due_date; antes_cents := k.amount_cents;
        depois_cents := k.amount_cents - v_c;
        return next;
      end loop;
    end if;
  end loop;
end;
$$;
revoke execute on function public._distrato_agreement_plan(uuid, uuid) from public, anon, authenticated;

-- Aplica o plano: cai ou reduz; o acordo sem parcela aberta fica encerrado.
-- O servidor já cancelou os boletos vivos dessas parcelas no Asaas; a parcela
-- reduzida volta à rotina das cobranças com o valor novo.
create or replace function public._distrato_apply_agreements(p_cancellation_id uuid, p_neg uuid, p_ds uuid, p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan jsonb;
  p record;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
           'acordo', x.renegotiation_id, 'codigo', x.code, 'parte', round(x.share, 6), 'acao', x.acao,
           'parcela', x.installment_id, 'seq', x.seq, 'vencimento', x.due_date,
           'antes', x.antes_cents, 'depois', x.depois_cents) order by x.code, x.due_date, x.seq), '[]'::jsonb)
    into v_plan
    from public._distrato_agreement_plan(p_neg, p_ds) x;
  for p in select * from public._distrato_agreement_plan(p_neg, p_ds) loop
    if p.acao = 'cancelar' then
      update public.payment_installments set status = 'cancelada' where id = p.installment_id and status in ('em_aberto', 'parcial');
    elsif p.depois_cents < p.antes_cents then
      update public.payment_installments set amount_cents = p.depois_cents where id = p.installment_id;
    end if;
  end loop;
  update public.payment_renegotiations r set status = 'encerrada'
   where r.id in (select (e ->> 'acordo')::uuid from jsonb_array_elements(v_plan) e)
     and r.status not in ('encerrada')
     and not exists (select 1 from public.payment_installments k where k.renegotiation_id = r.id and k.status in ('em_aberto', 'parcial'));
  update public.plan_cancellations set agreement_changes = v_plan where id = p_cancellation_id;
  if jsonb_array_length(v_plan) > 0 then
    insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
    select p_actor, pc.clinic_id, 'update', 'distrato_agreements', p_cancellation_id::text, jsonb_build_object('plano', v_plan)
      from public.plan_cancellations pc where pc.id = p_cancellation_id;
  end if;
  return v_plan;
end;
$$;
revoke execute on function public._distrato_apply_agreements(uuid, uuid, uuid, uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4) A CHECKLIST (D12)
-- -----------------------------------------------------------------------------
create table if not exists public.distrato_checklist (
  cancellation_id uuid not null references public.plan_cancellations (id) on delete cascade,
  item smallint not null check (item between 1 and 8),
  state text not null check (state in ('feito', 'nao_se_aplica')),
  reason text,
  done_by uuid references public.profiles (id),
  done_at timestamptz not null default now(),
  primary key (cancellation_id, item),
  constraint distrato_checklist_reason_check check (state = 'feito' or length(btrim(coalesce(reason, ''))) >= 5)
);
alter table public.distrato_checklist enable row level security;
drop policy if exists distrato_checklist_select on public.distrato_checklist;
create policy distrato_checklist_select on public.distrato_checklist for select to authenticated
  using (exists (select 1 from public.plan_cancellations pc where pc.id = cancellation_id
                  and (public.is_admin_master() or public.is_finance_franchisor() or public._is_manager_or_admin(pc.clinic_id))));
comment on table public.distrato_checklist is
  '4020 (D12): os 8 itens da checklist do distrato (o 9º é o termo assinado). Feito, ou "não se aplica" com motivo.';

create or replace function public.distrato_checklist_set(p_id uuid, p_item integer, p_state text, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_c public.plan_cancellations%rowtype;
  v_user uuid := (select auth.uid());
begin
  select * into v_c from public.plan_cancellations where id = p_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  if not public._is_manager_or_admin(v_c.clinic_id) then raise exception 'NOT_ALLOWED'; end if;
  if v_c.status not in ('rascunho', 'assinado') then raise exception 'ALREADY_APPLIED'; end if;
  if p_item is null or p_item not between 1 and 8 then raise exception 'ITEM_INVALID'; end if;
  if p_state is null then
    delete from public.distrato_checklist where cancellation_id = p_id and item = p_item;
  else
    if p_state not in ('feito', 'nao_se_aplica') then raise exception 'STATE_INVALID'; end if;
    if p_state = 'nao_se_aplica' and length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'REASON_REQUIRED'; end if;
    insert into public.distrato_checklist (cancellation_id, item, state, reason, done_by)
    values (p_id, p_item, p_state, nullif(btrim(coalesce(p_reason, '')), ''), v_user)
    on conflict (cancellation_id, item) do update
      set state = excluded.state, reason = excluded.reason, done_by = excluded.done_by, done_at = now();
  end if;
  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values (v_user, v_c.clinic_id, 'update', 'distrato_checklist', p_id::text,
          jsonb_build_object('item', p_item, 'situacao', p_state, 'motivo', p_reason));
end;
$$;
revoke execute on function public.distrato_checklist_set(uuid, integer, text, text) from public, anon, authenticated;
grant execute on function public.distrato_checklist_set(uuid, integer, text, text) to authenticated;

-- O pago de agora (para conferir que nada entrou depois do termo).
create or replace function public._distrato_paid_now(p_neg uuid, p_ds uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select sum(r.amount_cents) from public.payment_receipts r
                     join public.payment_installments i on i.id = r.installment_id
                    where ((p_neg is not null and i.negotiation_id = p_neg) or (p_ds is not null and i.direct_sale_id = p_ds))
                      and not r.reversed and r.reversal_of is null), 0)::bigint
       + coalesce((select sum(a.pago_parte_cents) from public._distrato_agreements(p_neg, p_ds) a where not a.pendente), 0)::bigint;
$$;
revoke execute on function public._distrato_paid_now(uuid, uuid) from public, anon, authenticated;

-- Pronto para efetivar? Os 8 itens e o termo assinado; e nada pago depois do
-- termo (senão o acerto do termo não vale: descarte e abra de novo).
create or replace function public._distrato_ready(p_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_c public.plan_cancellations%rowtype;
  v_n integer;
begin
  select * into v_c from public.plan_cancellations where id = p_id;
  select count(*) into v_n from public.distrato_checklist where cancellation_id = p_id;
  if v_n < 8 then raise exception 'CHECKLIST_INCOMPLETE: %', 8 - v_n; end if;
  if v_c.exception_id is null
     and public._distrato_paid_now(v_c.negotiation_id, v_c.direct_sale_id) <> v_c.paid_cents then
    raise exception 'SETTLEMENT_CHANGED';
  end if;
end;
$$;
revoke execute on function public._distrato_ready(uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 5) A VENDA DIRETA COM ALGO PAGO (19.35.9, 4a): acerto sem multa, as sessões
--    feitas continuam feitas
-- -----------------------------------------------------------------------------
create or replace function public.open_direct_sale_distrato(p_sale_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_s record;
  v_user uuid := (select auth.uid());
  v_items bigint;
  v_done bigint;
  v_executed bigint;
  v_paid bigint;
  v_agr_paid bigint := 0;
  v_agr_card bigint := 0;
  v_diff bigint;
  v_id uuid;
begin
  select * into v_s from public.direct_sales where id = p_sale_id;
  if v_s.id is null then raise exception 'NOT_FOUND'; end if;
  if not public._is_manager_or_admin(v_s.clinic_id) then raise exception 'NOT_ALLOWED'; end if;
  if coalesce(v_s.cancelled, false) then raise exception 'ALREADY_CANCELLED'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'REASON_REQUIRED'; end if;
  if exists (select 1 from public.plan_cancellations pc where pc.direct_sale_id = p_sale_id and pc.status in ('rascunho', 'assinado')) then
    raise exception 'ALREADY_OPEN';
  end if;
  if exists (select 1 from public._sale_agreements(null, p_sale_id) a where a.pendente) then
    raise exception 'PENDING_FIRST';
  end if;
  -- O feito: os itens com a sessão concluída, na proporção do valor final da venda.
  select coalesce(sum(it.final_cents), 0),
         coalesce(sum(it.final_cents) filter (where exists (
           select 1 from public.treatment_sessions ts where ts.id = it.session_id and ts.status = 'done')), 0)
    into v_items, v_done
    from public.direct_sale_items it where it.sale_id = p_sale_id;
  v_executed := case when v_items > 0 then least(coalesce(v_s.final_cents, 0), round(v_done * coalesce(v_s.final_cents, 0)::numeric / v_items))
                     else 0 end;
  select coalesce(sum(a.pago_parte_cents), 0), coalesce(sum(a.cartao_a_receber_parte_cents), 0)
    into v_agr_paid, v_agr_card from public._distrato_agreements(null, p_sale_id) a where not a.pendente;
  v_paid := public._distrato_paid_now(null, p_sale_id);
  v_diff := v_executed - v_paid;
  insert into public.plan_cancellations (
    code, clinic_id, client_id, negotiation_id, direct_sale_id, kind, plan_id, reason,
    contract_cents, list_total_cents, executed_list_cents, executed_cents, pending_cents,
    penalty_percent, penalty_cents, due_cents, paid_cents, reversed_cents,
    client_owes_cents, clinic_refunds_cents, created_by, agreement_paid_cents, agreement_card_pending_cents,
    checklist_required
  ) values (
    public.next_cancellation_code(), v_s.clinic_id, v_s.client_id, null, p_sale_id, 'venda_direta', null, btrim(p_reason),
    coalesce(v_s.final_cents, 0), v_items, v_done, v_executed, greatest(0, coalesce(v_s.final_cents, 0) - v_executed),
    0, 0, v_executed, v_paid, 0,
    greatest(0, v_diff), greatest(0, -v_diff), v_user, v_agr_paid, v_agr_card,
    true
  ) returning id into v_id;
  update public.distrato_requests set status = 'distrato', decided_by = v_user, decided_at = now(),
         decision_reason = 'Distrato aberto', cancellation_id = v_id
   where direct_sale_id = p_sale_id and status = 'aberto';
  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values (v_user, v_s.clinic_id, 'create', 'plan_cancellation', v_id::text,
          jsonb_build_object('tipo', 'venda_direta', 'venda', v_s.code, 'pago', v_paid, 'feito', v_executed));
  return v_id;
end;
$$;
revoke execute on function public.open_direct_sale_distrato(uuid, text) from public, anon, authenticated;
grant execute on function public.open_direct_sale_distrato(uuid, text) to authenticated;

create or replace function public._apply_direct_sale_distrato(p_id uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_c public.plan_cancellations%rowtype;
  v_s record;
begin
  select * into v_c from public.plan_cancellations where id = p_id;
  select * into v_s from public.direct_sales where id = v_c.direct_sale_id;
  perform set_config('risarte.cancelar_com_acordo', '1', true);
  update public.direct_sales set
    cancelled = true, status = 'cancelada', cancelled_at = now(), cancelled_by = p_user, updated_at = now()
  where id = v_c.direct_sale_id;
  -- 4a: o que já foi feito continua feito; só o que não foi feito é cancelado.
  update public.treatment_sessions set status = 'cancelled', appointment_id = null
   where direct_sale_id = v_c.direct_sale_id and status not in ('cancelled', 'done');
  update public.payment_installments set status = 'cancelada'
   where direct_sale_id = v_c.direct_sale_id and status in ('em_aberto', 'parcial');
  perform public._distrato_apply_agreements(p_id, null, v_c.direct_sale_id, p_user);
  if v_c.client_owes_cents > 0 then
    insert into public.payment_installments
      (clinic_id, client_id, direct_sale_id, seq, kind, due_date, amount_cents, payment_method, created_by)
    values (v_c.clinic_id, v_c.client_id, v_c.direct_sale_id, 999, 'parcela',
            public.today_br() + 15, v_c.client_owes_cents, coalesce(v_s.payment_method, 'pix'), p_user);
  end if;
  update public.plan_cancellations set status = 'efetivado', applied_at = now(), applied_by = p_user where id = p_id;
  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values (p_user, v_c.clinic_id, 'update', 'plan_cancellation_apply', p_id::text,
          jsonb_build_object('tipo', 'venda_direta', 'owes', v_c.client_owes_cents, 'refunds', v_c.clinic_refunds_cents));
end;
$$;
revoke execute on function public._apply_direct_sale_distrato(uuid, uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 6) ORTODONTIA E INDICA no distrato
-- -----------------------------------------------------------------------------
-- O caso da venda fica interrompido e as mensalidades futuras caem (o servidor
-- já cancelou no Asaas as que tinham cobrança viva). As vencidas ficam.
create or replace function public._distrato_ortho(p_neg uuid, p_reason text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer := 0;
begin
  if p_neg is null then return 0; end if;
  update public.ortho_charges ch set status = 'cancelada', notes = left(coalesce(ch.notes || ' · ', '') || 'Distrato da venda', 500)
   where ch.case_id in (select oc.id from public.ortho_cases oc where oc.negotiation_id = p_neg)
     and ch.status = 'em_aberto' and ch.due_date >= public.today_br();
  get diagnostics v_n = row_count;
  update public.ortho_cases set status = 'interrompido', interrupted_at = public.today_br(),
         interrupt_reason = left('Distrato: ' || coalesce(p_reason, ''), 300)
   where negotiation_id = p_neg and status in ('aguardando_inicio', 'em_tratamento', 'contencao');
  return v_n;
end;
$$;
revoke execute on function public._distrato_ortho(uuid, text) from public, anon, authenticated;

-- Os ids das mensalidades da Ortodontia que o distrato vai cancelar (o servidor
-- cancela as cobranças vivas delas no Asaas antes).
create or replace function public._distrato_ortho_future(p_neg uuid)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(ch.id), '{}'::uuid[])
    from public.ortho_charges ch
    join public.ortho_cases oc on oc.id = ch.case_id
   where p_neg is not null and oc.negotiation_id = p_neg
     and ch.status = 'em_aberto' and ch.due_date >= public.today_br();
$$;
revoke execute on function public._distrato_ortho_future(uuid) from public, anon, authenticated;
grant execute on function public._distrato_ortho_future(uuid) to service_role;

-- -----------------------------------------------------------------------------
-- 7) A DEVOLUÇÃO POR PIX DA CONTA DA UNIDADE (19.35.13, ajuste 1)
-- -----------------------------------------------------------------------------
create table if not exists public.distrato_refunds (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id),
  cancellation_id uuid not null references public.plan_cancellations (id),
  client_id uuid references public.clients (id),
  amount_cents bigint not null check (amount_cents > 0),
  method text not null default 'pix_unidade' check (method in ('pix_unidade', 'estorno_asaas')),
  reason text not null check (length(btrim(reason)) >= 5),
  term_path text not null,
  term_name text,
  status text not null default 'pedida' check (status in ('pedida', 'autorizada', 'negada')),
  requested_by uuid references public.profiles (id),
  requested_at timestamptz not null default now(),
  decided_by uuid references public.profiles (id),
  decided_at timestamptz,
  decision_note text,
  payable_id uuid references public.payables (id)
);
create index if not exists distrato_refunds_cancellation_idx on public.distrato_refunds (cancellation_id);
alter table public.distrato_refunds enable row level security;
drop policy if exists distrato_refunds_select on public.distrato_refunds;
create policy distrato_refunds_select on public.distrato_refunds for select to authenticated
  using (public.can_manage_payables(clinic_id) or public.is_finance_franchisor() or public.is_admin_master());
comment on table public.distrato_refunds is
  '4020: a devolução ao paciente no distrato, por Pix da conta da unidade, com o termo assinado e a autorização do Financeiro da Franqueadora ou do Admin Master.';

create or replace function public.distrato_refund_request(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_c public.plan_cancellations%rowtype;
  v_amount bigint := (p ->> 'amount_cents')::bigint;
  v_reason text := btrim(coalesce(p ->> 'reason', ''));
  v_path text := nullif(btrim(p ->> 'term_path'), '');
  v_already bigint;
  v_id uuid;
  v_user uuid := (select auth.uid());
begin
  select * into v_c from public.plan_cancellations where id = (p ->> 'cancellation_id')::uuid;
  if not found then raise exception 'NOT_FOUND'; end if;
  if not public._is_manager_or_admin(v_c.clinic_id) then raise exception 'NOT_ALLOWED'; end if;
  if v_c.status <> 'efetivado' then raise exception 'NOT_APPLIED'; end if;
  if length(v_reason) < 5 then raise exception 'REASON_REQUIRED'; end if;
  if v_path is null or public.clinic_of_storage_path(v_path) is distinct from v_c.clinic_id
     or not exists (select 1 from storage.objects o where o.bucket_id = 'devolucoes' and o.name = v_path) then
    raise exception 'TERM_REQUIRED';
  end if;
  select coalesce(sum(r.amount_cents), 0) into v_already
    from public.distrato_refunds r where r.cancellation_id = v_c.id and r.status <> 'negada';
  if coalesce(v_amount, 0) <= 0 or v_amount > v_c.clinic_refunds_cents - v_already then
    raise exception 'AMOUNT_OVER_BALANCE';
  end if;
  insert into public.distrato_refunds (clinic_id, cancellation_id, client_id, amount_cents, reason, term_path, term_name, requested_by)
  values (v_c.clinic_id, v_c.id, v_c.client_id, v_amount, v_reason, v_path, nullif(btrim(p ->> 'term_name'), ''), v_user)
  returning id into v_id;
  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values (v_user, v_c.clinic_id, 'create', 'distrato_refund', v_id::text,
          jsonb_build_object('distrato', v_c.code, 'amount_cents', v_amount, 'reason', v_reason));
  perform public._notify_users('distrato_devolucao_pedida', v_id::text, public._admins_and_finance(), v_c.clinic_id,
    'Devolução do distrato para autorizar',
    'Pedido de devolução ao paciente de ' || public.brl(v_amount) || ' no distrato ' || coalesce(v_c.code, '')
      || ', por Pix da conta da unidade. Confira o termo assinado e autorize ou negue.',
    '/financeiro/cobrancas-automaticas');
  return v_id;
end;
$$;
revoke execute on function public.distrato_refund_request(jsonb) from public, anon, authenticated;
grant execute on function public.distrato_refund_request(jsonb) to authenticated;

create or replace function public.distrato_refund_decide(p_id uuid, p_approve boolean, p_note text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.distrato_refunds%rowtype;
  v_c public.plan_cancellations%rowtype;
  v_user uuid := (select auth.uid());
  v_payable uuid;
  v_nome text;
begin
  if not (public.is_admin_master() or public.is_finance_franchisor()) then raise exception 'NOT_ALLOWED'; end if;
  select * into r from public.distrato_refunds where id = p_id for update;
  if not found then raise exception 'RETURN_NOT_FOUND'; end if;
  if r.status <> 'pedida' then raise exception 'RETURN_ALREADY_DECIDED'; end if;
  if r.requested_by = v_user then raise exception 'SELF_APPROVAL'; end if;
  if not p_approve and length(btrim(coalesce(p_note, ''))) < 5 then raise exception 'REASON_REQUIRED'; end if;
  select * into v_c from public.plan_cancellations where id = r.cancellation_id;
  if p_approve then
    select full_name into v_nome from public.clients where id = r.client_id;
    insert into public.payables (clinic_id, account_code, description, reference, accrual_date, due_date,
                                 amount_cents, status, notes, created_by)
    values (r.clinic_id, '1.9.03',
            'Devolução ao paciente — distrato ' || coalesce(v_c.code, '') || coalesce(' — ' || v_nome, ''),
            coalesce(v_c.code, 'DEV-' || left(r.id::text, 8)), public.today_br(), public.today_br() + 5,
            r.amount_cents, 'aberta',
            'Pagar por Pix da conta da unidade e anexar o comprovante. O recebimento original não é desfeito e a taxa da rede continua devida. Termo assinado: ' || r.term_path,
            v_user)
    returning id into v_payable;
  end if;
  update public.distrato_refunds
     set status = case when p_approve then 'autorizada' else 'negada' end,
         decided_by = v_user, decided_at = now(), decision_note = nullif(btrim(coalesce(p_note, '')), ''),
         payable_id = v_payable
   where id = p_id;
  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values (v_user, r.clinic_id, 'update', 'distrato_refund', p_id::text,
          jsonb_build_object('approve', p_approve, 'note', p_note, 'payable_id', v_payable));
  perform public._notify_users('distrato_devolucao_decidida', p_id::text, array[r.requested_by], r.clinic_id,
    case when p_approve then 'Devolução do distrato autorizada' else 'Devolução do distrato negada' end,
    case when p_approve then 'A devolução virou conta a pagar da unidade (Contas a pagar). Pague pelo Pix da conta da unidade e anexe o comprovante.'
         else 'A devolução foi negada: ' || coalesce(p_note, '') end,
    '/prontuarios/' || r.client_id::text);
  return v_payable;
end;
$$;
revoke execute on function public.distrato_refund_decide(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.distrato_refund_decide(uuid, boolean, text) to authenticated;

-- Todas as devoluções, dos dois tipos (o Financeiro da Franqueadora vê a rede;
-- o Gerente, a unidade): o estorno pelo Asaas (4009), a devolução por Pix do
-- cartão parcelado (4014) e a do distrato (4020).
create or replace function public.devolucoes_read()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(x order by (x ->> 'situacao') = 'pedida' desc, (x ->> 'pedido_em') desc), '[]'::jsonb)
    from (
      select jsonb_build_object(
               'id', r.id, 'tipo', 'pix_unidade', 'origem', 'distrato ' || coalesce(pc.code, ''),
               'unidade', cl.name, 'cliente', c.full_name, 'client_id', r.client_id, 'valor', r.amount_cents,
               'motivo', r.reason, 'situacao', r.status, 'pedido_em', r.requested_at,
               'quem_pediu', (select p.full_name from public.profiles p where p.id = r.requested_by),
               'termo', r.term_path, 'nota', r.decision_note,
               'pode_decidir', r.status = 'pedida' and (public.is_finance_franchisor() or public.is_admin_master())
                               and r.requested_by is distinct from (select auth.uid())) as x
        from public.distrato_refunds r
        join public.plan_cancellations pc on pc.id = r.cancellation_id
        join public.clinics cl on cl.id = r.clinic_id
        left join public.clients c on c.id = r.client_id
       where public.is_finance_franchisor() or public.is_admin_master() or public.can_manage_payables(r.clinic_id)
      union all
      select jsonb_build_object(
               'id', b.id, 'tipo', 'pix_unidade', 'origem', 'cartão parcelado (desistência)',
               'unidade', cl.name, 'cliente', c.full_name, 'client_id', b.client_id, 'valor', b.amount_cents,
               'motivo', b.reason, 'situacao', b.status, 'pedido_em', b.requested_at,
               'quem_pediu', (select p.full_name from public.profiles p where p.id = b.requested_by),
               'termo', b.term_path, 'nota', b.decision_note, 'pode_decidir', false)
        from public.card_block_returns b
        join public.clinics cl on cl.id = b.clinic_id
        left join public.clients c on c.id = b.client_id
       where public.is_finance_franchisor() or public.is_admin_master() or public.can_manage_payables(b.clinic_id)
      union all
      select jsonb_build_object(
               'id', cr.id, 'tipo', 'estorno_asaas', 'origem', 'estorno pelo Asaas',
               'unidade', cl.name, 'cliente', c.full_name, 'client_id', ch.client_id, 'valor', ch.paid_cents,
               'motivo', cr.reason, 'situacao', cr.status, 'pedido_em', cr.requested_at,
               'quem_pediu', (select p.full_name from public.profiles p where p.id = cr.requested_by),
               'termo', null, 'nota', null, 'pode_decidir', false)
        from public.charge_refunds cr
        join public.charges ch on ch.id = cr.charge_id
        join public.clinics cl on cl.id = ch.clinic_id
        left join public.clients c on c.id = ch.client_id
       where public.is_finance_franchisor() or public.is_admin_master() or public.can_manage_payables(ch.clinic_id)
    ) t
   where (x ->> 'situacao') in ('pedida', 'pedido') or (x ->> 'pedido_em')::timestamptz > now() - interval '90 days';
$$;
revoke execute on function public.devolucoes_read() from public, anon, authenticated;
grant execute on function public.devolucoes_read() to authenticated;

-- -----------------------------------------------------------------------------
-- 8) AS LEITURAS DAS TELAS
-- -----------------------------------------------------------------------------
-- O distrato inteiro, para a checklist e o termo.
create or replace function public.distrato_read(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_c public.plan_cancellations%rowtype;
  v_neg uuid;
  v_ds uuid;
  v_ins uuid[];
  v_pct_unidade numeric;
  v_pct_rede numeric;
begin
  select * into v_c from public.plan_cancellations where id = p_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  if not (public.is_admin_master() or public.is_finance_franchisor() or public._is_manager_or_admin(v_c.clinic_id)
          or public.can_receive_payment(v_c.clinic_id)) then
    raise exception 'NOT_ALLOWED';
  end if;
  v_neg := v_c.negotiation_id;
  v_ds := v_c.direct_sale_id;
  select array_agg(i.id) into v_ins from public.payment_installments i
   where ((v_neg is not null and i.negotiation_id = v_neg) or (v_ds is not null and i.direct_sale_id = v_ds));
  select u.cancellation_penalty_percent into v_pct_unidade from public.commercial_rules u where u.clinic_id = v_c.clinic_id;
  select n.cancellation_penalty_percent into v_pct_rede from public.commercial_rules n where n.clinic_id is null;
  return jsonb_build_object(
    'id', v_c.id, 'codigo', v_c.code, 'tipo', v_c.kind, 'situacao', v_c.status,
    'checklist_obrigatoria', v_c.checklist_required,
    'pode_operar', public._is_manager_or_admin(v_c.clinic_id) and v_c.status in ('rascunho', 'assinado'),
    'pode_pedir_devolucao', public._is_manager_or_admin(v_c.clinic_id) and v_c.status = 'efetivado',
    'aberto_em', v_c.created_at, 'dias_aberto', public.today_br() - (v_c.created_at at time zone 'America/Sao_Paulo')::date,
    'acerto', jsonb_build_object(
      'contrato', v_c.contract_cents, 'feito', v_c.executed_cents, 'pendente', v_c.pending_cents,
      'multa_pct', v_c.penalty_percent, 'multa', v_c.penalty_cents, 'devido', v_c.due_cents,
      'pago', v_c.paid_cents, 'pago_no_acordo', v_c.agreement_paid_cents,
      'cartao_a_receber', v_c.agreement_card_pending_cents,
      'cliente_deve', v_c.client_owes_cents, 'unidade_devolve', v_c.clinic_refunds_cents,
      'pago_agora', public._distrato_paid_now(v_neg, v_ds)),
    'multa', jsonb_build_object(
      'pct', v_c.penalty_percent,
      'origem', case when v_c.kind = 'venda_direta' then 'sem_multa'
                     when v_pct_unidade is not null then 'unidade'
                     when v_pct_rede is not null then 'rede' else 'zero' end),
    'checklist', coalesce((select jsonb_object_agg(k.item::text, jsonb_build_object(
        'situacao', k.state, 'motivo', k.reason, 'quem', (select p.full_name from public.profiles p where p.id = k.done_by),
        'quando', k.done_at)) from public.distrato_checklist k where k.cancellation_id = p_id), '{}'::jsonb),
    'pendencias', jsonb_build_object(
      'sessoes_a_cancelar', (select count(*) from public.treatment_sessions ts
                              where ((v_c.plan_id is not null and ts.plan_id = v_c.plan_id) or (v_ds is not null and ts.direct_sale_id = v_ds))
                                and ts.status not in ('cancelled', 'done')),
      'sessoes_feitas', (select count(*) from public.treatment_sessions ts
                          where ((v_c.plan_id is not null and ts.plan_id = v_c.plan_id) or (v_ds is not null and ts.direct_sale_id = v_ds))
                            and ts.status = 'done'),
      'consultas_futuras', (select count(*) from public.treatment_sessions ts
                             join public.appointments ap on ap.id = ts.appointment_id
                            where ((v_c.plan_id is not null and ts.plan_id = v_c.plan_id) or (v_ds is not null and ts.direct_sale_id = v_ds))
                              and ts.status not in ('cancelled', 'done') and ap.starts_at > now())),
    'acordos', coalesce((select jsonb_agg(jsonb_build_object(
        'id', a.renegotiation_id, 'codigo', a.code, 'parte', round(a.share * 100, 2), 'multi_venda', a.multi_venda,
        'pendente', a.pendente, 'aberto', a.aberto_cents, 'pago', a.pago_cents,
        'pago_parte', a.pago_parte_cents, 'aberto_parte', a.aberto_parte_cents) order by a.code)
      from public._distrato_agreements(v_neg, v_ds) a
     where a.pendente or array_length(a.abertas, 1) is not null or a.pago_cents > 0), '[]'::jsonb),
    'plano_dos_acordos', coalesce(v_c.agreement_changes, (select jsonb_agg(jsonb_build_object(
        'codigo', x.code, 'parte', round(x.share * 100, 2), 'acao', x.acao, 'seq', x.seq, 'vencimento', x.due_date,
        'antes', x.antes_cents, 'depois', x.depois_cents) order by x.code, x.due_date, x.seq)
      from public._distrato_agreement_plan(v_neg, v_ds) x), '[]'::jsonb),
    'cobrancas_vivas', coalesce((select jsonb_agg(jsonb_build_object(
        'id', ch.id, 'meio', ch.billing_type, 'valor', ch.value_cents, 'vencimento', ch.due_date,
        'situacao', ch.status, 'parcelado', ch.installment_block is not null) order by ch.due_date)
      from public.charges ch
      join public.payment_installments i on i.id = ch.payment_installment_id
     where ch.status in ('emitindo', 'emitida', 'vencida', 'erro_emissao')
       and (i.id = any(coalesce(v_ins, '{}'))
         or i.id in (select unnest(a.abertas) from public._distrato_agreements(v_neg, v_ds) a))), '[]'::jsonb),
    'listas_forma2', (select count(*) from public.boleto_lists b
                       where b.revoked_at is null and b.expires_at >= public.today_br()
                         and ((v_neg is not null and b.negotiation_id = v_neg) or (v_ds is not null and b.direct_sale_id = v_ds))),
    'ortodontia', (select jsonb_build_object(
        'casos_ativos', count(distinct oc.id) filter (where oc.status in ('aguardando_inicio', 'em_tratamento', 'contencao')),
        'futuras', count(ch.id) filter (where ch.status = 'em_aberto' and ch.due_date >= public.today_br()),
        'futuras_valor', coalesce(sum(ch.amount_cents) filter (where ch.status = 'em_aberto' and ch.due_date >= public.today_br()), 0),
        'vencidas', count(ch.id) filter (where ch.status in ('em_aberto', 'atrasada') and ch.due_date < public.today_br()),
        'vencidas_valor', coalesce(sum(ch.amount_cents) filter (where ch.status in ('em_aberto', 'atrasada') and ch.due_date < public.today_br()), 0))
      from public.ortho_cases oc left join public.ortho_charges ch on ch.case_id = oc.id
     where v_neg is not null and oc.negotiation_id = v_neg),
    'taxa_da_rede', (select jsonb_build_object(
        'recebimentos', count(distinct r.id),
        'taxa', coalesce(sum(sc.amount_cents) filter (where not sc.reversed or sc.kept_after_refund), 0),
        'dispensada', coalesce(sum(sc.amount_cents) filter (where sc.waived_at is not null), 0))
      from public.payment_receipts r
      left join public.split_charges sc on sc.receipt_id = r.id
     where r.installment_id = any(coalesce(v_ins, '{}')) and not r.reversed and r.reversal_of is null),
    'indica', (select jsonb_build_object('situacao', ind.status)
                 from indica.indicacoes ind where v_neg is not null and ind.orcamento_id = v_neg
                order by (ind.status = 'convertida') desc, (ind.status = 'fechou') desc limit 1),
    'devolucoes', coalesce((select jsonb_agg(jsonb_build_object(
        'id', r.id, 'valor', r.amount_cents, 'situacao', r.status, 'pedido_em', r.requested_at, 'nota', r.decision_note)
        order by r.requested_at) from public.distrato_refunds r where r.cancellation_id = p_id), '[]'::jsonb)
  );
end;
$$;
revoke execute on function public.distrato_read(uuid) from public, anon, authenticated;
grant execute on function public.distrato_read(uuid) to authenticated;

-- A lista do Gerente e do Financeiro: os pedidos e avisos abertos e os
-- distratos abertos (Financeiro › Cobranças automáticas).
create or replace function public.distratos_read()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'pedidos', coalesce((select jsonb_agg(jsonb_build_object(
        'id', d.id, 'unidade', cl.name, 'cliente', c.full_name, 'client_id', d.client_id,
        'venda', coalesce(n.code, s.code), 'negotiation_id', d.negotiation_id, 'direct_sale_id', d.direct_sale_id,
        'origem', d.origin, 'motivo', d.reason, 'pedido_em', d.requested_at, 'atraso_desde', d.overdue_since,
        'quem_pediu', (select p.full_name from public.profiles p where p.id = d.requested_by),
        'pode_decidir', public._is_manager_or_admin(d.clinic_id)) order by d.requested_at)
      from public.distrato_requests d
      join public.clinics cl on cl.id = d.clinic_id
      left join public.clients c on c.id = d.client_id
      left join public.plan_negotiations n on n.id = d.negotiation_id
      left join public.direct_sales s on s.id = d.direct_sale_id
     where d.status = 'aberto'
       and (public.is_admin_master() or public.is_finance_franchisor() or public._is_manager_or_admin(d.clinic_id))), '[]'::jsonb),
    'abertos', coalesce((select jsonb_agg(jsonb_build_object(
        'id', pc.id, 'codigo', pc.code, 'unidade', cl.name, 'cliente', c.full_name, 'client_id', pc.client_id,
        'tipo', pc.kind, 'situacao', pc.status, 'aberto_em', pc.created_at,
        'dias', public.today_br() - (pc.created_at at time zone 'America/Sao_Paulo')::date,
        'itens_feitos', (select count(*) from public.distrato_checklist k where k.cancellation_id = pc.id)) order by pc.created_at)
      from public.plan_cancellations pc
      join public.clinics cl on cl.id = pc.clinic_id
      left join public.clients c on c.id = pc.client_id
     where pc.checklist_required and pc.status in ('rascunho', 'assinado')
       and (public.is_admin_master() or public.is_finance_franchisor() or public._is_manager_or_admin(pc.clinic_id))), '[]'::jsonb));
$$;
revoke execute on function public.distratos_read() from public, anon, authenticated;
grant execute on function public.distratos_read() to authenticated;

-- A ficha: o pedido aberto da venda (para o botão "Pedir distrato").
create or replace function public.distrato_sale_status(p_negotiation_id uuid, p_direct_sale_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'pedido', (select jsonb_build_object('id', d.id, 'origem', d.origin, 'motivo', d.reason, 'pedido_em', d.requested_at)
                 from public.distrato_requests d
                where d.status = 'aberto' and coalesce(d.negotiation_id, d.direct_sale_id) = coalesce(p_negotiation_id, p_direct_sale_id)),
    'distrato', (select jsonb_build_object('id', pc.id, 'codigo', pc.code, 'situacao', pc.status)
                   from public.plan_cancellations pc
                  where pc.status in ('rascunho', 'assinado')
                    and ((p_negotiation_id is not null and pc.negotiation_id = p_negotiation_id)
                      or (p_direct_sale_id is not null and pc.direct_sale_id = p_direct_sale_id))
                  limit 1),
    'pago', public._distrato_paid_now(p_negotiation_id, p_direct_sale_id),
    'pode_pedir', public._distrato_can_request(v.clinic_id),
    'pode_decidir', public._is_manager_or_admin(v.clinic_id))
    from (select coalesce((select n.clinic_id from public.plan_negotiations n where n.id = p_negotiation_id),
                          (select s.clinic_id from public.direct_sales s where s.id = p_direct_sale_id)) as clinic_id) v;
$$;
revoke execute on function public.distrato_sale_status(uuid, uuid) from public, anon, authenticated;
grant execute on function public.distrato_sale_status(uuid, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 9) AS REDEFINIÇÕES (o texto de hoje, com os pontos da 4020 marcados)
-- -----------------------------------------------------------------------------
-- 4020: abrir o distrato não é recusado pelo acordo (o distrato trata os acordos).
CREATE OR REPLACE FUNCTION public._open_agreement_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_codes text[];
begin
  if coalesce(current_setting('risarte.cancelar_com_acordo', true), '') = '1' then
    return new;
  end if;
  if tg_table_name = 'plan_cancellations' then
    -- 4020: o distrato (com a checklist) trata os acordos da venda: a parte
    -- dela cai ou é reduzida. Abrir não muda nada.
    return new;
  elsif tg_table_name = 'commercial_sales' then
    if old.cancelled_at is not null or new.cancelled_at is null then return new; end if;
    if public._sale_cancel_exception_valid(new.negotiation_id, null) is not null then return new; end if;
    v_codes := public._sale_open_agreements(new.negotiation_id, null);
  elsif tg_table_name = 'direct_sales' then
    if coalesce(old.cancelled, false) or not coalesce(new.cancelled, false) then return new; end if;
    if public._sale_cancel_exception_valid(null, new.id) is not null then return new; end if;
    v_codes := public._sale_open_agreements(null, new.id);
  end if;
  if array_length(v_codes, 1) is not null then
    raise exception 'RENEGOTIATED_OPEN: %', array_to_string(v_codes, ', ');
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.log_cancellation_plan_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_neg_code text;
begin
  if new.plan_id is null then return new; end if;  -- 4020: venda direta não tem plano
  if new.status = 'efetivado' and old.status is distinct from 'efetivado' then
    select coalesce(n.code, '(sem código)') into v_neg_code
    from public.plan_negotiations n where n.id = new.negotiation_id;

    perform public.log_plan_event(
      new.plan_id, new.clinic_id, 'cancelamento_efetivado',
      'Cancelamento efetivado — venda ' || v_neg_code
        || ', termo ' || coalesce(new.code, '')
        || ' · ' || new.reason
        || case when new.client_owes_cents > 0
                then '. Paciente deve R$ ' || (new.client_owes_cents / 100)::text
                when new.clinic_refunds_cents > 0
                then '. Clínica devolve R$ ' || (new.clinic_refunds_cents / 100)::text
                else '. Sem saldo entre as partes' end);
  end if;
  if new.status = 'assinado' and old.status is distinct from 'assinado' then
    perform public.log_plan_event(
      new.plan_id, new.clinic_id, 'termo_cancelamento_assinado',
      'Termo de cancelamento ' || coalesce(new.code, '') || ' assinado pelo paciente');
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.open_plan_cancellation(p_negotiation_id uuid, p_reason text, p_destination text DEFAULT NULL::text, p_return_date date DEFAULT NULL::date, p_notes text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_neg record;
  v_sale record;
  v_user uuid := (select auth.uid());
  v_id uuid;
  v_closed boolean;
  v_list bigint := 0;
  v_exec_list bigint := 0;
  v_paid bigint := 0;
  v_reversed bigint := 0;
  v_ratio numeric;
  v_executed bigint;
  v_pending bigint;
  v_pct numeric;
  v_penalty bigint;
  v_due bigint;
  v_diff bigint;
  v_outra boolean;
  -- 4017a: a exceção autorizada e o pago no acordo
  v_exc uuid;
  v_agr_paid bigint := 0;
  v_agr_card bigint := 0;
begin
  select * into v_neg from public.plan_negotiations where id = p_negotiation_id;
  if v_neg.id is null then raise exception 'NOT_FOUND'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'REASON_REQUIRED'; end if;

  -- Cancelar tratamento é ato de gestão.
  if not (
    public.is_admin_master()
    or public.has_role_in_clinic(
         v_neg.clinic_id, array['unit_manager']::public.user_role[])
  ) then
    raise exception 'NOT_ALLOWED';
  end if;

  if exists (select 1 from public.plan_cancellations
             where negotiation_id = p_negotiation_id
               and status in ('rascunho', 'assinado')) then
    raise exception 'ALREADY_OPEN';
  end if;
  if v_neg.status = 'cancelada' then raise exception 'ALREADY_CANCELLED'; end if;

  select * into v_sale from public.commercial_sales
   where negotiation_id = p_negotiation_id;
  v_closed := v_sale.id is not null and v_sale.closed_at is not null;

  -- AP107 (0360): se o cliente segue em tratamento com OUTRA venda (o plano
  -- original ou um complemento), cancelar esta não muda a fase — sem destino.
  v_outra := public._outra_venda_em_tratamento(v_neg.client_id, p_negotiation_id);

  -- Venda fechada exige destino; acompanhamento exige data de retorno.
  if v_closed and not v_outra then
    if p_destination is null then raise exception 'DESTINATION_REQUIRED'; end if;
    if p_destination not in ('reevaluation', 'follow_up') then
      raise exception 'INVALID_DESTINATION';
    end if;
    if p_destination = 'follow_up' and p_return_date is null then
      raise exception 'RETURN_DATE_REQUIRED';
    end if;
  end if;

  -- Itens contratados, a preço de TABELA (base da proporção do desconto).
  select coalesce(sum(oi.quantity * oi.unit_price_cents), 0) into v_list
  from public.plan_negotiation_items ni
  join public.treatment_plan_option_items oi on oi.id = ni.item_id
  where ni.negotiation_id = p_negotiation_id
    and ni.included
    and oi.option_id = v_neg.option_id;

  -- O que JÁ FOI EXECUTADO, também a preço de tabela. Sessão concluída é
  -- histórico clínico: o paciente passou por ela e ela é devida.
  select coalesce(sum(oi.unit_price_cents), 0) into v_exec_list
  from public.treatment_sessions ts
  join public.treatment_plan_option_items oi on oi.id = ts.item_id
  where ts.plan_id = v_neg.plan_id
    and ts.status = 'done'
    and oi.option_id = v_neg.option_id;

  -- Dinheiro que entrou (baixas ativas) e o que já foi estornado antes.
  select coalesce(sum(r.amount_cents) filter
           (where not r.reversed and r.reversal_of is null), 0),
         coalesce(sum(r.amount_cents) filter (where r.reversal_of is not null), 0)
    into v_paid, v_reversed
  from public.payment_receipts r
  join public.payment_installments i on i.id = r.installment_id
  where i.negotiation_id = p_negotiation_id;

  -- 4017a (19.30.3): com a exceção autorizada, o "pago" do acerto inclui o que
  -- o cliente pagou nas parcelas do acordo (a cadeia inteira). O cartão
  -- parcelado aprovado conta inteiro (a baixa nasce na aprovação).
  v_exc := public._sale_cancel_exception_valid(p_negotiation_id, null);
  if v_exc is not null then
    select coalesce(sum(a.pago_cents), 0), coalesce(sum(a.cartao_a_receber_cents), 0)
      into v_agr_paid, v_agr_card
      from public._sale_agreements(p_negotiation_id, null) a;
    v_paid := v_paid + v_agr_paid;
  else
    -- 4020 (19.35.5): sem a exceção, o acordo que ainda não vale é cancelado
    -- antes; o pago no acordo entra na PARTE da venda (a proporção da origem).
    if exists (select 1 from public._sale_agreements(p_negotiation_id, null) a where a.pendente) then
      raise exception 'PENDING_FIRST';
    end if;
    select coalesce(sum(a.pago_parte_cents), 0), coalesce(sum(a.cartao_a_receber_parte_cents), 0)
      into v_agr_paid, v_agr_card
      from public._distrato_agreements(p_negotiation_id, null) a where not a.pendente;
    v_paid := v_paid + v_agr_paid;
  end if;

  -- O ACERTO (espelha src/lib/finance/cancellation.ts).
  v_ratio := case when v_list > 0
                  then coalesce(v_neg.final_cents, 0)::numeric / v_list
                  else 1 end;
  v_executed := least(coalesce(v_neg.final_cents, 0),
                      round(v_exec_list * v_ratio));
  v_pending := greatest(0, coalesce(v_neg.final_cents, 0) - v_executed);
  v_pct := public.cancellation_penalty_percent(v_neg.clinic_id);
  v_penalty := case when v_pct > 0 then round(v_pending * v_pct / 100.0) else 0 end;
  v_due := v_executed + v_penalty;
  v_diff := v_due - v_paid;

  insert into public.plan_cancellations (
    code, clinic_id, client_id, negotiation_id, plan_id,
    reason, notes, destination, follow_up_return_at,
    contract_cents, list_total_cents, executed_list_cents,
    executed_cents, pending_cents, penalty_percent, penalty_cents,
    due_cents, paid_cents, reversed_cents,
    client_owes_cents, clinic_refunds_cents, created_by,
    agreement_paid_cents, agreement_card_pending_cents, exception_id,
    kind, checklist_required
  ) values (
    public.next_cancellation_code(), v_neg.clinic_id, v_neg.client_id,
    p_negotiation_id, v_neg.plan_id,
    btrim(p_reason), nullif(btrim(p_notes), ''),
    case when v_closed and not v_outra then p_destination else null end,
    case when v_closed and not v_outra and p_destination = 'follow_up' then p_return_date end,
    coalesce(v_neg.final_cents, 0), v_list, v_exec_list,
    v_executed, v_pending, v_pct, v_penalty,
    v_due, v_paid, v_reversed,
    greatest(0, v_diff), greatest(0, -v_diff), v_user,
    v_agr_paid, v_agr_card, v_exc,
    'contrato', true
  )
  returning id into v_id;

  -- 4020: o pedido (ou o aviso do atraso) desta venda vira o distrato.
  update public.distrato_requests set status = 'distrato', decided_by = v_user, decided_at = now(),
         decision_reason = 'Distrato aberto', cancellation_id = v_id
   where negotiation_id = p_negotiation_id and status = 'aberto';

  insert into public.audit_logs
    (user_id, clinic_id, action, entity_type, entity_id, details)
  values (v_user, v_neg.clinic_id, 'create', 'plan_cancellation', v_id::text,
          jsonb_build_object('destination', p_destination, 'closed', v_closed));

  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.apply_plan_cancellation(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_c record;
  v_neg record;
  v_user uuid := (select auth.uid());
  v_client_name text;
  v_phase text;
  v_card uuid;
  v_outra boolean;
  v_exc uuid;
begin
  select * into v_c from public.plan_cancellations where id = p_id;
  if v_c.id is null then raise exception 'NOT_FOUND'; end if;
  if v_c.status = 'efetivado' then raise exception 'ALREADY_APPLIED'; end if;
  if v_c.status <> 'assinado' then raise exception 'TERM_NOT_SIGNED'; end if;
  -- 4020 (D12): o distrato só é efetivado com a checklist concluída e sem
  -- pagamento depois do termo.
  if v_c.checklist_required then
    perform public._distrato_ready(p_id);
  end if;
  if not (
    public.is_admin_master()
    or public.has_role_in_clinic(
         v_c.clinic_id, array['unit_manager']::public.user_role[])
  ) then raise exception 'NOT_ALLOWED'; end if;

  -- 4017a: o termo aberto com a exceção só é efetivado se ela ainda valer
  -- (no prazo, não usada, e o acordo igual ao do pedido).
  if v_c.exception_id is not null then
    v_exc := public._sale_cancel_exception_valid(v_c.negotiation_id, null);
    if v_exc is distinct from v_c.exception_id then raise exception 'EXCEPTION_INVALID'; end if;
  end if;

  -- 4020: o distrato da venda direta.
  if v_c.kind = 'venda_direta' then
    perform public._apply_direct_sale_distrato(p_id, v_user);
    return;
  end if;
  if v_c.checklist_required then
    -- o distrato trata os acordos da venda (a trava da 4015a deixa seguir).
    perform set_config('risarte.cancelar_com_acordo', '1', true);
  end if;

  select * into v_neg from public.plan_negotiations where id = v_c.negotiation_id;
  -- AP107 (0360): outra venda segue em tratamento? Então só esta é cancelada.
  v_outra := public._outra_venda_em_tratamento(v_c.client_id, v_c.negotiation_id);

  update public.plan_negotiations
     set status = 'cancelada', updated_at = now()
   where id = v_c.negotiation_id;

  update public.commercial_sales set
    cancelled_at = now(), cancelled_by = v_user,
    cancel_reason = v_c.reason, updated_at = now()
  where negotiation_id = v_c.negotiation_id and cancelled_at is null;

  -- O que JÁ FOI FEITO não é desfeito: é histórico clínico do paciente.
  update public.treatment_sessions set
    status = 'cancelled', appointment_id = null
  where plan_id = v_c.plan_id and status not in ('cancelled', 'done');

  -- 4020 (6a): a parcial também cai (o pago dela está no acerto).
  update public.payment_installments set status = 'cancelada'
   where negotiation_id = v_c.negotiation_id
     and (status = 'em_aberto' or (v_c.checklist_required and status = 'parcial'));

  -- 4017a: com a exceção, as parcelas do acordo em aberto são canceladas e o
  -- acordo fica encerrado (o servidor já cancelou os boletos no Asaas).
  if v_c.exception_id is not null then
    perform public._sale_agreements_close(v_c.negotiation_id, null, v_c.exception_id, v_user);
  elsif v_c.checklist_required then
    -- 4020 (19.35.5): a parte da venda em cada acordo cai ou é reduzida.
    perform public._distrato_apply_agreements(p_id, v_c.negotiation_id, null, v_user);
  end if;
  if v_c.checklist_required then
    -- 4020: o caso da Ortodontia fica interrompido e as mensalidades futuras caem.
    perform public._distrato_ortho(v_c.negotiation_id, v_c.reason);
  end if;

  if v_c.client_owes_cents > 0 then
    insert into public.payment_installments
      (clinic_id, client_id, negotiation_id, seq, kind, due_date,
       amount_cents, payment_method, created_by)
    values (v_c.clinic_id, v_c.client_id, v_c.negotiation_id, 999, 'parcela',
            public.today_br() + 15, v_c.client_owes_cents,
            v_neg.payment_method, v_user);
  end if;

  -- 4020: no distrato, a devolução é pedida pelo Gerente com o termo anexado e
  -- autorizada pelo Financeiro (`distrato_refund_request`); só o antigo cria a conta.
  if v_c.clinic_refunds_cents > 0 and not v_c.checklist_required then
    insert into public.payables
      (clinic_id, account_code, description, reference, accrual_date, due_date,
       amount_cents, status, notes, created_by)
    values (
      v_c.clinic_id, '1.9.03',
      'Devolução ao paciente — cancelamento ' || coalesce(v_c.code, ''),
      coalesce(v_c.code, ''), public.today_br(), public.today_br() + 15,
      v_c.clinic_refunds_cents, 'aberta',
      'Termo de cancelamento assinado. Definir a forma de devolução com o '
        || 'paciente (o meio original nem sempre aceita estorno).',
      v_user);
  end if;

  -- 0207: O COCKPIT PRECISA SABER. Sem isto o caso sumia do quadro E do
  -- histórico — a coluna "Cancelado" lê o stage do cartão, não a negociação.
  v_card := public.commercial_ensure_card(v_c.client_id);
  -- AP107: o cartão só fica "cancelado" quando não sobra tratamento.
  if not v_outra then
    update public.commercial_cards set
      stage = 'cancelado',
      outcome_reason = v_c.reason,
      updated_by = v_user,
      updated_at = now()
    where id = v_card;
  end if;

  perform public.commercial_log_card_event(
    v_card, v_c.client_id, v_c.clinic_id, 'cancelamento',
    case when v_outra then 'VENDA CANCELADA (o tratamento segue com a outra venda) — '
         else 'TRATAMENTO CANCELADO — ' end || v_c.reason
      || case when v_c.client_owes_cents > 0
              then '. Paciente deve R$ ' || (v_c.client_owes_cents / 100)::text
              when v_c.clinic_refunds_cents > 0
              then '. Clínica devolve R$ ' || (v_c.clinic_refunds_cents / 100)::text
              else '. Sem saldo entre as partes' end);

  if v_c.destination is not null and not v_outra then
    v_phase := case when v_c.destination = 'reevaluation'
                    then 'reevaluation' else 'follow_up' end;

    update public.journey_phase_history set exited_at = now()
    where client_id = v_c.client_id and exited_at is null;
    insert into public.journey_phase_history (client_id, clinic_id, phase, moved_by)
    values (v_c.client_id, v_c.clinic_id, v_phase::public.journey_phase, v_user);
    update public.clients set
      journey_phase = v_phase::public.journey_phase,
      phase_entered_at = now(),
      follow_up_return_at = case when v_c.destination = 'follow_up'
                                 then v_c.follow_up_return_at
                                 else follow_up_return_at end
    where id = v_c.client_id;
  end if;

  update public.plan_cancellations
     set status = 'efetivado', applied_at = now(), applied_by = v_user
   where id = p_id;

  -- 4020 (5b): o Indica como hoje (a carência volta pela regra do programa); o
  -- caso já convertido aparece para o Financeiro.
  if v_c.checklist_required and exists (select 1 from indica.indicacoes ind
                                          where ind.orcamento_id = v_c.negotiation_id and ind.status = 'convertida') then
    perform public._notify_users('distrato_indica', p_id::text, public._admins_and_finance(), v_c.clinic_id,
      'Distrato de venda indicada (Indica +Risos)',
      'O distrato ' || coalesce(v_c.code, '') || ' é de uma venda indicada que já tinha virado pontos disponíveis. Pela regra do programa, eles ficam. Confira o caso.',
      '/prontuarios/' || v_c.client_id::text);
  end if;
  if v_c.checklist_required and v_c.clinic_refunds_cents > 0 then
    perform public._notify_users('distrato_devolver', p_id::text, public._distrato_managers(v_c.clinic_id), v_c.clinic_id,
      'Distrato efetivado: pedir a devolução',
      'O distrato ' || coalesce(v_c.code, '') || ' tem ' || public.brl(v_c.clinic_refunds_cents)
        || ' a devolver ao paciente. Peça a devolução com o termo assinado anexado; o Financeiro da Franqueadora autoriza.',
      '/cancelamentos/' || p_id::text || '/termo');
  end if;

  select full_name into v_client_name from public.clients where id = v_c.client_id;

  insert into public.notifications (user_id, clinic_id, title, body, link)
  select ucr.user_id, v_c.clinic_id,
    case when v_c.destination = 'reevaluation'
         then 'Cancelamento — agendar REAVALIAÇÃO'
         else 'Cancelamento — agendar RETORNO do acompanhamento' end,
    coalesce(v_client_name, 'Cliente') || ' teve o tratamento cancelado ('
      || v_c.reason || ').'
      || case when v_c.destination = 'follow_up' and v_c.follow_up_return_at is not null
              then ' Retorno combinado para '
                   || to_char(v_c.follow_up_return_at, 'DD/MM/YYYY') || '.'
              else ' Agende a reavaliação com o Coordenador Clínico.' end,
    '/prontuarios/' || v_c.client_id
  from public.user_clinic_roles ucr
  where ucr.clinic_id = v_c.clinic_id
    and ucr.role in ('receptionist', 'clinical_coordinator', 'unit_manager')
    and ucr.user_id is distinct from v_user
    and v_c.destination is not null
    and not v_outra;

  insert into public.audit_logs
    (user_id, clinic_id, action, entity_type, entity_id, details)
  values (v_user, v_c.clinic_id, 'update', 'plan_cancellation_apply',
          p_id::text,
          jsonb_build_object('owes', v_c.client_owes_cents,
                             'refunds', v_c.clinic_refunds_cents,
                             'destination', v_c.destination));
end;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_direct_sale(p_sale_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_sale record;
  v_user uuid := (select auth.uid());
  v_exc uuid;
begin
  select * into v_sale from public.direct_sales where id = p_sale_id;
  if v_sale.id is null then raise exception 'NOT_FOUND'; end if;
  if v_sale.closed_at is not null then raise exception 'ALREADY_CLOSED'; end if;

  if not (
    public.is_admin_master()
    or public.has_role_in_clinic(
         v_sale.clinic_id,
         array['receptionist','unit_manager']::public.user_role[])
  ) then
    raise exception 'NOT_ALLOWED';
  end if;

  -- 4020 (4a): com algo pago (na venda ou na parte dela num acordo), o
  -- cancelamento é o distrato, com o acerto.
  if public._distrato_paid_now(null, p_sale_id) > 0 then
    raise exception 'DISTRATO_REQUIRED';
  end if;

  -- 4017a: a exceção autorizada (lida antes de a venda mudar).
  v_exc := public._sale_cancel_exception_valid(null, p_sale_id);

  update public.direct_sales set
    cancelled = true,
    status = 'cancelada',
    cancelled_at = now(),
    cancelled_by = v_user,
    updated_at = now()
  where id = p_sale_id;

  -- Os procedimentos da venda deixam de valer: saem de "concluído"/"em aberto"
  -- e ficam CANCELADOS (o histórico continua visível, mas não conta como feito
  -- nem aparece como pendente para agendar).
  update public.treatment_sessions set
    status = 'cancelled',
    done_at = null,
    executed_by = null,
    appointment_id = null
  where direct_sale_id = p_sale_id
    and status <> 'cancelled';

  -- Venda cancelada devolve o benefício do programa (a limpeza volta a estar
  -- liberada, por exemplo).
  delete from public.ppr_benefit_usages where direct_sale_id = p_sale_id;

  -- As cobranças da venda cancelada também deixam de existir (o Financeiro não
  -- deve cobrar por venda cancelada).
  update public.payment_installments set status = 'cancelada'
   where direct_sale_id = p_sale_id and status = 'em_aberto';

  -- 4017a: com a exceção (o cliente não pagou nada no acordo), as parcelas do
  -- acordo em aberto são canceladas e o acordo fica encerrado.
  if v_exc is not null then
    perform public._sale_agreements_close(null, p_sale_id, v_exc, v_user);
  end if;

  insert into public.audit_logs
    (user_id, clinic_id, action, entity_type, entity_id, details)
  values (v_user, v_sale.clinic_id, 'update', 'direct_sale_cancel',
          p_sale_id::text, jsonb_build_object('sessions_cancelled', true));
end;
$function$;

CREATE OR REPLACE FUNCTION public._gateway_apply_event(p_event_id bigint)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  e public.gateway_webhook_events%rowtype;
  p jsonb;
  v_ref text;
  c public.charges%rowtype;
  v_link text;
  v_other boolean;
  v_rec public.payment_receipts%rowtype;
begin
  select * into e from public.gateway_webhook_events w where w.id = p_event_id;

  -- Chave e situação da conta: aviso ao Admin.
  if e.event like 'ACCESS_TOKEN_%' or e.event like 'ACCOUNT_STATUS_%' then
    perform public._gateway_notify_admins(e.account_id, lower(e.event), e.asaas_event_id,
      'Asaas: atenção na conta',
      'O Asaas avisou: ' || e.event || '. Confira a conta na Central de Configuração.');
    return 'aviso_admin';
  end if;
  if e.event not like 'PAYMENT_%' then return 'sem_efeito'; end if;
  if e.event like 'PAYMENT_SPLIT_%' then return 'registrado_asa3'; end if;

  p := e.payload->'payment';
  if p is null then return 'ignorado_sem_cobranca'; end if;
  v_ref := p->>'externalReference';
  if v_ref is null or v_ref !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return 'ignorado_fora_do_riszon';
  end if;
  select * into c from public.charges ch where ch.id = v_ref::uuid and ch.gateway_account_id = e.account_id for update;
  if not found then return 'ignorado_fora_do_riszon'; end if;
  if c.asaas_payment_id is not null and c.asaas_payment_id <> coalesce(p->>'id', '') then
    return 'ignorado_outra_cobranca';
  end if;
  update public.gateway_webhook_events set charge_id = c.id where id = e.id;
  if c.asaas_payment_id is null then
    update public.charges set asaas_payment_id = p->>'id' where id = c.id;
  end if;
  v_link := '/prontuarios/' || c.client_id::text;

  if e.event in ('PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED', 'PAYMENT_DUNNING_RECEIVED') then
    return public._gateway_on_paid(c.id, case when e.event = 'PAYMENT_CONFIRMED' then 'PAYMENT_CONFIRMED' else 'PAYMENT_RECEIVED' end, p);

  elsif e.event = 'PAYMENT_OVERDUE' then
    if c.status = 'emitida' then
      update public.charges set status = 'vencida', last_event_at = now() where id = c.id;
      return 'vencida';
    end if;
    return 'sem_efeito';

  elsif e.event = 'PAYMENT_DELETED' then
    if c.status in ('emitindo', 'emitida', 'vencida', 'erro_emissao') then
      update public.charges
         set status = 'cancelada', cancelled_at = now(), cancelled_by = null,
             cancel_reason = 'Apagada no painel do Asaas', last_event_at = now()
       where id = c.id;
      perform public._gateway_notify(c.gateway_account_id, 'apagada_no_asaas', c.id::text, c.clinic_id, true, false, true,
        'Cobrança apagada no Asaas',
        'Uma cobrança emitida pelo riSZon foi apagada direto no painel do Asaas. A parcela voltou a aceitar nova cobrança.',
        v_link);
      return 'cancelada_no_asaas';
    end if;
    return 'sem_efeito';

  elsif e.event = 'PAYMENT_RESTORED' then
    select exists (
      select 1 from public.charges o
       where o.payment_installment_id = c.payment_installment_id and o.id <> c.id
         and o.status in ('emitindo', 'emitida', 'vencida', 'erro_emissao', 'externa')
    ) into v_other;
    if c.status = 'cancelada' and c.cancel_reason = 'Apagada no painel do Asaas' and not v_other
       and exists (select 1 from public.payment_installments i
                    where i.id = c.payment_installment_id and i.status in ('em_aberto', 'parcial')) then
      update public.charges
         set status = case when c.due_date < public.today_br() then 'vencida' else 'emitida' end,
             cancelled_at = null, cancel_reason = null, last_event_at = now()
       where id = c.id;
      return 'restaurada';
    end if;
    perform public._gateway_notify(c.gateway_account_id, 'restaurada_no_asaas', c.id::text, c.clinic_id, true, false, true,
      'Cobrança restaurada no Asaas',
      'Uma cobrança foi restaurada no painel do Asaas, mas a parcela já tem outra cobrança ou não está em aberto. Confira e cancele a que sobrar.',
      v_link);
    return 'restaurada_so_aviso';

  elsif e.event = 'PAYMENT_UPDATED' then
    if round(coalesce((p->>'value')::numeric, 0) * 100) <> coalesce(c.value_cents, 0)
       or (p->>'dueDate')::date is distinct from c.due_date then
      perform public._gateway_notify(c.gateway_account_id, 'alterada_no_asaas', e.asaas_event_id, c.clinic_id, true, false, true,
        'Cobrança alterada no Asaas',
        'Uma cobrança emitida pelo riSZon teve valor ou vencimento alterado direto no painel do Asaas. O riSZon não segue a mudança; o pagamento segue a regra do valor a maior ou a menor.',
        v_link);
      return 'alterada_no_asaas';
    end if;
    return 'sem_efeito';

  elsif e.event = 'PAYMENT_REFUNDED' then
    -- 4018: a mensalidade estornada continua como paga; a unidade decide desfazer a baixa.
    if c.source_type <> 'installment' then
      if c.status in ('paga', 'liquidada', 'em_contestacao') then
        update public.charges set status = 'estornada', last_event_at = now() where id = c.id;
      end if;
      -- 4020 (19.35.8): o estorno da mensalidade do PPR+ tira os pontos do Riso+ Social dela.
      if c.source_type = 'ppr_charge' then
        delete from public.ppr_social_points sp
         using public.ppr_charges pc
         where pc.id = c.source_id and sp.membership_id = pc.membership_id and sp.reference_month = pc.reference_month;
      end if;
      perform public._gateway_notify(c.gateway_account_id, 'estorno', c.id::text, c.clinic_id, true, true, true,
        'Estorno de mensalidade no Asaas',
        'Uma mensalidade paga pelo Asaas foi estornada. Ela continua marcada como paga: desfaça a baixa à mão, se for o caso.',
        v_link);
      return 'estornada';
    end if;
    if c.receipt_id is not null then
      select * into v_rec from public.payment_receipts r where r.id = c.receipt_id;
      if not v_rec.reversed then
        perform public._gateway_reverse_receipt(c.receipt_id, 'Estorno no Asaas');
      end if;
    end if;
    if c.status in ('paga', 'liquidada', 'em_contestacao') then
      update public.charges set status = 'estornada', last_event_at = now() where id = c.id;
    end if;
    perform public._gateway_notify(c.gateway_account_id, 'estorno', c.id::text, c.clinic_id, true, true, true,
      'Estorno no Asaas',
      'Um pagamento pelo Asaas foi estornado. A baixa foi desfeita e a parcela voltou a ficar em aberto; a taxa da rede continua devida (pode ser dispensada pelo Financeiro).',
      v_link);
    return 'estornada';

  elsif e.event in ('PAYMENT_PARTIALLY_REFUNDED', 'PAYMENT_RECEIVED_IN_CASH_UNDONE') then
    perform public._gateway_notify(c.gateway_account_id, lower(e.event), e.asaas_event_id, c.clinic_id, true, true, true,
      'Asaas: estorno para tratar à mão',
      'O Asaas avisou ' || e.event || ' numa cobrança do riSZon. O Financeiro trata à mão.',
      v_link);
    return 'aviso_manual';

  elsif e.event in ('PAYMENT_CHARGEBACK_REQUESTED', 'PAYMENT_CHARGEBACK_DISPUTE', 'PAYMENT_AWAITING_CHARGEBACK_REVERSAL') then
    if c.status in ('paga', 'liquidada') then
      update public.charges set status = 'em_contestacao', last_event_at = now() where id = c.id;
    end if;
    perform public._gateway_notify(c.gateway_account_id, lower(e.event), c.id::text, c.clinic_id, true, true, true,
      'Contestação no cartão',
      'O pagador contestou no cartão uma cobrança do riSZon (' || e.event || '). O Financeiro acompanha e trata à mão.',
      v_link);
    return 'contestacao';
  end if;

  return 'sem_efeito';
end;
$function$;

-- -----------------------------------------------------------------------------
-- 10) AUDITORIA E CONFERÊNCIA
-- -----------------------------------------------------------------------------
select public.audit_attach_all();

notify pgrst, 'reload schema';

select
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      '_distrato_overdue_days', '_distrato_managers', '_distrato_can_request', 'distrato_request', 'distrato_request_keep',
      '_distrato_watch_run', '_distrato_share', '_distrato_agreements', '_distrato_agreement_plan', '_distrato_apply_agreements',
      'distrato_checklist_set', '_distrato_paid_now', '_distrato_ready', 'open_direct_sale_distrato', '_apply_direct_sale_distrato',
      '_distrato_ortho', '_distrato_ortho_future', 'distrato_refund_request', 'distrato_refund_decide', 'devolucoes_read',
      'distrato_read', 'distratos_read', 'distrato_sale_status')) as funcoes_novas,
  (select count(*) from information_schema.tables where table_schema = 'public'
    and table_name in ('distrato_requests', 'distrato_checklist', 'distrato_refunds')) as tabelas_novas,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'plan_cancellations'
    and column_name in ('direct_sale_id', 'kind', 'checklist_required', 'last_alert_at', 'finance_alerted_at', 'agreement_changes')) as colunas_novas,
  (select distrato_overdue_days from public.finance_settings where clinic_id is null limit 1) as dias_do_aviso,
  (select count(*) from public.plan_cancellations where status in ('rascunho', 'assinado')) as cancelamentos_abertos_antes,
  position('_distrato_ready' in pg_get_functiondef('public.apply_plan_cancellation(uuid)'::regprocedure)) > 0
    and position('DISTRATO_REQUIRED' in pg_get_functiondef('public.cancel_direct_sale(uuid)'::regprocedure)) > 0
    and position('_distrato_agreements' in pg_get_functiondef('public.open_plan_cancellation(uuid, text, text, date, text)'::regprocedure)) > 0
    as distrato_no_cancelamento;

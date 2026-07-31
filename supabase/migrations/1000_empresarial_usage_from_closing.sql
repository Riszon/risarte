-- =============================================================================
-- 1000 — Empresarial: a ECONOMIA passa a ser registrada no FECHAMENTO
-- -----------------------------------------------------------------------------
-- Pedido do dono (30/07/2026): "a economia já deve ser calculada automaticamente
-- quando é lançado e feito o fechamento pelo fluxo do comercial ou pela venda
-- direta. Não está registrando o que foi feito na venda direta."
--
-- Como era: `empresarial.benefit_usage` só era escrita quando uma SESSÃO era
-- concluída (gatilho da 0099). A venda direta e a negociação já calculavam o
-- benefício (`program_discount_cents` nos itens — 0157/0182), mas isso nunca
-- chegava ao extrato do programa. Resultado: relatório de economia zerado.
--
-- Como fica: o fechamento é a FONTE DA VERDADE da economia.
--   * venda direta  → status 'concluida'  (contrato assinado + pagamento confirmado)
--   * negociação    → status 'aceita'
-- Um gatilho em cada fluxo grava uma linha de `benefit_usage` por item que teve
-- desconto do programa. O gatilho da 0099 (por sessão) é REMOVIDO para o mesmo
-- benefício não ser contado duas vezes.
--
-- Também faz BACKFILL: vendas/negociações já fechadas passam a aparecer no
-- extrato (o dono já lançou vendas antes desta migração).
--
-- Idempotente: `source` + `source_ref` identificam a origem e um índice único
-- impede duplicar o registro do mesmo item.
-- =============================================================================

-- 1) Origem do registro (para idempotência e auditoria) -----------------------
alter table empresarial.benefit_usage
  add column if not exists source varchar(20) not null default 'SESSION',
  add column if not exists source_ref uuid;

comment on column empresarial.benefit_usage.source is
  'SESSION (legado) | DIRECT_SALE | NEGOTIATION — de onde veio a economia.';
comment on column empresarial.benefit_usage.source_ref is
  'Id do item de origem (direct_sale_items.id / treatment_plan_option_items.id).';

create unique index if not exists benefit_usage_source_unique
  on empresarial.benefit_usage (source, source_ref)
  where source_ref is not null;

-- 2) O gatilho por sessão sai de cena (evita contar a mesma economia 2x) ------
drop trigger if exists treatment_session_benefit_usage on public.treatment_sessions;

-- 3) Papel do membro no programa (titular ou dependente) ----------------------
create or replace function empresarial.member_role_for(
  p_client_id uuid,
  p_company_id uuid
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when exists (
    select 1 from empresarial.employees
    where client_id = p_client_id and company_id = p_company_id
  ) then 'HOLDER' else 'DEPENDENT' end;
$$;

-- 4) Venda direta concluída → registra a economia de cada item ----------------
create or replace function empresarial.register_direct_sale_usage(p_sale_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sale record;
  v_company uuid;
  v_active boolean;
begin
  select id, client_id, clinic_id, closed_at
    into v_sale
  from public.direct_sales
  where id = p_sale_id;
  if not found or v_sale.client_id is null then return; end if;

  -- Só registra para quem é membro ATIVO do programa.
  select empresarial_company_id, empresarial_active
    into v_company, v_active
  from public.clients where id = v_sale.client_id;
  if v_company is null or v_active is not true then return; end if;

  insert into empresarial.benefit_usage (
    client_id, clinic_id, company_id, procedure_id, benefit_id, member_role,
    used_at, appointment_id,
    amount_full_cents, amount_charged_cents, amount_saved_cents,
    source, source_ref
  )
  select
    v_sale.client_id,
    v_sale.clinic_id,
    v_company,
    i.procedure_id,
    null,
    empresarial.member_role_for(v_sale.client_id, v_company),
    coalesce(v_sale.closed_at, now()),
    -- Atendimento ligado ao procedimento (quando a venda nasceu de um horário).
    (select ts.appointment_id from public.treatment_sessions ts
      where ts.id = i.session_id),
    i.unit_price_cents * i.quantity,
    i.final_cents,
    i.program_discount_cents,
    'DIRECT_SALE',
    i.id
  from public.direct_sale_items i
  where i.sale_id = p_sale_id
    and i.program_discount_cents > 0
  on conflict do nothing;
end $$;

create or replace function empresarial.direct_sale_usage_trg()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'concluida'
     and (tg_op = 'INSERT' or old.status is distinct from 'concluida') then
    perform empresarial.register_direct_sale_usage(new.id);
  end if;
  return null;
end $$;

drop trigger if exists empresarial_direct_sale_usage on public.direct_sales;
create trigger empresarial_direct_sale_usage
  after insert or update of status on public.direct_sales
  for each row execute function empresarial.direct_sale_usage_trg();

-- 5) Negociação aceita → registra a economia de cada item incluído ------------
create or replace function empresarial.register_negotiation_usage(p_negotiation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_neg record;
  v_company uuid;
  v_active boolean;
begin
  select id, client_id, clinic_id, updated_at
    into v_neg
  from public.plan_negotiations
  where id = p_negotiation_id;
  if not found then return; end if;

  select empresarial_company_id, empresarial_active
    into v_company, v_active
  from public.clients where id = v_neg.client_id;
  if v_company is null or v_active is not true then return; end if;

  insert into empresarial.benefit_usage (
    client_id, clinic_id, company_id, procedure_id, benefit_id, member_role,
    used_at, appointment_id,
    amount_full_cents, amount_charged_cents, amount_saved_cents,
    source, source_ref
  )
  select
    v_neg.client_id,
    v_neg.clinic_id,
    v_company,
    it.procedure_id,
    null,
    empresarial.member_role_for(v_neg.client_id, v_company),
    coalesce(v_neg.updated_at, now()),
    null,
    it.unit_price_cents * it.quantity,
    greatest(it.unit_price_cents * it.quantity - ni.program_discount_cents, 0),
    ni.program_discount_cents,
    'NEGOTIATION',
    it.id
  from public.plan_negotiation_items ni
  join public.treatment_plan_option_items it on it.id = ni.item_id
  where ni.negotiation_id = p_negotiation_id
    and ni.included
    and ni.program_discount_cents > 0
  on conflict do nothing;
end $$;

create or replace function empresarial.negotiation_usage_trg()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'aceita'
     and (tg_op = 'INSERT' or old.status is distinct from 'aceita') then
    perform empresarial.register_negotiation_usage(new.id);
  end if;
  return null;
end $$;

drop trigger if exists empresarial_negotiation_usage on public.plan_negotiations;
create trigger empresarial_negotiation_usage
  after insert or update of status on public.plan_negotiations
  for each row execute function empresarial.negotiation_usage_trg();

-- 6) Backfill: o que JÁ foi fechado antes desta migração ----------------------
do $$
declare r record;
begin
  for r in select id from public.direct_sales where status = 'concluida' loop
    perform empresarial.register_direct_sale_usage(r.id);
  end loop;
  for r in select id from public.plan_negotiations where status = 'aceita' loop
    perform empresarial.register_negotiation_usage(r.id);
  end loop;
end $$;

-- 7) Limpeza: linhas antigas por SESSÃO cujo mesmo procedimento já veio do
--    fechamento (evita economia dobrada no extrato do dono).
delete from empresarial.benefit_usage old
where old.source = 'SESSION'
  and exists (
    select 1 from empresarial.benefit_usage novo
    where novo.source in ('DIRECT_SALE', 'NEGOTIATION')
      and novo.client_id = old.client_id
      and novo.procedure_id = old.procedure_id
  );

grant execute on function empresarial.member_role_for(uuid, uuid) to authenticated;
grant execute on function empresarial.register_direct_sale_usage(uuid) to authenticated, service_role;
grant execute on function empresarial.register_negotiation_usage(uuid) to authenticated, service_role;

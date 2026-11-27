-- =============================================================================
-- 0436 — LEVANTAMENTO DE DÍVIDAS: A CONTA VENCIDA VIRA DÍVIDA SOZINHA
-- -----------------------------------------------------------------------------
-- Pedido do dono (27/11/2026, com a imagem do Painel de Cambé zerado e 17
-- contas vencidas no Contas a Pagar): "isto deve ser automático". Plano
-- aprovado como recomendado:
--
--   1. Toda conta a pagar vencida e não paga vira dívida a partir do dia
--      seguinte ao vencimento (prazo nas Configurações: `auto_overdue_days`,
--      rede 1; o devedor pode ter o seu).
--   2. Uma dívida por unidade e fornecedor; a conta que vencer depois entra na
--      mesma dívida enquanto ela estiver aberta (sem acordo, não quitada).
--   3. Origem C (já está no Contas a Pagar: só VINCULA, nada novo no razão),
--      situação pela regra de sempre, categoria tirada da conta contábil,
--      etiqueta "Automática — Contas a Pagar".
--   4. Pagou no Contas a Pagar → a dívida quita e encerra sozinha (o
--      checklist só tem a quitação). Cancelou → a conta sai; sem conta, a
--      dívida sai (excluída, com o motivo).
--   5. Roda na rotina diária e quando alguém abre o Levantamento
--      (`debt_auto_overdue_refresh`).
--   6. Fora: conta já ligada a dívida ou acordo, saldo de implantação,
--      aguardando autorização, taxas da franquia (`network_fee`), repasse e
--      bônus dos dentistas (2.1), comissão (2.5), royalties e fundo (2.6) e a
--      devolução ao paciente (1.x).
--   7. Conta vencida SEM fornecedor não vira dívida (toda dívida tem credor):
--      aparece em Qualidade dos dados (`debt_auto_overdue_pending`).
--   8. Sem aviso novo: a dívida automática fica fora do "prestes a virar
--      inadimplente".
--
-- ⚠️ A REGRA DE QUAL CONTA ENTRA MORA EM `_debt_auto_overdue_candidates`
-- (a sincronização e a Qualidade dos dados leem ela).
-- ⚠️ Dívida automática excluída pela tela não volta: os títulos dela ficam em
-- `debt_auto_links` e a regra os pula.
--
-- Idempotente. Não apaga dado (a "exclusão" da dívida sem conta é a lógica de
-- sempre, `deleted_at` com motivo). Recria `debt_daily_run`,
-- `_debt_notices_daily` (partindo da 0410) e `debt_save_settings` (da 0405).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) ESTRUTURA
-- -----------------------------------------------------------------------------
alter table public.debts add column if not exists auto_overdue boolean not null default false;
comment on column public.debts.auto_overdue is
  'Dívida criada sozinha pelas contas vencidas do Contas a Pagar (0436).';

alter table public.debt_settings add column if not exists auto_overdue_days integer;
do $$
begin
  alter table public.debt_settings add constraint debt_settings_auto_overdue_days
    check (auto_overdue_days is null or auto_overdue_days between 1 and 365);
exception when duplicate_object then null;
end $$;
update public.debt_settings set auto_overdue_days = 1 where clinic_id is null and auto_overdue_days is null;

create table if not exists public.debt_auto_links (
  payable_id uuid primary key references public.payables(id) on delete cascade,
  debt_id uuid not null references public.debts(id) on delete cascade,
  created_at timestamptz not null default now()
);
comment on table public.debt_auto_links is
  'Qual conta a pagar a rotina das contas vencidas já pôs em qual dívida (0436). Dívida automática excluída não recebe a conta de novo.';
create index if not exists debt_auto_links_debt on public.debt_auto_links (debt_id);
alter table public.debt_auto_links enable row level security;
insert into public.audit_excluded_tables (schema_name, table_name, motivo) values
  ('public', 'debt_auto_links', 'Registro técnico da rotina das contas vencidas do Levantamento de Dívidas (0436).')
on conflict (schema_name, table_name) do nothing;

insert into public.debt_tags (name, color, system)
select 'Automática — Contas a Pagar', 'slate', true
 where not exists (select 1 from public.debt_tags where lower(btrim(name)) = lower('Automática — Contas a Pagar'));

-- -----------------------------------------------------------------------------
-- 2) A REGRA: QUAL CONTA VENCIDA ENTRA (um lugar só)
-- -----------------------------------------------------------------------------
create or replace function public._debt_auto_overdue_candidates()
returns table (
  payable_id uuid,
  clinic_id uuid,
  supplier_id uuid,
  account_code text,
  due_date date,
  amount_cents bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.clinic_id, p.supplier_id, p.account_code, p.due_date, p.amount_cents
    from public.payables p
   where p.status in ('aberta', 'parcial')
     and p.debt_id is null
     and p.debt_agreement_id is null
     and not coalesce(p.opening_balance, false)
     and p.network_fee is null
     -- Devolução ao paciente (1.x, dedução da receita) é dinheiro do cliente,
     -- não dívida com credor (achado na tela do treino, 27/11/2026).
     and p.account_code not like '1%'
     and p.account_code not like '2.1%'
     and p.account_code not like '2.5%'
     and p.account_code not like '2.6%'
     -- (o passivo das dívidas, 5.5, já está ligado a uma dívida ou a um acordo,
     -- ou é saldo de implantação: os filtros acima tiram)
     and public.today_br() - p.due_date >= public._debt_setting_int(p.clinic_id, 'auto_overdue_days', 1)
     -- Já esteve numa dívida automática que foi excluída pela tela: não volta.
     and not exists (select 1 from public.debt_auto_links l
                       join public.debts d on d.id = l.debt_id
                      where l.payable_id = p.id and d.deleted_at is not null);
$$;
revoke execute on function public._debt_auto_overdue_candidates() from public, anon, authenticated;

-- A categoria pela conta contábil (pelo nome: os ids mudam de banco para banco).
create or replace function public._debt_auto_category(p_account text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select c.id from public.debt_categories c
      where c.parent_id is null and c.active
        and c.name = case
          when p_account like '2.2%' then 'Fornecedores odontológicos'
          when p_account like '2.3%' then 'Laboratório e prótese'
          when p_account like '3.1.04%' then 'Serviços de terceiros e software'
          when p_account like '3.1%' then 'Trabalhistas e encargos'
          when p_account like '3.2.01%' or p_account like '3.2.02%' then 'Ocupação (aluguel, condomínio, IPTU)'
          when p_account like '3.2.03%' then 'Utilidades (energia, água, telefonia, internet)'
          when p_account like '3.2%' then 'Serviços de terceiros e software'
          when p_account like '3.3.01%' or p_account like '3.3.02%' then 'Serviços de terceiros e software'
          when p_account like '3.4%' then 'Marketing'
          when p_account like '5.1%' then 'Equipamentos'
          when p_account like '5.3%' then 'Empréstimos e financiamentos'
          else 'Outros' end
      limit 1),
    (select c.id from public.debt_categories c
      where c.parent_id is null and c.name = 'A classificar' limit 1));
$$;
revoke execute on function public._debt_auto_category(text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3) A SINCRONIZAÇÃO
-- -----------------------------------------------------------------------------
create or replace function public._debt_auto_overdue_sync()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  g record;
  v_n integer := 0;
  v_debt uuid;
  v_tag uuid;
  v_cat uuid;
  v_touched uuid[] := '{}';
  v_old text;
begin
  -- Uma de cada vez (a rotina e a tela podem chegar juntas).
  perform pg_advisory_xact_lock(hashtext('debt_auto_overdue_sync'));
  perform set_config('risarte.debt_sync', 'on', true);

  -- a) Conta cancelada (ou recusada) sai da dívida automática.
  for r in
    select p.id, p.debt_id from public.payables p
      join public.debts d on d.id = p.debt_id
     where d.auto_overdue and d.deleted_at is null
       and p.debt_link = 'vinculado' and p.status in ('cancelada', 'recusada')
  loop
    update public.payables set debt_id = null, debt_link = null, updated_at = now() where id = r.id;
    insert into public.debt_events (debt_id, user_id, kind, note, data)
    values (r.debt_id, null, 'titulo_desvinculado', 'Conta cancelada no Contas a Pagar',
            jsonb_build_object('payable_id', r.id));
    v_touched := array_append(v_touched, r.debt_id);
  end loop;

  -- b) As contas vencidas que faltam, por unidade e fornecedor.
  select id into v_tag from public.debt_tags where lower(btrim(name)) = lower('Automática — Contas a Pagar') limit 1;
  for g in
    select c.clinic_id, c.supplier_id, array_agg(c.payable_id order by c.due_date) as ids,
           (array_agg(c.account_code order by c.due_date))[1] as conta
      from public._debt_auto_overdue_candidates() c
     where c.supplier_id is not null
     group by c.clinic_id, c.supplier_id
  loop
    select d.id into v_debt from public.debts d
     where d.auto_overdue and d.deleted_at is null
       and d.clinic_id = g.clinic_id and d.supplier_id = g.supplier_id
       and d.status in ('a_vencer', 'em_atraso', 'inadimplente', 'em_negociacao')
       and public._debt_agreement_blocking(d.id) is null
     order by d.created_at desc limit 1;

    if v_debt is null then
      v_cat := public._debt_auto_category(g.conta);
      insert into public.debts (clinic_id, supplier_id, debt_type, description, category_id, nature_code,
        account_code, original_cents, due_date, origin, finance_synced_at, auto_overdue, notes)
      select g.clinic_id, g.supplier_id, 'fatura',
             'Contas vencidas no Contas a Pagar', v_cat,
             (select c.nature_code from public.debt_categories c where c.id = v_cat),
             g.conta,
             (select sum(p.amount_cents) from public.payables p where p.id = any (g.ids)),
             (select min(p.due_date) from public.payables p where p.id = any (g.ids)),
             'C', now(), true,
             'Criada sozinha: conta vencida e não paga no Contas a Pagar. Pague ou cancele por lá.'
      returning id into v_debt;
      if v_tag is not null then
        insert into public.debt_tag_links (debt_id, tag_id) values (v_debt, v_tag) on conflict do nothing;
      end if;
      insert into public.debt_events (debt_id, user_id, kind, note, data)
      values (v_debt, null, 'criada_automatica', 'Conta vencida no Contas a Pagar',
              jsonb_build_object('payable_ids', to_jsonb(g.ids)));
    else
      insert into public.debt_events (debt_id, user_id, kind, note, data)
      values (v_debt, null, 'titulo_vinculado', 'Conta vencida no Contas a Pagar',
              jsonb_build_object('payable_ids', to_jsonb(g.ids)));
    end if;

    update public.payables set debt_id = v_debt, debt_link = 'vinculado', updated_at = now()
     where id = any (g.ids);
    insert into public.debt_auto_links (payable_id, debt_id)
    select x, v_debt from unnest(g.ids) x
    on conflict (payable_id) do update set debt_id = excluded.debt_id, created_at = now();
    v_n := v_n + coalesce(array_length(g.ids, 1), 0);
    v_touched := array_append(v_touched, v_debt);
  end loop;

  -- c) Valor e vencimento da dívida automática = as contas dela; sem conta, sai.
  for r in
    select d.id,
           (select sum(p.amount_cents) from public.payables p
             where p.debt_id = d.id and p.debt_link = 'vinculado' and p.status not in ('cancelada', 'recusada')) as total,
           (select min(p.due_date) from public.payables p
             where p.debt_id = d.id and p.debt_link = 'vinculado' and p.status not in ('cancelada', 'recusada')) as venc,
           d.original_cents, d.due_date
      from public.debts d
     where d.id = any (v_touched) and d.deleted_at is null
  loop
    if r.total is null then
      if public._debt_agreement_blocking(r.id) is null then
        update public.debts
           set deleted_at = now(), deleted_reason = 'Automática: as contas foram canceladas no Contas a Pagar',
               updated_at = now()
         where id = r.id;
        insert into public.debt_events (debt_id, user_id, kind, note)
        values (r.id, null, 'excluida', 'Automática: as contas foram canceladas no Contas a Pagar');
      end if;
    elsif (r.total, r.venc) is distinct from (r.original_cents, r.due_date) then
      update public.debts set original_cents = r.total, due_date = r.venc, updated_at = now() where id = r.id;
    end if;
  end loop;

  perform set_config('risarte.debt_sync', '', true);

  -- d) A situação das que mudaram; a automática paga encerra sozinha (o
  --    checklist dela só tem a quitação, que o pagamento já prova).
  for r in
    select d.id from public.debts d
     where d.auto_overdue and d.deleted_at is null
       and (d.id = any (v_touched) or d.status not in ('quitada_encerrada', 'baixada'))
  loop
    v_old := public._debt_refresh_status(r.id, true);
    if v_old = 'quitada_pendencias'
       and not exists (select 1 from public.debt_closing_items c
                        where c.debt_id = r.id and c.applicable and c.done_on is null and c.item <> 'quitacao') then
      update public.debt_closing_items
         set done_on = public.today_br(), note = 'Automática: contas pagas no Contas a Pagar', updated_at = now()
       where debt_id = r.id and item = 'quitacao' and done_on is null;
      perform public._debt_refresh_status(r.id, true);
    end if;
  end loop;

  return v_n;
end;
$$;
revoke execute on function public._debt_auto_overdue_sync() from public, anon, authenticated;

-- A porta da tela: quem vê o Levantamento faz a conta na hora de abrir.
create or replace function public.debt_auto_overdue_refresh()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.debt_can('modulo.dividas', null) then
    raise exception 'Você não tem permissão para ver o Levantamento de Dívidas.';
  end if;
  return public._debt_auto_overdue_sync();
end;
$$;
revoke execute on function public.debt_auto_overdue_refresh() from public, anon, authenticated;
grant execute on function public.debt_auto_overdue_refresh() to authenticated;

-- Qualidade dos dados: a conta vencida que ficou de fora por falta de fornecedor.
create or replace function public.debt_auto_overdue_pending()
returns table (
  payable_id uuid,
  clinic_id uuid,
  clinic_name text,
  description text,
  account_code text,
  due_date date,
  open_cents bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.clinic_id, cl.name, p.description, p.account_code, p.due_date,
         greatest(0, p.amount_cents - coalesce(p.paid_amount_cents, 0))::bigint
    from public._debt_auto_overdue_candidates() c
    join public.payables p on p.id = c.payable_id
    join public.clinics cl on cl.id = p.clinic_id
   where c.supplier_id is null
     and public.debt_can('modulo.dividas', p.clinic_id)
   order by p.due_date;
$$;
revoke execute on function public.debt_auto_overdue_pending() from public, anon, authenticated;
grant execute on function public.debt_auto_overdue_pending() to authenticated;

-- -----------------------------------------------------------------------------
-- 4) CONFIGURAÇÕES (corpo da 0405 + o prazo das contas vencidas)
-- -----------------------------------------------------------------------------
create or replace function public.debt_save_settings(p_clinic_id uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_alerts integer[];
begin
  if not public.debt_can('acao.dividas.configurar', p_clinic_id) then
    raise exception 'Você não tem permissão para configurar o Levantamento de Dívidas.';
  end if;
  if p ? 'proposal_alert_days' and jsonb_typeof(p -> 'proposal_alert_days') = 'array' then
    select array_agg(distinct x::integer order by x::integer desc) into v_alerts
      from jsonb_array_elements_text(p -> 'proposal_alert_days') x
     where x ~ '^\d+$' and x::integer between 0 and 60;
  end if;
  if p_clinic_id is null and (nullif(p ->> 'days_to_default', '') is null) then
    raise exception 'A regra da rede precisa do prazo para virar inadimplente.';
  end if;
  insert into public.debt_settings (clinic_id, days_to_default, about_to_default_days, proposal_alert_days,
    negativation_removal_bdays, closing_stale_days, agreement_broken_tolerance_bdays,
    agreement_approval_threshold_cents, discount_recognition, surcharge_recognition, stale_check_days,
    auto_overdue_days, updated_by, updated_at)
  values (p_clinic_id,
    nullif(p ->> 'days_to_default', '')::integer,
    nullif(p ->> 'about_to_default_days', '')::integer,
    v_alerts,
    nullif(p ->> 'negativation_removal_bdays', '')::integer,
    nullif(p ->> 'closing_stale_days', '')::integer,
    nullif(p ->> 'agreement_broken_tolerance_bdays', '')::integer,
    case when p_clinic_id is null then nullif(p ->> 'agreement_approval_threshold_cents', '')::bigint end,
    case when p_clinic_id is null then public._debt_text(p, 'discount_recognition') end,
    case when p_clinic_id is null then public._debt_text(p, 'surcharge_recognition') end,
    nullif(p ->> 'stale_check_days', '')::integer,
    nullif(p ->> 'auto_overdue_days', '')::integer,
    v_uid, now())
  on conflict (clinic_id) do update set
    days_to_default = excluded.days_to_default,
    about_to_default_days = excluded.about_to_default_days,
    proposal_alert_days = excluded.proposal_alert_days,
    negativation_removal_bdays = excluded.negativation_removal_bdays,
    closing_stale_days = excluded.closing_stale_days,
    agreement_broken_tolerance_bdays = excluded.agreement_broken_tolerance_bdays,
    agreement_approval_threshold_cents = excluded.agreement_approval_threshold_cents,
    discount_recognition = excluded.discount_recognition,
    surcharge_recognition = excluded.surcharge_recognition,
    stale_check_days = excluded.stale_check_days,
    auto_overdue_days = excluded.auto_overdue_days,
    updated_by = v_uid, updated_at = now();

  perform public._debt_refresh_status(d.id, false)
     from public.debts d
    where d.deleted_at is null and (p_clinic_id is null or d.clinic_id = p_clinic_id);
end;
$$;
revoke execute on function public.debt_save_settings(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.debt_save_settings(uuid, jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- 5) A ROTINA DIÁRIA (corpo da 0410 + as contas vencidas no começo)
-- -----------------------------------------------------------------------------
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
  -- 0436: as contas vencidas do Contas a Pagar viram dívida antes de tudo.
  perform public._debt_auto_overdue_sync();

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

  -- 0410: os avisos (depois da situação do dia).
  perform public._debt_notices_daily();

  -- A fotografia do mês que fechou (0407): uma vez só.
  if not exists (select 1 from public.debt_month_positions where month = v_prev) then
    perform public._debt_snapshot_month(v_prev);
  end if;
  return v_n;
end;
$$;
revoke execute on function public.debt_daily_run() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 6) OS AVISOS (corpo da 0410; a dívida automática fica fora do "prestes a
--    virar inadimplente": a decisão foi não criar aviso pela conta vencida)
-- -----------------------------------------------------------------------------
create or replace function public._debt_notices_daily()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_n integer := 0;
  v_hoje date := public.today_br();
  v_dias integer[];
  v_k integer;
  v_owner uuid;
  v_debt uuid;
  v_vira date;
  v_about integer;
begin
  -- Proposta vencendo: um aviso por marco da regra (o menor que já chegou).
  for r in
    select pr.id, pr.debt_id, pr.group_id, pr.valid_until, pr.amount_cents,
           coalesce(d.clinic_id, g.clinic_id) as clinic_id,
           coalesce(pr.debt_id, (select x.id from public.debts x where x.group_id = pr.group_id and x.deleted_at is null order by x.code limit 1)) as alvo,
           s.name as credor
      from public.debt_proposals pr
      left join public.debts d on d.id = pr.debt_id
      left join public.debt_groups g on g.id = pr.group_id
      left join public.suppliers s on s.id = coalesce(d.supplier_id, g.supplier_id)
     where pr.status = 'ativa' and pr.valid_until is not null and pr.valid_until >= v_hoje
  loop
    if r.alvo is null then continue; end if;
    v_dias := coalesce(
      (select s.proposal_alert_days from public.debt_settings s where s.clinic_id = r.clinic_id),
      (select s.proposal_alert_days from public.debt_settings s where s.clinic_id is null),
      '{7,2}');
    select min(k) into v_k from unnest(v_dias) k where k >= (r.valid_until - v_hoje);
    if v_k is null then continue; end if;
    select owner_user_id into v_owner from public.debts where id = r.alvo;
    v_n := v_n + public._debt_notify(r.id, 'proposta_vencendo', v_k::text, r.clinic_id, v_owner, false, false,
      'Dívidas: proposta vencendo em ' || to_char(r.valid_until, 'DD/MM/YYYY'),
      'A proposta de ' || public.brl(r.amount_cents) || ' de ' || coalesce(r.credor, 'um credor')
        || ' vale até ' || to_char(r.valid_until, 'DD/MM/YYYY') || '. Aceite (Renegociar dívida) ou registre a nova condição.',
      '/financeiro/dividas/' || r.alvo || '?aba=propostas');
  end loop;

  -- Parcela de acordo vencendo: 3 dias antes.
  for r in
    select p.id, p.due_date, p.amount_cents - coalesce(p.paid_amount_cents, 0) as falta, a.code, a.clinic_id,
           a.primary_debt_id, s.name as credor
      from public.payables p
      join public.debt_agreements a on a.id = p.debt_agreement_id
      left join public.suppliers s on s.id = a.supplier_id
     where p.debt_link = 'acordo' and p.status in ('aberta', 'parcial')
       and p.due_date between v_hoje and v_hoje + 3
       and a.status in ('em_andamento', 'quebrado')
  loop
    select owner_user_id into v_owner from public.debts where id = r.primary_debt_id;
    v_n := v_n + public._debt_notify(r.id, 'parcela_vencendo', '', r.clinic_id, v_owner, false, false,
      'Dívidas: parcela do acordo ' || r.code || ' vence em ' || to_char(r.due_date, 'DD/MM/YYYY'),
      'Faltam ' || public.brl(r.falta) || '. Credor: ' || coalesce(r.credor, '—') || '.',
      '/financeiro/dividas/' || r.primary_debt_id || '?aba=acordos');
  end loop;

  -- Prestes a virar inadimplente: o vencimento mais antigo em aberto + o prazo.
  for r in
    select d.id, d.code, d.clinic_id, d.supplier_id, d.owner_user_id,
           coalesce(pos.oldest_open_due, d.due_date) as venc, s.name as credor
      from public.debts d
      left join lateral public._debt_positions(array[d.id]) pos on true
      left join public.suppliers s on s.id = d.supplier_id
     where d.deleted_at is null and d.status = 'em_atraso'
       and not d.auto_overdue  -- 0436: sem aviso novo pela conta vencida
  loop
    v_vira := r.venc + public._debt_days_to_default(r.clinic_id, r.supplier_id) + 1;
    v_about := public._debt_setting_int(r.clinic_id, 'about_to_default_days', 5);
    if v_vira - v_hoje > v_about or v_vira <= v_hoje then continue; end if;
    v_n := v_n + public._debt_notify(r.id, 'prestes_inadimplente', r.venc::text, r.clinic_id, r.owner_user_id, false, false,
      'Dívidas: ' || r.code || ' vira inadimplente em ' || to_char(v_vira, 'DD/MM/YYYY'),
      'Credor: ' || coalesce(r.credor, '—') || '. Negocie antes do prazo, se der.',
      '/financeiro/dividas/' || r.id);
  end loop;

  -- Checklist de encerramento parado.
  for r in
    select d.id, d.code, d.clinic_id, d.owner_user_id, d.status_changed_at::date as desde
      from public.debts d
     where d.deleted_at is null and d.status = 'quitada_pendencias'
       and exists (select 1 from public.debt_closing_items c where c.debt_id = d.id and c.applicable and c.done_on is null)
  loop
    if v_hoje - r.desde < public._debt_setting_int(r.clinic_id, 'closing_stale_days', 15) then continue; end if;
    v_n := v_n + public._debt_notify(r.id, 'checklist_parado', r.desde::text, r.clinic_id, r.owner_user_id, false, false,
      'Dívidas: encerramento de ' || r.code || ' parado',
      'Quitada desde ' || to_char(r.desde, 'DD/MM/YYYY') || ' e o checklist de encerramento ainda tem pendência.',
      '/financeiro/dividas/' || r.id || '?aba=encerramento');
  end loop;

  -- Baixa da negativação não confirmada, passado o prazo do credor.
  for r in
    select c.id, c.due_on, d.id as debt_id, d.code, d.clinic_id, d.owner_user_id
      from public.debt_closing_items c
      join public.debts d on d.id = c.debt_id and d.deleted_at is null
     where c.item = 'baixa_negativacao' and c.applicable and c.done_on is null
       and c.due_on is not null and c.due_on < v_hoje
  loop
    v_n := v_n + public._debt_notify(r.id, 'baixa_negativacao', '', r.clinic_id, r.owner_user_id, false, false,
      'Dívidas: baixa da negativação de ' || r.code || ' não confirmada',
      'O prazo do credor para tirar o nome terminou em ' || to_char(r.due_on, 'DD/MM/YYYY')
        || '. Confira no Serasa/SPC e marque no encerramento.',
      '/financeiro/dividas/' || r.debt_id || '?aba=encerramento');
  end loop;

  -- Próxima ação vencida.
  for r in
    select d.id, d.code, d.clinic_id, d.owner_user_id, d.next_action, d.next_action_on
      from public.debts d
     where d.deleted_at is null and d.next_action_on is not null and d.next_action_on < v_hoje
       and d.status not in ('baixada', 'quitada_pendencias', 'quitada_encerrada')
  loop
    v_n := v_n + public._debt_notify(r.id, 'proxima_acao', r.next_action_on::text, r.clinic_id, r.owner_user_id, false, false,
      'Dívidas: próxima ação de ' || r.code || ' vencida',
      coalesce(nullif(btrim(r.next_action), ''), 'Próxima ação') || ' — era para ' || to_char(r.next_action_on, 'DD/MM/YYYY') || '.',
      '/financeiro/dividas/' || r.id);
  end loop;

  return v_n;
end;
$$;
revoke execute on function public._debt_notices_daily() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 7) A PRIMEIRA PASSADA: as contas que já estão vencidas hoje
-- -----------------------------------------------------------------------------
select public._debt_auto_overdue_sync() as contas_que_viraram_divida;

select public.audit_attach_all();

-- -----------------------------------------------------------------------------
-- CONFERÊNCIA (rodar à parte, depois). O esperado: true · 1 · true · true ·
-- e o número de dívidas automáticas (na produção, uma por unidade e fornecedor
-- das contas vencidas: hoje, perto de 10) · 0 contas vencidas sem dívida e
-- com fornecedor.
-- -----------------------------------------------------------------------------
-- select
--   (select count(*) = 1 from information_schema.columns where table_name = 'debts' and column_name = 'auto_overdue') as coluna,
--   (select auto_overdue_days from public.debt_settings where clinic_id is null) as prazo_da_rede,
--   (select pg_get_functiondef(oid) like '%_debt_auto_overdue_sync%' from pg_proc where proname = 'debt_daily_run') as na_rotina,
--   (select pg_get_functiondef(oid) like '%not d.auto_overdue%' from pg_proc where proname = '_debt_notices_daily') as sem_aviso,
--   (select count(*) from public.debts where auto_overdue and deleted_at is null) as dividas_automaticas,
--   (select count(*) from public._debt_auto_overdue_candidates() where supplier_id is not null) as faltando;

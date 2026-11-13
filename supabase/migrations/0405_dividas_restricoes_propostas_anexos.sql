-- =============================================================================
-- 0405 — LEVANTAMENTO DE DÍVIDAS, FASE 2: RESTRIÇÕES, PROPOSTAS, CONTATOS E ANEXOS
-- -----------------------------------------------------------------------------
-- Plano aprovado pelo dono em 13/11/2026: docs/Financeiro/DIVIDAS-PLANO.md
-- (seções 2.4, 2.5 e 5). Em cima da 0404.
--
--   * RESTRIÇÕES (3.3): negativação (órgão, Limpa Nome, empresa ou sócio —
--     só o NOME, D13), protesto (cartório reutilizável, custas, anuência,
--     cancelamento; de uma dívida OU de um grupo, D16), ação judicial e
--     notificação extrajudicial. Corrigir = editar (vai para a trilha);
--     lançado por engano = "remover" com motivo (a linha fica).
--   * PROPOSTAS (3.4): só cresce. Proposta nova substitui a ativa da mesma
--     dívida (ou do mesmo grupo); valor e condições não mudam depois de
--     gravados. A rotina diária marca as vencidas como "expirada".
--   * CONTATOS (3.7): a linha do tempo com o credor — só cresce.
--   * ANEXOS (3.7): pasta privada `dividas` (10 MB, PDF e imagens), caminho
--     `<dívida>/<arquivo>`; o navegador envia, a porta `debt_attach` registra
--     conferindo que o arquivo existe. Remover anexo = lógico, com motivo.
--   * DATA DA ÚLTIMA CONFERÊNCIA (sugestão 2): `debts.last_checked_on` e o
--     prazo para o selo "Conferir" (`debt_settings.stale_check_days`, 60).
--
-- ⚠️ Mesma guarda da 0404 (`debt_can`, teto no Financeiro da Franqueadora).
-- Nenhuma tabela nova tem regra de escrita: só as portas gravam.
--
-- Idempotente. Não apaga dado.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) DATA DA ÚLTIMA CONFERÊNCIA
-- -----------------------------------------------------------------------------
alter table public.debts add column if not exists last_checked_on date;
comment on column public.debts.last_checked_on is
  'Quando a dívida foi conferida pela última vez no Serasa/credor (valor, situação, proposta). Selo "Conferir" depois de stale_check_days (0405).';

alter table public.debt_settings add column if not exists stale_check_days integer;
alter table public.debt_settings drop constraint if exists debt_settings_stale_check_days_check;
alter table public.debt_settings add constraint debt_settings_stale_check_days_check
  check (stale_check_days is null or stale_check_days between 1 and 365);
update public.debt_settings set stale_check_days = 60 where clinic_id is null and stale_check_days is null;

-- A dívida da linha (usado pelas guardas abaixo). NULL = não existe/excluída.
create or replace function public._debt_clinic(p_debt_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select clinic_id from public.debts where id = p_debt_id and deleted_at is null;
$$;
revoke execute on function public._debt_clinic(uuid) from public, anon, authenticated;

create or replace function public._debt_group_clinic(p_group_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select clinic_id from public.debt_groups where id = p_group_id;
$$;
revoke execute on function public._debt_group_clinic(uuid) from public, anon, authenticated;

-- Registra um evento de negócio (interna; quem chama já conferiu a guarda).
create or replace function public._debt_event(p_debt_id uuid, p_kind text, p_note text, p_data jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.debt_events (debt_id, user_id, kind, note, data)
  values (p_debt_id, (select auth.uid()), p_kind, p_note, p_data);
$$;
revoke execute on function public._debt_event(uuid, text, text, jsonb) from public, anon, authenticated;

create or replace function public.debt_mark_checked(p_debt_id uuid, p_date date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic uuid := public._debt_clinic(p_debt_id);
begin
  if v_clinic is null then raise exception 'Dívida não encontrada (ou excluída).'; end if;
  if not public.debt_can('acao.dividas.lancar', v_clinic) then
    raise exception 'Você não tem permissão para mexer nesta dívida.';
  end if;
  if p_date is not null and p_date > public.today_br() then
    raise exception 'A data da conferência não pode estar no futuro.';
  end if;
  update public.debts set last_checked_on = p_date, updated_by = (select auth.uid()), updated_at = now()
   where id = p_debt_id;
end;
$$;
revoke execute on function public.debt_mark_checked(uuid, date) from public, anon, authenticated;
grant execute on function public.debt_mark_checked(uuid, date) to authenticated;

-- -----------------------------------------------------------------------------
-- 2) CARTÓRIOS (reutilizáveis)
-- -----------------------------------------------------------------------------
create table if not exists public.debt_notary_offices (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  city text,
  state text check (state is null or state ~ '^[A-Z]{2}$'),
  phone text,
  email text,
  notes text,
  active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);
comment on table public.debt_notary_offices is 'Cartórios de protesto, reutilizados entre as dívidas (0405).';
create unique index if not exists debt_notary_offices_uniq
  on public.debt_notary_offices (lower(btrim(name)), coalesce(lower(btrim(city)), ''), coalesce(state, ''));

create or replace function public.debt_save_notary_office(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_name text := public._debt_text(p, 'name');
begin
  if not public.debt_can('acao.dividas.lancar', null) then
    raise exception 'Você não tem permissão para cadastrar cartórios.';
  end if;
  if v_name is null then raise exception 'Informe o nome do cartório.'; end if;
  if v_id is null then
    insert into public.debt_notary_offices (name, city, state, phone, email, notes, created_by, updated_by)
    values (v_name, public._debt_text(p, 'city'), upper(public._debt_text(p, 'state')),
            regexp_replace(coalesce(p ->> 'phone', ''), '\D', '', 'g'), lower(public._debt_text(p, 'email')),
            public._debt_text(p, 'notes'), v_uid, v_uid)
    returning id into v_id;
  else
    update public.debt_notary_offices
       set name = v_name, city = public._debt_text(p, 'city'), state = upper(public._debt_text(p, 'state')),
           phone = regexp_replace(coalesce(p ->> 'phone', ''), '\D', '', 'g'),
           email = lower(public._debt_text(p, 'email')), notes = public._debt_text(p, 'notes'),
           active = coalesce((p ->> 'active')::boolean, active), updated_by = v_uid, updated_at = now()
     where id = v_id;
    if not found then raise exception 'Cartório não encontrado.'; end if;
  end if;
  return v_id;
exception when unique_violation then
  raise exception 'Este cartório já está cadastrado (mesmo nome e cidade).';
end;
$$;
revoke execute on function public.debt_save_notary_office(jsonb) from public, anon, authenticated;
grant execute on function public.debt_save_notary_office(jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- 3) RESTRIÇÕES
-- -----------------------------------------------------------------------------
create table if not exists public.debt_negativations (
  id uuid primary key default gen_random_uuid(),
  debt_id uuid not null references public.debts(id) on delete restrict,
  bureau text not null check (bureau in ('serasa', 'spc', 'boa_vista', 'outro')),
  included_on date,
  amount_cents bigint check (amount_cents is null or amount_cents >= 0),
  in_limpa_nome boolean not null default false,
  target text not null default 'empresa' check (target in ('empresa', 'socio')),
  target_name text,
  removal_confirmed_on date,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  removed_at timestamptz,
  removed_by uuid references auth.users(id),
  removed_reason text,
  constraint debt_negativations_socio_nome check (target = 'empresa' or coalesce(btrim(target_name), '') <> '')
);
comment on table public.debt_negativations is
  'Negativação da dívida (Serasa, SPC, Boa Vista), no CNPJ ou no sócio avalista (só o nome, D13). Baixa = removal_confirmed_on (0405).';
create index if not exists debt_negativations_debt on public.debt_negativations (debt_id);

create table if not exists public.debt_protests (
  id uuid primary key default gen_random_uuid(),
  debt_id uuid references public.debts(id) on delete restrict,
  group_id uuid references public.debt_groups(id) on delete restrict,
  notary_office_id uuid references public.debt_notary_offices(id) on delete restrict,
  protocol text,
  protested_on date,
  amount_cents bigint check (amount_cents is null or amount_cents >= 0),
  cancel_cost_cents bigint check (cancel_cost_cents is null or cancel_cost_cents >= 0),
  cost_quoted_on date,
  consent_letter text not null default 'pendente' check (consent_letter in ('pendente', 'solicitada', 'recebida')),
  cancel_status text not null default 'pendente' check (cancel_status in ('pendente', 'em_andamento', 'cancelado')),
  cancelled_on date,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  removed_at timestamptz,
  removed_by uuid references auth.users(id),
  removed_reason text,
  constraint debt_protests_one_owner check ((debt_id is null) <> (group_id is null)),
  constraint debt_protests_cancelled_date check (cancel_status <> 'cancelado' or cancelled_on is not null)
);
comment on table public.debt_protests is
  'Protesto em cartório, de uma dívida OU de um grupo (D16): custas para cancelar, carta de anuência e cancelamento (0405).';
create index if not exists debt_protests_debt on public.debt_protests (debt_id);
create index if not exists debt_protests_group on public.debt_protests (group_id);

create table if not exists public.debt_lawsuits (
  id uuid primary key default gen_random_uuid(),
  debt_id uuid not null references public.debts(id) on delete restrict,
  process_number text,
  court text,
  district text,
  phase text,
  claim_cents bigint check (claim_cents is null or claim_cents >= 0),
  lawyer_name text,
  has_freeze boolean not null default false,
  has_seizure boolean not null default false,
  has_search_and_seizure boolean not null default false,
  closed_on date,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  removed_at timestamptz,
  removed_by uuid references auth.users(id),
  removed_reason text
);
comment on table public.debt_lawsuits is
  'Ação judicial da dívida: processo, vara/comarca, fase, valor da causa, advogado, bloqueio/penhora/busca e apreensão (0405).';
create index if not exists debt_lawsuits_debt on public.debt_lawsuits (debt_id);

create table if not exists public.debt_extrajudicial_notices (
  id uuid primary key default gen_random_uuid(),
  debt_id uuid not null references public.debts(id) on delete restrict,
  received_on date not null,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  removed_at timestamptz,
  removed_by uuid references auth.users(id),
  removed_reason text
);
comment on table public.debt_extrajudicial_notices is 'Notificação extrajudicial recebida (o documento vai nos anexos) (0405).';
create index if not exists debt_extrajudicial_notices_debt on public.debt_extrajudicial_notices (debt_id);

-- Portas das restrições --------------------------------------------------------
create or replace function public.debt_save_negativation(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_debt uuid := nullif(p ->> 'debt_id', '')::uuid;
  v_target text := coalesce(public._debt_text(p, 'target'), 'empresa');
begin
  if v_id is not null then
    select debt_id into v_debt from public.debt_negativations where id = v_id and removed_at is null;
    if not found then raise exception 'Negativação não encontrada.'; end if;
  end if;
  if public._debt_clinic(v_debt) is null then raise exception 'Dívida não encontrada (ou excluída).'; end if;
  if not public.debt_can('acao.dividas.lancar', public._debt_clinic(v_debt)) then
    raise exception 'Você não tem permissão para mexer nesta dívida.';
  end if;
  if coalesce(public._debt_text(p, 'bureau'), '') not in ('serasa', 'spc', 'boa_vista', 'outro') then
    raise exception 'Escolha o órgão (Serasa, SPC, Boa Vista ou outro).';
  end if;
  if v_target = 'socio' and public._debt_text(p, 'target_name') is null then
    raise exception 'Informe o nome do sócio negativado.';
  end if;
  if v_id is null then
    insert into public.debt_negativations (debt_id, bureau, included_on, amount_cents, in_limpa_nome, target,
      target_name, removal_confirmed_on, notes, created_by, updated_by)
    values (v_debt, public._debt_text(p, 'bureau'), nullif(p ->> 'included_on', '')::date,
      nullif(p ->> 'amount_cents', '')::bigint, coalesce((p ->> 'in_limpa_nome')::boolean, false), v_target,
      case when v_target = 'socio' then public._debt_text(p, 'target_name') end,
      nullif(p ->> 'removal_confirmed_on', '')::date, public._debt_text(p, 'notes'), v_uid, v_uid)
    returning id into v_id;
    perform public._debt_event(v_debt, 'negativacao', null, jsonb_build_object('id', v_id));
  else
    update public.debt_negativations
       set bureau = public._debt_text(p, 'bureau'), included_on = nullif(p ->> 'included_on', '')::date,
           amount_cents = nullif(p ->> 'amount_cents', '')::bigint,
           in_limpa_nome = coalesce((p ->> 'in_limpa_nome')::boolean, false), target = v_target,
           target_name = case when v_target = 'socio' then public._debt_text(p, 'target_name') end,
           removal_confirmed_on = nullif(p ->> 'removal_confirmed_on', '')::date,
           notes = public._debt_text(p, 'notes'), updated_by = v_uid, updated_at = now()
     where id = v_id;
  end if;
  return v_id;
end;
$$;
revoke execute on function public.debt_save_negativation(jsonb) from public, anon, authenticated;
grant execute on function public.debt_save_negativation(jsonb) to authenticated;

create or replace function public.debt_save_protest(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_debt uuid := nullif(p ->> 'debt_id', '')::uuid;
  v_group uuid := nullif(p ->> 'group_id', '')::uuid;
  v_clinic uuid;
  v_status text := coalesce(public._debt_text(p, 'cancel_status'), 'pendente');
  v_consent text := coalesce(public._debt_text(p, 'consent_letter'), 'pendente');
  v_office uuid := nullif(p ->> 'notary_office_id', '')::uuid;
  v_first uuid;
begin
  if v_id is not null then
    select debt_id, group_id into v_debt, v_group from public.debt_protests where id = v_id and removed_at is null;
    if not found then raise exception 'Protesto não encontrado.'; end if;
  end if;
  if (v_debt is null) = (v_group is null) then
    raise exception 'O protesto é de uma dívida ou de um grupo de dívidas.';
  end if;
  v_clinic := coalesce(public._debt_clinic(v_debt), public._debt_group_clinic(v_group));
  if v_clinic is null then raise exception 'Dívida ou grupo não encontrado.'; end if;
  if not public.debt_can('acao.dividas.lancar', v_clinic) then
    raise exception 'Você não tem permissão para mexer nesta dívida.';
  end if;
  if v_status not in ('pendente', 'em_andamento', 'cancelado') then raise exception 'Situação do cancelamento inválida.'; end if;
  if v_consent not in ('pendente', 'solicitada', 'recebida') then raise exception 'Situação da carta de anuência inválida.'; end if;
  if v_status = 'cancelado' and nullif(p ->> 'cancelled_on', '') is null then
    raise exception 'Informe a data do cancelamento do protesto.';
  end if;
  if v_office is not null and not exists (select 1 from public.debt_notary_offices where id = v_office) then
    raise exception 'Cartório não encontrado.';
  end if;
  if v_id is null then
    insert into public.debt_protests (debt_id, group_id, notary_office_id, protocol, protested_on, amount_cents,
      cancel_cost_cents, cost_quoted_on, consent_letter, cancel_status, cancelled_on, notes, created_by, updated_by)
    values (v_debt, v_group, v_office, public._debt_text(p, 'protocol'), nullif(p ->> 'protested_on', '')::date,
      nullif(p ->> 'amount_cents', '')::bigint, nullif(p ->> 'cancel_cost_cents', '')::bigint,
      nullif(p ->> 'cost_quoted_on', '')::date, v_consent, v_status, nullif(p ->> 'cancelled_on', '')::date,
      public._debt_text(p, 'notes'), v_uid, v_uid)
    returning id into v_id;
    -- O evento vai para a dívida; protesto de grupo, para cada dívida do grupo.
    for v_first in select id from public.debts where (id = v_debt or group_id = v_group) and deleted_at is null loop
      perform public._debt_event(v_first, 'protesto', null, jsonb_build_object('id', v_id));
    end loop;
  else
    update public.debt_protests
       set notary_office_id = v_office, protocol = public._debt_text(p, 'protocol'),
           protested_on = nullif(p ->> 'protested_on', '')::date, amount_cents = nullif(p ->> 'amount_cents', '')::bigint,
           cancel_cost_cents = nullif(p ->> 'cancel_cost_cents', '')::bigint,
           cost_quoted_on = nullif(p ->> 'cost_quoted_on', '')::date, consent_letter = v_consent,
           cancel_status = v_status, cancelled_on = nullif(p ->> 'cancelled_on', '')::date,
           notes = public._debt_text(p, 'notes'), updated_by = v_uid, updated_at = now()
     where id = v_id;
  end if;
  return v_id;
end;
$$;
revoke execute on function public.debt_save_protest(jsonb) from public, anon, authenticated;
grant execute on function public.debt_save_protest(jsonb) to authenticated;

create or replace function public.debt_save_lawsuit(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_debt uuid := nullif(p ->> 'debt_id', '')::uuid;
begin
  if v_id is not null then
    select debt_id into v_debt from public.debt_lawsuits where id = v_id and removed_at is null;
    if not found then raise exception 'Ação judicial não encontrada.'; end if;
  end if;
  if public._debt_clinic(v_debt) is null then raise exception 'Dívida não encontrada (ou excluída).'; end if;
  if not public.debt_can('acao.dividas.lancar', public._debt_clinic(v_debt)) then
    raise exception 'Você não tem permissão para mexer nesta dívida.';
  end if;
  if public._debt_text(p, 'process_number') is null and public._debt_text(p, 'court') is null then
    raise exception 'Informe o número do processo ou a vara/comarca.';
  end if;
  if v_id is null then
    insert into public.debt_lawsuits (debt_id, process_number, court, district, phase, claim_cents, lawyer_name,
      has_freeze, has_seizure, has_search_and_seizure, closed_on, notes, created_by, updated_by)
    values (v_debt, public._debt_text(p, 'process_number'), public._debt_text(p, 'court'),
      public._debt_text(p, 'district'), public._debt_text(p, 'phase'), nullif(p ->> 'claim_cents', '')::bigint,
      public._debt_text(p, 'lawyer_name'), coalesce((p ->> 'has_freeze')::boolean, false),
      coalesce((p ->> 'has_seizure')::boolean, false), coalesce((p ->> 'has_search_and_seizure')::boolean, false),
      nullif(p ->> 'closed_on', '')::date, public._debt_text(p, 'notes'), v_uid, v_uid)
    returning id into v_id;
    perform public._debt_event(v_debt, 'acao_judicial', null, jsonb_build_object('id', v_id));
  else
    update public.debt_lawsuits
       set process_number = public._debt_text(p, 'process_number'), court = public._debt_text(p, 'court'),
           district = public._debt_text(p, 'district'), phase = public._debt_text(p, 'phase'),
           claim_cents = nullif(p ->> 'claim_cents', '')::bigint, lawyer_name = public._debt_text(p, 'lawyer_name'),
           has_freeze = coalesce((p ->> 'has_freeze')::boolean, false),
           has_seizure = coalesce((p ->> 'has_seizure')::boolean, false),
           has_search_and_seizure = coalesce((p ->> 'has_search_and_seizure')::boolean, false),
           closed_on = nullif(p ->> 'closed_on', '')::date, notes = public._debt_text(p, 'notes'),
           updated_by = v_uid, updated_at = now()
     where id = v_id;
  end if;
  return v_id;
end;
$$;
revoke execute on function public.debt_save_lawsuit(jsonb) from public, anon, authenticated;
grant execute on function public.debt_save_lawsuit(jsonb) to authenticated;

create or replace function public.debt_save_notice(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_debt uuid := nullif(p ->> 'debt_id', '')::uuid;
begin
  if v_id is not null then
    select debt_id into v_debt from public.debt_extrajudicial_notices where id = v_id and removed_at is null;
    if not found then raise exception 'Notificação não encontrada.'; end if;
  end if;
  if public._debt_clinic(v_debt) is null then raise exception 'Dívida não encontrada (ou excluída).'; end if;
  if not public.debt_can('acao.dividas.lancar', public._debt_clinic(v_debt)) then
    raise exception 'Você não tem permissão para mexer nesta dívida.';
  end if;
  if nullif(p ->> 'received_on', '') is null then raise exception 'Informe a data em que a notificação chegou.'; end if;
  if v_id is null then
    insert into public.debt_extrajudicial_notices (debt_id, received_on, notes, created_by, updated_by)
    values (v_debt, (p ->> 'received_on')::date, public._debt_text(p, 'notes'), v_uid, v_uid)
    returning id into v_id;
    perform public._debt_event(v_debt, 'notificacao', null, jsonb_build_object('id', v_id));
  else
    update public.debt_extrajudicial_notices
       set received_on = (p ->> 'received_on')::date, notes = public._debt_text(p, 'notes'),
           updated_by = v_uid, updated_at = now()
     where id = v_id;
  end if;
  return v_id;
end;
$$;
revoke execute on function public.debt_save_notice(jsonb) from public, anon, authenticated;
grant execute on function public.debt_save_notice(jsonb) to authenticated;

-- "Lançado por engano": a linha fica, marcada como removida, com motivo.
create or replace function public.debt_remove_record(p_kind text, p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_debt uuid;
  v_group uuid;
  v_clinic uuid;
  v_d uuid;
begin
  if coalesce(length(btrim(p_reason)), 0) < 5 then raise exception 'Escreva o motivo da remoção.'; end if;
  case p_kind
    when 'negativacao' then select debt_id into v_debt from public.debt_negativations where id = p_id and removed_at is null;
    when 'protesto' then select debt_id, group_id into v_debt, v_group from public.debt_protests where id = p_id and removed_at is null;
    when 'acao_judicial' then select debt_id into v_debt from public.debt_lawsuits where id = p_id and removed_at is null;
    when 'notificacao' then select debt_id into v_debt from public.debt_extrajudicial_notices where id = p_id and removed_at is null;
    when 'anexo' then select debt_id into v_debt from public.debt_attachments where id = p_id and removed_at is null;
    else raise exception 'Tipo de registro inválido.';
  end case;
  v_clinic := coalesce(public._debt_clinic(v_debt), public._debt_group_clinic(v_group));
  if v_clinic is null then raise exception 'Registro não encontrado (ou já removido).'; end if;
  if not public.debt_can('acao.dividas.lancar', v_clinic) then
    raise exception 'Você não tem permissão para mexer nesta dívida.';
  end if;
  case p_kind
    when 'negativacao' then update public.debt_negativations set removed_at = now(), removed_by = v_uid, removed_reason = btrim(p_reason) where id = p_id;
    when 'protesto' then update public.debt_protests set removed_at = now(), removed_by = v_uid, removed_reason = btrim(p_reason) where id = p_id;
    when 'acao_judicial' then update public.debt_lawsuits set removed_at = now(), removed_by = v_uid, removed_reason = btrim(p_reason) where id = p_id;
    when 'notificacao' then update public.debt_extrajudicial_notices set removed_at = now(), removed_by = v_uid, removed_reason = btrim(p_reason) where id = p_id;
    when 'anexo' then update public.debt_attachments set removed_at = now(), removed_by = v_uid, removed_reason = btrim(p_reason) where id = p_id;
  end case;
  for v_d in select id from public.debts where (id = v_debt or group_id = v_group) and deleted_at is null loop
    perform public._debt_event(v_d, 'registro_removido', btrim(p_reason), jsonb_build_object('tipo', p_kind, 'id', p_id));
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4) PROPOSTAS — só crescem
-- -----------------------------------------------------------------------------
create table if not exists public.debt_proposals (
  id uuid primary key default gen_random_uuid(),
  debt_id uuid references public.debts(id) on delete restrict,
  group_id uuid references public.debt_groups(id) on delete restrict,
  proposed_on date not null,
  amount_cents bigint not null check (amount_cents > 0),
  payment_kind text not null default 'a_vista' check (payment_kind in ('a_vista', 'parcelado')),
  down_payment_cents bigint check (down_payment_cents is null or down_payment_cents >= 0),
  installments integer check (installments is null or installments between 1 and 360),
  installment_cents bigint check (installment_cents is null or installment_cents > 0),
  method text check (method is null or method in ('pix', 'boleto', 'debito', 'cartao', 'transferencia', 'outro')),
  valid_until date,
  source text not null default 'credor' check (source in ('serasa_limpa_nome', 'credor', 'assessoria', 'feirao', 'advogado', 'outro')),
  condition_text text,
  notes text,
  status text not null default 'ativa' check (status in ('ativa', 'substituida', 'aceita', 'expirada', 'recusada')),
  status_reason text,
  status_changed_at timestamptz,
  status_changed_by uuid references auth.users(id),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  constraint debt_proposals_one_owner check ((debt_id is null) <> (group_id is null)),
  constraint debt_proposals_parcelado check (payment_kind = 'a_vista' or installments is not null)
);
comment on table public.debt_proposals is
  'Histórico de propostas de quitação (3.4): cada nova é um registro; a anterior vira "substituída". Valor e condições não mudam depois de gravados (0405).';
create index if not exists debt_proposals_debt on public.debt_proposals (debt_id, created_at desc);
create index if not exists debt_proposals_group on public.debt_proposals (group_id, created_at desc);
create unique index if not exists debt_proposals_one_active_debt on public.debt_proposals (debt_id) where status = 'ativa' and debt_id is not null;
create unique index if not exists debt_proposals_one_active_group on public.debt_proposals (group_id) where status = 'ativa' and group_id is not null;

-- O que foi proposto não muda: só a situação da proposta.
create or replace function public.debt_proposals_lock()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Proposta não se apaga: registre uma nova (a anterior vira "substituída").';
  end if;
  if (new.debt_id, new.group_id, new.proposed_on, new.amount_cents, new.payment_kind, new.down_payment_cents,
      new.installments, new.installment_cents, new.method, new.valid_until, new.source, new.condition_text,
      new.created_by, new.created_at)
     is distinct from
     (old.debt_id, old.group_id, old.proposed_on, old.amount_cents, old.payment_kind, old.down_payment_cents,
      old.installments, old.installment_cents, old.method, old.valid_until, old.source, old.condition_text,
      old.created_by, old.created_at) then
    raise exception 'O que foi proposto não muda: registre uma nova proposta.';
  end if;
  return new;
end;
$$;
drop trigger if exists debt_proposals_lock on public.debt_proposals;
create trigger debt_proposals_lock before update or delete on public.debt_proposals
  for each row execute function public.debt_proposals_lock();

create or replace function public.debt_save_proposal(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_debt uuid := nullif(p ->> 'debt_id', '')::uuid;
  v_group uuid := nullif(p ->> 'group_id', '')::uuid;
  v_clinic uuid;
  v_kind text := coalesce(public._debt_text(p, 'payment_kind'), 'a_vista');
  v_valid date := nullif(p ->> 'valid_until', '')::date;
  v_id uuid;
  v_d uuid;
begin
  if (v_debt is null) = (v_group is null) then
    raise exception 'A proposta é de uma dívida ou de um grupo de dívidas.';
  end if;
  v_clinic := coalesce(public._debt_clinic(v_debt), public._debt_group_clinic(v_group));
  if v_clinic is null then raise exception 'Dívida ou grupo não encontrado.'; end if;
  if not public.debt_can('acao.dividas.lancar', v_clinic) then
    raise exception 'Você não tem permissão para registrar propostas.';
  end if;
  if coalesce(nullif(p ->> 'amount_cents', '')::bigint, 0) <= 0 then raise exception 'Informe o valor da proposta.'; end if;
  if v_kind = 'parcelado' and nullif(p ->> 'installments', '') is null then
    raise exception 'Proposta parcelada precisa do número de parcelas.';
  end if;
  if v_valid is not null and v_valid < public.today_br() then
    raise exception 'A validade da proposta já passou.';
  end if;

  -- A proposta anterior (da mesma dívida ou do mesmo grupo) vira "substituída".
  update public.debt_proposals
     set status = 'substituida', status_changed_at = now(), status_changed_by = v_uid
   where status = 'ativa' and ((v_debt is not null and debt_id = v_debt) or (v_group is not null and group_id = v_group));

  insert into public.debt_proposals (debt_id, group_id, proposed_on, amount_cents, payment_kind, down_payment_cents,
    installments, installment_cents, method, valid_until, source, condition_text, notes, created_by)
  values (v_debt, v_group, coalesce(nullif(p ->> 'proposed_on', '')::date, public.today_br()),
    (p ->> 'amount_cents')::bigint, v_kind, nullif(p ->> 'down_payment_cents', '')::bigint,
    case when v_kind = 'parcelado' then nullif(p ->> 'installments', '')::integer end,
    case when v_kind = 'parcelado' then nullif(p ->> 'installment_cents', '')::bigint end,
    public._debt_text(p, 'method'), v_valid, coalesce(public._debt_text(p, 'source'), 'credor'),
    public._debt_text(p, 'condition_text'), public._debt_text(p, 'notes'), v_uid)
  returning id into v_id;

  for v_d in select id from public.debts where (id = v_debt or group_id = v_group) and deleted_at is null loop
    perform public._debt_event(v_d, 'proposta', null, jsonb_build_object('id', v_id, 'amount_cents', (p ->> 'amount_cents')::bigint));
  end loop;
  return v_id;
end;
$$;
revoke execute on function public.debt_save_proposal(jsonb) from public, anon, authenticated;
grant execute on function public.debt_save_proposal(jsonb) to authenticated;

-- Recusar/expirar à mão (aceitar é da renegociação, fase 5).
create or replace function public.debt_set_proposal_status(p_id uuid, p_status text, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  r public.debt_proposals%rowtype;
  v_clinic uuid;
  v_d uuid;
begin
  select * into r from public.debt_proposals where id = p_id for update;
  if not found then raise exception 'Proposta não encontrada.'; end if;
  v_clinic := coalesce(public._debt_clinic(r.debt_id), public._debt_group_clinic(r.group_id));
  if v_clinic is null or not public.debt_can('acao.dividas.lancar', v_clinic) then
    raise exception 'Você não tem permissão para mexer nesta proposta.';
  end if;
  if r.status <> 'ativa' then raise exception 'Só a proposta ativa muda de situação.'; end if;
  if p_status not in ('recusada', 'expirada') then raise exception 'Situação inválida.'; end if;
  if p_status = 'recusada' and coalesce(length(btrim(p_reason)), 0) < 5 then
    raise exception 'Escreva o motivo da recusa.';
  end if;
  update public.debt_proposals
     set status = p_status, status_reason = nullif(btrim(p_reason), ''), status_changed_at = now(), status_changed_by = v_uid
   where id = p_id;
  for v_d in select id from public.debts where (id = r.debt_id or group_id = r.group_id) and deleted_at is null loop
    perform public._debt_event(v_d, 'proposta_' || p_status, nullif(btrim(p_reason), ''), jsonb_build_object('id', p_id));
  end loop;
end;
$$;
revoke execute on function public.debt_set_proposal_status(uuid, text, text) from public, anon, authenticated;
grant execute on function public.debt_set_proposal_status(uuid, text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 5) A LINHA DO TEMPO DE CONTATOS — só cresce
-- -----------------------------------------------------------------------------
create table if not exists public.debt_contacts (
  id uuid primary key default gen_random_uuid(),
  debt_id uuid not null references public.debts(id) on delete restrict,
  occurred_at timestamptz not null,
  channel text not null check (channel in ('ligacao', 'whatsapp', 'email', 'presencial', 'carta', 'outro')),
  contact_id uuid references public.debt_creditor_contacts(id) on delete set null,
  summary text not null check (btrim(summary) <> ''),
  user_id uuid references auth.users(id),
  created_at timestamptz not null default now()
);
comment on table public.debt_contacts is
  'Cada ligação, e-mail ou mensagem com o credor (data, canal, resumo, quem fez). Só cresce (0405).';
create index if not exists debt_contacts_debt on public.debt_contacts (debt_id, occurred_at desc);

create or replace function public.debt_contacts_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'O registro de contato não se altera nem se apaga: registre outro com a correção.';
end;
$$;
drop trigger if exists debt_contacts_immutable on public.debt_contacts;
create trigger debt_contacts_immutable before update or delete on public.debt_contacts
  for each row execute function public.debt_contacts_immutable();

create or replace function public.debt_log_contact(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_debt uuid := nullif(p ->> 'debt_id', '')::uuid;
  v_contact uuid := nullif(p ->> 'contact_id', '')::uuid;
  v_when timestamptz := coalesce(nullif(p ->> 'occurred_at', '')::timestamptz, now());
  v_id uuid;
begin
  if public._debt_clinic(v_debt) is null then raise exception 'Dívida não encontrada (ou excluída).'; end if;
  if not public.debt_can('acao.dividas.lancar', public._debt_clinic(v_debt)) then
    raise exception 'Você não tem permissão para registrar contatos.';
  end if;
  if coalesce(public._debt_text(p, 'channel'), '') not in ('ligacao', 'whatsapp', 'email', 'presencial', 'carta', 'outro') then
    raise exception 'Escolha o canal do contato.';
  end if;
  if public._debt_text(p, 'summary') is null then raise exception 'Escreva o resumo do contato.'; end if;
  if v_when > now() + interval '5 minutes' then raise exception 'O contato não pode estar no futuro.'; end if;
  if v_contact is not null and not exists (
       select 1 from public.debt_creditor_contacts c join public.debts d on d.supplier_id = c.supplier_id
        where c.id = v_contact and d.id = v_debt) then
    raise exception 'O contato escolhido é de outro credor.';
  end if;
  insert into public.debt_contacts (debt_id, occurred_at, channel, contact_id, summary, user_id)
  values (v_debt, v_when, public._debt_text(p, 'channel'), v_contact, public._debt_text(p, 'summary'), v_uid)
  returning id into v_id;
  -- Falar com o credor é também conferir a dívida, se assim foi marcado.
  if coalesce((p ->> 'mark_checked')::boolean, false) then
    update public.debts set last_checked_on = (v_when at time zone 'America/Sao_Paulo')::date,
           updated_by = v_uid, updated_at = now()
     where id = v_debt;
  end if;
  return v_id;
end;
$$;
revoke execute on function public.debt_log_contact(jsonb) from public, anon, authenticated;
grant execute on function public.debt_log_contact(jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- 6) ANEXOS — pasta privada `dividas`
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('dividas', 'dividas', false, 10485760,
        array['application/pdf', 'image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.debt_attachments (
  id uuid primary key default gen_random_uuid(),
  debt_id uuid not null references public.debts(id) on delete restrict,
  kind text not null check (kind in ('contrato', 'boleto', 'notificacao', 'proposta', 'comprovante',
                                     'quitacao', 'anuencia', 'termo_acordo', 'custas', 'outro')),
  ref_table text check (ref_table is null or ref_table in ('debt_proposals', 'debt_protests', 'debt_negativations',
                                                           'debt_lawsuits', 'debt_extrajudicial_notices')),
  ref_id uuid,
  path text not null unique,
  file_name text not null,
  size_bytes bigint,
  mime_type text,
  uploaded_by uuid references auth.users(id),
  uploaded_at timestamptz not null default now(),
  removed_at timestamptz,
  removed_by uuid references auth.users(id),
  removed_reason text
);
comment on table public.debt_attachments is
  'Anexos da dívida (contrato, boleto, notificação, proposta, comprovante, quitação, anuência…), na pasta privada `dividas`. Remover = lógico, com motivo; o arquivo fica (0405).';
create index if not exists debt_attachments_debt on public.debt_attachments (debt_id);

-- De que dívida é um arquivo da pasta (primeira parte do caminho).
create or replace function public.debt_of_attachment_path(p_name text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  return split_part(p_name, '/', 1)::uuid;
exception when others then
  return null;
end;
$$;
revoke execute on function public.debt_of_attachment_path(text) from public, anon, authenticated;
grant execute on function public.debt_of_attachment_path(text) to authenticated;

create or replace function public.debt_can_attach(p_debt_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public._debt_clinic(p_debt_id) is not null
     and public.debt_can('acao.dividas.lancar', public._debt_clinic(p_debt_id));
$$;
revoke execute on function public.debt_can_attach(uuid) from public, anon, authenticated;
grant execute on function public.debt_can_attach(uuid) to authenticated;

-- VER = quem vê a dívida (a regra da tabela decide); ENVIAR = quem lança;
-- APAGAR = ninguém (o arquivo é prova; remover é lógico, na tabela).
drop policy if exists "dividas_select" on storage.objects;
create policy "dividas_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'dividas'
    and exists (select 1 from public.debts d where d.id = public.debt_of_attachment_path(name))
  );
drop policy if exists "dividas_insert" on storage.objects;
create policy "dividas_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'dividas'
    and public.debt_of_attachment_path(name) is not null
    and public.debt_can_attach(public.debt_of_attachment_path(name))
  );

create or replace function public.debt_attach(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_debt uuid := nullif(p ->> 'debt_id', '')::uuid;
  v_path text := public._debt_text(p, 'path');
  v_kind text := coalesce(public._debt_text(p, 'kind'), 'outro');
  v_ref_table text := public._debt_text(p, 'ref_table');
  v_ref uuid := nullif(p ->> 'ref_id', '')::uuid;
  v_obj record;
  v_id uuid;
begin
  if not public.debt_can_attach(v_debt) then raise exception 'Você não tem permissão para anexar nesta dívida.'; end if;
  if v_path is null or public.debt_of_attachment_path(v_path) is distinct from v_debt then
    raise exception 'O arquivo não é desta dívida.';
  end if;
  select o.metadata into v_obj from storage.objects o where o.bucket_id = 'dividas' and o.name = v_path;
  if not found then raise exception 'O arquivo não chegou à pasta. Envie de novo.'; end if;
  if v_ref_table is not null and v_ref is null then raise exception 'Referência do anexo incompleta.'; end if;
  insert into public.debt_attachments (debt_id, kind, ref_table, ref_id, path, file_name, size_bytes, mime_type, uploaded_by)
  values (v_debt, v_kind, v_ref_table, v_ref, v_path,
          coalesce(public._debt_text(p, 'file_name'), split_part(v_path, '/', 2)),
          nullif(v_obj.metadata ->> 'size', '')::bigint, v_obj.metadata ->> 'mimetype', v_uid)
  returning id into v_id;
  perform public._debt_event(v_debt, 'anexo', null, jsonb_build_object('id', v_id, 'kind', v_kind));
  return v_id;
exception when unique_violation then
  raise exception 'Este arquivo já está registrado.';
end;
$$;
revoke execute on function public.debt_attach(jsonb) from public, anon, authenticated;
grant execute on function public.debt_attach(jsonb) to authenticated;

-- A porta de remoção vale para os anexos também (criada acima, antes da tabela
-- existir: plpgsql só resolve o nome na hora de rodar).
revoke execute on function public.debt_remove_record(text, uuid, text) from public, anon, authenticated;
grant execute on function public.debt_remove_record(text, uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 7) A ROTINA DIÁRIA: também expira as propostas vencidas
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
begin
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
  return v_n;
end;
$$;
revoke execute on function public.debt_daily_run() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 8) O HISTÓRICO passa a incluir os registros da fase 2
-- -----------------------------------------------------------------------------
create or replace function public.debt_history(p_debt_id uuid)
returns table (
  source text,
  occurred_at timestamptz,
  user_name text,
  actor text,
  table_name text,
  op text,
  changes jsonb,
  event_kind text,
  from_status text,
  to_status text,
  note text
)
language sql
stable
security definer
set search_path = ''
as $$
  with alvo as (
    select d.id, d.group_id from public.debts d
     where d.id = p_debt_id and public.debt_can('modulo.dividas', d.clinic_id)
  ),
  linhas as (
    select 'debts'::text as t, a.id::text as rid from alvo a
    union all select 'debt_negativations', n.id::text from public.debt_negativations n join alvo a on n.debt_id = a.id
    union all select 'debt_protests', x.id::text from public.debt_protests x join alvo a on x.debt_id = a.id or (a.group_id is not null and x.group_id = a.group_id)
    union all select 'debt_lawsuits', l.id::text from public.debt_lawsuits l join alvo a on l.debt_id = a.id
    union all select 'debt_extrajudicial_notices', e.id::text from public.debt_extrajudicial_notices e join alvo a on e.debt_id = a.id
    union all select 'debt_attachments', f.id::text from public.debt_attachments f join alvo a on f.debt_id = a.id
    union all select 'debt_proposals', pr.id::text from public.debt_proposals pr join alvo a on pr.debt_id = a.id or (a.group_id is not null and pr.group_id = a.group_id)
  )
  select 'trilha', a.occurred_at, pr.full_name, a.actor, a.table_name, a.op, a.changes,
         null, null, null, null
    from public.audit_changes a
    join linhas l on l.t = a.table_name and l.rid = a.row_id
    left join public.profiles pr on pr.id = a.user_id
   where a.schema_name = 'public'
  union all
  select 'trilha', a.occurred_at, pr.full_name, a.actor, a.table_name, a.op, a.changes,
         null, null, null, null
    from public.audit_changes a
    join alvo on true
    left join public.profiles pr on pr.id = a.user_id
   where a.schema_name = 'public' and a.table_name = 'debt_tag_links' and a.row_id like p_debt_id::text || ',%'
  union all
  select 'evento', e.occurred_at, pr.full_name, case when e.user_id is null then 'sistema' else 'usuario' end,
         null, null, e.data, e.kind, e.from_status, e.to_status, e.note
    from public.debt_events e
    join alvo on alvo.id = e.debt_id
    left join public.profiles pr on pr.id = e.user_id
  order by 2 desc
  limit 800;
$$;
revoke execute on function public.debt_history(uuid) from public, anon, authenticated;
grant execute on function public.debt_history(uuid) to authenticated;

-- A regra da rede passa a gravar o prazo do selo "Conferir" também. Mesma
-- assinatura da 0404; a coluna nova entra no insert e no update.
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
    updated_by, updated_at)
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
    updated_by = v_uid, updated_at = now();

  perform public._debt_refresh_status(d.id, false)
     from public.debts d
    where d.deleted_at is null and (p_clinic_id is null or d.clinic_id = p_clinic_id);
end;
$$;
revoke execute on function public.debt_save_settings(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.debt_save_settings(uuid, jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- 9) LEITURA (RLS) — quem vê a dívida vê o que é dela; nenhuma regra de escrita
-- -----------------------------------------------------------------------------
alter table public.debt_notary_offices enable row level security;
alter table public.debt_negativations enable row level security;
alter table public.debt_protests enable row level security;
alter table public.debt_lawsuits enable row level security;
alter table public.debt_extrajudicial_notices enable row level security;
alter table public.debt_proposals enable row level security;
alter table public.debt_contacts enable row level security;
alter table public.debt_attachments enable row level security;

drop policy if exists "debt_notary_offices_select" on public.debt_notary_offices;
create policy "debt_notary_offices_select" on public.debt_notary_offices for select to authenticated
  using (public.debt_can('modulo.dividas', null));
drop policy if exists "debt_negativations_select" on public.debt_negativations;
create policy "debt_negativations_select" on public.debt_negativations for select to authenticated
  using (exists (select 1 from public.debts d where d.id = debt_id));
drop policy if exists "debt_protests_select" on public.debt_protests;
create policy "debt_protests_select" on public.debt_protests for select to authenticated
  using (exists (select 1 from public.debts d where d.id = debt_id)
      or exists (select 1 from public.debt_groups g where g.id = group_id));
drop policy if exists "debt_lawsuits_select" on public.debt_lawsuits;
create policy "debt_lawsuits_select" on public.debt_lawsuits for select to authenticated
  using (exists (select 1 from public.debts d where d.id = debt_id));
drop policy if exists "debt_extrajudicial_notices_select" on public.debt_extrajudicial_notices;
create policy "debt_extrajudicial_notices_select" on public.debt_extrajudicial_notices for select to authenticated
  using (exists (select 1 from public.debts d where d.id = debt_id));
drop policy if exists "debt_proposals_select" on public.debt_proposals;
create policy "debt_proposals_select" on public.debt_proposals for select to authenticated
  using (exists (select 1 from public.debts d where d.id = debt_id)
      or exists (select 1 from public.debt_groups g where g.id = group_id));
drop policy if exists "debt_contacts_select" on public.debt_contacts;
create policy "debt_contacts_select" on public.debt_contacts for select to authenticated
  using (exists (select 1 from public.debts d where d.id = debt_id));
drop policy if exists "debt_attachments_select" on public.debt_attachments;
create policy "debt_attachments_select" on public.debt_attachments for select to authenticated
  using (exists (select 1 from public.debts d where d.id = debt_id));

-- -----------------------------------------------------------------------------
-- 10) AUDITORIA
-- -----------------------------------------------------------------------------
insert into public.audit_excluded_tables (schema_name, table_name, motivo) values
  ('public', 'debt_contacts', 'Linha do tempo de contatos com o credor: ela própria é o histórico, só cresce (0405).')
on conflict (schema_name, table_name) do nothing;

select public.audit_attach_all();

-- -----------------------------------------------------------------------------
-- CONFERÊNCIA (rodar à parte, depois): o esperado é 18 · 60 · true · 0
-- -----------------------------------------------------------------------------
-- select
--   (select count(*) from pg_tables where schemaname = 'public' and tablename like 'debt%') as tabelas,
--   (select stale_check_days from public.debt_settings where clinic_id is null) as prazo_conferir,
--   (select not public from storage.buckets where id = 'dividas') as pasta_privada,
--   (select count(*) from public.audit_missing_tables() t where t.table_name like 'debt%') as sem_auditoria;

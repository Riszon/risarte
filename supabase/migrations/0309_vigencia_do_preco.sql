-- =============================================================================
-- 0309 — VIGÊNCIA DO PREÇO DOS PROCEDIMENTOS (Odontograma OD1, decisão D3)
--
-- Decisões do dono (19–20/10/2026):
--   * O preço continua sendo da rede com ajuste por unidade — e passa a ter
--     DATA: o reajuste vale a partir de um dia, e o preço de cada dia fica
--     guardado.
--   * Reajuste com data futura: o BANCO aplica sozinho na madrugada da data
--     (00h05 de Brasília). Se não aplicar, a tela avisa "atrasado" e o Admin
--     tem "Aplicar agora".
--   * Data no passado: NÃO — hoje ou futuro.
--   * Dá para agendar no preço da rede, no preço da unidade e no reajuste em
--     massa.
--
-- O DESENHO, para mexer o mínimo no que funciona:
--   * O PREÇO DE HOJE continua onde está (`procedures.default_price_cents` e
--     `clinic_procedure_prices`). Nenhuma tela nem conta que lê preço muda —
--     inclusive a trava do orçamento (`catalog_price_for`, 0306).
--   * O HISTÓRICO nasce de um GATILHO nas duas tabelas: toda mudança, por
--     qualquer caminho (cadastro, edição, importação, reajuste, Precificação,
--     sugestão aprovada, agendamento), vira uma linha com data e autor.
--     Nenhum caminho consegue esquecer de registrar. O histórico nunca muda.
--   * O AGENDAMENTO guarda o preço futuro; a rotina da madrugada o aplica
--     pelo caminho normal (UPDATE), e o gatilho registra.
--   * ⚠️ O HISTÓRICO CONTA O QUE VALEU DE VERDADE: se a madrugada falhar e o
--     reajuste entrar dias depois, a data registrada é a do dia em que o
--     preço MUDOU — até lá os orçamentos usaram o preço antigo (achado no
--     ensaio, 20/10/2026). E reajuste atrasado NÃO passa por cima de uma
--     mudança feita à mão depois da data marcada: fica cancelado, com o motivo.
--
-- Idempotente. Nada apaga dado.
-- =============================================================================

-- 1) O histórico ---------------------------------------------------------------
create table if not exists public.procedure_price_history (
  id uuid primary key default gen_random_uuid(),
  -- Apagar um procedimento NUNCA usado (o caminho que já existe) leva o
  -- histórico junto; fora isso, o histórico não se apaga (gatilho abaixo).
  procedure_id uuid not null references public.procedures (id) on delete cascade,
  -- nulo = preço padrão da rede; preenchido = ajuste daquela unidade
  clinic_id uuid references public.clinics (id),
  -- nulo só para a unidade: o ajuste saiu e ela voltou ao preço da rede
  price_cents integer check (price_cents is null or price_cents >= 0),
  valid_from date not null,
  source text not null
    check (source in ('inicial', 'cadastro', 'alteracao', 'agendado', 'remocao')),
  schedule_id uuid,
  changed_by uuid references public.profiles (id),
  created_at timestamptz not null default clock_timestamp(),
  check (price_cents is not null or clinic_id is not null)
);
create index if not exists procedure_price_history_idx
  on public.procedure_price_history (procedure_id, clinic_id, valid_from desc, created_at desc);

-- 2) O agendamento ---------------------------------------------------------------
create table if not exists public.procedure_price_schedule (
  id uuid primary key default gen_random_uuid(),
  procedure_id uuid not null references public.procedures (id) on delete cascade,
  clinic_id uuid references public.clinics (id),
  price_cents integer not null check (price_cents >= 0),
  -- reajuste em massa com a faixa junto (só no preço da rede)
  set_band boolean not null default false,
  min_price_cents integer check (min_price_cents is null or min_price_cents >= 0),
  max_price_cents integer check (max_price_cents is null or max_price_cents >= 0),
  valid_from date not null,
  status text not null default 'agendado' check (status in ('agendado', 'aplicado', 'cancelado')),
  note text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  applied_at timestamptz,
  cancelled_by uuid references public.profiles (id),
  cancelled_at timestamptz,
  check (not set_band or clinic_id is null)
);
-- Um agendamento em aberto por (procedimento, unidade/rede, data).
create unique index if not exists procedure_price_schedule_aberto_idx
  on public.procedure_price_schedule (procedure_id, coalesce(clinic_id, '00000000-0000-0000-0000-000000000000'::uuid), valid_from)
  where status = 'agendado';

alter table public.procedure_price_history enable row level security;
alter table public.procedure_price_schedule enable row level security;
-- Leitura como o catálogo (quem está logado lê preço); escrita só pelos
-- gatilhos e pelas funções abaixo.
drop policy if exists procedure_price_history_select on public.procedure_price_history;
create policy procedure_price_history_select on public.procedure_price_history
  for select to authenticated using (true);
drop policy if exists procedure_price_schedule_select on public.procedure_price_schedule;
create policy procedure_price_schedule_select on public.procedure_price_schedule
  for select to authenticated using (true);

-- O histórico nunca muda (nem o dono do banco). A única exclusão aceita é a
-- que vem EM CASCATA de apagar o próprio procedimento (nunca usado): aí o
-- gatilho roda dentro do gatilho da chave estrangeira (profundidade > 1).
-- Apagar direto uma linha do histórico tem profundidade 1 — recusado.
create or replace function public.procedure_price_history_immutable()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception 'PRICE_HISTORY_IMMUTABLE';
end;
$$;
revoke execute on function public.procedure_price_history_immutable() from public, anon, authenticated;
drop trigger if exists procedure_price_history_immutable_trg on public.procedure_price_history;
create trigger procedure_price_history_immutable_trg
  before update or delete on public.procedure_price_history
  for each row execute function public.procedure_price_history_immutable();

-- 3) Os gatilhos que escrevem o histórico ----------------------------------------
-- A rotina do agendamento informa a ORIGEM e QUEM agendou pela configuração
-- da transação (set_config ... true) — sem ela, é mudança feita agora, por
-- quem está logado. A DATA é sempre a de hoje: é quando o preço mudou.
create or replace function public._price_history_context(
  out o_source text, out o_valid_from date, out o_changed_by uuid, out o_schedule_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  o_source := nullif(current_setting('risarte.price_source', true), '');
  o_valid_from := public.today_br();
  o_changed_by := coalesce(nullif(current_setting('risarte.price_changed_by', true), '')::uuid, (select auth.uid()));
  o_schedule_id := nullif(current_setting('risarte.price_schedule_id', true), '')::uuid;
end;
$$;
revoke execute on function public._price_history_context() from public, anon, authenticated;

create or replace function public.procedures_price_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare c record;
begin
  if tg_op = 'UPDATE' and new.default_price_cents is not distinct from old.default_price_cents then
    return new;
  end if;
  select * into c from public._price_history_context();
  insert into public.procedure_price_history
    (procedure_id, clinic_id, price_cents, valid_from, source, schedule_id, changed_by)
  values
    (new.id, null, new.default_price_cents, c.o_valid_from,
     coalesce(c.o_source, case when tg_op = 'INSERT' then 'cadastro' else 'alteracao' end),
     c.o_schedule_id, c.o_changed_by);
  return new;
end;
$$;
revoke execute on function public.procedures_price_history() from public, anon, authenticated;
drop trigger if exists procedures_price_history_trg on public.procedures;
create trigger procedures_price_history_trg
  after insert or update of default_price_cents on public.procedures
  for each row execute function public.procedures_price_history();

create or replace function public.clinic_prices_price_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare c record;
begin
  if tg_op = 'UPDATE' and new.price_cents is not distinct from old.price_cents then
    return new;
  end if;
  select * into c from public._price_history_context();
  if tg_op = 'DELETE' then
    insert into public.procedure_price_history
      (procedure_id, clinic_id, price_cents, valid_from, source, schedule_id, changed_by)
    values (old.procedure_id, old.clinic_id, null, c.o_valid_from, 'remocao', c.o_schedule_id, c.o_changed_by);
    return old;
  end if;
  insert into public.procedure_price_history
    (procedure_id, clinic_id, price_cents, valid_from, source, schedule_id, changed_by)
  values
    (new.procedure_id, new.clinic_id, new.price_cents, c.o_valid_from,
     coalesce(c.o_source, 'alteracao'), c.o_schedule_id, c.o_changed_by);
  return new;
end;
$$;
revoke execute on function public.clinic_prices_price_history() from public, anon, authenticated;
drop trigger if exists clinic_prices_price_history_trg on public.clinic_procedure_prices;
create trigger clinic_prices_price_history_trg
  after insert or update of price_cents or delete on public.clinic_procedure_prices
  for each row execute function public.clinic_prices_price_history();

-- O ponto de partida: o preço de hoje vira a primeira linha (o que veio
-- antes não está registrado em lugar nenhum com data — não inventamos).
insert into public.procedure_price_history (procedure_id, clinic_id, price_cents, valid_from, source)
select p.id, null, p.default_price_cents, public.today_br(), 'inicial'
  from public.procedures p
 where not exists (select 1 from public.procedure_price_history h
                    where h.procedure_id = p.id and h.clinic_id is null);
insert into public.procedure_price_history (procedure_id, clinic_id, price_cents, valid_from, source)
select cp.procedure_id, cp.clinic_id, cp.price_cents, public.today_br(), 'inicial'
  from public.clinic_procedure_prices cp
 where not exists (select 1 from public.procedure_price_history h
                    where h.procedure_id = cp.procedure_id and h.clinic_id = cp.clinic_id);

-- 4) O preço de um dia qualquer (pelo histórico) -------------------------------
create or replace function public.procedure_price_on(p_clinic_id uuid, p_procedure_id uuid, p_date date)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  with unidade as (
    select h.price_cents, true as tem
      from public.procedure_price_history h
     where p_clinic_id is not null and h.clinic_id = p_clinic_id
       and h.procedure_id = p_procedure_id and h.valid_from <= p_date
     order by h.valid_from desc, h.created_at desc
     limit 1
  ), rede as (
    select h.price_cents
      from public.procedure_price_history h
     where h.clinic_id is null and h.procedure_id = p_procedure_id and h.valid_from <= p_date
     order by h.valid_from desc, h.created_at desc
     limit 1
  )
  select coalesce((select price_cents from unidade), (select price_cents from rede));
$$;
revoke execute on function public.procedure_price_on(uuid, uuid, date) from public, anon, authenticated;
grant execute on function public.procedure_price_on(uuid, uuid, date) to authenticated;

-- 5) Agendar e cancelar (só o Admin, como todo o catálogo desde a 0306) -------
create or replace function public.schedule_procedure_price(
  p_procedure_id uuid, p_clinic_id uuid, p_price_cents integer, p_valid_from date, p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_id uuid;
begin
  if v_user is null or not public.is_admin_master() then raise exception 'NOT_ALLOWED'; end if;
  if p_valid_from is null or p_valid_from <= public.today_br() then raise exception 'DATE_NOT_FUTURE'; end if;
  if coalesce(p_price_cents, -1) < 0 then raise exception 'INVALID_PRICE'; end if;
  if not exists (select 1 from public.procedures where id = p_procedure_id) then raise exception 'PROCEDURE_NOT_FOUND'; end if;
  if p_clinic_id is not null and not exists (select 1 from public.clinics where id = p_clinic_id) then
    raise exception 'CLINIC_NOT_FOUND';
  end if;

  -- Reagendar a mesma data troca o valor: o anterior fica cancelado.
  update public.procedure_price_schedule
     set status = 'cancelado', cancelled_by = v_user, cancelled_at = now()
   where procedure_id = p_procedure_id and clinic_id is not distinct from p_clinic_id
     and valid_from = p_valid_from and status = 'agendado';

  insert into public.procedure_price_schedule
    (procedure_id, clinic_id, price_cents, valid_from, note, created_by)
  values (p_procedure_id, p_clinic_id, p_price_cents, p_valid_from, nullif(btrim(coalesce(p_note, '')), ''), v_user)
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function public.schedule_procedure_price(uuid, uuid, integer, date, text) from public, anon, authenticated;
grant execute on function public.schedule_procedure_price(uuid, uuid, integer, date, text) to authenticated;

-- Reajuste em massa com data: o percentual é aplicado sobre o preço de HOJE,
-- e o resultado fica agendado (como o reajuste imediato, só no preço da rede).
create or replace function public.schedule_price_readjust(
  p_procedure_ids uuid[], p_percent numeric, p_apply_to_band boolean, p_valid_from date
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_fator numeric;
  v_qtd integer;
begin
  if v_user is null or not public.is_admin_master() then raise exception 'NOT_ALLOWED'; end if;
  if p_valid_from is null or p_valid_from <= public.today_br() then raise exception 'DATE_NOT_FUTURE'; end if;
  if p_percent is null or p_percent = 0 then raise exception 'INVALID_PERCENT'; end if;
  v_fator := 1 + p_percent / 100;
  if v_fator <= 0 then raise exception 'INVALID_PERCENT'; end if;
  if coalesce(array_length(p_procedure_ids, 1), 0) = 0 then raise exception 'NOTHING_SELECTED'; end if;

  update public.procedure_price_schedule
     set status = 'cancelado', cancelled_by = v_user, cancelled_at = now()
   where procedure_id = any (p_procedure_ids) and clinic_id is null
     and valid_from = p_valid_from and status = 'agendado';

  insert into public.procedure_price_schedule
    (procedure_id, clinic_id, price_cents, set_band, min_price_cents, max_price_cents, valid_from, note, created_by)
  select p.id, null,
         greatest(0, round(p.default_price_cents * v_fator))::integer,
         coalesce(p_apply_to_band, false),
         case when p_apply_to_band and p.min_price_cents is not null then greatest(0, round(p.min_price_cents * v_fator))::integer end,
         case when p_apply_to_band and p.max_price_cents is not null then greatest(0, round(p.max_price_cents * v_fator))::integer end,
         p_valid_from,
         'Reajuste de ' || case when p_percent > 0 then '+' else '' end
           || replace(trim(trailing '.' from to_char(p_percent, 'FM999990.99')), '.', ',') || '%',
         v_user
    from public.procedures p
   where p.id = any (p_procedure_ids);
  get diagnostics v_qtd = row_count;
  return v_qtd;
end;
$$;
revoke execute on function public.schedule_price_readjust(uuid[], numeric, boolean, date) from public, anon, authenticated;
grant execute on function public.schedule_price_readjust(uuid[], numeric, boolean, date) to authenticated;

create or replace function public.cancel_procedure_price_schedule(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_user uuid := (select auth.uid());
begin
  if v_user is null or not public.is_admin_master() then raise exception 'NOT_ALLOWED'; end if;
  update public.procedure_price_schedule
     set status = 'cancelado', cancelled_by = v_user, cancelled_at = now()
   where id = p_id and status = 'agendado';
  if not found then raise exception 'SCHEDULE_NOT_OPEN'; end if;
end;
$$;
revoke execute on function public.cancel_procedure_price_schedule(uuid) from public, anon, authenticated;
grant execute on function public.cancel_procedure_price_schedule(uuid) to authenticated;

-- 6) A rotina que aplica o que venceu -----------------------------------------
-- Interna (sem guarda): roda na madrugada pelo cron e pela porta do Admin.
create or replace function public._apply_due_procedure_prices()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  s record;
  v_qtd integer := 0;
begin
  for s in
    select * from public.procedure_price_schedule
     where status = 'agendado' and valid_from <= public.today_br()
     order by valid_from, created_at
     for update skip locked
  loop
    -- Mudança feita À MÃO no mesmo preço, na data marcada ou depois: o
    -- reajuste velho não passa por cima dela.
    if exists (select 1 from public.procedure_price_history h
                where h.procedure_id = s.procedure_id
                  and h.clinic_id is not distinct from s.clinic_id
                  and h.source in ('alteracao', 'remocao')
                  and h.valid_from >= s.valid_from) then
      update public.procedure_price_schedule
         set status = 'cancelado', cancelled_at = now(),
             note = concat_ws(' · ', note, 'não aplicado: o preço foi mudado à mão depois da data marcada')
       where id = s.id;
      continue;
    end if;

    perform set_config('risarte.price_source', 'agendado', true);
    perform set_config('risarte.price_changed_by', coalesce(s.created_by::text, ''), true);
    perform set_config('risarte.price_schedule_id', s.id::text, true);

    if s.clinic_id is null then
      update public.procedures
         set default_price_cents = s.price_cents,
             min_price_cents = case when s.set_band then s.min_price_cents else min_price_cents end,
             max_price_cents = case when s.set_band then s.max_price_cents else max_price_cents end,
             updated_at = now()
       where id = s.procedure_id;
    else
      insert into public.clinic_procedure_prices (clinic_id, procedure_id, price_cents, updated_at)
      values (s.clinic_id, s.procedure_id, s.price_cents, now())
      on conflict (clinic_id, procedure_id)
      do update set price_cents = excluded.price_cents, updated_at = now();
    end if;

    update public.procedure_price_schedule
       set status = 'aplicado', applied_at = now()
     where id = s.id;
    v_qtd := v_qtd + 1;
  end loop;

  perform set_config('risarte.price_source', '', true);
  perform set_config('risarte.price_changed_by', '', true);
  perform set_config('risarte.price_schedule_id', '', true);
  return v_qtd;
end;
$$;
revoke execute on function public._apply_due_procedure_prices() from public, anon, authenticated;

-- "Aplicar agora": a porta do Admin, para quando a madrugada falhar.
create or replace function public.apply_due_procedure_prices()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not public.is_admin_master() then raise exception 'NOT_ALLOWED'; end if;
  return public._apply_due_procedure_prices();
end;
$$;
revoke execute on function public.apply_due_procedure_prices() from public, anon, authenticated;
grant execute on function public.apply_due_procedure_prices() to authenticated;

-- Todo dia às 00h05 de Brasília (03h05 UTC).
do $$
begin
  perform cron.schedule(
    'risarte-precos-agendados', '5 3 * * *',
    'select public._apply_due_procedure_prices()'
  );
exception when others then null;
end;
$$;

-- As tabelas novas entram na auditoria (regra 7 do CLAUDE.md) — menos o
-- histórico de preço, que JÁ É um histórico (como as revisões das
-- considerações): auditá-lo seria guardar duas vezes a mesma coisa.
insert into public.audit_excluded_tables (schema_name, table_name, motivo)
values ('public', 'procedure_price_history', 'É o próprio histórico de preço: só recebe linhas novas e não muda (gatilho).')
on conflict (schema_name, table_name) do nothing;
select public.audit_attach_all();

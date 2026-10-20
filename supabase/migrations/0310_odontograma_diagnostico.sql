-- =============================================================================
-- 0310 — ODONTOGRAMA OD2: O DIAGNÓSTICO POR DENTE
--
-- Plano e decisões do dono em docs/odontograma/OD2-PLANO.md (20/10/2026):
--   * O Coordenador SUGERE (marca tracejada) o que encontrou em cada dente,
--     na rodada da avaliação/reavaliação. O Planner DEFINE: aceita, ajusta
--     (a sugestão original fica guardada e ligada) ou rejeita; e pode marcar
--     direto (já nasce definido). Admin Master que NÃO é o titular vê, mas não
--     sugere nem define (D6) — o titular (is_owner) faz tudo.
--   * FINALIZAR o diagnóstico é do Planner e só com ZERO sugestões pendentes
--     naquela rodada. E1: finalizar TRANCA A RODADA INTEIRA — marcas,
--     considerações e mídias. Correção depois: ADENDO, com motivo.
--   * E3: quem sugeriu recebe UM aviso por rodada, quando o Planner finaliza.
--   * A situação atual é CÁLCULO sobre as marcas (nunca sobrescrita): marca
--     definida até a data, menos as retiradas definidas até a data.
--
-- As marcas SÓ SE ACRESCENTAM: ninguém apaga, e o conteúdo não muda — a única
-- mudança permitida é a DECISÃO de uma sugestão pendente, uma vez só.
--
-- Idempotente. Nada apaga dado.
-- =============================================================================

-- 1) O odontograma do paciente: a dentição que ele tem hoje ------------------
create table if not exists public.odontograms (
  client_id uuid primary key references public.clients (id) on delete cascade,
  dentition text not null check (dentition in ('permanent', 'deciduous', 'mixed')),
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- 2) A rodada ganha o ciclo do diagnóstico e os campos da assinatura futura ---
alter table public.clinical_evaluations
  add column if not exists diagnosis_finalized_at timestamptz,
  add column if not exists diagnosis_finalized_by uuid references public.profiles (id),
  add column if not exists content_hash text,
  add column if not exists signature_status text not null default 'not_required',
  add column if not exists signature_provider text,
  add column if not exists signature_reference text,
  add column if not exists signed_at timestamptz;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'clinical_evaluations_signature_status_check') then
    alter table public.clinical_evaluations
      add constraint clinical_evaluations_signature_status_check
      check (signature_status in ('not_required', 'pending', 'signed'));
  end if;
end $$;

-- 3) As marcas -----------------------------------------------------------------
create table if not exists public.tooth_findings (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  clinic_id uuid not null references public.clinics (id),
  -- de onde veio: a rodada (avaliação/reavaliação) ou, na OD5, a sessão
  evaluation_id uuid references public.clinical_evaluations (id) on delete cascade,
  treatment_session_id uuid references public.treatment_sessions (id) on delete cascade,
  tooth_code text not null references public.dental_teeth (code),
  face_codes text[] not null default '{}',
  condition_code text not null references public.dental_conditions (code),
  -- marcar uma situação, ou retirar uma marca que estava definida
  action text not null default 'mark' check (action in ('mark', 'remove')),
  removes_finding_id uuid references public.tooth_findings (id),
  origin text not null check (origin in ('suggestion', 'direct', 'adjustment')),
  is_addendum boolean not null default false,
  addendum_reason text,
  status text not null check (status in ('suggested', 'defined', 'rejected', 'adjusted', 'withdrawn')),
  adjusted_from uuid references public.tooth_findings (id),
  note text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default clock_timestamp(),
  decided_by uuid references public.profiles (id),
  decided_at timestamptz,
  decision_reason text,
  check (evaluation_id is not null or treatment_session_id is not null),
  check ((action = 'remove') = (removes_finding_id is not null)),
  -- pendente = sem decisão; e só sugestão fica pendente
  check ((status = 'suggested') = (decided_at is null)),
  check (status <> 'suggested' or origin = 'suggestion'),
  check ((origin = 'adjustment') = (adjusted_from is not null)),
  check (not is_addendum or length(btrim(coalesce(addendum_reason, ''))) >= 5)
);
create index if not exists tooth_findings_client_idx on public.tooth_findings (client_id, created_at);
create index if not exists tooth_findings_evaluation_idx on public.tooth_findings (evaluation_id);
create index if not exists tooth_findings_pending_idx on public.tooth_findings (client_id) where status = 'suggested';

-- 4) Réguas de quem pode ---------------------------------------------------------
-- As unidades do cliente: a de origem e as que têm compartilhamento ativo.
create or replace function public._client_clinic_ids(p_client uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select c.clinic_id from public.clients c where c.id = p_client
  union
  select s.clinic_id from public.client_shares s
   where s.client_id = p_client and s.ended_at is null;
$$;
revoke execute on function public._client_clinic_ids(uuid) from public, anon, authenticated;

-- Quem VÊ o odontograma: a mesma régua da ficha (0.334.0) —
-- canViewAnamnesis || canPresent. Nunca o Assistente, a Recepção, o SDR (D8).
create or replace function public.can_view_odontogram(p_client uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and (
    public.is_admin_master()
    or public.is_planner()
    or exists (
      select 1 from public._client_clinic_ids(p_client) cc (id)
      where public.has_role_in_clinic(cc.id,
              array['clinical_coordinator', 'dentist', 'unit_manager', 'commercial_consultant']::public.user_role[])
         or (cc.id in (select public.user_full_access_clinic_ids())
             and exists (
               select 1 from public.user_clinic_roles r
               join public.clinics fc on fc.id = r.clinic_id
               where r.user_id = (select auth.uid())
                 and fc.type = 'franchisor'
                 and r.role in ('commercial_consultant', 'clinical_coordinator', 'unit_manager')))
    )
  );
$$;
revoke execute on function public.can_view_odontogram(uuid) from public, anon, authenticated;
grant execute on function public.can_view_odontogram(uuid) to authenticated;

-- Quem SUGERE: o Coordenador de uma unidade do cliente (ou o titular).
create or replace function public._can_suggest_findings(p_client uuid, p_clinic uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
     and p_clinic in (select public._client_clinic_ids(p_client))
     and (public.is_owner()
          or public.has_role_in_clinic(p_clinic, array['clinical_coordinator']::public.user_role[]));
$$;
revoke execute on function public._can_suggest_findings(uuid, uuid) from public, anon, authenticated;

-- Quem DEFINE e FINALIZA: o Planner (ou o titular).
create or replace function public._can_define_findings()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and (public.is_owner() or public.is_planner());
$$;
revoke execute on function public._can_define_findings() from public, anon, authenticated;

-- 5) Leitura (RLS). Escrever, só pelas funções abaixo. -------------------------
alter table public.odontograms enable row level security;
alter table public.tooth_findings enable row level security;
drop policy if exists odontograms_select on public.odontograms;
create policy odontograms_select on public.odontograms
  for select to authenticated using (public.can_view_odontogram(client_id));
drop policy if exists tooth_findings_select on public.tooth_findings;
create policy tooth_findings_select on public.tooth_findings
  for select to authenticated using (public.can_view_odontogram(client_id));

-- 6) A marca tem de CABER no dente (vale para todo caminho que grava) -----------
create or replace function public.tooth_findings_validate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cond record;
  v_alvo record;
  v_rodada record;
  f text;
begin
  select code, applies_to, usage, is_active into v_cond
    from public.dental_conditions where code = new.condition_code;
  if v_cond.code is null then raise exception 'UNKNOWN_CONDITION'; end if;

  if new.action = 'remove' then
    select * into v_alvo from public.tooth_findings where id = new.removes_finding_id;
    if v_alvo.id is null or v_alvo.client_id is distinct from new.client_id
       or v_alvo.action <> 'mark' or v_alvo.status <> 'defined'
       or v_alvo.tooth_code is distinct from new.tooth_code
       or v_alvo.condition_code is distinct from new.condition_code then
      raise exception 'REMOVE_TARGET_INVALID';
    end if;
    if exists (select 1 from public.tooth_findings r
                where r.removes_finding_id = new.removes_finding_id and r.status = 'defined') then
      raise exception 'ALREADY_REMOVED';
    end if;
    new.face_codes := v_alvo.face_codes;
  else
    if not v_cond.is_active then raise exception 'CONDITION_INACTIVE'; end if;
    if v_cond.usage not in ('finding', 'both') then raise exception 'CONDITION_NOT_A_FINDING'; end if;
    if v_cond.applies_to = 'face' then
      if coalesce(array_length(new.face_codes, 1), 0) = 0 then raise exception 'FINDING_FACES_REQUIRED'; end if;
      foreach f in array new.face_codes loop
        if not exists (select 1 from public.dental_tooth_faces tf
                        where tf.tooth_code = new.tooth_code and tf.face_code = f) then
          raise exception 'FACE_NOT_ON_TOOTH';
        end if;
      end loop;
      -- sem face repetida, em ordem fixa
      new.face_codes := array(select distinct x from unnest(new.face_codes) x order by 1);
    elsif coalesce(array_length(new.face_codes, 1), 0) > 0 then
      raise exception 'FACES_NOT_ALLOWED';
    end if;
  end if;

  if new.evaluation_id is not null then
    select client_id, clinic_id, diagnosis_finalized_at into v_rodada
      from public.clinical_evaluations where id = new.evaluation_id;
    if v_rodada.client_id is distinct from new.client_id or v_rodada.clinic_id is distinct from new.clinic_id then
      raise exception 'EVALUATION_MISMATCH';
    end if;
    -- rodada finalizada só recebe ADENDO (com motivo); aberta, nunca adendo
    if (v_rodada.diagnosis_finalized_at is not null) is distinct from new.is_addendum then
      raise exception 'ROUND_FINALIZED';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.tooth_findings_validate() from public, anon, authenticated;
drop trigger if exists tooth_findings_validate_trg on public.tooth_findings;
create trigger tooth_findings_validate_trg
  before insert on public.tooth_findings
  for each row execute function public.tooth_findings_validate();

-- 7) A marca não se apaga e não muda — só a decisão de uma pendente, uma vez ---
create or replace function public.tooth_findings_immutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    -- só em cascata (cadastro de teste apagado no treino); nunca direto
    if pg_trigger_depth() > 1 then return old; end if;
    raise exception 'FINDING_NOT_DELETABLE';
  end if;
  if old.status <> 'suggested' then raise exception 'FINDING_LOCKED'; end if;
  if new.status not in ('defined', 'rejected', 'adjusted', 'withdrawn')
     or new.decided_by is null or new.decided_at is null then
    raise exception 'FINDING_LOCKED';
  end if;
  if (new.id, new.client_id, new.clinic_id, new.evaluation_id, new.treatment_session_id,
      new.tooth_code, new.face_codes, new.condition_code, new.action, new.removes_finding_id,
      new.origin, new.is_addendum, new.addendum_reason, new.adjusted_from, new.note,
      new.created_by, new.created_at)
     is distinct from
     (old.id, old.client_id, old.clinic_id, old.evaluation_id, old.treatment_session_id,
      old.tooth_code, old.face_codes, old.condition_code, old.action, old.removes_finding_id,
      old.origin, old.is_addendum, old.addendum_reason, old.adjusted_from, old.note,
      old.created_by, old.created_at) then
    raise exception 'FINDING_LOCKED';
  end if;
  return new;
end;
$$;
revoke execute on function public.tooth_findings_immutable() from public, anon, authenticated;
drop trigger if exists tooth_findings_immutable_trg on public.tooth_findings;
create trigger tooth_findings_immutable_trg
  before update or delete on public.tooth_findings
  for each row execute function public.tooth_findings_immutable();

-- 8) E1: rodada finalizada fica trancada — ela, as considerações e as mídias ----
create or replace function public.clinical_evaluations_lock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pela_funcao boolean := coalesce(current_setting('risarte.odontogram_finalize', true), '') = 'on';
begin
  if tg_op = 'DELETE' then
    if old.diagnosis_finalized_at is null or pg_trigger_depth() > 1 then return old; end if;
    raise exception 'ROUND_FINALIZED';
  end if;
  if tg_op = 'UPDATE' and old.diagnosis_finalized_at is not null then
    -- depois de finalizada, só a assinatura (que ainda não existe) pode mudar
    if (new.client_id, new.clinic_id, new.kind, new.seq, new.status, new.title, new.summary,
        new.opened_by, new.opened_at, new.closed_by, new.closed_at,
        new.diagnosis_finalized_at, new.diagnosis_finalized_by, new.content_hash)
       is distinct from
       (old.client_id, old.clinic_id, old.kind, old.seq, old.status, old.title, old.summary,
        old.opened_by, old.opened_at, old.closed_by, old.closed_at,
        old.diagnosis_finalized_at, old.diagnosis_finalized_by, old.content_hash) then
      raise exception 'ROUND_FINALIZED';
    end if;
    return new;
  end if;
  -- finalizar é só pela função (nunca por gravação direta na tabela)
  if not v_pela_funcao then
    if tg_op = 'INSERT' then
      if new.diagnosis_finalized_at is not null or new.diagnosis_finalized_by is not null
         or new.content_hash is not null then
        raise exception 'NOT_ALLOWED';
      end if;
    elsif (new.diagnosis_finalized_at, new.diagnosis_finalized_by, new.content_hash)
          is distinct from (old.diagnosis_finalized_at, old.diagnosis_finalized_by, old.content_hash) then
      raise exception 'NOT_ALLOWED';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.clinical_evaluations_lock() from public, anon, authenticated;
drop trigger if exists clinical_evaluations_lock_trg on public.clinical_evaluations;
create trigger clinical_evaluations_lock_trg
  before insert or update or delete on public.clinical_evaluations
  for each row execute function public.clinical_evaluations_lock();

create or replace function public.clinical_round_records_lock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if pg_trigger_depth() > 1 then
    -- a cascada de um cadastro apagado (ou a ligação com a rodada virando nula)
    if tg_op = 'DELETE' then return old; end if;
    if tg_op = 'UPDATE' and new.evaluation_id is null then return new; end if;
  end if;
  if tg_op in ('UPDATE', 'DELETE') and old.evaluation_id is not null and exists (
       select 1 from public.clinical_evaluations e
        where e.id = old.evaluation_id and e.diagnosis_finalized_at is not null) then
    raise exception 'ROUND_FINALIZED';
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.evaluation_id is not null and exists (
       select 1 from public.clinical_evaluations e
        where e.id = new.evaluation_id and e.diagnosis_finalized_at is not null) then
    raise exception 'ROUND_FINALIZED';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke execute on function public.clinical_round_records_lock() from public, anon, authenticated;
drop trigger if exists clinical_notes_round_lock_trg on public.clinical_notes;
create trigger clinical_notes_round_lock_trg
  before insert or update or delete on public.clinical_notes
  for each row execute function public.clinical_round_records_lock();
drop trigger if exists clinical_media_round_lock_trg on public.clinical_media;
create trigger clinical_media_round_lock_trg
  before insert or update or delete on public.clinical_media
  for each row execute function public.clinical_round_records_lock();

-- 9) A rodada aberta: depois de um diagnóstico finalizado, o que se registra a
-- seguir vai para uma rodada NOVA (a finalizada não recebe mais nada). Mesma
-- assinatura e mesmo retorno da 0135; muda só o tipo e o título da rodada nova.
create or replace function public.ensure_open_evaluation(
  p_client uuid,
  p_clinic uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_user uuid := (select auth.uid());
  v_ultima record;
begin
  if not (
    public.is_admin_master()
    or public.has_role_in_clinic(
         p_clinic, array['clinical_coordinator','dentist']::public.user_role[])
  ) then
    raise exception 'NOT_ALLOWED';
  end if;

  select id into v_id from public.clinical_evaluations
    where client_id = p_client and clinic_id = p_clinic and status = 'open'
    order by seq desc limit 1;
  if v_id is not null then return v_id; end if;

  select kind, seq, diagnosis_finalized_at into v_ultima from public.clinical_evaluations
    where client_id = p_client and clinic_id = p_clinic
    order by seq desc limit 1;

  insert into public.clinical_evaluations
    (client_id, clinic_id, kind, seq, status, title, opened_by)
  values (p_client, p_clinic,
    coalesce(v_ultima.kind, 'avaliacao'),
    coalesce(v_ultima.seq, 0) + 1,
    'open',
    case when v_ultima.diagnosis_finalized_at is not null then 'Registros após o diagnóstico' end,
    v_user)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.ensure_open_evaluation(uuid, uuid) from public, anon, authenticated;
grant execute on function public.ensure_open_evaluation(uuid, uuid) to authenticated;

-- 10) As portas ---------------------------------------------------------------

-- Grava as marcas de uma lista [{tooth, faces[], condition, action, removes, note}].
create or replace function public._insert_tooth_findings(
  p_client uuid,
  p_clinic uuid,
  p_evaluation uuid,
  p_items jsonb,
  p_origin text,
  p_status text,
  p_addendum_reason text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_item jsonb;
  v_qtd integer := 0;
  v_dente text;
  v_situacao text;
  v_remove boolean;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'EMPTY_ITEMS';
  end if;
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_remove := coalesce(v_item ->> 'action', 'mark') = 'remove';
    v_dente := v_item ->> 'tooth';
    v_situacao := v_item ->> 'condition';
    if v_remove then
      -- retirar: o dente e a situação são os da marca retirada
      select tooth_code, condition_code into v_dente, v_situacao
        from public.tooth_findings
       where id = nullif(v_item ->> 'removes', '')::uuid and client_id = p_client;
      if v_dente is null then raise exception 'REMOVE_TARGET_INVALID'; end if;
    end if;
    insert into public.tooth_findings
      (client_id, clinic_id, evaluation_id, tooth_code, face_codes, condition_code,
       action, removes_finding_id, origin, is_addendum, addendum_reason, status,
       note, created_by, decided_by, decided_at)
    values
      (p_client, p_clinic, p_evaluation,
       v_dente,
       case when v_remove then '{}'::text[]
            else coalesce(array(select jsonb_array_elements_text(coalesce(v_item -> 'faces', '[]'::jsonb))), '{}') end,
       v_situacao,
       case when v_remove then 'remove' else 'mark' end,
       case when v_remove then (v_item ->> 'removes')::uuid end,
       p_origin,
       p_addendum_reason is not null,
       nullif(btrim(p_addendum_reason), ''),
       p_status,
       nullif(btrim(coalesce(v_item ->> 'note', '')), ''),
       v_user,
       case when p_status = 'defined' then v_user end,
       case when p_status = 'defined' then clock_timestamp() end);
    v_qtd := v_qtd + 1;
  end loop;
  return v_qtd;
end;
$$;
revoke execute on function public._insert_tooth_findings(uuid, uuid, uuid, jsonb, text, text, text) from public, anon, authenticated;

-- O Coordenador sugere, na rodada ABERTA da unidade (cria a rodada se faltar).
create or replace function public.suggest_tooth_findings(p_client uuid, p_clinic uuid, p_items jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_eval uuid;
begin
  if not public._can_suggest_findings(p_client, p_clinic) then raise exception 'NOT_ALLOWED'; end if;
  v_eval := public.ensure_open_evaluation(p_client, p_clinic);
  return public._insert_tooth_findings(p_client, p_clinic, v_eval, p_items, 'suggestion', 'suggested', null);
end;
$$;
revoke execute on function public.suggest_tooth_findings(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.suggest_tooth_findings(uuid, uuid, jsonb) to authenticated;

-- Quem sugeriu desfaz a própria sugestão, enquanto ninguém decidiu.
create or replace function public.withdraw_tooth_finding(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_f record;
begin
  if v_user is null then raise exception 'NOT_ALLOWED'; end if;
  select id, created_by, status into v_f from public.tooth_findings where id = p_id;
  if v_f.id is null then raise exception 'FINDING_NOT_FOUND'; end if;
  if v_f.created_by is distinct from v_user then raise exception 'NOT_ALLOWED'; end if;
  if v_f.status <> 'suggested' then raise exception 'FINDING_ALREADY_DECIDED'; end if;
  update public.tooth_findings
     set status = 'withdrawn', decided_by = v_user, decided_at = clock_timestamp()
   where id = p_id;
end;
$$;
revoke execute on function public.withdraw_tooth_finding(uuid) from public, anon, authenticated;
grant execute on function public.withdraw_tooth_finding(uuid) to authenticated;

-- O Planner decide: [{id, decision: accept|reject|adjust, reason, faces, condition}].
create or replace function public.decide_tooth_findings(p_items jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_item jsonb;
  v_f record;
  v_decisao text;
  v_qtd integer := 0;
begin
  if not public._can_define_findings() then raise exception 'NOT_ALLOWED'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'EMPTY_ITEMS';
  end if;
  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_f from public.tooth_findings where id = nullif(v_item ->> 'id', '')::uuid for update;
    if v_f.id is null then raise exception 'FINDING_NOT_FOUND'; end if;
    if v_f.status <> 'suggested' then raise exception 'FINDING_ALREADY_DECIDED'; end if;
    v_decisao := v_item ->> 'decision';
    if v_decisao = 'accept' then
      update public.tooth_findings
         set status = 'defined', decided_by = v_user, decided_at = clock_timestamp(),
             decision_reason = nullif(btrim(coalesce(v_item ->> 'reason', '')), '')
       where id = v_f.id;
    elsif v_decisao = 'reject' then
      update public.tooth_findings
         set status = 'rejected', decided_by = v_user, decided_at = clock_timestamp(),
             decision_reason = nullif(btrim(coalesce(v_item ->> 'reason', '')), '')
       where id = v_f.id;
    elsif v_decisao = 'adjust' then
      -- retirar não se ajusta: aceita ou rejeita
      if v_f.action = 'remove' then raise exception 'ADJUST_NOT_ALLOWED'; end if;
      update public.tooth_findings
         set status = 'adjusted', decided_by = v_user, decided_at = clock_timestamp(),
             decision_reason = nullif(btrim(coalesce(v_item ->> 'reason', '')), '')
       where id = v_f.id;
      insert into public.tooth_findings
        (client_id, clinic_id, evaluation_id, treatment_session_id, tooth_code, face_codes,
         condition_code, action, origin, status, adjusted_from, note,
         created_by, decided_by, decided_at)
      values
        (v_f.client_id, v_f.clinic_id, v_f.evaluation_id, v_f.treatment_session_id, v_f.tooth_code,
         coalesce(array(select jsonb_array_elements_text(coalesce(v_item -> 'faces', '[]'::jsonb))), '{}'),
         coalesce(nullif(v_item ->> 'condition', ''), v_f.condition_code),
         'mark', 'adjustment', 'defined', v_f.id, v_f.note,
         v_user, v_user, clock_timestamp());
    else
      raise exception 'INVALID_DECISION';
    end if;
    v_qtd := v_qtd + 1;
  end loop;
  return v_qtd;
end;
$$;
revoke execute on function public.decide_tooth_findings(jsonb) from public, anon, authenticated;
grant execute on function public.decide_tooth_findings(jsonb) to authenticated;

-- O Planner marca direto (já definido), na rodada mais recente do cliente.
-- Se ela já foi finalizada, é ADENDO: exige motivo.
create or replace function public.define_tooth_findings(
  p_client uuid,
  p_items jsonb,
  p_addendum_reason text default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rodada record;
begin
  if not public._can_define_findings() then raise exception 'NOT_ALLOWED'; end if;
  select id, clinic_id, diagnosis_finalized_at into v_rodada
    from public.clinical_evaluations
   where client_id = p_client
   order by opened_at desc, seq desc limit 1;
  if v_rodada.id is null then raise exception 'NO_EVALUATION'; end if;
  if v_rodada.diagnosis_finalized_at is not null then
    if length(btrim(coalesce(p_addendum_reason, ''))) < 5 then raise exception 'ADDENDUM_REASON_REQUIRED'; end if;
    return public._insert_tooth_findings(p_client, v_rodada.clinic_id, v_rodada.id, p_items,
                                         'direct', 'defined', p_addendum_reason);
  end if;
  return public._insert_tooth_findings(p_client, v_rodada.clinic_id, v_rodada.id, p_items,
                                       'direct', 'defined', null);
end;
$$;
revoke execute on function public.define_tooth_findings(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.define_tooth_findings(uuid, jsonb, text) to authenticated;

-- O Planner finaliza o diagnóstico da rodada: tranca tudo, guarda a impressão
-- digital do conteúdo e avisa quem sugeriu (um aviso por pessoa, com o resumo).
create or replace function public.finalize_tooth_diagnosis(p_evaluation uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_r record;
  v_texto text;
  v_hash text;
  v_nome text;
  v_s record;
begin
  if not public._can_define_findings() then raise exception 'NOT_ALLOWED'; end if;
  select * into v_r from public.clinical_evaluations where id = p_evaluation for update;
  if v_r.id is null then raise exception 'EVALUATION_NOT_FOUND'; end if;
  if v_r.diagnosis_finalized_at is not null then raise exception 'ROUND_FINALIZED'; end if;
  if exists (select 1 from public.tooth_findings
              where evaluation_id = p_evaluation and status = 'suggested') then
    raise exception 'PENDING_SUGGESTIONS';
  end if;

  -- O conteúdo canônico da rodada: marcas, considerações e mídias, em ordem fixa.
  select concat_ws(E'\n',
      'rodada:' || v_r.id::text || '|' || v_r.kind::text || '|' || v_r.seq,
      (select string_agg(concat_ws('|', 'marca', f.id, f.tooth_code, array_to_string(f.face_codes, ','),
                                   f.condition_code, f.action, f.removes_finding_id, f.status,
                                   f.adjusted_from, f.created_by, f.decided_by), E'\n' order by f.created_at, f.id)
         from public.tooth_findings f where f.evaluation_id = p_evaluation),
      (select string_agg(concat_ws('|', 'nota', n.id, n.body), E'\n' order by n.created_at, n.id)
         from public.clinical_notes n where n.evaluation_id = p_evaluation),
      (select string_agg(concat_ws('|', 'midia', m.id, m.storage_path, m.external_url, m.display_name, m.note),
                         E'\n' order by m.created_at, m.id)
         from public.clinical_media m where m.evaluation_id = p_evaluation))
    into v_texto;
  v_hash := encode(sha256(convert_to(v_texto, 'UTF8')), 'hex');

  perform set_config('risarte.odontogram_finalize', 'on', true);
  update public.clinical_evaluations
     set diagnosis_finalized_at = clock_timestamp(),
         diagnosis_finalized_by = v_user,
         content_hash = v_hash,
         status = 'closed',
         closed_by = coalesce(closed_by, v_user),
         closed_at = coalesce(closed_at, now())
   where id = p_evaluation;
  perform set_config('risarte.odontogram_finalize', 'off', true);

  select full_name into v_nome from public.clients where id = v_r.client_id;
  for v_s in
    select f.created_by as quem,
           count(*) filter (where f.status = 'defined') as aceitas,
           count(*) filter (where f.status = 'adjusted') as ajustadas,
           count(*) filter (where f.status = 'rejected') as rejeitadas
      from public.tooth_findings f
     where f.evaluation_id = p_evaluation and f.origin = 'suggestion'
       and f.status <> 'withdrawn' and f.created_by is not null
       and f.created_by is distinct from v_user
     group by f.created_by
  loop
    insert into public.notifications (user_id, clinic_id, title, body, link)
    values (v_s.quem, v_r.clinic_id,
            'Diagnóstico do odontograma finalizado',
            coalesce(v_nome, 'Cliente') || ' — das suas sugestões: '
              || v_s.aceitas || case when v_s.aceitas = 1 then ' aceita, ' else ' aceitas, ' end
              || v_s.ajustadas || case when v_s.ajustadas = 1 then ' ajustada e ' else ' ajustadas e ' end
              || v_s.rejeitadas || case when v_s.rejeitadas = 1 then ' rejeitada.' else ' rejeitadas.' end,
            '/prontuarios/' || v_r.client_id::text || '?aba=odontograma');
  end loop;

  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values (v_user, v_r.clinic_id, 'update', 'clinical_evaluation', v_r.id::text,
          jsonb_build_object('diagnostico_finalizado', true));
  return v_hash;
end;
$$;
revoke execute on function public.finalize_tooth_diagnosis(uuid) from public, anon, authenticated;
grant execute on function public.finalize_tooth_diagnosis(uuid) to authenticated;

-- A dentição do paciente: Coordenador de uma unidade dele, Planner ou titular.
create or replace function public.set_client_dentition(p_client uuid, p_dentition text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null or not (
       public._can_define_findings()
       or exists (select 1 from public._client_clinic_ids(p_client) cc (id)
                   where public.has_role_in_clinic(cc.id, array['clinical_coordinator']::public.user_role[]))
     ) then
    raise exception 'NOT_ALLOWED';
  end if;
  if p_dentition not in ('permanent', 'deciduous', 'mixed') then raise exception 'INVALID_DENTITION'; end if;
  insert into public.odontograms (client_id, dentition, updated_by, updated_at)
  values (p_client, p_dentition, v_user, now())
  on conflict (client_id) do update
    set dentition = excluded.dentition, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
end;
$$;
revoke execute on function public.set_client_dentition(uuid, text) from public, anon, authenticated;
grant execute on function public.set_client_dentition(uuid, text) to authenticated;

-- 11) Auditoria: as duas tabelas novas entram (as decisões são alterações) ----
select public.audit_attach_all();

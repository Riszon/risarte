-- =============================================================================
-- 0369 — A avaliação como dado (Rita, Fase 0A.5, parte core)
-- =============================================================================
-- Plano: docs/sdr/PLANO-FASE-0A.md, entrega 0A.5 (decisões 5, 7, 29, 38–42).
--
-- O QUE MUDA
--   * `procedures` ganha três campos da assistente virtual, que SÓ o Admin
--     Master muda (decisão 39): `rita_role` (`evaluation_new` = avaliação de
--     quem é novo; `evaluation_returning` = consulta de quem já é cliente;
--     `urgency` = a Rita reconhece e passa para a equipe), `rita_can_offer` (o
--     ROL: o que a Rita pode oferecer) e `patient_name` (nome para o paciente).
--   * Decisão 38: NENHUM procedimento novo. Os quatro que já existem nos dois
--     bancos são MARCADOS pelo nome exato — se um nome não casar com
--     exatamente um procedimento, a migração FALHA (não marca errado):
--       "Consulta odontológica inicial"           → evaluation_new  (no rol)
--       "Consulta odontológica"                   → evaluation_returning (no rol)
--       "Consulta odontológica de Urgência"       → urgency (reconhece; fora do rol)
--       "Consulta odontológica de Urgência 24 hs" → urgency (reconhece; fora do rol)
--   * `clinic_procedure_availability` (decisão 40): o Gerente marca o que a
--     unidade NÃO faz; sem linha = oferece.
--   * `clinic_agenda_settings.evaluation_minutes` (decisão 7): duração da
--     avaliação, em cascata (vazio na unidade = o da rede; a rede nasce com 60).
--   * `patient_texts` (decisões 29 e 42): textos que podem ser ditos ao
--     paciente, em cascata rede → unidade. O Gerente pode PROPOR o da unidade
--     (fica rascunho); só o Admin Master APROVA. A rede nasce com as quatro
--     políticas padrão da decisão 42, aprovadas. "O que a avaliação inclui" e
--     "o que trazer" nascem vazios (o dono escreve).
--
-- Nenhum preço muda. A agenda da equipe não lê nada disto.
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Os campos da assistente no procedimento
-- -----------------------------------------------------------------------------
alter table public.procedures
  add column if not exists rita_role text,
  add column if not exists rita_can_offer boolean not null default false,
  add column if not exists patient_name text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'procedures_rita_role_check') then
    alter table public.procedures add constraint procedures_rita_role_check
      check (rita_role is null or rita_role in ('evaluation_new', 'evaluation_returning', 'urgency'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'procedures_patient_name_check') then
    alter table public.procedures add constraint procedures_patient_name_check
      check (patient_name is null or length(btrim(patient_name)) between 2 and 120);
  end if;
end $$;

-- Uma avaliação de novo e uma consulta de retorno só (urgência pode ter várias).
create unique index if not exists procedures_one_rita_evaluation
  on public.procedures (rita_role)
  where rita_role in ('evaluation_new', 'evaluation_returning');

-- Só o Admin Master muda os campos da assistente (a chave de serviço e o
-- próprio banco também: migrações, importação).
create or replace function public.procedures_rita_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_role text := coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '');
begin
  if v_role not in ('authenticated', 'anon') or public.is_admin_master() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.rita_role is not null or new.rita_can_offer or new.patient_name is not null then
      raise exception 'RITA_FIELDS_ADMIN_ONLY';
    end if;
  elsif new.rita_role is distinct from old.rita_role
     or new.rita_can_offer is distinct from old.rita_can_offer
     or new.patient_name is distinct from old.patient_name then
    raise exception 'RITA_FIELDS_ADMIN_ONLY';
  end if;
  return new;
end;
$$;

revoke execute on function public.procedures_rita_guard() from public, anon, authenticated;

drop trigger if exists procedures_rita_guard on public.procedures;
create trigger procedures_rita_guard
  before insert or update of rita_role, rita_can_offer, patient_name on public.procedures
  for each row execute function public.procedures_rita_guard();

-- Decisão 38: marca os quatro que já existem. Falha alto se o nome não casar.
do $$
declare
  m record;
  v_n integer;
begin
  for m in
    select * from (values
      ('Consulta odontológica inicial', 'evaluation_new', true),
      ('Consulta odontológica', 'evaluation_returning', true),
      ('Consulta odontológica de Urgência', 'urgency', false),
      ('Consulta odontológica de Urgência 24 hs', 'urgency', false)
    ) as v(nome, papel, no_rol)
  loop
    select count(*) into v_n from public.procedures p where btrim(p.name) = m.nome;
    if v_n <> 1 then
      raise exception 'RITA_MARCA: esperava 1 procedimento chamado "%", achou %', m.nome, v_n;
    end if;
    update public.procedures p set
      rita_role = m.papel,
      -- O rol só é preenchido na primeira vez (depois, quem decide é o Admin).
      rita_can_offer = case when p.rita_role is null then m.no_rol else p.rita_can_offer end
    where btrim(p.name) = m.nome
      and p.rita_role is distinct from m.papel;
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 2) Oferta por unidade (o que a unidade NÃO faz)
-- -----------------------------------------------------------------------------
create table if not exists public.clinic_procedure_availability (
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  procedure_id uuid not null references public.procedures (id) on delete cascade,
  offered boolean not null default false,
  note text check (note is null or length(note) <= 300),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null,
  primary key (clinic_id, procedure_id)
);

alter table public.clinic_procedure_availability enable row level security;
drop policy if exists clinic_procedure_availability_select on public.clinic_procedure_availability;
create policy clinic_procedure_availability_select on public.clinic_procedure_availability
  for select to authenticated using (true);
drop policy if exists clinic_procedure_availability_write on public.clinic_procedure_availability;
create policy clinic_procedure_availability_write on public.clinic_procedure_availability
  for all to authenticated
  using (public.is_admin_master() or public.has_role_in_clinic(clinic_id, array['unit_manager']::public.user_role[]))
  with check (public.is_admin_master() or public.has_role_in_clinic(clinic_id, array['unit_manager']::public.user_role[]));
grant select, insert, update, delete on public.clinic_procedure_availability to authenticated;

-- -----------------------------------------------------------------------------
-- 3) Duração da avaliação (cascata)
-- -----------------------------------------------------------------------------
alter table public.clinic_agenda_settings
  add column if not exists evaluation_minutes integer;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'clinic_agenda_settings_evaluation_minutes_check') then
    alter table public.clinic_agenda_settings add constraint clinic_agenda_settings_evaluation_minutes_check
      check (evaluation_minutes is null or evaluation_minutes between 15 and 240);
  end if;
end $$;
update public.clinic_agenda_settings set evaluation_minutes = 60
where clinic_id is null and evaluation_minutes is null;

-- -----------------------------------------------------------------------------
-- 4) Textos para o paciente (cascata rede → unidade; o Admin aprova)
-- -----------------------------------------------------------------------------
create table if not exists public.patient_texts (
  id uuid primary key default gen_random_uuid(),
  text_key text not null check (text_key in (
    'evaluation_includes', 'evaluation_bring', 'late_tolerance',
    'reschedule_policy', 'no_show_policy', 'minors_policy')),
  -- Nulo = o texto da rede.
  clinic_id uuid references public.clinics (id) on delete cascade,
  content text not null check (length(btrim(content)) between 3 and 1500),
  status text not null default 'draft' check (status in ('draft', 'approved')),
  version integer not null default 1,
  approved_by uuid references public.profiles (id) on delete set null,
  approved_at timestamptz,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint patient_texts_unique unique nulls not distinct (text_key, clinic_id),
  constraint patient_texts_approved check (status = 'draft' or approved_at is not null)
);

-- Quem não é Admin só PROPÕE: mudar o texto volta para rascunho, e só o Admin
-- aprova. Mudar o texto conta uma versão nova.
create or replace function public.patient_texts_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_role text := coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '');
  v_pessoa boolean := v_role in ('authenticated', 'anon');
begin
  if tg_op = 'UPDATE' and new.content is distinct from old.content then
    new.version := old.version + 1;
    -- Texto novo não herda a aprovação do anterior.
    if not (v_pessoa and public.is_admin_master() and new.status = 'approved'
            and new.approved_at is distinct from old.approved_at) then
      new.status := 'draft';
      new.approved_by := null;
      new.approved_at := null;
    end if;
  end if;
  if v_pessoa and not public.is_admin_master() then
    if new.status = 'approved' and (tg_op = 'INSERT' or old.status <> 'approved') then
      raise exception 'PATIENT_TEXT_ADMIN_APPROVES';
    end if;
    if tg_op = 'INSERT' then
      new.status := 'draft';
      new.approved_by := null;
      new.approved_at := null;
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

revoke execute on function public.patient_texts_guard() from public, anon, authenticated;

drop trigger if exists patient_texts_guard on public.patient_texts;
create trigger patient_texts_guard
  before insert or update on public.patient_texts
  for each row execute function public.patient_texts_guard();

alter table public.patient_texts enable row level security;
drop policy if exists patient_texts_select on public.patient_texts;
create policy patient_texts_select on public.patient_texts
  for select to authenticated using (true);
-- A rede: só o Admin. A unidade: Admin ou o Gerente dela (que só propõe).
drop policy if exists patient_texts_write on public.patient_texts;
create policy patient_texts_write on public.patient_texts
  for all to authenticated
  using (public.is_admin_master()
         or (clinic_id is not null and public.has_role_in_clinic(clinic_id, array['unit_manager']::public.user_role[])))
  with check (public.is_admin_master()
         or (clinic_id is not null and public.has_role_in_clinic(clinic_id, array['unit_manager']::public.user_role[])));
grant select, insert, update, delete on public.patient_texts to authenticated;

-- Decisão 42: as políticas padrão da rede, aprovadas (editáveis depois).
insert into public.patient_texts (text_key, clinic_id, content, status, approved_at)
values
  ('late_tolerance', null,
   'Temos uma tolerância de 15 minutos de atraso. Depois disso, pode ser preciso remarcar o seu horário.',
   'approved', now()),
  ('reschedule_policy', null,
   'Você pode remarcar ou cancelar o seu horário a qualquer momento, sem custo.',
   'approved', now()),
  ('no_show_policy', null,
   'Se não puder vir, é só avisar. Se faltar, nós oferecemos um novo horário — a falta não impede de agendar de novo.',
   'approved', now()),
  ('minors_policy', null,
   'Menores de idade são atendidos somente acompanhados do responsável legal.',
   'approved', now())
on conflict on constraint patient_texts_unique do nothing;

select public.audit_attach_all();

notify pgrst, 'reload schema';

-- -----------------------------------------------------------------------------
-- Conferência (rodar depois; esperado: 1 · 1 · 2 · 2 · 4 · 60)
-- -----------------------------------------------------------------------------
-- select
--   (select count(*) from public.procedures where rita_role = 'evaluation_new' and rita_can_offer) as avaliacao_novo,
--   (select count(*) from public.procedures where rita_role = 'evaluation_returning' and rita_can_offer) as consulta_cliente,
--   (select count(*) from public.procedures where rita_role = 'urgency' and not rita_can_offer) as urgencias,
--   (select count(*) from information_schema.tables where table_schema = 'public'
--     and table_name in ('clinic_procedure_availability', 'patient_texts')) as tabelas,
--   (select count(*) from public.patient_texts where clinic_id is null and status = 'approved') as politicas,
--   (select evaluation_minutes from public.clinic_agenda_settings where clinic_id is null) as minutos_da_rede;

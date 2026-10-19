-- =============================================================================
-- 0308 — ODONTOGRAMA, OD1: A REFERÊNCIA (TUSS) E AS REGRAS CLÍNICAS DO CATÁLOGO
--
-- Decisões do dono (OD0, 19/10/2026) e as três planilhas que ele revisou:
--   * Dentes (TUSS 28), faces (TUSS 32) e regiões (TUSS 42) com o CÓDIGO e o
--     NOME oficiais — nunca inventados, nunca alterados.
--   * Faces de cada dente e dentes de cada região: os arquivos TUSS não dizem;
--     foram derivados pela regra odontológica e aprovados pelo dono.
--   * Situações do dente: as 5 da TUSS 44 + as da Risarte (código RZ-…,
--     marcadas "não TUSS"), aprovadas pelo dono.
--   * Regras clínicas dos 370 procedimentos TUSS: nível (face, dente, região,
--     arcada, sem marcação), faces, dentição, dentes compatíveis, situações
--     que impedem/exigem e o efeito depois de realizado.
--
-- E o pedido do dono: o ADMIN ajusta tudo isto na tela (Administração →
-- Odontograma). O que é oficial da TUSS (código e nome) fica travado no
-- banco; NADA se apaga — situação se desativa, regra vira "sem marcação".
--
-- Referência é DA REDE (sem clinic_id): lê quem está logado, grava o Admin.
-- Idempotente. Nada apaga dado.
-- =============================================================================

-- 1) Dentes, faces, regiões ---------------------------------------------------
create table if not exists public.dental_faces (
  code text primary key check (code ~ '^[A-Z]$'),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.dental_teeth (
  code text primary key check (code ~ '^[1-8][1-9]$'),
  name text not null,
  dentition text not null check (dentition in ('permanent', 'deciduous')),
  arch text not null check (arch in ('upper', 'lower')),
  quadrant smallint not null check (quadrant between 1 and 8),
  position smallint not null check (position between 1 and 9),
  tooth_group text not null
    check (tooth_group in ('incisor', 'canine', 'premolar', 'molar', 'deciduous_molar', 'supernumerary')),
  created_at timestamptz not null default now()
);

create table if not exists public.dental_tooth_faces (
  tooth_code text not null references public.dental_teeth (code),
  face_code text not null references public.dental_faces (code),
  created_at timestamptz not null default now(),
  primary key (tooth_code, face_code)
);

create table if not exists public.dental_regions (
  code text primary key check (code ~ '^[A-Z0-9]{1,6}$'),
  name text not null,
  created_at timestamptz not null default now()
);

-- Região SEM linha aqui = tecido/osso (língua, palato…): recebe achado, não
-- seleciona dente.
create table if not exists public.dental_region_teeth (
  region_code text not null references public.dental_regions (code),
  tooth_code text not null references public.dental_teeth (code),
  created_at timestamptz not null default now(),
  primary key (region_code, tooth_code)
);

-- 2) Situações do dente -------------------------------------------------------
create table if not exists public.dental_conditions (
  code text primary key check (code ~ '^[A-Z]$' or code ~ '^RZ-[A-Z0-9]{2,20}$'),
  name text not null check (length(btrim(name)) >= 2),
  source text not null check (source in ('tuss', 'risarte')),
  applies_to text not null
    check (applies_to in ('face', 'crown', 'root', 'whole_tooth', 'between_teeth')),
  usage text not null check (usage in ('finding', 'effect', 'both')),
  symbol text not null check (length(btrim(symbol)) between 1 and 3),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  updated_by uuid references public.profiles (id),
  updated_at timestamptz,
  created_at timestamptz not null default now(),
  -- código da TUSS é uma letra; da Risarte começa com RZ-
  check ((source = 'tuss') = (code ~ '^[A-Z]$'))
);

-- 3) Regras clínicas de cada procedimento (tabela-irmã de `procedures`) ------
create table if not exists public.procedure_dental_rules (
  procedure_id uuid primary key references public.procedures (id),
  application_level text not null
    check (application_level in ('face', 'tooth', 'region', 'arch', 'none')),
  face_count_min smallint,
  face_count_max smallint,
  fixed_faces text[] not null default '{}',
  dentition text not null default 'both' check (dentition in ('permanent', 'deciduous', 'both')),
  -- vazio = todos os grupos de dente
  tooth_groups text[] not null default '{}',
  blocked_conditions text[] not null default '{}',
  -- vazio = não exige; com códigos = exige QUALQUER UM deles
  required_conditions text[] not null default '{}',
  effect_condition text references public.dental_conditions (code),
  -- prótese fixa: pilar se o dente existe, pôntico se está ausente
  effect_when_absent text references public.dental_conditions (code),
  confidence text check (confidence in ('high', 'medium', 'low')),
  updated_by uuid references public.profiles (id),
  updated_at timestamptz,
  created_at timestamptz not null default now(),
  -- ⚠️ coalesce(…, false): num CHECK, "desconhecido" (conta com valor vazio)
  -- PASSA. Sem ele, regra de face sem nº de faces entrava (achado no ensaio).
  check (
    case when application_level = 'face'
      then coalesce(face_count_min between 1 and 5
                    and face_count_max between face_count_min and 5
                    and coalesce(array_length(fixed_faces, 1), 0) <= face_count_max, false)
      else face_count_min is null and face_count_max is null and fixed_faces = '{}'
    end
  )
);

-- 4) Travas -------------------------------------------------------------------
-- Situação: o código não muda nunca (é o que as regras e os achados guardam);
-- na da TUSS, também o nome e a origem. Nunca se apaga.
create or replace function public.dental_conditions_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'CONDITION_NOT_DELETABLE';
  end if;
  if new.code is distinct from old.code or new.source is distinct from old.source then
    raise exception 'CONDITION_CODE_LOCKED';
  end if;
  if old.source = 'tuss' and new.name is distinct from old.name then
    raise exception 'TUSS_LOCKED';
  end if;
  new.updated_at := now();
  new.updated_by := (select auth.uid());
  return new;
end;
$$;
revoke execute on function public.dental_conditions_guard() from public, anon, authenticated;

drop trigger if exists dental_conditions_guard_trg on public.dental_conditions;
create trigger dental_conditions_guard_trg
  before update or delete on public.dental_conditions
  for each row execute function public.dental_conditions_guard();

-- Regra: cada código das listas tem de existir (array não tem chave
-- estrangeira — sem isto, um erro de digitação viraria regra que nunca vale).
create or replace function public.procedure_dental_rules_check()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if exists (select 1 from unnest(new.fixed_faces) f
              where not exists (select 1 from public.dental_faces d where d.code = f)) then
    raise exception 'UNKNOWN_FACE';
  end if;
  if exists (select 1 from unnest(new.tooth_groups) g
              where g not in ('incisor', 'canine', 'premolar', 'molar', 'deciduous_molar', 'supernumerary')) then
    raise exception 'UNKNOWN_TOOTH_GROUP';
  end if;
  if exists (select 1 from unnest(new.blocked_conditions || new.required_conditions) c
              where not exists (select 1 from public.dental_conditions d where d.code = c)) then
    raise exception 'UNKNOWN_CONDITION';
  end if;
  if new.required_conditions && new.blocked_conditions then
    raise exception 'CONDITION_BOTH_REQUIRED_AND_BLOCKED';
  end if;
  new.updated_at := now();
  new.updated_by := (select auth.uid());
  return new;
end;
$$;
revoke execute on function public.procedure_dental_rules_check() from public, anon, authenticated;

drop trigger if exists procedure_dental_rules_check_trg on public.procedure_dental_rules;
create trigger procedure_dental_rules_check_trg
  before insert or update on public.procedure_dental_rules
  for each row execute function public.procedure_dental_rules_check();

-- 5) Acesso -------------------------------------------------------------------
alter table public.dental_faces enable row level security;
alter table public.dental_teeth enable row level security;
alter table public.dental_tooth_faces enable row level security;
alter table public.dental_regions enable row level security;
alter table public.dental_region_teeth enable row level security;
alter table public.dental_conditions enable row level security;
alter table public.procedure_dental_rules enable row level security;

do $$
declare t text;
begin
  foreach t in array array['dental_faces', 'dental_teeth', 'dental_tooth_faces', 'dental_regions',
                           'dental_region_teeth', 'dental_conditions', 'procedure_dental_rules'] loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('create policy %I on public.%I for select to authenticated using (true)', t || '_select', t);
  end loop;
end $$;

-- Situação: o Admin cria (só da Risarte) e altera; ninguém apaga.
drop policy if exists dental_conditions_insert on public.dental_conditions;
create policy dental_conditions_insert on public.dental_conditions
  for insert to authenticated
  with check (public.is_admin_master() and source = 'risarte');
drop policy if exists dental_conditions_update on public.dental_conditions;
create policy dental_conditions_update on public.dental_conditions
  for update to authenticated
  using (public.is_admin_master())
  with check (public.is_admin_master());

-- Regra do procedimento: o Admin cria e altera; ninguém apaga.
drop policy if exists procedure_dental_rules_insert on public.procedure_dental_rules;
create policy procedure_dental_rules_insert on public.procedure_dental_rules
  for insert to authenticated
  with check (public.is_admin_master());
drop policy if exists procedure_dental_rules_update on public.procedure_dental_rules;
create policy procedure_dental_rules_update on public.procedure_dental_rules
  for update to authenticated
  using (public.is_admin_master())
  with check (public.is_admin_master());

-- Dentes, faces e regiões (oficiais): ninguém grava pela tela. As LIGAÇÕES
-- (faces de um dente, dentes de uma região) mudam só pelas funções abaixo.

-- 6) As duas trocas do Admin --------------------------------------------------
create or replace function public.set_tooth_faces(p_tooth text, p_faces text[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_qtd integer;
begin
  if (select auth.uid()) is null or not public.is_admin_master() then raise exception 'NOT_ALLOWED'; end if;
  if not exists (select 1 from public.dental_teeth where code = p_tooth) then raise exception 'TOOTH_NOT_FOUND'; end if;
  if coalesce(array_length(p_faces, 1), 0) = 0 then raise exception 'FACES_REQUIRED'; end if;
  if exists (select 1 from unnest(p_faces) f
              where not exists (select 1 from public.dental_faces d where d.code = f)) then
    raise exception 'UNKNOWN_FACE';
  end if;

  delete from public.dental_tooth_faces
   where tooth_code = p_tooth and face_code <> all (p_faces);
  insert into public.dental_tooth_faces (tooth_code, face_code)
  select p_tooth, f from unnest(p_faces) f
  on conflict do nothing;

  select count(*)::integer into v_qtd from public.dental_tooth_faces where tooth_code = p_tooth;
  return v_qtd;
end;
$$;
revoke execute on function public.set_tooth_faces(text, text[]) from public, anon, authenticated;
grant execute on function public.set_tooth_faces(text, text[]) to authenticated;

-- Lista vazia = a região vira "tecido/osso" (não seleciona dente).
create or replace function public.set_region_teeth(p_region text, p_teeth text[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_qtd integer;
begin
  if (select auth.uid()) is null or not public.is_admin_master() then raise exception 'NOT_ALLOWED'; end if;
  if not exists (select 1 from public.dental_regions where code = p_region) then raise exception 'REGION_NOT_FOUND'; end if;
  if exists (select 1 from unnest(coalesce(p_teeth, '{}')) t
              where not exists (select 1 from public.dental_teeth d where d.code = t)) then
    raise exception 'TOOTH_NOT_FOUND';
  end if;

  delete from public.dental_region_teeth
   where region_code = p_region and tooth_code <> all (coalesce(p_teeth, '{}'));
  insert into public.dental_region_teeth (region_code, tooth_code)
  select p_region, t from unnest(coalesce(p_teeth, '{}')) t
  on conflict do nothing;

  select count(*)::integer into v_qtd from public.dental_region_teeth where region_code = p_region;
  return v_qtd;
end;
$$;
revoke execute on function public.set_region_teeth(text, text[]) from public, anon, authenticated;
grant execute on function public.set_region_teeth(text, text[]) to authenticated;

-- =============================================================================
-- 0079 — Vínculo Risartano ↔ usuário de acesso — H4.1 Lote 2b
-- -----------------------------------------------------------------------------
-- As telas "Risartanos" (RH, staff_members) e "Usuários (acesso)" (login,
-- profiles + user_clinic_roles) guardavam a mesma pessoa sem se falar. Este
-- vínculo liga o colaborador ao seu login:
--   * staff_members.user_id — o usuário de acesso ligado, ou NULL (nem todo
--     colaborador tem login). Um mesmo login pode ligar a mais de um registro
--     de RH (colaborador em duas unidades).
--   * O vínculo se forma SOZINHO pelo e-mail (gatilhos, como o CPF no 0078) e
--     pode ser feito/desfeito manualmente pelo Admin (e-mails diferentes).
--   * O NOME sincroniza nos dois sentidos quando vinculados.
-- Idempotente.
-- =============================================================================

-- 1) Coluna de vínculo -----------------------------------------------------------
alter table public.staff_members
  add column if not exists user_id uuid
    references public.profiles (id) on delete set null;

create index if not exists staff_members_user_idx
  on public.staff_members (user_id);

-- Normaliza e-mail para comparação (minúsculas, sem espaços; NULL se vazio).
create or replace function public.email_key(p text)
returns text language sql immutable as $$
  select nullif(lower(btrim(coalesce(p, ''))), '');
$$;

-- 2) BEFORE em staff_members: liga pelo e-mail ------------------------------------
-- Só quando ainda não há vínculo e o e-mail é novo/alterado — nunca desfaz um
-- vínculo manual nem religa sozinho após um "Desvincular".
create or replace function public.staff_link_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.user_id is null
     and public.email_key(new.email) is not null
     and (tg_op = 'INSERT'
          or public.email_key(new.email) is distinct from public.email_key(old.email)) then
    select p.id into new.user_id
    from public.profiles p
    where public.email_key(p.email) = public.email_key(new.email)
    limit 1;
  end if;
  return new;
end $$;

drop trigger if exists staff_link_user_trg on public.staff_members;
create trigger staff_link_user_trg
  before insert or update of email on public.staff_members
  for each row execute function public.staff_link_user();

-- 3) AFTER em profiles: novo usuário criado liga Risartanos com o mesmo e-mail ----
create or replace function public.profile_link_staff()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.email_key(new.email) is not null then
    update public.staff_members
    set user_id = new.id
    where user_id is null
      and public.email_key(email) = public.email_key(new.email);
  end if;
  return new;
end $$;

drop trigger if exists profile_link_staff_trg on public.profiles;
create trigger profile_link_staff_trg
  after insert on public.profiles
  for each row execute function public.profile_link_staff();

-- 4) Sincronização do NOME nos dois sentidos --------------------------------------
-- O guard "is distinct from" garante que a cadeia para (sem loop).
create or replace function public.staff_sync_name_to_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.user_id is not null then
    update public.profiles
    set full_name = new.full_name
    where id = new.user_id
      and full_name is distinct from new.full_name;
  end if;
  return new;
end $$;

drop trigger if exists staff_sync_name_trg on public.staff_members;
create trigger staff_sync_name_trg
  after update of full_name on public.staff_members
  for each row execute function public.staff_sync_name_to_profile();

create or replace function public.profile_sync_name_to_staff()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.staff_members
  set full_name = new.full_name
  where user_id = new.id
    and full_name is distinct from new.full_name;
  return new;
end $$;

drop trigger if exists profile_sync_name_trg on public.profiles;
create trigger profile_sync_name_trg
  after update of full_name on public.profiles
  for each row execute function public.profile_sync_name_to_staff();

-- 5) Backfill: liga os que já existem pelo e-mail ---------------------------------
update public.staff_members s
set user_id = p.id
from public.profiles p
where s.user_id is null
  and public.email_key(s.email) is not null
  and public.email_key(p.email) = public.email_key(s.email);

grant execute on function public.email_key(text) to authenticated;

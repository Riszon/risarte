-- =============================================================================
-- Risarte Odontologia — Migration 0003
-- Owner feedback after stage 2 testing:
--   1. A user can hold only ONE role per clinic (different roles across
--      clinics remain allowed).
--   2. Detailed address fields (number, complement, neighborhood, CEP)
--      for clinics and clients.
-- =============================================================================

-- 1. One role per clinic: remove duplicates (keeps one), then tighten the
--    unique constraint from (user, clinic, role) to (user, clinic).
delete from public.user_clinic_roles a
using public.user_clinic_roles b
where a.user_id = b.user_id
  and a.clinic_id = b.clinic_id
  and a.id > b.id;

alter table public.user_clinic_roles
  drop constraint user_clinic_roles_user_id_clinic_id_role_key;

alter table public.user_clinic_roles
  add constraint user_clinic_roles_user_clinic_key unique (user_id, clinic_id);

-- 2. Detailed address fields.
alter table public.clinics
  add column address_number text,
  add column complement text,
  add column neighborhood text,
  add column zip_code text;

alter table public.clients
  add column address_number text,
  add column complement text,
  add column neighborhood text;

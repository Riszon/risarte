-- =============================================================================
-- Risarte Odontologia — Migration 0025 (Etapa 4.1 — fundação do Coordenador)
-- Prontuário clínico do Coordenador: consentimento (LGPD), considerações e
-- mídias (fotos, radiografias, escaneamento, exames, documentos, áudio).
--   - client_consents : termo/consentimento registrado (data/hora + por quem)
--   - clinical_notes   : considerações clínicas (texto, append-only)
--   - clinical_media   : metadados dos arquivos (bytes ficam no Storage privado)
-- Storage: bucket privado 'clinical-media' (acesso por link assinado, LGPD).
-- Idempotente.
-- =============================================================================

do $$ begin
  if not exists (select 1 from pg_type where typname = 'clinical_media_kind') then
    create type public.clinical_media_kind as enum
      ('photo', 'radiograph', 'scan', 'exam', 'document', 'audio');
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Consentimento (LGPD): exigido ANTES de coletar dados clínicos / gravar.
-- -----------------------------------------------------------------------------
create table if not exists public.client_consents (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  clinic_id uuid not null references public.clinics (id),
  granted_at timestamptz not null default now(),
  recorded_by uuid references public.profiles (id),
  notes text,
  revoked_at timestamptz
);
create index if not exists client_consents_client_idx
  on public.client_consents (client_id);
alter table public.client_consents enable row level security;

-- -----------------------------------------------------------------------------
-- Considerações clínicas (texto).
-- -----------------------------------------------------------------------------
create table if not exists public.clinical_notes (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  clinic_id uuid not null references public.clinics (id),
  body text not null,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);
create index if not exists clinical_notes_client_idx
  on public.clinical_notes (client_id);
alter table public.clinical_notes enable row level security;

-- -----------------------------------------------------------------------------
-- Mídias clínicas (metadados; os bytes ficam no Storage privado).
-- -----------------------------------------------------------------------------
create table if not exists public.clinical_media (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  clinic_id uuid not null references public.clinics (id),
  kind public.clinical_media_kind not null,
  storage_path text not null,
  original_name text,
  content_type text,
  size_bytes bigint,
  uploaded_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);
create index if not exists clinical_media_client_idx
  on public.clinical_media (client_id);
alter table public.clinical_media enable row level security;

-- -----------------------------------------------------------------------------
-- RLS: leitura para membros da clínica (e Planner/Admin, que recebem o caso);
-- escrita só pelo Coordenador Clínico da clínica (e Admin Master).
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['client_consents', 'clinical_notes', 'clinical_media']
  loop
    execute format('drop policy if exists "%s_select" on public.%I', t, t);
    execute format($f$
      create policy "%1$s_select" on public.%1$I for select to authenticated
      using (
        public.is_admin_master()
        or clinic_id in (select public.user_full_access_clinic_ids())
        or public.is_planner()
      )$f$, t);

    execute format('drop policy if exists "%s_insert" on public.%I', t, t);
    execute format($f$
      create policy "%1$s_insert" on public.%1$I for insert to authenticated
      with check (
        public.is_admin_master()
        or public.has_role_in_clinic(clinic_id, array['clinical_coordinator']::public.user_role[])
      )$f$, t);

    execute format('drop policy if exists "%s_delete" on public.%I', t, t);
    execute format($f$
      create policy "%1$s_delete" on public.%1$I for delete to authenticated
      using (
        public.is_admin_master()
        or public.has_role_in_clinic(clinic_id, array['clinical_coordinator']::public.user_role[])
      )$f$, t);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Storage privado: bucket 'clinical-media'. Caminho dos arquivos começa pelo
-- clinic_id (ex.: <clinic_id>/<client_id>/<uuid>-arquivo), e a RLS usa esse
-- primeiro segmento para autorizar. Acesso sempre por URL assinada.
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('clinical-media', 'clinical-media', false)
on conflict (id) do nothing;

drop policy if exists "risarte_clinical_media_select" on storage.objects;
create policy "risarte_clinical_media_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'clinical-media'
    and (
      public.is_admin_master()
      or public.is_planner()
      or (storage.foldername(name))[1]::uuid in (select public.user_full_access_clinic_ids())
    )
  );

drop policy if exists "risarte_clinical_media_insert" on storage.objects;
create policy "risarte_clinical_media_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'clinical-media'
    and (
      public.is_admin_master()
      or public.has_role_in_clinic(
        (storage.foldername(name))[1]::uuid,
        array['clinical_coordinator']::public.user_role[]
      )
    )
  );

drop policy if exists "risarte_clinical_media_delete" on storage.objects;
create policy "risarte_clinical_media_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'clinical-media'
    and (
      public.is_admin_master()
      or public.has_role_in_clinic(
        (storage.foldername(name))[1]::uuid,
        array['clinical_coordinator']::public.user_role[]
      )
    )
  );

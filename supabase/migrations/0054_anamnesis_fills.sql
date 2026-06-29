-- =============================================================================
-- 0054 — Anamnese preenchida no prontuário (Anamnese A3)
-- -----------------------------------------------------------------------------
-- Cada preenchimento da anamnese é uma VERSÃO imutável (anamnesis_fills) com suas
-- respostas (anamnesis_answers, com a pergunta "carimbada" para o histórico ficar
-- legível mesmo que a ficha mude depois). A versão mais recente é a atual; as
-- anteriores formam o histórico (a reavaliação cria nova versão — A4).
--
-- Quem preenche/edita: Coordenador Clínico (ou Admin). Quem visualiza: além do
-- Planner/Gerente/Admin, agora também o **Dentista** (precisa para executar).
-- Idempotente.
-- =============================================================================

create table if not exists public.anamnesis_fills (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  clinic_id uuid not null references public.clinics (id),
  template_id uuid references public.anamnesis_templates (id) on delete set null,
  template_name text,
  filled_by uuid references public.profiles (id),
  filled_at timestamptz not null default now(),
  note text,
  no_changes boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists anamnesis_fills_client_idx
  on public.anamnesis_fills (client_id, filled_at desc);
alter table public.anamnesis_fills enable row level security;

create table if not exists public.anamnesis_answers (
  id uuid primary key default gen_random_uuid(),
  fill_id uuid not null references public.anamnesis_fills (id) on delete cascade,
  clinic_id uuid not null references public.clinics (id),
  question_id uuid references public.anamnesis_questions (id) on delete set null,
  section text,
  label text not null,
  kind text not null,
  value jsonb,
  detail text,
  is_adhoc boolean not null default false,
  sort_order int not null default 0,
  alert_when jsonb,
  alert_message text
);
create index if not exists anamnesis_answers_fill_idx
  on public.anamnesis_answers (fill_id);
alter table public.anamnesis_answers enable row level security;

-- -----------------------------------------------------------------------------
-- RLS — leitura: Admin / escopo da unidade / Planner / Dentista / Coordenador.
-- escrita: Admin ou Coordenador Clínico da unidade.
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['anamnesis_fills', 'anamnesis_answers']
  loop
    execute format('drop policy if exists "%s_select" on public.%I', t, t);
    execute format($f$
      create policy "%1$s_select" on public.%1$I for select to authenticated
      using (
        public.is_admin_master()
        or clinic_id in (select public.user_full_access_clinic_ids())
        or public.is_planner()
        or public.has_role_in_clinic(clinic_id, array['dentist','clinical_coordinator']::public.user_role[])
      )$f$, t);

    execute format('drop policy if exists "%s_insert" on public.%I', t, t);
    execute format($f$
      create policy "%1$s_insert" on public.%1$I for insert to authenticated
      with check (
        public.is_admin_master()
        or public.has_role_in_clinic(clinic_id, array['clinical_coordinator']::public.user_role[])
      )$f$, t);

    execute format('drop policy if exists "%s_update" on public.%I', t, t);
    execute format($f$
      create policy "%1$s_update" on public.%1$I for update to authenticated
      using (
        public.is_admin_master()
        or public.has_role_in_clinic(clinic_id, array['clinical_coordinator']::public.user_role[])
      )
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

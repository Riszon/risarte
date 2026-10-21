-- =============================================================================
-- 0315 — ODONTOGRAMA OD6: O PRONTUÁRIO — EVOLUÇÃO TRANCADA, ADENDO, REGISTROS
-- IMUTÁVEIS, O HISTÓRICO DAS SESSÕES E A EXPORTAÇÃO AUDITADA
--
-- Plano e decisões do dono em docs/odontograma/OD6-PLANO.md (21/10/2026):
--   * J1: a evolução tranca AO CONCLUIR O ATENDIMENTO (sem atendimento: no fim
--     do dia em que foi escrita). Depois, só ADENDO, com motivo — a original
--     não muda e não some.
--   * Documento clínico emitido e anamnese preenchida passam a não mudar no
--     BANCO (a tela já não mudava; a regra da tabela deixava).
--   * J2: o odontograma "em um dia do passado" precisa saber quando cada
--     sessão nasceu e quando foi feita — inclusive a feita que depois foi
--     para refação (a 0143 apaga a data da sessão; o registro do atendimento
--     guarda).
--   * J3: o prontuário completo é gerado pelo Admin Master e pelo Gerente da
--     unidade, sempre com motivo, e cada geração fica registrada.
--
-- Idempotente. Nada apaga dado.
-- =============================================================================

-- 1) J1: a evolução ganha o ADENDO ------------------------------------------------
alter table public.clinical_progress_notes
  add column if not exists addendum_of uuid references public.clinical_progress_notes (id),
  add column if not exists addendum_reason text;
create index if not exists clinical_progress_notes_addendum_idx
  on public.clinical_progress_notes (addendum_of) where addendum_of is not null;

-- Trancada? (J1) Adendo nasce trancado; a original tranca quando o atendimento
-- dela é concluído; sem atendimento, quando o dia (do Brasil) em que foi
-- escrita passa.
create or replace function public._progress_note_locked(
  p_addendum_of uuid,
  p_appointment uuid,
  p_created_at timestamptz
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_addendum_of is not null then true
    when p_appointment is not null then coalesce(
      (select a.attendance = 'done' from public.appointments a where a.id = p_appointment), false)
    else (p_created_at at time zone 'America/Sao_Paulo')::date < public.today_br()
  end;
$$;
revoke execute on function public._progress_note_locked(uuid, uuid, timestamptz) from public, anon, authenticated;

create or replace function public.clinical_progress_notes_lock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    -- só em cascata (cadastro apagado); registro clínico não se apaga
    if pg_trigger_depth() > 1 then return old; end if;
    raise exception 'NOTE_NOT_DELETABLE';
  end if;
  -- a cascata do atendimento apagado (appointment_id vira nulo) passa
  if pg_trigger_depth() > 1 then return new; end if;
  if (new.client_id, new.clinic_id, new.author_id, new.appointment_id, new.created_at,
      new.addendum_of, new.addendum_reason)
     is distinct from
     (old.client_id, old.clinic_id, old.author_id, old.appointment_id, old.created_at,
      old.addendum_of, old.addendum_reason) then
    raise exception 'NOTE_LOCKED';
  end if;
  if public._progress_note_locked(old.addendum_of, old.appointment_id, old.created_at) then
    raise exception 'NOTE_LOCKED';
  end if;
  return new;
end;
$$;
revoke execute on function public.clinical_progress_notes_lock() from public, anon, authenticated;
drop trigger if exists clinical_progress_notes_lock_trg on public.clinical_progress_notes;
create trigger clinical_progress_notes_lock_trg
  before update or delete on public.clinical_progress_notes
  for each row execute function public.clinical_progress_notes_lock();

-- A anotação direta não nasce como adendo (adendo só pela função abaixo).
-- Mesma regra da 0314, com essa condição a mais.
drop policy if exists "clinical_progress_notes_insert" on public.clinical_progress_notes;
create policy "clinical_progress_notes_insert" on public.clinical_progress_notes
  for insert to authenticated
  with check (
    addendum_of is null
    and addendum_reason is null
    and (
      public.is_owner()
      or (
        author_id = (select auth.uid())
        and (
          public.has_role_in_clinic(clinic_id, array['dentist']::public.user_role[])
          or (public.has_role_in_clinic(clinic_id, array['clinical_coordinator']::public.user_role[])
              and exists (select 1 from public.appointments a
                           where a.id = appointment_id
                             and (select auth.uid()) in (a.provider_user_id, a.called_by)))
        )
      )
    )
  );

-- O adendo: só de anotação TRANCADA (aberta se corrige direto), com motivo.
-- Escreve: o titular, o autor da original, o dentista da unidade, ou o
-- Coordenador que foi o profissional do atendimento da original (H4).
create or replace function public.add_progress_addendum(p_note uuid, p_body text, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_n record;
  v_id uuid;
begin
  if v_user is null then raise exception 'NOT_ALLOWED'; end if;
  select n.id, n.client_id, n.clinic_id, n.author_id, n.appointment_id, n.created_at, n.addendum_of
    into v_n
    from public.clinical_progress_notes n where n.id = p_note;
  if v_n.id is null then raise exception 'NOTE_NOT_FOUND'; end if;
  if v_n.addendum_of is not null then raise exception 'ADDENDUM_OF_ADDENDUM'; end if;
  if not public._progress_note_locked(v_n.addendum_of, v_n.appointment_id, v_n.created_at) then
    raise exception 'NOTE_STILL_OPEN';
  end if;
  if length(btrim(coalesce(p_body, ''))) = 0 then raise exception 'ADDENDUM_BODY_REQUIRED'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'ADDENDUM_REASON_REQUIRED'; end if;
  if not coalesce(
    public.is_owner()
    or v_n.author_id = v_user
    or public.has_role_in_clinic(v_n.clinic_id, array['dentist']::public.user_role[])
    or (public.has_role_in_clinic(v_n.clinic_id, array['clinical_coordinator']::public.user_role[])
        and exists (select 1 from public.appointments a
                     where a.id = v_n.appointment_id and v_user in (a.provider_user_id, a.called_by))),
    false
  ) then
    raise exception 'NOT_ALLOWED';
  end if;
  insert into public.clinical_progress_notes
    (client_id, clinic_id, author_id, appointment_id, body, addendum_of, addendum_reason)
  values (v_n.client_id, v_n.clinic_id, v_user, null, btrim(p_body), v_n.id, btrim(p_reason))
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function public.add_progress_addendum(uuid, text, text) from public, anon, authenticated;
grant execute on function public.add_progress_addendum(uuid, text, text) to authenticated;

-- 2) Documento clínico emitido não muda (errou: emite outro) --------------------
drop policy if exists "clinical_documents_update" on public.clinical_documents;
create or replace function public.clinical_documents_lock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if pg_trigger_depth() > 1 then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  raise exception 'DOCUMENT_LOCKED';
end;
$$;
revoke execute on function public.clinical_documents_lock() from public, anon, authenticated;
drop trigger if exists clinical_documents_lock_trg on public.clinical_documents;
create trigger clinical_documents_lock_trg
  before update or delete on public.clinical_documents
  for each row execute function public.clinical_documents_lock();

-- 3) A anamnese preenchida não muda (a 0054 já dizia "versão imutável") --------
-- Apagar só a versão que acabou de nascer SEM respostas (o "desfazer" da tela
-- quando a gravação das respostas falha).
create or replace function public.anamnesis_records_lock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if pg_trigger_depth() > 1 then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  -- (ifs aninhados: o plpgsql não para no primeiro falso, e `old.created_at`
  -- não existe na tabela das respostas)
  if tg_table_name = 'anamnesis_fills' and tg_op = 'DELETE' then
    if old.created_at > now() - interval '10 minutes'
       and not exists (select 1 from public.anamnesis_answers a where a.fill_id = old.id) then
      return old;
    end if;
  end if;
  raise exception 'ANAMNESIS_LOCKED';
end;
$$;
revoke execute on function public.anamnesis_records_lock() from public, anon, authenticated;
drop trigger if exists anamnesis_fills_lock_trg on public.anamnesis_fills;
create trigger anamnesis_fills_lock_trg
  before update or delete on public.anamnesis_fills
  for each row execute function public.anamnesis_records_lock();
drop trigger if exists anamnesis_answers_lock_trg on public.anamnesis_answers;
create trigger anamnesis_answers_lock_trg
  before update or delete on public.anamnesis_answers
  for each row execute function public.anamnesis_records_lock();

-- 4) J2: o histórico das sessões (para o odontograma de um dia do passado) ------
-- Quando a sessão nasceu, quando foi feita, e as vezes em que o atendimento
-- registrou que ela foi feita (a refação apaga a data da sessão; isto não).
create or replace function public.odontogram_session_history(p_client uuid)
returns table (
  session_id uuid,
  item_id uuid,
  procedure_id uuid,
  status text,
  created_at timestamptz,
  done_at timestamptz,
  done_records timestamptz[],
  tooth_code text,
  face_codes text[],
  region_code text
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.item_id, coalesce(i.procedure_id, s.procedure_id), s.status, s.created_at, s.done_at,
         coalesce((select array_agg(o.recorded_at order by o.recorded_at)
                     from public.attendance_session_outcomes o
                    where o.session_id = s.id and o.done), '{}'),
         i.tooth_code, coalesce(i.face_codes, '{}'), i.region_code
    from public.treatment_sessions s
    left join public.treatment_plan_option_items i on i.id = s.item_id
   where s.client_id = p_client
     and public.can_view_odontogram(p_client);
$$;
revoke execute on function public.odontogram_session_history(uuid) from public, anon, authenticated;
grant execute on function public.odontogram_session_history(uuid) to authenticated;

-- 5) J3: cada geração do prontuário completo fica registrada ---------------------
create table if not exists public.clinical_record_exports (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  clinic_id uuid not null references public.clinics (id),
  requested_by uuid not null references public.profiles (id),
  reason_code text not null
    check (reason_code in ('pedido_do_paciente', 'transferencia', 'auditoria', 'ordem_judicial', 'outro')),
  reason_note text,
  created_at timestamptz not null default now()
);
create index if not exists clinical_record_exports_client_idx
  on public.clinical_record_exports (client_id, created_at desc);
alter table public.clinical_record_exports enable row level security;
-- Leitura: o Admin e o Gerente da unidade do registro. Gravar: só pela função.
drop policy if exists clinical_record_exports_select on public.clinical_record_exports;
create policy clinical_record_exports_select on public.clinical_record_exports
  for select to authenticated
  using (
    public.is_admin_master()
    or public.has_role_in_clinic(clinic_id, array['unit_manager']::public.user_role[])
  );

-- O registro não se altera nem se apaga (só em cascata do cadastro).
create or replace function public.clinical_record_exports_lock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if pg_trigger_depth() > 1 then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  raise exception 'EXPORT_LOCKED';
end;
$$;
revoke execute on function public.clinical_record_exports_lock() from public, anon, authenticated;
drop trigger if exists clinical_record_exports_lock_trg on public.clinical_record_exports;
create trigger clinical_record_exports_lock_trg
  before update or delete on public.clinical_record_exports
  for each row execute function public.clinical_record_exports_lock();

create or replace function public.register_record_export(p_client uuid, p_reason text, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_clinic uuid;
  v_id uuid;
begin
  if v_user is null then raise exception 'NOT_ALLOWED'; end if;
  select clinic_id into v_clinic from public.clients where id = p_client;
  if v_clinic is null then raise exception 'CLIENT_NOT_FOUND'; end if;
  if not coalesce(
    public.is_admin_master()
    or public.has_role_in_clinic(v_clinic, array['unit_manager']::public.user_role[]),
    false
  ) then
    raise exception 'NOT_ALLOWED';
  end if;
  if p_reason is null or p_reason not in ('pedido_do_paciente', 'transferencia', 'auditoria', 'ordem_judicial', 'outro') then
    raise exception 'EXPORT_REASON_INVALID';
  end if;
  if p_reason = 'outro' and length(btrim(coalesce(p_note, ''))) < 5 then
    raise exception 'EXPORT_NOTE_REQUIRED';
  end if;
  insert into public.clinical_record_exports (client_id, clinic_id, requested_by, reason_code, reason_note)
  values (p_client, v_clinic, v_user, p_reason, nullif(btrim(coalesce(p_note, '')), ''))
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function public.register_record_export(uuid, text, text) from public, anon, authenticated;
grant execute on function public.register_record_export(uuid, text, text) to authenticated;

select public.audit_attach_all();

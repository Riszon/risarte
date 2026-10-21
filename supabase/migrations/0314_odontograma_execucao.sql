-- =============================================================================
-- 0314 — ODONTOGRAMA OD5: A EXECUÇÃO
--
-- Plano e decisões do dono em docs/odontograma/OD5-PLANO.md (20/10/2026):
--   * H1: o procedimento conta como FEITO quando a ÚLTIMA sessão daquele item
--     (um item por dente, OD3) é concluída.
--   * H2: o feito RESOLVE o achado "a tratar" do mesmo lugar (a face; ou o
--     dente, se o procedimento é do dente inteiro), automático — o achado não
--     se apaga, só deixa de valer como situação atual.
--   * H3: o dentista SUGERE achado durante o atendimento, preso à sessão; o
--     Planner define (mesmo fluxo da OD2).
--   * H4 (D8b): o Coordenador registra evolução e dá baixa nas sessões nos
--     atendimentos em que ELE é o profissional — igual ao dentista.
--   * D6: o Admin Master que não é o titular deixa de escrever evolução e de
--     concluir atendimento (vê tudo); o titular (`is_owner`) faz tudo.
--   * AP65 (achado no ensaio): a guarda da conclusão (0176) deixava passar
--     qualquer dentista da unidade quando ninguém tinha chamado o cliente —
--     comparação com nulo. Corrigido junto, por ser a mesma guarda.
--
-- A situação do dente continua CALCULADA, nunca regravada. Idempotente. Nada
-- apaga dado.
-- =============================================================================

-- 1) As sessões do cliente com o lugar do item (leitura para quem vê o
--    odontograma — o dentista não lê os itens do plano pela regra da tabela).
create or replace function public.odontogram_sessions(p_client uuid)
returns table (
  session_id uuid,
  item_id uuid,
  procedure_id uuid,
  status text,
  done_at timestamptz,
  tooth_code text,
  face_codes text[],
  region_code text
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.item_id, coalesce(i.procedure_id, s.procedure_id), s.status, s.done_at,
         i.tooth_code, coalesce(i.face_codes, '{}'), i.region_code
    from public.treatment_sessions s
    left join public.treatment_plan_option_items i on i.id = s.item_id
   where s.client_id = p_client
     and public.can_view_odontogram(p_client);
$$;
revoke execute on function public.odontogram_sessions(uuid) from public, anon, authenticated;
grant execute on function public.odontogram_sessions(uuid) to authenticated;

-- 2) O diagnóstico DEFINIDO de um dente (marca definida, não retirada) --------
create or replace function public._tooth_defined_findings(p_client uuid, p_tooth text)
returns table (
  finding_id uuid,
  condition_code text,
  face_codes text[],
  applies_to text,
  needs_treatment boolean,
  decided_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select f.id, f.condition_code, coalesce(f.face_codes, '{}'),
         case when cardinality(coalesce(f.face_codes, '{}')) > 0 then 'face' else c.applies_to end,
         coalesce(c.needs_treatment, false), f.decided_at
    from public.tooth_findings f
    join public.dental_conditions c on c.code = f.condition_code
   where f.client_id = p_client
     and f.tooth_code = p_tooth
     and f.action = 'mark'
     and f.status = 'defined'
     and not exists (
       select 1 from public.tooth_findings r
        where r.removes_finding_id = f.id and r.status = 'defined');
$$;
revoke execute on function public._tooth_defined_findings(uuid, text) from public, anon, authenticated;

-- 3) H1: o que foi FEITO no dente (o item com todas as sessões concluídas) e o
--    efeito dele. Prótese fixa: o efeito muda se o dente está ausente (0308).
create or replace function public._tooth_done_effects(p_client uuid, p_tooth text)
returns table (
  item_id uuid,
  face_codes text[],
  effect text,
  applies_to text,
  done_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with feitos as (
    select i.id, coalesce(i.face_codes, '{}') as faces, i.procedure_id, max(s.done_at) as quando
      from public.treatment_plan_option_items i
      join public.treatment_sessions s on s.item_id = i.id
     where s.client_id = p_client
       and i.tooth_code = p_tooth
       and s.status <> 'cancelled'
     group by i.id
    having count(*) > 0 and bool_and(s.status = 'done')
  ),
  ausente as (
    select exists (select 1 from public._tooth_defined_findings(p_client, p_tooth) d
                    where d.condition_code = 'A') as sim
  )
  select f.id, f.faces, e.code, e.applies_to, f.quando
    from feitos f
    join public.procedure_dental_rules r on r.procedure_id = f.procedure_id
    cross join ausente a
    join public.dental_conditions e
      on e.code = case when a.sim and r.effect_when_absent is not null
                       then r.effect_when_absent else r.effect_condition end;
$$;
revoke execute on function public._tooth_done_effects(uuid, text) from public, anon, authenticated;

-- 4) A régua do plano (0311) passa a somar o FEITO e a tirar o que ele tratou.
--    Mesma assinatura e retorno da 0311.
create or replace function public._tooth_current_conditions(p_client uuid, p_tooth text)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  with achados as (
    select * from public._tooth_defined_findings(p_client, p_tooth)
  ),
  feitos as (
    select * from public._tooth_done_effects(p_client, p_tooth)
  ),
  -- H2: achado "a tratar" anterior ao feito, no mesmo lugar, deixa de valer.
  valendo as (
    select a.condition_code
      from achados a
     where not (a.needs_treatment and exists (
       select 1 from feitos e
        where a.decided_at <= e.done_at
          and (
            (cardinality(e.face_codes) > 0 and a.face_codes && e.face_codes)
            or (cardinality(e.face_codes) = 0 and (
                  e.applies_to = 'whole_tooth'
                  or (e.applies_to = 'root' and a.applies_to = 'root')
                  or (e.applies_to = 'crown' and a.applies_to in ('face', 'crown'))))
          )))
  )
  select coalesce(array_agg(distinct x.code), '{}')
    from (select condition_code as code from valendo
          union all
          select effect from feitos) x;
$$;
revoke execute on function public._tooth_current_conditions(uuid, text) from public, anon, authenticated;

-- 5) H3: a marca pode nascer de uma SESSÃO de tratamento ---------------------
-- Mesma conta da 0310; ganha a sessão (opcional). As chamadas antigas (7
-- argumentos) continuam valendo pelo padrão.
drop function if exists public._insert_tooth_findings(uuid, uuid, uuid, jsonb, text, text, text);
create or replace function public._insert_tooth_findings(
  p_client uuid,
  p_clinic uuid,
  p_evaluation uuid,
  p_items jsonb,
  p_origin text,
  p_status text,
  p_addendum_reason text,
  p_session uuid default null
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
      (client_id, clinic_id, evaluation_id, treatment_session_id, tooth_code, face_codes, condition_code,
       action, removes_finding_id, origin, is_addendum, addendum_reason, status,
       note, created_by, decided_by, decided_at)
    values
      (p_client, p_clinic, p_evaluation, p_session,
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
revoke execute on function public._insert_tooth_findings(uuid, uuid, uuid, jsonb, text, text, text, uuid) from public, anon, authenticated;

-- O profissional do atendimento (dentista, ou o Coordenador — H4) sugere,
-- preso à sessão. Só marcar: retirar continua do Planner.
create or replace function public.suggest_session_findings(p_session uuid, p_items jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_s record;
  v_item jsonb;
begin
  if v_user is null then raise exception 'NOT_ALLOWED'; end if;
  select s.client_id, s.clinic_id, s.status, s.executed_by, a.provider_user_id, a.called_by
    into v_s
    from public.treatment_sessions s
    left join public.appointments a on a.id = s.appointment_id
   where s.id = p_session;
  if v_s.client_id is null then raise exception 'SESSION_NOT_FOUND'; end if;
  if v_s.status = 'cancelled' then raise exception 'SESSION_CANCELLED'; end if;
  -- coalesce: com profissional ou "quem chamou" vazio, `in (...)` dá nulo — e
  -- `not nulo` não barra ninguém (achado no ensaio).
  if not coalesce(
    public.is_owner()
    or (public.has_role_in_clinic(v_s.clinic_id, array['dentist', 'clinical_coordinator']::public.user_role[])
        and v_user in (v_s.provider_user_id, v_s.called_by, v_s.executed_by)),
    false
  ) then
    raise exception 'NOT_ALLOWED';
  end if;
  if p_items is not null and jsonb_typeof(p_items) = 'array' then
    for v_item in select * from jsonb_array_elements(p_items) loop
      if coalesce(v_item ->> 'action', 'mark') <> 'mark' then raise exception 'ONLY_MARK'; end if;
    end loop;
  end if;
  return public._insert_tooth_findings(v_s.client_id, v_s.clinic_id, null, p_items,
                                       'suggestion', 'suggested', null, p_session);
end;
$$;
revoke execute on function public.suggest_session_findings(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.suggest_session_findings(uuid, jsonb) to authenticated;

-- 6) H4 + D6: quem registra evolução ------------------------------------------
drop policy if exists "clinical_progress_notes_insert" on public.clinical_progress_notes;
create policy "clinical_progress_notes_insert" on public.clinical_progress_notes
  for insert to authenticated
  with check (
    public.is_owner()
    or (
      author_id = (select auth.uid())
      and (
        public.has_role_in_clinic(clinic_id, array['dentist']::public.user_role[])
        -- H4: o Coordenador, no atendimento em que ele é o profissional
        or (public.has_role_in_clinic(clinic_id, array['clinical_coordinator']::public.user_role[])
            and exists (select 1 from public.appointments a
                         where a.id = appointment_id
                           and (select auth.uid()) in (a.provider_user_id, a.called_by)))
      )
    )
  );

drop policy if exists "clinical_progress_notes_update" on public.clinical_progress_notes;
create policy "clinical_progress_notes_update" on public.clinical_progress_notes
  for update to authenticated
  using (public.is_owner() or author_id = (select auth.uid()))
  with check (public.is_owner() or author_id = (select auth.uid()));

-- A conclusão do atendimento: mesma função da 0176 — muda só a GUARDA
-- (Coordenador no atendimento dele; titular no lugar de qualquer Admin).
create or replace function public.conclude_attendance_partial(
  p_appointment_id uuid,
  p_done_ids uuid[],
  p_reasons jsonb default '{}'::jsonb,
  p_extra_ids uuid[] default array[]::uuid[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic uuid;
  v_provider uuid;
  v_called_by uuid;
  v_client uuid;
  v_called timestamptz;
  v_done timestamptz := now();
  v_user uuid := (select auth.uid());
  v_status public.journey_status;
  v_name text;
  v_total_min numeric;
  v_planned_sum numeric;
  v_count int;
  v_all_planned boolean;
  v_reopened int := 0;
  v_extra uuid[] := coalesce(p_extra_ids, array[]::uuid[]);
  v_all_done uuid[];
begin
  select clinic_id, provider_user_id, called_by, client_id, called_at
    into v_clinic, v_provider, v_called_by, v_client, v_called
  from public.appointments where id = p_appointment_id;
  if v_clinic is null then raise exception 'APPOINTMENT_NOT_FOUND'; end if;

  -- ⚠️ coalesce (AP65): sem "quem chamou", `v_called_by = v_user` dá NULO, e
  -- `not (nulo)` não barra — desde a 0176 qualquer dentista da unidade
  -- concluía o atendimento de outro profissional quando ninguém o chamou.
  if not coalesce(
    public.is_owner()
    or (
      public.has_role_in_clinic(v_clinic, array['dentist', 'clinical_coordinator']::public.user_role[])
      and (v_called_by = v_user or (v_called_by is null and v_provider = v_user))
    ),
    false
  ) then
    raise exception 'NOT_ALLOWED';
  end if;

  -- I7b: só conclui depois de descrever o atendimento.
  if not exists (
    select 1 from public.clinical_progress_notes n
    where n.appointment_id = p_appointment_id
      and btrim(n.body) <> ''
  ) then
    raise exception 'NOTE_REQUIRED';
  end if;

  -- I7b: sessões EXTRAS — só as do mesmo cliente, ainda não concluídas e que
  -- sejam do próprio dentista ou ainda sem dentista definido.
  if array_length(v_extra, 1) is not null then
    update public.treatment_sessions ts
       set appointment_id = p_appointment_id
     where ts.id = any (v_extra)
       and ts.client_id = v_client
       and ts.status <> 'done'
       and (ts.appointment_id is null or ts.appointment_id = p_appointment_id)
       and (ts.planner_provider_id is null
            or ts.planner_provider_id = coalesce(v_provider, v_user)
            or ts.planner_provider_id = v_user);
  end if;

  v_all_done := coalesce(p_done_ids, array[]::uuid[]) || v_extra;

  update public.appointments
  set attendance = 'done', status = 'completed',
      done_at = v_done, done_by = v_user
  where id = p_appointment_id;

  if v_called is not null then
    v_total_min := greatest(0, round(extract(epoch from (v_done - v_called)) / 60));
  else
    v_total_min := null;
  end if;

  select count(*),
         coalesce(sum(coalesce(planned_minutes, 0)), 0),
         bool_and(coalesce(planned_minutes, 0) > 0)
    into v_count, v_planned_sum, v_all_planned
  from public.treatment_sessions
  where appointment_id = p_appointment_id
    and status <> 'done'
    and id = any (v_all_done);

  -- Registro do resultado ANTES de mexer nas sessões (depois delas o vínculo
  -- com o atendimento some).
  insert into public.attendance_session_outcomes
    (appointment_id, clinic_id, client_id, session_id, label, stage_name,
     planned_minutes, done, unplanned, reason, recorded_by)
  select p_appointment_id, v_clinic, v_client, ts.id,
         ts.procedure_name || ' — ' ||
           coalesce(ts.name, 'Sessão ' || ts.session_index || ' de ' || ts.session_total),
         ts.stage_name,
         ts.planned_minutes,
         ts.id = any (v_all_done),
         ts.id = any (v_extra),
         nullif(btrim(p_reasons ->> ts.id::text), ''),
         v_user
    from public.treatment_sessions ts
   where ts.appointment_id = p_appointment_id
     and ts.status <> 'done'
     and not exists (
       select 1 from public.attendance_session_outcomes o
       where o.appointment_id = p_appointment_id and o.session_id = ts.id
     );

  if v_count > 0 then
    update public.treatment_sessions ts
    set status = 'done',
        done_at = v_done,
        executed_by = v_user,
        actual_minutes = case
          when v_total_min is null then null
          when v_all_planned and v_planned_sum > 0
            then round(v_total_min * ts.planned_minutes / v_planned_sum)::int
          else round(v_total_min / v_count)::int
        end
    where ts.appointment_id = p_appointment_id
      and ts.status <> 'done'
      and ts.id = any (v_all_done);
  end if;

  update public.treatment_sessions ts
  set status = 'pending',
      appointment_id = null,
      planned_date = null,
      reopen_reason = nullif(btrim(p_reasons ->> ts.id::text), ''),
      reopened_at = v_done,
      reopened_by = v_user
  where ts.appointment_id = p_appointment_id
    and ts.status <> 'done'
    and not (ts.id = any (v_all_done));
  get diagnostics v_reopened = row_count;

  update public.appointments a
  set treatment_session_id = null
  where a.id = p_appointment_id
    and a.treatment_session_id is not null
    and not exists (
      select 1 from public.treatment_sessions ts
      where ts.id = a.treatment_session_id
        and ts.appointment_id = p_appointment_id
    );

  select journey_status, full_name into v_status, v_name
  from public.clients where id = v_client;

  if v_reopened > 0 then
    insert into public.notifications (user_id, clinic_id, title, body, link)
    select ucr.user_id, v_clinic,
           'Sessões reabertas: revisar agendamento de ' || v_name,
           v_reopened || ' sessão(ões) do atendimento não foram concluídas e '
             || 'voltaram para "a agendar". Revise os agendamentos do cliente.',
           '/clientes/' || v_client
    from public.user_clinic_roles ucr
    where ucr.clinic_id = v_clinic and ucr.role = 'receptionist';
  elsif v_status = 'in_treatment' and not exists (
    select 1 from public.appointments ap
    where ap.client_id = v_client
      and ap.type = 'treatment_session'
      and ap.starts_at > now()
      and ap.status in ('scheduled', 'confirmed')
  ) then
    insert into public.notifications (user_id, clinic_id, title, body, link)
    select ucr.user_id, v_clinic,
           'Agendar próxima sessão de tratamento: ' || v_name,
           v_name || ' concluiu uma sessão e não tem a próxima agendada.',
           '/clientes/' || v_client
    from public.user_clinic_roles ucr
    where ucr.clinic_id = v_clinic and ucr.role = 'receptionist';
  end if;
end;
$$;
revoke execute on function public.conclude_attendance_partial(uuid, uuid[], jsonb, uuid[])
  from public, anon, authenticated;
grant execute on function public.conclude_attendance_partial(uuid, uuid[], jsonb, uuid[])
  to authenticated;

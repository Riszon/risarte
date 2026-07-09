-- =============================================================================
-- 0089 — O plano e a avaliação acompanham o cliente na transferência
-- -----------------------------------------------------------------------------
-- Antes: transferir A→B mudava só a unidade do CLIENTE. O plano de tratamento e
-- a avaliação clínica continuavam etiquetados como A — então o Coordenador de B
-- não via nem podia aprovar o plano, e o plano seguia aparecendo em A.
--
-- Agora:
--  (1) transfer_client move TODO o plano (plano, opções, itens, etapas e
--      sessões) para a unidade de destino → o Coordenador de B passa a ver e a
--      APROVAR (a RLS de escrita segue o clinic_id do plano) e some da unidade A.
--  (2) Se o plano estava aguardando aprovação, o Coordenador de B é notificado
--      (com a unidade de origem, quem avaliou e quando); o Coordenador de A é
--      avisado do handoff.
--  (3) A avaliação (consentimento, considerações, fotos/exames), a anamnese e os
--      arquivos no Storage ficam legíveis para quem atende a unidade ATUAL do
--      cliente, via o histórico de unidades (user_has_client_history_access) —
--      a unidade A mantém o acesso; a B ganha. Sem mover arquivos de lugar.
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Helper: acesso a uma resposta de anamnese pelo histórico do cliente do seu
-- preenchimento (SECURITY DEFINER — o lookup ignora RLS, sem recursão).
-- -----------------------------------------------------------------------------
create or replace function public.fill_history_access(p_fill_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.anamnesis_fills f
    where f.id = p_fill_id
      and public.user_has_client_history_access(f.client_id)
  );
$$;
grant execute on function public.fill_history_access(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Leitura da avaliação clínica: acrescenta o acesso pelo histórico do cliente.
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
        or public.user_has_client_history_access(client_id)
      )$f$, t);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Leitura da anamnese: fills (têm client_id) e answers (via fill_history_access).
-- -----------------------------------------------------------------------------
drop policy if exists "anamnesis_fills_select" on public.anamnesis_fills;
create policy "anamnesis_fills_select" on public.anamnesis_fills
  for select to authenticated
  using (
    public.is_admin_master()
    or clinic_id in (select public.user_full_access_clinic_ids())
    or public.is_planner()
    or public.has_role_in_clinic(clinic_id, array['dentist','clinical_coordinator']::public.user_role[])
    or public.user_has_client_history_access(client_id)
  );

drop policy if exists "anamnesis_answers_select" on public.anamnesis_answers;
create policy "anamnesis_answers_select" on public.anamnesis_answers
  for select to authenticated
  using (
    public.is_admin_master()
    or clinic_id in (select public.user_full_access_clinic_ids())
    or public.is_planner()
    or public.has_role_in_clinic(clinic_id, array['dentist','clinical_coordinator']::public.user_role[])
    or public.fill_history_access(fill_id)
  );

-- -----------------------------------------------------------------------------
-- Storage (bucket clinical-media): o caminho é <clinic_id>/<client_id>/<arquivo>.
-- Acrescenta acesso de leitura pelo histórico do cliente (2º segmento do path).
-- -----------------------------------------------------------------------------
drop policy if exists "risarte_clinical_media_select" on storage.objects;
create policy "risarte_clinical_media_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'clinical-media'
    and (
      public.is_admin_master()
      or public.is_planner()
      or (storage.foldername(name))[1]::uuid in (select public.user_full_access_clinic_ids())
      or public.user_has_client_history_access((storage.foldername(name))[2]::uuid)
    )
  );

-- -----------------------------------------------------------------------------
-- transfer_client: move o plano para a unidade de destino e notifica os
-- Coordenadores. (Corpo da 0067 + carregar o plano/avaliação + avisos.)
-- -----------------------------------------------------------------------------
create or replace function public.transfer_client(
  p_client_id uuid,
  p_target_clinic_id uuid,
  p_consent boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_clinic uuid;
  v_client_name text;
  v_target_name text;
  v_old_name text;
  v_user uuid := (select auth.uid());
  v_cancelled_count integer := 0;
  v_cancelled_list text := '';
  v_plan_status text;
  v_evaluator text;
  v_eval_at timestamptz;
begin
  if not coalesce(p_consent, false) then
    raise exception 'CONSENT_REQUIRED';
  end if;

  if not (
    public.is_admin_master()
    or public.has_role_in_clinic(p_target_clinic_id, array['receptionist','sdr']::public.user_role[])
    or (public.is_sdr() and p_target_clinic_id in (select public.user_full_access_clinic_ids()))
  ) then
    raise exception 'NOT_ALLOWED';
  end if;

  select clinic_id, full_name into v_old_clinic, v_client_name
  from public.clients where id = p_client_id;

  if v_old_clinic is null then
    raise exception 'CLIENT_NOT_FOUND';
  end if;
  if v_old_clinic = p_target_clinic_id then
    return;
  end if;

  with cancelled as (
    update public.appointments
    set status = 'cancelled'
    where client_id = p_client_id
      and clinic_id = v_old_clinic
      and starts_at > now()
      and status in ('scheduled', 'confirmed')
    returning starts_at, type
  )
  select count(*),
         coalesce(string_agg(
           to_char(starts_at at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI'),
           ', ' order by starts_at
         ), '')
    into v_cancelled_count, v_cancelled_list
  from cancelled;

  update public.client_clinic_history
  set ended_at = now()
  where client_id = p_client_id and ended_at is null;

  insert into public.client_clinic_history
    (client_id, clinic_id, transferred_by, consent_registered)
  values (p_client_id, p_target_clinic_id, v_user, true);

  update public.clients
  set clinic_id = p_target_clinic_id
  where id = p_client_id;

  select name into v_target_name from public.clinics where id = p_target_clinic_id;
  select name into v_old_name from public.clinics where id = v_old_clinic;

  -- ---------------------------------------------------------------------------
  -- O plano de tratamento acompanha o cliente: move todo o encadeamento
  -- (plano → opções → itens/etapas) e as sessões para a unidade de destino.
  -- ---------------------------------------------------------------------------
  update public.treatment_plans
    set clinic_id = p_target_clinic_id
  where client_id = p_client_id;

  update public.treatment_plan_options o
    set clinic_id = p_target_clinic_id
  where o.plan_id in (
    select tp.id from public.treatment_plans tp where tp.client_id = p_client_id
  );

  update public.treatment_plan_option_items i
    set clinic_id = p_target_clinic_id
  where i.option_id in (
    select o.id from public.treatment_plan_options o
    join public.treatment_plans tp on tp.id = o.plan_id
    where tp.client_id = p_client_id
  );

  update public.treatment_plan_stages s
    set clinic_id = p_target_clinic_id
  where s.option_id in (
    select o.id from public.treatment_plan_options o
    join public.treatment_plans tp on tp.id = o.plan_id
    where tp.client_id = p_client_id
  );

  update public.treatment_sessions
    set clinic_id = p_target_clinic_id
  where client_id = p_client_id;

  -- Estado do plano mais recente + quem fez a avaliação em A (para os avisos).
  select tp.status::text into v_plan_status
  from public.treatment_plans tp
  where tp.client_id = p_client_id
  order by tp.created_at desc limit 1;

  select p.full_name, cn.created_at into v_evaluator, v_eval_at
  from public.clinical_notes cn
  join public.profiles p on p.id = cn.created_by
  where cn.client_id = p_client_id and cn.clinic_id = v_old_clinic
  order by cn.created_at desc limit 1;

  -- ORIGEM (A): saiu da unidade — Recepção, Gerente, Coordenador.
  insert into public.notifications (user_id, clinic_id, title, body, link)
  select distinct ucr.user_id, v_old_clinic,
         'Cliente transferido para outra unidade',
         v_client_name || ' agora é atendido(a) em ' || v_target_name
           || case when v_cancelled_count > 0
              then '. Agendamentos futuros cancelados: ' || v_cancelled_list
              else '' end,
         '/clientes/' || p_client_id
  from public.user_clinic_roles ucr
  where ucr.clinic_id = v_old_clinic
    and ucr.role in ('receptionist', 'unit_manager', 'clinical_coordinator')
    and ucr.user_id is distinct from v_user;

  -- DESTINO (B): entrou na unidade — Recepção, Gerente, Coordenador (H3.9).
  insert into public.notifications (user_id, clinic_id, title, body, link)
  select distinct ucr.user_id, p_target_clinic_id,
         'Cliente transferido para a sua unidade',
         v_client_name || ' foi transferido(a) da unidade '
           || coalesce(v_old_name, 'de origem') || ' para a sua unidade.'
           || case when v_cancelled_count > 0
              then ' Tinha ' || v_cancelled_count
                   || ' agendamento(s) cancelado(s) na unidade anterior ('
                   || v_cancelled_list || ') — verifique se precisa reagendar.'
              else '' end,
         '/clientes/' || p_client_id
  from public.user_clinic_roles ucr
  where ucr.clinic_id = p_target_clinic_id
    and ucr.role in ('receptionist', 'unit_manager', 'clinical_coordinator')
    and ucr.user_id is distinct from v_user;

  -- Avisos específicos do plano de tratamento, quando existe um plano.
  if v_plan_status is not null then
    -- ORIGEM (A) — Coordenador: handoff do plano/avaliação.
    insert into public.notifications (user_id, clinic_id, title, body, link)
    select distinct ucr.user_id, v_old_clinic,
           'Plano de tratamento segue para outra unidade',
           'O plano de tratamento e a avaliação de ' || v_client_name
             || ' seguem para ' || v_target_name
             || '. A aprovação agora é do Coordenador de ' || v_target_name
             || '. Você continua com acesso à avaliação para consulta.',
           '/clientes/' || p_client_id
    from public.user_clinic_roles ucr
    where ucr.clinic_id = v_old_clinic
      and ucr.role = 'clinical_coordinator'
      and ucr.user_id is distinct from v_user;

    -- DESTINO (B) — Coordenador: plano aguardando aprovação (com detalhes).
    if v_plan_status = 'submitted' then
      insert into public.notifications (user_id, clinic_id, title, body, link)
      select distinct ucr.user_id, p_target_clinic_id,
             'Plano de tratamento para aprovação',
             v_client_name || ' foi transferido(a) de '
               || coalesce(v_old_name, 'outra unidade')
               || '. A avaliação foi feita em '
               || coalesce(v_old_name, 'outra unidade')
               || case when v_evaluator is not null
                    then ' por ' || v_evaluator else '' end
               || case when v_eval_at is not null
                    then ' em ' || to_char(
                           v_eval_at at time zone 'America/Sao_Paulo',
                           'DD/MM/YYYY') else '' end
               || '. Agora a aprovação do plano é da sua unidade.',
             '/clientes/' || p_client_id
      from public.user_clinic_roles ucr
      where ucr.clinic_id = p_target_clinic_id
        and ucr.role = 'clinical_coordinator'
        and ucr.user_id is distinct from v_user;
    end if;
  end if;

  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values (
    v_user, p_target_clinic_id, 'update', 'client_transfer', p_client_id::text,
    jsonb_build_object(
      'from_clinic', v_old_clinic, 'to_clinic', p_target_clinic_id,
      'consent', true, 'cancelled_appointments', v_cancelled_count,
      'plan_moved', v_plan_status is not null
    )
  );
end;
$$;

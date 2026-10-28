-- =============================================================================
-- 0336 — ORTODONTIA (ORTO2): OS AVISOS DA ROTINA DIÁRIA
--
-- A rotina `ortho_daily_alerts` (0335) cuidava só do lote de mensalidades.
-- Agora ela também avisa, uma vez por fato, quem age (ORTO-PLANO §3, ORTO2):
--   * MANUTENÇÃO VENCIDA sem agendamento (prevista há mais de 7 dias — a
--     régua O4 de `regras.ts` — e nenhum agendamento futuro) → Recepção e
--     Gerente, que agendam.
--   * FALTOU na última manutenção e nada marcado depois → Recepção e Gerente.
--   * REAVALIAÇÃO VENCIDA (ou o controle da contenção) → Coordenador e o
--     ortodontista do caso.
--   * MENSALIDADE ATRASADA → Gerente e Financeiro da Franqueadora (quem dá
--     baixa). A própria rotina marca como atrasada o que venceu e não foi
--     pago (o botão "Marcar atrasadas" fica para quem não quer esperar).
-- Um aviso por caso, assunto e fato (`ortho_case_notices`); o link leva à
-- ficha do caso (categoria Ortodontia no sino, pelo link).
--
-- Idempotente. `ortho_daily_alerts(uuid)` mantém a assinatura (create or replace).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) O REGISTRO DOS AVISOS DO CASO (um por caso, assunto e fato)
-- -----------------------------------------------------------------------------
create table if not exists public.ortho_case_notices (
  case_id uuid not null references public.ortho_cases (id) on delete cascade,
  kind text not null,
  key text not null default '',
  recipients integer not null default 0,
  sent_at timestamptz not null default now(),
  primary key (case_id, kind, key)
);
alter table public.ortho_case_notices enable row level security;
-- Sem regra de leitura: é registro técnico da rotina.
insert into public.audit_excluded_tables (schema_name, table_name, motivo)
values ('public', 'ortho_case_notices', 'Registro técnico da rotina de avisos da ortodontia (um por caso, assunto e fato)')
on conflict do nothing;

-- Envia um aviso do caso a uma lista de pessoas, uma vez por (caso, assunto,
-- fato). Devolve quantos receberam (0 = já tinha sido enviado). Interna.
create or replace function public._ortho_case_notify(
  p_case_id uuid,
  p_kind text,
  p_key text,
  p_users uuid[],
  p_title text,
  p_body text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic uuid;
  v_novo boolean;
  v_n integer := 0;
begin
  if p_users is null or cardinality(p_users) = 0 then return 0; end if;
  select clinic_id into v_clinic from public.ortho_cases where id = p_case_id;
  if v_clinic is null then return 0; end if;

  insert into public.ortho_case_notices (case_id, kind, key)
  values (p_case_id, p_kind, coalesce(p_key, ''))
  on conflict (case_id, kind, key) do nothing
  returning true into v_novo;
  if not coalesce(v_novo, false) then return 0; end if;

  insert into public.notifications (user_id, clinic_id, title, body, link)
  select distinct u, v_clinic, p_title, p_body, '/ortodontia/casos/' || p_case_id
    from unnest(p_users) as u
   where u is not null;
  get diagnostics v_n = row_count;
  update public.ortho_case_notices set recipients = v_n
   where case_id = p_case_id and kind = p_kind and key = coalesce(p_key, '');
  return v_n;
end;
$$;
revoke execute on function public._ortho_case_notify(uuid, text, text, uuid[], text, text) from public, anon, authenticated;

-- Quem recebe, por papel na unidade (ativos), mais pessoas avulsas.
create or replace function public._ortho_recipients(
  p_clinic_id uuid,
  p_roles public.user_role[],
  p_extra uuid[] default '{}'
)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select array_agg(distinct u) from (
    select ucr.user_id as u
      from public.user_clinic_roles_all ucr
      join public.profiles p on p.id = ucr.user_id and p.is_active
     where ucr.clinic_id = p_clinic_id and ucr.role = any (p_roles)
    union
    select ucr.user_id
      from public.user_clinic_roles_all ucr
      join public.profiles p on p.id = ucr.user_id and p.is_active
      join public.clinics c on c.id = ucr.clinic_id
     where c.type = 'franchisor' and ucr.role = 'finance_franchisor'
       and 'finance_franchisor' = any (p_roles)
    union
    select x from unnest(p_extra) as x
  ) t where u is not null;
$$;
revoke execute on function public._ortho_recipients(uuid, public.user_role[], uuid[]) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2) A ROTINA: o lote (0335) + os quatro avisos do caso (ORTO2)
-- -----------------------------------------------------------------------------
create or replace function public.ortho_daily_alerts(p_clinic_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_today date := public.today_br();
  v_b record;
  v_c record;
  v_m record;
  v_ch record;
  v_days integer;
  v_kind text;
  v_title text;
  v_body text;
  v_novo boolean;
  v_n integer;
  v_sent integer := 0;
  v_client_name text;
  v_who text;
begin
  if v_user is not null then
    if p_clinic_id is null then
      if not public.is_admin_master() then raise exception 'NOT_ALLOWED'; end if;
    elsif not public.ortho_can_settle(p_clinic_id) then
      raise exception 'NOT_ALLOWED';
    end if;
  end if;

  -- 0) Mensalidade que venceu e não foi paga vira ATRASADA (antes era só o botão).
  update public.ortho_charges set status = 'atrasada', updated_at = now()
   where status = 'em_aberto' and due_date < v_today
     and (p_clinic_id is null or clinic_id = p_clinic_id);

  -- 1) R8 (0335): o lote de mensalidades terminando / terminado.
  for v_b in
    select b.id, b.case_id, b.clinic_id, b.seq, b.installments_count,
           coalesce((select max(ch.due_date) from public.ortho_charges ch
                      where ch.batch_id = b.id and ch.status <> 'cancelada'),
                    (b.last_month + 9)) as last_due,
           c.client_id, c.code
      from public.ortho_billing_batches b
      join public.ortho_cases c on c.id = b.case_id
     where b.status = 'ativo' and b.decision is null
       and c.status = 'em_tratamento'
       and (p_clinic_id is null or b.clinic_id = p_clinic_id)
  loop
    v_days := v_b.last_due - v_today;
    v_kind := case
      when v_days < 0 then 'vencido'
      when v_days <= 15 then 'd15'
      when v_days <= 30 then 'd30'
      when v_days <= 60 then 'd60'
      else null end;
    if v_kind is null then continue; end if;

    insert into public.ortho_notices (batch_id, kind) values (v_b.id, v_kind)
    on conflict (batch_id, kind) do nothing
    returning true into v_novo;
    if not coalesce(v_novo, false) then continue; end if;

    select full_name into v_client_name from public.clients where id = v_b.client_id;
    v_title := case
      when v_kind = 'vencido' then 'Ortodontia: o lote de mensalidades terminou — renovar ou encerrar?'
      when v_kind = 'd15' then 'Ortodontia: lote de mensalidades termina em até 15 dias — decidir agora'
      when v_kind = 'd30' then 'Ortodontia: lote de mensalidades termina em até 30 dias — renovar ou encerrar?'
      else 'Ortodontia: lote de mensalidades termina em até 60 dias — renovar ou encerrar?' end;
    v_body := coalesce(v_client_name, 'Paciente') || ' (' || v_b.code || ') — lote ' || v_b.seq
      || ' de ' || v_b.installments_count || ' mensalidades'
      || case when v_days < 0 then ', a última venceu em ' else ', a última vence em ' end
      || to_char(v_b.last_due, 'DD/MM/YYYY')
      || '. Na ficha do caso: "Emitir novas mensalidades" ou "Não será necessário". Sem decisão, o tratamento fica sem mensalidades e pode ser suspenso.';

    insert into public.notifications (user_id, clinic_id, title, body, link)
    select distinct u, v_b.clinic_id, v_title, v_body, '/ortodontia/casos/' || v_b.case_id
    from unnest(public._ortho_recipients(v_b.clinic_id, array['unit_manager','finance_franchisor']::public.user_role[])) as u;
    get diagnostics v_n = row_count;
    update public.ortho_notices set recipients = v_n where batch_id = v_b.id and kind = v_kind;
    v_sent := v_sent + v_n;
  end loop;

  -- 2) ORTO2: os avisos do caso, para os casos abertos da unidade.
  for v_c in
    select c.id, c.clinic_id, c.client_id, c.code, c.status, c.orthodontist_id,
           c.next_reevaluation_date, cl.full_name as client_name,
           exists (select 1 from public.ortho_maintenances m
                     join public.appointments a on a.id = m.appointment_id
                    where m.case_id = c.id and m.status = 'agendada'
                      and (a.starts_at at time zone 'America/Sao_Paulo')::date >= v_today) as has_future
      from public.ortho_cases c
      join public.clients cl on cl.id = c.client_id
     where c.status in ('em_tratamento','contencao')
       and (p_clinic_id is null or c.clinic_id = p_clinic_id)
  loop
    -- 2a) MANUTENÇÃO VENCIDA sem agendamento (O4: prevista há mais de 7 dias),
    --     só em tratamento e só sem nada marcado para a frente. Uma por vez: a
    --     mais antiga vencida (o legado entra no meio com várias no passado —
    --     avisar todas de uma vez seria ruído). Agendada ou cancelada ela, a
    --     seguinte vira o fato novo.
    if v_c.status = 'em_tratamento' and not v_c.has_future then
      for v_m in
        select m.id, m.seq, m.planned_date
          from public.ortho_maintenances m
         where m.case_id = v_c.id and m.status = 'prevista' and m.appointment_id is null
           and m.planned_date is not null and m.planned_date < v_today - 7
         order by m.planned_date
         limit 1
      loop
        v_sent := v_sent + public._ortho_case_notify(v_c.id, 'manutencao_vencida', v_m.id::text,
          public._ortho_recipients(v_c.clinic_id, array['receptionist','unit_manager']::public.user_role[]),
          'Ortodontia: manutenção vencida sem agendamento',
          coalesce(v_c.client_name, 'Paciente') || ' (' || v_c.code || ') — manutenção ' || v_m.seq
            || ' prevista para ' || to_char(v_m.planned_date, 'DD/MM/YYYY') || ' está há '
            || (v_today - v_m.planned_date) || ' dias sem agendamento. Agende com o ortodontista.');
      end loop;
    end if;

    -- 2b) FALTOU na última manutenção e nada marcado depois (a mesma régua da tela).
    if not v_c.has_future then
      select m.id, m.seq, m.status,
             coalesce(m.done_at::date, (a.starts_at at time zone 'America/Sao_Paulo')::date, m.planned_date) as d
        into v_m
        from public.ortho_maintenances m
        left join public.appointments a on a.id = m.appointment_id
       where m.case_id = v_c.id and m.status <> 'cancelada'
         and coalesce(m.done_at::date, (a.starts_at at time zone 'America/Sao_Paulo')::date, m.planned_date) <= v_today
       order by coalesce(m.done_at::date, (a.starts_at at time zone 'America/Sao_Paulo')::date, m.planned_date) desc, m.seq desc
       limit 1;
      if v_m.id is not null and v_m.status = 'faltou' then
        v_sent := v_sent + public._ortho_case_notify(v_c.id, 'faltou', v_m.id::text,
          public._ortho_recipients(v_c.clinic_id, array['receptionist','unit_manager']::public.user_role[]),
          'Ortodontia: faltou à última manutenção — reagendar',
          coalesce(v_c.client_name, 'Paciente') || ' (' || v_c.code || ') faltou à manutenção ' || v_m.seq
            || ' em ' || to_char(v_m.d, 'DD/MM/YYYY') || ' e não tem nada marcado. Reagende; a falta prorroga o término previsto.');
      end if;
    end if;

    -- 2c) REAVALIAÇÃO (ou controle da contenção) vencida → Coordenador e o ortodontista.
    if v_c.next_reevaluation_date is not null and v_c.next_reevaluation_date < v_today then
      v_who := case when v_c.status = 'contencao' then 'controle da contenção' else 'reavaliação' end;
      v_sent := v_sent + public._ortho_case_notify(v_c.id, 'reavaliacao_vencida', v_c.next_reevaluation_date::text,
        public._ortho_recipients(v_c.clinic_id, array['clinical_coordinator']::public.user_role[],
                                 case when v_c.orthodontist_id is null then '{}'::uuid[] else array[v_c.orthodontist_id] end),
        'Ortodontia: ' || v_who || ' vencida',
        coalesce(v_c.client_name, 'Paciente') || ' (' || v_c.code || ') — ' || v_who || ' prevista para '
          || to_char(v_c.next_reevaluation_date, 'DD/MM/YYYY') || ' ainda não foi feita. Agende e, na ficha, ajuste a próxima data.');
    end if;

    -- 2d) MENSALIDADE ATRASADA → quem dá baixa (uma vez por cobrança).
    for v_ch in
      select ch.id, ch.kind, ch.reference_month, ch.due_date, ch.amount_cents
        from public.ortho_charges ch
       where ch.case_id = v_c.id and ch.status = 'atrasada'
       order by ch.due_date
    loop
      v_sent := v_sent + public._ortho_case_notify(v_c.id, 'mensalidade_atrasada', v_ch.id::text,
        public._ortho_recipients(v_c.clinic_id, array['unit_manager','finance_franchisor']::public.user_role[]),
        'Ortodontia: mensalidade atrasada',
        coalesce(v_c.client_name, 'Paciente') || ' (' || v_c.code || ') — '
          || case when v_ch.kind = 'contencao' then 'contenção' else 'mensalidade ' || to_char(v_ch.reference_month, 'MM/YYYY') end
          || ' de R$ ' || to_char(v_ch.amount_cents / 100.0, 'FM999G999G990D00')
          || ' venceu em ' || to_char(v_ch.due_date, 'DD/MM/YYYY') || ' e não foi paga.');
    end loop;
  end loop;

  return v_sent;
end;
$$;
revoke execute on function public.ortho_daily_alerts(uuid) from public, anon, authenticated;
grant execute on function public.ortho_daily_alerts(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Conferência (só contagens — nenhum dado pessoal)
-- -----------------------------------------------------------------------------
select
  (select count(*) from information_schema.tables
    where table_schema = 'public' and table_name = 'ortho_case_notices') as registro_dos_avisos,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('_ortho_case_notify','_ortho_recipients')) as funcoes_internas,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'ortho_daily_alerts'
      and p.prosrc like '%manutencao_vencida%' and p.prosrc like '%mensalidade_atrasada%') as rotina_com_os_avisos,
  (select count(*) from public.audit_excluded_tables where table_name = 'ortho_case_notices') as fora_da_auditoria,
  (select count(*) from cron.job where jobname = 'risarte-ortho-daily') as rotina_diaria;
-- Esperado: 1 · 2 · 1 · 1 · 1

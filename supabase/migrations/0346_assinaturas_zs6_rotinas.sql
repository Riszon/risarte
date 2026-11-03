-- =============================================================================
-- 0346 — ASSINATURA DIGITAL (ZapSign) — FASE ZS6: as rotinas
-- -----------------------------------------------------------------------------
-- Plano ZS0 (docs/assinaturas/PLANO-ZS0.md §5.7 e §11, fase ZS6). Decisões do
-- dono (02/11/2026), todas como recomendado: lembrete é SÓ aviso no sino para
-- quem enviou (nada vai ao cliente sozinho); alerta de consumo SÓ para os
-- Admin Master; sem o Resend a fila de e-mail espera.
--
--   * `signature_daily_run()` — a rotina diária (pg_cron 08:10 UTC = 05:10 em
--     Brasília):
--       1. VENCE o pacote aguardando assinatura com o prazo passado (rede de
--          segurança do webhook `doc_expired`) e avisa quem enviou;
--       2. LEMBRA quem enviou nos dias configurados (`reminder_days`, padrão
--          2 e 5) se o CLIENTE ainda não assinou — um aviso por pacote e dia
--          (`signature_reminders`);
--       3. CONSUMO do plano: pacotes do mês × `zapsign_monthly_limit`; ao
--          passar de `zapsign_alert_percent` e de 100%, avisa os Admin Master
--          no sino e põe o e-mail na fila (`signature_plan_alerts` não deixa
--          repetir no mês).
--   * `signature_job_runs` — o rastro de cada rotina (a diária daqui e a
--     horária da Vercel): quando rodou e o que fez. A tela de Configurações
--     mostra a última de cada. Registro técnico, fora da auditoria.
--   * `signature_log_job_run(job, stats, error)` — a porta por onde a rotina
--     horária (servidor, chave de serviço) grava o seu rastro.
--
-- Nenhuma das portas responde a usuário: só a rotina do banco e a chave de
-- serviço. Idempotente. Não apaga dado.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) O rastro das rotinas
-- -----------------------------------------------------------------------------
create table if not exists public.signature_job_runs (
  id bigint generated always as identity primary key,
  job text not null check (job in ('daily', 'hourly')),
  ran_at timestamptz not null default now(),
  stats jsonb not null default '{}'::jsonb,
  error text
);

create index if not exists signature_job_runs_job_idx
  on public.signature_job_runs (job, ran_at desc);

comment on table public.signature_job_runs is
  'ZS6 (0346): cada execução das rotinas das assinaturas (diária no banco, horária na Vercel) e o que fez. Registro técnico, fora da auditoria.';

alter table public.signature_job_runs enable row level security;

drop policy if exists "signature_job_runs_select" on public.signature_job_runs;
create policy "signature_job_runs_select" on public.signature_job_runs
  for select to authenticated
  using (public.signature_can('acao.assinaturas.configurar', null));

insert into public.audit_excluded_tables (schema_name, table_name, motivo) values
  ('public', 'signature_job_runs', 'Rastro técnico das rotinas das assinaturas (quando rodou e o que fez).')
on conflict do nothing;

create or replace function public.signature_log_job_run(p_job text, p_stats jsonb, p_error text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_job is null or p_job not in ('daily', 'hourly') then
    raise exception 'JOB_INVALID';
  end if;
  insert into public.signature_job_runs (job, stats, error)
  values (p_job, coalesce(p_stats, '{}'::jsonb), left(p_error, 500));
end;
$$;

revoke execute on function public.signature_log_job_run(text, jsonb, text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2) A rotina diária
-- -----------------------------------------------------------------------------
create or replace function public.signature_daily_run()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings public.signature_settings;
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  v_month text := to_char(now() at time zone 'America/Sao_Paulo', 'YYYY-MM');
  v_pkg record;
  v_day integer;
  v_days integer;
  v_lembrar integer;
  v_expired integer := 0;
  v_reminded integer := 0;
  v_alerts integer := 0;
  v_used integer := 0;
  v_pct numeric;
  v_threshold integer;
  v_stats jsonb;
begin
  select * into v_settings from public.signature_settings where id = true;
  if not found then
    return jsonb_build_object('skipped', 'sem configuração (0340)');
  end if;

  -- 2.1) Vencer o que passou do prazo (o webhook doc_expired pode não chegar).
  for v_pkg in
    select p.id, p.number, p.clinic_id, p.sent_by, p.status, p.cover_data
      from public.signature_packages p
     where p.status in ('sent', 'partially_signed')
       and p.expires_at is not null
       and p.expires_at < now()
     for update skip locked
  loop
    update public.signature_packages set status = 'expired' where id = v_pkg.id;
    insert into public.signature_events (package_id, event_type, payload)
    values (v_pkg.id, 'expired_by_routine', jsonb_build_object('from_status', v_pkg.status));
    if v_pkg.sent_by is not null then
      insert into public.notifications (user_id, clinic_id, title, body, link)
      values (v_pkg.sent_by, v_pkg.clinic_id, 'Link de assinatura venceu',
        'Pacote ' || v_pkg.number || ' — ' || coalesce(v_pkg.cover_data->>'client_name', 'cliente')
          || ': o prazo para assinar acabou. Se ainda for preciso, reenvie como pacote novo.',
        '/assinaturas/pacotes/' || v_pkg.id);
    end if;
    v_expired := v_expired + 1;
  end loop;

  -- 2.2) Lembrar quem enviou nos dias configurados, enquanto o CLIENTE não assina.
  for v_pkg in
    select p.id, p.number, p.clinic_id, p.sent_by, p.sent_at, p.cover_data
      from public.signature_packages p
     where p.status in ('sent', 'partially_signed')
       and p.current_stage = 'client'
       and p.sent_at is not null
       and p.sent_by is not null
  loop
    v_days := v_today - (v_pkg.sent_at at time zone 'America/Sao_Paulo')::date;
    v_lembrar := null;
    foreach v_day in array coalesce(v_settings.reminder_days, '{}'::integer[]) loop
      if v_day > 0 and v_days >= v_day and not exists (
        select 1 from public.signature_reminders r where r.package_id = v_pkg.id and r.day_offset = v_day
      ) then
        insert into public.signature_reminders (package_id, day_offset) values (v_pkg.id, v_day)
        on conflict do nothing;
        v_lembrar := greatest(coalesce(v_lembrar, 0), v_day);
      end if;
    end loop;
    -- Um aviso só por pacote e rodada, mesmo que dois dias tenham passado.
    if v_lembrar is not null then
      insert into public.notifications (user_id, clinic_id, title, body, link)
      values (v_pkg.sent_by, v_pkg.clinic_id, 'Cliente ainda não assinou',
        'Pacote ' || v_pkg.number || ' — ' || coalesce(v_pkg.cover_data->>'client_name', 'cliente')
          || ': enviado há ' || v_days || ' dia' || case when v_days = 1 then '' else 's' end
          || ' e o cliente ainda não assinou. Abra o pacote e reenvie o link.',
        '/assinaturas/pacotes/' || v_pkg.id);
      insert into public.signature_events (package_id, event_type, payload)
      values (v_pkg.id, 'reminder', jsonb_build_object('day', v_lembrar));
      v_reminded := v_reminded + 1;
    end if;
  end loop;

  -- 2.3) Consumo do plano: a ZapSign cobra o documento ao ser CRIADO, então
  --      conta todo pacote que chegou a ir para lá no mês (qualquer situação).
  if v_settings.zapsign_monthly_limit is not null and v_settings.zapsign_monthly_limit > 0 then
    select count(*) into v_used
      from public.signature_packages p
     where p.plan_month = v_month;
    v_pct := v_used * 100.0 / v_settings.zapsign_monthly_limit;
    foreach v_threshold in array array[least(greatest(coalesce(v_settings.zapsign_alert_percent, 80), 1), 99), 100] loop
      if v_pct >= v_threshold and not exists (
        select 1 from public.signature_plan_alerts a where a.plan_month = v_month and a.threshold_percent = v_threshold
      ) then
        insert into public.signature_plan_alerts (plan_month, threshold_percent, used_count, monthly_limit)
        values (v_month, v_threshold, v_used, v_settings.zapsign_monthly_limit)
        on conflict do nothing;
        insert into public.notifications (user_id, clinic_id, title, body, link)
        select pr.id, null,
          case when v_threshold >= 100 then 'Plano da ZapSign: limite do mês atingido'
               else 'Plano da ZapSign: ' || v_threshold || '% do mês usado' end,
          v_used || ' de ' || v_settings.zapsign_monthly_limit || ' documentos usados em ' || v_month
            || case when v_threshold >= 100 then '. Novos envios podem ser recusados pela ZapSign ou cobrados à parte.'
                    else '. Acompanhe para não passar do limite.' end,
          '/assinaturas/configuracoes'
          from public.profiles pr
         where pr.is_admin_master and coalesce(pr.is_active, true);
        insert into public.signature_outbox (kind, to_email, to_name, subject, body_text)
        select 'plan_alert', pr.email, pr.full_name,
          case when v_threshold >= 100 then 'riSZon — limite da ZapSign atingido em ' || v_month
               else 'riSZon — ' || v_threshold || '% do plano da ZapSign usado em ' || v_month end,
          'Olá!' || chr(10) || chr(10)
            || 'O riSZon já usou ' || v_used || ' de ' || v_settings.zapsign_monthly_limit
            || ' documentos do plano da ZapSign em ' || v_month || '.' || chr(10) || chr(10)
            || case when v_threshold >= 100 then 'O limite do mês foi atingido: novos envios podem ser recusados pela ZapSign ou cobrados à parte.'
                    else 'Vale acompanhar para não passar do limite.' end
            || chr(10) || chr(10) || 'O limite fica em Assinaturas → Configurações.'
          from public.profiles pr
         where pr.is_admin_master and coalesce(pr.is_active, true)
           and pr.email is not null and btrim(pr.email) <> '';
        v_alerts := v_alerts + 1;
      end if;
    end loop;
  end if;

  v_stats := jsonb_build_object('expired', v_expired, 'reminded', v_reminded, 'plan_alerts', v_alerts,
                                'month_used', v_used, 'month_limit', v_settings.zapsign_monthly_limit);
  insert into public.signature_job_runs (job, stats) values ('daily', v_stats);
  return v_stats;
exception when others then
  -- A rotina não pode morrer calada: o erro vai para o rastro e para o log.
  raise warning 'signature_daily_run: %', sqlerrm;
  insert into public.signature_job_runs (job, stats, error) values ('daily', '{}'::jsonb, left(sqlerrm, 500));
  return jsonb_build_object('error', sqlerrm);
end;
$$;

revoke execute on function public.signature_daily_run() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3) O agendamento (pg_cron): todo dia às 08:10 UTC = 05:10 em Brasília
-- -----------------------------------------------------------------------------
do $$
begin
  perform cron.schedule(
    'risarte-signatures-daily', '10 8 * * *',
    'select public.signature_daily_run()'
  );
exception when others then null;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4) AUDITORIA (0288): a tabela nova está declarada fora, acima
-- -----------------------------------------------------------------------------
select public.audit_attach_all();

-- -----------------------------------------------------------------------------
-- Conferência (só contagens, nenhum dado pessoal)
-- -----------------------------------------------------------------------------
select
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('signature_daily_run', 'signature_log_job_run')) as funcoes,
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'signature_job_runs') as tabela_rastro,
  has_function_privilege('authenticated', 'public.signature_daily_run()', 'execute') as rotina_por_logado,
  (select count(*) from cron.job where jobname = 'risarte-signatures-daily') as agendada;

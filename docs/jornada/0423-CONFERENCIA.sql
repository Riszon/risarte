-- CONFERÊNCIA DA 0423 (o abandono de tratamento e a lista) — SÓ LEITURA.
-- Rodar no SQL Editor DEPOIS da migração. O esperado está no nome de cada coluna.
select
  (select count(*) from information_schema.tables where table_schema = 'public'
     and table_name in ('treatment_abandonments', 'treatment_abandonment_attempts'))  as tabelas_2,
  (select count(*) from public.inactivity_settings where clinic_id is null
     and setting_key in ('abandon_no_schedule_days', 'stalled_treatment_days'))       as prazos_2,
  (select count(*) from pg_trigger where not tgisinternal and tgname in
     ('treatment_abandonment_on_appointment', 'treatment_abandonment_on_cancellation')) as gatilhos_2,
  (select count(*) from cron.job where jobname = 'risarte-abandono-daily')             as rotina_1,
  (select bool_or(has_function_privilege('anon', p.oid, 'execute')) from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('register_abandonment_attempt', 'register_treatment_abandonment',
                         'decide_treatment_abandonment', 'start_treatment_abandonment',
                         'clients_without_next_step', 'treatment_abandonment_scan'))  as anon_false,
  has_function_privilege('authenticated', 'public.treatment_abandonment_scan(uuid)', 'execute') as varredura_fechada_false,
  has_table_privilege('authenticated', 'public.treatment_abandonments', 'update')      as gravar_direto_false;

-- CONFERÊNCIA DA 0427 (prazos e indicadores do fim do tratamento) — SÓ LEITURA.
-- Rodar no SQL Editor DEPOIS da migração. O esperado está no nome de cada coluna.
select
  (select count(*) from public.inactivity_settings
     where clinic_id is null and setting_key = 'stalled_task_business_days')            as prazo_1,
  (select count(*) from cron.job where jobname = 'risarte-fim-lembretes-daily')         as rotina_1,
  (select count(*) from information_schema.columns where table_schema = 'public'
     and column_name = 'reminded_at'
     and table_name in ('treatment_closures', 'treatment_abandonments'))                as colunas_2,
  (select count(*) from public._goal_indicator_meta('redo_rate'))
    + (select count(*) from public._goal_indicator_meta('client_satisfaction'))
    + (select count(*) from public._goal_indicator_meta('closure_decided_on_time'))
    + (select count(*) from public._goal_indicator_meta('clients_without_next_step'))   as indicadores_4,
  public.clinic_business_days_between(
    (select id from public.clinics order by created_at limit 1),
    date '2026-12-24', date '2026-12-28')                                               as natal_1,
  (select bool_or(has_function_privilege('anon', p.oid, 'execute')) from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('my_end_of_treatment_summary', 'clients_without_next_step',
                         'end_of_treatment_reminders', '_sem_proximo_passo',
                         'clinic_business_days_between', '_dia_util_da_unidade'))     as anon_false;

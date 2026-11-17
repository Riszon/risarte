-- CONFERÊNCIA DA 0418 (fim do tratamento) — SÓ LEITURA.
-- Rodar no SQL Editor DEPOIS da migração. O esperado está ao lado de cada coluna.
select
  (select count(*) from information_schema.tables
    where table_schema = 'public'
      and table_name in ('treatment_closures', 'treatment_closure_contacts'))            as tabelas_2,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      '_tratamento_em_aberto', '_abrir_fechamento', '_fechamento_reavaliar',
      '_fechamento_avisar', '_jornada_mover_por_evento', 'answer_treatment_closure',
      'register_closure_contact', 'treatment_closure_on_session',
      'treatment_closure_on_ortho', 'treatment_closure_on_appointment',
      'treatment_closure_on_phase', 'procedures_reevaluation_guard'))              as funcoes_12,
  (select count(*) from pg_trigger where tgname in (
      'treatment_closure_on_session', 'treatment_closure_on_ortho',
      'treatment_closure_on_appointment', 'treatment_closure_on_phase',
      'procedures_reevaluation_guard'))                                             as gatilhos_5,
  (select count(*) from pg_trigger where tgname = 'clients_treatment_finished')       as gatilho_antigo_0,
  (select count(*) from information_schema.columns
    where table_name = 'procedures' and column_name = 'requires_reevaluation')       as coluna_1,
  pg_get_functiondef('public.check_in_appointment(uuid)'::regprocedure)
     not like '%v_type in (''urgency'', ''emergency'') then%'             as urgencia_saiu_true,
  has_function_privilege('anon', 'public.answer_treatment_closure(uuid,text)', 'execute') as sem_login_false,
  (select count(*) from public.treatment_closures)                                  as fechamentos_0;

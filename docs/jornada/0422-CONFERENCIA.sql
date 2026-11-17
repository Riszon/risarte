-- CONFERÊNCIA DA 0422 (uma decisão por cliente; relato OC-00185) — SÓ LEITURA.
-- Rodar no SQL Editor DEPOIS da migração. O esperado está no nome de cada coluna.
select
  (select count(*) from information_schema.columns where table_schema = 'public'
     and table_name = 'treatment_closures'
     and column_name in ('grouped_into', 'dentist_notes', 'linked_appointment_id',
                         'wait_choice', 'sooner_requested_at', 'sooner_requested_by'))
                                                                                    as colunas_6,
  (select count(*) from (
     select client_id from public.treatment_closures
      where grouped_into is null and status in ('pergunta', 'coordenador', 'reavaliacao', 'contato')
      group by client_id having count(*) > 1) x)                                    as clientes_com_duas_decisoes_0,
  (select count(*) from pg_indexes
    where schemaname = 'public' and indexname = 'treatment_closures_one_decision') as indice_1,
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace
     and proname = 'answer_treatment_closure')                                      as uma_resposta_1,
  to_regprocedure('public.answer_treatment_closure(uuid,text,text,text)') is not null as resposta_nova_true,
  (select count(*) from pg_trigger where tgname in
     ('treatment_closure_sync_group', 'treatment_closure_on_direct_sale',
      'treatment_closure_contacts_guard') and not tgisinternal)                     as gatilhos_3,
  (select bool_or(has_function_privilege('anon', p.oid, 'execute')) from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('answer_treatment_closure', 'request_sooner_reevaluation',
                         'closure_coordinator_slot'))                               as anon_false,
  (select bool_and(has_function_privilege('authenticated', p.oid, 'execute')) from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('answer_treatment_closure', 'request_sooner_reevaluation',
                         'closure_coordinator_slot'))                               as logados_true,
  (select bool_or(has_function_privilege('authenticated', p.oid, 'execute')) from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('_horario_com_coordenador', '_fechamento_do_plano',
                         '_fechamento_reavaliar'))                                  as internas_false;

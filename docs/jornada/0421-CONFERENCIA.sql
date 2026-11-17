-- CONFERÊNCIA DA 0421 (o controle de qualidade em cinco níveis) — SÓ LEITURA.
-- Rodar no SQL Editor DEPOIS da migração. O esperado está no nome de cada coluna.
select
  (select count(*) from information_schema.columns where table_schema = 'public'
     and ((table_name = 'plan_quality_reviews' and column_name = 'level')
       or (table_name = 'treatment_closures' and column_name in ('quality_level', 'quality_note'))
       or (table_name = 'treatment_closure_contacts' and column_name in ('satisfaction', 'has_complaint'))))
                                                                                    as colunas_5,
  (select count(*) from public.plan_quality_reviews where level is null)            as niveis_vazios_0,
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace
     and proname = 'set_plan_item_quality')                                         as uma_set_quality_1,
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace
     and proname = 'register_closure_contact')                                      as um_contato_1,
  to_regprocedure('public.register_closure_quality(uuid,text,text)') is not null    as reavaliacao_true,
  to_regprocedure('public.conclude_reevaluation(uuid,date)') is not null            as saida_true,
  (select bool_or(has_function_privilege('anon', p.oid, 'execute')) from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('set_plan_item_quality', 'register_closure_quality',
                         'register_closure_contact', 'conclude_reevaluation'))     as anon_false,
  (select bool_and(has_function_privilege('authenticated', p.oid, 'execute')) from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('set_plan_item_quality', 'register_closure_quality',
                         'register_closure_contact', 'conclude_reevaluation'))     as logados_true;

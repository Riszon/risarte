-- CONFERÊNCIA DA 0426 (o cancelamento pelo caminho do fim) — SÓ LEITURA.
-- Rodar no SQL Editor DEPOIS da migração. O esperado está no nome de cada coluna.
select
  (select count(*) from information_schema.columns where table_schema = 'public'
     and ((table_name = 'plan_cancellations' and column_name in
           ('risks_required', 'risks_informed', 'risks_channel', 'risks_informed_on',
            'risks_registered_by', 'risks_registered_at'))
       or (table_name = 'treatment_closures' and column_name = 'cancellation_id')))      as colunas_7,
  (select count(*) from pg_trigger where not tgisinternal and tgname in
     ('plan_cancellation_risks_on_open', 'plan_cancellation_end_guard', 'plan_cancellation_end_apply')) as gatilhos_3,
  position('cancelamento' in (select pg_get_constraintdef(oid) from pg_constraint
     where conname = 'treatment_closures_scope_check')) > 0                              as escopo_true,
  (select bool_or(has_function_privilege('anon', p.oid, 'execute')) from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('register_cancellation_risks', 'prepare_cancellation_apply',
                         'cancellation_end_info', '_tratamento_em_aberto_fora'))          as anon_false,
  has_function_privilege('authenticated', 'public._tratamento_em_aberto_fora(uuid,uuid)', 'execute') as interna_false,
  (select count(*) from public.plan_cancellations
     where status in ('rascunho', 'assinado'))                                            as termos_abertos;

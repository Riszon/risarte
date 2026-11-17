-- CONFERÊNCIA DA 0420 (a instalação ortodôntica não termina o plano) — SÓ LEITURA.
-- Rodar no SQL Editor DEPOIS da migração. O esperado está no nome de cada coluna.
select
  position('_sessao_ortodontica' in
    pg_get_functiondef('public.treatment_closure_on_session()'::regprocedure)) > 0 as filtro_no_gatilho_true,
  to_regprocedure('public._sessao_ortodontica(uuid)') is not null                  as interna_true,
  has_function_privilege('authenticated', 'public._sessao_ortodontica(uuid)', 'execute') as fechada_false;

-- DESFAZER a 4021a (só se precisar). Roda inteiro, de uma vez, no SQL Editor.
-- A 4021a só CRIA (nenhuma função anterior é redefinida). Desfazer = tirar as funções
-- da Conferência das taxas. As tabelas reconciliation_issues e reconciliation_runs
-- FICAM (com o que a rotina tiver gravado): não apaga dado.
-- Rode ANTES do desfazer da 4021, se for desfazer as duas.

drop function if exists public._franchise_fixed_expected(uuid, text, date);
drop function if exists public._franchise_month_lines(uuid, date);
drop function if exists public._franchise_month_invoiced(uuid, date);
drop function if exists public._franchise_month_account(uuid, date);
drop function if exists public._franchise_reconcile_found(uuid);
drop function if exists public._franchise_ledger_found(uuid);
drop function if exists public._franchise_reconcile_run();
drop function if exists public.franchise_reconciliation_run_now();
drop function if exists public.franchise_reconciliation_ignore(uuid, text);
drop function if exists public.franchise_reconciliation_read(date, uuid);

notify pgrst, 'reload schema';

select (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
         and p.proname in ('_franchise_reconcile_run', 'franchise_reconciliation_read', '_franchise_ledger_found')) as funcoes_restantes;

-- =============================================================================
-- 0186 — FIN0: escopo da UNIDADE no Financeiro (correções do teste)
-- -----------------------------------------------------------------------------
-- Feedback do dono (31/07/2026), testando como Gerente de Unidade:
--
--   1. Centro de custo NÃO se configura na unidade. A árvore é da REDE: quem
--      cria/edita é a Franqueadora (Admin Master ou Financeiro). A unidade
--      apenas CONSULTA e tira relatório. A 0185 deixava o Gerente criar centro
--      da própria unidade — fechado aqui, na RLS (a tela também esconde).
--
--   2. "Risarte Empresarial — adesão e mensalidade" (1.2.02) estava marcada
--      como receita da UNIDADE; é receita da FRANQUEADORA. Corrigido no seed.
--
-- O "onde vale" (scope) das contas passou a ser editável na tela pelo
-- Financeiro/Admin — a coluna já existia, faltava permitir o ajuste.
-- Idempotente.
-- =============================================================================

-- 1) Centro de custo: escrita só da Franqueadora ------------------------------
drop policy if exists "cost_centers_write" on public.cost_centers;
create policy "cost_centers_write" on public.cost_centers
  for all to authenticated
  using (public.is_admin_master() or public.is_finance_franchisor())
  with check (public.is_admin_master() or public.is_finance_franchisor());

comment on table public.cost_centers is
  'Centros de custo por ÁREA, definidos pela FRANQUEADORA para toda a rede. '
  'A unidade consulta e tira relatório, não configura (decisão do dono, 31/07/2026).';

-- 2) Correção do escopo da receita do Risarte Empresarial ---------------------
update public.chart_of_accounts
   set scope = 'franchisor', updated_at = now()
 where code = '1.2.02' and scope is distinct from 'franchisor';

-- O grupo 1.2 passa a ser misto: PPR+ é da unidade, Empresarial da matriz.
update public.chart_of_accounts
   set scope = 'both', updated_at = now()
 where code = '1.2' and scope is distinct from 'both';

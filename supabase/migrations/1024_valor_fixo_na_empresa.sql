-- =============================================================================
-- 1024 — O ACORDO DE VALOR FIXO PASSA A EXISTIR NA EMPRESA (AP18)
-- -----------------------------------------------------------------------------
-- A proposta deixa combinar "valor fixo por empresa" (ex.: R$ 5.000 por mês
-- para até 100 pessoas). Mas o fechamento copiava para a empresa só o PREÇO
-- POR TITULAR: a base do acordo e o valor fixo ficavam para trás, na proposta.
-- Resultado: a mensalidade seria cobrada POR TITULAR, e o termo de inclusão
-- calcularia a diferença a partir de titulares × preço — não do fixo.
--
-- Regras do dono (27/09/2026):
--   * no valor fixo, a mensalidade É o valor fixo (+ o que os termos de
--     inclusão aceitos acrescentaram);
--   * no termo "novo valor fixo", a empresa paga a mais: novo fixo − fixo atual;
--   * a implantação é SEMPRE o primeiro pagamento (no valor fixo, um mês do
--     fixo; depois, a diferença que cada termo acrescentou).
--
-- ⚠️ O VALOR GUARDADO É O DA PROPOSTA JÁ COM A FAIXA APLICADA — o número que a
-- empresa leu e aceitou, congelado no fechamento. A faixa não é recalculada
-- depois: mudar o tamanho da empresa é assunto do termo de inclusão.
--
-- Produção em 27/09/2026: 1 empresa, cadastrada direto (sem funil), 0
-- propostas de valor fixo — nada a acertar. A conversão abaixo cobre o treino.
--
-- Idempotente. Não apaga nada.
-- =============================================================================

alter table empresarial.companies
  add column if not exists billing_basis text not null default 'PER_EMPLOYEE';

alter table empresarial.companies
  drop constraint if exists companies_billing_basis_check;
alter table empresarial.companies
  add constraint companies_billing_basis_check
  check (billing_basis in ('PER_EMPLOYEE', 'FIXED_PER_COMPANY'));

alter table empresarial.companies
  add column if not exists fixed_monthly_cents bigint;

alter table empresarial.companies
  drop constraint if exists companies_fixed_monthly_cents_check;
alter table empresarial.companies
  add constraint companies_fixed_monthly_cents_check
  check (fixed_monthly_cents is null or fixed_monthly_cents >= 0);

comment on column empresarial.companies.billing_basis is
  'Como a mensalidade é cobrada: por titular, ou valor fixo pela empresa. Vem da proposta no fechamento (1024).';
comment on column empresarial.companies.fixed_monthly_cents is
  'Valor fixo mensal combinado na proposta, JÁ COM A FAIXA aplicada — congelado no fechamento (1024). Só vale com billing_basis = FIXED_PER_COMPANY.';

-- Empresas já fechadas pelo funil com proposta de valor fixo: traz a base e o
-- valor. A faixa (se houver) é aplicada aqui do mesmo jeito que a proposta:
-- a faixa de MAIOR quantidade mínima que ainda cabe no número de titulares.
update empresarial.companies c
   set billing_basis = 'FIXED_PER_COMPANY',
       fixed_monthly_cents = coalesce(
         (select t.price_cents
            from empresarial.lead_price_tiers t
           where t.lead_id = q.lead_id
             and t.min_quantity <= coalesce(q.employee_count, 0)
           order by t.min_quantity desc
           limit 1),
         q.fixed_monthly_cents
       )
  from empresarial.lead_qualification q
 where q.lead_id = c.origin_lead_id
   and q.billing_basis = 'FIXED_PER_COMPANY'
   and q.fixed_monthly_cents is not null
   and c.billing_basis = 'PER_EMPLOYEE'
   and c.fixed_monthly_cents is null;

-- Valor fixo SEM valor não é acordo: só depois da conversão acima.
alter table empresarial.companies
  drop constraint if exists companies_fixed_needs_value_check;
alter table empresarial.companies
  add constraint companies_fixed_needs_value_check
  check (billing_basis <> 'FIXED_PER_COMPANY' or fixed_monthly_cents is not null);

notify pgrst, 'reload schema';

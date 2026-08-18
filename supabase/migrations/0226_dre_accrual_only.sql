-- =============================================================================
-- 0226 — FIN6.1 (correção): a DRE volta a somar SÓ competência
-- -----------------------------------------------------------------------------
-- Conferência do razão contra os dados reais mostrou a receita bruta perto do
-- DOBRO do verdadeiro. Duas causas independentes, as duas corrigidas aqui.
--
-- CAUSA 1 — LIQUIDAÇÃO NÃO É FATO GERADOR.
-- O razão grava DUAS linhas para a mesma venda, de propósito (FIN0): uma na
-- competência (a parcela nasce → `installment_accrual`, sem `cash_date`) e
-- outra no caixa (o cliente pagou → `receipt_cash`, com `cash_date`). É essa
-- separação que permite DRE e fluxo de caixa lendo o mesmo razão. A 0225 somava
-- as duas: a parcela paga entrava como receita de novo, e a conta a pagar já
-- paga entrava como despesa de novo.
--
--   Nos dados de teste: R$ 4.416,00 de parcelas pagas (competência) mais
--   R$ 5.096,89 dos recebimentos DAS MESMAS parcelas; conta a pagar de
--   R$ 3.000,00 mais R$ 1.500,00 do pagamento dela.
--
-- A regra passa a ser: `receipt_cash` e `payable_cash` NUNCA entram na DRE —
-- são as duas únicas origens que só registram dinheiro trocando de mãos sobre
-- um fato JÁ reconhecido. Elas são, exatamente, o que o fluxo de caixa (FIN6.2)
-- vai ler. Continuam na DRE, e é proposital:
--   • `receipt_benefit`  — benefício PERDIDO por atraso: o cliente pagou mais
--     do que a parcela dizia. É receita a mais, não a mesma receita.
--   • `receipt_late_fee` / `payable_late_fee` — multa e juros nascem já pagos;
--     não existe accrual deles em lugar nenhum.
--   • `acquirer_fee`, `boleto_issue`, `bank_transaction` — idem: o lançamento
--     de caixa é o ÚNICO registro do fato. Excluí-los apagaria a despesa.
--
-- CAUSA 2 — VENDA CANCELADA CONTINUAVA COMO RECEITA.
-- Cancelar deixa a parcela como `cancelada`, mas nada mexia no lançamento de
-- competência dela — ele seguia `open` para sempre. As contas a pagar já faziam
-- certo desde a 0194 (`cancel_payable` cancela o lançamento); o recebimento
-- nunca fez. Eram 43 parcelas, R$ 10.941,00 de receita fantasma.
--
-- Por que é seguro cancelar o lançamento: os quatro fluxos de cancelamento
-- (0180, 0205, 0206, 0207) só cancelam parcelas `em_aberto` — nunca uma que
-- já recebeu dinheiro. O acerto de contas do cancelamento vira cobrança NOVA
-- (que gera a própria competência) ou devolução em 1.9.03 (dedução). Mesmo
-- assim o gatilho exige `paid_amount_cents = 0`: se um dia alguém cancelar uma
-- parcela já paga, a receita fica de pé — sumir com ela deixaria o dinheiro no
-- caixa sem origem no resultado.
--
-- RENEGOCIAÇÃO NÃO MUDA: a parcela vira `renegociada` (não `cancelada`) e
-- mantém o lançamento. A receita foi reconhecida na venda; recontá-la na
-- renegociação inflaria o faturamento — é a regra que a 0189 já travou.
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Cancelar a parcela cancela o lançamento de competência
-- -----------------------------------------------------------------------------
create or replace function public.sync_installment_accrual_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'cancelada' and coalesce(new.paid_amount_cents, 0) = 0 then
    update public.financial_entries
       set status = 'cancelled', updated_at = now()
     where source_type = 'installment_accrual'
       and source_id = new.id
       and status = 'open';

  -- Volta atrás: se a parcela sair de cancelada, a receita volta. Sem este
  -- lado, um cancelamento desfeito deixaria a venda fora da DRE para sempre.
  elsif new.status <> 'cancelada' then
    update public.financial_entries
       set status = 'open', updated_at = now()
     where source_type = 'installment_accrual'
       and source_id = new.id
       and status = 'cancelled';
  end if;
  return null;
end;
$$;

-- Só quando o status realmente muda: o gatilho de baixa reescreve a parcela a
-- cada recebimento, e não faz sentido rodar isto em todas as vezes.
drop trigger if exists payment_installments_accrual_sync on public.payment_installments;
create trigger payment_installments_accrual_sync
  after update on public.payment_installments
  for each row
  when (new.status is distinct from old.status)
  execute function public.sync_installment_accrual_status();

-- Nascer já cancelada não acontece hoje (os quatro fluxos inserem em aberto e
-- cancelam depois), mas gatilho de conclusão que só escuta UPDATE já custou
-- caro neste projeto uma vez — o do repasse, na venda direta.
drop trigger if exists payment_installments_accrual_sync_ins on public.payment_installments;
create trigger payment_installments_accrual_sync_ins
  after insert on public.payment_installments
  for each row
  when (new.status = 'cancelada')
  execute function public.sync_installment_accrual_status();

-- Acerto do que ficou para trás.
update public.financial_entries e
   set status = 'cancelled', updated_at = now()
  from public.payment_installments i
 where e.source_type = 'installment_accrual'
   and e.source_id = i.id
   and e.status = 'open'
   and i.status = 'cancelada'
   and coalesce(i.paid_amount_cents, 0) = 0;

-- -----------------------------------------------------------------------------
-- 2) A DRE ignora as liquidações
-- -----------------------------------------------------------------------------
create or replace function public.dre_lines(
  p_clinic_id uuid,
  p_from date,
  p_to date,
  p_cost_center_id uuid default null
)
returns table (
  account_code text,
  account_name text,
  block text,
  amount_cents bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    e.account_code,
    coalesce(max(a.name), e.account_code),
    case
      when e.account_code like '1.9%' then 'deducoes'
      when e.account_code like '1%'   then 'receita_bruta'
      when e.account_code like '2%'   then 'custos_diretos'
      when e.account_code like '3%'   then 'despesas_operacionais'
      when e.account_code like '4%'   then 'resultado_financeiro'
      when e.account_code like '5.2%' then 'depreciacao'
      else 'fora'
    end,
    -- O SINAL VEM DA DIREÇÃO: entrada soma, saída subtrai.
    sum(case when e.direction = 'inflow'
             then e.amount_cents else -e.amount_cents end)::bigint
  from public.financial_entries e
  left join public.chart_of_accounts a on a.code = e.account_code
  where e.clinic_id = p_clinic_id
    and e.accrual_date between p_from and p_to
    -- Competência: liquidado + em aberto. Previsto ainda não aconteceu.
    and e.status in ('settled', 'open')
    -- Estorno some dos dois lados (ver 0225).
    and e.reversal_of is null
    -- LIQUIDAÇÃO NÃO É COMPETÊNCIA (ver cabeçalho): o fato já foi lançado
    -- quando a parcela ou a conta nasceu. Estas duas origens são o caixa.
    and e.source_type not in ('receipt_cash', 'payable_cash')
    and (p_cost_center_id is null or e.cost_center_id = p_cost_center_id)
    and e.account_code not like '6%'
    and e.account_code not like '5.1%'
    and e.account_code not like '5.3%'
    and e.account_code not like '5.4%'
  group by e.account_code
  having sum(case when e.direction = 'inflow'
                  then e.amount_cents else -e.amount_cents end) <> 0
  order by e.account_code;
$$;

grant execute on function public.dre_lines(uuid, date, date, uuid)
  to authenticated;

-- O drill-down tem de mostrar EXATAMENTE o que somou. Se a linha abrisse
-- lançamentos que o total não contém, a conferência do dono nunca fecharia —
-- e é ela que descobre erro como este.
create or replace function public.dre_entries(
  p_clinic_id uuid,
  p_from date,
  p_to date,
  p_account_code text,
  p_cost_center_id uuid default null
)
returns table (
  entry_id uuid,
  accrual_date date,
  amount_cents bigint,
  direction text,
  status text,
  source_type text,
  source_id uuid,
  description text,
  cost_center_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    e.id, e.accrual_date,
    case when e.direction = 'inflow'
         then e.amount_cents else -e.amount_cents end,
    e.direction, e.status, e.source_type, e.source_id, e.description,
    c.name
  from public.financial_entries e
  left join public.cost_centers c on c.id = e.cost_center_id
  where e.clinic_id = p_clinic_id
    and e.accrual_date between p_from and p_to
    and e.account_code = p_account_code
    and e.status in ('settled', 'open')
    and e.reversal_of is null
    and e.source_type not in ('receipt_cash', 'payable_cash')
    and (p_cost_center_id is null or e.cost_center_id = p_cost_center_id)
  order by e.accrual_date desc, e.created_at desc
  limit 300;
$$;

grant execute on function public.dre_entries(uuid, date, date, text, uuid)
  to authenticated;

-- -----------------------------------------------------------------------------
-- Conferência (só contagens e valores — nenhum dado pessoal)
-- -----------------------------------------------------------------------------
select
  (select count(*) from public.financial_entries
    where source_type = 'installment_accrual' and status = 'cancelled')
    as receitas_de_parcela_cancelada_agora_fora,
  (select coalesce(sum(amount_cents), 0) / 100.0
     from public.financial_entries
    where source_type = 'installment_accrual' and status = 'cancelled')
    as reais_de_receita_fantasma_removidos,
  (select count(*) from public.financial_entries
    where source_type in ('receipt_cash', 'payable_cash')
      and status in ('settled', 'open') and reversal_of is null)
    as liquidacoes_que_saem_da_dre_e_entram_no_fluxo_de_caixa,
  (select coalesce(sum(case when direction = 'inflow'
                            then amount_cents else -amount_cents end), 0) / 100.0
     from public.financial_entries
    where status in ('settled', 'open') and reversal_of is null
      and source_type not in ('receipt_cash', 'payable_cash')
      and account_code like '1%' and account_code not like '1.9%')
    as receita_bruta_da_rede_agora;

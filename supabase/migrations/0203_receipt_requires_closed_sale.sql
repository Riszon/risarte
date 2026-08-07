-- =============================================================================
-- 0203 — SÓ RECEBE DEPOIS QUE A VENDA ESTÁ FECHADA
-- -----------------------------------------------------------------------------
-- Achado no teste do dono (06/08/2026). A negociação PT-00003 estava assim:
--
--   situação ................. em negociação (nunca foi aceita)
--   registro de fechamento ... NÃO EXISTE
--   cobranças ................ 11
--   baixas ................... 4  → R$ 869,00 JÁ RECEBIDOS
--
-- Ou seja: entrou dinheiro numa venda que nunca foi fechada. A regra de ouro do
-- projeto — "só é venda com documentos assinados E pagamento confirmado" —
-- estava escrita na documentação e na tela, mas **não estava protegida no
-- banco**: as cobranças nascem quando o plano de pagamento é salvo, ainda
-- durante a negociação, e a aba Financeiro aceitava baixa nelas.
--
-- Efeito colateral que o dono viu primeiro: a negociação ficava travada para
-- sempre (o `save_payment_schedule` recusa reescrever cobrança que já tem
-- recebimento — e nisso ele está certo), sem a tela explicar o porquê.
--
-- Decisão do dono (06/08/2026): **baixa só depois da venda fechada**.
--
-- A trava é um GATILHO, não uma alteração das funções de baixa: assim vale para
-- qualquer caminho — tela, RPC, correção manual, integração futura do ASAAS.
--
-- Três exceções, de propósito:
--   • ESTORNO (`reversal_of`) passa sempre — desfazer não pode ser bloqueado.
--   • Cobrança de RENEGOCIAÇÃO passa — a dívida já existia e já foi reconhecida;
--     exigir "fechamento" de uma renegociação não faz sentido.
--   • Cobrança sem venda de origem passa (não deveria existir, mas bloquear
--     algo órfão só esconderia o problema real).
--
-- NÃO invalida o que já foi recebido: o gatilho só vale para baixas NOVAS.
-- Idempotente.
-- =============================================================================

create or replace function public.enforce_sale_closed_before_receipt()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inst record;
  v_closed boolean;
begin
  -- Estorno nunca é bloqueado.
  if new.reversal_of is not null then return new; end if;

  select * into v_inst
  from public.payment_installments where id = new.installment_id;
  if v_inst.id is null then return new; end if;

  -- Dívida renegociada: já era devida antes: não há fechamento novo a exigir.
  if v_inst.renegotiation_id is not null then return new; end if;

  if v_inst.direct_sale_id is not null then
    select s.closed_at is not null into v_closed
    from public.direct_sales s where s.id = v_inst.direct_sale_id;
  elsif v_inst.negotiation_id is not null then
    select cs.closed_at is not null into v_closed
    from public.commercial_sales cs
    where cs.negotiation_id = v_inst.negotiation_id;
  else
    return new;
  end if;

  if not coalesce(v_closed, false) then
    raise exception 'SALE_NOT_CLOSED';
  end if;

  return new;
end;
$$;

comment on function public.enforce_sale_closed_before_receipt() is
  'REGRA DE OURO no banco: não se recebe por uma venda que ainda não foi '
  'fechada (contrato assinado + pagamento confirmado). Vale para qualquer '
  'caminho de baixa, não só para a tela.';

drop trigger if exists payment_receipts_require_closed_sale
  on public.payment_receipts;
create trigger payment_receipts_require_closed_sale
  before insert on public.payment_receipts
  for each row execute function public.enforce_sale_closed_before_receipt();

-- -----------------------------------------------------------------------------
-- Conferência: o que já existe fora da regra (dados antigos, não bloqueados)
-- -----------------------------------------------------------------------------
select
  (select count(*) from public.payment_receipts) as baixas_totais,
  (select count(*)
     from public.payment_receipts r
     join public.payment_installments i on i.id = r.installment_id
    where r.reversal_of is null
      and i.renegotiation_id is null
      and (
        (i.direct_sale_id is not null and not exists (
           select 1 from public.direct_sales s
           where s.id = i.direct_sale_id and s.closed_at is not null))
        or
        (i.negotiation_id is not null and not exists (
           select 1 from public.commercial_sales cs
           where cs.negotiation_id = i.negotiation_id and cs.closed_at is not null))
      )
  ) as baixas_em_venda_nao_fechada;

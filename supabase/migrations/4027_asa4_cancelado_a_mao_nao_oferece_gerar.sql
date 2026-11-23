-- =============================================================================
-- 4027 — ASAAS: PARCELAMENTO CANCELADO À MÃO NÃO OFERECE "GERAR" DE NOVO (OC-00183)
--
-- Relato (16/11/2026, treino, Admin Master): o parcelamento no cartão de uma
-- venda direta foi cancelado; o botão "Gerar parcelamento no Asaas" seguiu na
-- tela e o clique respondia "Esta parcela já tem uma cobrança ativa".
-- Reproduzido no treino (transação desfeita).
--
-- Causa: duas regras que se contradiziam. `_card_block_has_charge` (4017)
-- conta como bloqueio a cobrança cancelada À MÃO (`cancelled_by`) — de
-- propósito: a rotina automática não reemite o que alguém cancelou. Mas
-- `_card_block_summary` (4014) dizia `pode_gerar = true` sempre que todas as
-- cobranças estavam canceladas — e a tela oferecia o botão que o banco recusa.
--
-- Agora o resumo segue a mesma regra e devolve `cancelado_a_mao`, para a tela
-- explicar o caminho: "Trocar meio" em cada parcela. A regra do bloqueio não
-- muda. Só a função muda; mesma assinatura e mesmo retorno. Idempotente.
-- =============================================================================

create or replace function public._card_block_summary(p_negotiation_id uuid, p_direct_sale_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_n integer;
  v_total bigint;
  v_block uuid;
  v_clinic uuid;
  v jsonb;
begin
  select count(*), sum(i.amount_cents), min(i.clinic_id::text)::uuid into v_n, v_total, v_clinic
    from public._card_block_rows(p_negotiation_id, p_direct_sale_id) i;
  if coalesce(v_n, 0) = 0 then return null; end if;
  select c.installment_block into v_block
    from public.charges c
    join public._card_block_rows(p_negotiation_id, p_direct_sale_id) i on i.id = c.payment_installment_id
   where c.installment_block is not null
   order by (c.status = 'cancelada'), c.created_at desc limit 1;
  select jsonb_build_object(
    'block', v_block,
    'parcelas', v_n,
    'total', v_total,
    'situacao', case
       when v_block is null then 'sem_parcelamento'
       when bool_or(c.status = 'em_contestacao') then 'em_contestacao'
       when bool_or(c.refund_state is not null) then 'estorno_pedido'
       when bool_and(c.status = 'estornada') then 'estornado'
       when bool_and(c.status = 'cancelada') then 'cancelado'
       when bool_and(c.status in ('paga', 'liquidada')) then 'pago'
       when bool_or(c.status = 'erro_emissao') then 'erro'
       when bool_or(c.status = 'emitindo') then 'emitindo'
       when bool_or(c.status = 'vencida') then 'vencido'
       else 'aguardando' end,
    'link', (array_agg(c.invoice_url order by c.installment_number) filter (where c.invoice_url is not null))[1],
    'primeira', (array_agg(c.id order by c.installment_number))[1],
    'creditadas', count(*) filter (where c.status = 'liquidada'),
    -- 4027 (OC-00183): cancelado À MÃO não se reemite (é a regra de
    -- `_card_block_has_charge`, 4017) — o botão sumia só pela metade.
    'pode_gerar', v_block is null or (bool_and(c.status = 'cancelada')
                  and not bool_or(c.status = 'cancelada' and c.cancelled_by is not null)),
    'cancelado_a_mao', v_block is not null and bool_and(c.status = 'cancelada')
                       and bool_or(c.cancelled_by is not null),
    'pode_tentar_de_novo', v_block is not null and bool_or(c.status = 'erro_emissao')
                           and bool_and(c.status in ('erro_emissao', 'emitindo', 'emitida')),
    'pode_cancelar', v_block is not null and bool_and(c.status in ('emitindo', 'emitida', 'vencida', 'erro_emissao')),
    'pode_estornar', v_block is not null and bool_and(c.status in ('paga', 'liquidada')) and bool_and(c.refund_state is null),
    'gerar_permitido', public._charge_can('emit', v_clinic),
    'cancelar_permitido', public._charge_can('cancel', v_clinic),
    'estornar_permitido', public._charge_refund_can(v_clinic),
    -- 4014: a contestação (com o prazo) e a devolução por Pix.
    'clinic', v_clinic,
    'contestacao_prazo', min(c.chargeback_deadline),
    'pago_cents', coalesce(sum(c.paid_cents) filter (where c.status in ('paga', 'liquidada')), 0),
    'pode_pedir_devolucao', v_block is not null and bool_and(c.status in ('paga', 'liquidada')) and bool_and(c.refund_state is null)
                            and public._card_block_return_can_request(v_clinic),
    'pode_decidir_devolucao', public.is_admin_master() or public.is_finance_franchisor(),
    'devolucoes', (select coalesce(jsonb_agg(jsonb_build_object(
                     'id', r.id, 'valor', r.amount_cents, 'motivo', r.reason, 'situacao', r.status,
                     'termo', r.term_path, 'termo_nome', r.term_name, 'pedida_em', r.requested_at,
                     'quem_pediu', (select full_name from public.profiles where id = r.requested_by),
                     'decidida_em', r.decided_at, 'nota', r.decision_note, 'conta_a_pagar', r.payable_id)
                     order by r.requested_at), '[]'::jsonb)
                     from public.card_block_returns r where r.installment_block = v_block))
    into v
    from (select 1) x
    left join public.charges c on c.installment_block = v_block;
  return v;
end;
$$;
revoke execute on function public._card_block_summary(uuid, uuid) from public, anon, authenticated;

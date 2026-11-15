-- =============================================================================
-- 4015a — CORREÇÃO: venda com parcelas num acordo em aberto não é cancelada
-- (19.28.11, decisão A(a) do Jeferson, 15/11/2026). Sobe ANTES da 4017.
-- =============================================================================
-- A FALHA (já existe na produção): o cancelamento do plano (0360) só cancela as
-- parcelas "em aberto" da própria venda e só conta o dinheiro pago nelas. As
-- parcelas da renegociação que vieram dessa venda ficam em aberto e continuam
-- cobradas, e o acerto ignora o que o cliente pagou nelas: cobrança em dobro.
--
-- A CORREÇÃO: recusar o cancelamento enquanto a venda tiver parcelas num acordo
-- com parcela nova em aberto (seguindo a cadeia: acordo de acordo), ou numa
-- renegociação esperando a autorização do Gerente. A solução completa fica para
-- o distrato (4020).
--
-- Onde recusa (gatilhos, para valer por qualquer caminho):
--   1. ao abrir o termo de cancelamento do plano (plan_cancellations, insert);
--   2. ao efetivar (commercial_sales.cancelled_at deixa de ser nulo) — pega o
--      termo aberto antes desta correção;
--   3. ao cancelar a venda direta (direct_sales.cancelled vira true).
-- Erro: 'RENEGOTIATED_OPEN: RN-…, RN-…' (os códigos dos acordos).
--
-- A porta de exceção (19.28.12, ainda sem construir) liga
-- `set local risarte.cancelar_com_acordo = '1'` dentro da função autorizada.
--
-- DESFAZER (se precisar):
--   drop trigger if exists plan_cancellations_open_agreement on public.plan_cancellations;
--   drop trigger if exists commercial_sales_open_agreement on public.commercial_sales;
--   drop trigger if exists direct_sales_open_agreement on public.direct_sales;
--   drop function if exists public._open_agreement_guard();
--   drop function if exists public._sale_open_agreements(uuid, uuid);
-- Nada é apagado nem alterado nos dados: só passa a recusar.
-- =============================================================================

create or replace function public._sale_open_agreements(p_negotiation_id uuid, p_direct_sale_id uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  with recursive cadeia(reneg_id) as (
    -- os acordos que receberam parcelas desta venda
    select distinct i.renegotiated_by_id
      from public.payment_installments i
     where i.status = 'renegociada' and i.renegotiated_by_id is not null
       and ((p_negotiation_id is not null and i.negotiation_id = p_negotiation_id)
         or (p_direct_sale_id is not null and i.direct_sale_id = p_direct_sale_id))
    union
    -- e os acordos que renegociaram as parcelas desses acordos
    select j.renegotiated_by_id
      from public.payment_installments j
      join cadeia c on j.renegotiation_id = c.reneg_id
     where j.status = 'renegociada' and j.renegotiated_by_id is not null
  ),
  abertos as (
    select r.id, coalesce(r.code, left(r.id::text, 8)) as rotulo
      from cadeia c
      join public.payment_renegotiations r on r.id = c.reneg_id
     where exists (select 1 from public.payment_installments k
                    where k.renegotiation_id = r.id and k.status in ('em_aberto', 'parcial'))
    union
    -- a renegociação esperando a autorização, com parcela desta venda
    select r.id, coalesce(r.code, left(r.id::text, 8))
      from public.payment_renegotiations r
     where r.status = 'aguardando_autorizacao'
       and exists (select 1 from public.payment_installments i
                    where i.id = any(r.source_installment_ids)
                      and ((p_negotiation_id is not null and i.negotiation_id = p_negotiation_id)
                        or (p_direct_sale_id is not null and i.direct_sale_id = p_direct_sale_id)))
  )
  select coalesce(array_agg(distinct a.rotulo), '{}'::text[]) from abertos a;
$$;
revoke execute on function public._sale_open_agreements(uuid, uuid) from public, anon, authenticated;

create or replace function public._open_agreement_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_codes text[];
begin
  if coalesce(current_setting('risarte.cancelar_com_acordo', true), '') = '1' then
    return new;
  end if;
  if tg_table_name = 'plan_cancellations' then
    v_codes := public._sale_open_agreements(new.negotiation_id, null);
  elsif tg_table_name = 'commercial_sales' then
    if old.cancelled_at is not null or new.cancelled_at is null then return new; end if;
    v_codes := public._sale_open_agreements(new.negotiation_id, null);
  elsif tg_table_name = 'direct_sales' then
    if coalesce(old.cancelled, false) or not coalesce(new.cancelled, false) then return new; end if;
    v_codes := public._sale_open_agreements(null, new.id);
  end if;
  if array_length(v_codes, 1) is not null then
    raise exception 'RENEGOTIATED_OPEN: %', array_to_string(v_codes, ', ');
  end if;
  return new;
end;
$$;
revoke execute on function public._open_agreement_guard() from public, anon, authenticated;

drop trigger if exists plan_cancellations_open_agreement on public.plan_cancellations;
create trigger plan_cancellations_open_agreement
  before insert on public.plan_cancellations
  for each row execute function public._open_agreement_guard();

drop trigger if exists commercial_sales_open_agreement on public.commercial_sales;
create trigger commercial_sales_open_agreement
  before update of cancelled_at on public.commercial_sales
  for each row execute function public._open_agreement_guard();

drop trigger if exists direct_sales_open_agreement on public.direct_sales;
create trigger direct_sales_open_agreement
  before update of cancelled on public.direct_sales
  for each row execute function public._open_agreement_guard();

notify pgrst, 'reload schema';

-- CONFERÊNCIA: as 2 funções e os 3 gatilhos; e quantas vendas hoje teriam o
-- cancelamento recusado (só leitura).
select
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('_sale_open_agreements', '_open_agreement_guard')) as funcoes_novas,
  (select count(*) from pg_trigger
    where tgname in ('plan_cancellations_open_agreement', 'commercial_sales_open_agreement', 'direct_sales_open_agreement')) as gatilhos_novos,
  (select count(*) from public.commercial_sales cs
    where cs.cancelled_at is null
      and array_length(public._sale_open_agreements(cs.negotiation_id, null), 1) is not null) as planos_que_ficariam_travados,
  (select count(*) from public.plan_cancellations pc
    where pc.status in ('rascunho', 'assinado')
      and array_length(public._sale_open_agreements(pc.negotiation_id, null), 1) is not null) as termos_abertos_travados;

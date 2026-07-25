-- =============================================================================
-- Risarte Odontologia — Migration 0161 (Dashboard: consolidar comercial + direta)
--
-- O dashboard passa a mostrar "Cancelados" juntando o funil comercial com as
-- vendas diretas canceladas. Para a lista mostrar DATA e QUEM cancelou (igual
-- ao cartão do funil), a venda direta precisa gravar esses dois dados.
-- Idempotente.
-- =============================================================================

alter table public.direct_sales
  add column if not exists cancelled_at timestamptz;
alter table public.direct_sales
  add column if not exists cancelled_by uuid references public.profiles (id);

comment on column public.direct_sales.cancelled_at is
  'Quando a venda direta foi cancelada (usado no dashboard comercial).';
comment on column public.direct_sales.cancelled_by is
  'Quem cancelou a venda direta (usado no dashboard comercial).';

-- Vendas já canceladas antes desta migração: usa a última atualização como data.
update public.direct_sales
set cancelled_at = updated_at
where cancelled = true and cancelled_at is null;

create index if not exists direct_sales_cancelled_idx
  on public.direct_sales (clinic_id, cancelled_at)
  where cancelled = true;

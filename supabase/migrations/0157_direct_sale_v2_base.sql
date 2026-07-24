-- =============================================================================
-- Risarte Odontologia — Migration 0157 (Venda Direta v2 — VD1: base + config)
-- Spec completa em docs/COMERCIAL.md §7 (passada pelo dono em 23/07/2026).
--
-- 1) Procedimentos: além de "autorizado para venda direta" (0156), define QUEM
--    pode lançar — Recepção e/ou SDR. (Gerente e Coordenador lançam todos os
--    autorizados; a matriz completa está em §7.4.)
-- 2) Venda direta v2: a venda passa a ter VÁRIOS procedimentos (direct_sale_items),
--    vínculo OBRIGATÓRIO com um atendimento (appointment_id), marca de EXCEÇÃO
--    quando o atendimento foi feito ANTES da venda, e fechamento em DOIS passos
--    (cobrança emitida → pagamento confirmado) + contrato assinado.
--    As colunas antigas (item único do COM5 v1) ficam como legado.
-- Idempotente.
-- =============================================================================

-- 1) Quem pode lançar cada procedimento na venda direta ------------------------
alter table public.procedures
  add column if not exists direct_sale_reception boolean not null default false;
alter table public.procedures
  add column if not exists direct_sale_sdr boolean not null default false;

comment on column public.procedures.direct_sale is
  'Autorizado para venda direta na unidade (§7.3).';
comment on column public.procedures.direct_sale_reception is
  'A Recepcionista pode lançar este procedimento na venda direta.';
comment on column public.procedures.direct_sale_sdr is
  'A SDR pode lançar este procedimento na venda direta.';

-- 2) Venda direta v2 -----------------------------------------------------------
-- Cabeçalho da venda (as colunas do COM5 v1 viram legado e ficam nulas).
alter table public.direct_sales
  add column if not exists appointment_id uuid references public.appointments (id);
alter table public.direct_sales
  add column if not exists attendance_done_before boolean not null default false;
alter table public.direct_sales
  add column if not exists subtotal_cents integer not null default 0;
alter table public.direct_sales
  add column if not exists discount_cents integer not null default 0;
alter table public.direct_sales
  add column if not exists surcharge_cents integer not null default 0;
alter table public.direct_sales
  add column if not exists final_cents integer not null default 0;
alter table public.direct_sales
  add column if not exists installments integer not null default 1;
alter table public.direct_sales
  add column if not exists contract_signed boolean not null default false;
alter table public.direct_sales
  add column if not exists contract_signed_at timestamptz;
alter table public.direct_sales
  add column if not exists contract_signed_by uuid references public.profiles (id);
alter table public.direct_sales
  add column if not exists payment_issued boolean not null default false;
alter table public.direct_sales
  add column if not exists payment_issued_at timestamptz;
alter table public.direct_sales
  add column if not exists payment_issued_by uuid references public.profiles (id);
alter table public.direct_sales
  add column if not exists payment_confirmed boolean not null default false;
alter table public.direct_sales
  add column if not exists payment_confirmed_at timestamptz;
alter table public.direct_sales
  add column if not exists payment_confirmed_by uuid references public.profiles (id);
alter table public.direct_sales
  add column if not exists closed_at timestamptz;
alter table public.direct_sales
  add column if not exists status text not null default 'aguardando_fechamento';

do $$
begin
  alter table public.direct_sales
    add constraint direct_sales_status_check
    check (status in ('aguardando_fechamento','concluida','cancelada'));
exception when duplicate_object then null;
end $$;

-- A descrição do COM5 v1 era obrigatória; na v2 quem descreve são os itens.
alter table public.direct_sales alter column description drop not null;

create index if not exists direct_sales_appointment_idx
  on public.direct_sales (appointment_id);
create index if not exists direct_sales_status_idx
  on public.direct_sales (clinic_id, status);

-- Itens da venda (um por procedimento lançado).
create table if not exists public.direct_sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.direct_sales (id) on delete cascade,
  clinic_id uuid not null references public.clinics (id),
  procedure_id uuid references public.procedures (id),
  description text not null,
  quantity integer not null default 1 check (quantity >= 1),
  -- Preço "normal" (tabela) e o desconto do programa (Empresarial/riso+).
  unit_price_cents integer not null default 0,
  program_discount_cents integer not null default 0,
  final_cents integer not null default 0,
  -- Sessão criada no prontuário (procedimento EM ABERTO) — VD2.
  session_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists direct_sale_items_sale_idx
  on public.direct_sale_items (sale_id);

alter table public.direct_sale_items enable row level security;

-- Itens seguem a visibilidade/escrita da venda-mãe.
drop policy if exists "direct_sale_items_select" on public.direct_sale_items;
create policy "direct_sale_items_select" on public.direct_sale_items
  for select to authenticated
  using (exists (select 1 from public.direct_sales s where s.id = sale_id));

drop policy if exists "direct_sale_items_write" on public.direct_sale_items;
create policy "direct_sale_items_write" on public.direct_sale_items
  for all to authenticated
  using (
    exists (
      select 1 from public.direct_sales s
      where s.id = sale_id
        and (
          public.is_admin_master()
          or public.has_role_in_clinic(s.clinic_id,
               array['receptionist','sdr','clinical_coordinator','unit_manager']::public.user_role[])
        )
    )
  )
  with check (
    exists (
      select 1 from public.direct_sales s
      where s.id = sale_id
        and (
          public.is_admin_master()
          or public.has_role_in_clinic(s.clinic_id,
               array['receptionist','sdr','clinical_coordinator','unit_manager']::public.user_role[])
        )
    )
  );

-- A SDR também lança venda direta (cobra a consulta antes de o cliente vir).
drop policy if exists "direct_sales_write" on public.direct_sales;
create policy "direct_sales_write" on public.direct_sales
  for all to authenticated
  using (
    public.is_admin_master()
    or public.has_role_in_clinic(clinic_id,
         array['receptionist','sdr','clinical_coordinator','unit_manager']::public.user_role[])
  )
  with check (
    public.is_admin_master()
    or public.has_role_in_clinic(clinic_id,
         array['receptionist','sdr','clinical_coordinator','unit_manager']::public.user_role[])
  );

-- A SDR precisa enxergar as vendas que ela mesma lança.
drop policy if exists "direct_sales_select" on public.direct_sales;
create policy "direct_sales_select" on public.direct_sales
  for select to authenticated
  using (
    public.is_admin_master()
    or clinic_id in (select public.user_full_access_clinic_ids())
    or public.is_network_viewer()
    or public.has_role_in_clinic(clinic_id,
         array['unit_manager','franchisee','clinical_coordinator','receptionist','sdr']::public.user_role[])
    or exists (select 1 from public.providers_with_access(clinic_id, 'commercial_consultant') p
               where p.user_id = (select auth.uid()))
    or exists (select 1 from public.providers_with_access(clinic_id, 'commercial_assistant') p
               where p.user_id = (select auth.uid()))
  );

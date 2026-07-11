-- =============================================================================
-- 0103 — Risarte Empresarial (Fase 5): contratos (ZapSign)
-- -----------------------------------------------------------------------------
-- Contratos da empresa parceira. A emissão/assinatura liga na ZapSign (lib
-- src/lib/empresarial/zapsign.ts + Edge Function zapsign-webhook). A proposta
-- comercial usa o Gamma (já integrado no projeto). Idempotente.
-- =============================================================================

create table if not exists empresarial.contracts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references empresarial.companies (id) on delete cascade,
  title varchar(255) not null default 'Contrato Risarte Empresarial',
  status varchar(20) not null default 'DRAFT'
    check (status in ('DRAFT','SENT','SIGNED','CANCELLED')),
  zapsign_doc_id varchar(120),
  zapsign_url text,
  signer_name varchar(255),
  signer_email varchar(255),
  sent_at timestamptz,
  signed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists contracts_company_idx on empresarial.contracts (company_id);
create index if not exists contracts_doc_idx on empresarial.contracts (zapsign_doc_id);

drop trigger if exists contracts_set_updated_at on empresarial.contracts;
create trigger contracts_set_updated_at
  before update on empresarial.contracts
  for each row execute function public.set_updated_at();

alter table empresarial.contracts enable row level security;

drop policy if exists contracts_select on empresarial.contracts;
create policy contracts_select on empresarial.contracts for select to authenticated
  using (company_id in (select empresarial.accessible_company_ids()));

drop policy if exists contracts_write on empresarial.contracts;
create policy contracts_write on empresarial.contracts for all to authenticated
  using (
    empresarial.is_program_manager()
    or company_id in (select empresarial.accessible_company_ids())
  )
  with check (
    empresarial.is_program_manager()
    or company_id in (select empresarial.accessible_company_ids())
  );

grant select, insert, update, delete on empresarial.contracts to authenticated;
grant all on empresarial.contracts to service_role;

-- Idempotência do webhook da ZapSign ------------------------------------------
create table if not exists empresarial.zapsign_webhook_events (
  id uuid primary key default gen_random_uuid(),
  event_id varchar(160) unique not null,
  event_type varchar(60),
  payload jsonb,
  processed_at timestamptz not null default now()
);
alter table empresarial.zapsign_webhook_events enable row level security;
grant all on empresarial.zapsign_webhook_events to service_role;

-- Marca o contrato como assinado (chamado pela Edge Function no retorno) -------
create or replace function empresarial.mark_contract_signed(
  p_doc_id varchar,
  p_signed_at timestamptz default now()
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update empresarial.contracts
    set status = 'SIGNED', signed_at = p_signed_at
  where zapsign_doc_id = p_doc_id and status <> 'SIGNED';
end $$;

grant execute on function empresarial.mark_contract_signed(varchar, timestamptz)
  to authenticated, service_role;

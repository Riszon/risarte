-- =============================================================================
-- 1034 — PAGAMENTO DO TRATAMENTO E RISO+ SOCIAL NA PROPOSTA
-- -----------------------------------------------------------------------------
-- Pedido do dono (26/10/2026): "em benefícios e vantagens deve ter a
-- possibilidade de configurar as formas e meios de pagamentos para a proposta.
-- por exemplo, liberar boletos e parcelamentos em até 24x. Se a empresa paga
-- para os colaboradores se vai ter a possibilidade de participar do Riso+
-- Social, para indicar pessoas carentes, de acordo as metas que forem
-- definidos para a empresa parceira poder indicar pessoas carentes".
--
-- Decisões dele, na mesma conversa:
--   1. O PAGAMENTO É O DO TRATAMENTO do colaborador (o que já existe na
--      empresa desde a 0181: meios aceitos e parcelamento máximo). A proposta
--      passa a definir isso; o fechamento leva para a empresa.
--   2. AS QUATRO METAS previstas no briefing (§5.6): titulares ativos, tempo
--      no programa, % de comparecimento às avaliações e reavaliações, e gasto
--      em tratamento.
--   3. A INDICAÇÃO é um cadastro (nome, telefone, motivo) que a equipe analisa;
--      aprovada, a pessoa é cadastrada como cliente pelo caminho normal e
--      VINCULADA pelo CPF.
--   4. O SISTEMA MOSTRA o que cada meta conquistou; QUEM LIBERA é o gestor.
--
-- Só acrescenta colunas, uma tabela e uma função de leitura. Não apaga nada.
-- Idempotente.
-- =============================================================================

-- ---- 1) A proposta ------------------------------------------------------------
alter table empresarial.lead_qualification
  add column if not exists treatment_payment_methods text[],
  add column if not exists treatment_max_installments int,
  add column if not exists social_participates boolean,
  add column if not exists social_goals jsonb;

alter table empresarial.lead_qualification
  drop constraint if exists lead_qualification_pagamento_e_social;
alter table empresarial.lead_qualification
  add constraint lead_qualification_pagamento_e_social
    check (
      (treatment_max_installments is null
       or treatment_max_installments between 1 and 24)
      and (treatment_payment_methods is null
           or treatment_payment_methods <@ array['BOLETO','PIX','CARD']::text[])
      and (social_goals is null or jsonb_typeof(social_goals) = 'array')
    );

comment on column empresarial.lead_qualification.treatment_payment_methods is
  'Meios aceitos no TRATAMENTO do colaborador (BOLETO/PIX/CARD). Nulo = o '
  'padrão (os três). Vai para companies.payment_methods no fechamento (1034).';
comment on column empresarial.lead_qualification.treatment_max_installments is
  'Parcelamento máximo do tratamento (1–24). Nulo = 24.';
comment on column empresarial.lead_qualification.social_goals is
  'As metas do Riso+ Social: [{"tipo":"EMPLOYEE_COUNT","a_cada":20,'
  '"indicacoes":1}, …]. Ver src/lib/empresarial/riso-social.ts.';

-- ---- 2) A empresa -------------------------------------------------------------
-- `social_participates` nasce VERDADEIRO: é o que valia até hoje para toda
-- empresa que paga (integral ou parcial). As metas nascem vazias.
alter table empresarial.companies
  add column if not exists social_participates boolean not null default true,
  add column if not exists social_goals jsonb;

alter table empresarial.companies
  drop constraint if exists companies_metas_do_social;
alter table empresarial.companies
  add constraint companies_metas_do_social
    check (social_goals is null or jsonb_typeof(social_goals) = 'array');

-- ---- 3) As indicações ---------------------------------------------------------
-- ⚠️ DADO PESSOAL DE TERCEIRO (LGPD): só o necessário para contatar e decidir.
-- O CPF é opcional — serve para vincular ao cadastro de cliente depois.
create table if not exists empresarial.social_referrals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references empresarial.companies (id) on delete cascade,
  full_name varchar(160) not null,
  phone varchar(30),
  cpf varchar(14),
  reason text,
  status varchar(16) not null default 'IN_REVIEW'
    check (status in ('IN_REVIEW', 'APPROVED', 'REJECTED')),
  decision_note text,
  decided_at timestamptz,
  decided_by uuid references public.profiles (id) on delete set null,
  -- A ficha social que a aprovação consumiu: uma ficha, uma pessoa.
  token_id uuid unique references empresarial.social_tokens (id) on delete set null,
  client_id uuid references public.clients (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists social_referrals_company_idx
  on empresarial.social_referrals (company_id);

drop trigger if exists social_referrals_set_updated_at on empresarial.social_referrals;
create trigger social_referrals_set_updated_at
  before update on empresarial.social_referrals
  for each row execute function public.set_updated_at();

alter table empresarial.social_referrals enable row level security;
drop policy if exists social_referrals_select on empresarial.social_referrals;
create policy social_referrals_select
  on empresarial.social_referrals for select to authenticated
  using (company_id in (select empresarial.accessible_company_ids()));
drop policy if exists social_referrals_write on empresarial.social_referrals;
create policy social_referrals_write
  on empresarial.social_referrals for all to authenticated
  using (empresarial.is_program_manager())
  with check (empresarial.is_program_manager());
grant select, insert, update, delete on empresarial.social_referrals to authenticated;
grant all on empresarial.social_referrals to service_role;

-- ---- 4) A medida das metas, mês a mês -----------------------------------------
-- Só NÚMEROS agregados — nenhum nome, nenhum id de paciente sai daqui. Os
-- clientes da empresa são os do selo (`clients.empresarial_company_id`).
--
-- Comparecimento: avaliações e reavaliações já DECIDIDAS (compareceu ou
-- faltou). Agendamento antigo que ninguém marcou não entra — contar como falta
-- puniria a empresa pelo esquecimento da recepção.
-- Gasto: vendas FECHADAS (Comercial e venda direta), sem as canceladas.
create or replace function empresarial.social_metrics(p_company_id uuid)
returns table (
  mes date,
  avaliacoes int,
  comparecimentos int,
  gasto_cents bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (
    empresarial.is_program_manager()
    or p_company_id in (select empresarial.accessible_company_ids())
  ) then
    raise exception 'NOT_ALLOWED';
  end if;

  return query
  with clientes as (
    select c.id from public.clients c where c.empresarial_company_id = p_company_id
  ),
  consultas as (
    select
      date_trunc('month', a.starts_at at time zone 'America/Sao_Paulo')::date as m,
      count(*)::int as total,
      count(*) filter (
        where a.status = 'completed' or a.attendance is not null
      )::int as vieram
    from public.appointments a
    where a.client_id in (select id from clientes)
      and a.type in ('evaluation', 'reevaluation')
      and a.starts_at < now()
      and (a.status in ('completed', 'no_show') or a.attendance is not null)
    group by 1
  ),
  vendas as (
    select
      date_trunc('month', s.closed_at at time zone 'America/Sao_Paulo')::date as m,
      sum(s.final_cents)::bigint as cents
    from public.commercial_sales s
    where s.client_id in (select id from clientes)
      and s.closed_at is not null
      and s.cancelled_at is null
    group by 1
    union all
    select
      date_trunc('month', d.closed_at at time zone 'America/Sao_Paulo')::date,
      sum(d.final_cents)::bigint
    from public.direct_sales d
    where d.client_id in (select id from clientes)
      and d.status = 'concluida'
      and d.closed_at is not null
    group by 1
  ),
  meses as (
    select m from consultas union select m from vendas
  )
  select
    meses.m,
    coalesce(consultas.total, 0),
    coalesce(consultas.vieram, 0),
    coalesce((select sum(v.cents) from vendas v where v.m = meses.m), 0)::bigint
  from meses
  left join consultas on consultas.m = meses.m
  order by meses.m;
end $$;

-- ⚠️ `revoke ... from public` sozinho NÃO fecha a função no Supabase (AP15).
revoke execute on function empresarial.social_metrics(uuid) from public, anon, authenticated;
grant execute on function empresarial.social_metrics(uuid) to authenticated;

-- A auditoria de toda tabela de cadastro (0288).
select public.audit_attach_all();

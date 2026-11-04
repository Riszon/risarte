-- =============================================================================
-- 0364 — O REPASSE DO PROCEDIMENTO SAI DE `procedures` PARA A IRMÃ
--        `procedure_commissions` (item 7 do plano docs/sdr/PLANO-CORRECOES-
--        SECAO-2.md, opção A, aprovado pelo dono em 03/11/2026; achado H1 do
--        levantamento da Rita)
--
-- O QUE HAVIA: `procedures_select` é `using (true)` para todo logado (0036) —
-- o catálogo é lido por dezenas de telas e embutido (`procedures ( name )`)
-- em várias tabelas. As colunas `commission_percent` e `commission_fixed_cents`
-- (0039) moravam lá: qualquer logado (recepção, TSB…) conseguia
-- `select commission_percent from procedures` pela API.
--
-- O QUE MUDA (o mesmo padrão da 0332, que tirou o dinheiro de `ortho_cases`
-- para `ortho_case_terms`):
--   1. Nasce `procedure_commissions (procedure_id pk, commission_percent,
--      commission_fixed_cents)`, com regra de linha: leem Admin Master,
--      Planner e Financeiro da Franqueadora; grava só o Admin Master (como
--      `procedures_write`, 0306).
--   2. Os dados são MOVIDOS (copiados linha a linha, para todo procedimento)
--      ANTES de as colunas caírem. Procedimento novo ganha a linha zerada por
--      gatilho; a tela grava o valor na irmã.
--   3. `payout_rate_for` e `payout_rate_by_level` (0212) passam a ler a irmã
--      (left join + coalesce 0): a conta do repasse não muda.
--   4. As duas colunas caem de `procedures` (DESTRUTIVO declarado abaixo —
--      nada se perde: o passo 2 já copiou). Os embeds `procedures ( name, … )`
--      continuam funcionando para todo mundo.
--
-- Idempotente. Assinaturas das funções NÃO mudam (create or replace).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) A IRMÃ
-- -----------------------------------------------------------------------------
create table if not exists public.procedure_commissions (
  procedure_id uuid primary key references public.procedures (id) on delete cascade,
  commission_percent numeric(6, 2) not null default 0 check (commission_percent >= 0),
  commission_fixed_cents integer not null default 0 check (commission_fixed_cents >= 0),
  updated_at timestamptz not null default now()
);

alter table public.procedure_commissions enable row level security;

drop policy if exists "procedure_commissions_select" on public.procedure_commissions;
create policy "procedure_commissions_select" on public.procedure_commissions
  for select to authenticated
  using (public.is_admin_master() or public.is_planner() or public.is_finance_franchisor());

drop policy if exists "procedure_commissions_write" on public.procedure_commissions;
create policy "procedure_commissions_write" on public.procedure_commissions
  for all to authenticated
  using (public.is_admin_master())
  with check (public.is_admin_master());

-- Todo procedimento tem a sua linha (zerada ao nascer; a tela grava o valor).
create or replace function public.procedure_commission_default()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.procedure_commissions (procedure_id)
  values (new.id)
  on conflict (procedure_id) do nothing;
  return new;
end;
$$;
revoke execute on function public.procedure_commission_default() from public, anon, authenticated;

drop trigger if exists procedure_commission_default on public.procedures;
create trigger procedure_commission_default
  after insert on public.procedures
  for each row execute function public.procedure_commission_default();

-- -----------------------------------------------------------------------------
-- 2) MOVER OS DADOS — antes de derrubar qualquer coisa
-- -----------------------------------------------------------------------------
-- Só roda enquanto as colunas antigas existem (na segunda passada da migração
-- elas já caíram, e a cópia já foi feita).
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'procedures'
      and column_name = 'commission_percent'
  ) then
    execute $q$
      insert into public.procedure_commissions (procedure_id, commission_percent, commission_fixed_cents)
      select p.id, coalesce(p.commission_percent, 0), coalesce(p.commission_fixed_cents, 0)
      from public.procedures p
      on conflict (procedure_id) do update
        set commission_percent = excluded.commission_percent,
            commission_fixed_cents = excluded.commission_fixed_cents,
            updated_at = now()
    $q$;
  else
    -- Procedimentos que por acaso ainda não tenham a linha (nenhum, na prática).
    insert into public.procedure_commissions (procedure_id)
    select p.id from public.procedures p
    on conflict (procedure_id) do nothing;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 3) O REPASSE LÊ A IRMÃ (0212, degraus 3 e 4) — a conta não muda
-- -----------------------------------------------------------------------------
create or replace function public.payout_rate_for(
  p_procedure_id uuid,
  p_provider_id uuid,
  p_clinic_id uuid,
  p_date date default current_date
)
returns table (rate_id uuid, amount_cents bigint, source text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_level uuid;
  v_rate record;
  v_proc record;
begin
  select ucr.career_level_id into v_level
  from public.user_clinic_roles ucr
  where ucr.user_id = p_provider_id and ucr.clinic_id = p_clinic_id
  limit 1;

  -- Degraus 1 e 2: tabela com vigência. Pessoa vence nível, unidade vence
  -- rede, e entre as vigentes a mais recente manda.
  select r.id, r.amount_cents, r.provider_id into v_rate
  from public.provider_payout_rates r
  where r.procedure_id = p_procedure_id
    and r.valid_from <= p_date
    and (r.valid_to is null or r.valid_to >= p_date)
    and (r.clinic_id is null or r.clinic_id = p_clinic_id)
    and (
      r.provider_id = p_provider_id
      or (r.provider_id is null and v_level is not null and r.level_id = v_level)
    )
  order by (r.provider_id is not null) desc,
           (r.clinic_id is not null) desc,
           r.valid_from desc
  limit 1;

  if v_rate.id is not null then
    return query select v_rate.id, v_rate.amount_cents,
      case when v_rate.provider_id is not null then 'individual' else 'nivel' end;
    return;
  end if;

  -- Degraus 3 e 4: o cadastro do procedimento — agora na irmã (0364).
  select coalesce(c.commission_fixed_cents, 0) as commission_fixed_cents,
         coalesce(c.commission_percent, 0) as commission_percent,
         p.default_price_cents
    into v_proc
  from public.procedures p
  left join public.procedure_commissions c on c.procedure_id = p.id
  where p.id = p_procedure_id;

  if coalesce(v_proc.commission_fixed_cents, 0) > 0 then
    return query select null::uuid, v_proc.commission_fixed_cents::bigint,
                        'procedimento_fixo';
    return;
  end if;

  if coalesce(v_proc.commission_percent, 0) > 0 then
    return query select null::uuid,
      round(coalesce(v_proc.default_price_cents, 0)
            * v_proc.commission_percent / 100.0)::bigint,
      'procedimento_percentual';
    return;
  end if;

  return;
end;
$$;

grant execute on function public.payout_rate_for(uuid, uuid, uuid, date)
  to authenticated;

create or replace function public.payout_rate_by_level(
  p_procedure_id uuid,
  p_level_id uuid,
  p_clinic_id uuid,
  p_date date default current_date
)
returns table (rate_id uuid, amount_cents bigint, source text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_rate record;
  v_proc record;
begin
  select r.id, r.amount_cents into v_rate
  from public.provider_payout_rates r
  where r.procedure_id = p_procedure_id
    and r.level_id = p_level_id
    and r.provider_id is null
    and r.valid_from <= p_date
    and (r.valid_to is null or r.valid_to >= p_date)
    and (r.clinic_id is null or r.clinic_id = p_clinic_id)
  order by (r.clinic_id is not null) desc, r.valid_from desc
  limit 1;

  if v_rate.id is not null then
    return query select v_rate.id, v_rate.amount_cents, 'nivel'::text;
    return;
  end if;

  -- O cadastro do procedimento — agora na irmã (0364).
  select coalesce(c.commission_fixed_cents, 0) as commission_fixed_cents,
         coalesce(c.commission_percent, 0) as commission_percent,
         p.default_price_cents
    into v_proc
  from public.procedures p
  left join public.procedure_commissions c on c.procedure_id = p.id
  where p.id = p_procedure_id;

  if coalesce(v_proc.commission_fixed_cents, 0) > 0 then
    return query select null::uuid, v_proc.commission_fixed_cents::bigint,
                        'procedimento_fixo'::text;
    return;
  end if;

  if coalesce(v_proc.commission_percent, 0) > 0 then
    return query select null::uuid,
      round(coalesce(v_proc.default_price_cents, 0)
            * v_proc.commission_percent / 100.0)::bigint,
      'procedimento_percentual'::text;
    return;
  end if;

  return;
end;
$$;

grant execute on function public.payout_rate_by_level(uuid, uuid, uuid, date)
  to authenticated;

-- -----------------------------------------------------------------------------
-- 4) AS COLUNAS CAEM — depois de copiadas (passo 2) e de ninguém mais lê-las (3)
-- -----------------------------------------------------------------------------
-- DESTRUTIVO: coluna MOVIDA para procedure_commissions no passo 2 desta migração (nada se perde)
alter table public.procedures drop column if exists commission_percent;
-- DESTRUTIVO: coluna MOVIDA para procedure_commissions no passo 2 desta migração (nada se perde)
alter table public.procedures drop column if exists commission_fixed_cents;

-- -----------------------------------------------------------------------------
-- 5) AUDITORIA (0288): a irmã é cadastro — entra na trilha
-- -----------------------------------------------------------------------------
select public.audit_attach_all();

-- Conferência (o dono roda depois de aplicar; esperado: N · N · 0 · true · 0)
-- select
--   (select count(*) from public.procedures) as procedimentos,
--   (select count(*) from public.procedure_commissions) as com_linha_na_irma,
--   (select count(*) from information_schema.columns
--     where table_schema = 'public' and table_name = 'procedures'
--       and column_name like 'commission%') as colunas_antigas,
--   (select prosrc like '%procedure_commissions%' from pg_proc where proname = 'payout_rate_for') as repasse_le_a_irma,
--   (select count(*) from pg_policies where tablename = 'procedure_commissions' and 'anon' = any(roles)) as abertas_sem_login;

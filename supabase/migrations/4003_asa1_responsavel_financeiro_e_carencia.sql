-- =============================================================================
-- 4003 — ASA1, ENTREGA 1: responsável financeiro, carência fixa em zero e o
-- histórico das abas Financeiro e Comercial da Central
-- -----------------------------------------------------------------------------
-- Plano aprovado pelo dono em 11/11/2026: docs/integracao-asaas.md, seção 14.
--
--   * RESPONSÁVEL FINANCEIRO (D8): `client_guardians.is_financial` — o pagador
--     das cobranças. No máximo UM por cliente (índice único). A regra "menor
--     tem exatamente um marcado" é do cadastro (a tela e a ação recusam); o
--     banco garante o "no máximo um", e a emissão (entrega 2) recusa menor sem
--     pagador marcado.
--     Dados que já existem: menor com UM único responsável fica marcado. Com
--     mais de um, ninguém é marcado — a emissão pede para marcar.
--   * CARÊNCIA FIXA EM ZERO (seção 14.2): o Asaas não aplica carência; multa e
--     juros contam do dia seguinte ao vencimento. O banco passa a recusar
--     carência diferente de zero em `finance_settings` (rede e unidade; nulo
--     na unidade = segue a rede). Na produção já é zero (o dono confirmou); se
--     algum banco tiver outro valor, esta migração PARA com erro em vez de
--     mudar o dado calada.
--   * HISTÓRICO DAS ABAS: `central_history` passa a responder as abas
--     'financeiro' (finance_settings) e 'comercial' (commercial_rules e
--     commercial_followup_settings), pela unidade gravada na trilha de
--     auditoria. Retorno igual ao da 4002.
--
-- Idempotente. Não apaga dado.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) RESPONSÁVEL FINANCEIRO
-- -----------------------------------------------------------------------------
alter table public.client_guardians
  add column if not exists is_financial boolean not null default false;

comment on column public.client_guardians.is_financial is
  'Responsável financeiro: o pagador das cobranças (D8; 4003). No máximo um por cliente.';

-- No máximo um pagador por cliente. Regra de EXCLUSÃO conferida no FIM do
-- comando (deferrable): um índice único comum confere linha a linha e recusava
-- a troca do pagador num comando só (desmarca um e marca outro) — achado no
-- ensaio. Assim a troca passa e dois marcados nunca ficam gravados.
alter table public.client_guardians
  drop constraint if exists client_guardians_one_financial;
alter table public.client_guardians
  add constraint client_guardians_one_financial
  exclude using btree (client_id with =) where (is_financial)
  deferrable initially immediate;

-- Menor de idade (hoje, no Brasil) com UM único responsável: ele é o pagador.
update public.client_guardians g
   set is_financial = true
 where not g.is_financial
   and exists (
     select 1 from public.clients c
      where c.id = g.client_id
        and c.birth_date is not null
        and c.birth_date > (public.today_br() - interval '18 years')::date
   )
   and (select count(*) from public.client_guardians o where o.client_id = g.client_id) = 1
   and not exists (
     select 1 from public.client_guardians o
      where o.client_id = g.client_id and o.is_financial
   );

-- -----------------------------------------------------------------------------
-- 2) CARÊNCIA FIXA EM ZERO
-- -----------------------------------------------------------------------------
-- Antes da trava: se algum banco tiver carência diferente de zero, para aqui
-- com a explicação (nunca muda o valor sozinha).
do $$
begin
  if exists (select 1 from public.finance_settings where grace_days is not null and grace_days <> 0) then
    raise exception 'GRACE_NOT_ZERO: há configuração financeira com carência diferente de zero. '
      'Zere a carência em Financeiro › Configuração antes de rodar a 4003.';
  end if;
end;
$$;

alter table public.finance_settings
  drop constraint if exists finance_settings_grace_zero;
alter table public.finance_settings
  add constraint finance_settings_grace_zero
  check (grace_days is null or grace_days = 0);

comment on constraint finance_settings_grace_zero on public.finance_settings is
  'Carência fixa em zero (4003): o Asaas não aplica carência; multa e juros contam do dia seguinte ao vencimento.';

-- -----------------------------------------------------------------------------
-- 3) HISTÓRICO POR ABA — agora com Financeiro e Comercial
-- -----------------------------------------------------------------------------
-- Mesmas colunas da 4002 (create or replace com o mesmo retorno).
--   'conta'      → como na 4002
--   'financeiro' → finance_settings da rede (p_clinic_id nulo) ou da unidade.
--                  Vê: Admin Master e Financeiro da Franqueadora; o Gerente,
--                  só a própria unidade.
--   'comercial'  → commercial_rules e commercial_followup_settings. Vê: só o
--                  Admin Master (é quem edita as Regras Comerciais).
-- As linhas de configuração são achadas pela UNIDADE que a trilha gravou
-- (`audit_changes.clinic_id`, nulo = rede) — assim aparece também o ajuste
-- da unidade que foi apagado ("voltar ao padrão da rede").
create or replace function public.central_history(p_tab text, p_clinic_id uuid)
returns table (
  id bigint,
  occurred_at timestamptz,
  user_id uuid,
  user_name text,
  actor text,
  table_name text,
  op text,
  changes jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_tab not in ('conta', 'financeiro', 'comercial') then
    raise exception 'TAB_UNKNOWN';
  end if;

  if p_tab = 'comercial' then
    if not public.is_admin_master() then
      return;
    end if;
  elsif p_clinic_id is null then
    if not (public.is_admin_master() or public.is_finance_franchisor()) then
      return;
    end if;
  elsif not public.central_can_see(p_clinic_id) then
    return;
  end if;

  if p_tab = 'conta' then
    return query
    select a.id, a.occurred_at, a.user_id, pr.full_name, a.actor,
           a.table_name, a.op, a.changes
      from public.audit_changes a
      left join public.profiles pr on pr.id = a.user_id
     where a.schema_name = 'public'
       and (
         (a.table_name = 'gateway_accounts' and a.row_id in (
            select g.id::text from public.gateway_accounts g
             where (p_clinic_id is null and g.owner_type in ('franchisor', 'recipient'))
                or g.clinic_id = p_clinic_id))
         or (p_clinic_id is not null
             and a.table_name = 'central_unit_readiness'
             and a.row_id = p_clinic_id::text)
         or (a.table_name = 'card_acquirers' and a.row_id in (
            select c.id::text
              from public.card_acquirers c
              join public.gateway_accounts g on g.id = c.gateway_account_id
             where (p_clinic_id is null and g.owner_type = 'franchisor')
                or g.clinic_id = p_clinic_id))
         or (a.table_name = 'acquirer_rates' and a.row_id in (
            select r.id::text
              from public.acquirer_rates r
              join public.card_acquirers c on c.id = r.acquirer_id
              join public.gateway_accounts g on g.id = c.gateway_account_id
             where (p_clinic_id is null and g.owner_type = 'franchisor')
                or g.clinic_id = p_clinic_id))
       )
     order by a.occurred_at desc, a.id desc
     limit 200;
    return;
  end if;

  return query
  select a.id, a.occurred_at, a.user_id, pr.full_name, a.actor,
         a.table_name, a.op, a.changes
    from public.audit_changes a
    left join public.profiles pr on pr.id = a.user_id
   where a.schema_name = 'public'
     and a.table_name = any (
       case when p_tab = 'financeiro'
            then array['finance_settings']
            else array['commercial_rules', 'commercial_followup_settings'] end)
     and a.clinic_id is not distinct from p_clinic_id
   order by a.occurred_at desc, a.id desc
   limit 200;
end;
$$;

revoke execute on function public.central_history(text, uuid) from public, anon, authenticated;
grant execute on function public.central_history(text, uuid) to authenticated;

-- Nenhuma tabela nova; mantém a regra da 0288 em dia.
select public.audit_attach_all();

-- -----------------------------------------------------------------------------
-- Conferência (só contagens)
-- -----------------------------------------------------------------------------
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'client_guardians'
      and column_name = 'is_financial') as coluna_do_pagador,
  (select count(*) from pg_constraint where conname = 'client_guardians_one_financial') as regra_um_pagador,
  (select count(*) from public.client_guardians where is_financial) as pagadores_marcados,
  (select count(*) from pg_constraint where conname = 'finance_settings_grace_zero') as trava_da_carencia,
  (select count(*) from public.finance_settings where grace_days <> 0) as carencias_diferentes_de_zero;

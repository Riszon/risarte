-- =============================================================================
-- 1035 — METAS DO RISO+ SOCIAL COM VÁRIAS CONDIÇÕES
-- -----------------------------------------------------------------------------
-- Pedido do dono (27/10/2026): "a meta para o Riso+ Social deve ter a
-- possibilidade de em uma unica meta ter as condições variáveis, como por
-- exemplo: para indicar 01 pessoa carente deve ter pelo menos X titulares
-- ativos e Y tempo de programa empresarial. […] Um pré requisito já é a
-- empresa pagar integralmente ou parcialmente para os colaboradores a
-- mensalidade do programa. Se somente os titulares pagam a mensalidade a
-- empresa não tem o direito de participar do programa riso+ social."
--
-- Decisões dele, na mesma conversa:
--   1. Uma meta = várias condições "pelo menos", todas ao mesmo tempo, e as
--      indicações que ela rende. Rende uma vez; com "renova a cada N meses",
--      rende de novo a cada período de N meses de contrato.
--   2. Condições: titulares ativos, dependentes ativos, tempo de programa,
--      comparecimento, gasto em tratamento e mensalidades em dia.
--
-- O formato das metas mora no jsonb (src/lib/empresarial/riso-social.ts); a
-- produção não tinha nenhuma meta gravada quando esta migração foi escrita.
--
-- Aqui:
--   1. A ficha social passa a dizer QUAL META a rendeu (`goal_id`), e ganha
--      os gatilhos "GOAL" (meta) e "MANUAL" (ficha avulsa, exceção combinada).
--   2. O PRÉ-REQUISITO NO BANCO: ficha social só nasce para empresa que paga
--      (tudo ou parte) e participa do Riso+ Social — por qualquer caminho.
--
-- Só acrescenta. Não apaga nada. Idempotente.
-- =============================================================================

-- ---- 1) A ficha diz de qual meta veio -------------------------------------------
alter table empresarial.social_tokens
  add column if not exists goal_id varchar(40);

comment on column empresarial.social_tokens.goal_id is
  'A meta (companies.social_goals[].id) que rendeu a ficha. Nulo = ficha '
  'avulsa ou anterior à 1035. O painel conta as liberadas por ela.';

alter table empresarial.social_tokens
  drop constraint if exists social_tokens_trigger_type_check;
alter table empresarial.social_tokens
  add constraint social_tokens_trigger_type_check
    check (trigger_type in (
      'EMPLOYEE_COUNT', 'TIME_IN_PROGRAM', 'ATTENDANCE', 'TREATMENT_SPEND',
      'GOAL', 'MANUAL'
    ));

create index if not exists social_tokens_goal_idx
  on empresarial.social_tokens (company_id, goal_id);

comment on column empresarial.companies.social_goals is
  'As metas do Riso+ Social (1035): [{"id":"…","indicacoes":1,'
  '"renova_meses":12|null,"condicoes":[{"tipo":"EMPLOYEE_COUNT","minimo":20},'
  '…]}]. Ver src/lib/empresarial/riso-social.ts.';
comment on column empresarial.lead_qualification.social_goals is
  'As metas do Riso+ Social combinadas na proposta — mesmo formato de '
  'companies.social_goals (1035).';

-- ---- 2) O pré-requisito, no banco -------------------------------------------------
-- A tela já não oferece o Riso+ Social no "titular paga"; a regra mora aqui
-- para valer também por qualquer outro caminho.
create or replace function empresarial.social_token_requires_paying_company()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_model text;
  v_participa boolean;
begin
  select c.payment_model, c.social_participates
    into v_model, v_participa
    from empresarial.companies c
   where c.id = new.company_id;
  if v_model is null or v_model not in ('COMPANY_PAYS', 'COMPANY_PARTIAL') then
    raise exception 'SOCIAL_REQUIRES_COMPANY_PAYMENT'
      using hint = 'Só a empresa que paga a mensalidade (integral ou parcial) participa do Riso+ Social.';
  end if;
  if v_participa is not true then
    raise exception 'SOCIAL_NOT_PARTICIPATING'
      using hint = 'Esta empresa não participa do Riso+ Social.';
  end if;
  return new;
end $$;

-- Função de gatilho: ninguém a chama pela API.
revoke execute on function empresarial.social_token_requires_paying_company()
  from public, anon, authenticated;

drop trigger if exists social_tokens_requires_paying_company on empresarial.social_tokens;
create trigger social_tokens_requires_paying_company
  before insert on empresarial.social_tokens
  for each row execute function empresarial.social_token_requires_paying_company();

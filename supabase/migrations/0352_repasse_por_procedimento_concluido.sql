-- =============================================================================
-- 0352 — O REPASSE SAI POR PROCEDIMENTO CONCLUÍDO, NÃO POR SESSÃO (AP61)
--
-- Decisão do dono (03/11/2026), na AP61: "paga por procedimento concluído. Se
-- um procedimento tem 3 sessões só vai contabilizar para o repasse quando
-- finalizar as 3 sessões daquele procedimento."
--
-- O DEFEITO: `accrue_session_payout` (último corpo na 0218) lançava o valor
-- INTEIRO da tabela a cada sessão concluída. Num procedimento de 3 sessões o
-- dentista recebia 3 vezes, enquanto a estimativa da negociação
-- (`estimated_option_payout`, taxa × quantidade) contava uma. A regra do FIN5
-- (0209) sempre foi "valor fixo por procedimento".
--
-- COMO AS SESSÕES SE AGRUPAM EM PROCEDIMENTOS (geração na 0337): um item do
-- plano com quantidade Q e protocolo de N sessões vira N×Q sessões, numeradas
-- de 1 a N×Q. Cada bloco de N sessões seguidas é UM procedimento (um dente,
-- por exemplo). Sem protocolo, o item tem as sessões planejadas: se o total
-- divide pela quantidade, o bloco é total/Q; se não divide, o item inteiro é
-- um bloco só, que paga Q procedimentos de uma vez.
--
-- A REGRA NOVA, a cada sessão concluída:
--   1) acha o bloco (procedimento) da sessão;
--   2) se ainda falta sessão do bloco, não lança nada;
--   3) se o bloco já tem repasse, não lança de novo (refação: as sessões
--      voltam a "aberta" e são concluídas outra vez);
--   4) senão, lança o valor da tabela UMA vez (Q vezes no bloco único), preso
--      à sessão que fechou o bloco.
-- Sessão de REVISÃO (`redo_kind = 'revisao'`) não é procedimento novo: não
-- paga e não conta no bloco.
-- Sessão sem item de plano (venda direta: uma sessão "1 de 1" por unidade)
-- continua pagando por sessão — ali cada sessão já é um procedimento.
--
-- QUEM E QUANDO (escolha do agente, registrada na AP61 para o dono conferir):
-- o repasse vai para quem concluiu a ÚLTIMA sessão do procedimento, na data
-- dela (competência = data em que o procedimento ficou pronto).
--
-- O QUE NÃO MUDA: repasse já apurado não é recalculado (regra do FIN5: o valor
-- fica CONGELADO na linha). A manutenção da Ortodontia tem caminho próprio
-- (0329/0332) e não passa por aqui.
--
-- Nada apaga. Idempotente: rodar de novo não muda nada.
-- =============================================================================

create or replace function public.accrue_session_payout()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rate record;
  v_provider uuid;
  v_when date;
  v_was_done boolean := (TG_OP = 'UPDATE' and coalesce(old.status, '') = 'done');
  v_total integer;
  v_qty integer;
  v_per integer;
  v_units integer := 1;
  v_from integer;
  v_to integer;
  v_block uuid[];
begin
  if new.status <> 'done' or v_was_done then
    return new;
  end if;
  if new.procedure_id is null or new.clinic_id is null then
    return new;
  end if;
  -- Revisão não é procedimento novo.
  if new.redo_kind is not distinct from 'revisao' then
    return new;
  end if;

  v_provider := coalesce(new.executed_by, new.planner_provider_id);
  if v_provider is null then return new; end if;

  if new.item_id is null then
    -- Venda direta (e sessão avulsa): cada sessão já é um procedimento.
    v_block := array[new.id];
  else
    select count(*) into v_total
    from public.treatment_sessions s
    where s.item_id = new.item_id
      and s.redo_kind is distinct from 'revisao';

    select greatest(1, coalesce(i.quantity, 1)) into v_qty
    from public.treatment_plan_option_items i
    where i.id = new.item_id;
    v_qty := coalesce(v_qty, 1);

    if v_total >= v_qty and v_total % v_qty = 0 then
      v_per := v_total / v_qty;          -- um procedimento a cada v_per sessões
    else
      v_per := greatest(v_total, 1);     -- o item inteiro é um bloco só
      v_units := v_qty;
    end if;

    v_from := ((greatest(new.session_index, 1) - 1) / v_per) * v_per + 1;
    v_to := v_from + v_per - 1;

    select coalesce(array_agg(s.id), array[]::uuid[]) into v_block
    from public.treatment_sessions s
    where s.item_id = new.item_id
      and s.redo_kind is distinct from 'revisao'
      and s.session_index between v_from and v_to;

    -- Falta sessão do procedimento: ainda não é a hora.
    if exists (
      select 1 from public.treatment_sessions s
      where s.id = any(v_block) and s.status <> 'done'
    ) then
      return new;
    end if;

    if not (new.id = any(v_block)) then
      v_block := v_block || new.id;
    end if;
  end if;

  -- O procedimento já tem repasse (refação concluída de novo): não paga outra vez.
  if exists (
    select 1 from public.provider_payouts p where p.session_id = any(v_block)
  ) then
    return new;
  end if;

  v_when := coalesce(new.done_at::date, public.today_br());

  select * into v_rate
  from public.payout_rate_for(new.procedure_id, v_provider, new.clinic_id, v_when);

  insert into public.provider_payouts (
    clinic_id, provider_id, session_id, procedure_id, procedure_name,
    accrual_date, amount_cents, rate_id
  ) values (
    new.clinic_id, v_provider, new.id, new.procedure_id, new.procedure_name,
    v_when, coalesce(v_rate.amount_cents, 0) * v_units, v_rate.rate_id
  )
  on conflict do nothing;

  return new;
end;
$$;

comment on function public.accrue_session_payout() is
  'Repasse por PROCEDIMENTO concluído (0352, AP61): lança uma vez, quando a última sessão do procedimento termina; revisão não paga; refação não paga de novo.';

-- O gatilho continua o mesmo (0218); recriado para a migração se bastar sozinha.
drop trigger if exists treatment_sessions_accrue_payout on public.treatment_sessions;
create trigger treatment_sessions_accrue_payout
  after insert or update on public.treatment_sessions
  for each row execute function public.accrue_session_payout();

-- Conferência (só leitura) ------------------------------------------------------
select
  position('v_block' in pg_get_functiondef('public.accrue_session_payout()'::regprocedure)) > 0
    as regra_por_procedimento,
  (select count(*) from pg_trigger
    where tgname = 'treatment_sessions_accrue_payout' and not tgisinternal) as gatilhos_esperado_1,
  (select count(*) from public.provider_payouts where session_id is not null)
    as repasses_de_sessao_ja_apurados_nao_mudam;

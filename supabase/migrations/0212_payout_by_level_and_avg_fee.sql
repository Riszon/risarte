-- =============================================================================
-- 0212 — REPASSE POR NÍVEL VISÍVEL + TAXA MÉDIA SUGERIDA
-- -----------------------------------------------------------------------------
-- Pedido do dono (08/08/2026), depois de testar o precificador:
--
--   1. "no repasse do dentista deve ter de acordo os diferentes repasses, para
--      poder visualizar o resultado quando um dentista junior ou senior executa
--      o procedimento"
--   2. "nos procedimentos onde é lançado o repasse para o dentista deve também
--      ter a informação de repasse para cada nivel dos dentistas"
--   3. a taxa média do pagamento deve ser SUGERIDA pelo sistema.
--
-- O QUE FALTAVA: só existia `payout_rate_for(procedimento, PESSOA, unidade)`.
-- Dava para perguntar "quanto o Dr. Fulano ganha", nunca "quanto ganha *um*
-- sênior". Sem essa pergunta não há comparativo, e sem comparativo o gestor não
-- enxerga o efeito de quem executa sobre a margem — que é justamente onde o
-- repasse fixo dói: o desconto não reduz o repasse, e trocar o executante muda
-- o resultado sem mudar o preço.
--
-- NADA AQUI RECALCULA REPASSE APURADO. `provider_payouts` guarda o valor
-- congelado da época; estas funções só LEEM a tabela vigente.
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) A CASCATA PASSA A VALER TAMBÉM NO REPASSE
-- -----------------------------------------------------------------------------
-- A 0210 ordenava por `valid_from desc` sem olhar o escopo. Enquanto só a
-- unidade cadastrava valor, dava no mesmo. Agora o catálogo de Procedimentos
-- (que é da REDE) também cadastra, então os dois escopos coexistem — e sem
-- desempate um valor da rede criado depois passaria por cima do contrato que a
-- unidade negociou. Mesma regra do resto do sistema: unidade vence rede.
drop function if exists public.payout_rate_for(uuid, uuid, uuid, date);

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

  -- Degraus 3 e 4: o que já estava no CADASTRO DO PROCEDIMENTO (0039).
  select p.commission_fixed_cents, p.commission_percent, p.default_price_cents
    into v_proc
  from public.procedures p where p.id = p_procedure_id;

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

-- -----------------------------------------------------------------------------
-- 2) O MESMO REPASSE, PERGUNTADO PELO NÍVEL
-- -----------------------------------------------------------------------------
-- Os MESMOS quatro degraus, com o nível dado em vez de deduzido da pessoa. Tem
-- de ser os mesmos: se o comparativo mostrar um número e a apuração gravar
-- outro, o comparativo mente — e mentira em tela de dinheiro é pior que tela
-- vazia.
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

  select p.commission_fixed_cents, p.commission_percent, p.default_price_cents
    into v_proc
  from public.procedures p where p.id = p_procedure_id;

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
-- 3) O COMPARATIVO INTEIRO EM UMA CHAMADA
-- -----------------------------------------------------------------------------
-- Procedimento × nível, com a origem de cada valor. `source` é o que permite à
-- tela dizer se aquele número foi CADASTRADO para o nível ou se é só o
-- cadastro do procedimento aparecendo igual para todo mundo — os dois casos
-- mostram o mesmo R$, e confundi-los esconde exatamente o buraco que o gestor
-- precisa ver.
create or replace function public.payout_matrix(
  p_clinic_id uuid,
  p_date date default null
)
returns table (
  procedure_id uuid,
  level_id uuid,
  amount_cents bigint,
  source text
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, l.id, r.amount_cents, r.source
  from public.procedures p
  cross join public.career_levels l
  cross join lateral public.payout_rate_by_level(
    p.id, l.id, p_clinic_id, coalesce(p_date, public.today_br())
  ) r
  where p.is_active
    and l.active
    and (l.clinic_id is null or l.clinic_id = p_clinic_id);
$$;

grant execute on function public.payout_matrix(uuid, date) to authenticated;

-- -----------------------------------------------------------------------------
-- 4) GRAVAR O VALOR DE UM NÍVEL SEM QUEBRAR A VIGÊNCIA
-- -----------------------------------------------------------------------------
-- Mudar o valor não é editar a linha: é ENCERRAR a vigente e abrir outra. Em
-- duas idas ao banco pela tela, uma falha no meio deixaria duas linhas abertas
-- (ou nenhuma) — por isso a operação vive aqui, atômica.
create or replace function public.set_payout_rate_for_level(
  p_procedure_id uuid,
  p_level_id uuid,
  p_clinic_id uuid,
  p_amount_cents bigint,
  p_valid_from date default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from date := coalesce(p_valid_from, public.today_br());
  v_user uuid := (select auth.uid());
  v_id uuid;
begin
  if not (
    public.is_admin_master()
    or public.is_finance_franchisor()
    or (p_clinic_id is not null and public.can_post_finance(p_clinic_id))
  ) then
    raise exception 'NOT_ALLOWED';
  end if;

  if p_amount_cents is null or p_amount_cents < 0 then
    raise exception 'INVALID_AMOUNT';
  end if;

  -- Encerra a vigente do MESMO escopo no dia anterior. Linha que começa hoje
  -- é substituída (não faz sentido uma vigência de zero dia).
  update public.provider_payout_rates
     set valid_to = case when valid_from >= v_from then valid_from
                         else v_from - 1 end
   where procedure_id = p_procedure_id
     and level_id = p_level_id
     and provider_id is null
     and clinic_id is not distinct from p_clinic_id
     and valid_to is null;

  delete from public.provider_payout_rates
   where procedure_id = p_procedure_id
     and level_id = p_level_id
     and provider_id is null
     and clinic_id is not distinct from p_clinic_id
     and valid_from >= v_from
     and not exists (
       select 1 from public.provider_payouts pp where pp.rate_id = provider_payout_rates.id
     );

  insert into public.provider_payout_rates (
    clinic_id, procedure_id, level_id, provider_id,
    amount_cents, valid_from, created_by
  ) values (
    p_clinic_id, p_procedure_id, p_level_id, null,
    p_amount_cents, v_from, v_user
  )
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.set_payout_rate_for_level(
  uuid, uuid, uuid, bigint, date) to authenticated;

-- -----------------------------------------------------------------------------
-- 5) TAXA MÉDIA DO PAGAMENTO — SUGERIDA PELO QUE JÁ ACONTECEU
-- -----------------------------------------------------------------------------
-- O precificador pede "taxa média do pagamento (%)" porque, na hora de formar
-- o preço, ninguém sabe como aquele cliente vai pagar: um paga PIX, outro
-- parcela no cartão. O preço é UM só, então a conta usa a média da mistura.
--
-- Chutar esse número custa caro nos dois sentidos: baixo demais e a margem real
-- fica abaixo da prometida em toda venda; alto demais e o preço sai do mercado.
-- O sistema já sabe a resposta — ela está no razão.
--
--   taxa média = taxas de adquirente pagas ÷ recebido, no período
--
-- Inclui a taxa de EMISSÃO de boleto (`boleto_issue`) junto com a da baixa:
-- ela é custo do meio de pagamento igual, e deixá-la de fora subestimaria o
-- custo justamente de quem vende muito no boleto.
--
-- Estornados saem dos DOIS lados (`status = 'settled' and reversal_of is null`
-- descarta o original estornado e o contra-lançamento) — recebimento desfeito
-- não entra na média nem como receita nem como taxa.
--
-- Devolve NADA quando não há recebimento ou não há taxa lançada no período. Um
-- "0%" ali seria lido como "não pago taxa", quando o certo é "ainda não sei".
create or replace function public.suggested_avg_acquirer_fee(
  p_clinic_id uuid,
  p_days integer default 90
)
returns table (
  fee_percent numeric,
  fee_cents bigint,
  received_cents bigint,
  from_date date
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_from date := public.today_br() - greatest(coalesce(p_days, 90), 1);
  v_fee bigint;
  v_received bigint;
begin
  if p_clinic_id is null then return; end if;
  if not (
    public.is_admin_master()
    or public.is_finance_franchisor()
    or p_clinic_id in (select public.finance_visible_clinic_ids())
  ) then
    return;
  end if;

  select
    coalesce(sum(case when e.source_type in ('acquirer_fee', 'boleto_issue')
                      then case when e.direction = 'outflow'
                                then e.amount_cents else -e.amount_cents end
                 end), 0),
    coalesce(sum(case when e.source_type = 'receipt_cash'
                      then case when e.direction = 'inflow'
                                then e.amount_cents else -e.amount_cents end
                 end), 0)
    into v_fee, v_received
  from public.financial_entries e
  where e.clinic_id = p_clinic_id
    and e.status = 'settled'
    and e.reversal_of is null
    and e.cash_date >= v_from;

  if v_received <= 0 or v_fee <= 0 then return; end if;

  return query select
    round(v_fee * 10000.0 / v_received) / 100.0,
    v_fee,
    v_received,
    v_from;
end;
$$;

grant execute on function public.suggested_avg_acquirer_fee(uuid, integer)
  to authenticated;

-- -----------------------------------------------------------------------------
-- Conferência (só contagens — nenhum dado pessoal)
-- -----------------------------------------------------------------------------
select
  (select count(*) from public.career_levels where active) as niveis_ativos,
  (select count(*) from public.provider_payout_rates
    where level_id is not null and valid_to is null) as valores_por_nivel_vigentes,
  (select count(*) from public.provider_payout_rates
    where clinic_id is null and valid_to is null) as valores_da_rede_vigentes,
  (select count(*) from public.financial_entries
    where source_type in ('acquirer_fee', 'boleto_issue')
      and status = 'settled' and reversal_of is null) as taxas_no_razao;

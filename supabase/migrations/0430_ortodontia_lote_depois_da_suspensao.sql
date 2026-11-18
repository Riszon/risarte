-- =============================================================================
-- 0430 — AP181: o lote de mensalidades depois de suspender e retomar (18/11/2026)
-- =============================================================================
-- Achado no roteiro de teste da ortodontia (treino, 17/11/2026): lote 1
-- 11/2026–10/2027 e lote 2 11/2027–04/2028; "Suspender" cancelou as
-- mensalidades seguintes e encerrou os dois lotes (certo); depois de "Retomar",
-- "Emitir novas mensalidades" criou o lote 3 em 05/2028, depois do lote 2 que
-- a suspensão cancelou inteiro. De 12/2026 a 04/2028 o paciente ficou sem
-- mensalidade.
--
-- A causa: o mês de início do lote novo era "o mês seguinte ao último lote"
-- (_ortho_emit_batch, pelo last_month de qualquer lote) ou, na renovação, o
-- last_month + 1 do lote decidido (ortho_decide_batch).
--
-- A correção (plano docs/ortodontia/AP181-PLANO.md, aprovado em 18/11/2026):
--   * o lote novo começa no mês seguinte ao último mês coberto — o fim de um
--     lote ATIVO ou a última mensalidade NÃO cancelada —, nunca antes do mês
--     atual. Sem suspensão nada muda; depois de uma, recomeça no mês da
--     retomada (decisão do dono: esse mês é cobrado);
--   * a renovação deixa a conta do mês para _ortho_emit_batch;
--   * o início pela instalação (0417, mês do início do tratamento) não muda.
--
-- Os corpos são os da 0335 com só essas mudanças. Ao recriar _ortho_emit_batch
-- ou ortho_decide_batch, partir DESTA migração. Espelho na tela:
-- inicioDoProximoLote (src/lib/ortodontia/regras.ts).
-- =============================================================================

create or replace function public._ortho_emit_batch(
  p_case_id uuid,
  p_count integer,
  p_amount_cents integer,
  p_billing_method text,
  p_punctuality numeric,
  p_first_month date default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_c public.ortho_cases;
  v_t public.ortho_case_terms;
  v_seq integer;
  v_first date;
  v_last date;
  v_id uuid;
  v_count integer := greatest(1, least(120, coalesce(p_count, 12)));
  v_amount integer := greatest(0, coalesce(p_amount_cents, 0));
  v_prev_last date;
  i integer;
  v_month date;
begin
  select * into v_c from public.ortho_cases where id = p_case_id;
  if v_c.id is null then raise exception 'NOT_FOUND'; end if;
  select * into v_t from public.ortho_case_terms where case_id = p_case_id;

  select coalesce(max(seq), 0) + 1 into v_seq
    from public.ortho_billing_batches where case_id = p_case_id;

  -- AP181 (0430): o último mês já coberto = o fim de um lote ATIVO ou a última
  -- mensalidade NÃO cancelada. Um lote que a suspensão cancelou não conta mais
  -- (antes contava o last_month de qualquer lote, e o lote novo nascia depois
  -- dos meses cancelados, deixando o paciente sem mensalidade).
  select greatest(
           (select max(b.last_month) from public.ortho_billing_batches b
             where b.case_id = p_case_id and b.status = 'ativo'),
           (select max(ch.reference_month) from public.ortho_charges ch
             where ch.case_id = p_case_id and ch.kind = 'mensalidade'
               and ch.status <> 'cancelada'))
    into v_prev_last;

  -- Nunca antes do mês atual (R7); na retomada, o mês da retomada é cobrado
  -- (decisão do dono, 18/11/2026).
  v_first := coalesce(
    p_first_month,
    greatest((v_prev_last + interval '1 month')::date,
             date_trunc('month', coalesce(v_c.start_date, public.today_br()))::date,
             date_trunc('month', public.today_br())::date));
  v_first := date_trunc('month', v_first)::date;
  v_last := (v_first + make_interval(months => v_count - 1))::date;

  insert into public.ortho_billing_batches
    (case_id, clinic_id, seq, installments_count, first_month, last_month, amount_cents,
     billing_method, punctuality_discount_percent, created_by)
  values
    (p_case_id, v_c.clinic_id, v_seq, v_count, v_first, v_last, v_amount,
     p_billing_method, greatest(0, least(100, coalesce(p_punctuality, 0))), (select auth.uid()))
  returning id into v_id;

  -- Lote novo encerra o anterior (ele já cumpriu o que tinha de emitir).
  update public.ortho_billing_batches set status = 'encerrado'
   where case_id = p_case_id and id <> v_id and status = 'ativo';

  if v_amount > 0 then
    for i in 0 .. v_count - 1 loop
      v_month := (v_first + make_interval(months => i))::date;
      insert into public.ortho_charges
        (case_id, clinic_id, client_id, kind, reference_month, due_date, amount_cents, status, batch_id, created_by)
      values
        (p_case_id, v_c.clinic_id, v_c.client_id, 'mensalidade', v_month,
         (v_month + (coalesce(v_t.billing_day, 10) - 1)), v_amount, 'em_aberto', v_id, (select auth.uid()))
      on conflict (case_id, reference_month, kind) do update
        set batch_id = coalesce(public.ortho_charges.batch_id, excluded.batch_id);
    end loop;
  end if;

  -- O acordo do caso passa a ser o do lote (a ORTO9 muda o valor na renovação).
  update public.ortho_case_terms set
    monthly_fee_cents = v_amount,
    installments_count = v_count,
    billing_method = coalesce(p_billing_method, billing_method),
    punctuality_discount_percent = greatest(0, least(100, coalesce(p_punctuality, punctuality_discount_percent)))
  where case_id = p_case_id;

  perform public._ortho_log(p_case_id, 'lote_emitido',
    'Lote ' || v_seq || ' de mensalidades emitido: ' || v_count || ' mensalidades, '
    || to_char(v_first, 'MM/YYYY') || ' a ' || to_char(v_last, 'MM/YYYY'));
  return v_id;
end;
$$;
revoke execute on function public._ortho_emit_batch(uuid, integer, integer, text, numeric, date) from public, anon, authenticated;

create or replace function public.ortho_decide_batch(
  p_batch_id uuid,
  p_decision text,
  p_count integer default null,
  p_amount_cents integer default null,
  p_billing_method text default null,
  p_punctuality numeric default null,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b public.ortho_billing_batches;
  v_c public.ortho_cases;
  v_new uuid;
begin
  select * into v_b from public.ortho_billing_batches where id = p_batch_id;
  if v_b.id is null then raise exception 'NOT_FOUND'; end if;
  if not (public.ortho_can_manage(v_b.clinic_id) or public.ortho_can_settle(v_b.clinic_id)) then
    raise exception 'NOT_ALLOWED';
  end if;
  if p_decision not in ('renovar','nao_renovar') then raise exception 'INVALID_DECISION'; end if;
  select * into v_c from public.ortho_cases where id = v_b.case_id;
  if v_c.status <> 'em_tratamento' then raise exception 'INVALID_TRANSITION'; end if;

  update public.ortho_billing_batches set
    decision = p_decision, decided_by = (select auth.uid()), decided_at = now(),
    decision_note = nullif(btrim(p_note), '')
  where id = p_batch_id;

  if p_decision = 'renovar' then
    v_new := public._ortho_emit_batch(v_b.case_id,
      coalesce(p_count, v_b.installments_count),
      coalesce(p_amount_cents, v_b.amount_cents),
      coalesce(p_billing_method, v_b.billing_method),
      coalesce(p_punctuality, v_b.punctuality_discount_percent),
      null);  -- AP181 (0430): o mês de início é a conta de _ortho_emit_batch
    return v_new;
  end if;

  perform public._ortho_log(v_b.case_id, 'lote_nao_renovado',
    'Lote ' || v_b.seq || ' não será renovado' || coalesce(' — ' || nullif(btrim(p_note), ''), ''));
  return null;
end;
$$;
revoke execute on function public.ortho_decide_batch(uuid, text, integer, integer, text, numeric, text) from public, anon, authenticated;
grant execute on function public.ortho_decide_batch(uuid, text, integer, integer, text, numeric, text) to authenticated;

-- =============================================================================
-- CONFERÊNCIA (só contagens). Esperado: 1 · 1
--   1) o lote novo olha a última mensalidade não cancelada
--   2) a renovação não calcula mais o mês por conta própria
-- =============================================================================
select
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = '_ortho_emit_batch'
      and p.prosrc like '%ch.status <> ''cancelada''%') as lote_olha_cobranca_valida,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'ortho_decide_batch'
      and p.prosrc not like '%v_b.last_month + interval%') as renovacao_sem_conta_propria;

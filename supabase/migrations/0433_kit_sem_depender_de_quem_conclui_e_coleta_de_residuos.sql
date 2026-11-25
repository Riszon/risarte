-- =============================================================================
-- 0433 — O KIT DO ATENDIMENTO NÃO DEPENDE DE QUEM CONCLUI (OC-00186) E A
--        CONTA "COLETA DE RESÍDUOS DE SAÚDE" (OC-00018)
--
-- 1) OC-00186 (21/11/2026, treino, dentista): "Fiz DC mas não permitiu concluir
--    e salvar o atendimento" — atendimento de 30/10 em Londrina (outubro
--    FECHADO). Reproduzido como a dentista (transação desfeita): PERIOD_CLOSED,
--    pelo gatilho `consume_attendance_kit`.
--
--    ⚠️ ERRO DA 0411 (OC-00181): ela desviava a baixa para o dia da conclusão
--    quando `public.is_period_closed(...)` dizia "fechado" — e essa função
--    (0231) termina em `and public.can_see_clinic_finance(p_clinic_id)`: para
--    quem NÃO vê o financeiro (dentista, coordenador) ela responde "aberto".
--    O ensaio da 0411 rodou como Admin e passou; para o dentista o kit seguia
--    no mês fechado e o `fiscal_period_guard` (que não olha papel) recusava.
--    Agora a conferência é a MESMA do guard: direto em `fiscal_periods`.
--    `is_period_closed` não muda (as telas do Financeiro a usam assim).
--
-- 2) OC-00018 (19/11/2026, produção, Financeiro da Franqueadora): a despesa
--    fixa de coleta de resíduos não tinha conta. Entra 3.2.05 em Ocupação
--    (fixa, as duas pontas da rede), irmã de 3.2.04 Manutenção e limpeza.
--    Conta nova só entra por migração (a tela só ajusta fixo/variável,
--    alcance e código fiscal).
--
-- Idempotente. Não mexe em dado existente.
-- =============================================================================

create or replace function public.consume_attendance_kit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_line record;
  v_dia date;
  v_when date;
  v_reason text := 'Atendimento encerrado';
  v_was_done boolean := (TG_OP = 'UPDATE'
                         and coalesce(old.attendance::text, '') = 'done');
begin
  if coalesce(new.attendance::text, '') <> 'done' or v_was_done then
    return new;
  end if;
  if new.clinic_id is null then return new; end if;

  -- 0411 (1): a apresentação comercial não usa o material da cadeira.
  if new.type::text = 'commercial_presentation' then
    return new;
  end if;

  -- 0411 (2) + 0433: o dia do atendimento no relógio BRASILEIRO; mês fechado
  -- → o dia da conclusão. A conferência é a do `fiscal_period_guard` (direto
  -- na tabela), nunca `is_period_closed`, que depende de quem chama.
  v_dia := coalesce((new.starts_at at time zone 'America/Sao_Paulo')::date, public.today_br());
  v_when := v_dia;
  if exists (
    select 1 from public.fiscal_periods p
     where p.clinic_id = new.clinic_id
       and p.status = 'closed'
       and p.year = extract(year from v_dia)::integer
       and p.month = extract(month from v_dia)::integer
  ) then
    v_when := public.today_br();
    v_reason := 'Atendimento de ' || to_char(v_dia, 'DD/MM/YYYY')
             || ' encerrado em ' || to_char(v_when, 'DD/MM/YYYY')
             || ' (o mês do atendimento já estava fechado)';
  end if;

  -- Kit de atendimento da unidade vence o da rede (mesma cascata de sempre).
  for v_line in
    select ki.item_id, sum(ki.quantity) as quantity
    from public.stock_kits k
    join public.stock_kit_items ki on ki.kit_id = k.id
    where k.active and k.kind = 'atendimento'
      and (k.clinic_id = new.clinic_id
           or (k.clinic_id is null and not exists (
                 select 1 from public.stock_kits k2
                 where k2.active and k2.kind = 'atendimento'
                   and k2.clinic_id = new.clinic_id)))
    group by ki.item_id
  loop
    perform public.apply_stock_movement(
      p_clinic_id => new.clinic_id,
      p_item_id => v_line.item_id,
      p_kind => 'consumo',
      p_quantity => v_line.quantity,
      p_movement_date => v_when,
      p_reason => v_reason,
      p_source_type => 'appointment',
      p_source_id => new.id
    );
  end loop;

  return new;
end;
$$;
revoke execute on function public.consume_attendance_kit() from public, anon, authenticated;

insert into public.chart_of_accounts (code, name, parent_code, kind, nature, cost_behavior, scope, is_analytic) values
  ('3.2.05', 'Coleta de resíduos de saúde', '3.2', 'expense', 'operational', 'fixed', 'both', true)
on conflict (code) do nothing;

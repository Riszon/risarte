-- =============================================================================
-- 0411 — O KIT DO ATENDIMENTO NÃO TRAVA O "CONCLUIR" (OC-00181)
--
-- Relato (16/11/2026, treino, Admin Master): "apareceu a seguinte mensagem:
-- Não foi possível atualizar o atendimento. Admin não conseguiu avançar o
-- cliente." Reproduzido no treino (transação desfeita): o Concluir de duas
-- apresentações comerciais de 26 e 27/10 voltava PERIOD_CLOSED.
--
-- A cadeia: concluir → gatilho `consume_attendance_kit` (0218) dá baixa no kit
-- "atendimento" (gorro e babador) com a data do AGENDAMENTO → o lançamento do
-- consumo cai em OUTUBRO, mês já FECHADO na unidade → `fiscal_period_guard`
-- recusa → o atendimento inteiro volta atrás.
--
-- Decisões do dono (16/11/2026):
--   1) a APRESENTAÇÃO COMERCIAL não consome o kit de atendimento (gorro e
--      babador são da cadeira — na apresentação o cliente não senta nela);
--   2) a baixa continua no DIA DO ATENDIMENTO — agora o dia do BRASIL (era
--      `starts_at::date`, o dia de Greenwich: das 21h à meia-noite caía no dia
--      seguinte); se o mês desse dia estiver FECHADO, a baixa entra no dia em
--      que o atendimento foi CONCLUÍDO, e o motivo guarda a data original;
--   3) a tela traduz o PERIOD_CLOSED que ainda escapar (no código, mesmo commit).
--
-- Só a função muda (o gatilho é o mesmo). Idempotente. Não mexe em dado.
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

  -- 0411 (2): o dia do atendimento no relógio BRASILEIRO; mês fechado →
  -- o dia da conclusão, com a data original no motivo.
  v_dia := coalesce((new.starts_at at time zone 'America/Sao_Paulo')::date, public.today_br());
  v_when := v_dia;
  if public.is_period_closed(new.clinic_id, v_dia) then
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

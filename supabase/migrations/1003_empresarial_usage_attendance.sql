-- =============================================================================
-- 1003 — Empresarial: ligar a economia ao ATENDIMENTO (chegada e conclusão)
-- -----------------------------------------------------------------------------
-- Bug relatado pelo dono (30/07/2026): no "Extrato de benefícios e economia" as
-- colunas Chegada (check-in) e Fim do atendimento vinham sempre vazias.
--
-- Duas causas:
--   1. A 1000 procurava o atendimento por `direct_sale_items.session_id`, que
--      NUNCA é preenchido — o core fez o vínculo no sentido contrário
--      (`treatment_sessions.direct_sale_id`, migração 0180). Então o
--      `benefit_usage.appointment_id` nascia sempre nulo.
--   2. Mesmo com o vínculo certo, a economia é registrada no FECHAMENTO (venda
--      direta/negociação) e o atendimento acontece DEPOIS. Não há horário para
--      mostrar no momento em que a linha é criada.
--
-- Correção: quando a SESSÃO daquele procedimento é concluída, o atendimento
-- passa a ser carimbado na linha de economia correspondente. É de lá que saem a
-- chegada (checked_in_at) e a conclusão (done_at) no extrato.
--
-- Não mexe em `used_at` de propósito: a data de uso continua sendo a do
-- fechamento (é ela que controla carência/frequência); o extrato mostra a data
-- do atendimento quando existe.
-- Idempotente.
-- =============================================================================

-- Carimba o atendimento de uma sessão concluída na linha de economia do mesmo
-- cliente + procedimento que ainda não tem atendimento (a mais antiga primeiro).
create or replace function empresarial.attach_usage_appointment(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sess record;
  v_usage_id uuid;
begin
  select ts.client_id, ts.procedure_id, ts.appointment_id
    into v_sess
  from public.treatment_sessions ts
  where ts.id = p_session_id;

  if not found
     or v_sess.procedure_id is null
     or v_sess.appointment_id is null then
    return;
  end if;

  select bu.id into v_usage_id
  from empresarial.benefit_usage bu
  where bu.client_id = v_sess.client_id
    and bu.procedure_id = v_sess.procedure_id
    and bu.appointment_id is null
  order by bu.used_at asc
  limit 1;

  if v_usage_id is not null then
    update empresarial.benefit_usage
    set appointment_id = v_sess.appointment_id
    where id = v_usage_id;
  end if;
end $$;

create or replace function empresarial.session_attach_usage_trg()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'done'
     and (tg_op = 'INSERT' or old.status is distinct from 'done') then
    perform empresarial.attach_usage_appointment(new.id);
  end if;
  return null;
end $$;

drop trigger if exists empresarial_session_attach_usage on public.treatment_sessions;
create trigger empresarial_session_attach_usage
  after insert or update of status, appointment_id on public.treatment_sessions
  for each row execute function empresarial.session_attach_usage_trg();

grant execute on function empresarial.attach_usage_appointment(uuid)
  to authenticated, service_role;

-- Backfill: sessões JÁ concluídas carimbam as economias já registradas.
do $$
declare r record;
begin
  for r in
    select ts.id
    from public.treatment_sessions ts
    where ts.status = 'done'
      and ts.appointment_id is not null
      and ts.procedure_id is not null
    order by ts.created_at asc
  loop
    perform empresarial.attach_usage_appointment(r.id);
  end loop;
end $$;

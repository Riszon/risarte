-- =============================================================================
-- 0417 — AP175: sessão de plano nunca vira manutenção ortodôntica; a instalação
--        concluída inicia o caso (16/11/2026, sessão "módulo de ortodontia")
-- -----------------------------------------------------------------------------
-- O DEFEITO (confirmado no treino em transação desfeita, 16/11/2026):
--   1) Todo agendamento de sessão, início de tratamento ou retorno com o
--      ortodontista do caso virava manutenção — inclusive a sessão de OUTRO
--      procedimento do plano (no treino: uma sessão de Radiologia).
--   2) Concluir a sessão que fecha o procedimento de Ortodontia do plano pagava
--      DOIS repasses: o do procedimento (`_payout_accrue_block`) e o da
--      manutenção (`_ortho_complete_maintenance`).
--   3) Num caso sem ortodontista, a primeira sessão comum agendada com um
--      dentista da unidade fazia dele o ortodontista responsável (regra Q3).
--
-- A ARMADILHA DA ORDEM: a agenda grava o agendamento e SÓ DEPOIS liga as
-- sessões do plano (`link_appointment_sessions`, outra chamada). No INSERT o
-- gatilho não sabe que é sessão de plano. E ao concluir o atendimento a sessão
-- não feita é desligada (`treatment_session_id = null`, 0105/0176/0314).
--
-- A CORREÇÃO (decisões do dono, 16/11/2026):
--   a) `ortho_appointment_sync` passa a disparar também quando a ligação muda e
--      olha as DUAS ligações (`appointments.treatment_session_id` e
--      `treatment_sessions.appointment_id`). Sessão de plano → a manutenção que
--      tiver sido ligada no INSERT é solta (volta a "prevista" ou, se nasceu do
--      agendamento, é cancelada) e nada mais acontece. Mudar só a ligação nunca
--      cria manutenção.
--   b) A instalação é SÓ a sessão do plano (decisão O6): um repasse só, o do
--      procedimento. As manutenções contam a partir dela.
--   c) Concluir a sessão de um procedimento de Ortodontia com o caso
--      "aguardando início" INICIA o caso sozinho (data = a da sessão; o lote de
--      mensalidades nasce), e quem a fez vira o ortodontista se o caso ainda não
--      tinha um — gatilho próprio em `treatment_sessions` (`ortho_session_sync`).
--   d) A Q3 pela agenda só vale para o "Início de tratamento" CONCLUÍDO que não
--      é sessão de plano (o caso legado): nunca mais por agendamento.
--   e) `_ortho_begin_treatment` (interna) é o início do tratamento, usado pela
--      tela (`ortho_set_status`, mesma assinatura) e pela sessão.
--   f) Os dados: manutenção não realizada presa a sessão de plano é solta. A
--      realizada (que pode ter gerado repasse) NÃO é mexida: a conferência
--      conta, e o Financeiro decide (o repasse já pode estar em relatório).
--
-- NÃO MEXE: no repasse (`accrue_session_payout`, `_payout_accrue_block`), em
-- `ortho_deliver_retainers` nem em `_ortho_open_from_sale`. A sessão da
-- Jornada (0416) lê `ortho_cases.status` e tem gatilho próprio na passagem para
-- "contencao" — começar o caso por aqui passa por ele sem efeito (só reage a
-- "contencao").
--
-- Nada apaga dado. Idempotente.
-- =============================================================================

-- 1) Marca de origem da manutenção --------------------------------------------
-- Para soltar sem deixar sobra no cronograma: a que nasceu do agendamento é
-- cancelada; a prevista que só foi ligada volta a "prevista".
alter table public.ortho_maintenances
  add column if not exists from_appointment boolean not null default false;

-- 2) O início do tratamento, num lugar só --------------------------------------
create or replace function public._ortho_begin_treatment(
  p_case_id uuid,
  p_date date,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_c public.ortho_cases;
  v_t public.ortho_case_terms;
  v_date date := coalesce(p_date, public.today_br());
  v_reeval integer;
begin
  select * into v_c from public.ortho_cases where id = p_case_id;
  if v_c.id is null then return; end if;

  select s.reevaluation_interval_months into v_reeval
    from public.ortho_effective_settings(v_c.clinic_id) s;
  update public.ortho_cases set
    status = 'em_tratamento',
    start_date = coalesce(start_date, v_date),
    next_reevaluation_date = coalesce(next_reevaluation_date,
      (coalesce(start_date, v_date) + make_interval(months => coalesce(v_reeval, 6)))::date),
    finished_at = null, finish_reason = null,
    retainer_delivered_at = null, discharged_at = null,
    interrupted_at = null, interrupt_reason = null,
    suspended_at = null, suspend_reason = null
  where id = p_case_id;
  perform public.ortho_plan_maintenances(p_case_id);
  perform public._ortho_log(p_case_id, 'tratamento_iniciado',
    case when v_c.status = 'aguardando_inicio' then 'Tratamento iniciado em '
         when v_c.status = 'suspenso' then 'Tratamento retomado em '
         else 'Caso reaberto em ' end || to_char(v_date, 'DD/MM/YYYY')
    || coalesce(' — ' || nullif(btrim(p_reason), ''), ''));
  -- R7: no INÍCIO, o lote do acordo nasce (as N mensalidades). Retomar ou
  -- reabrir não emite sozinho: quem gere emite o lote novo na ficha.
  if v_c.status = 'aguardando_inicio'
     and not exists (select 1 from public.ortho_billing_batches b where b.case_id = p_case_id) then
    select * into v_t from public.ortho_case_terms where case_id = p_case_id;
    if coalesce(v_t.monthly_fee_cents, 0) > 0 then
      perform public._ortho_emit_batch(p_case_id, coalesce(v_t.installments_count, 12),
        v_t.monthly_fee_cents, v_t.billing_method, v_t.punctuality_discount_percent,
        date_trunc('month', coalesce(v_c.start_date, v_date))::date);
    end if;
  end if;
end;
$$;
revoke execute on function public._ortho_begin_treatment(uuid, date, text) from public, anon, authenticated;

-- 3) ortho_set_status: o ramo "em tratamento" passa a chamar a interna ---------
-- (mesma assinatura e mesmas recusas da 0335)
create or replace function public.ortho_set_status(
  p_case_id uuid, p_status text, p_reason text default null, p_date date default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_c public.ortho_cases;
  v_date date := coalesce(p_date, public.today_br());
begin
  select * into v_c from public.ortho_cases where id = p_case_id;
  if v_c.id is null then raise exception 'NOT_FOUND'; end if;
  if not public.ortho_can_manage(v_c.clinic_id) then raise exception 'NOT_ALLOWED'; end if;
  if p_status not in ('em_tratamento','contencao','finalizado','interrompido','suspenso') then
    raise exception 'INVALID_STATUS';
  end if;
  if p_status = v_c.status then return; end if;

  if p_status = 'em_tratamento' then
    if v_c.status not in ('aguardando_inicio','contencao','finalizado','interrompido','suspenso') then
      raise exception 'INVALID_TRANSITION';
    end if;
    if v_c.status in ('finalizado','interrompido')
       and exists (select 1 from public.ortho_cases
                    where client_id = v_c.client_id and id <> p_case_id
                      and status in ('aguardando_inicio','em_tratamento','contencao','suspenso')) then
      raise exception 'CASE_ALREADY_OPEN';
    end if;
    perform public._ortho_begin_treatment(p_case_id, v_date, p_reason);

  elsif p_status = 'contencao' then
    perform public.ortho_deliver_retainers(p_case_id, v_date, null, null, p_reason);

  elsif p_status = 'finalizado' then
    if v_c.status not in ('em_tratamento','contencao','suspenso') then raise exception 'INVALID_TRANSITION'; end if;
    update public.ortho_cases set
      status = 'finalizado',
      finished_at = coalesce(finished_at, v_date),
      discharged_at = v_date,
      finish_reason = coalesce(nullif(btrim(p_reason), ''), finish_reason)
    where id = p_case_id;
    update public.ortho_maintenances set status = 'cancelada', updated_at = now()
     where case_id = p_case_id and status = 'prevista' and appointment_id is null;
    update public.ortho_charges set status = 'cancelada', updated_at = now()
     where case_id = p_case_id and kind = 'mensalidade'
       and status in ('em_aberto','atrasada')
       and reference_month > date_trunc('month', v_date)::date;
    perform public._ortho_log(p_case_id, 'finalizado',
      case when v_c.status = 'contencao' then 'Alta do acompanhamento em '
           else 'Tratamento encerrado em ' end || to_char(v_date, 'DD/MM/YYYY')
      || coalesce(' — ' || nullif(btrim(p_reason), ''), ''));

  elsif p_status = 'suspenso' then
    -- Q5: nunca automático — quem gere suspende, com motivo.
    if v_c.status <> 'em_tratamento' then raise exception 'INVALID_TRANSITION'; end if;
    if nullif(btrim(p_reason), '') is null then raise exception 'REASON_REQUIRED'; end if;
    update public.ortho_cases set
      status = 'suspenso', suspended_at = v_date, suspend_reason = btrim(p_reason)
    where id = p_case_id;
    update public.ortho_maintenances set status = 'cancelada', updated_at = now()
     where case_id = p_case_id and status = 'prevista' and appointment_id is null;
    update public.ortho_charges set status = 'cancelada', updated_at = now()
     where case_id = p_case_id and kind = 'mensalidade'
       and status in ('em_aberto','atrasada')
       and reference_month > date_trunc('month', v_date)::date;
    update public.ortho_billing_batches set status = 'encerrado'
     where case_id = p_case_id and status = 'ativo';
    perform public._ortho_log(p_case_id, 'suspenso',
      'Tratamento suspenso em ' || to_char(v_date, 'DD/MM/YYYY') || ' — ' || btrim(p_reason));

  elsif p_status = 'interrompido' then
    if v_c.status not in ('aguardando_inicio','em_tratamento','contencao','suspenso') then
      raise exception 'INVALID_TRANSITION';
    end if;
    if nullif(btrim(p_reason), '') is null then raise exception 'REASON_REQUIRED'; end if;
    update public.ortho_cases set
      status = 'interrompido', interrupted_at = v_date, interrupt_reason = btrim(p_reason)
    where id = p_case_id;
    update public.ortho_maintenances set status = 'cancelada', updated_at = now()
     where case_id = p_case_id and status = 'prevista' and appointment_id is null;
    update public.ortho_charges set status = 'cancelada', updated_at = now()
     where case_id = p_case_id and kind = 'mensalidade'
       and status in ('em_aberto','atrasada')
       and reference_month > date_trunc('month', v_date)::date;
    update public.ortho_billing_batches set status = 'encerrado'
     where case_id = p_case_id and status = 'ativo';
    perform public._ortho_log(p_case_id, 'interrompido',
      'Tratamento interrompido em ' || to_char(v_date, 'DD/MM/YYYY') || ' — ' || btrim(p_reason));
  end if;
end;
$$;
revoke execute on function public.ortho_set_status(uuid, text, text, date) from public, anon, authenticated;
grant execute on function public.ortho_set_status(uuid, text, text, date) to authenticated;

-- 4) Soltar uma manutenção que não devia estar ligada ---------------------------
create or replace function public._ortho_release_maintenance(p_maintenance_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_m public.ortho_maintenances;
begin
  select * into v_m from public.ortho_maintenances where id = p_maintenance_id;
  if v_m.id is null or v_m.status = 'realizada' then return; end if;

  if v_m.from_appointment then
    update public.ortho_maintenances
       set status = 'cancelada', appointment_id = null, updated_at = now()
     where id = p_maintenance_id;
  else
    update public.ortho_maintenances
       set status = 'prevista', appointment_id = null, updated_at = now()
     where id = p_maintenance_id;
  end if;
  perform public._ortho_log(v_m.case_id, 'manutencao_desligada',
    'Manutenção ' || v_m.seq || ' desligada do agendamento — ' || p_reason);
end;
$$;
revoke execute on function public._ortho_release_maintenance(uuid, text) from public, anon, authenticated;

-- 5) A agenda ------------------------------------------------------------------
create or replace function public.ortho_appointment_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_m public.ortho_maintenances;
  v_c public.ortho_cases;
  v_date date;
  v_name text;
  v_plan boolean;
  v_link_only boolean;
begin
  begin
    -- AP175: é sessão de um plano? (as duas ligações: a primeira sessão fica
    -- no agendamento; as outras, na sessão)
    v_plan := new.treatment_session_id is not null
      or exists (select 1 from public.treatment_sessions ts where ts.appointment_id = new.id);
    v_link_only := tg_op = 'UPDATE'
      and new.treatment_session_id is distinct from old.treatment_session_id
      and new.status = old.status
      and new.type = old.type
      and new.starts_at = old.starts_at
      and new.provider_user_id is not distinct from old.provider_user_id;

    select * into v_m from public.ortho_maintenances where appointment_id = new.id;

    if v_plan then
      -- A sessão do plano é paga pelo plano; manutenção só no agendamento que
      -- não é sessão de plano. A ligada no INSERT (antes de a agenda ligar as
      -- sessões) é solta aqui. A instalação é tratada em `ortho_session_sync`.
      if v_m.id is not null then
        perform public._ortho_release_maintenance(v_m.id, 'o agendamento é sessão de um plano');
      end if;
      return null;
    end if;

    -- Desligar a sessão (atendimento concluído sem ela) não cria manutenção.
    if v_link_only then return null; end if;

    if v_m.id is null then
      if new.status::text = 'cancelled' then return null; end if;
      if new.type::text not in ('treatment_session','treatment_start','return_visit') then
        return null;
      end if;
      if new.provider_user_id is null then return null; end if;
      select * into v_c from public.ortho_cases c
       where c.client_id = new.client_id
         and c.status in ('aguardando_inicio','em_tratamento','contencao')
       order by c.created_at desc limit 1;
      if v_c.id is null then return null; end if;

      -- Q3 (AP175): só o "Início de tratamento" CONCLUÍDO que não é sessão de
      -- plano (o caso legado) define o ortodontista. Agendar nunca define.
      if v_c.orthodontist_id is null
         and new.type::text = 'treatment_start'
         and new.status::text = 'completed'
         and v_c.status = 'aguardando_inicio'
         and exists (select 1 from public.user_clinic_roles r
                      where r.user_id = new.provider_user_id and r.clinic_id = v_c.clinic_id
                        and r.role in ('dentist','clinical_coordinator')) then
        update public.ortho_cases set orthodontist_id = new.provider_user_id where id = v_c.id;
        v_c.orthodontist_id := new.provider_user_id;
        select full_name into v_name from public.profiles where id = new.provider_user_id;
        perform public._ortho_log(v_c.id, 'ortodontista_definido',
          'Ortodontista responsável assumido de quem fez a instalação: ' || coalesce(v_name, '—'));
      end if;

      if v_c.orthodontist_id is distinct from new.provider_user_id then
        return null;
      end if;
      v_date := (new.starts_at at time zone 'America/Sao_Paulo')::date;

      select * into v_m from public.ortho_maintenances m
       where m.case_id = v_c.id and m.status = 'prevista' and m.appointment_id is null
         and m.planned_date is not null and abs(m.planned_date - v_date) <= 45
       order by abs(m.planned_date - v_date), m.seq limit 1;

      if v_m.id is null then
        insert into public.ortho_maintenances
          (case_id, clinic_id, client_id, seq, planned_date, status, appointment_id, from_appointment)
        values (v_c.id, v_c.clinic_id, v_c.client_id,
                coalesce((select max(seq) from public.ortho_maintenances where case_id = v_c.id), 0) + 1,
                v_date, 'agendada', new.id, true)
        returning * into v_m;
      else
        update public.ortho_maintenances
           set appointment_id = new.id, status = 'agendada', updated_at = now()
         where id = v_m.id;
      end if;
    end if;

    if new.status::text = 'completed' then
      perform public._ortho_complete_maintenance(v_m.id, coalesce(new.done_at, new.starts_at), new.provider_user_id);
      -- O "Início de tratamento" concluído fora de plano (caso legado) também
      -- inicia o caso que aguardava.
      if new.type::text = 'treatment_start' then
        select * into v_c from public.ortho_cases where id = v_m.case_id;
        if v_c.status = 'aguardando_inicio' then
          perform public._ortho_begin_treatment(v_c.id,
            (coalesce(new.done_at, new.starts_at) at time zone 'America/Sao_Paulo')::date,
            'instalação concluída no atendimento');
        end if;
      end if;
    elsif new.status::text = 'no_show' then
      update public.ortho_maintenances set status = 'faltou', updated_at = now()
       where id = v_m.id and status <> 'realizada';
      perform public.ortho_plan_maintenances(v_m.case_id);
    elsif new.status::text = 'cancelled' then
      update public.ortho_maintenances
         set status = case when status = 'agendada' then 'prevista' else status end,
             appointment_id = null, updated_at = now()
       where id = v_m.id and status in ('agendada','faltou');
    elsif v_m.status in ('prevista','faltou') then
      update public.ortho_maintenances set status = 'agendada', updated_at = now()
       where id = v_m.id;
    end if;
  exception when others then
    raise warning 'ortho_appointment_sync (% em %): %', tg_op, new.id, sqlerrm;
  end;
  return null;
end;
$$;
revoke execute on function public.ortho_appointment_sync() from public, anon, authenticated;

drop trigger if exists appointments_ortho_sync on public.appointments;
create trigger appointments_ortho_sync
  after insert or update of status, provider_user_id, starts_at, type, treatment_session_id
  on public.appointments
  for each row execute function public.ortho_appointment_sync();

-- 6) A instalação: a sessão de Ortodontia concluída ----------------------------
create or replace function public.ortho_session_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_c public.ortho_cases;
  v_who uuid;
  v_name text;
begin
  begin
    if new.status <> 'done' or old.status is not distinct from 'done' then return null; end if;
    if new.procedure_id is null then return null; end if;
    if not exists (select 1 from public.procedures p
                    where p.id = new.procedure_id and p.specialty ilike '%ortod%') then
      return null;
    end if;

    select * into v_c from public.ortho_cases c
     where c.client_id = new.client_id and c.status = 'aguardando_inicio'
     order by c.created_at desc limit 1;
    if v_c.id is null then return null; end if;

    -- Q3: quem fez a instalação vira o ortodontista, se o caso não tinha um.
    v_who := coalesce(new.executed_by, new.planner_provider_id);
    if v_c.orthodontist_id is null and v_who is not null then
      update public.ortho_cases set orthodontist_id = v_who where id = v_c.id;
      select full_name into v_name from public.profiles where id = v_who;
      perform public._ortho_log(v_c.id, 'ortodontista_definido',
        'Ortodontista responsável assumido de quem fez a instalação: ' || coalesce(v_name, '—'));
    end if;

    perform public._ortho_begin_treatment(v_c.id,
      coalesce((new.done_at at time zone 'America/Sao_Paulo')::date, public.today_br()),
      'instalação concluída (sessão do plano)');
  exception when others then
    raise warning 'ortho_session_sync (%): %', new.id, sqlerrm;
  end;
  return null;
end;
$$;
revoke execute on function public.ortho_session_sync() from public, anon, authenticated;

drop trigger if exists treatment_sessions_ortho_sync on public.treatment_sessions;
create trigger treatment_sessions_ortho_sync
  after update of status on public.treatment_sessions
  for each row execute function public.ortho_session_sync();

-- 7) Os dados: soltar o que ficou preso ----------------------------------------
-- Manutenção NÃO realizada presa a um agendamento que é sessão de plano. A que
-- nasceu do agendamento (criada junto com ele) é cancelada; a prevista que só
-- foi ligada volta a "prevista". A realizada fica: a conferência conta.
update public.ortho_maintenances m
   set from_appointment = true
  from public.appointments a
 where a.id = m.appointment_id
   and m.from_appointment = false
   and m.created_at >= a.created_at - interval '1 minute';

do $$
declare
  r record;
begin
  for r in
    select m.id from public.ortho_maintenances m
      join public.appointments a on a.id = m.appointment_id
     where m.status <> 'realizada'
       and (a.treatment_session_id is not null
            or exists (select 1 from public.treatment_sessions ts where ts.appointment_id = a.id))
  loop
    perform public._ortho_release_maintenance(r.id, 'o agendamento é sessão de um plano (correção AP175)');
  end loop;
end $$;

-- =============================================================================
-- CONFERÊNCIA (o dono roda depois; esperado: 0 · N · 1 · 1 · 0)
--   1) manutenções NÃO realizadas ainda presas a sessão de plano → 0
--   2) manutenções REALIZADAS presas a sessão de plano (o Financeiro olha) → N
--   3) o gatilho da agenda olha a ligação da sessão → 1
--   4) o gatilho da instalação existe → 1
--   5) as internas sem login → 0
-- =============================================================================
select
  (select count(*) from public.ortho_maintenances m
     join public.appointments a on a.id = m.appointment_id
    where m.status <> 'realizada'
      and (a.treatment_session_id is not null
           or exists (select 1 from public.treatment_sessions ts where ts.appointment_id = a.id))) as presas_nao_realizadas,
  (select count(*) from public.ortho_maintenances m
     join public.appointments a on a.id = m.appointment_id
    where m.status = 'realizada'
      and (a.treatment_session_id is not null
           or exists (select 1 from public.treatment_sessions ts where ts.appointment_id = a.id))) as realizadas_para_o_financeiro,
  (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
    where c.relname = 'appointments' and t.tgname = 'appointments_ortho_sync'
      and pg_get_triggerdef(t.oid) ilike '%treatment_session_id%') as gatilho_da_agenda,
  (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
    where c.relname = 'treatment_sessions' and t.tgname = 'treatment_sessions_ortho_sync') as gatilho_da_instalacao,
  (select count(*) from unnest(array[
      'public._ortho_begin_treatment(uuid,date,text)',
      'public._ortho_release_maintenance(uuid,text)',
      'public.ortho_session_sync()']) f
    where has_function_privilege('anon', f, 'execute')
       or has_function_privilege('authenticated', f, 'execute')) as internas_abertas;

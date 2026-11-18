-- =============================================================================
-- 0431 — AP180 e AP182 (18/11/2026)
-- =============================================================================
-- Achados no roteiro de teste da ortodontia (treino, 17-18/11/2026); planos
-- docs/ortodontia/AP180-PLANO.md e AP182-PLANO.md, aprovados pelo dono em
-- 18/11/2026.
--
-- 1) AP180 — "Usar este pacote no fechamento". O contrato assinado por um
--    pacote que não nasceu da negociação (por exemplo, enviado pela ficha)
--    não marcava a venda, e o Fechamento recusava reenviar ("já assinado").
--    A porta commercial_use_signed_package marca o contrato pelo mesmo
--    caminho da assinatura (_commercial_close_step_raw, origem
--    'assinatura_digital'), sem o paciente assinar de novo. Quem pode: quem
--    fecha a venda (commercial_can_close). O pacote tem de ser do paciente,
--    assinado por todos, desta negociação e com contrato ou orçamento.
--    (A ficha passa a criar o pacote já ligado à negociação aceita — isso é
--    do app, src/lib/signatures/origem.ts.)
--
-- 2) AP182 — cancelar o agendamento devolvia a "prevista" a manutenção que
--    nasceu dele (from_appointment). Recriada ortho_appointment_sync a partir
--    da 0425, com só o ramo do cancelamento seguindo a regra da 0417. E as
--    fantasmas que já existem (criadas por agendamento, prevista, sem
--    agendamento) passam a cancelada — só a situação muda, nada é apagado.
--
-- Ao recriar ortho_appointment_sync, partir DESTA migração.
-- =============================================================================

-- 1) AP180 ---------------------------------------------------------------------
create or replace function public.commercial_use_signed_package(
  p_negotiation_id uuid,
  p_package_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_neg public.plan_negotiations;
  v_pkg public.signature_packages;
begin
  select * into v_neg from public.plan_negotiations where id = p_negotiation_id;
  if v_neg.id is null then raise exception 'NOT_FOUND'; end if;
  if not public.commercial_can_close(v_neg.clinic_id) then raise exception 'NOT_ALLOWED'; end if;

  select * into v_pkg from public.signature_packages where id = p_package_id;
  if v_pkg.id is null or v_pkg.client_id is distinct from v_neg.client_id then
    raise exception 'PACKAGE_NOT_FOUND';
  end if;
  if v_pkg.status <> 'signed' then raise exception 'PACKAGE_NOT_SIGNED'; end if;
  if not ((v_pkg.origin_type = 'plan_negotiation' and v_pkg.origin_id = p_negotiation_id)
          or (v_pkg.cover_data ->> 'negotiation_id') = p_negotiation_id::text) then
    raise exception 'PACKAGE_OTHER_NEGOTIATION';
  end if;
  if not exists (
    select 1 from public.signature_package_items i
      join public.signature_templates t on t.id = i.template_id
     where i.package_id = v_pkg.id and t.kind in ('contract', 'budget')
  ) then
    raise exception 'PACKAGE_WITHOUT_CONTRACT';
  end if;

  return public._commercial_close_step_raw(
    p_negotiation_id, 'contract', true, (select auth.uid()), 'assinatura_digital', v_pkg.id);
end;
$$;
revoke execute on function public.commercial_use_signed_package(uuid, uuid) from public, anon, authenticated;
grant execute on function public.commercial_use_signed_package(uuid, uuid) to authenticated;

-- 2) AP182 ---------------------------------------------------------------------
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
      -- AP176: só o tipo próprio vira manutenção. O "Início de tratamento"
      -- fora de plano segue sendo a instalação do caso que aguarda (legado).
      if new.type::text not in ('ortho_maintenance','treatment_start') then
        return null;
      end if;
      if new.provider_user_id is null then return null; end if;
      select * into v_c from public.ortho_cases c
       where c.client_id = new.client_id
         and c.status in ('aguardando_inicio','em_tratamento','contencao')
       order by c.created_at desc limit 1;
      if v_c.id is null then return null; end if;
      if new.type::text = 'ortho_maintenance' and v_c.status not in ('em_tratamento','contencao') then
        return null;
      end if;
      if new.type::text = 'treatment_start' and v_c.status <> 'aguardando_inicio' then
        return null;
      end if;

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

      -- Com o tipo próprio, a manutenção é do caso seja quem for que atenda
      -- (o termo: outro ortodontista da equipe pode continuar); o repasse vai
      -- para quem fez. O início fora de plano continua exigindo o ortodontista.
      if new.type::text <> 'ortho_maintenance'
         and v_c.orthodontist_id is distinct from new.provider_user_id then
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
      -- AP182 (0431): a manutenção que NASCEU deste agendamento (extra, controle
      -- da contenção) é cancelada junto; a do cronograma volta a prevista. A
      -- mesma regra de _ortho_release_maintenance (0417).
      update public.ortho_maintenances
         set status = case when from_appointment then 'cancelada'
                           when status = 'agendada' then 'prevista'
                           else status end,
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

update public.ortho_maintenances
   set status = 'cancelada', updated_at = now()
 where from_appointment and status = 'prevista' and appointment_id is null;

-- =============================================================================
-- CONFERÊNCIA (só contagens). Esperado: 1 · 1 · 0
--   1) a porta do pacote já assinado existe
--   2) o cancelamento da agenda olha from_appointment
--   3) manutenções fantasmas que sobraram
-- =============================================================================
select
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'commercial_use_signed_package') as porta_do_pacote,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'ortho_appointment_sync'
      and p.prosrc like '%when from_appointment then ''cancelada''%') as cancelamento_segue_a_0417,
  (select count(*) from public.ortho_maintenances
    where from_appointment and status = 'prevista' and appointment_id is null) as fantasmas;

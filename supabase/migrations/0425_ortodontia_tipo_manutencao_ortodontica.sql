-- =============================================================================
-- 0425 — AP176: o tipo de agendamento "Manutenção ortodôntica" (17/11/2026,
--        sessão "módulo de ortodontia"; etapa B do AP175)
-- -----------------------------------------------------------------------------
-- Até aqui um agendamento genérico (sessão de tratamento ou retorno) com o
-- ortodontista do caso virava manutenção — por exemplo, um retorno por outro
-- motivo. A 0417 já impediu que SESSÃO DE PLANO virasse; esta fecha o resto.
--
-- Decisões do dono (17/11/2026):
--   * Tipo novo `ortho_maintenance` ("Manutenção ortodôntica"): o ÚNICO que vira
--     manutenção do caso (em tratamento ou em acompanhamento — o controle da
--     contenção usa o mesmo tipo).
--   * Atendem: dentista e Coordenador (como o retorno).
--   * Os agendamentos que JÁ estão ligados a manutenções continuam ligados (a
--     regra nova vale para os agendamentos novos; a parte que trata a situação
--     de um agendamento já ligado não muda).
--   * Com o tipo próprio, a manutenção liga ao caso seja quem for que atenda;
--     o repasse vai para quem fez (`_ortho_complete_maintenance`, inalterada).
--   * O "Início de tratamento" fora de plano continua sendo a instalação do caso
--     que aguarda (o caso legado) — como na 0417.
--   * Outro tratamento em paralelo: dois atendimentos seguidos no mesmo dia (a
--     agenda sugere; nada no banco).
--
-- ⚠️ O VALOR NOVO DO ENUM só pode ser USADO depois do commit: nenhum comando
-- desta migração faz `'ortho_maintenance'::appointment_type` — as funções
-- comparam texto (`p_type::text`, `new.type::text`). Idempotente.
-- Nada apaga dado.
-- =============================================================================

alter type public.appointment_type add value if not exists 'ortho_maintenance';

-- 1) Quem atende cada tipo (ESPELHO de TYPE_PROVIDER_ROLES) -------------------
create or replace function public._provider_serves_type(
  p_clinic_id uuid, p_type public.appointment_type, p_provider uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with permitidas(funcao) as (
    -- ESPELHO de TYPE_PROVIDER_ROLES (src/lib/appointments.ts).
    select unnest(case p_type::text
      when 'evaluation'              then array['clinical_coordinator']
      when 'commercial_presentation' then array['commercial_consultant']
      when 'treatment_start'         then array['dentist']
      when 'treatment_session'       then array['dentist']
      when 'reevaluation'            then array['clinical_coordinator']
      when 'return_visit'            then array['clinical_coordinator', 'dentist']
      when 'urgency'                 then array['clinical_coordinator', 'dentist']
      when 'emergency'               then array['clinical_coordinator', 'dentist']
      when 'revision'                then array['dentist']
      when 'redo'                    then array['dentist']
      when 'ortho_maintenance'       then array['clinical_coordinator', 'dentist']
      else array[]::text[]
    end)
  )
  select
    -- Função da pessoa NA unidade do agendamento.
    exists (
      select 1
        from public.user_clinic_roles ucr
       where ucr.clinic_id = p_clinic_id
         and ucr.user_id = p_provider
         and ucr.role::text in (select funcao from permitidas)
    )
    -- O Consultor comercial mora na Franqueadora: vale o acesso à unidade.
    or (
      'commercial_consultant' in (select funcao from permitidas)
      and exists (
        select 1
          from public.providers_with_access(p_clinic_id, 'commercial_consultant'::public.user_role) c
         where c.user_id = p_provider
      )
    );
$$;
revoke execute on function public._provider_serves_type(uuid, public.appointment_type, uuid) from public, anon, authenticated;
grant execute on function public._provider_serves_type(uuid, public.appointment_type, uuid) to authenticated;

-- 2) A agenda: só a "Manutenção ortodôntica" vira manutenção -----------------
-- (a partir da 0417; muda só a criação da manutenção)
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

-- =============================================================================
-- CONFERÊNCIA (o dono roda depois; esperado: 1 · 1 · 1 · 0)
--   1) o tipo novo existe
--   2) quem atende conhece o tipo novo
--   3) a agenda só cria manutenção pelo tipo novo (ou pelo início legado)
--   4) a função do gatilho fechada para quem não está logado
-- =============================================================================
select
  (select count(*) from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'appointment_type' and e.enumlabel = 'ortho_maintenance') as tipo_novo,
  (select count(*) from pg_proc p where p.proname = '_provider_serves_type'
      and pg_get_functiondef(p.oid) like '%''ortho_maintenance''%') as quem_atende,
  (select count(*) from pg_proc p where p.proname = 'ortho_appointment_sync'
      and pg_get_functiondef(p.oid) like '%not in (''ortho_maintenance'',''treatment_start'')%') as agenda,
  (select count(*) from pg_proc p where p.proname = 'ortho_appointment_sync'
      and (has_function_privilege('anon', p.oid, 'execute')
           or has_function_privilege('authenticated', p.oid, 'execute'))) as aberta;

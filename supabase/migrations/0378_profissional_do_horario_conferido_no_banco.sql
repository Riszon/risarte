-- =============================================================================
-- 0378 — O PROFISSIONAL DO HORÁRIO É CONFERIDO NO BANCO (AP133, resto do AP56)
-- -----------------------------------------------------------------------------
-- Desde a 0.410.0 a agenda recusa, NO SERVIDOR DO APP, o profissional que não
-- tem na unidade uma função que atende aquele tipo de compromisso
-- (`recusaDoProfissional`). As regras do banco (0016, 0064, 0171) conferiam só
-- quem CHAMA: um pedido direto à API ainda gravava qualquer pessoa como
-- profissional do horário — e o profissional do horário registra chegada e
-- chama o paciente.
--
-- O QUE ENTRA:
--   1. `_provider_serves_type(unidade, tipo, pessoa)` — a regra, num lugar só.
--      É o espelho de `TYPE_PROVIDER_ROLES` (src/lib/appointments.ts) e lê as
--      mesmas duas fontes da janela de agendamento: as funções da pessoa NA
--      unidade e, para a apresentação comercial, os Consultores com acesso
--      (`providers_with_access` — o papel comercial mora na Franqueadora).
--      O teste `profissional-do-horario-no-banco.test.ts` compara as duas
--      listas: mudou uma, muda a outra.
--   2. Gatilho em `appointments` (inclusão, e alteração do profissional ou do
--      tipo): recusa com `PROVIDER_ROLE_MISMATCH`.
--      ⚠️ Vale para o que chega pela API (papel `authenticated`). As funções
--      do banco que gravam agendamento (rodam como dono: retorno do controle de
--      qualidade, transferência de cliente, fim da avaliação) seguem como
--      sempre — elas decidem o profissional pela regra delas.
--      ⚠️ SEM `security definer` DE PROPÓSITO: com ele, `current_user` aqui
--      dentro seria sempre o dono e a trava nunca valeria (lição da 0306).
--   3. `swap_appointment_provider` (troca de última hora, 0064) passa a conferir
--      o NOVO profissional pela mesma regra. É a definição em vigor (0064) com
--      uma conferência a mais; o resto não mudou.
--
-- Agendamento SEM profissional continua passando (a coluna aceita vazio).
-- Agendamentos já gravados não são tocados: o gatilho só confere quando o
-- profissional ou o tipo MUDAM.
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) A regra
-- -----------------------------------------------------------------------------
create or replace function public._provider_serves_type(
  p_clinic_id uuid,
  p_type public.appointment_type,
  p_provider uuid
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

-- O gatilho roda como QUEM CHAMA (ver o aviso acima), então a regra precisa
-- responder a quem está logado. Ela só diz sim ou não.
revoke execute on function public._provider_serves_type(uuid, public.appointment_type, uuid) from public, anon, authenticated;
grant execute on function public._provider_serves_type(uuid, public.appointment_type, uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 2) O gatilho
-- -----------------------------------------------------------------------------
create or replace function public.appointment_provider_role_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- Só o que chega pela API. Função do banco (dono) e chave de serviço passam.
  if current_user <> 'authenticated' then
    return new;
  end if;
  if new.provider_user_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and new.provider_user_id is not distinct from old.provider_user_id
     and new.type is not distinct from old.type then
    return new;
  end if;
  -- `coalesce`: guarda que não consegue conferir FECHA (lição do AP65).
  if not coalesce(public._provider_serves_type(new.clinic_id, new.type, new.provider_user_id), false) then
    raise exception 'PROVIDER_ROLE_MISMATCH';
  end if;
  return new;
end;
$$;
revoke execute on function public.appointment_provider_role_guard() from public, anon;

drop trigger if exists appointments_provider_role_guard on public.appointments;
create trigger appointments_provider_role_guard
  before insert or update of provider_user_id, type on public.appointments
  for each row execute function public.appointment_provider_role_guard();

-- -----------------------------------------------------------------------------
-- 3) A troca de última hora confere o novo profissional
-- -----------------------------------------------------------------------------
-- A função da 0064 roda como dono (o gatilho acima não a alcança). Em vez de
-- copiar o corpo inteiro dela — e arriscar divergir do que está no banco —, a
-- conferência entra por uma PORTA: a função de sempre vira `_..._raw`, e a
-- porta com o nome de sempre confere e chama a original. Mesmo desenho da 0282.
do $$
begin
  if to_regprocedure('public._swap_appointment_provider_raw(uuid, uuid, text)') is null then
    alter function public.swap_appointment_provider(uuid, uuid, text)
      rename to _swap_appointment_provider_raw;
  end if;
end $$;
revoke execute on function public._swap_appointment_provider_raw(uuid, uuid, text) from public, anon, authenticated;

create or replace function public.swap_appointment_provider(
  p_appointment_id uuid,
  p_new_provider uuid,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic uuid;
  v_type public.appointment_type;
begin
  select a.clinic_id, a.type into v_clinic, v_type
    from public.appointments a where a.id = p_appointment_id;
  -- Agendamento inexistente e quem não pode trocar: a original responde
  -- (APPOINTMENT_NOT_FOUND / NOT_ALLOWED), com as frases de sempre.
  if v_clinic is not null
     and p_new_provider is not null
     and (
       public.is_admin_master()
       or public.has_role_in_clinic(
            v_clinic, array['receptionist', 'unit_manager']::public.user_role[])
     )
     and not coalesce(public._provider_serves_type(v_clinic, v_type, p_new_provider), false)
  then
    raise exception 'PROVIDER_ROLE_MISMATCH';
  end if;
  perform public._swap_appointment_provider_raw(p_appointment_id, p_new_provider, p_reason);
end;
$$;
revoke execute on function public.swap_appointment_provider(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.swap_appointment_provider(uuid, uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- Conferência (só contagens)
-- -----------------------------------------------------------------------------
select
  (select count(*) from pg_trigger
    where tgname = 'appointments_provider_role_guard' and not tgisinternal)
    as gatilho_esperado_1,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('swap_appointment_provider', '_swap_appointment_provider_raw'))
    as porta_e_original_esperado_2,
  has_function_privilege('anon', 'public.swap_appointment_provider(uuid, uuid, text)', 'execute')
    as sem_login_troca_esperado_false,
  has_function_privilege('authenticated', 'public._swap_appointment_provider_raw(uuid, uuid, text)', 'execute')
    as logado_chama_a_original_esperado_false,
  has_function_privilege('anon', 'public._provider_serves_type(uuid, public.appointment_type, uuid)', 'execute')
    as sem_login_regra_esperado_false,
  -- Quantos agendamentos FUTUROS de hoje não passariam na regra (não são
  -- tocados; é só para saber se há algo a acertar à mão).
  (select count(*) from public.appointments a
    where a.provider_user_id is not null
      and a.starts_at > now()
      and a.status in ('scheduled', 'confirmed')
      and not public._provider_serves_type(a.clinic_id, a.type, a.provider_user_id))
    as futuros_fora_da_regra_hoje;

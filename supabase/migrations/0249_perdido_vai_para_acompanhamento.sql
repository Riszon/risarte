-- =============================================================================
-- 0249 — Perdido ou cancelado na Fase 4 vai para o ACOMPANHAMENTO (Fase 7)
-- -----------------------------------------------------------------------------
-- Decisão do dono, 08/09/2026, a partir do relato OC-00003.
--
-- O PROBLEMA REAL não era o cartão: era o cliente ficar PRESO na Fase 4.
--
-- A agenda deriva o tipo de compromisso da fase (regra do dono: primeira vez =
-- Avaliação; quem volta = Reavaliação). Para quem está na Fase 4, a agenda
-- oferece só Apresentação comercial + urgência/emergência/retorno/revisão/
-- refação. **Reavaliação não aparece.** Então o cliente que a clínica deu por
-- perdido, e que meses depois liga querendo voltar, não podia nem ser agendado
-- para uma nova avaliação — que é justamente o que ele precisa quando já passou
-- tempo demais desde a última.
--
-- Daí a regra: **encerrou no Comercial estando na Fase 4, vai para a Fase 7**,
-- que é a fase de prevenção, retorno e RESGATE. É onde este cliente pertence.
--
-- O QUE ESTA MIGRAÇÃO FAZ
--
--   1. Gatilho: cartão vira 'perdido'/'cancelado' e o cliente está na Fase 4 →
--      move para a Fase 7, com histórico e auditoria.
--   2. A regra de ativo/inativo aprende o caso: parado por perda conta como
--      inativo já, e volta a ativo SOZINHO quando houver atendimento novo.
--   3. Move os que já estão nessa situação hoje.
--
-- O QUE NÃO SE PERDE: a passagem de fase é registrada em `journey_phase_history`
-- como qualquer outra; o cartão continua com o motivo e a data da perda; e o
-- quadro do Comercial busca as Fases 4 e 5 **mais os encerrados**, então o caso
-- continua aparecendo no Histórico do cockpit. Nada some de lugar nenhum.
--
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) O GATILHO
-- -----------------------------------------------------------------------------
-- ⚠️ ESCUTA INSERT E UPDATE. A lição da 0218: existe fluxo que nasce pronto —
-- um cartão pode ser criado já encerrado (importação, correção), e um gatilho
-- que só ouvisse UPDATE deixaria esse caso para trás em silêncio.
--
-- Move SÓ quem está na Fase 4. Quem já passou para o tratamento (Fase 5) não
-- volta para trás por causa de um cartão comercial: o clínico aconteceu, e
-- fingir que não seria pior que o problema original.
create or replace function public.commercial_lost_moves_to_followup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phase public.journey_phase;
  v_clinic uuid;
  v_user uuid := (select auth.uid());
begin
  if new.stage not in ('perdido', 'cancelado') then
    return new;
  end if;
  -- No UPDATE, só reage quando o estágio MUDOU para encerrado. Sem isto,
  -- qualquer edição do cartão já encerrado repetiria a movimentação e encheria
  -- o histórico de passagens que não aconteceram.
  if tg_op = 'UPDATE' and old.stage = new.stage then
    return new;
  end if;

  select journey_phase, clinic_id into v_phase, v_clinic
  from public.clients where id = new.client_id;

  if v_phase is distinct from 'commercial_conversion'::public.journey_phase then
    return new;
  end if;

  -- Mesma sequência que o check-in usa para mover sozinho (0032): fecha a
  -- passagem aberta, abre a nova, atualiza o cliente. Um caminho só para "mover
  -- fase automaticamente" — dois caminhos divergem.
  update public.journey_phase_history set exited_at = now()
   where client_id = new.client_id and exited_at is null;

  insert into public.journey_phase_history (client_id, clinic_id, phase, moved_by)
  values (new.client_id, v_clinic, 'follow_up', v_user);

  update public.clients
     set journey_phase = 'follow_up',
         phase_entered_at = now(),
         -- O sub-status era do trâmite comercial/clínico; na Fase 7 não vale
         -- mais, e deixá-lo faria a ficha mostrar um estado que não existe.
         journey_status = null
   where id = new.client_id;

  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values (v_user, v_clinic, 'update', 'client_journey', new.client_id::text,
          jsonb_build_object('from', 'commercial_conversion', 'to', 'follow_up',
                             'via', 'comercial_' || new.stage));

  return new;
end;
$$;

drop trigger if exists commercial_lost_moves_to_followup on public.commercial_cards;
create trigger commercial_lost_moves_to_followup
  after insert or update of stage on public.commercial_cards
  for each row execute function public.commercial_lost_moves_to_followup();

-- -----------------------------------------------------------------------------
-- 2) A REGRA DE ATIVO/INATIVO APRENDE O CASO
-- -----------------------------------------------------------------------------
-- ⚠️ MARCAR "inativo" À MÃO NÃO GRUDA. O campo é recalculado por rotina diária
-- (0020) e por gatilho a cada mudança de fase e de agendamento (0131) — uma
-- escrita manual seria desfeita na madrugada seguinte, sem ninguém entender por
-- quê. Então o "inativo" que o dono pediu entra como REGRA.
--
-- A regra: quem está na Fase 7 com o cartão encerrado está inativo **desde já**,
-- sem esperar o prazo de inatividade. E volta a ativo **sozinho** no momento em
-- que existir um atendimento marcado depois da perda — que é o instante em que
-- o cliente voltou a se mover.
--
-- As DUAS funções mudam juntas (a de um cliente e a de todos). Régua que existe
-- em duas versões diverge, e a hora em que divergir é a hora em que alguém
-- precisa confiar nela.

create or replace function public.followup_parked_by_commercial(p_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.commercial_cards cc
     where cc.client_id = p_client_id
       and cc.stage in ('perdido', 'cancelado')
       and not exists (
         select 1 from public.appointments a
          where a.client_id = p_client_id
            and a.starts_at > cc.updated_at
            and a.status <> 'cancelled'
       )
  );
$$;

comment on function public.followup_parked_by_commercial(uuid) is
  'Cliente parado na Fase 7 por perda/cancelamento no Comercial, sem atendimento novo depois disso. Usado pela regra de ativo/inativo.';

create or replace function public.recompute_client_activity_one(p_client_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.clients c
  set status = case when (
    case c.journey_phase
      when 'acquisition' then
        (now()::date - c.phase_entered_at::date)
          > public.inactivity_threshold(c.clinic_id, 'phase1_max_days')
      when 'clinical_conversion' then
        (now()::date - c.phase_entered_at::date)
          > public.inactivity_threshold(c.clinic_id, 'phase2_max_days')
      when 'commercial_conversion' then
        (now()::date - c.phase_entered_at::date)
          > public.inactivity_threshold(c.clinic_id, 'phase4_max_days')
      when 'treatment_start' then
        not exists (
          select 1 from public.appointments a
          where a.client_id = c.id and a.starts_at > now()
            and a.status in ('scheduled', 'confirmed')
        )
        and coalesce(
          (select now()::date - max(a.starts_at)::date
             from public.appointments a where a.client_id = c.id), 99999)
          > public.inactivity_threshold(c.clinic_id, 'phase5_6_no_appt_days')
      when 'reevaluation' then
        not exists (
          select 1 from public.appointments a
          where a.client_id = c.id and a.starts_at > now()
            and a.status in ('scheduled', 'confirmed')
        )
        and coalesce(
          (select now()::date - max(a.starts_at)::date
             from public.appointments a where a.client_id = c.id), 99999)
          > public.inactivity_threshold(c.clinic_id, 'phase5_6_no_appt_days')
      when 'planning_center' then
        coalesce(
          (select now()::date - max(a.starts_at)::date
             from public.appointments a
             where a.client_id = c.id
               and (a.status = 'completed' or a.attendance = 'done')),
          (now()::date - c.created_at::date))
          > public.inactivity_threshold(c.clinic_id, 'no_attendance_days')
      when 'follow_up' then
        -- 0249: parado por perda no Comercial conta como inativo já.
        public.followup_parked_by_commercial(c.id)
        or coalesce(
          (select now()::date - max(a.starts_at)::date
             from public.appointments a where a.client_id = c.id),
          (now()::date - c.created_at::date))
          > public.inactivity_threshold(c.clinic_id, 'phase7_inactivity_days')
      else false
    end
  ) then 'inactive'::public.client_status
    else 'active'::public.client_status end
  where c.id = p_client_id
    and c.status <> 'anonymized';
$$;

create or replace function public.recompute_client_activity(p_clinic_id uuid default null)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.clients c
  set status = case when (
    case c.journey_phase
      when 'acquisition' then
        (now()::date - c.phase_entered_at::date)
          > public.inactivity_threshold(c.clinic_id, 'phase1_max_days')
      when 'clinical_conversion' then
        (now()::date - c.phase_entered_at::date)
          > public.inactivity_threshold(c.clinic_id, 'phase2_max_days')
      when 'commercial_conversion' then
        (now()::date - c.phase_entered_at::date)
          > public.inactivity_threshold(c.clinic_id, 'phase4_max_days')
      when 'treatment_start' then
        not exists (
          select 1 from public.appointments a
          where a.client_id = c.id and a.starts_at > now()
            and a.status in ('scheduled', 'confirmed')
        )
        and coalesce(
          (select now()::date - max(a.starts_at)::date
             from public.appointments a where a.client_id = c.id), 99999)
          > public.inactivity_threshold(c.clinic_id, 'phase5_6_no_appt_days')
      when 'reevaluation' then
        not exists (
          select 1 from public.appointments a
          where a.client_id = c.id and a.starts_at > now()
            and a.status in ('scheduled', 'confirmed')
        )
        and coalesce(
          (select now()::date - max(a.starts_at)::date
             from public.appointments a where a.client_id = c.id), 99999)
          > public.inactivity_threshold(c.clinic_id, 'phase5_6_no_appt_days')
      when 'planning_center' then
        coalesce(
          (select now()::date - max(a.starts_at)::date
             from public.appointments a
             where a.client_id = c.id
               and (a.status = 'completed' or a.attendance = 'done')),
          (now()::date - c.created_at::date))
          > public.inactivity_threshold(c.clinic_id, 'no_attendance_days')
      when 'follow_up' then
        public.followup_parked_by_commercial(c.id)
        or coalesce(
          (select now()::date - max(a.starts_at)::date
             from public.appointments a where a.client_id = c.id),
          (now()::date - c.created_at::date))
          > public.inactivity_threshold(c.clinic_id, 'phase7_inactivity_days')
      else false
    end
  ) then 'inactive'::public.client_status
    else 'active'::public.client_status end
  where c.status <> 'anonymized'
    and (p_clinic_id is null or c.clinic_id = p_clinic_id);
$$;

-- -----------------------------------------------------------------------------
-- 3) OS QUE JÁ ESTÃO NESSA SITUAÇÃO HOJE
-- -----------------------------------------------------------------------------
-- Sem isto, quem foi dado por perdido ANTES desta migração continuaria preso na
-- Fase 4 — e seria justamente o caso que originou o relato.
--
-- `moved_by` fica nulo de propósito: não foi pessoa nenhuma que moveu, foi esta
-- migração. Atribuir a alguém seria inventar autor.
do $$
declare
  r record;
begin
  for r in
    select c.id, c.clinic_id, cc.stage
      from public.clients c
      join public.commercial_cards cc on cc.client_id = c.id
     where c.journey_phase = 'commercial_conversion'
       and cc.stage in ('perdido', 'cancelado')
  loop
    update public.journey_phase_history set exited_at = now()
     where client_id = r.id and exited_at is null;

    insert into public.journey_phase_history (client_id, clinic_id, phase, moved_by)
    values (r.id, r.clinic_id, 'follow_up', null);

    update public.clients
       set journey_phase = 'follow_up',
           phase_entered_at = now(),
           journey_status = null
     where id = r.id;

    insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
    values (null, r.clinic_id, 'update', 'client_journey', r.id::text,
            jsonb_build_object('from', 'commercial_conversion', 'to', 'follow_up',
                               'via', 'migracao_0249_' || r.stage));
  end loop;
end $$;

-- Recalcula ativo/inativo de todo mundo com a regra nova.
select public.recompute_client_activity();

-- 0316 — AP58: dois avisos que a tela gravava direto e o banco recusava.
--
-- A tabela `notifications` só tem regras de LER e de MARCAR COMO LIDO (nenhuma
-- de gravar), de propósito: aviso nasce dentro de função do banco, nunca da
-- tela — senão qualquer logado mandaria aviso em nome do sistema. Duas ações
-- da tela gravavam direto, sem conferir o erro, e o banco recusava em silêncio
-- ("new row violates row-level security policy" — provado no treino, 0 avisos
-- com esses títulos):
--
--   1. "Caso devolvido pelo Centro de Planejamento" (Planner devolve ao
--      Coordenador). A mudança de fase já avisava, mas SEM o motivo — e o
--      motivo não era guardado em mais lugar nenhum: a explicação do Planner
--      se perdia.
--   2. "PPR+ — nova adesão ao …" (recepção, gerente e coordenador da unidade).
--
-- As duas funções abaixo gravam o aviso pela porta do banco. Cada uma só
-- avisa sobre o ato que ACABOU de acontecer, feito por quem chama — não é uma
-- porta genérica de mandar aviso.
--
-- Rodar de novo é seguro (create or replace; nada de dado é alterado).

-- -----------------------------------------------------------------------------
-- 1) CASO DEVOLVIDO AO COORDENADOR, COM O MOTIVO
-- -----------------------------------------------------------------------------
create or replace function public.notify_case_returned(
  p_client_id uuid,
  p_reason text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_client record;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_count integer;
begin
  if v_user is null then raise exception 'NOT_ALLOWED'; end if;
  -- Quem devolve é o Planner (ou o Admin), como em move_client_phase.
  if not coalesce(public.is_planner() or public.is_admin_master(), false) then
    raise exception 'NOT_ALLOWED';
  end if;
  if length(v_reason) < 10 then raise exception 'REASON_REQUIRED'; end if;

  select c.id, c.clinic_id, c.full_name, c.journey_phase, c.phase_entered_at
    into v_client
  from public.clients c
  where c.id = p_client_id;
  if not found then raise exception 'CLIENT_NOT_FOUND'; end if;

  -- Só o ato que acabou de acontecer: o cliente acabou de voltar do Centro de
  -- Planejamento para a avaliação ou a reavaliação, movido por quem chama.
  if v_client.journey_phase::text not in ('clinical_conversion', 'reevaluation') then
    raise exception 'NOT_RETURNED';
  end if;
  if not exists (
    select 1 from public.journey_phase_history h
    where h.client_id = p_client_id
      and h.exited_at is null
      and h.moved_by = v_user
      and h.entered_at > now() - interval '10 minutes'
  ) then
    raise exception 'NOT_RETURNED';
  end if;
  if not exists (
    select 1 from public.journey_phase_history h
    where h.client_id = p_client_id
      and h.phase = 'planning_center'
      and h.exited_at > now() - interval '10 minutes'
  ) then
    raise exception 'NOT_RETURNED';
  end if;

  -- Clique duplo não avisa duas vezes.
  if exists (
    select 1 from public.notifications n
    where n.link = '/prontuarios/' || p_client_id
      and n.title = 'Caso devolvido pelo Centro de Planejamento'
      and n.created_at > now() - interval '10 minutes'
  ) then
    return 0;
  end if;

  insert into public.notifications (user_id, clinic_id, title, body, link)
  select distinct ucr.user_id, v_client.clinic_id,
         'Caso devolvido pelo Centro de Planejamento',
         v_client.full_name || ' — ' || v_reason,
         '/prontuarios/' || p_client_id
  from public.user_clinic_roles ucr
  where ucr.clinic_id = v_client.clinic_id
    and ucr.role = 'clinical_coordinator'
    and ucr.user_id <> v_user;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.notify_case_returned(uuid, text) from public, anon, authenticated;
grant execute on function public.notify_case_returned(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 2) NOVA ADESÃO AO PPR+
-- -----------------------------------------------------------------------------
create or replace function public.notify_ppr_membership_created(
  p_membership_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_m record;
  v_deps integer;
  v_count integer;
begin
  if v_user is null then raise exception 'NOT_ALLOWED'; end if;

  select m.id, m.clinic_id, m.created_by, m.created_at, m.monthly_cents,
         p.name as plan_name, c.full_name as holder_name
    into v_m
  from public.ppr_memberships m
  join public.ppr_plans p on p.id = m.plan_id
  join public.clients c on c.id = m.holder_client_id
  where m.id = p_membership_id;
  if not found then raise exception 'MEMBERSHIP_NOT_FOUND'; end if;

  -- Só quem acabou de registrar a adesão avisa sobre ela.
  if v_m.created_by is distinct from v_user
     or v_m.created_at < now() - interval '10 minutes' then
    raise exception 'NOT_ALLOWED';
  end if;

  -- Uma vez só por adesão.
  if exists (
    select 1 from public.notifications n
    where n.link = '/ppr/adesoes/' || p_membership_id
  ) then
    return 0;
  end if;

  select count(*) into v_deps
  from public.ppr_beneficiaries b
  where b.membership_id = p_membership_id
    and b.role = 'dependente'
    and b.left_at is null;

  insert into public.notifications (user_id, clinic_id, title, body, link)
  select distinct ucr.user_id, v_m.clinic_id,
         'PPR+ — nova adesão ao ' || v_m.plan_name,
         v_m.holder_name || ' aderiu ao ' || v_m.plan_name
           || case when v_deps > 0 then ' com ' || v_deps || ' dependente(s)' else '' end
           || '. Mensalidade ' || public.brl(v_m.monthly_cents)
           || '. Falta o contrato e a 1ª mensalidade para ativar.',
         '/ppr/adesoes/' || p_membership_id
  from public.user_clinic_roles ucr
  where ucr.clinic_id = v_m.clinic_id
    and ucr.role in ('receptionist', 'unit_manager', 'clinical_coordinator')
    and ucr.user_id <> v_user;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.notify_ppr_membership_created(uuid) from public, anon, authenticated;
grant execute on function public.notify_ppr_membership_created(uuid) to authenticated;

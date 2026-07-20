-- =============================================================================
-- Risarte Odontologia — Migration 0134 (LOTE Avaliações & Planos — Fase 2)
-- Ciclo de vida do plano de tratamento.
--
-- Até aqui o plano só tinha o "trilho interno" (status draft/submitted/approved/
-- returned = Planner ↔ Coordenador). Esta migração acrescenta a CONTINUAÇÃO da
-- linha do tempo, depois que o Coordenador aprova: o que acontece com o cliente
-- (aguardando apresentação → apresentado → aceito/reprovado pelo cliente → em
-- tratamento → concluído). Cancelado/Suspenso ficam RESERVADOS aqui (as telas
-- deles chegam nas Fases 6/7) para não precisar mexer no banco de novo.
--
-- Desenho seguro: o `status` existente NÃO muda (continua guiando a fila do
-- Centro de Planejamento, a trava 3→4 e a aprovação). O ciclo de vida é uma
-- coluna NOVA (`lifecycle`), que só "liga" quando o plano está aprovado. A tela
-- deriva UMA linha do tempo única juntando os dois.
--
-- Idempotente (safe para rodar de novo).
-- =============================================================================

-- 1) Enum do ciclo de vida (a parte da linha do tempo APÓS a aprovação). -------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'treatment_plan_lifecycle') then
    create type public.treatment_plan_lifecycle as enum (
      'aguardando_apresentacao',
      'apresentado',
      'aceito',
      'reprovado',
      'em_tratamento',
      'concluido',
      'cancelado',
      'suspenso'
    );
  end if;
end $$;

-- 2) Coluna nova em treatment_plans (nula = ainda no trilho interno). ----------
alter table public.treatment_plans
  add column if not exists lifecycle public.treatment_plan_lifecycle;

alter table public.treatment_plans
  add column if not exists lifecycle_at timestamptz;

-- 3) Histórico das mudanças de situação (quem mudou, quando, de onde para onde).
--    `to_stage`/`from_stage` são texto (chave unificada do estágio) para caber
--    tanto os passos internos quanto os do ciclo de vida.
create table if not exists public.treatment_plan_status_events (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.treatment_plans (id) on delete cascade,
  clinic_id uuid not null references public.clinics (id),
  from_stage text,
  to_stage text not null,
  note text,
  changed_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);
create index if not exists treatment_plan_status_events_plan_idx
  on public.treatment_plan_status_events (plan_id, created_at desc);
alter table public.treatment_plan_status_events enable row level security;

-- Leitura: mesmo escopo do plano (membros da unidade + Planner + Admin). Sem
-- policy de INSERT: só a RPC SECURITY DEFINER abaixo grava (barreira real).
drop policy if exists "treatment_plan_status_events_select"
  on public.treatment_plan_status_events;
create policy "treatment_plan_status_events_select"
  on public.treatment_plan_status_events
  for select to authenticated
  using (
    public.is_admin_master()
    or clinic_id in (select public.user_full_access_clinic_ids())
    or public.is_planner()
  );

-- 4) RPC: avança (ou ajusta) o ciclo de vida do plano, conferindo o papel. -----
--    Regras de quem pode marcar cada situação (matriz de funções do CLAUDE.md):
--      - aguardando_apresentacao : Planner (ou automático ao enviar ao Comercial)
--      - apresentado/aceito/reprovado : Consultor Comercial
--      - em_tratamento/concluido : Dentista executor / Coordenador / Recepção / Gerente
--    Cancelado/Suspenso NÃO passam por aqui (reservados p/ Fases 6/7 → RESERVED).
--    O plano precisa estar 'approved' para entrar no ciclo de vida (NOT_APPROVED).
create or replace function public.set_plan_lifecycle(
  p_plan_id uuid,
  p_to public.treatment_plan_lifecycle,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client uuid;
  v_clinic uuid;
  v_status public.treatment_plan_status;
  v_current public.treatment_plan_lifecycle;
  v_planner uuid;
  v_name text;
  v_from text;
  v_allowed boolean;
  v_user uuid := (select auth.uid());
begin
  select tp.client_id, tp.clinic_id, tp.status, tp.lifecycle, tp.created_by
    into v_client, v_clinic, v_status, v_current, v_planner
  from public.treatment_plans tp where tp.id = p_plan_id;
  if v_client is null then raise exception 'PLAN_NOT_FOUND'; end if;

  if p_to in ('cancelado', 'suspenso') then
    raise exception 'RESERVED';  -- Fases 6/7 têm ações próprias.
  end if;

  if v_status <> 'approved' then
    raise exception 'NOT_APPROVED';
  end if;

  -- Permissão por situação de destino.
  v_allowed := public.is_admin_master() or case p_to
    when 'aguardando_apresentacao' then
      public.is_planner()
      or public.has_role_in_clinic(v_clinic, array['planner_dentist']::public.user_role[])
    when 'apresentado' then
      public.has_role_in_clinic(v_clinic, array['commercial_consultant']::public.user_role[])
    when 'aceito' then
      public.has_role_in_clinic(v_clinic, array['commercial_consultant']::public.user_role[])
    when 'reprovado' then
      public.has_role_in_clinic(v_clinic, array['commercial_consultant']::public.user_role[])
    when 'em_tratamento' then
      public.has_role_in_clinic(v_clinic,
        array['dentist','clinical_coordinator','receptionist','unit_manager']::public.user_role[])
    when 'concluido' then
      public.has_role_in_clinic(v_clinic,
        array['dentist','clinical_coordinator','unit_manager']::public.user_role[])
    else false
  end;
  if not v_allowed then raise exception 'NOT_ALLOWED'; end if;

  v_from := coalesce(v_current::text, 'aprovado_coordenador');

  update public.treatment_plans
    set lifecycle = p_to, lifecycle_at = now(), updated_at = now()
  where id = p_plan_id;

  insert into public.treatment_plan_status_events
    (plan_id, clinic_id, from_stage, to_stage, note, changed_by)
  values (p_plan_id, v_clinic, v_from, p_to::text, nullif(btrim(p_note), ''), v_user);

  -- Aviso ao Planner quando o cliente decide (visibilidade do resultado).
  if p_to in ('aceito', 'reprovado') and v_planner is not null then
    select full_name into v_name from public.clients where id = v_client;
    insert into public.notifications (user_id, clinic_id, title, body, link)
    values (v_planner, v_clinic,
      case when p_to = 'aceito' then 'Plano aceito pelo cliente'
           else 'Plano reprovado pelo cliente' end,
      coalesce(v_name, 'Cliente') ||
        case when p_to = 'aceito' then ' — o cliente aceitou o plano.'
             else ' — o cliente não aceitou o plano (follow-up).' end,
      '/prontuarios/' || v_client);
  end if;

  insert into public.audit_logs
    (user_id, clinic_id, action, entity_type, entity_id, details)
  values (v_user, v_clinic, 'update', 'treatment_plan', p_plan_id::text,
    jsonb_build_object('lifecycle', p_to::text));
end;
$$;

revoke all on function public.set_plan_lifecycle(uuid, public.treatment_plan_lifecycle, text) from public;
grant execute on function public.set_plan_lifecycle(uuid, public.treatment_plan_lifecycle, text) to authenticated;

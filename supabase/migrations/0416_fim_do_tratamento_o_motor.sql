-- =============================================================================
-- 0416 — FIM DO TRATAMENTO, ETAPA 2: O MOTOR
--
-- Plano e decisões do dono (16/11/2026): docs/jornada/FIM-DO-TRATAMENTO-PLANO.md
-- (D2, D3, D9, D13, D17, D21, C1, C2, C3 e o fluxo da seção 2).
--
-- O DEFEITO: a pergunta "necessita de reavaliação?" (0019) só abria quando o
-- sub-status virava "Tratamento Finalizado", e NADA marcava esse sub-status
-- sozinho. Em nenhum dos dois bancos ela abriu uma única vez (levantamento de
-- 16/11/2026). O cliente terminava as sessões e ficava parado na Fase 5.
--
-- O QUE MUDA:
--   1) `_tratamento_em_aberto` — a regra ÚNICA "sobra tratamento?": sessão
--      pendente/agendada de qualquer venda, complemento em andamento ou
--      ortodontia aguardando início/em tratamento/suspensa (a contenção não
--      segura: C2).
--   2) `treatment_closures` — o FECHAMENTO de cada plano (original, cada
--      complemento, venda direta), da ortodontia (entrega da contenção) e da
--      urgência. Uma tarefa com dono que só some quando é resolvida.
--   3) Gatilhos: a última sessão concluída de um plano abre o fechamento
--      sozinha; a situação do plano passa a "Em tratamento" e "Concluído"
--      sozinha; reabrir sessão volta o cliente a "Em Tratamento".
--   4) `answer_treatment_closure` — a resposta de quem executou (Sim / Não /
--      Não sei); o Coordenador pode mudá-la enquanto nada aconteceu (D21).
--   5) `register_closure_contact` — o contato do Coordenador com o cliente
--      (Passo 3b). A satisfação 0–10 e a queixa entram na Etapa 3.
--   6) Urgência (D13): o check-in de urgência/emergência NÃO leva mais a
--      Fase 1 à Fase 5. Ao concluir, a Recepção recebe "agendar a avaliação
--      completa", resolvida quando a avaliação é agendada.
--   7) Catálogo (D17): `procedures.requires_reevaluation` — com ele no plano,
--      o "Sim" é automático e a pergunta não aparece. Só o Admin Master muda.
--   8) "Tratamento Finalizado" à mão: só o Admin Master (D9). O gatilho antigo
--      da 0019 (`clients_treatment_finished`) sai: o fechamento faz o trabalho.
--
-- NÃO MEXE nas funções da ortodontia: só LÊ `ortho_cases.status` e acrescenta
-- um gatilho próprio na passagem para "contencao".
--
-- Nada apaga dado. Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) "Sobra tratamento?" — a regra única
-- -----------------------------------------------------------------------------
create or replace function public._tratamento_em_aberto(p_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    -- (1) sessão pendente ou agendada de QUALQUER venda (plano, complemento,
    --     venda direta, revisão e refação). Cancelada não conta (D2).
    exists (
      select 1 from public.treatment_sessions ts
      where ts.client_id = p_client_id
        and ts.status in ('pending', 'scheduled')
    )
    -- (2) complemento sendo montado, aprovado ou negociado (D3).
    or exists (
      select 1 from public.treatment_plans tp
      where tp.client_id = p_client_id
        and tp.complement_of_plan_id is not null
        and tp.superseded_at is null
        and coalesce(tp.lifecycle::text, '') not in
            ('reprovado', 'cancelado', 'concluido', 'aceito', 'em_tratamento', 'suspenso')
        and not exists (
          select 1 from public.plan_negotiations n
          where n.plan_id = tp.id and n.status in ('perdida', 'cancelada')
        )
        and not exists (
          select 1 from public.plan_negotiations n
          join public.commercial_sales s on s.negotiation_id = n.id
          where n.plan_id = tp.id and s.closed_at is not null
        )
    )
    -- (3) ortodontia aguardando início, em tratamento ou suspensa (C2).
    or exists (
      select 1 from public.ortho_cases o
      where o.client_id = p_client_id
        and o.status in ('aguardando_inicio', 'em_tratamento', 'suspenso')
    );
$$;
revoke execute on function public._tratamento_em_aberto(uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2) Catálogo: reavaliação presencial obrigatória (D17)
-- -----------------------------------------------------------------------------
alter table public.procedures
  add column if not exists requires_reevaluation boolean not null default false;

comment on column public.procedures.requires_reevaluation is
  'D17 (0416): com este procedimento no plano, o fim do plano marca "Sim" para a reavaliação sem perguntar ao dentista. Só o Admin Master muda.';

create or replace function public.procedures_reevaluation_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_role text := coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '');
begin
  if v_role not in ('authenticated', 'anon') or public.is_admin_master() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.requires_reevaluation then raise exception 'REEVALUATION_FLAG_ADMIN_ONLY'; end if;
  elsif new.requires_reevaluation is distinct from old.requires_reevaluation then
    raise exception 'REEVALUATION_FLAG_ADMIN_ONLY';
  end if;
  return new;
end;
$$;
revoke execute on function public.procedures_reevaluation_guard() from public, anon, authenticated;

drop trigger if exists procedures_reevaluation_guard on public.procedures;
create trigger procedures_reevaluation_guard
  before insert or update of requires_reevaluation on public.procedures
  for each row execute function public.procedures_reevaluation_guard();

-- -----------------------------------------------------------------------------
-- 3) O fechamento e os contatos
-- -----------------------------------------------------------------------------
create table if not exists public.treatment_closures (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id),
  client_id uuid not null references public.clients (id),
  -- plano = plano original ou complemento; venda_direta; ortodontia; urgencia.
  scope text not null check (scope in ('plano', 'venda_direta', 'ortodontia', 'urgencia')),
  plan_id uuid references public.treatment_plans (id) on delete set null,
  direct_sale_id uuid references public.direct_sales (id) on delete set null,
  ortho_case_id uuid references public.ortho_cases (id) on delete set null,
  appointment_id uuid references public.appointments (id) on delete set null,
  -- Nada mais sobrava quando o fechamento nasceu (recalculado a cada passo).
  treatment_end boolean not null default false,
  -- Quem responde a pergunta (nulo = o Coordenador da unidade).
  asked_user_id uuid references public.profiles (id),
  -- D17: o catálogo respondeu "Sim" sozinho.
  auto_yes boolean not null default false,
  status text not null default 'pergunta' check (status in (
    'pergunta',          -- aguardando a resposta de quem executou
    'coordenador',       -- "Não sei": o Coordenador decide
    'reavaliacao',       -- "Sim": aguardando a consulta com o Coordenador
    'contato',           -- "Não": o Coordenador contata o cliente
    'agendar_avaliacao', -- urgência: a Recepção agenda a avaliação completa
    'encerrado'
  )),
  answer text check (answer is null or answer in ('sim', 'nao', 'nao_sei')),
  answered_by uuid references public.profiles (id),
  answered_at timestamptz,
  changed_by_coordinator boolean not null default false,
  outcome text check (outcome is null or outcome in (
    'reavaliado', 'aguardar_retorno', 'novo_planejamento', 'sem_contato',
    'avaliacao_agendada', 'reaberto'
  )),
  outcome_note text,
  return_date date,
  closed_by uuid references public.profiles (id),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint treatment_closures_scope_ref check (
    (scope = 'plano' and plan_id is not null)
    or (scope = 'venda_direta' and direct_sale_id is not null)
    or (scope = 'ortodontia' and ortho_case_id is not null)
    or (scope = 'urgencia' and appointment_id is not null)
  )
);

-- Um fechamento ABERTO por plano / venda / caso / urgência.
create unique index if not exists treatment_closures_open_plan
  on public.treatment_closures (plan_id) where plan_id is not null and status <> 'encerrado';
create unique index if not exists treatment_closures_open_ds
  on public.treatment_closures (direct_sale_id) where direct_sale_id is not null and status <> 'encerrado';
create unique index if not exists treatment_closures_open_ortho
  on public.treatment_closures (ortho_case_id) where ortho_case_id is not null and status <> 'encerrado';
create unique index if not exists treatment_closures_appt
  on public.treatment_closures (appointment_id) where appointment_id is not null;
create index if not exists treatment_closures_client_open
  on public.treatment_closures (client_id) where status <> 'encerrado';

create table if not exists public.treatment_closure_contacts (
  id uuid primary key default gen_random_uuid(),
  closure_id uuid not null references public.treatment_closures (id) on delete cascade,
  clinic_id uuid not null references public.clinics (id),
  client_id uuid not null references public.clients (id),
  channel text not null check (channel in ('ligacao', 'mensagem', 'presencial')),
  reached boolean not null,
  summary text,
  contacted_at timestamptz not null default now(),
  recorded_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);
create index if not exists treatment_closure_contacts_closure
  on public.treatment_closure_contacts (closure_id);

alter table public.treatment_closures enable row level security;
alter table public.treatment_closure_contacts enable row level security;

-- Leitura: quem vê o cliente vê o fechamento dele (a regra de `clients`).
-- Escrita: só pelas funções abaixo.
drop policy if exists "treatment_closures_select" on public.treatment_closures;
create policy "treatment_closures_select" on public.treatment_closures
  for select to authenticated
  using (
    public.is_admin_master()
    or exists (select 1 from public.clients c where c.id = treatment_closures.client_id)
  );

drop policy if exists "treatment_closure_contacts_select" on public.treatment_closure_contacts;
create policy "treatment_closure_contacts_select" on public.treatment_closure_contacts
  for select to authenticated
  using (
    public.is_admin_master()
    or exists (select 1 from public.clients c where c.id = treatment_closure_contacts.client_id)
  );

-- -----------------------------------------------------------------------------
-- 4) Internas: mover a fase por EVENTO e avisar
-- -----------------------------------------------------------------------------
-- O mesmo que as passagens por evento já fazem (check-in, 0019): histórico,
-- cliente e auditoria. Fase 7 grava a data de retorno.
create or replace function public._jornada_mover_por_evento(
  p_client_id uuid,
  p_to public.journey_phase,
  p_via text,
  p_user uuid,
  p_return_date date default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic uuid;
  v_from public.journey_phase;
begin
  select clinic_id, journey_phase into v_clinic, v_from
  from public.clients where id = p_client_id;
  if v_clinic is null or v_from = p_to then return; end if;

  update public.journey_phase_history set exited_at = now()
  where client_id = p_client_id and exited_at is null;
  insert into public.journey_phase_history (client_id, clinic_id, phase, moved_by)
  values (p_client_id, v_clinic, p_to, p_user);
  update public.clients set
    journey_phase = p_to,
    phase_entered_at = now(),
    follow_up_return_at = case when p_to = 'follow_up'
                               then coalesce(p_return_date, follow_up_return_at)
                               else follow_up_return_at end
  where id = p_client_id;

  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values (p_user, v_clinic, 'update', 'client_journey', p_client_id::text,
          jsonb_build_object('from', v_from, 'to', p_to, 'via', p_via));
end;
$$;
revoke execute on function public._jornada_mover_por_evento(uuid, public.journey_phase, text, uuid, date) from public, anon, authenticated;

create or replace function public._fechamento_avisar(
  p_clinic uuid,
  p_roles public.user_role[],
  p_user uuid,
  p_title text,
  p_body text,
  p_link text,
  p_skip uuid
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications (user_id, clinic_id, title, body, link)
  select distinct x.uid, p_clinic, p_title, p_body, p_link
  from (
    select p_user as uid where p_user is not null
    union
    select ucr.user_id from public.user_clinic_roles ucr
     where p_roles is not null and ucr.clinic_id = p_clinic and ucr.role = any (p_roles)
  ) x
  where x.uid is not null and x.uid is distinct from p_skip;
$$;
revoke execute on function public._fechamento_avisar(uuid, public.user_role[], uuid, text, text, text, uuid) from public, anon, authenticated;

-- "Sim" (e "chamar para revisar"): reavaliação com o Coordenador. Sem nada
-- sobrando, o cliente vai à Fase 6; com tratamento em andamento, a consulta
-- acontece dentro da Fase 5 (C1).
create or replace function public._fechamento_reavaliar(p_id uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_f public.treatment_closures;
  v_end boolean;
  v_name text;
  v_phase public.journey_phase;
begin
  select * into v_f from public.treatment_closures where id = p_id;
  select full_name, journey_phase into v_name, v_phase from public.clients where id = v_f.client_id;
  v_end := not public._tratamento_em_aberto(v_f.client_id);

  update public.treatment_closures
     set status = 'reavaliacao', treatment_end = v_end, updated_at = now()
   where id = p_id;

  if v_end and v_phase = 'treatment_start' then
    perform public._jornada_mover_por_evento(v_f.client_id, 'reevaluation', 'fim_do_tratamento', p_user);
  end if;

  perform public._fechamento_avisar(
    v_f.clinic_id, array['receptionist']::public.user_role[], null,
    'Agendar reavaliação: ' || coalesce(v_name, 'Cliente'),
    coalesce(v_name, 'Cliente') || ' terminou '
      || case v_f.scope when 'ortodontia' then 'a ortodontia' when 'venda_direta' then 'a venda direta' else 'um plano' end
      || '. Agende a consulta de reavaliação com o Coordenador Clínico.',
    '/agenda?cliente=' || v_f.client_id || '&tipo=reevaluation',
    p_user);
end;
$$;
revoke execute on function public._fechamento_reavaliar(uuid, uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 5) Abrir o fechamento
-- -----------------------------------------------------------------------------
create or replace function public._abrir_fechamento(
  p_scope text,
  p_client_id uuid,
  p_clinic_id uuid,
  p_plan_id uuid,
  p_direct_sale_id uuid,
  p_ortho_case_id uuid,
  p_asked uuid,
  p_auto_yes boolean,
  p_user uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_end boolean;
  v_name text;
  v_what text;
begin
  v_end := not public._tratamento_em_aberto(p_client_id);

  insert into public.treatment_closures
    (clinic_id, client_id, scope, plan_id, direct_sale_id, ortho_case_id,
     treatment_end, asked_user_id, auto_yes, status, answer, answered_at)
  values
    (p_clinic_id, p_client_id, p_scope, p_plan_id, p_direct_sale_id, p_ortho_case_id,
     v_end, p_asked, p_auto_yes, 'pergunta',
     case when p_auto_yes then 'sim' end,
     case when p_auto_yes then now() end)
  on conflict do nothing
  returning id into v_id;
  if v_id is null then return null; end if;

  -- Fim do tratamento: o sub-status passa a "Tratamento Finalizado" sozinho.
  if v_end then
    update public.clients set journey_status = 'treatment_finished'
     where id = p_client_id and journey_phase = 'treatment_start';
  end if;

  select full_name into v_name from public.clients where id = p_client_id;
  v_what := case p_scope
    when 'ortodontia' then 'a ortodontia (contenção entregue)'
    when 'venda_direta' then 'a venda direta'
    else 'um plano de tratamento' end;

  if p_auto_yes then
    -- D17: procedimento de reavaliação obrigatória no plano.
    perform public._fechamento_reavaliar(v_id, p_user);
  else
    perform public._fechamento_avisar(
      p_clinic_id,
      case when p_asked is null then array['clinical_coordinator']::public.user_role[] end,
      p_asked,
      'Decisão obrigatória: necessita de reavaliação?',
      coalesce(v_name, 'Cliente') || ' terminou ' || v_what
        || '. Responda na ficha do cliente: necessita de consulta de reavaliação com o Coordenador Clínico?',
      '/prontuarios/' || p_client_id,
      null);
  end if;

  return v_id;
end;
$$;
revoke execute on function public._abrir_fechamento(text, uuid, uuid, uuid, uuid, uuid, uuid, boolean, uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 6) Gatilho nas sessões: situação do plano, fim do plano, reabertura
-- -----------------------------------------------------------------------------
create or replace function public.treatment_closure_on_session()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_last public.treatment_sessions;
  v_provider uuid;
  v_asked uuid;
  v_owner boolean;
  v_auto boolean;
  v_scope text;
  v_vendida boolean;
begin
  begin
    -- (a) Reabertura: sessão volta a pendente/agendada (revisão, refação,
    --     sessão nova). O cliente volta a "Em Tratamento"; a pergunta ainda
    --     sem resposta daquele plano é retirada.
    if new.status in ('pending', 'scheduled')
       and (tg_op = 'INSERT' or old.status in ('done', 'cancelled')) then
      update public.clients set journey_status = 'in_treatment'
       where id = new.client_id
         and journey_phase = 'treatment_start'
         and journey_status = 'treatment_finished';
      update public.treatment_closures
         set status = 'encerrado', outcome = 'reaberto', closed_at = now(),
             closed_by = v_user, updated_at = now()
       where status in ('pergunta', 'coordenador')
         and ((new.plan_id is not null and plan_id = new.plan_id)
              or (new.direct_sale_id is not null and direct_sale_id = new.direct_sale_id));
      return null;
    end if;

    if tg_op <> 'UPDATE' or new.status <> 'done' or old.status = 'done' then
      return null;
    end if;

    -- (b) 1ª sessão feita: o plano passa a "Em tratamento".
    if new.plan_id is not null then
      update public.treatment_plans
         set lifecycle = 'em_tratamento', lifecycle_at = now(), updated_at = now()
       where id = new.plan_id
         and (lifecycle is null or lifecycle in ('aguardando_apresentacao', 'apresentado', 'aceito'));
    end if;

    -- Revisão e refação não refazem a pergunta: voltam ao Coordenador pelo
    -- aviso de sempre (`notify_qc_after_redo_finish`).
    if new.redo_kind is not null then return null; end if;

    -- (c) Ainda sobra sessão deste plano/venda? Então não terminou.
    if new.plan_id is not null then
      v_scope := 'plano';
      if exists (select 1 from public.treatment_sessions s
                  where s.plan_id = new.plan_id and s.status in ('pending', 'scheduled')) then
        return null;
      end if;
      -- Só plano VENDIDO e não cancelado (o cancelamento tem fluxo próprio).
      select exists (
        select 1 from public.plan_negotiations n
        join public.commercial_sales s on s.negotiation_id = n.id
        where n.plan_id = new.plan_id and s.closed_at is not null and s.cancelled_at is null
      ) into v_vendida;
      if not v_vendida then return null; end if;
      -- Já houve fechamento deste plano (que não foi retirado por reabertura)?
      if exists (select 1 from public.treatment_closures f
                  where f.plan_id = new.plan_id and f.outcome is distinct from 'reaberto') then
        return null;
      end if;
    elsif new.direct_sale_id is not null then
      v_scope := 'venda_direta';
      if exists (select 1 from public.treatment_sessions s
                  where s.direct_sale_id = new.direct_sale_id and s.status in ('pending', 'scheduled')) then
        return null;
      end if;
      if exists (select 1 from public.direct_sales d
                  where d.id = new.direct_sale_id and d.status = 'cancelada') then
        return null;
      end if;
      if exists (select 1 from public.treatment_closures f
                  where f.direct_sale_id = new.direct_sale_id and f.outcome is distinct from 'reaberto') then
        return null;
      end if;
    else
      return null;
    end if;

    -- (d) O plano terminou: "Concluído".
    if new.plan_id is not null then
      update public.treatment_plans
         set lifecycle = 'concluido', lifecycle_at = now(), updated_at = now()
       where id = new.plan_id
         and coalesce(lifecycle::text, '') not in ('concluido', 'cancelado', 'reprovado');
    end if;

    -- (e) Quem responde: quem executou a última sessão; se foi o titular
    --     concluindo por outro profissional, o profissional do agendamento.
    select * into v_last from public.treatment_sessions s
     where s.status = 'done'
       and ((new.plan_id is not null and s.plan_id = new.plan_id)
            or (new.plan_id is null and s.direct_sale_id = new.direct_sale_id))
     order by s.done_at desc nulls last
     limit 1;
    select a.provider_user_id into v_provider
      from public.appointments a where a.id = v_last.appointment_id;
    select coalesce(p.is_owner, false) into v_owner
      from public.profiles p where p.id = v_last.executed_by;
    v_asked := case
      when v_last.executed_by is null then v_provider
      when coalesce(v_owner, false) and v_provider is not null
           and v_provider <> v_last.executed_by then v_provider
      else v_last.executed_by end;

    -- (f) D17: procedimento com reavaliação obrigatória no plano/venda.
    select exists (
      select 1 from public.treatment_sessions s
      join public.procedures p on p.id = s.procedure_id
      where p.requires_reevaluation
        and ((new.plan_id is not null and s.plan_id = new.plan_id)
             or (new.plan_id is null and s.direct_sale_id = new.direct_sale_id))
    ) into v_auto;

    perform public._abrir_fechamento(
      v_scope, new.client_id, new.clinic_id,
      new.plan_id, case when new.plan_id is null then new.direct_sale_id end, null,
      v_asked, coalesce(v_auto, false), v_user);
  exception when others then
    -- Nunca derruba a baixa da sessão: o fechamento que faltar aparece na
    -- lista de "sem próximo passo" (Etapa 4).
    raise warning 'treatment_closure_on_session (%): %', new.id, sqlerrm;
  end;
  return null;
end;
$$;
revoke execute on function public.treatment_closure_on_session() from public, anon, authenticated;

drop trigger if exists treatment_closure_on_session on public.treatment_sessions;
create trigger treatment_closure_on_session
  after insert or update of status on public.treatment_sessions
  for each row execute function public.treatment_closure_on_session();

-- -----------------------------------------------------------------------------
-- 7) Gatilho na ortodontia: a entrega da contenção fecha a ortodontia (C2/C3)
-- -----------------------------------------------------------------------------
-- Só LÊ a passagem de situação; as funções da ortodontia não mudam.
create or replace function public.treatment_closure_on_ortho()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    if new.status = 'contencao'
       and old.status in ('aguardando_inicio', 'em_tratamento', 'suspenso') then
      perform public._abrir_fechamento(
        'ortodontia', new.client_id, new.clinic_id, null, null, new.id,
        new.orthodontist_id, false, (select auth.uid()));
    end if;
  exception when others then
    raise warning 'treatment_closure_on_ortho (%): %', new.id, sqlerrm;
  end;
  return null;
end;
$$;
revoke execute on function public.treatment_closure_on_ortho() from public, anon, authenticated;

drop trigger if exists treatment_closure_on_ortho on public.ortho_cases;
create trigger treatment_closure_on_ortho
  after update of status on public.ortho_cases
  for each row execute function public.treatment_closure_on_ortho();

-- -----------------------------------------------------------------------------
-- 8) Gatilho na agenda: urgência, avaliação agendada, reavaliação feita
-- -----------------------------------------------------------------------------
create or replace function public.treatment_closure_on_appointment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_phase public.journey_phase;
  v_name text;
begin
  begin
    select journey_phase, full_name into v_phase, v_name
      from public.clients where id = new.client_id;

    -- (a) D13: urgência/emergência CONCLUÍDA de quem ainda é Fase 1 e não
    --     tem tratamento → a Recepção agenda a avaliação completa.
    if new.type in ('urgency', 'emergency')
       and new.status = 'completed'
       and (tg_op = 'INSERT' or old.status is distinct from 'completed')
       and v_phase = 'acquisition'
       and not public._tratamento_em_aberto(new.client_id) then
      insert into public.treatment_closures
        (clinic_id, client_id, scope, appointment_id, status)
      values (new.clinic_id, new.client_id, 'urgencia', new.id, 'agendar_avaliacao')
      on conflict do nothing;
      if found then
        perform public._fechamento_avisar(
          new.clinic_id, array['receptionist']::public.user_role[], null,
          'Agendar avaliação completa: ' || coalesce(v_name, 'Cliente'),
          coalesce(v_name, 'Cliente') || ' foi atendido(a) na urgência. Agende a avaliação completa com o Coordenador Clínico.',
          '/agenda?cliente=' || new.client_id || '&tipo=evaluation',
          v_user);
      end if;
    end if;

    -- (b) Avaliação agendada resolve a tarefa da urgência.
    if new.type = 'evaluation'
       and new.status in ('scheduled', 'confirmed', 'completed') then
      update public.treatment_closures
         set status = 'encerrado', outcome = 'avaliacao_agendada',
             closed_at = now(), closed_by = v_user, updated_at = now()
       where client_id = new.client_id and status = 'agendar_avaliacao';
    end if;

    -- (c) Reavaliação feita com o cliente ainda na Fase 5 (C1): a consulta
    --     do fim do plano aconteceu. (A avaliação em cinco níveis é a Etapa 3.)
    if new.type = 'reevaluation'
       and new.status = 'completed'
       and (tg_op = 'INSERT' or old.status is distinct from 'completed')
       and v_phase = 'treatment_start' then
      update public.treatment_closures
         set status = 'encerrado', outcome = 'reavaliado',
             closed_at = now(), closed_by = v_user, updated_at = now()
       where client_id = new.client_id and status = 'reavaliacao';
    end if;
  exception when others then
    raise warning 'treatment_closure_on_appointment (%): %', new.id, sqlerrm;
  end;
  return null;
end;
$$;
revoke execute on function public.treatment_closure_on_appointment() from public, anon, authenticated;

drop trigger if exists treatment_closure_on_appointment on public.appointments;
create trigger treatment_closure_on_appointment
  after insert or update of status, type on public.appointments
  for each row execute function public.treatment_closure_on_appointment();

-- -----------------------------------------------------------------------------
-- 9) Gatilho na fase: sair da Reavaliação encerra o fechamento que a esperava
-- -----------------------------------------------------------------------------
create or replace function public.treatment_closure_on_phase()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    if old.journey_phase = 'reevaluation' and new.journey_phase <> 'reevaluation' then
      update public.treatment_closures
         set status = 'encerrado', outcome = 'reavaliado',
             closed_at = now(), closed_by = (select auth.uid()), updated_at = now()
       where client_id = new.id and status = 'reavaliacao';
    end if;
  exception when others then
    raise warning 'treatment_closure_on_phase (%): %', new.id, sqlerrm;
  end;
  return null;
end;
$$;
revoke execute on function public.treatment_closure_on_phase() from public, anon, authenticated;

drop trigger if exists treatment_closure_on_phase on public.clients;
create trigger treatment_closure_on_phase
  after update of journey_phase on public.clients
  for each row execute function public.treatment_closure_on_phase();

-- -----------------------------------------------------------------------------
-- 10) A resposta: Sim / Não / Não sei (e a troca pelo Coordenador, D21)
-- -----------------------------------------------------------------------------
create or replace function public.answer_treatment_closure(p_id uuid, p_answer text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_f public.treatment_closures;
  v_user uuid := (select auth.uid());
  v_coord boolean;
  v_phase public.journey_phase;
  v_name text;
begin
  if v_user is null then raise exception 'NOT_ALLOWED'; end if;
  if p_answer not in ('sim', 'nao', 'nao_sei') then raise exception 'INVALID_ANSWER'; end if;

  select * into v_f from public.treatment_closures where id = p_id for update;
  if v_f.id is null then raise exception 'NOT_FOUND'; end if;
  if v_f.status in ('encerrado', 'agendar_avaliacao') then raise exception 'ALREADY_CLOSED'; end if;

  v_coord := public.is_admin_master()
    or public.has_role_in_clinic(v_f.clinic_id, array['clinical_coordinator']::public.user_role[]);

  select journey_phase, full_name into v_phase, v_name
    from public.clients where id = v_f.client_id;

  if v_f.status = 'pergunta' then
    if not (v_coord or v_f.asked_user_id = v_user) then raise exception 'NOT_ALLOWED'; end if;
    -- "Não sei" é a saída de quem executou; o Coordenador decide Sim ou Não.
    if p_answer = 'nao_sei' and v_coord and v_f.asked_user_id is distinct from v_user then
      raise exception 'COORDINATOR_DECIDES';
    end if;
  elsif v_f.status = 'coordenador' then
    if not v_coord then raise exception 'NOT_ALLOWED'; end if;
    if p_answer = 'nao_sei' then raise exception 'COORDINATOR_DECIDES'; end if;
  else
    -- D21: o Coordenador muda a resposta enquanto nada aconteceu.
    if not v_coord then raise exception 'NOT_ALLOWED'; end if;
    if p_answer = 'nao_sei' or p_answer = v_f.answer then raise exception 'NOTHING_TO_CHANGE'; end if;
    if v_f.status = 'contato' and exists (
      select 1 from public.treatment_closure_contacts c where c.closure_id = p_id
    ) then
      raise exception 'ALREADY_ACTED';
    end if;
    if v_f.status = 'reavaliacao' and v_phase <> 'treatment_start' then
      raise exception 'ALREADY_ACTED';
    end if;
  end if;

  update public.treatment_closures set
    answer = p_answer,
    answered_by = v_user,
    answered_at = now(),
    changed_by_coordinator = changed_by_coordinator
      or (v_f.status in ('reavaliacao', 'contato', 'coordenador')
          or (v_coord and v_f.asked_user_id is distinct from v_user and v_f.asked_user_id is not null)),
    updated_at = now()
  where id = p_id;

  if p_answer = 'sim' then
    perform public._fechamento_reavaliar(p_id, v_user);
  elsif p_answer = 'nao' then
    update public.treatment_closures
       set status = 'contato', treatment_end = not public._tratamento_em_aberto(v_f.client_id),
           updated_at = now()
     where id = p_id;
    perform public._fechamento_avisar(
      v_f.clinic_id, array['clinical_coordinator']::public.user_role[], null,
      'Contatar o cliente: ' || coalesce(v_name, 'Cliente'),
      coalesce(v_name, 'Cliente') || ' terminou um plano sem precisar de reavaliação. Ligue ou mande mensagem, pergunte se foi tudo bem e registre na ficha.',
      '/prontuarios/' || v_f.client_id,
      v_user);
  else
    update public.treatment_closures set status = 'coordenador', updated_at = now() where id = p_id;
    perform public._fechamento_avisar(
      v_f.clinic_id, array['clinical_coordinator']::public.user_role[], null,
      'Decisão urgente: necessita de reavaliação?',
      coalesce(v_name, 'Cliente') || ' — quem executou não soube definir. Decida na ficha do cliente.',
      '/prontuarios/' || v_f.client_id,
      v_user);
  end if;

  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values (v_user, v_f.clinic_id, 'update', 'treatment_closure', p_id::text,
          jsonb_build_object('answer', p_answer, 'from_status', v_f.status));
end;
$$;
revoke execute on function public.answer_treatment_closure(uuid, text) from public, anon, authenticated;
grant execute on function public.answer_treatment_closure(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 11) O contato do Coordenador com o cliente (Passo 3b)
-- -----------------------------------------------------------------------------
create or replace function public.register_closure_contact(
  p_id uuid,
  p_channel text,
  p_reached boolean,
  p_summary text,
  p_outcome text default null,
  p_return_date date default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_f public.treatment_closures;
  v_user uuid := (select auth.uid());
  v_end boolean;
  v_fails integer;
  v_name text;
  v_phase public.journey_phase;
  v_return date;
begin
  if v_user is null then raise exception 'NOT_ALLOWED'; end if;
  select * into v_f from public.treatment_closures where id = p_id for update;
  if v_f.id is null then raise exception 'NOT_FOUND'; end if;
  if not (public.is_admin_master()
          or public.has_role_in_clinic(v_f.clinic_id, array['clinical_coordinator']::public.user_role[])) then
    raise exception 'NOT_ALLOWED';
  end if;
  if v_f.status <> 'contato' then raise exception 'NOT_IN_CONTACT'; end if;
  if p_channel not in ('ligacao', 'mensagem', 'presencial') then raise exception 'INVALID_CHANNEL'; end if;

  if p_reached then
    if length(btrim(coalesce(p_summary, ''))) < 5 then raise exception 'SUMMARY_REQUIRED'; end if;
    if p_outcome is null or p_outcome not in ('revisar', 'aguardar_retorno', 'novo_planejamento') then
      raise exception 'OUTCOME_REQUIRED';
    end if;
  else
    if p_outcome is not null and p_outcome <> 'sem_contato' then raise exception 'INVALID_OUTCOME'; end if;
  end if;
  if p_return_date is not null and p_return_date <= public.today_br() then
    raise exception 'RETURN_DATE_PAST';
  end if;

  insert into public.treatment_closure_contacts
    (closure_id, clinic_id, client_id, channel, reached, summary, recorded_by)
  values (p_id, v_f.clinic_id, v_f.client_id, p_channel, p_reached,
          nullif(btrim(p_summary), ''), v_user);

  -- D6: "sem contato" só depois de 3 tentativas sem falar com o cliente.
  if p_outcome = 'sem_contato' then
    select count(*) into v_fails from public.treatment_closure_contacts
     where closure_id = p_id and not reached;
    if v_fails < 3 then raise exception 'NEEDS_THREE_ATTEMPTS'; end if;
  end if;

  if p_outcome is null then
    return;  -- tentativa registrada; a tarefa continua aberta.
  end if;

  select full_name, journey_phase into v_name, v_phase from public.clients where id = v_f.client_id;
  v_end := not public._tratamento_em_aberto(v_f.client_id);

  if p_outcome = 'revisar' then
    update public.treatment_closures
       set outcome_note = nullif(btrim(p_summary), ''), updated_at = now()
     where id = p_id;
    perform public._fechamento_reavaliar(p_id, v_user);
  else
    v_return := coalesce(p_return_date, (public.today_br() + interval '6 months')::date);
    update public.treatment_closures set
      status = 'encerrado',
      outcome = p_outcome,
      outcome_note = nullif(btrim(p_summary), ''),
      return_date = case when p_outcome in ('aguardar_retorno', 'sem_contato') then v_return end,
      treatment_end = v_end,
      closed_by = v_user, closed_at = now(), updated_at = now()
    where id = p_id;

    if v_end and v_phase = 'treatment_start' then
      if p_outcome = 'novo_planejamento' then
        perform public._jornada_mover_por_evento(v_f.client_id, 'planning_center', 'fim_do_tratamento', v_user);
        insert into public.notifications (user_id, clinic_id, title, body, link)
        select distinct ucr.user_id, v_f.clinic_id, 'Novo caso no Centro de Planejamento',
               coalesce(v_name, 'Cliente') || ' — o Coordenador indicou novo planejamento no fim do tratamento.',
               '/prontuarios/' || v_f.client_id
          from public.user_clinic_roles ucr where ucr.role = 'planner_dentist';
      else
        perform public._jornada_mover_por_evento(v_f.client_id, 'follow_up', 'fim_do_tratamento', v_user, v_return);
        perform public._fechamento_avisar(
          v_f.clinic_id, array['receptionist']::public.user_role[], null,
          'Agendar retorno (acompanhamento): ' || coalesce(v_name, 'Cliente'),
          coalesce(v_name, 'Cliente') || ' terminou o tratamento. Retorno previsto para '
            || to_char(v_return, 'DD/MM/YYYY') || '.',
          '/agenda?cliente=' || v_f.client_id || '&tipo=return_visit',
          v_user);
      end if;
    end if;
  end if;

  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values (v_user, v_f.clinic_id, 'update', 'treatment_closure', p_id::text,
          jsonb_build_object('contact', p_channel, 'reached', p_reached, 'outcome', p_outcome));
end;
$$;
revoke execute on function public.register_closure_contact(uuid, text, boolean, text, text, date) from public, anon, authenticated;
grant execute on function public.register_closure_contact(uuid, text, boolean, text, text, date) to authenticated;

-- -----------------------------------------------------------------------------
-- 12) Check-in: a urgência não leva mais a Fase 1 à Fase 5 (D13)
-- -----------------------------------------------------------------------------
-- A definição em vigor (0032, conferida no banco de treino em 16/11/2026), sem
-- a linha `acquisition + urgency/emergency → treatment_start`.
create or replace function public.check_in_appointment(p_appointment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic uuid;
  v_client uuid;
  v_type public.appointment_type;
  v_phase public.journey_phase;
  v_new public.journey_phase;
  v_provider uuid;
  v_name text;
  v_user uuid := (select auth.uid());
begin
  select clinic_id, client_id, type, provider_user_id
    into v_clinic, v_client, v_type, v_provider
  from public.appointments where id = p_appointment_id;
  if v_clinic is null then raise exception 'APPOINTMENT_NOT_FOUND'; end if;

  if not (
    public.is_admin_master()
    or public.has_role_in_clinic(v_clinic, array['receptionist']::public.user_role[])
    or (public.is_sdr() and v_clinic in (select public.user_full_access_clinic_ids()))
    or v_provider = v_user  -- o profissional responsável (ex.: o Consultor) registra a própria chegada
  ) then
    raise exception 'NOT_ALLOWED';
  end if;

  update public.appointments
  set checked_in_at = coalesce(checked_in_at, now()),
      checked_in_by = coalesce(checked_in_by, v_user),
      attendance = 'waiting'
  where id = p_appointment_id;

  select journey_phase into v_phase from public.clients where id = v_client;

  -- 0416 (D13): a urgência/emergência deixou de levar a Fase 1 à Fase 5 —
  -- quem chega pela urgência não tem tratamento; o próximo passo é a
  -- avaliação completa (a tarefa nasce ao concluir o atendimento).
  v_new := case
    when v_phase = 'acquisition' and v_type = 'evaluation' then 'clinical_conversion'
    when v_phase = 'commercial_conversion' and v_type = 'treatment_start' then 'treatment_start'
    when v_phase = 'follow_up' and v_type = 'reevaluation' then 'reevaluation'
    when v_phase = 'follow_up' and v_type in ('treatment_session', 'treatment_start') then 'treatment_start'
    else null
  end::public.journey_phase;

  if v_new is not null and v_new is distinct from v_phase then
    update public.journey_phase_history set exited_at = now()
    where client_id = v_client and exited_at is null;
    insert into public.journey_phase_history (client_id, clinic_id, phase, moved_by)
    values (v_client, v_clinic, v_new, v_user);
    update public.clients set journey_phase = v_new, phase_entered_at = now()
    where id = v_client;

    insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
    values (v_user, v_clinic, 'update', 'client_journey', v_client::text,
            jsonb_build_object('from', v_phase, 'to', v_new, 'via', 'check_in'));
  end if;

  -- Avisa o profissional de que o cliente está na sala de espera (mas não a si
  -- mesmo, quando é o próprio profissional que faz o check-in).
  select full_name into v_name from public.clients where id = v_client;
  if v_provider is not null then
    if v_provider is distinct from v_user then
      insert into public.notifications (user_id, clinic_id, title, body, link)
      values (v_provider, v_clinic, 'Cliente em espera: ' || v_name,
              v_name || ' fez check-in e está na sala de espera.', '/atendimento');
    end if;
  else
    insert into public.notifications (user_id, clinic_id, title, body, link)
    select ucr.user_id, v_clinic, 'Cliente em espera: ' || v_name,
           v_name || ' fez check-in e está na sala de espera.', '/atendimento'
    from public.user_clinic_roles ucr
    where ucr.clinic_id = v_clinic
      and ucr.role in ('clinical_coordinator', 'dentist', 'commercial_consultant');
  end if;
end;
$$;
revoke execute on function public.check_in_appointment(uuid) from public, anon, authenticated;
grant execute on function public.check_in_appointment(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 13) "Tratamento Finalizado" à mão: só o Admin Master (D9)
-- -----------------------------------------------------------------------------
create or replace function public.set_journey_status(
  p_client_id uuid,
  p_status public.journey_status
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic uuid;
  v_phase public.journey_phase;
  v_valid boolean;
  v_allowed boolean;
begin
  select clinic_id, journey_phase into v_clinic, v_phase
  from public.clients where id = p_client_id;

  if v_clinic is null then raise exception 'CLIENT_NOT_FOUND'; end if;

  -- The status must belong to the client's current phase.
  v_valid := case v_phase
    when 'clinical_conversion' then p_status = 'awaiting_send_to_planning'
    when 'reevaluation' then p_status = 'awaiting_send_to_planning'
    when 'planning_center' then p_status in
      ('in_planning', 'awaiting_plan_approval', 'revision_with_coordinator')
    when 'treatment_start' then p_status in
      ('awaiting_treatment_start', 'in_treatment', 'treatment_finished',
       'treatment_cancelled', 'treatment_partially_cancelled')
    else false
  end;
  if not v_valid then raise exception 'STATUS_INVALID_FOR_PHASE'; end if;

  -- Role allowed to set this status. 0416 (D9): "Tratamento Finalizado" é
  -- marcado sozinho pelo fim do tratamento; à mão, só o Admin Master.
  v_allowed := public.is_admin_master() or case
    when p_status = 'treatment_finished' then false
    when p_status in ('in_planning', 'awaiting_plan_approval', 'revision_with_coordinator')
      then public.is_planner()
    when p_status = 'awaiting_send_to_planning'
      then public.has_role_in_clinic(v_clinic, array['clinical_coordinator']::public.user_role[])
    else
      public.has_role_in_clinic(v_clinic, array['clinical_coordinator','dentist','receptionist']::public.user_role[])
  end;
  if not v_allowed then raise exception 'NOT_ALLOWED'; end if;

  update public.clients set journey_status = p_status where id = p_client_id;

  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values ((select auth.uid()), v_clinic, 'update', 'client_status',
          p_client_id::text, jsonb_build_object('journey_status', p_status));
end;
$$;
revoke execute on function public.set_journey_status(uuid, public.journey_status) from public, anon, authenticated;
grant execute on function public.set_journey_status(uuid, public.journey_status) to authenticated;

-- O gatilho da 0019 abria a pergunta antiga (`journey_decisions`) quando o
-- sub-status virava "Tratamento Finalizado". Agora quem marca o sub-status é o
-- próprio fechamento, que já abriu a pergunta nova: o antigo abriria a segunda.
drop trigger if exists clients_treatment_finished on public.clients;

-- -----------------------------------------------------------------------------
-- 14) Auditoria das tabelas novas
-- -----------------------------------------------------------------------------
select public.audit_attach_all();

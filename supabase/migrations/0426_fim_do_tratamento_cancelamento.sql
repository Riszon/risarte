-- =============================================================================
-- 0426 — FIM DO TRATAMENTO, ETAPA 5: O CANCELAMENTO PELO CAMINHO DO FIM
-- Plano: docs/jornada/FIM-DO-TRATAMENTO-PLANO.md, seção 5.3 (D10, D11, D12, D25).
--
-- Os furos (5.3): o destino era gravado ao ABRIR o termo (o cliente podia
-- ficar esquecido na Fase 5); a pergunta "sobra outra venda?" não via venda
-- direta, ortodontia nem complemento; nada conferia o que foi executado; o
-- plano não virava "Cancelado"; a Fase 7 ia sem o Coordenador; os riscos de
-- um procedimento interrompido não eram registrados.
--
-- ⚠️ NÃO recria `open_plan_cancellation` nem `apply_plan_cancellation`: as
-- versões em vigor são da integração Asaas (4017a/4020) e, num banco montado
-- do zero, rodam DEPOIS de qualquer migração do core (ordem dos arquivos). Tudo
-- aqui entra por gatilhos em `plan_cancellations` e por portas novas.
--
--   1. Ao abrir o termo: com procedimento executado e incompleto, o termo exige
--      o registro do Coordenador sobre os riscos informados (D25) antes da
--      assinatura.
--   2. Antes de efetivar: `prepare_cancellation_apply` decide o destino pela
--      regra única (D10): sobra tratamento → fica na Fase 5 (sem destino); não
--      sobra → o Gerente escolhe a 6 ou a 7 (D12). Uma trava na efetivação
--      recusa o cliente esquecido na Fase 5 e a saída com tratamento sobrando.
--   3. Ao efetivar: o plano vira "Cancelado" e o Coordenador é chamado (D11):
--      a avaliação do que foi feito (Fase 6, ou na 5 com outro tratamento) ou o
--      contato (Fase 7) — um fechamento de escopo "cancelamento".
-- A venda direta (kind = 'venda_direta') segue como estava; só o registro dos
-- riscos vale para ela também.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Os riscos no termo (D25)
-- -----------------------------------------------------------------------------
alter table public.plan_cancellations
  add column if not exists risks_required boolean not null default false,
  add column if not exists risks_informed text,
  add column if not exists risks_channel text,
  add column if not exists risks_informed_on date,
  add column if not exists risks_registered_by uuid references public.profiles (id),
  add column if not exists risks_registered_at timestamptz;

do $$
begin
  alter table public.plan_cancellations
    add constraint plan_cancellations_risks_channel_chk
    check (risks_channel is null or risks_channel in ('ligacao', 'mensagem', 'presencial', 'carta'));
exception when duplicate_object then null;
end $$;

comment on column public.plan_cancellations.risks_required is
  '0426 (D25): há procedimento executado e incompleto; o termo só é assinado depois do registro do Coordenador sobre os riscos informados.';

-- -----------------------------------------------------------------------------
-- 2) O fechamento de escopo "cancelamento" (D11)
-- -----------------------------------------------------------------------------
alter table public.treatment_closures
  add column if not exists cancellation_id uuid references public.plan_cancellations (id);

alter table public.treatment_closures drop constraint if exists treatment_closures_scope_check;
alter table public.treatment_closures add constraint treatment_closures_scope_check
  check (scope in ('plano', 'venda_direta', 'ortodontia', 'urgencia', 'cancelamento'));

alter table public.treatment_closures drop constraint if exists treatment_closures_scope_ref;
alter table public.treatment_closures add constraint treatment_closures_scope_ref
  check (
    (scope = 'plano' and plan_id is not null)
    or (scope = 'venda_direta' and direct_sale_id is not null)
    or (scope = 'ortodontia' and ortho_case_id is not null)
    or (scope = 'urgencia' and appointment_id is not null)
    or (scope = 'cancelamento' and cancellation_id is not null)
  );

-- -----------------------------------------------------------------------------
-- 3) As regras internas
-- -----------------------------------------------------------------------------

-- "Sobra tratamento?" (3.1) sem contar o plano que está sendo cancelado: as
-- sessões dele, ele mesmo como complemento e a ortodontia da venda dele.
create or replace function public._tratamento_em_aberto_fora(p_client_id uuid, p_plan_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (
      select 1 from public.treatment_sessions ts
      where ts.client_id = p_client_id
        and ts.status in ('pending', 'scheduled')
        and ts.plan_id is distinct from p_plan_id
    )
    or exists (
      select 1 from public.treatment_plans tp
      where tp.client_id = p_client_id
        and tp.id is distinct from p_plan_id
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
    or exists (
      select 1 from public.ortho_cases o
      where o.client_id = p_client_id
        and o.status in ('aguardando_inicio', 'em_tratamento', 'suspenso')
        and not exists (select 1 from public.plan_negotiations n
                         where n.id = o.negotiation_id and n.plan_id = p_plan_id)
    );
$$;
revoke execute on function public._tratamento_em_aberto_fora(uuid, uuid) from public, anon, authenticated;

-- Um procedimento começou e não terminou (uma sessão feita e outra não)?
create or replace function public._cancelamento_tem_incompleto(p_plan_id uuid, p_direct_sale_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.treatment_sessions d
    where d.status = 'done'
      and d.item_id is not null
      and ((p_plan_id is not null and d.plan_id = p_plan_id)
           or (p_direct_sale_id is not null and d.direct_sale_id = p_direct_sale_id))
      and exists (
        select 1 from public.treatment_sessions p
        where p.item_id = d.item_id
          and p.status in ('pending', 'scheduled')
      )
  );
$$;
revoke execute on function public._cancelamento_tem_incompleto(uuid, uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4) Ao abrir o termo: os riscos são exigidos? (D25)
-- -----------------------------------------------------------------------------
create or replace function public.plan_cancellation_risks_on_open()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  new.risks_required := public._cancelamento_tem_incompleto(new.plan_id, new.direct_sale_id);
  if new.risks_required then
    select full_name into v_name from public.clients where id = new.client_id;
    perform public._fechamento_avisar(
      new.clinic_id, array['clinical_coordinator']::public.user_role[], null,
      'Cancelamento: registrar os riscos informados — ' || coalesce(v_name, 'Cliente'),
      'O termo de cancelamento tem procedimento começado e não terminado. Ele só pode ser assinado depois do seu registro sobre os riscos clínicos informados ao cliente.',
      '/prontuarios/' || new.client_id, null);
  end if;
  return new;
end;
$$;
revoke execute on function public.plan_cancellation_risks_on_open() from public, anon, authenticated;

drop trigger if exists plan_cancellation_risks_on_open on public.plan_cancellations;
create trigger plan_cancellation_risks_on_open
  before insert on public.plan_cancellations
  for each row execute function public.plan_cancellation_risks_on_open();

-- -----------------------------------------------------------------------------
-- 5) As travas da assinatura e da efetivação
-- -----------------------------------------------------------------------------
create or replace function public.plan_cancellation_end_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phase public.journey_phase;
  v_entered timestamptz;
begin
  -- D25: sem o registro dos riscos, o termo não é assinado.
  if new.status = 'assinado' and old.status = 'rascunho'
     and new.risks_required and new.risks_registered_at is null then
    raise exception 'RISKS_PENDING';
  end if;

  -- D10: na efetivação de um contrato, a fase segue a regra única. Neste
  -- ponto as sessões do plano já foram canceladas e a fase já foi movida (ou
  -- não) pelo `apply_plan_cancellation`.
  if new.status = 'efetivado' and old.status <> 'efetivado' and new.kind = 'contrato' then
    select journey_phase, phase_entered_at into v_phase, v_entered
      from public.clients where id = new.client_id;
    if v_phase = 'treatment_start' and not public._tratamento_em_aberto(new.client_id) then
      -- O cliente ficaria esquecido na Fase 5 sem tratamento.
      raise exception 'DESTINATION_REQUIRED';
    end if;
    if v_phase in ('reevaluation', 'follow_up') and v_entered = now()
       and public._tratamento_em_aberto(new.client_id) then
      -- Saiu da Fase 5 com tratamento sobrando.
      raise exception 'TREATMENT_STILL_OPEN';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.plan_cancellation_end_guard() from public, anon, authenticated;

drop trigger if exists plan_cancellation_end_guard on public.plan_cancellations;
create trigger plan_cancellation_end_guard
  before update of status on public.plan_cancellations
  for each row execute function public.plan_cancellation_end_guard();

-- -----------------------------------------------------------------------------
-- 6) Efetivado: o plano "Cancelado" e o Coordenador chamado (D11)
-- -----------------------------------------------------------------------------
create or replace function public.plan_cancellation_end_apply()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phase public.journey_phase;
  v_name text;
  v_feito boolean;
  v_status text;
  v_lider public.treatment_closures;
  v_user uuid := (select auth.uid());
begin
  if not (new.status = 'efetivado' and old.status <> 'efetivado' and new.kind = 'contrato') then
    return new;
  end if;

  -- O plano vira "Cancelado" quando não sobra venda viva dele.
  if new.plan_id is not null and not exists (
       select 1 from public.plan_negotiations n
       join public.commercial_sales s on s.negotiation_id = n.id
       where n.plan_id = new.plan_id and n.id <> new.negotiation_id
         and s.closed_at is not null and s.cancelled_at is null) then
    update public.treatment_plans set lifecycle = 'cancelado'
     where id = new.plan_id and coalesce(lifecycle::text, '') <> 'cancelado';
  end if;

  select journey_phase, full_name into v_phase, v_name from public.clients where id = new.client_id;
  v_feito := exists (select 1 from public.treatment_sessions
                      where plan_id = new.plan_id and status = 'done');

  v_status := case
    when v_phase = 'reevaluation' then 'reavaliacao'
    when v_phase = 'follow_up' then 'contato'
    when v_phase = 'treatment_start' and v_feito then 'reavaliacao'
    else null end;
  if v_status is null then return new; end if;

  select * into v_lider from public.treatment_closures
   where client_id = new.client_id and grouped_into is null
     and status in ('pergunta', 'coordenador', 'reavaliacao', 'contato')
   for update;

  if v_lider.id is not null then
    -- Já há uma decisão aberta: o cancelamento entra nela (E1, 0422).
    insert into public.treatment_closures
      (clinic_id, client_id, scope, plan_id, cancellation_id, treatment_end,
       status, answer, answered_by, answered_at, grouped_into)
    values
      (new.clinic_id, new.client_id, 'cancelamento', new.plan_id, new.id,
       v_phase <> 'treatment_start', v_lider.status, v_lider.answer,
       v_lider.answered_by, v_lider.answered_at, v_lider.id);
  else
    insert into public.treatment_closures
      (clinic_id, client_id, scope, plan_id, cancellation_id, treatment_end,
       status, answer, answered_by, answered_at)
    values
      (new.clinic_id, new.client_id, 'cancelamento', new.plan_id, new.id,
       v_phase <> 'treatment_start', v_status,
       case when v_status = 'reavaliacao' then 'sim' else 'nao' end, v_user, now());
  end if;

  perform public._fechamento_avisar(
    new.clinic_id,
    case when v_status = 'reavaliacao'
         then array['clinical_coordinator', 'receptionist']::public.user_role[]
         else array['clinical_coordinator']::public.user_role[] end,
    null,
    case when v_status = 'reavaliacao'
         then 'Cancelamento: avaliar o que foi feito — ' || coalesce(v_name, 'Cliente')
         else 'Cancelamento: contatar o cliente — ' || coalesce(v_name, 'Cliente') end,
    case when v_status = 'reavaliacao'
         then 'O plano foi cancelado. A Recepção agenda a reavaliação e o Coordenador avalia o que foi executado.'
         else 'O plano foi cancelado e o cliente foi para o Acompanhamento. O Coordenador contata o cliente e registra como foi.' end,
    '/prontuarios/' || new.client_id, v_user);
  return new;
end;
$$;
revoke execute on function public.plan_cancellation_end_apply() from public, anon, authenticated;

drop trigger if exists plan_cancellation_end_apply on public.plan_cancellations;
create trigger plan_cancellation_end_apply
  after update of status on public.plan_cancellations
  for each row execute function public.plan_cancellation_end_apply();

-- -----------------------------------------------------------------------------
-- 7) As portas
-- -----------------------------------------------------------------------------

-- 7a) O Coordenador registra os riscos informados (D25).
create or replace function public.register_cancellation_risks(
  p_id uuid,
  p_risks text,
  p_channel text,
  p_informed_on date
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_c public.plan_cancellations%rowtype;
begin
  if v_user is null then raise exception 'NOT_ALLOWED'; end if;
  select * into v_c from public.plan_cancellations where id = p_id for update;
  if v_c.id is null then raise exception 'NOT_FOUND'; end if;
  if not (public.is_admin_master() or public.has_role_in_clinic(v_c.clinic_id,
          array['clinical_coordinator']::public.user_role[])) then
    raise exception 'NOT_ALLOWED';
  end if;
  if v_c.status <> 'rascunho' then raise exception 'ALREADY_SIGNED'; end if;
  if length(trim(coalesce(p_risks, ''))) < 20 then raise exception 'RISKS_REQUIRED'; end if;
  if p_channel is null or p_channel not in ('ligacao', 'mensagem', 'presencial', 'carta') then
    raise exception 'INVALID_CHANNEL';
  end if;
  if p_informed_on is null or p_informed_on > public.today_br() then raise exception 'INVALID_DATE'; end if;

  update public.plan_cancellations
     set risks_informed = trim(p_risks), risks_channel = p_channel, risks_informed_on = p_informed_on,
         risks_registered_by = v_user, risks_registered_at = now()
   where id = p_id;

  perform public._fechamento_avisar(
    v_c.clinic_id, array['unit_manager']::public.user_role[], null,
    'Cancelamento ' || coalesce(v_c.code, '') || ': riscos registrados',
    'O Coordenador registrou os riscos clínicos informados. O termo já pode ser assinado.',
    '/cancelamentos/' || p_id || '/termo', v_user);
end;
$$;
revoke execute on function public.register_cancellation_risks(uuid, text, text, date) from public, anon, authenticated;
grant execute on function public.register_cancellation_risks(uuid, text, text, date) to authenticated;

-- 7b) O que a efetivação vai fazer com a fase (para a tela).
create or replace function public.cancellation_end_info(p_id uuid)
returns table (segue_em_tratamento boolean, fase public.journey_phase, kind text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_c public.plan_cancellations%rowtype;
begin
  if (select auth.uid()) is null then raise exception 'NOT_ALLOWED'; end if;
  select * into v_c from public.plan_cancellations where id = p_id;
  if v_c.id is null then raise exception 'NOT_FOUND'; end if;
  if not (public.is_admin_master() or public.has_role_in_clinic(v_c.clinic_id,
          array['unit_manager', 'clinical_coordinator', 'receptionist']::public.user_role[])) then
    raise exception 'NOT_ALLOWED';
  end if;
  return query
    select public._tratamento_em_aberto_fora(v_c.client_id, v_c.plan_id),
           c.journey_phase, v_c.kind
      from public.clients c where c.id = v_c.client_id;
end;
$$;
revoke execute on function public.cancellation_end_info(uuid) from public, anon, authenticated;
grant execute on function public.cancellation_end_info(uuid) to authenticated;

-- 7c) Antes de efetivar: o destino pela regra única (D10, D12).
create or replace function public.prepare_cancellation_apply(
  p_id uuid,
  p_destination text default null,
  p_return_date date default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_c public.plan_cancellations%rowtype;
  v_phase public.journey_phase;
  v_dest text;
  v_return date;
begin
  if v_user is null then raise exception 'NOT_ALLOWED'; end if;
  select * into v_c from public.plan_cancellations where id = p_id for update;
  if v_c.id is null then raise exception 'NOT_FOUND'; end if;
  if not (public.is_admin_master() or public.has_role_in_clinic(v_c.clinic_id,
          array['unit_manager']::public.user_role[])) then
    raise exception 'NOT_ALLOWED';
  end if;
  if v_c.status not in ('rascunho', 'assinado') then raise exception 'ALREADY_APPLIED'; end if;
  if v_c.kind <> 'contrato' then return 'sem_mudanca'; end if;

  select journey_phase into v_phase from public.clients where id = v_c.client_id;
  if v_phase <> 'treatment_start' then return 'sem_mudanca'; end if;

  -- Sobra tratamento: fica na Fase 5, sem destino.
  if public._tratamento_em_aberto_fora(v_c.client_id, v_c.plan_id) then
    update public.plan_cancellations set destination = null, follow_up_return_at = null
     where id = p_id;
    return 'segue_em_tratamento';
  end if;

  v_dest := coalesce(p_destination, v_c.destination);
  if v_dest is null then raise exception 'DESTINATION_REQUIRED'; end if;
  if v_dest not in ('reevaluation', 'follow_up') then raise exception 'INVALID_DESTINATION'; end if;
  if v_dest = 'follow_up' then
    v_return := coalesce(p_return_date, v_c.follow_up_return_at,
                         (public.today_br() + interval '6 months')::date);
    if v_return <= public.today_br() then raise exception 'RETURN_DATE_PAST'; end if;
  end if;

  update public.plan_cancellations set destination = v_dest, follow_up_return_at = v_return
   where id = p_id;
  return v_dest;
end;
$$;
revoke execute on function public.prepare_cancellation_apply(uuid, text, date) from public, anon, authenticated;
grant execute on function public.prepare_cancellation_apply(uuid, text, date) to authenticated;

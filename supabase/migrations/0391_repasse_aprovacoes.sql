-- =============================================================================
-- 0391 — REPASSE DOS DENTISTAS, ETAPA 3: AS APROVAÇÕES
--
-- Plano e decisões do dono: docs/Financeiro/REPASSE-PLANO.md. Desta etapa
-- (10/11/2026, as seis como recomendado):
--   A1) o Gerente pode DEVOLVER o relatório ao Financeiro, com motivo;
--   A2) só o Financeiro da Franqueadora corrige o VALOR de uma linha, com
--       motivo e com o valor antigo guardado; o Gerente pede, não altera;
--   A3) o dentista contesta por linha, com um motivo da lista (valor
--       diferente / não fui eu que fiz / outro) e texto obrigatório;
--   A4) "está faltando procedimento" é um pedido ao aprovador no mesmo
--       formulário; se proceder, entra no PRÓXIMO relatório;
--   A5) avisos pelo sino do sistema;
--   A6) uma resposta do aprovador; se o dentista contestar a MESMA linha de
--       novo, ela vai ao Financeiro da Franqueadora, que decide (decisão 11).
--
-- O CAMINHO DO RELATÓRIO (`payout_reports.status`):
--   rascunho → com_gerente → com_dentista → aprovado
--                  ↓ devolver      ↓ contestou
--               rascunho      em_contestacao → (resposta) → com_dentista
--                                   ↓ 2ª contestação / pedido do aprovador
--                               em_desempate → (Financeiro decide) → …
--
-- A LINHA (`payout_report_items.review_state`), depois que o aprovador envia
-- ao dentista: pendente → aprovado | contestado → pendente | no_financeiro.
-- `released` = LIBERADA PARA PAGAR: o dentista aprovou, ou o Financeiro
-- decidiu. É a APROVAÇÃO PARCIAL (decisão 2): a Etapa 4 paga o que está
-- liberado, mesmo com outra linha do relatório ainda em discussão.
--
-- QUEM APROVA (decisão 4), no lugar "do Gerente":
--   • unidade COM Gerente: o(s) Gerente(s);
--   • unidade SEM Gerente: o(s) Coordenador(es) clínico(s);
--   • nunca o próprio dentista do relatório. Se não sobra ninguém (o
--     relatório é do próprio Coordenador), aprova o Financeiro da
--     Franqueadora — e NÃO a mesma pessoa que enviou o relatório.
--   • sempre UM relatório por chamada: não existe aprovação em lote.
--
-- O DENTISTA lê só pelas funções `my_payout_reports` /
-- `my_payout_report_detail` (os relatórios dele, depois que o aprovador
-- enviou, só as linhas incluídas — nada do registro interno). As tabelas
-- continuam sem regra de leitura para ele e sem regra de escrita para ninguém.
--
-- PRAZO (decisão 5): 5 dias úteis (fim de semana e feriado nacional fora).
-- Lembrete no 3º dia útil; vencido, avisa o aprovador. NUNCA aprova sozinho.
--
-- Nada é apagado. Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Colunas
-- -----------------------------------------------------------------------------
alter table public.payout_reports drop constraint if exists payout_reports_status_check;
alter table public.payout_reports
  add constraint payout_reports_status_check check (status in (
    'rascunho', 'com_gerente', 'com_dentista', 'em_contestacao',
    'em_desempate', 'aprovado', 'cancelado'));

alter table public.payout_reports
  add column if not exists sent_by uuid references public.profiles (id),
  add column if not exists sent_at timestamptz,
  add column if not exists manager_by uuid references public.profiles (id),
  add column if not exists manager_at timestamptz,
  add column if not exists dentist_since date,
  add column if not exists dentist_due_on date,
  add column if not exists dentist_reminded_at timestamptz,
  add column if not exists dentist_escalated_at timestamptz,
  add column if not exists dentist_responded_at timestamptz,
  add column if not exists approved_at timestamptz,
  add column if not exists missing_note text,
  add column if not exists missing_noted_at timestamptz;

alter table public.payout_report_items
  add column if not exists review_state text
    check (review_state in ('pendente', 'aprovado', 'contestado', 'no_financeiro')),
  add column if not exists released boolean not null default false,
  add column if not exists released_at timestamptz,
  add column if not exists contest_kind text
    check (contest_kind in ('valor', 'nao_fui_eu', 'outro')),
  add column if not exists contest_text text,
  add column if not exists contest_round integer not null default 0,
  add column if not exists contested_at timestamptz,
  add column if not exists manager_response text,
  add column if not exists manager_responded_by uuid references public.profiles (id),
  add column if not exists manager_responded_at timestamptz,
  add column if not exists finance_action text
    check (finance_action in ('manter', 'corrigir', 'excluir')),
  add column if not exists finance_reason text,
  add column if not exists finance_by uuid references public.profiles (id),
  add column if not exists finance_at timestamptz,
  add column if not exists original_amount_cents bigint;

comment on column public.payout_report_items.released is
  'Liberada para pagar (0391): o dentista aprovou, ou o Financeiro da Franqueadora decidiu. A Etapa 4 paga só o que está liberado.';

-- -----------------------------------------------------------------------------
-- 2) Quem aprova, quem lê
-- -----------------------------------------------------------------------------
create or replace function public._payout_report_approvers(p_report_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  with r as (
    select pr.clinic_id, pr.provider_id
      from public.payout_reports pr where pr.id = p_report_id
  ),
  mgr as (
    select u.user_id
      from public.user_clinic_roles_all u
      join r on r.clinic_id = u.clinic_id
      join public.profiles p on p.id = u.user_id and p.is_active
     where u.role = 'unit_manager'
  ),
  coord as (
    select u.user_id
      from public.user_clinic_roles_all u
      join r on r.clinic_id = u.clinic_id
      join public.profiles p on p.id = u.user_id and p.is_active
     where u.role = 'clinical_coordinator'
  )
  select m.user_id from mgr m, r where m.user_id <> r.provider_id
  union
  select c.user_id from coord c, r
   where not exists (select 1 from mgr) and c.user_id <> r.provider_id;
$$;
revoke execute on function public._payout_report_approvers(uuid) from public, anon, authenticated;

-- 'gerente' | 'coordenador' | 'financeiro' — quem está no lugar do aprovador.
create or replace function public._payout_report_approver_kind(p_report_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when not exists (select 1 from public._payout_report_approvers(p_report_id)) then 'financeiro'
    when exists (
      select 1 from public.user_clinic_roles_all u
        join public.payout_reports pr on pr.id = p_report_id and pr.clinic_id = u.clinic_id
        join public.profiles p on p.id = u.user_id and p.is_active
       where u.role = 'unit_manager') then 'gerente'
    else 'coordenador'
  end;
$$;
revoke execute on function public._payout_report_approver_kind(uuid) from public, anon, authenticated;

create or replace function public.can_approve_payout_report(p_report_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
     and exists (
       select 1 from public.payout_reports pr
        where pr.id = p_report_id
          -- Ninguém aprova o próprio relatório.
          and pr.provider_id <> (select auth.uid())
          and (
            (select auth.uid()) in (select public._payout_report_approvers(p_report_id))
            or (
              -- Sem aprovador na unidade: o Financeiro da Franqueadora, e não
              -- a mesma pessoa que enviou.
              not exists (select 1 from public._payout_report_approvers(p_report_id))
              and public.can_manage_payout_reports()
              and pr.sent_by is distinct from (select auth.uid())
            )
          )
     );
$$;
revoke execute on function public.can_approve_payout_report(uuid) from public, anon, authenticated;
grant execute on function public.can_approve_payout_report(uuid) to authenticated;

-- Lê o relatório: quem vê o financeiro da unidade, ou o aprovador dele (o
-- Coordenador não vê financeiro) — este só depois de enviado.
create or replace function public._payout_report_can_read(p_report_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.payout_reports pr
     where pr.id = p_report_id
       and (
         pr.clinic_id in (select public.finance_visible_clinic_ids())
         or (pr.status not in ('rascunho', 'cancelado')
             and (select auth.uid()) in (select public._payout_report_approvers(p_report_id)))
       )
  );
$$;
revoke execute on function public._payout_report_can_read(uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3) Internas: dias úteis, avisos, situação do relatório
-- -----------------------------------------------------------------------------
-- Dias úteis: fora sábado, domingo e feriado NACIONAL (os municipais variam
-- por unidade e não entram no prazo do repasse).
create or replace function public._payout_add_business_days(p_date date, p_days integer)
returns date
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_date date := p_date;
  v_left integer := greatest(0, coalesce(p_days, 0));
begin
  while v_left > 0 loop
    v_date := v_date + 1;
    if extract(dow from v_date) not in (0, 6)
       and not exists (
         select 1 from public.holidays h
          where h.holiday_date = v_date and h.scope = 'national')
    then
      v_left := v_left - 1;
    end if;
  end loop;
  return v_date;
end;
$$;
revoke execute on function public._payout_add_business_days(date, integer) from public, anon, authenticated;

create or replace function public._payout_finance_users()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select distinct u.user_id
    from public.user_clinic_roles_all u
    join public.profiles p on p.id = u.user_id and p.is_active
   where u.role = 'finance_franchisor';
$$;
revoke execute on function public._payout_finance_users() from public, anon, authenticated;

-- Aviso no sino. Nunca avisa quem está fazendo a ação. Sem dado de paciente.
create or replace function public._payout_report_notify(
  p_users uuid[], p_clinic_id uuid, p_title text, p_body text, p_link text
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications (user_id, clinic_id, title, body, link)
  select distinct x.uid, p_clinic_id, p_title, p_body, p_link
    from unnest(coalesce(p_users, array[]::uuid[])) as x(uid)
   where x.uid is not null
     and x.uid is distinct from (select auth.uid());
$$;
revoke execute on function public._payout_report_notify(uuid[], uuid, text, text, text) from public, anon, authenticated;

-- Quem cuida do relatório na vez do aprovador (ou o Financeiro, sem aprovador).
create or replace function public._payout_report_reviewers(p_report_id uuid)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when exists (select 1 from public._payout_report_approvers(p_report_id))
      then array(select public._payout_report_approvers(p_report_id))
    else array(select public._payout_finance_users())
  end;
$$;
revoke execute on function public._payout_report_reviewers(uuid) from public, anon, authenticated;

-- A situação do relatório segue as linhas (só depois de enviado ao dentista).
create or replace function public._payout_report_sync(p_report_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r public.payout_reports%rowtype;
  v_new text;
  v_n integer; v_cont integer; v_pend integer; v_fin integer;
begin
  select * into v_r from public.payout_reports where id = p_report_id for update;
  if v_r.status not in ('com_dentista', 'em_contestacao', 'em_desempate') then
    return v_r.status;
  end if;

  select count(*),
         count(*) filter (where i.review_state = 'contestado'),
         count(*) filter (where i.review_state = 'pendente'),
         count(*) filter (where i.review_state = 'no_financeiro')
    into v_n, v_cont, v_pend, v_fin
    from public.payout_report_items i
   where i.report_id = p_report_id and i.status = 'incluido';

  v_new := case
    when v_n = 0 then 'cancelado'
    when v_cont > 0 then 'em_contestacao'
    when v_pend > 0 then 'com_dentista'
    when v_fin > 0 then 'em_desempate'
    else 'aprovado'
  end;

  if v_new = v_r.status then return v_new; end if;

  update public.payout_reports
     set status = v_new,
         updated_at = now(),
         approved_at = case when v_new = 'aprovado' then now() else approved_at end,
         cancelled_at = case when v_new = 'cancelado' then now() else cancelled_at end,
         cancel_reason = case when v_new = 'cancelado'
                              then 'Todos os procedimentos foram excluídos.' else cancel_reason end,
         -- Voltou para o dentista: o prazo recomeça.
         dentist_since = case when v_new = 'com_dentista' then public.today_br() else dentist_since end,
         dentist_due_on = case when v_new = 'com_dentista'
                               then public._payout_add_business_days(public.today_br(), 5)
                               else dentist_due_on end,
         dentist_reminded_at = case when v_new = 'com_dentista' then null else dentist_reminded_at end,
         dentist_escalated_at = case when v_new = 'com_dentista' then null else dentist_escalated_at end
   where id = p_report_id;

  perform public._payout_report_event(p_report_id, null, v_r.clinic_id,
    case v_new
      when 'aprovado' then 'aprovado'
      when 'cancelado' then 'cancelado'
      when 'em_contestacao' then 'em_contestacao'
      when 'em_desempate' then 'em_desempate'
      else 'voltou_ao_dentista'
    end, null);
  return v_new;
end;
$$;
revoke execute on function public._payout_report_sync(uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4) O FINANCEIRO ENVIA; o aprovador DEVOLVE ou APROVA (um por vez)
-- -----------------------------------------------------------------------------
create or replace function public.payout_report_send(p_report_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r public.payout_reports%rowtype;
  v_kind text;
begin
  if not public.can_manage_payout_reports() then raise exception 'NOT_ALLOWED'; end if;
  select * into v_r from public.payout_reports where id = p_report_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_r.status <> 'rascunho' then raise exception 'REPORT_NOT_DRAFT'; end if;
  if v_r.item_count = 0 then raise exception 'EMPTY_REPORT'; end if;

  update public.payout_reports
     set status = 'com_gerente', sent_by = (select auth.uid()), sent_at = now(), updated_at = now()
   where id = p_report_id;

  v_kind := public._payout_report_approver_kind(p_report_id);
  perform public._payout_report_event(p_report_id, null, v_r.clinic_id, 'enviado_para_aprovacao',
    case v_kind when 'gerente' then 'Aprovador: Gerente da unidade'
                when 'coordenador' then 'Aprovador: Coordenador clínico (unidade sem Gerente)'
                else 'Aprovador: Financeiro da Franqueadora (relatório do próprio aprovador)' end);
  perform public._payout_report_notify(
    public._payout_report_reviewers(p_report_id), v_r.clinic_id,
    'Repasse para aprovar — ' || v_r.code,
    'Um relatório de repasse da sua equipe espera a sua conferência.',
    '/repasses/' || p_report_id);
  return v_kind;
end;
$$;
revoke execute on function public.payout_report_send(uuid) from public, anon, authenticated;
grant execute on function public.payout_report_send(uuid) to authenticated;

create or replace function public.payout_report_return(p_report_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r public.payout_reports%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  select * into v_r from public.payout_reports where id = p_report_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if not public.can_approve_payout_report(p_report_id) then raise exception 'NOT_ALLOWED'; end if;
  if v_r.status <> 'com_gerente' then raise exception 'WRONG_STAGE'; end if;
  if v_reason is null or length(v_reason) < 5 then raise exception 'REASON_REQUIRED'; end if;

  update public.payout_reports
     set status = 'rascunho', sent_by = null, sent_at = null, updated_at = now()
   where id = p_report_id;
  perform public._payout_report_event(p_report_id, null, v_r.clinic_id, 'devolvido_ao_financeiro', v_reason);
  perform public._payout_report_notify(
    array[v_r.sent_by] || array(select public._payout_finance_users()), v_r.clinic_id,
    'Repasse devolvido — ' || v_r.code,
    'O aprovador devolveu o relatório ao Financeiro. Veja o motivo no relatório.',
    '/financeiro/repasses/relatorios/' || p_report_id);
end;
$$;
revoke execute on function public.payout_report_return(uuid, text) from public, anon, authenticated;
grant execute on function public.payout_report_return(uuid, text) to authenticated;

-- UM relatório por chamada: não existe versão em lote desta função.
create or replace function public.payout_report_manager_approve(p_report_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r public.payout_reports%rowtype;
  v_due date;
begin
  select * into v_r from public.payout_reports where id = p_report_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if not public.can_approve_payout_report(p_report_id) then raise exception 'NOT_ALLOWED'; end if;
  if v_r.status <> 'com_gerente' then raise exception 'WRONG_STAGE'; end if;
  if v_r.item_count = 0 then raise exception 'EMPTY_REPORT'; end if;

  v_due := public._payout_add_business_days(public.today_br(), 5);

  update public.payout_report_items
     set review_state = 'pendente'
   where report_id = p_report_id and status = 'incluido';

  update public.payout_reports
     set status = 'com_dentista', manager_by = (select auth.uid()), manager_at = now(),
         dentist_since = public.today_br(), dentist_due_on = v_due,
         dentist_reminded_at = null, dentist_escalated_at = null, updated_at = now()
   where id = p_report_id;

  perform public._payout_report_event(p_report_id, null, v_r.clinic_id, 'enviado_ao_dentista',
    'Prazo do dentista: ' || to_char(v_due, 'DD/MM/YYYY'));
  perform public._payout_report_notify(
    array[v_r.provider_id], v_r.clinic_id,
    'Seu repasse está pronto para conferir — ' || v_r.code,
    'Confira os procedimentos e aprove ou conteste até ' || to_char(v_due, 'DD/MM/YYYY') || '.',
    '/repasses/' || p_report_id);
end;
$$;
revoke execute on function public.payout_report_manager_approve(uuid) from public, anon, authenticated;
grant execute on function public.payout_report_manager_approve(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 5) Excluir / devolver item: o Financeiro no rascunho, o aprovador na vez dele
--    (corpos da 0390 com a guarda nova)
-- -----------------------------------------------------------------------------
create or replace function public._payout_report_can_adjust(p_report_id uuid, p_status text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (p_status = 'rascunho' and public.can_manage_payout_reports())
      or (p_status = 'com_gerente' and public.can_approve_payout_report(p_report_id));
$$;
revoke execute on function public._payout_report_can_adjust(uuid, text) from public, anon, authenticated;

create or replace function public.payout_report_exclude_item(
  p_item_id uuid, p_kind text, p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_i public.payout_report_items%rowtype;
  v_status text;
  v_user uuid := (select auth.uid());
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  select * into v_i from public.payout_report_items where id = p_item_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  select pr.status into v_status from public.payout_reports pr where pr.id = v_i.report_id for update;
  if v_status not in ('rascunho', 'com_gerente') then raise exception 'REPORT_NOT_DRAFT'; end if;
  if not public._payout_report_can_adjust(v_i.report_id, v_status) then raise exception 'NOT_ALLOWED'; end if;
  if v_i.status <> 'incluido' then raise exception 'ALREADY_EXCLUDED'; end if;
  if p_kind is null or p_kind not in ('adiar', 'nao_pagar') then raise exception 'INVALID_KIND'; end if;
  if v_reason is null or length(v_reason) < 5 then raise exception 'REASON_REQUIRED'; end if;

  update public.payout_report_items
     set status = 'excluido', active = false, exclusion_kind = p_kind,
         exclusion_reason = v_reason, excluded_by = v_user, excluded_at = now()
   where id = p_item_id;

  if p_kind = 'nao_pagar' then
    update public.provider_payouts
       set withheld = true, withheld_reason = v_reason,
           withheld_by = v_user, withheld_at = now()
     where id = v_i.payout_id;
  end if;

  perform public._payout_report_event(v_i.report_id, p_item_id, v_i.clinic_id,
    case when p_kind = 'adiar' then 'item_adiado' else 'item_nao_pagar' end, v_reason);
  perform public._payout_report_refresh(v_i.report_id);
end;
$$;
revoke execute on function public.payout_report_exclude_item(uuid, text, text) from public, anon, authenticated;
grant execute on function public.payout_report_exclude_item(uuid, text, text) to authenticated;

create or replace function public.payout_report_restore_item(p_item_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_i public.payout_report_items%rowtype;
  v_status text;
begin
  select * into v_i from public.payout_report_items where id = p_item_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  select pr.status into v_status from public.payout_reports pr where pr.id = v_i.report_id for update;
  if v_status not in ('rascunho', 'com_gerente') then raise exception 'REPORT_NOT_DRAFT'; end if;
  if not public._payout_report_can_adjust(v_i.report_id, v_status) then raise exception 'NOT_ALLOWED'; end if;
  if v_i.status <> 'excluido' then raise exception 'NOT_EXCLUDED'; end if;
  if exists (
    select 1 from public.payout_report_items o
     where o.payout_id = v_i.payout_id and o.active and o.id <> p_item_id
  ) then
    raise exception 'PAYOUT_IN_OTHER_REPORT';
  end if;

  if v_i.exclusion_kind = 'nao_pagar' then
    update public.provider_payouts
       set withheld = false, withheld_reason = null, withheld_by = null, withheld_at = null
     where id = v_i.payout_id;
  end if;

  update public.payout_report_items
     set status = 'incluido', active = true, exclusion_kind = null,
         exclusion_reason = null, excluded_by = null, excluded_at = null
   where id = p_item_id;

  perform public._payout_report_event(v_i.report_id, p_item_id, v_i.clinic_id,
    'item_devolvido', 'Era: ' || v_i.exclusion_kind || ' — ' || coalesce(v_i.exclusion_reason, ''));
  perform public._payout_report_refresh(v_i.report_id);
end;
$$;
revoke execute on function public.payout_report_restore_item(uuid) from public, anon, authenticated;
grant execute on function public.payout_report_restore_item(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 6) O DENTISTA RESPONDE — aprova o que não contestar (aprovação parcial)
--    p_contests: [{"item_id": "...", "kind": "valor|nao_fui_eu|outro", "text": "..."}]
-- -----------------------------------------------------------------------------
create or replace function public.payout_report_dentist_respond(
  p_report_id uuid,
  p_contests jsonb default '[]'::jsonb,
  p_missing text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r public.payout_reports%rowtype;
  v_user uuid := (select auth.uid());
  v_missing text := nullif(btrim(coalesce(p_missing, '')), '');
  v_c jsonb := coalesce(p_contests, '[]'::jsonb);
  v_e jsonb;
  v_item public.payout_report_items%rowtype;
  v_kind text;
  v_text text;
  v_new text;
  v_fin integer := 0;
  v_cont integer := 0;
begin
  select * into v_r from public.payout_reports where id = p_report_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_user is null or v_r.provider_id <> v_user then raise exception 'NOT_ALLOWED'; end if;
  if v_r.status <> 'com_dentista' then raise exception 'WRONG_STAGE'; end if;
  if jsonb_typeof(v_c) <> 'array' then raise exception 'INVALID_INPUT'; end if;
  if v_missing is not null and length(v_missing) < 5 then raise exception 'REASON_REQUIRED'; end if;

  -- As contestadas: motivo da lista + texto obrigatório.
  for v_e in select * from jsonb_array_elements(v_c) loop
    v_kind := v_e ->> 'kind';
    v_text := nullif(btrim(coalesce(v_e ->> 'text', '')), '');
    select * into v_item from public.payout_report_items i
     where i.id = (v_e ->> 'item_id')::uuid and i.report_id = p_report_id for update;
    if not found or v_item.status <> 'incluido' or v_item.review_state <> 'pendente' then
      raise exception 'INVALID_ITEM';
    end if;
    if v_kind is null or v_kind not in ('valor', 'nao_fui_eu', 'outro') then raise exception 'INVALID_KIND'; end if;
    if v_text is null or length(v_text) < 5 then raise exception 'REASON_REQUIRED'; end if;

    -- A6: a 2ª contestação da MESMA linha vai direto ao Financeiro.
    update public.payout_report_items
       set review_state = case when contest_round >= 1 then 'no_financeiro' else 'contestado' end,
           contest_kind = v_kind, contest_text = v_text,
           contest_round = contest_round + 1, contested_at = now(),
           released = false, released_at = null
     where id = v_item.id;
    if v_item.contest_round >= 1 then v_fin := v_fin + 1; else v_cont := v_cont + 1; end if;
    perform public._payout_report_event(p_report_id, v_item.id, v_r.clinic_id,
      case when v_item.contest_round >= 1 then 'contestado_de_novo' else 'contestado' end,
      v_kind || ': ' || v_text);
  end loop;

  -- O resto que estava pendente: APROVADO e liberado para pagar.
  update public.payout_report_items
     set review_state = 'aprovado', released = true, released_at = now()
   where report_id = p_report_id and status = 'incluido' and review_state = 'pendente';

  update public.payout_reports
     set dentist_responded_at = now(),
         missing_note = coalesce(v_missing, missing_note),
         missing_noted_at = case when v_missing is not null then now() else missing_noted_at end
   where id = p_report_id;

  perform public._payout_report_event(p_report_id, null, v_r.clinic_id, 'dentista_respondeu',
    case when v_cont + v_fin = 0 then 'Aprovou tudo'
         else (v_cont + v_fin) || ' procedimento(s) contestado(s)' end);
  if v_missing is not null then
    perform public._payout_report_event(p_report_id, null, v_r.clinic_id, 'faltando_procedimento', v_missing);
  end if;

  v_new := public._payout_report_sync(p_report_id);

  if v_cont > 0 or v_missing is not null then
    perform public._payout_report_notify(
      public._payout_report_reviewers(p_report_id), v_r.clinic_id,
      'Repasse com contestação — ' || v_r.code,
      'O dentista respondeu ao relatório e há ponto para você analisar.',
      '/repasses/' || p_report_id);
  end if;
  if v_fin > 0 then
    perform public._payout_report_notify(
      array(select public._payout_finance_users()), v_r.clinic_id,
      'Repasse para desempate — ' || v_r.code,
      'O dentista contestou de novo. A decisão final é do Financeiro da Franqueadora.',
      '/financeiro/repasses/relatorios/' || p_report_id);
  end if;
  if v_new = 'aprovado' then
    perform public._payout_report_notify(
      array[v_r.sent_by] || array(select public._payout_finance_users()), v_r.clinic_id,
      'Repasse aprovado — ' || v_r.code,
      'O dentista aprovou o relatório. Está liberado para pagamento.',
      '/financeiro/repasses/relatorios/' || p_report_id);
  end if;
  return v_new;
end;
$$;
revoke execute on function public.payout_report_dentist_respond(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.payout_report_dentist_respond(uuid, jsonb, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 7) O APROVADOR RESPONDE À CONTESTAÇÃO (uma linha por vez)
--    manter     → volta ao dentista com a resposta
--    excluir    → sai do relatório (adiar / nao_pagar), com motivo
--    financeiro → pede a decisão do Financeiro (correção de valor, por exemplo)
-- -----------------------------------------------------------------------------
create or replace function public.payout_report_manager_answer(
  p_item_id uuid, p_action text, p_text text, p_exclusion_kind text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_i public.payout_report_items%rowtype;
  v_r public.payout_reports%rowtype;
  v_user uuid := (select auth.uid());
  v_text text := nullif(btrim(coalesce(p_text, '')), '');
  v_old text;
  v_new text;
begin
  select * into v_i from public.payout_report_items where id = p_item_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  select * into v_r from public.payout_reports where id = v_i.report_id for update;
  if not public.can_approve_payout_report(v_i.report_id) then raise exception 'NOT_ALLOWED'; end if;
  if v_r.status <> 'em_contestacao' or v_i.status <> 'incluido' or v_i.review_state <> 'contestado' then
    raise exception 'WRONG_STAGE';
  end if;
  if p_action is null or p_action not in ('manter', 'excluir', 'financeiro') then raise exception 'INVALID_KIND'; end if;
  if v_text is null or length(v_text) < 5 then raise exception 'REASON_REQUIRED'; end if;
  v_old := v_r.status;

  if p_action = 'manter' then
    update public.payout_report_items
       set review_state = 'pendente', manager_response = v_text,
           manager_responded_by = v_user, manager_responded_at = now()
     where id = p_item_id;
    perform public._payout_report_event(v_i.report_id, p_item_id, v_i.clinic_id, 'resposta_mantem', v_text);

  elsif p_action = 'financeiro' then
    update public.payout_report_items
       set review_state = 'no_financeiro', manager_response = v_text,
           manager_responded_by = v_user, manager_responded_at = now()
     where id = p_item_id;
    perform public._payout_report_event(v_i.report_id, p_item_id, v_i.clinic_id, 'pedido_ao_financeiro', v_text);
    perform public._payout_report_notify(
      array(select public._payout_finance_users()), v_i.clinic_id,
      'Repasse: pedido de decisão — ' || v_r.code,
      'O aprovador pediu a decisão do Financeiro sobre um procedimento contestado.',
      '/financeiro/repasses/relatorios/' || v_i.report_id);

  else
    if p_exclusion_kind is null or p_exclusion_kind not in ('adiar', 'nao_pagar') then
      raise exception 'INVALID_KIND';
    end if;
    update public.payout_report_items
       set status = 'excluido', active = false, review_state = null,
           exclusion_kind = p_exclusion_kind, exclusion_reason = v_text,
           excluded_by = v_user, excluded_at = now(),
           manager_response = v_text, manager_responded_by = v_user, manager_responded_at = now()
     where id = p_item_id;
    if p_exclusion_kind = 'nao_pagar' then
      update public.provider_payouts
         set withheld = true, withheld_reason = v_text, withheld_by = v_user, withheld_at = now()
       where id = v_i.payout_id;
    end if;
    perform public._payout_report_event(v_i.report_id, p_item_id, v_i.clinic_id,
      case when p_exclusion_kind = 'adiar' then 'item_adiado' else 'item_nao_pagar' end, v_text);
    perform public._payout_report_refresh(v_i.report_id);
  end if;

  v_new := public._payout_report_sync(v_i.report_id);
  if v_new <> v_old and v_new = 'com_dentista' then
    perform public._payout_report_notify(
      array[v_r.provider_id], v_i.clinic_id,
      'Resposta sobre o seu repasse — ' || v_r.code,
      'O aprovador respondeu à sua contestação. Confira e responda.',
      '/repasses/' || v_i.report_id);
  elsif v_new <> v_old and v_new in ('aprovado', 'cancelado') then
    perform public._payout_report_notify(
      array[v_r.provider_id, v_r.sent_by], v_i.clinic_id,
      'Repasse concluído — ' || v_r.code,
      'A conferência do relatório terminou.',
      '/repasses/' || v_i.report_id);
  end if;
  return v_new;
end;
$$;
revoke execute on function public.payout_report_manager_answer(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.payout_report_manager_answer(uuid, text, text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 8) O FINANCEIRO DECIDE (decisão final, com motivo)
--    manter   → libera pelo valor que está
--    corrigir → muda o valor (o antigo fica guardado) e libera
--    excluir  → sai do relatório (adiar / nao_pagar)
-- -----------------------------------------------------------------------------
create or replace function public.payout_report_finance_decide(
  p_item_id uuid, p_action text, p_reason text,
  p_new_amount_cents bigint default null, p_exclusion_kind text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_i public.payout_report_items%rowtype;
  v_r public.payout_reports%rowtype;
  v_user uuid := (select auth.uid());
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_new text;
begin
  if not public.can_manage_payout_reports() then raise exception 'NOT_ALLOWED'; end if;
  select * into v_i from public.payout_report_items where id = p_item_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  select * into v_r from public.payout_reports where id = v_i.report_id for update;
  -- Quem recebe não decide o próprio repasse.
  if v_r.provider_id = v_user then raise exception 'NOT_ALLOWED'; end if;
  if v_i.status <> 'incluido' or v_i.review_state <> 'no_financeiro' then raise exception 'WRONG_STAGE'; end if;
  if p_action is null or p_action not in ('manter', 'corrigir', 'excluir') then raise exception 'INVALID_KIND'; end if;
  if v_reason is null or length(v_reason) < 5 then raise exception 'REASON_REQUIRED'; end if;

  if p_action = 'manter' then
    update public.payout_report_items
       set review_state = 'aprovado', released = true, released_at = now(),
           finance_action = 'manter', finance_reason = v_reason, finance_by = v_user, finance_at = now()
     where id = p_item_id;
    perform public._payout_report_event(v_i.report_id, p_item_id, v_i.clinic_id, 'financeiro_manteve', v_reason);

  elsif p_action = 'corrigir' then
    if p_new_amount_cents is null or p_new_amount_cents <= 0 or p_new_amount_cents = v_i.amount_cents then
      raise exception 'INVALID_AMOUNT';
    end if;
    update public.payout_report_items
       set original_amount_cents = coalesce(original_amount_cents, amount_cents),
           amount_cents = p_new_amount_cents,
           review_state = 'aprovado', released = true, released_at = now(),
           finance_action = 'corrigir', finance_reason = v_reason, finance_by = v_user, finance_at = now()
     where id = p_item_id;
    perform public._payout_report_event(v_i.report_id, p_item_id, v_i.clinic_id, 'financeiro_corrigiu',
      'De ' || public.brl(v_i.amount_cents) || ' para ' || public.brl(p_new_amount_cents) || ' — ' || v_reason);
    perform public._payout_report_refresh(v_i.report_id);

  else
    if p_exclusion_kind is null or p_exclusion_kind not in ('adiar', 'nao_pagar') then
      raise exception 'INVALID_KIND';
    end if;
    update public.payout_report_items
       set status = 'excluido', active = false, review_state = null,
           exclusion_kind = p_exclusion_kind, exclusion_reason = v_reason,
           excluded_by = v_user, excluded_at = now(),
           finance_action = 'excluir', finance_reason = v_reason, finance_by = v_user, finance_at = now()
     where id = p_item_id;
    if p_exclusion_kind = 'nao_pagar' then
      update public.provider_payouts
         set withheld = true, withheld_reason = v_reason, withheld_by = v_user, withheld_at = now()
       where id = v_i.payout_id;
    end if;
    perform public._payout_report_event(v_i.report_id, p_item_id, v_i.clinic_id,
      case when p_exclusion_kind = 'adiar' then 'item_adiado' else 'item_nao_pagar' end,
      'Decisão do Financeiro: ' || v_reason);
    perform public._payout_report_refresh(v_i.report_id);
  end if;

  v_new := public._payout_report_sync(v_i.report_id);
  perform public._payout_report_notify(
    array[v_r.provider_id] || public._payout_report_reviewers(v_i.report_id), v_i.clinic_id,
    'Repasse: decisão do Financeiro — ' || v_r.code,
    'O Financeiro da Franqueadora decidiu sobre um procedimento contestado.',
    '/repasses/' || v_i.report_id);
  return v_new;
end;
$$;
revoke execute on function public.payout_report_finance_decide(uuid, text, text, bigint, text) from public, anon, authenticated;
grant execute on function public.payout_report_finance_decide(uuid, text, text, bigint, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 9) O PRAZO DO DENTISTA — lembra e avisa; NUNCA aprova sozinho
-- -----------------------------------------------------------------------------
create or replace function public.payout_report_deadline_run()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_today date := public.today_br();
  v_n integer := 0;
begin
  for r in
    select pr.* from public.payout_reports pr
     where pr.status = 'com_dentista' and pr.dentist_due_on is not null
  loop
    if r.dentist_escalated_at is null and v_today > r.dentist_due_on then
      insert into public.notifications (user_id, clinic_id, title, body, link)
      select distinct x.uid, r.clinic_id,
             'Repasse sem resposta do dentista — ' || r.code,
             'O prazo de 5 dias úteis venceu em ' || to_char(r.dentist_due_on, 'DD/MM/YYYY')
               || ' e o dentista ainda não respondeu.',
             '/repasses/' || r.id
        from unnest(public._payout_report_reviewers(r.id)) as x(uid);
      insert into public.notifications (user_id, clinic_id, title, body, link)
      values (r.provider_id, r.clinic_id,
              'Seu repasse espera resposta — ' || r.code,
              'O prazo venceu em ' || to_char(r.dentist_due_on, 'DD/MM/YYYY')
                || '. O pagamento só é liberado depois da sua resposta.',
              '/repasses/' || r.id);
      update public.payout_reports set dentist_escalated_at = now() where id = r.id;
      insert into public.payout_report_events (report_id, clinic_id, action, note)
      values (r.id, r.clinic_id, 'prazo_vencido', 'Aprovador avisado.');
      v_n := v_n + 1;
    elsif r.dentist_reminded_at is null and r.dentist_since is not null
          and v_today >= public._payout_add_business_days(r.dentist_since, 3)
          and v_today <= r.dentist_due_on then
      insert into public.notifications (user_id, clinic_id, title, body, link)
      values (r.provider_id, r.clinic_id,
              'Lembrete: seu repasse espera resposta — ' || r.code,
              'Aprove ou conteste até ' || to_char(r.dentist_due_on, 'DD/MM/YYYY') || '.',
              '/repasses/' || r.id);
      update public.payout_reports set dentist_reminded_at = now() where id = r.id;
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end;
$$;
revoke execute on function public.payout_report_deadline_run() from public, anon, authenticated;

-- Todo dia às 08:20 UTC = 05:20 em Brasília.
do $$
begin
  perform cron.schedule(
    'risarte-payout-reports-daily', '20 8 * * *',
    'select public.payout_report_deadline_run()'
  );
exception when others then null;
end;
$$;

-- -----------------------------------------------------------------------------
-- 10) LEITURAS
-- -----------------------------------------------------------------------------
-- 10a) Lista (Financeiro e aprovador): agora com as etapas.
drop function if exists public.payout_report_list(uuid, uuid);
create function public.payout_report_list(p_clinic_id uuid, p_report_id uuid default null)
returns table (
  id uuid,
  code text,
  clinic_id uuid,
  clinic_name text,
  provider_id uuid,
  provider_name text,
  period_month date,
  level_name text,
  status text,
  total_cents bigint,
  item_count integer,
  excluded_count integer,
  created_at timestamptz,
  created_by_name text,
  cancelled_at timestamptz,
  cancelled_by_name text,
  cancel_reason text,
  approver_kind text,
  sent_at timestamptz,
  sent_by_name text,
  manager_at timestamptz,
  manager_by_name text,
  dentist_due_on date,
  dentist_responded_at timestamptz,
  approved_at timestamptz,
  released_cents bigint,
  contested_count integer,
  finance_count integer,
  missing_note text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  return query
  select r.id, r.code, r.clinic_id, c.name, r.provider_id, pr.full_name,
         r.period_month, r.level_name, r.status, r.total_cents, r.item_count,
         (select count(*) from public.payout_report_items i
           where i.report_id = r.id and i.status = 'excluido')::integer,
         r.created_at, cb.full_name, r.cancelled_at, xb.full_name, r.cancel_reason,
         case when r.status in ('rascunho', 'cancelado') then null
              else public._payout_report_approver_kind(r.id) end,
         r.sent_at, sb.full_name, r.manager_at, mb.full_name,
         r.dentist_due_on, r.dentist_responded_at, r.approved_at,
         coalesce((select sum(i.amount_cents) from public.payout_report_items i
                    where i.report_id = r.id and i.status = 'incluido' and i.released), 0)::bigint,
         (select count(*) from public.payout_report_items i
           where i.report_id = r.id and i.status = 'incluido' and i.review_state = 'contestado')::integer,
         (select count(*) from public.payout_report_items i
           where i.report_id = r.id and i.status = 'incluido' and i.review_state = 'no_financeiro')::integer,
         r.missing_note
    from public.payout_reports r
    join public.clinics c on c.id = r.clinic_id
    left join public.profiles pr on pr.id = r.provider_id
    left join public.profiles cb on cb.id = r.created_by
    left join public.profiles xb on xb.id = r.cancelled_by
    left join public.profiles sb on sb.id = r.sent_by
    left join public.profiles mb on mb.id = r.manager_by
   where (p_clinic_id is not null or p_report_id is not null)
     and (p_clinic_id is null or r.clinic_id = p_clinic_id)
     and (p_report_id is null or r.id = p_report_id)
     and public._payout_report_can_read(r.id)
   order by r.created_at desc;
end;
$$;
revoke execute on function public.payout_report_list(uuid, uuid) from public, anon, authenticated;
grant execute on function public.payout_report_list(uuid, uuid) to authenticated;

-- 10b) Os procedimentos, com a conversa de cada linha.
drop function if exists public.payout_report_items_detail(uuid);
create function public.payout_report_items_detail(p_report_id uuid)
returns table (
  item_id uuid,
  payout_id uuid,
  finished_on date,
  procedure_name text,
  client_id uuid,
  client_name text,
  session_id uuid,
  origin text,
  amount_cents bigint,
  status text,
  exclusion_kind text,
  exclusion_reason text,
  excluded_by_name text,
  excluded_at timestamptz,
  review_state text,
  released boolean,
  contest_kind text,
  contest_text text,
  contest_round integer,
  manager_response text,
  finance_action text,
  finance_reason text,
  original_amount_cents bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not public._payout_report_can_read(p_report_id) then
    raise exception 'NOT_ALLOWED';
  end if;

  return query
  select i.id, i.payout_id, i.finished_on, i.procedure_name,
         coalesce(s.client_id, m.client_id),
         cl.full_name,
         p.session_id,
         case when p.ortho_maintenance_id is not null then 'ortodontia' else 'sessao' end::text,
         i.amount_cents, i.status, i.exclusion_kind, i.exclusion_reason,
         eb.full_name, i.excluded_at,
         i.review_state, i.released, i.contest_kind, i.contest_text, i.contest_round,
         i.manager_response, i.finance_action, i.finance_reason, i.original_amount_cents
    from public.payout_report_items i
    join public.provider_payouts p on p.id = i.payout_id
    left join public.treatment_sessions s on s.id = p.session_id
    left join public.ortho_maintenances m on m.id = p.ortho_maintenance_id
    left join public.clients cl on cl.id = coalesce(s.client_id, m.client_id)
    left join public.profiles eb on eb.id = i.excluded_by
   where i.report_id = p_report_id
   order by i.finished_on, i.procedure_name, i.id;
end;
$$;
revoke execute on function public.payout_report_items_detail(uuid) from public, anon, authenticated;
grant execute on function public.payout_report_items_detail(uuid) to authenticated;

-- 10c) A linha do tempo (registro interno: Financeiro e aprovador).
drop function if exists public.payout_report_history(uuid);
create function public.payout_report_history(p_report_id uuid)
returns table (
  created_at timestamptz,
  action text,
  note text,
  actor_name text,
  procedure_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not public._payout_report_can_read(p_report_id) then
    raise exception 'NOT_ALLOWED';
  end if;

  return query
  select e.created_at, e.action, e.note, a.full_name, i.procedure_name
    from public.payout_report_events e
    left join public.profiles a on a.id = e.actor_id
    left join public.payout_report_items i on i.id = e.item_id
   where e.report_id = p_report_id
   order by e.created_at desc, e.id;
end;
$$;
revoke execute on function public.payout_report_history(uuid) from public, anon, authenticated;
grant execute on function public.payout_report_history(uuid) to authenticated;

-- 10d) O que espera a MINHA conferência (todas as unidades em que aprovo).
drop function if exists public.payout_reports_to_approve();
create function public.payout_reports_to_approve()
returns table (
  id uuid,
  code text,
  clinic_name text,
  provider_name text,
  period_month date,
  status text,
  total_cents bigint,
  item_count integer,
  contested_count integer,
  sent_at timestamptz,
  missing_note text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if (select auth.uid()) is null then return; end if;
  return query
  select r.id, r.code, c.name, pr.full_name, r.period_month, r.status,
         r.total_cents, r.item_count,
         (select count(*) from public.payout_report_items i
           where i.report_id = r.id and i.status = 'incluido' and i.review_state = 'contestado')::integer,
         r.sent_at, r.missing_note
    from public.payout_reports r
    join public.clinics c on c.id = r.clinic_id
    left join public.profiles pr on pr.id = r.provider_id
   where r.status in ('com_gerente', 'em_contestacao', 'com_dentista', 'em_desempate')
     and public.can_approve_payout_report(r.id)
   order by (r.status in ('com_gerente', 'em_contestacao')) desc, r.sent_at;
end;
$$;
revoke execute on function public.payout_reports_to_approve() from public, anon, authenticated;
grant execute on function public.payout_reports_to_approve() to authenticated;

-- 10e) MEUS REPASSES — o dentista, em todas as unidades em que atende.
drop function if exists public.my_payout_reports();
create function public.my_payout_reports()
returns table (
  id uuid,
  code text,
  clinic_name text,
  period_month date,
  level_name text,
  status text,
  total_cents bigint,
  item_count integer,
  released_cents bigint,
  pending_count integer,
  dentist_due_on date,
  manager_at timestamptz,
  approved_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if (select auth.uid()) is null then return; end if;
  return query
  select r.id, r.code, c.name, r.period_month, r.level_name, r.status,
         r.total_cents, r.item_count,
         coalesce((select sum(i.amount_cents) from public.payout_report_items i
                    where i.report_id = r.id and i.status = 'incluido' and i.released), 0)::bigint,
         (select count(*) from public.payout_report_items i
           where i.report_id = r.id and i.status = 'incluido' and i.review_state = 'pendente')::integer,
         r.dentist_due_on, r.manager_at, r.approved_at
    from public.payout_reports r
    join public.clinics c on c.id = r.clinic_id
   where r.provider_id = (select auth.uid())
     and r.status in ('com_dentista', 'em_contestacao', 'em_desempate', 'aprovado')
   order by (r.status = 'com_dentista') desc, r.manager_at desc nulls last;
end;
$$;
revoke execute on function public.my_payout_reports() from public, anon, authenticated;
grant execute on function public.my_payout_reports() to authenticated;

-- Só as linhas INCLUÍDAS e só o que diz respeito ao dentista: nada do registro
-- interno (o que foi excluído, por quem e por quê não aparece aqui).
drop function if exists public.my_payout_report_detail(uuid);
create function public.my_payout_report_detail(p_report_id uuid)
returns table (
  item_id uuid,
  finished_on date,
  procedure_name text,
  client_id uuid,
  client_name text,
  amount_cents bigint,
  review_state text,
  released boolean,
  contest_kind text,
  contest_text text,
  contest_round integer,
  manager_response text,
  finance_action text,
  finance_reason text,
  original_amount_cents bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not exists (
    select 1 from public.payout_reports r
     where r.id = p_report_id
       and r.provider_id = (select auth.uid())
       and r.status in ('com_dentista', 'em_contestacao', 'em_desempate', 'aprovado')
  ) then
    raise exception 'NOT_ALLOWED';
  end if;

  return query
  select i.id, i.finished_on, i.procedure_name,
         coalesce(s.client_id, m.client_id), cl.full_name,
         i.amount_cents, i.review_state, i.released,
         i.contest_kind, i.contest_text, i.contest_round, i.manager_response,
         i.finance_action, i.finance_reason, i.original_amount_cents
    from public.payout_report_items i
    join public.provider_payouts p on p.id = i.payout_id
    left join public.treatment_sessions s on s.id = p.session_id
    left join public.ortho_maintenances m on m.id = p.ortho_maintenance_id
    left join public.clients cl on cl.id = coalesce(s.client_id, m.client_id)
   where i.report_id = p_report_id and i.status = 'incluido'
   order by i.finished_on, i.procedure_name, i.id;
end;
$$;
revoke execute on function public.my_payout_report_detail(uuid) from public, anon, authenticated;
grant execute on function public.my_payout_report_detail(uuid) to authenticated;

-- 10f) O que EU sou neste relatório (a tela decide o que mostrar).
drop function if exists public.payout_report_viewer(uuid);
create function public.payout_report_viewer(p_report_id uuid)
returns table (
  is_provider boolean,
  can_approve boolean,
  can_manage boolean,
  can_read boolean,
  status text
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.provider_id = (select auth.uid())
           and r.status in ('com_dentista', 'em_contestacao', 'em_desempate', 'aprovado'),
         public.can_approve_payout_report(r.id),
         public.can_manage_payout_reports(),
         public._payout_report_can_read(r.id),
         r.status
    from public.payout_reports r
   where r.id = p_report_id
     and (r.provider_id = (select auth.uid())
          or public._payout_report_can_read(r.id)
          or public.can_approve_payout_report(r.id));
$$;
revoke execute on function public.payout_report_viewer(uuid) from public, anon, authenticated;
grant execute on function public.payout_report_viewer(uuid) to authenticated;

-- Conferência (só leitura) ------------------------------------------------------
-- Esperado: situacoes = 7 · colunas_do_item = 15 · funcoes = 12 ·
-- rotina_diaria = 1 · regras_de_escrita = 0 · regras_para_o_dentista = 0
select
  (select count(*) from regexp_matches(
     (select pg_get_constraintdef(c.oid) from pg_constraint c
       where c.conname = 'payout_reports_status_check'), '''[a-z_]+''', 'g')) as situacoes,
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'payout_report_items'
      and column_name in ('review_state', 'released', 'released_at', 'contest_kind',
        'contest_text', 'contest_round', 'contested_at', 'manager_response',
        'manager_responded_by', 'manager_responded_at', 'finance_action',
        'finance_reason', 'finance_by', 'finance_at', 'original_amount_cents')) as colunas_do_item,
  (select count(*) from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname in ('payout_report_send', 'payout_report_return',
        'payout_report_manager_approve', 'payout_report_dentist_respond',
        'payout_report_manager_answer', 'payout_report_finance_decide',
        'payout_report_deadline_run', 'payout_reports_to_approve',
        'my_payout_reports', 'my_payout_report_detail', 'payout_report_viewer',
        'can_approve_payout_report')) as funcoes,
  (select count(*) from cron.job where jobname = 'risarte-payout-reports-daily') as rotina_diaria,
  (select count(*) from pg_policies
    where schemaname = 'public'
      and tablename in ('payout_reports', 'payout_report_items', 'payout_report_events')
      and cmd <> 'SELECT') as regras_de_escrita,
  (select count(*) from pg_policies
    where schemaname = 'public'
      and tablename in ('payout_reports', 'payout_report_items', 'payout_report_events')
      and qual ilike '%provider_id%') as regras_para_o_dentista;

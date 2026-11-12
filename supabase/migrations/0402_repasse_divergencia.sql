-- =============================================================================
-- 0402 — REPASSE DOS DENTISTAS: A DIVERGÊNCIA QUE CHEGA AO FINANCEIRO
--
-- Pedido do dono (12/11/2026), depois do teste na Londrina (RP-000006): o
-- dentista contestou 2×, o procedimento foi ao Financeiro, e o Financeiro
-- quis "dar um realzinho a mais" — mas escolheu ADIAR. O valor não mudou, o
-- procedimento voltou no RP-000023 com o mesmo valor e ninguém viu a história.
-- E, mesmo que tivesse escolhido "corrigir", o valor novo era liberado direto,
-- sem a unidade nem o dentista verem.
--
-- O que muda (decisões do dono, as duas como recomendado):
--
--  1) O ROTEIRO DA DIVERGÊNCIA. Antes de decidir, o Financeiro registra a
--     conversa com a UNIDADE (quem aprova: Gerente, ou Coordenador quando não
--     há Gerente) e com o DENTISTA — ou "não consegui contato", com motivo
--     (`payout_mediation_contacts`, só cresce). Sem os dois registros, a
--     decisão é recusada (MEDIATION_REQUIRED). A decisão leva uma ORIENTAÇÃO
--     (obrigatória) que a unidade e o dentista leem.
--     Divergência parada 3 dias úteis no Financeiro: lembrete.
--
--  2) O VALOR CORRIGIDO VOLTA PARA APROVAÇÃO. "Corrigir" não libera mais: o
--     valor fica PROPOSTO (`proposed_amount_cents`); a unidade confirma que
--     está ciente (`correcao_unidade`), o dentista aceita
--     (`correcao_dentista`). Se o dentista não concordar, volta UMA última vez
--     ao Financeiro (`final_round`), e aí a decisão é final (libera direto).
--     Sem aprovador na unidade, vai direto ao dentista.
--     O valor aceito passa também para `provider_payouts` — antes ficava só
--     na linha do relatório, e o Histórico de repasse (0401) mostrava o antigo.
--
--  3) O ADIADO LEVA A HISTÓRIA: as leituras do relatório dizem de qual
--     relatório o procedimento veio e o motivo (`prev_*`).
--
-- Nada é apagado. Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Colunas da linha do relatório
-- -----------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in
    select c.conname from pg_constraint c
     where c.conrelid = 'public.payout_report_items'::regclass
       and c.contype = 'c'
       and pg_get_constraintdef(c.oid) like '%review_state%'
  loop
    execute format('alter table public.payout_report_items drop constraint %I', r.conname);
  end loop;
end;
$$;
alter table public.payout_report_items
  add constraint payout_report_items_review_state_check check (review_state in (
    'pendente', 'aprovado', 'contestado', 'no_financeiro',
    'correcao_unidade', 'correcao_dentista'));

alter table public.payout_report_items
  add column if not exists proposed_amount_cents bigint,
  add column if not exists proposed_at timestamptz,
  add column if not exists unit_ack_by uuid references public.profiles (id),
  add column if not exists unit_ack_at timestamptz,
  add column if not exists unit_ack_note text,
  add column if not exists dentist_value_reply text,
  add column if not exists dentist_value_at timestamptz,
  add column if not exists final_round boolean not null default false,
  add column if not exists finance_since timestamptz,
  add column if not exists finance_reminded_at timestamptz,
  add column if not exists finance_guidance text;

comment on column public.payout_report_items.proposed_amount_cents is
  'Valor proposto pelo Financeiro (0402): só vale depois que o dentista aceita (a unidade confirma antes).';
comment on column public.payout_report_items.final_round is
  'O dentista não aceitou o valor proposto (0402): a próxima decisão do Financeiro é final.';

-- Quando a linha chega ao Financeiro, começa a contar (roteiro e lembrete).
create or replace function public.payout_report_items_finance_since()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.review_state = 'no_financeiro'
     and (TG_OP = 'INSERT' or old.review_state is distinct from 'no_financeiro') then
    new.finance_since := clock_timestamp();
    new.finance_reminded_at := null;
  end if;
  return new;
end;
$$;
revoke execute on function public.payout_report_items_finance_since() from public, anon, authenticated;

drop trigger if exists payout_report_items_finance_since on public.payout_report_items;
create trigger payout_report_items_finance_since
  before insert or update of review_state on public.payout_report_items
  for each row execute function public.payout_report_items_finance_since();

-- As que já estão no Financeiro: desde a última contestação/resposta.
update public.payout_report_items
   set finance_since = coalesce(greatest(contested_at, manager_responded_at), now())
 where review_state = 'no_financeiro' and finance_since is null;

-- O valor corrigido antes desta migração ficou só na linha: leva ao repasse.
update public.provider_payouts p
   set amount_cents = i.amount_cents
  from public.payout_report_items i
 where i.payout_id = p.id
   and i.finance_action = 'corrigir'
   and i.status = 'incluido'
   and i.amount_cents > 0
   and p.amount_cents <> i.amount_cents
   and p.closing_id is null
   and p.failure_id is null;

-- -----------------------------------------------------------------------------
-- 2) A conversa do Financeiro com a unidade e com o dentista
-- -----------------------------------------------------------------------------
create table if not exists public.payout_mediation_contacts (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.payout_report_items (id) on delete restrict,
  report_id uuid not null references public.payout_reports (id) on delete restrict,
  clinic_id uuid not null references public.clinics (id),
  party text not null check (party in ('unidade', 'dentista')),
  outcome text not null check (outcome in ('conversou', 'sem_contato')),
  channel text check (channel in ('whatsapp', 'ligacao', 'chat', 'presencial', 'outro')),
  contact_user_id uuid references public.profiles (id),
  summary text not null check (length(btrim(summary)) >= 5),
  created_by uuid not null references public.profiles (id),
  -- relógio real: duas conversas na mesma transação não ficam com a mesma hora
  created_at timestamptz not null default clock_timestamp(),
  constraint payout_mediation_channel_chk
    check ((outcome = 'conversou') = (channel is not null))
);
alter table public.payout_mediation_contacts alter column created_at set default clock_timestamp();
create index if not exists payout_mediation_contacts_item_idx
  on public.payout_mediation_contacts (item_id, created_at);

comment on table public.payout_mediation_contacts is
  'Roteiro da divergência do repasse (0402): a conversa do Financeiro com a unidade e com o dentista antes de decidir. Só cresce; lê-se pela função.';

alter table public.payout_mediation_contacts enable row level security;
-- Sem regra de leitura nem de escrita: só as funções abaixo.

create or replace function public.payout_mediation_contacts_lock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'MEDIATION_LOCKED'
    using hint = 'O registro da conversa não se altera nem se apaga.';
end;
$$;
revoke execute on function public.payout_mediation_contacts_lock() from public, anon, authenticated;

drop trigger if exists payout_mediation_contacts_lock on public.payout_mediation_contacts;
create trigger payout_mediation_contacts_lock
  before update or delete on public.payout_mediation_contacts
  for each row execute function public.payout_mediation_contacts_lock();

select public.audit_attach_all();

-- A conversa conta só se foi registrada DEPOIS que a linha chegou ao Financeiro.
create or replace function public._payout_mediation_done(p_item_id uuid, p_party text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.payout_mediation_contacts m
      join public.payout_report_items i on i.id = m.item_id
     where m.item_id = p_item_id
       and m.party = p_party
       and m.created_at >= coalesce(i.finance_since, '-infinity'::timestamptz)
  );
$$;
revoke execute on function public._payout_mediation_done(uuid, text) from public, anon, authenticated;

create or replace function public.payout_mediation_record(
  p_item_id uuid,
  p_party text,
  p_outcome text,
  p_channel text,
  p_contact_user_id uuid,
  p_summary text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_i public.payout_report_items%rowtype;
  v_r public.payout_reports%rowtype;
  v_user uuid := (select auth.uid());
  v_summary text := nullif(btrim(coalesce(p_summary, '')), '');
  v_channel text := case when p_outcome = 'conversou' then p_channel else null end;
begin
  if v_user is null or not public.can_manage_payout_reports() then raise exception 'NOT_ALLOWED'; end if;
  select * into v_i from public.payout_report_items where id = p_item_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  select * into v_r from public.payout_reports where id = v_i.report_id;
  -- Quem recebe não conduz a divergência do próprio repasse.
  if v_r.provider_id = v_user then raise exception 'NOT_ALLOWED'; end if;
  if v_i.status <> 'incluido' or v_i.review_state <> 'no_financeiro' then raise exception 'WRONG_STAGE'; end if;
  if p_party is null or p_party not in ('unidade', 'dentista') then raise exception 'INVALID_KIND'; end if;
  if p_outcome is null or p_outcome not in ('conversou', 'sem_contato') then raise exception 'INVALID_KIND'; end if;
  if p_outcome = 'conversou'
     and (v_channel is null or v_channel not in ('whatsapp', 'ligacao', 'chat', 'presencial', 'outro')) then
    raise exception 'INVALID_KIND';
  end if;
  if v_summary is null or length(v_summary) < 5 then raise exception 'REASON_REQUIRED'; end if;
  -- Com quem: o dentista do relatório, ou quem aprova a unidade.
  if p_contact_user_id is not null and not (
       (p_party = 'dentista' and p_contact_user_id = v_r.provider_id)
    or (p_party = 'unidade' and p_contact_user_id in (select public._payout_report_approvers(v_r.id)))
  ) then
    raise exception 'INVALID_CONTACT';
  end if;

  insert into public.payout_mediation_contacts
    (item_id, report_id, clinic_id, party, outcome, channel, contact_user_id, summary, created_by)
  values
    (p_item_id, v_r.id, v_r.clinic_id, p_party, p_outcome, v_channel, p_contact_user_id, v_summary, v_user);

  perform public._payout_report_event(v_r.id, p_item_id, v_r.clinic_id,
    case when p_party = 'unidade' then 'conversa_unidade' else 'conversa_dentista' end,
    case when p_outcome = 'sem_contato' then 'Sem contato: ' else '' end || v_summary);
end;
$$;
revoke execute on function public.payout_mediation_record(uuid, text, text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.payout_mediation_record(uuid, text, text, text, uuid, text) to authenticated;

-- As conversas registradas sobre as linhas de um relatório (o Financeiro).
create or replace function public.payout_mediation_list(p_report_id uuid)
returns table (
  item_id uuid,
  party text,
  outcome text,
  channel text,
  contact_name text,
  summary text,
  created_by_name text,
  created_at timestamptz,
  counts boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not public.can_manage_payout_reports() then raise exception 'NOT_ALLOWED'; end if;
  return query
  select m.item_id, m.party, m.outcome, m.channel, cp.full_name, m.summary,
         cb.full_name, m.created_at,
         m.created_at >= coalesce(i.finance_since, '-infinity'::timestamptz)
    from public.payout_mediation_contacts m
    join public.payout_report_items i on i.id = m.item_id
    left join public.profiles cp on cp.id = m.contact_user_id
    left join public.profiles cb on cb.id = m.created_by
   where m.report_id = p_report_id
   order by m.created_at;
end;
$$;
revoke execute on function public.payout_mediation_list(uuid) from public, anon, authenticated;
grant execute on function public.payout_mediation_list(uuid) to authenticated;

-- Com quem falar: quem aprova a unidade e o dentista, com o WhatsApp da ficha
-- do Risartano (da unidade do relatório primeiro) ou o telefone do cadastro.
create or replace function public.payout_mediation_people(p_report_id uuid)
returns table (
  user_id uuid,
  party text,
  role_label text,
  full_name text,
  phone text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_r public.payout_reports%rowtype;
  v_kind text;
begin
  if not public.can_manage_payout_reports() then raise exception 'NOT_ALLOWED'; end if;
  select * into v_r from public.payout_reports where id = p_report_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_r.provider_id = (select auth.uid()) then raise exception 'NOT_ALLOWED'; end if;
  v_kind := public._payout_report_approver_kind(p_report_id);

  return query
  with gente as (
    select a.uid, 'unidade'::text as party,
           case when v_kind = 'gerente' then 'Gerente da unidade'
                else 'Coordenador clínico' end as role_label
      from public._payout_report_approvers(p_report_id) as a(uid)
    union all
    select v_r.provider_id, 'dentista', 'Dentista do relatório'
  )
  select g.uid, g.party, g.role_label, p.full_name,
         coalesce(
           (select nullif(btrim(s.whatsapp), '') from public.staff_members s
             where s.user_id = g.uid and s.is_active and nullif(btrim(s.whatsapp), '') is not null
             order by (s.clinic_id = v_r.clinic_id) desc, s.created_at desc limit 1),
           nullif(btrim(p.phone), ''))
    from gente g
    join public.profiles p on p.id = g.uid
   order by (g.party = 'dentista'), p.full_name;
end;
$$;
revoke execute on function public.payout_mediation_people(uuid) from public, anon, authenticated;
grant execute on function public.payout_mediation_people(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 3) A situação do relatório segue as linhas — agora com o valor proposto
--    (corpo da 0391 + correcao_unidade / correcao_dentista)
-- -----------------------------------------------------------------------------
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
         -- na vez da UNIDADE: contestação a responder ou valor novo a confirmar
         count(*) filter (where i.review_state in ('contestado', 'correcao_unidade')),
         -- na vez do DENTISTA: conferir ou aceitar o valor novo
         count(*) filter (where i.review_state in ('pendente', 'correcao_dentista')),
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
-- 4) O FINANCEIRO DECIDE — depois das duas conversas, com orientação
--    manter   → libera pelo valor que está
--    corrigir → PROPÕE o valor novo (unidade confirma, dentista aceita);
--               na rodada final, corrige e libera
--    excluir  → sai do relatório (adiar = volta no próximo COM O MESMO VALOR)
-- -----------------------------------------------------------------------------
drop function if exists public.payout_report_finance_decide(uuid, text, text, bigint, text);
drop function if exists public.payout_report_finance_decide(uuid, text, text, bigint, text, text);
create function public.payout_report_finance_decide(
  p_item_id uuid, p_action text, p_reason text,
  p_new_amount_cents bigint default null, p_exclusion_kind text default null,
  p_guidance text default null
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
  v_guidance text := nullif(btrim(coalesce(p_guidance, '')), '');
  v_has_unit boolean;
  v_new text;
begin
  if not public.can_manage_payout_reports() then raise exception 'NOT_ALLOWED'; end if;
  select * into v_i from public.payout_report_items where id = p_item_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  select * into v_r from public.payout_reports where id = v_i.report_id for update;
  if v_r.provider_id = v_user then raise exception 'NOT_ALLOWED'; end if;
  if v_i.status <> 'incluido' or v_i.review_state <> 'no_financeiro' then raise exception 'WRONG_STAGE'; end if;
  if p_action is null or p_action not in ('manter', 'corrigir', 'excluir') then raise exception 'INVALID_KIND'; end if;
  if v_reason is null or length(v_reason) < 5 then raise exception 'REASON_REQUIRED'; end if;
  if v_guidance is null or length(v_guidance) < 5 then raise exception 'GUIDANCE_REQUIRED'; end if;
  -- O roteiro: falou (ou tentou falar) com a unidade e com o dentista.
  if not public._payout_mediation_done(p_item_id, 'unidade')
     or not public._payout_mediation_done(p_item_id, 'dentista') then
    raise exception 'MEDIATION_REQUIRED';
  end if;

  if p_action = 'manter' then
    update public.payout_report_items
       set review_state = 'aprovado', released = true, released_at = now(),
           finance_action = 'manter', finance_reason = v_reason, finance_guidance = v_guidance,
           finance_by = v_user, finance_at = now()
     where id = p_item_id;
    perform public._payout_report_event(v_i.report_id, p_item_id, v_i.clinic_id, 'financeiro_manteve', v_reason);

  elsif p_action = 'corrigir' then
    if p_new_amount_cents is null or p_new_amount_cents = v_i.amount_cents
       or (v_i.amount_cents > 0 and p_new_amount_cents <= 0)
       or (v_i.amount_cents < 0 and (p_new_amount_cents >= 0 or p_new_amount_cents < v_i.amount_cents)) then
      raise exception 'INVALID_AMOUNT';
    end if;

    if v_i.final_round then
      -- A rodada final: o dentista já viu e não concordou. Decide e libera.
      update public.payout_report_items
         set original_amount_cents = coalesce(original_amount_cents, amount_cents),
             amount_cents = p_new_amount_cents,
             proposed_amount_cents = null,
             review_state = 'aprovado', released = true, released_at = now(),
             finance_action = 'corrigir', finance_reason = v_reason, finance_guidance = v_guidance,
             finance_by = v_user, finance_at = now()
       where id = p_item_id;
      update public.provider_payouts set amount_cents = p_new_amount_cents
       where id = v_i.payout_id and closing_id is null;
      perform public._payout_report_event(v_i.report_id, p_item_id, v_i.clinic_id, 'financeiro_corrigiu',
        'Decisão final. De ' || public.brl(v_i.amount_cents) || ' para ' || public.brl(p_new_amount_cents) || ' — ' || v_reason);
      perform public._payout_report_refresh(v_i.report_id);
    else
      -- Propõe: a unidade confirma que está ciente e o dentista aceita.
      v_has_unit := exists (select 1 from public._payout_report_approvers(v_i.report_id));
      update public.payout_report_items
         set proposed_amount_cents = p_new_amount_cents, proposed_at = now(),
             unit_ack_by = null, unit_ack_at = null, unit_ack_note = null,
             dentist_value_reply = null, dentist_value_at = null,
             review_state = case when v_has_unit then 'correcao_unidade' else 'correcao_dentista' end,
             released = false, released_at = null,
             finance_action = 'corrigir', finance_reason = v_reason, finance_guidance = v_guidance,
             finance_by = v_user, finance_at = now()
       where id = p_item_id;
      perform public._payout_report_event(v_i.report_id, p_item_id, v_i.clinic_id, 'financeiro_propos_valor',
        'De ' || public.brl(v_i.amount_cents) || ' para ' || public.brl(p_new_amount_cents) || ' — ' || v_reason);
    end if;

  else
    if p_exclusion_kind is null or p_exclusion_kind not in ('adiar', 'nao_pagar') then
      raise exception 'INVALID_KIND';
    end if;
    update public.payout_report_items
       set status = 'excluido', active = false, review_state = null,
           exclusion_kind = p_exclusion_kind, exclusion_reason = v_reason,
           excluded_by = v_user, excluded_at = now(),
           finance_action = 'excluir', finance_reason = v_reason, finance_guidance = v_guidance,
           finance_by = v_user, finance_at = now()
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

  perform public._payout_report_event(v_i.report_id, p_item_id, v_i.clinic_id, 'orientacao_do_financeiro', v_guidance);
  v_new := public._payout_report_sync(v_i.report_id);

  if p_action = 'corrigir' and not v_i.final_round and v_has_unit then
    perform public._payout_report_notify(
      public._payout_report_reviewers(v_i.report_id), v_i.clinic_id,
      'Repasse: valor novo para confirmar — ' || v_r.code,
      'O Financeiro propôs um valor novo para um procedimento contestado. Confirme que está ciente; depois o dentista aceita.',
      '/repasses/' || v_i.report_id);
  elsif p_action = 'corrigir' and not v_i.final_round then
    perform public._payout_report_notify(
      array[v_r.provider_id], v_i.clinic_id,
      'Repasse: valor novo para você aceitar — ' || v_r.code,
      'O Financeiro propôs um valor novo para o procedimento que você contestou. Confira a orientação e responda.',
      '/repasses/' || v_i.report_id);
  else
    perform public._payout_report_notify(
      array[v_r.provider_id] || public._payout_report_reviewers(v_i.report_id), v_i.clinic_id,
      'Repasse: decisão do Financeiro — ' || v_r.code,
      'O Financeiro da Franqueadora decidiu sobre um procedimento contestado. Veja a orientação no relatório.',
      '/repasses/' || v_i.report_id);
  end if;
  return v_new;
end;
$$;
revoke execute on function public.payout_report_finance_decide(uuid, text, text, bigint, text, text) from public, anon, authenticated;
grant execute on function public.payout_report_finance_decide(uuid, text, text, bigint, text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 5) A UNIDADE confirma que está ciente do valor novo (uma linha por vez)
-- -----------------------------------------------------------------------------
create or replace function public.payout_report_value_ack(p_item_id uuid, p_note text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_i public.payout_report_items%rowtype;
  v_r public.payout_reports%rowtype;
  v_user uuid := (select auth.uid());
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_new text;
begin
  select * into v_i from public.payout_report_items where id = p_item_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  select * into v_r from public.payout_reports where id = v_i.report_id for update;
  if not public.can_approve_payout_report(v_i.report_id) then raise exception 'NOT_ALLOWED'; end if;
  if v_i.status <> 'incluido' or v_i.review_state <> 'correcao_unidade' then raise exception 'WRONG_STAGE'; end if;

  update public.payout_report_items
     set review_state = 'correcao_dentista',
         unit_ack_by = v_user, unit_ack_at = now(), unit_ack_note = v_note
   where id = p_item_id;
  perform public._payout_report_event(v_i.report_id, p_item_id, v_i.clinic_id, 'unidade_ciente_valor',
    'Valor proposto: ' || public.brl(v_i.proposed_amount_cents) || coalesce(' — ' || v_note, ''));

  v_new := public._payout_report_sync(v_i.report_id);
  perform public._payout_report_notify(
    array[v_r.provider_id], v_i.clinic_id,
    'Repasse: valor novo para você aceitar — ' || v_r.code,
    'O Financeiro propôs um valor novo para o procedimento que você contestou. Confira a orientação e responda.',
    '/repasses/' || v_i.report_id);
  return v_new;
end;
$$;
revoke execute on function public.payout_report_value_ack(uuid, text) from public, anon, authenticated;
grant execute on function public.payout_report_value_ack(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 6) O DENTISTA aceita o valor novo — ou não concorda (volta UMA vez ao
--    Financeiro, que então decide de vez)
-- -----------------------------------------------------------------------------
create or replace function public.payout_report_value_respond(
  p_item_id uuid, p_accept boolean, p_text text default null
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
  v_new text;
begin
  select * into v_i from public.payout_report_items where id = p_item_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  select * into v_r from public.payout_reports where id = v_i.report_id for update;
  if v_user is null or v_r.provider_id <> v_user then raise exception 'NOT_ALLOWED'; end if;
  if v_r.status <> 'com_dentista' then raise exception 'WRONG_STAGE'; end if;
  if v_i.status <> 'incluido' or v_i.review_state <> 'correcao_dentista'
     or v_i.proposed_amount_cents is null then
    raise exception 'WRONG_STAGE';
  end if;
  if p_accept is null then raise exception 'INVALID_KIND'; end if;

  if p_accept then
    update public.payout_report_items
       set original_amount_cents = coalesce(original_amount_cents, amount_cents),
           amount_cents = proposed_amount_cents,
           review_state = 'aprovado', released = true, released_at = now(),
           dentist_value_reply = v_text, dentist_value_at = now()
     where id = p_item_id;
    update public.provider_payouts set amount_cents = v_i.proposed_amount_cents
     where id = v_i.payout_id and closing_id is null;
    perform public._payout_report_event(v_i.report_id, p_item_id, v_i.clinic_id, 'dentista_aceitou_valor',
      'De ' || public.brl(v_i.amount_cents) || ' para ' || public.brl(v_i.proposed_amount_cents)
      || coalesce(' — ' || v_text, ''));
    perform public._payout_report_refresh(v_i.report_id);
  else
    if v_text is null or length(v_text) < 5 then raise exception 'REASON_REQUIRED'; end if;
    update public.payout_report_items
       set review_state = 'no_financeiro', final_round = true,
           dentist_value_reply = v_text, dentist_value_at = now()
     where id = p_item_id;
    perform public._payout_report_event(v_i.report_id, p_item_id, v_i.clinic_id, 'dentista_recusou_valor', v_text);
  end if;

  v_new := public._payout_report_sync(v_i.report_id);

  if not p_accept then
    perform public._payout_report_notify(
      array(select public._payout_finance_users()), v_i.clinic_id,
      'Repasse: o dentista não aceitou o valor — ' || v_r.code,
      'O dentista não concordou com o valor proposto. A próxima decisão do Financeiro é final.',
      '/financeiro/repasses/relatorios/' || v_i.report_id);
  end if;
  if v_new = 'aprovado' then
    perform public._payout_report_notify(
      array[v_r.sent_by] || array(select public._payout_finance_users()), v_i.clinic_id,
      'Repasse aprovado — ' || v_r.code,
      'O dentista aceitou o valor. Está liberado para pagamento.',
      '/financeiro/repasses/relatorios/' || v_i.report_id);
  end if;
  return v_new;
end;
$$;
revoke execute on function public.payout_report_value_respond(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.payout_report_value_respond(uuid, boolean, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 7) O PRAZO — o do dentista (corpo da 0391) e o lembrete da divergência
--    parada 3 dias úteis no Financeiro
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

  -- 0402: a divergência parada no Financeiro há 3 dias úteis.
  for r in
    select i.id as item_id, i.report_id, i.clinic_id, pr.code
      from public.payout_report_items i
      join public.payout_reports pr on pr.id = i.report_id
     where i.status = 'incluido' and i.review_state = 'no_financeiro'
       and i.finance_reminded_at is null and i.finance_since is not null
       and v_today >= public._payout_add_business_days((i.finance_since at time zone 'America/Sao_Paulo')::date, 3)
  loop
    insert into public.notifications (user_id, clinic_id, title, body, link)
    select distinct x.uid, r.clinic_id,
           'Divergência de repasse parada — ' || r.code,
           'Um procedimento contestado espera a decisão do Financeiro há 3 dias úteis. Siga o roteiro: unidade, dentista, decisão.',
           '/financeiro/repasses/relatorios/' || r.report_id
      from public._payout_finance_users() as x(uid);
    update public.payout_report_items set finance_reminded_at = now() where id = r.item_id;
    insert into public.payout_report_events (report_id, item_id, clinic_id, action, note)
    values (r.report_id, r.item_id, r.clinic_id, 'divergencia_parada', 'Financeiro lembrado (3 dias úteis).');
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke execute on function public.payout_report_deadline_run() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 8) LEITURAS — com o valor proposto, a orientação e de onde o adiado veio
-- -----------------------------------------------------------------------------
-- De onde veio: a última vez que este repasse foi ADIADO em outro relatório.
create or replace function public._payout_item_origin(p_item_id uuid)
returns table (prev_report_code text, prev_reason text, prev_by_finance boolean, prev_guidance text)
language sql
stable
security definer
set search_path = ''
as $$
  select r2.code, i2.exclusion_reason, i2.finance_action = 'excluir', i2.finance_guidance
    from public.payout_report_items i
    join public.payout_report_items i2
      on i2.payout_id = i.payout_id and i2.id <> i.id
     and i2.status = 'excluido' and i2.exclusion_kind = 'adiar'
    join public.payout_reports r2 on r2.id = i2.report_id
   where i.id = p_item_id
   order by i2.excluded_at desc nulls last
   limit 1;
$$;
revoke execute on function public._payout_item_origin(uuid) from public, anon, authenticated;

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
  original_amount_cents bigint,
  failure_reason text,
  has_failure boolean,
  proposed_amount_cents bigint,
  unit_ack_name text,
  unit_ack_at timestamptz,
  unit_ack_note text,
  dentist_value_reply text,
  final_round boolean,
  finance_guidance text,
  finance_since timestamptz,
  prev_report_code text,
  prev_reason text,
  prev_guidance text
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
         coalesce(s.client_id, m.client_id, os.client_id),
         cl.full_name,
         coalesce(p.session_id, op.session_id),
         case when p.failure_id is not null then 'desconto'
              when p.ortho_maintenance_id is not null then 'ortodontia'
              else 'sessao' end::text,
         i.amount_cents, i.status, i.exclusion_kind, i.exclusion_reason,
         eb.full_name, i.excluded_at,
         i.review_state, i.released, i.contest_kind, i.contest_text, i.contest_round,
         i.manager_response, i.finance_action, i.finance_reason, i.original_amount_cents,
         f.decision_reason,
         exists (select 1 from public.payout_failures x
                  where x.payout_id = p.id and x.status in ('aberta', 'falha')),
         i.proposed_amount_cents, ab.full_name, i.unit_ack_at, i.unit_ack_note,
         i.dentist_value_reply, i.final_round, i.finance_guidance, i.finance_since,
         o.prev_report_code, o.prev_reason, o.prev_guidance
    from public.payout_report_items i
    join public.provider_payouts p on p.id = i.payout_id
    left join public.payout_failures f on f.id = p.failure_id
    left join public.provider_payouts op on op.id = f.payout_id
    left join public.treatment_sessions os on os.id = op.session_id
    left join public.treatment_sessions s on s.id = p.session_id
    left join public.ortho_maintenances m on m.id = p.ortho_maintenance_id
    left join public.clients cl on cl.id = coalesce(s.client_id, m.client_id, os.client_id)
    left join public.profiles eb on eb.id = i.excluded_by
    left join public.profiles ab on ab.id = i.unit_ack_by
    left join lateral public._payout_item_origin(i.id) o on true
   where i.report_id = p_report_id
   order by i.finished_on, i.procedure_name, i.id;
end;
$$;
revoke execute on function public.payout_report_items_detail(uuid) from public, anon, authenticated;
grant execute on function public.payout_report_items_detail(uuid) to authenticated;

-- O dentista: o valor proposto, a orientação e, do adiado, só o que o
-- Financeiro decidiu com ele (o registro interno da unidade continua fora).
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
  original_amount_cents bigint,
  failure_reason text,
  proposed_amount_cents bigint,
  final_round boolean,
  finance_guidance text,
  dentist_value_reply text,
  prev_report_code text,
  prev_reason text,
  prev_guidance text
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
         coalesce(s.client_id, m.client_id, os.client_id), cl.full_name,
         i.amount_cents, i.review_state, i.released,
         i.contest_kind, i.contest_text, i.contest_round, i.manager_response,
         i.finance_action, i.finance_reason, i.original_amount_cents,
         f.decision_reason,
         -- o valor proposto só aparece depois que a unidade confirmou
         case when i.review_state = 'correcao_unidade' then null else i.proposed_amount_cents end,
         i.final_round,
         case when i.review_state = 'correcao_unidade' then null else i.finance_guidance end,
         i.dentist_value_reply,
         o.prev_report_code,
         case when o.prev_by_finance then o.prev_reason end,
         case when o.prev_by_finance then o.prev_guidance end
    from public.payout_report_items i
    join public.provider_payouts p on p.id = i.payout_id
    left join public.payout_failures f on f.id = p.failure_id
    left join public.provider_payouts op on op.id = f.payout_id
    left join public.treatment_sessions os on os.id = op.session_id
    left join public.treatment_sessions s on s.id = p.session_id
    left join public.ortho_maintenances m on m.id = p.ortho_maintenance_id
    left join public.clients cl on cl.id = coalesce(s.client_id, m.client_id, os.client_id)
    left join lateral public._payout_item_origin(i.id) o on true
   where i.report_id = p_report_id and i.status = 'incluido'
   order by i.finished_on, i.procedure_name, i.id;
end;
$$;
revoke execute on function public.my_payout_report_detail(uuid) from public, anon, authenticated;
grant execute on function public.my_payout_report_detail(uuid) to authenticated;

-- As listas contam o que está na vez de cada um (corpos da 0391).
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
           where i.report_id = r.id and i.status = 'incluido'
             and i.review_state in ('contestado', 'correcao_unidade'))::integer,
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
           where i.report_id = r.id and i.status = 'incluido'
             and i.review_state in ('pendente', 'correcao_dentista'))::integer,
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

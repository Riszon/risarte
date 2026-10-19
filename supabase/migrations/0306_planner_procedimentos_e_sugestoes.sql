-- =============================================================================
-- 0306 — O PLANNER CONSULTA O CATÁLOGO, EDITA SESSÕES E SUGERE PROCEDIMENTO
--        (relatos OC-00067 e OC-00068)
--
-- Os dois relatos eram REGRA combinada, que o dono decidiu mudar:
--   - OC-00068: desde a 0039 (F3.1) o Dentista Planner gerenciava o catálogo
--     inteiro — criar procedimento, preços, comissões, reajuste — para a rede
--     toda. Já o protocolo de SESSÕES ele só podia PROPOR (0086).
--   - OC-00067: o orçamento do plano aceitava "item personalizado" (a linha
--     livre da 0036), com qualquer nome e valor; e o preço de qualquer item
--     podia ser mudado à mão, sem faixa.
--
-- O QUE MUDA (decisões do dono, 19/10/2026):
--   1. Catálogo (procedimentos e preço por unidade): SÓ o Admin Master grava.
--      O Planner consulta.
--   2. Sessões do procedimento: o Planner EDITA DIRETO o protocolo da rede
--      (`set_network_procedure_sessions`) — a única coisa que ele grava no
--      catálogo.
--   3. Orçamento: item SÓ do catálogo, para todo mundo; o preço vem do
--      catálogo da unidade e não muda à mão (gatilho; as funções do banco que
--      copiam/ajustam itens continuam livres).
--   4. Sugestão de procedimento (`procedure_suggestions`): o Planner sugere
--      (nome, especialidade, pilar, sessões, tempo, justificativa); o Admin
--      pede mais informações, recusa ou APROVA — aprovar cria o procedimento
--      (pela tela) e a sugestão vira o protocolo de sessões dele.
--
-- Os itens personalizados que JÁ existem ficam como estão. Nada apaga dado.
-- Idempotente.
-- =============================================================================

-- 1) Catálogo: só o Admin Master grava ------------------------------------------
drop policy if exists "procedures_write" on public.procedures;
create policy "procedures_write" on public.procedures
  for all to authenticated
  using (public.is_admin_master())
  with check (public.is_admin_master());

drop policy if exists "clinic_procedure_prices_write" on public.clinic_procedure_prices;
create policy "clinic_procedure_prices_write" on public.clinic_procedure_prices
  for all to authenticated
  using (public.is_admin_master())
  with check (public.is_admin_master());

-- 2) Sessões: o Planner edita direto o protocolo da rede ------------------------
create or replace function public.set_network_procedure_sessions(
  p_procedure_id uuid,
  p_sessions jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_qtd integer;
  v_total integer;
begin
  if v_user is null then raise exception 'NOT_ALLOWED'; end if;
  if not (public.is_admin_master() or public.is_planner()) then
    raise exception 'NOT_ALLOWED';
  end if;
  if not exists (select 1 from public.procedures p where p.id = p_procedure_id) then
    raise exception 'PROCEDURE_NOT_FOUND';
  end if;
  if p_sessions is null or jsonb_typeof(p_sessions) <> 'array' then
    raise exception 'INVALID_SESSIONS';
  end if;
  v_qtd := jsonb_array_length(p_sessions);
  if v_qtd < 1 or v_qtd > 50 then raise exception 'INVALID_SESSIONS'; end if;

  delete from public.procedure_sessions
   where procedure_id = p_procedure_id and clinic_id is null;

  insert into public.procedure_sessions
    (procedure_id, clinic_id, session_index, name, estimated_minutes, min_interval_days, created_by)
  select p_procedure_id,
         null,
         s.ord::int,
         nullif(btrim(coalesce(s.v->>'name', '')), ''),
         greatest(0, coalesce((s.v->>'minutes')::int, 0)),
         -- A 1ª sessão não tem intervalo (não há sessão anterior).
         case when s.ord = 1 then null
              else nullif(greatest(0, coalesce((s.v->>'intervalDays')::int, 0)), 0) end,
         v_user
    from jsonb_array_elements(p_sessions) with ordinality as s(v, ord);

  select coalesce(sum(ps.estimated_minutes), 0)::int into v_total
    from public.procedure_sessions ps
   where ps.procedure_id = p_procedure_id and ps.clinic_id is null;

  update public.procedures
     set estimated_minutes = nullif(v_total, 0), updated_at = now()
   where id = p_procedure_id;

  insert into public.procedure_changes (procedure_id, changed_by, description)
  values (p_procedure_id, v_user,
          'Protocolo da rede: ' || v_qtd || case when v_qtd = 1 then ' sessão' else ' sessões' end
          || ', ' || v_total || ' min.');

  return v_qtd;
end;
$$;

revoke execute on function public.set_network_procedure_sessions(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.set_network_procedure_sessions(uuid, jsonb) to authenticated;

-- 3) Orçamento: só item do catálogo, com o preço do catálogo --------------------
-- O preço da unidade, senão o padrão da rede — a mesma conta da tela
-- (`effectivePriceCents`, src/lib/pricing.ts).
create or replace function public.catalog_price_for(p_clinic_id uuid, p_procedure_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select cpp.price_cents from public.clinic_procedure_prices cpp
      where cpp.clinic_id = p_clinic_id and cpp.procedure_id = p_procedure_id),
    (select p.default_price_cents from public.procedures p where p.id = p_procedure_id)
  );
$$;

revoke execute on function public.catalog_price_for(uuid, uuid) from public, anon, authenticated;
grant execute on function public.catalog_price_for(uuid, uuid) to authenticated;

-- ⚠️ Vale para o que chega pela TELA (papel `authenticated`). As funções do
-- banco que mexem nos itens (rodam como dono) seguem como sempre.
-- ⚠️ SEM `security definer` DE PROPÓSITO: com ele, `current_user` aqui dentro
-- seria sempre o DONO e a trava nunca valeria (achado no ensaio, 19/10/2026).
create or replace function public.plan_item_catalog_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user <> 'authenticated' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.procedure_id is null then
      raise exception 'CATALOG_ITEM_REQUIRED';
    end if;
    -- O nome e o preço são os do catálogo — o que a tela mandou não vale.
    select p.name into new.description from public.procedures p where p.id = new.procedure_id;
    if new.description is null then raise exception 'PROCEDURE_NOT_FOUND'; end if;
    new.unit_price_cents := coalesce(public.catalog_price_for(new.clinic_id, new.procedure_id), 0);
    return new;
  end if;

  -- UPDATE: procedimento, nome e preço ficam como nasceram.
  if new.procedure_id is distinct from old.procedure_id then
    raise exception 'ITEM_PROCEDURE_LOCKED';
  end if;
  if new.unit_price_cents is distinct from old.unit_price_cents
     or new.description is distinct from old.description then
    raise exception 'ITEM_PRICE_LOCKED';
  end if;
  return new;
end;
$$;

revoke execute on function public.plan_item_catalog_guard() from public, anon, authenticated;

drop trigger if exists plan_item_catalog_guard_trg on public.treatment_plan_option_items;
create trigger plan_item_catalog_guard_trg
  before insert or update on public.treatment_plan_option_items
  for each row execute function public.plan_item_catalog_guard();

-- 4) Sugestão de procedimento ---------------------------------------------------
create sequence if not exists public.procedure_suggestion_seq;

create table if not exists public.procedure_suggestions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default ('SP-' || lpad(nextval('public.procedure_suggestion_seq')::text, 5, '0')),
  proposed_by uuid not null references public.profiles (id),
  name text not null,
  specialty text,
  pillar public.methodology_pillar,
  sessions integer not null check (sessions between 1 and 50),
  total_minutes integer check (total_minutes is null or total_minutes > 0),
  justification text not null,
  status text not null default 'enviada'
    check (status in ('enviada', 'precisa_info', 'aprovada', 'recusada')),
  procedure_id uuid references public.procedures (id),
  reviewed_by uuid references public.profiles (id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.procedure_suggestion_messages (
  id uuid primary key default gen_random_uuid(),
  suggestion_id uuid not null references public.procedure_suggestions (id) on delete cascade,
  author_id uuid references public.profiles (id),
  kind text not null check (kind in ('pergunta', 'resposta', 'recusa', 'aprovacao')),
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists procedure_suggestion_messages_idx
  on public.procedure_suggestion_messages (suggestion_id, created_at);

alter table public.procedure_suggestions enable row level security;
alter table public.procedure_suggestion_messages enable row level security;

-- Quem sugeriu vê a sua; o Admin Master vê todas. Escrita só pelas funções.
drop policy if exists procedure_suggestions_select on public.procedure_suggestions;
create policy procedure_suggestions_select on public.procedure_suggestions
  for select to authenticated
  using (public.is_admin_master() or proposed_by = (select auth.uid()));

drop policy if exists procedure_suggestion_messages_select on public.procedure_suggestion_messages;
create policy procedure_suggestion_messages_select on public.procedure_suggestion_messages
  for select to authenticated
  using (exists (
    select 1 from public.procedure_suggestions s
     where s.id = suggestion_id
       and (public.is_admin_master() or s.proposed_by = (select auth.uid()))
  ));

-- O aviso para os Admins.
create or replace function public._notify_admins_about_suggestion(p_title text, p_body text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications (user_id, title, body, link)
  select p.id, p_title, p_body, '/procedimentos#sugestoes'
    from public.profiles p
   where p.is_admin_master and p.is_active;
$$;
revoke execute on function public._notify_admins_about_suggestion(text, text) from public, anon, authenticated;

create or replace function public.suggest_procedure(
  p_name text, p_specialty text, p_pillar text, p_sessions integer,
  p_total_minutes integer, p_justification text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_code text;
begin
  if v_user is null then raise exception 'NOT_ALLOWED'; end if;
  if not (public.is_admin_master() or public.is_planner()) then raise exception 'NOT_ALLOWED'; end if;
  if length(btrim(coalesce(p_name, ''))) < 3 then raise exception 'NAME_REQUIRED'; end if;
  if length(btrim(coalesce(p_justification, ''))) < 10 then raise exception 'JUSTIFICATION_REQUIRED'; end if;
  if coalesce(p_sessions, 0) not between 1 and 50 then raise exception 'INVALID_SESSIONS'; end if;
  if p_total_minutes is not null and p_total_minutes <= 0 then raise exception 'INVALID_MINUTES'; end if;
  -- Já existe no catálogo: é para escolher, não para sugerir.
  if exists (select 1 from public.procedures p
              where lower(btrim(p.name)) = lower(btrim(p_name)) and p.is_active) then
    raise exception 'PROCEDURE_EXISTS';
  end if;

  insert into public.procedure_suggestions
    (proposed_by, name, specialty, pillar, sessions, total_minutes, justification)
  values
    (v_user, btrim(p_name), nullif(btrim(coalesce(p_specialty, '')), ''),
     nullif(p_pillar, '')::public.methodology_pillar, p_sessions, p_total_minutes, btrim(p_justification))
  returning code into v_code;

  perform public._notify_admins_about_suggestion(
    'Sugestão de novo procedimento — ' || v_code,
    'O Centro de Planejamento sugeriu incluir "' || btrim(p_name) || '" no catálogo. Confira e aprove, recuse ou peça mais informações em Procedimentos.'
  );
  return v_code;
end;
$$;
revoke execute on function public.suggest_procedure(text, text, text, integer, integer, text) from public, anon, authenticated;
grant execute on function public.suggest_procedure(text, text, text, integer, integer, text) to authenticated;

create or replace function public.ask_procedure_suggestion_info(p_id uuid, p_question text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  s record;
begin
  if v_user is null or not public.is_admin_master() then raise exception 'NOT_ALLOWED'; end if;
  if length(btrim(coalesce(p_question, ''))) < 5 then raise exception 'QUESTION_REQUIRED'; end if;
  select * into s from public.procedure_suggestions where id = p_id for update;
  if s.id is null then raise exception 'SUGGESTION_NOT_FOUND'; end if;
  if s.status <> 'enviada' then raise exception 'NOT_OPEN'; end if;

  update public.procedure_suggestions
     set status = 'precisa_info', updated_at = now()
   where id = p_id;
  insert into public.procedure_suggestion_messages (suggestion_id, author_id, kind, body)
  values (p_id, v_user, 'pergunta', btrim(p_question));
  insert into public.notifications (user_id, title, body, link)
  values (s.proposed_by, 'A rede pediu mais informações — ' || s.code,
          'Sobre a sua sugestão "' || s.name || '": ' || btrim(p_question),
          '/procedimentos#sugestoes');
end;
$$;
revoke execute on function public.ask_procedure_suggestion_info(uuid, text) from public, anon, authenticated;
grant execute on function public.ask_procedure_suggestion_info(uuid, text) to authenticated;

create or replace function public.answer_procedure_suggestion(
  p_id uuid, p_answer text, p_name text, p_specialty text, p_pillar text,
  p_sessions integer, p_total_minutes integer, p_justification text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  s record;
begin
  if v_user is null then raise exception 'NOT_ALLOWED'; end if;
  select * into s from public.procedure_suggestions where id = p_id for update;
  if s.id is null then raise exception 'SUGGESTION_NOT_FOUND'; end if;
  if s.proposed_by is distinct from v_user then raise exception 'NOT_ALLOWED'; end if;
  if s.status <> 'precisa_info' then raise exception 'NOT_WAITING_INFO'; end if;
  if length(btrim(coalesce(p_answer, ''))) < 3 then raise exception 'ANSWER_REQUIRED'; end if;
  if length(btrim(coalesce(p_name, ''))) < 3 then raise exception 'NAME_REQUIRED'; end if;
  if length(btrim(coalesce(p_justification, ''))) < 10 then raise exception 'JUSTIFICATION_REQUIRED'; end if;
  if coalesce(p_sessions, 0) not between 1 and 50 then raise exception 'INVALID_SESSIONS'; end if;
  if p_total_minutes is not null and p_total_minutes <= 0 then raise exception 'INVALID_MINUTES'; end if;

  update public.procedure_suggestions
     set name = btrim(p_name),
         specialty = nullif(btrim(coalesce(p_specialty, '')), ''),
         pillar = nullif(p_pillar, '')::public.methodology_pillar,
         sessions = p_sessions,
         total_minutes = p_total_minutes,
         justification = btrim(p_justification),
         status = 'enviada',
         updated_at = now()
   where id = p_id;
  insert into public.procedure_suggestion_messages (suggestion_id, author_id, kind, body)
  values (p_id, v_user, 'resposta', btrim(p_answer));
  perform public._notify_admins_about_suggestion(
    'Sugestão respondida — ' || s.code,
    'O Centro de Planejamento respondeu sobre "' || btrim(p_name) || '". Confira em Procedimentos.'
  );
end;
$$;
revoke execute on function public.answer_procedure_suggestion(uuid, text, text, text, text, integer, integer, text) from public, anon, authenticated;
grant execute on function public.answer_procedure_suggestion(uuid, text, text, text, text, integer, integer, text) to authenticated;

create or replace function public.reject_procedure_suggestion(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  s record;
begin
  if v_user is null or not public.is_admin_master() then raise exception 'NOT_ALLOWED'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'REASON_REQUIRED'; end if;
  select * into s from public.procedure_suggestions where id = p_id for update;
  if s.id is null then raise exception 'SUGGESTION_NOT_FOUND'; end if;
  if s.status not in ('enviada', 'precisa_info') then raise exception 'NOT_OPEN'; end if;

  update public.procedure_suggestions
     set status = 'recusada', reviewed_by = v_user, reviewed_at = now(), updated_at = now()
   where id = p_id;
  insert into public.procedure_suggestion_messages (suggestion_id, author_id, kind, body)
  values (p_id, v_user, 'recusa', btrim(p_reason));
  insert into public.notifications (user_id, title, body, link)
  values (s.proposed_by, 'Sugestão de procedimento recusada — ' || s.code,
          '"' || s.name || '": ' || btrim(p_reason), '/procedimentos#sugestoes');
end;
$$;
revoke execute on function public.reject_procedure_suggestion(uuid, text) from public, anon, authenticated;
grant execute on function public.reject_procedure_suggestion(uuid, text) to authenticated;

-- Aprovar: o procedimento já foi criado pela tela (Admin, com preço e
-- comissão); aqui a sugestão se liga a ele e as sessões sugeridas viram o
-- protocolo da rede — se ele ainda não tiver um.
create or replace function public.approve_procedure_suggestion(p_id uuid, p_procedure_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  s record;
  v_nome text;
  v_base integer;
  i integer;
begin
  if v_user is null or not public.is_admin_master() then raise exception 'NOT_ALLOWED'; end if;
  select * into s from public.procedure_suggestions where id = p_id for update;
  if s.id is null then raise exception 'SUGGESTION_NOT_FOUND'; end if;
  if s.status not in ('enviada', 'precisa_info') then raise exception 'NOT_OPEN'; end if;
  select p.name into v_nome from public.procedures p where p.id = p_procedure_id;
  if v_nome is null then raise exception 'PROCEDURE_NOT_FOUND'; end if;

  if not exists (select 1 from public.procedure_sessions ps
                  where ps.procedure_id = p_procedure_id and ps.clinic_id is null) then
    -- O tempo total repartido entre as sessões; a última absorve o resto.
    v_base := coalesce(s.total_minutes, 0) / s.sessions;
    for i in 1 .. s.sessions loop
      insert into public.procedure_sessions
        (procedure_id, clinic_id, session_index, name, estimated_minutes, created_by)
      values
        (p_procedure_id, null, i, null,
         case when i = s.sessions then coalesce(s.total_minutes, 0) - v_base * (s.sessions - 1) else v_base end,
         v_user);
    end loop;
    update public.procedures
       set estimated_minutes = nullif(coalesce(s.total_minutes, 0), 0), updated_at = now()
     where id = p_procedure_id;
  end if;

  update public.procedure_suggestions
     set status = 'aprovada', procedure_id = p_procedure_id,
         reviewed_by = v_user, reviewed_at = now(), updated_at = now()
   where id = p_id;
  insert into public.procedure_suggestion_messages (suggestion_id, author_id, kind, body)
  values (p_id, v_user, 'aprovacao', 'Incluído no catálogo como "' || v_nome || '".');
  insert into public.notifications (user_id, title, body, link)
  values (s.proposed_by, 'Sugestão aprovada — ' || s.code,
          '"' || v_nome || '" entrou no catálogo e já pode ser usado no plano.',
          '/procedimentos#sugestoes');
end;
$$;
revoke execute on function public.approve_procedure_suggestion(uuid, uuid) from public, anon, authenticated;
grant execute on function public.approve_procedure_suggestion(uuid, uuid) to authenticated;

-- As tabelas novas entram na auditoria (regra 7 do CLAUDE.md).
select public.audit_attach_all();

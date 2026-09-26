-- =============================================================================
-- 0274 — RECICLAGEM: MANTER O ACESSO, SUSPENDER AGORA, OU DAR PRAZO
-- -----------------------------------------------------------------------------
-- Ordem do dono (26/09/2026), revendo a decisão de horas antes:
--
--   *"Vamos criar a opção de escolher se o usuário continua com o acesso real
--   enquanto faz a reciclagem ou se seu acesso é suspenso até realizar a
--   reciclagem. Isso possibilita já suspender imediatamente (...) ou criar
--   prazos para realizar a reciclagem sem suspender o acesso; se não fizer até
--   uma data estipulada pode ser suspenso o acesso, evitando que usuários não
--   façam a reciclagem obrigatória."*
--
-- TRÊS POLÍTICAS, escolhidas POR TURMA:
--   * `mantem`          — continua trabalhando (o padrão de ontem, e o padrão
--                         daqui: é o único que não pode parar a clínica);
--   * `suspende_agora`  — perde o acesso ao real já na convocação;
--   * `prazo`           — trabalha normalmente até a data; depois dela, o
--                         sistema suspende sozinho quem não fez.
--
-- ⚠️ ISTO TIRA O ACESSO DE GENTE AO SISTEMA REAL. É o recurso mais perigoso
-- deste módulo, e por isso vem com quatro travas, cada uma por um motivo que
-- já doeu neste projeto:
--
--   1. SÓ SUSPENDE QUEM TINHA ACESSO. Quem já estava bloqueado por outro
--      motivo não é tocado — senão, ao "restaurar", o sistema DARIA acesso a
--      quem nunca teve.
--   2. SÓ RESTAURA O QUE ELE MESMO SUSPENDEU (`access_suspended_at`). Sem essa
--      marca, restaurar em massa viraria uma liberação em massa.
--   3. ENCERRAR A TURMA RESTAURA TODO MUNDO. Sem isso, encerrar uma turma
--      deixaria pessoas trancadas para fora para sempre, e ninguém ligaria uma
--      coisa à outra.
--   4. SÓ RECICLAGEM SUSPENDE. Em turma de novatos a pessoa ainda nem tem
--      acesso (a 0259 já nasce fechada); "suspender" ali seria um comando sem
--      efeito com cara de efeito.
--
-- Idempotente.
-- =============================================================================

-- 1) A política da turma ------------------------------------------------------
alter table public.training_campaigns
  add column if not exists access_policy text not null default 'mantem';

alter table public.training_campaigns
  add column if not exists deadline date;

alter table public.training_campaigns
  drop constraint if exists training_campaigns_access_policy_check;
alter table public.training_campaigns
  add constraint training_campaigns_access_policy_check
  check (access_policy in ('mantem', 'suspende_agora', 'prazo'));

-- Só reciclagem suspende (trava 4).
alter table public.training_campaigns
  drop constraint if exists training_campaigns_policy_kind_check;
alter table public.training_campaigns
  add constraint training_campaigns_policy_kind_check
  check (access_policy = 'mantem' or kind = 'reciclagem');

-- ⚠️ `prazo` SEM DATA seria uma ameaça que nunca chega — e `suspende_agora`
-- COM data faria alguém acreditar num prazo que não existe. As duas metades
-- do par têm de andar juntas, e o banco é quem garante.
alter table public.training_campaigns
  drop constraint if exists training_campaigns_deadline_check;
alter table public.training_campaigns
  add constraint training_campaigns_deadline_check
  check (
    (access_policy = 'prazo' and deadline is not null)
    or (access_policy <> 'prazo' and deadline is null)
  );

-- 2) A marca de quem FOI SUSPENSO POR AQUI -----------------------------------
alter table public.training_enrollments
  add column if not exists access_suspended_at timestamptz;

comment on column public.training_enrollments.access_suspended_at is
  'Quando ESTE módulo suspendeu o acesso ao sistema real. Nulo = não fomos nós; não restaurar (0274).';

-- 3) SUSPENDER ----------------------------------------------------------------
-- Interna: sem guarda de papel, porque quem chama é a abertura da turma (que
-- já exige Admin) e o trabalho agendado (que roda sem usuário nenhum). Mesmo
-- desenho de `apply_stock_movement` × `post_stock_movement` (0217) e das
-- funções `_raw` dos alertas (0230) — e, como lá, o `revoke` é obrigatório:
-- função nova nasce executável por TODO MUNDO no Postgres.
create or replace function public.suspend_training_access(p_enrollment_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_ja timestamptz;
begin
  select e.user_id, e.access_suspended_at
    into v_user, v_ja
    from public.training_enrollments e
   where e.id = p_enrollment_id;

  if v_user is null or v_ja is not null then
    return false;
  end if;

  -- TRAVA 1: só suspende quem TINHA acesso. Sem isto, o "restaurar" no fim da
  -- reciclagem daria acesso ao sistema real a quem nunca teve — o módulo que
  -- existe para controlar a entrada viraria uma porta de entrada.
  if not public.environment_allowed(v_user, 'sistema') then
    return false;
  end if;

  insert into public.user_environments (user_id, environment, allowed, granted_by)
  values (v_user, 'sistema', false, auth.uid())
  on conflict (user_id, environment)
    do update set allowed = false, granted_at = now(), granted_by = auth.uid();

  update public.training_enrollments
     set access_suspended_at = now()
   where id = p_enrollment_id;

  insert into public.notifications (user_id, title, body, link)
  values (
    v_user,
    'Seu acesso ao riSZon foi suspenso até a reciclagem',
    'Conclua a missão de reciclagem no ambiente de treino para voltar a usar o sistema real.',
    '/'
  );

  return true;
end;
$$;

revoke all on function public.suspend_training_access(uuid) from public;

-- 4) RESTAURAR ----------------------------------------------------------------
create or replace function public.restore_training_access(p_enrollment_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_quando timestamptz;
begin
  select e.user_id, e.access_suspended_at
    into v_user, v_quando
    from public.training_enrollments e
   where e.id = p_enrollment_id;

  -- TRAVA 2: só restaura o que ESTE módulo suspendeu. Restaurar sem a marca
  -- seria liberar em massa gente que estava bloqueada por outro motivo —
  -- desligada, afastada, bloqueada de propósito pelo Admin.
  if v_user is null or v_quando is null then
    return false;
  end if;

  update public.user_environments
     set allowed = true, granted_at = now(), granted_by = auth.uid()
   where user_id = v_user and environment = 'sistema';

  update public.training_enrollments
     set access_suspended_at = null
   where id = p_enrollment_id;

  insert into public.notifications (user_id, title, body, link)
  values (
    v_user,
    'Seu acesso ao riSZon foi restabelecido',
    'A suspensão da reciclagem foi encerrada.',
    '/'
  );

  return true;
end;
$$;

revoke all on function public.restore_training_access(uuid) from public;
grant execute on function public.restore_training_access(uuid) to authenticated;

-- 5) O PRAZO QUE VENCE — trabalho agendado ------------------------------------
-- Roda sem usuário: `auth.uid()` é nulo aqui, e é por isso que as funções
-- acima não têm guarda de papel (a guarda está em quem as expõe).
create or replace function public.apply_training_deadlines()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer := 0;
  r record;
begin
  for r in
    select e.id
      from public.training_enrollments e
      join public.training_campaigns c on c.id = e.campaign_id
     where c.status = 'aberta'
       and c.access_policy = 'prazo'
       and c.deadline < public.today_br()
       and e.status in ('convocado', 'em_andamento')
       and e.access_suspended_at is null
  loop
    if public.suspend_training_access(r.id) then
      v_n := v_n + 1;
    end if;
  end loop;

  return v_n;
end;
$$;

revoke all on function public.apply_training_deadlines() from public;

-- ⚠️ A DATA É A BRASILEIRA (`today_br`, 0201), não a do servidor. Com o
-- servidor em UTC, usar `current_date` suspenderia gente a partir das 21h do
-- dia ANTERIOR ao prazo — um dia de acesso perdido por causa de fuso.

do $$
begin
  create extension if not exists pg_cron;
  perform cron.unschedule('risarte-training-deadlines');
exception when others then null;
end;
$$;
do $$
begin
  perform cron.schedule(
    'risarte-training-deadlines', '30 3 * * *',
    'select public.apply_training_deadlines()'
  );
exception when others then null;
end;
$$;

-- 6) ABRIR A TURMA — agora com política e prazo -------------------------------
drop function if exists public.open_training_campaign(uuid, text, text, uuid[]);

create or replace function public.open_training_campaign(
  p_clinic_id uuid,
  p_kind text,
  p_note text default null,
  p_only_users uuid[] default null,
  p_access_policy text default 'mantem',
  p_deadline date default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_n int;
  r record;
begin
  if not public.is_admin_master() then
    raise exception 'NOT_ALLOWED';
  end if;

  if p_kind not in ('novatos', 'reciclagem') then
    raise exception 'INVALID_KIND';
  end if;

  if p_access_policy not in ('mantem', 'suspende_agora', 'prazo') then
    raise exception 'INVALID_POLICY';
  end if;

  if p_access_policy <> 'mantem' and p_kind <> 'reciclagem' then
    raise exception 'POLICY_ONLY_FOR_RECYCLING';
  end if;

  if p_access_policy = 'prazo' then
    if p_deadline is null then
      raise exception 'DEADLINE_REQUIRED';
    end if;
    -- Prazo no passado suspenderia todo mundo na primeira madrugada, o que
    -- é a mesma coisa que `suspende_agora` — mas sem ninguém ter escolhido.
    if p_deadline <= public.today_br() then
      raise exception 'DEADLINE_IN_THE_PAST';
    end if;
  end if;

  if exists (
    select 1 from public.training_campaigns
     where clinic_id = p_clinic_id and status = 'aberta'
  ) then
    raise exception 'CAMPAIGN_ALREADY_OPEN';
  end if;

  insert into public.training_campaigns
    (clinic_id, kind, note, created_by, access_policy, deadline)
  values (
    p_clinic_id, p_kind, nullif(trim(coalesce(p_note, '')), ''), auth.uid(),
    p_access_policy,
    case when p_access_policy = 'prazo' then p_deadline else null end
  )
  returning id into v_id;

  insert into public.training_enrollments (campaign_id, user_id, role)
  select v_id, c.user_id, c.role
    from public.training_candidates(p_clinic_id, p_kind) c
   where p_only_users is null or c.user_id = any(p_only_users);

  get diagnostics v_n = row_count;

  if v_n = 0 then
    raise exception 'NOBODY_TO_ENROLL';
  end if;

  -- Suspensão imediata, quando foi isso que se escolheu.
  if p_access_policy = 'suspende_agora' then
    for r in
      select id from public.training_enrollments where campaign_id = v_id
    loop
      perform public.suspend_training_access(r.id);
    end loop;
  end if;

  return v_id;
end;
$$;

revoke all on function public.open_training_campaign(uuid, text, text, uuid[], text, date) from public;
grant execute on function public.open_training_campaign(uuid, text, text, uuid[], text, date) to authenticated;

-- 7) ENCERRAR A TURMA — devolvendo o acesso de quem ela tirou -----------------
create or replace function public.close_training_campaign(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  if not public.is_admin_master() then
    raise exception 'NOT_ALLOWED';
  end if;

  -- TRAVA 3, e é a mais importante desta migração. Sem ela, encerrar uma turma
  -- deixaria as pessoas suspensas trancadas para fora PARA SEMPRE — e ninguém
  -- ligaria "não consigo entrar" a uma turma encerrada semanas antes.
  for r in
    select id from public.training_enrollments
     where campaign_id = p_id and access_suspended_at is not null
  loop
    perform public.restore_training_access(r.id);
  end loop;

  update public.training_campaigns
     set status = 'encerrada', closed_at = now(), closed_by = auth.uid()
   where id = p_id and status = 'aberta';
end;
$$;

revoke all on function public.close_training_campaign(uuid) from public;
grant execute on function public.close_training_campaign(uuid) to authenticated;

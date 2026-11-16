-- =============================================================================
-- 0411 — CERTIFICAÇÃO: QUEM SAIU NÃO SEGURA A UNIDADE, E TURMA NOVA NÃO TRAVA
--
-- Dois relatos do Admin Master na PRODUÇÃO (16/11/2026):
--
-- OC-00015 — "Colaborador removido do quadro está com certificação em
-- andamento". A Luna (recepção, Cambé) foi desligada (perfil inativo, função
-- tirada) e continuou "em andamento" na TR-00007. Com a liberação COLETIVA,
-- Cambé espera o grupo inteiro — e esperaria para sempre. A situação
-- "dispensado" existia desde a 0273 e já não segurava a unidade (0277), mas
-- NADA a colocava: nem botão, nem regra.
--   Decisão do dono (16/11/2026, "segue o recomendado"):
--   1. DISPENSA AUTOMÁTICA — desativar a pessoa, ou tirar dela a função naquela
--      unidade, dispensa as matrículas dela em turma aberta (as não
--      concluídas). Os casos que já existem são acertados aqui.
--   2. BOTÃO "DISPENSAR" no Acompanhamento, com motivo (afastamento, licença).
--
-- OC-00016 — "Não consigo gerar uma nova certificação sem finalizar uma em
-- andamento". A 0275 permitia UMA turma aberta por unidade; as três unidades
-- têm uma aberta, e qualquer turma nova era recusada (CAMPAIGN_ALREADY_OPEN).
--   Decisão do dono (16/11/2026): "não travar quando convida uma pessoa para
--   uma outra certificação". A trava por UNIDADE sai. O que continua barrado
--   é só a convocação repetida: a MESMA pessoa, na MESMA função, já numa
--   turma aberta do mesmo tipo — essa é a mesma missão (0305), e a prévia
--   mostra em qual turma ela está.
--   A liberação coletiva já olha TODAS as turmas abertas da unidade (0277),
--   então várias turmas na mesma unidade não mudam quem segura quem.
--
-- Nada apaga dado. Idempotente.
-- =============================================================================

-- 1) Quem dispensou, quando e por quê -------------------------------------------
-- `dismissed_by` SEM chave estrangeira de propósito: a matrícula já tem duas
-- ligações para `profiles` (user_id, approved_by), e uma terceira deixaria
-- ambíguo qualquer embed novo (lição da 0281, ARQUITETURA-TECNICA.md).
alter table public.training_enrollments
  add column if not exists dismissed_at timestamptz,
  add column if not exists dismissed_by uuid,
  add column if not exists dismissal_reason text;

comment on column public.training_enrollments.dismissal_reason is
  'Por que a pessoa foi dispensada da turma (0411): texto do Admin, ou o motivo automático (desligada / deixou a função na unidade).';

-- 2) A peça que dispensa ---------------------------------------------------------
-- Sem guarda própria: só as funções e gatilhos abaixo chamam, depois de decidir.
-- Só mexe em matrícula NÃO concluída de turma ABERTA: concluída é fato (o
-- certificado já saiu ou espera aprovação), e turma encerrada é histórico.
create or replace function public._dismiss_training_enrollment(
  p_enrollment_id uuid,
  p_reason text,
  p_by uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ok boolean;
begin
  update public.training_enrollments e
     set status = 'dispensado',
         dismissed_at = now(),
         dismissed_by = p_by,
         dismissal_reason = nullif(trim(coalesce(p_reason, '')), '')
    from public.training_campaigns tc
   where e.id = p_enrollment_id
     and tc.id = e.campaign_id
     and tc.status = 'aberta'
     and e.status in ('convocado', 'em_andamento');
  v_ok := found;

  -- Reciclagem com acesso suspenso: a suspensão era desta matrícula, e com
  -- ela dispensada não há mais o que esperar. `restore_training_access` só
  -- devolve o que ESTE módulo tirou (0274) — quem foi desligado continua
  -- barrado pelo perfil inativo.
  if v_ok then
    perform public.restore_training_access(p_enrollment_id);
  end if;

  return v_ok;
end;
$$;

revoke execute on function public._dismiss_training_enrollment(uuid, text, uuid) from public, anon, authenticated;

-- 3) O botão "Dispensar" (só o Admin Master) -------------------------------------
create or replace function public.dismiss_training_enrollment(
  p_enrollment_id uuid,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin_master() then
    raise exception 'NOT_ALLOWED';
  end if;

  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'REASON_REQUIRED';
  end if;

  if not exists (select 1 from public.training_enrollments where id = p_enrollment_id) then
    raise exception 'ENROLLMENT_NOT_FOUND';
  end if;

  if not public._dismiss_training_enrollment(p_enrollment_id, p_reason, auth.uid()) then
    raise exception 'NOT_DISMISSABLE';
  end if;

  return true;
end;
$$;

revoke execute on function public.dismiss_training_enrollment(uuid, text) from public, anon, authenticated;
grant execute on function public.dismiss_training_enrollment(uuid, text) to authenticated, service_role;

-- 4) Dispensa automática: a pessoa deixou a função NAQUELA unidade ---------------
create or replace function public.training_dismiss_on_role_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  -- Só interessa quando a função (pessoa, unidade, função) deixou de existir:
  -- apagada, ou trocada por outra. Mudar outra coluna não dispensa ninguém.
  if tg_op = 'UPDATE'
     and new.user_id = old.user_id
     and new.clinic_id = old.clinic_id
     and new.role = old.role then
    return new;
  end if;

  begin
    for r in
      select e.id
        from public.training_enrollments e
        join public.training_campaigns tc on tc.id = e.campaign_id
       where tc.status = 'aberta'
         and e.user_id = old.user_id
         and e.clinic_id = old.clinic_id
         and e.role = old.role
         and e.status in ('convocado', 'em_andamento')
         -- Se a mesma função continua lá (linha duplicada), não dispensa.
         and not exists (
           select 1 from public.user_clinic_roles_all u
            where u.user_id = old.user_id
              and u.clinic_id = old.clinic_id
              and u.role = old.role
              and (tg_op = 'DELETE' or u.id is distinct from new.id)
         )
    loop
      perform public._dismiss_training_enrollment(
        r.id, 'Deixou a função nesta unidade (automático).', auth.uid()
      );
    end loop;
  exception when others then
    -- A dispensa nunca derruba a mudança de função no cadastro.
    raise warning 'training_dismiss_on_role_change: %', sqlerrm;
  end;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke execute on function public.training_dismiss_on_role_change() from public, anon, authenticated;

drop trigger if exists training_dismiss_on_role_change_trg on public.user_clinic_roles_all;
create trigger training_dismiss_on_role_change_trg
  after update or delete on public.user_clinic_roles_all
  for each row execute function public.training_dismiss_on_role_change();

-- 5) Dispensa automática: a pessoa foi desativada (desligada) --------------------
create or replace function public.training_dismiss_on_deactivation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  if coalesce(old.is_active, false) and not coalesce(new.is_active, false) then
    begin
      for r in
        select e.id
          from public.training_enrollments e
          join public.training_campaigns tc on tc.id = e.campaign_id
         where tc.status = 'aberta'
           and e.user_id = new.id
           and e.status in ('convocado', 'em_andamento')
      loop
        perform public._dismiss_training_enrollment(
          r.id, 'Desligada da equipe (automático).', auth.uid()
        );
      end loop;
    exception when others then
      -- A dispensa nunca derruba a desativação.
      raise warning 'training_dismiss_on_deactivation: %', sqlerrm;
    end;
  end if;
  return new;
end;
$$;

revoke execute on function public.training_dismiss_on_deactivation() from public, anon, authenticated;

drop trigger if exists training_dismiss_on_deactivation_trg on public.profiles;
create trigger training_dismiss_on_deactivation_trg
  after update of is_active on public.profiles
  for each row execute function public.training_dismiss_on_deactivation();

-- 6) Os casos que já existem (a Luna na TR-00007, na produção) -------------------
do $$
declare
  r record;
begin
  for r in
    select e.id,
           case when not coalesce(p.is_active, false)
                then 'Desligada da equipe (automático).'
                else 'Deixou a função nesta unidade (automático).'
           end as motivo
      from public.training_enrollments e
      join public.training_campaigns tc on tc.id = e.campaign_id
      join public.profiles p on p.id = e.user_id
     where tc.status = 'aberta'
       and e.status in ('convocado', 'em_andamento')
       and (
         not coalesce(p.is_active, false)
         or not exists (
           select 1 from public.user_clinic_roles_all u
            where u.user_id = e.user_id
              and u.clinic_id = e.clinic_id
              and u.role = e.role
         )
       )
  loop
    perform public._dismiss_training_enrollment(r.id, r.motivo, null);
  end loop;
end $$;

-- 7) A prévia: diz em qual turma aberta a pessoa já está naquela função ----------
-- Coluna nova no retorno → drop + create (a casca de uma unidade junto).
drop function if exists public.training_candidates(uuid, text);
drop function if exists public.training_candidates_multi(uuid[], text);

create or replace function public.training_candidates_multi(
  p_clinic_ids uuid[],
  p_kind text
)
returns table (
  clinic_id uuid,
  clinic_name text,
  user_id uuid,
  full_name text,
  role public.user_role,
  ja_certificado boolean,
  turma_aberta text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin_master() then
    raise exception 'NOT_ALLOWED';
  end if;

  return query
  with com_missao as (
    select distinct r.role from public.training_requirements r
  ),
  gente as (
    -- A MESMA FUNÇÃO EM DUAS UNIDADES É UMA MISSÃO SÓ (0275).
    select distinct on (ucr.user_id, ucr.role)
           ucr.clinic_id, ucr.user_id, ucr.role
      from public.user_clinic_roles ucr
      join public.profiles p on p.id = ucr.user_id and p.is_active
      join com_missao cm on cm.role = ucr.role
     where ucr.clinic_id = any(p_clinic_ids)
       and not coalesce(p.is_admin_master, false)
       and (
         not exists (select 1 from public.training_cohort_roles)
         or exists (
           select 1 from public.training_cohort_roles f where f.role = ucr.role
         )
       )
     order by ucr.user_id, ucr.role, ucr.clinic_id
  )
  select
    g.clinic_id,
    cl.name::text,
    g.user_id,
    coalesce(pr.full_name, pr.email)::text,
    g.role,
    exists (
      select 1 from public.training_certifications c
       where c.user_id = g.user_id and c.role = g.role
    ),
    -- 0411: já convocada nesta função numa turma aberta do mesmo tipo.
    (
      select coalesce(tc.code, 'aberta')
        from public.training_enrollments e
        join public.training_campaigns tc on tc.id = e.campaign_id
       where tc.status = 'aberta'
         and tc.kind = p_kind
         and e.user_id = g.user_id
         and e.role = g.role
         and e.status <> 'dispensado'
       order by tc.created_at
       limit 1
    )::text
  from gente g
  join public.profiles pr on pr.id = g.user_id
  join public.clinics cl on cl.id = g.clinic_id
  where
    case when p_kind = 'reciclagem' then true
    else not exists (
      select 1 from public.training_certifications c
       where c.user_id = g.user_id and c.role = g.role
    ) end
  order by cl.name, 4;
end;
$$;

revoke execute on function public.training_candidates_multi(uuid[], text) from public, anon, authenticated;
grant execute on function public.training_candidates_multi(uuid[], text) to authenticated, service_role;

create or replace function public.training_candidates(
  p_clinic_id uuid,
  p_kind text
)
returns table (
  user_id uuid,
  full_name text,
  role public.user_role,
  ja_certificado boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select c.user_id, c.full_name, c.role, c.ja_certificado
    from public.training_candidates_multi(array[p_clinic_id], p_kind) c;
$$;

revoke execute on function public.training_candidates(uuid, text) from public, anon, authenticated;
grant execute on function public.training_candidates(uuid, text) to authenticated, service_role;

-- 8) Abrir turma: sem a trava por unidade -----------------------------------------
-- Mesma assinatura e mesmo corpo da 0275, menos o CAMPAIGN_ALREADY_OPEN; quem já
-- está numa turma aberta na mesma função fica de fora (a mesma missão, 0305).
create or replace function public.open_training_campaign(
  p_clinic_ids uuid[],
  p_kind text,
  p_note text default null,
  p_only text[] default null,
  p_access_policy text default 'mantem',
  p_deadline date default null,
  p_whole_network boolean default false
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

  if p_clinic_ids is null or coalesce(array_length(p_clinic_ids, 1), 0) = 0 then
    raise exception 'NO_UNITS';
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
    if p_deadline <= public.today_br() then
      raise exception 'DEADLINE_IN_THE_PAST';
    end if;
  end if;

  if exists (
    select 1 from unnest(p_clinic_ids) as u(id)
     where not exists (
       select 1 from public.clinics c where c.id = u.id and c.is_active
     )
  ) then
    raise exception 'UNKNOWN_UNIT';
  end if;

  -- (0411) Sem "uma turma aberta por unidade": decisão do dono no OC-00016.

  insert into public.training_campaigns
    (clinic_id, kind, note, created_by, access_policy, deadline, whole_network)
  values (
    null, p_kind, nullif(trim(coalesce(p_note, '')), ''), auth.uid(),
    p_access_policy,
    case when p_access_policy = 'prazo' then p_deadline else null end,
    coalesce(p_whole_network, false)
  )
  returning id into v_id;

  insert into public.training_campaign_units (campaign_id, clinic_id)
  select distinct v_id, u.id from unnest(p_clinic_ids) as u(id);

  insert into public.training_enrollments (campaign_id, user_id, role, clinic_id)
  select v_id, c.user_id, c.role, c.clinic_id
    from public.training_candidates_multi(p_clinic_ids, p_kind) c
   where c.turma_aberta is null
     and (p_only is null
          or (c.user_id::text || ':' || c.role::text) = any(p_only));

  get diagnostics v_n = row_count;

  if v_n = 0 then
    raise exception 'NOBODY_TO_ENROLL';
  end if;

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

revoke execute on function public.open_training_campaign(uuid[], text, text, text[], text, date, boolean) from public, anon, authenticated;
grant execute on function public.open_training_campaign(uuid[], text, text, text[], text, date, boolean) to authenticated, service_role;

-- =============================================================================
-- 0275 — UMA TURMA PARA VÁRIAS UNIDADES (ou para a rede toda)
-- -----------------------------------------------------------------------------
-- Ordem do dono (26/09/2026):
--
--   *"Deve ter como selecionar para a rede toda (pois quando tiver 200 unidades
--   selecionar 1 por vez será um trabalhão) ou ter a possibilidade de
--   selecionar mais de uma unidade, por exemplo no meio de 200 apenas as 15
--   que foram selecionadas deverão fazer o treinamento ou reciclagem."*
--
-- O QUE MUDA: a turma deixa de ter UMA unidade e passa a ter uma LISTA
-- (`training_campaign_units`). "Rede toda" é a lista com todas as unidades
-- ativas — gravada unidade por unidade, e não como uma bandeira "vale para
-- todas". A diferença importa: unidade inaugurada DEPOIS de a turma abrir não
-- entra nela sozinha. Quem é convocado é quem existia no dia da convocação;
-- uma turma que crescesse sozinha convocaria gente que ninguém viu na prévia.
--
-- O QUE NÃO MUDA:
--   * A LIBERAÇÃO COLETIVA CONTINUA POR UNIDADE (decisão da 0272). Uma turma
--     da rede toda NÃO faz Cambé esperar Londrina: cada unidade abre quando o
--     seu grupo cumprir. Por isso a matrícula passa a guardar a unidade.
--   * UMA TURMA ABERTA POR UNIDADE. Unidade que já está numa turma aberta não
--     entra em outra até aquela encerrar — senão a pessoa teria duas missões e
--     nenhuma resposta sobre qual libera o quê.
--
-- ⚠️ A MATRÍCULA PASSA A SER POR (PESSOA, FUNÇÃO), não só por pessoa. Com
-- várias unidades, a mesma pessoa pode aparecer como recepcionista numa e
-- gerente noutra — e a certificação é POR FUNÇÃO (0273). A restrição antiga,
-- uma matrícula por pessoa, faria a abertura da turma FALHAR para a rede
-- inteira por causa de uma pessoa só. A mesma função em duas unidades continua
-- sendo UMA missão: a pessoa aprende a função uma vez.
--
-- ⚠️ E FECHA UMA BRECHA DA 0273. `training_candidates` era `security definer`
-- e liberada para qualquer usuário logado, SEM guarda: pela API, qualquer um
-- podia listar nome, função e situação de certificação da equipe de qualquer
-- unidade — passando por cima da régua `can_see_staff` que a tela de
-- Risartanos respeita. Agora só o Admin Master pergunta.
--
-- Idempotente.
-- =============================================================================

-- 1) As unidades da turma -----------------------------------------------------
create table if not exists public.training_campaign_units (
  campaign_id uuid not null references public.training_campaigns (id) on delete cascade,
  clinic_id uuid not null references public.clinics (id),
  primary key (campaign_id, clinic_id)
);

create index if not exists training_campaign_units_clinic_idx
  on public.training_campaign_units (clinic_id);

alter table public.training_campaign_units enable row level security;

drop policy if exists training_campaign_units_select on public.training_campaign_units;
create policy training_campaign_units_select on public.training_campaign_units
  for select to authenticated using (true);

-- 2) A turma: a unidade única vira histórico; "rede toda" fica registrado -----
-- `clinic_id` NÃO é apagado (nada se apaga): turmas abertas antes desta
-- migração continuam com ele, e são copiadas para a lista logo abaixo. As
-- novas nascem com ele nulo — a lista é a única fonte.
alter table public.training_campaigns alter column clinic_id drop not null;

alter table public.training_campaigns
  add column if not exists whole_network boolean not null default false;

comment on column public.training_campaigns.clinic_id is
  'Só de turmas abertas antes da 0275. As unidades moram em training_campaign_units.';

insert into public.training_campaign_units (campaign_id, clinic_id)
select id, clinic_id from public.training_campaigns
 where clinic_id is not null
on conflict do nothing;

-- 3) A matrícula guarda a unidade e passa a ser por (pessoa, função) ----------
alter table public.training_enrollments
  add column if not exists clinic_id uuid references public.clinics (id);

update public.training_enrollments e
   set clinic_id = c.clinic_id
  from public.training_campaigns c
 where c.id = e.campaign_id
   and e.clinic_id is null
   and c.clinic_id is not null;

alter table public.training_enrollments
  drop constraint if exists training_enrollments_campaign_id_user_id_key;

create unique index if not exists training_enrollments_campaign_user_role_key
  on public.training_enrollments (campaign_id, user_id, role);

create index if not exists training_enrollments_campaign_clinic_idx
  on public.training_enrollments (campaign_id, clinic_id);

-- 4) QUEM ENTRARIA — agora para uma lista de unidades, e só para o Admin ------
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
  ja_certificado boolean
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
    -- A MESMA FUNÇÃO EM DUAS UNIDADES É UMA MISSÃO SÓ: `distinct on` fica com
    -- uma linha por (pessoa, função), presa à primeira unidade pela ordem do
    -- id — ordem fixa, para a mesma lista dar sempre a mesma resposta.
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
    )
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

revoke all on function public.training_candidates_multi(uuid[], text) from public;
grant execute on function public.training_candidates_multi(uuid[], text) to authenticated;

-- A versão de uma unidade só vira casca da de várias: uma regra, não duas.
-- (Guarda copiada solta vira duas versões da mesma régua — §8d, 0227.)
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

revoke all on function public.training_candidates(uuid, text) from public;
grant execute on function public.training_candidates(uuid, text) to authenticated;

-- 5) ABRIR A TURMA — várias unidades --------------------------------------------
drop function if exists public.open_training_campaign(uuid, text, text, uuid[], text, date);

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

  -- Toda unidade pedida tem de existir e estar ativa. Unidade inexistente na
  -- lista viraria uma linha órfã que nenhuma tela saberia mostrar.
  if exists (
    select 1 from unnest(p_clinic_ids) as u(id)
     where not exists (
       select 1 from public.clinics c where c.id = u.id and c.is_active
     )
  ) then
    raise exception 'UNKNOWN_UNIT';
  end if;

  -- Uma turma aberta por unidade. A tela já desabilita essas unidades; esta é
  -- a trava de verdade, para quando duas pessoas abrirem turma ao mesmo tempo.
  if exists (
    select 1
      from public.training_campaign_units u
      join public.training_campaigns c on c.id = u.campaign_id
     where c.status = 'aberta'
       and u.clinic_id = any(p_clinic_ids)
  ) then
    raise exception 'CAMPAIGN_ALREADY_OPEN';
  end if;

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

  -- `p_only` são pares "pessoa:função", porque a mesma pessoa pode estar na
  -- lista com duas funções — e o Admin pode querer convocar só uma delas.
  insert into public.training_enrollments (campaign_id, user_id, role, clinic_id)
  select v_id, c.user_id, c.role, c.clinic_id
    from public.training_candidates_multi(p_clinic_ids, p_kind) c
   where p_only is null
      or (c.user_id::text || ':' || c.role::text) = any(p_only);

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

revoke all on function public.open_training_campaign(uuid[], text, text, text[], text, date, boolean) from public;
grant execute on function public.open_training_campaign(uuid[], text, text, text[], text, date, boolean) to authenticated;

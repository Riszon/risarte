-- =============================================================================
-- 0412 — CERTIFICAÇÃO: APROVEITAR AS TAREFAS DE OUTRA CERTIFICAÇÃO (AP172)
--
-- Pedido do dono no OC-00016 (16/11/2026): ao convocar quem já tem outra
-- certificação, "revisar se a pessoa tem a necessidade de fazer todas as
-- tarefas ou selecionar somente tarefas diferentes da outra certificação".
--
-- A missão conta o que a PESSOA fez, sem olhar a função: quem faz duas
-- missões ao mesmo tempo já não repete nada. O que faltava era quem JÁ É
-- CERTIFICADO numa função e é convocado para outra — o marco (0273) zera a
-- janela, e as tarefas em comum tinham de ser refeitas.
--
-- Decisões do dono (16/11/2026, "como recomendado"):
--   D1. O Admin escolhe, PESSOA POR PESSOA, na convocação: "missão completa"
--       (padrão) ou "só as tarefas diferentes".
--   D2. A tarefa só é aproveitada quando a outra certificação EXIGIU pelo
--       menos o mesmo número (o mínimo guardado no retrato do certificado).
--   D3. Só em turma de NOVATOS. Reciclagem existe porque o sistema mudou.
--   D4. Só de certificação JÁ OBTIDA (o retrato do certificado é a prova).
--
-- O aproveitamento é CONGELADO na convocação (`reused_items`): mudar metas
-- ou certificados depois não muda a missão de quem já foi convocado.
--
-- Nada apaga dado. Idempotente.
-- =============================================================================

-- 1) O que foi aproveitado, na matrícula -----------------------------------------
alter table public.training_enrollments
  add column if not exists reused_items jsonb not null default '[]'::jsonb;

comment on column public.training_enrollments.reused_items is
  'Tarefas aproveitadas de outra certificação na convocação (0412, AP172): [{chave, role, certified_at, minimo, feito}]. Vazio = missão completa.';

-- 2) A regra: quais tarefas desta função podem ser aproveitadas -----------------
-- Interna (sem guarda): só as funções abaixo chamam.
create or replace function public._training_reusable_items(
  p_user uuid,
  p_role public.user_role
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(x.item order by x.chave), '[]'::jsonb)
    from (
      select distinct on (r.indicator)
             r.indicator as chave,
             jsonb_build_object(
               'chave', r.indicator,
               'role', c.role,
               'certified_at', c.certified_at,
               'minimo', (i ->> 'minimo')::int,
               'feito', (i ->> 'feito')::int
             ) as item
        from public.training_requirements r
        join public.training_certifications c
          on c.user_id = p_user
         and c.role <> p_role
        cross join lateral jsonb_array_elements(
          case when jsonb_typeof(c.snapshot -> 'itens') = 'array'
               then c.snapshot -> 'itens' else '[]'::jsonb end
        ) as i
       where r.role = p_role
         and r.minimum_count > 0
         and i ->> 'chave' = r.indicator
         and jsonb_typeof(i -> 'minimo') = 'number'
         and jsonb_typeof(i -> 'feito') = 'number'
         -- D2: a outra certificação exigiu pelo menos o mesmo número…
         and (i ->> 'minimo')::int >= r.minimum_count
         -- …e a pessoa cumpriu lá.
         and (i ->> 'feito')::int >= (i ->> 'minimo')::int
       order by r.indicator, (i ->> 'feito')::int desc, c.certified_at desc
    ) x;
$$;

revoke execute on function public._training_reusable_items(uuid, public.user_role) from public, anon, authenticated;

-- 3) A prévia: o que daria para aproveitar, por pessoa (só o Admin) -------------
create or replace function public.training_reuse_preview(
  p_clinic_ids uuid[],
  p_kind text
)
returns table (
  user_id uuid,
  role public.user_role,
  items jsonb
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

  -- D3: reciclagem não aproveita nada.
  if p_kind is distinct from 'novatos' then
    return;
  end if;

  return query
  select c.user_id, c.role, public._training_reusable_items(c.user_id, c.role)
    from public.training_candidates_multi(p_clinic_ids, p_kind) c
   where public._training_reusable_items(c.user_id, c.role) <> '[]'::jsonb;
end;
$$;

revoke execute on function public.training_reuse_preview(uuid[], text) from public, anon, authenticated;
grant execute on function public.training_reuse_preview(uuid[], text) to authenticated, service_role;

-- 4) Abrir turma: quem o Admin marcou como "só as diferentes" -------------------
-- Parâmetro novo (`p_reduced`, pares "pessoa:função") → drop + create.
drop function if exists public.open_training_campaign(uuid[], text, text, text[], text, date, boolean);

create or replace function public.open_training_campaign(
  p_clinic_ids uuid[],
  p_kind text,
  p_note text default null,
  p_only text[] default null,
  p_access_policy text default 'mantem',
  p_deadline date default null,
  p_whole_network boolean default false,
  p_reduced text[] default null
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

  -- D3: aproveitar tarefas só em turma de novatos.
  if p_kind <> 'novatos' and coalesce(array_length(p_reduced, 1), 0) > 0 then
    raise exception 'REUSE_ONLY_FOR_NEWCOMERS';
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

  insert into public.training_enrollments (campaign_id, user_id, role, clinic_id, reused_items)
  select v_id, c.user_id, c.role, c.clinic_id,
         case
           when p_kind = 'novatos'
            and (c.user_id::text || ':' || c.role::text) = any(coalesce(p_reduced, '{}'::text[]))
           then public._training_reusable_items(c.user_id, c.role)
           else '[]'::jsonb
         end
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

revoke execute on function public.open_training_campaign(uuid[], text, text, text[], text, date, boolean, text[]) from public, anon, authenticated;
grant execute on function public.open_training_campaign(uuid[], text, text, text[], text, date, boolean, text[]) to authenticated, service_role;

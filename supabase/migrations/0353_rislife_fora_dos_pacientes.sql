-- 0353 — O CONSULTOR RISLIFE FICA FORA DOS PACIENTES (AP95, decisão do dono, 03/11/2026)
--
-- O Consultor RisLife faz o contato e a venda do programa às empresas. Ele é
-- da Franqueadora, e o papel dele lá tinha escopo "todas as unidades": por
-- isso `user_full_access_clinic_ids()` entregava a ele TODAS as unidades, e
-- com elas cadastro, agenda, anamnese, prontuário, planos, negociações,
-- vendas e parcelas de todos os pacientes (medido no treino: 100%).
--
-- A regra do dono: ele tem acesso só ao Empresarial. Quando titulares e
-- dependentes vão às unidades, ele não acompanha; sabe se usam o programa
-- pelos relatórios do Empresarial (entrega seguinte, migração 1039).
--
-- O que muda:
--   1. `user_full_access_clinic_ids()` deixa de contar o papel
--      `rislife_consultant` (direto e pelo escopo da Franqueadora). Quem tem
--      OUTRO papel continua com o acesso desse papel. As ~130 regras e as
--      funções que leem essa função obedecem sem ser reescritas.
--   2. O que NÃO é dado de paciente continua: a equipe (Risartanos,
--      certificação, ambientes) e o chat. Essas seis funções passam a ler
--      `user_staff_scope_clinic_ids()`, cópia da regra de antes (com o
--      RisLife). O texto delas é o do banco, só com a chamada trocada.
--
-- O que NÃO muda: o schema `empresarial` (as 34 tabelas seguem iguais para
-- ele — medido) e a assinatura (pacote de empresa fica na Franqueadora, onde
-- ele tem papel direto; pacote de paciente já não era dele). O Indica +Risos
-- deixa de mostrar a ele as indicações (são de pacientes); nenhum arquivo do
-- Indica foi mexido. Na produção, em 03/11/2026, ninguém tinha esse papel.
--
-- Idempotente: só `create or replace`.

-- 1. A equipe que a pessoa enxerga: a regra de sempre, com o RisLife.
CREATE OR REPLACE FUNCTION public.user_staff_scope_clinic_ids()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  -- Direct non-dentist roles (unit staff, franchisor staff at the matriz)
  select ucr.clinic_id
  from public.user_clinic_roles ucr
  where ucr.user_id = (select auth.uid())
    and ucr.role <> 'dentist'
  union
  -- Franchisor scope 'all' → every active franchise unit
  select c.id
  from public.clinics c
  where c.type = 'franchise_unit'
    and exists (
      select 1
      from public.user_clinic_roles ucr
      join public.clinics fc on fc.id = ucr.clinic_id
      where ucr.user_id = (select auth.uid())
        and fc.type = 'franchisor'
        and ucr.unit_scope = 'all'
    )
  union
  -- Franchisor scope 'specific' → the listed units
  select rua.clinic_id
  from public.role_unit_access rua
  join public.user_clinic_roles ucr on ucr.id = rua.user_clinic_role_id
  where ucr.user_id = (select auth.uid())
    and ucr.unit_scope = 'specific';
$function$;


revoke execute on function public.user_staff_scope_clinic_ids() from public, anon, authenticated;
grant execute on function public.user_staff_scope_clinic_ids() to authenticated;

-- 2. Acesso às unidades: sem o papel de Consultor RisLife.
create or replace function public.user_full_access_clinic_ids()
returns setof uuid
language sql
stable
security definer
set search_path to ''
as $function$
  -- Papéis diretos que não são dentista nem Consultor RisLife (0353).
  select ucr.clinic_id
  from public.user_clinic_roles ucr
  where ucr.user_id = (select auth.uid())
    and ucr.role not in ('dentist', 'rislife_consultant')
  union
  -- Escopo "todas" da Franqueadora → todas as unidades.
  select c.id
  from public.clinics c
  where c.type = 'franchise_unit'
    and exists (
      select 1
      from public.user_clinic_roles ucr
      join public.clinics fc on fc.id = ucr.clinic_id
      where ucr.user_id = (select auth.uid())
        and fc.type = 'franchisor'
        and ucr.unit_scope = 'all'
        and ucr.role <> 'rislife_consultant'
    )
  union
  -- Escopo "específicas" → as unidades da lista.
  select rua.clinic_id
  from public.role_unit_access rua
  join public.user_clinic_roles ucr on ucr.id = rua.user_clinic_role_id
  where ucr.user_id = (select auth.uid())
    and ucr.unit_scope = 'specific'
    and ucr.role <> 'rislife_consultant';
$function$;

-- 3. A equipe e o chat seguem a regra de antes.

-- public.can_see_staff(uuid,uuid): a mesma função, lendo a equipe (com o RisLife).
CREATE OR REPLACE FUNCTION public.can_see_staff(p_clinic_id uuid, p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.is_admin_master()
    or p_clinic_id in (select public.user_staff_scope_clinic_ids())
    or (p_user_id is not null and exists (
      select 1 from public.user_clinic_roles ucr
      where ucr.user_id = p_user_id
        and ucr.clinic_id in (select public.user_staff_scope_clinic_ids())
    ));
$function$;

-- public.can_access_chat_channel(uuid): a mesma função, lendo a equipe (com o RisLife).
CREATE OR REPLACE FUNCTION public.can_access_chat_channel(p_channel_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1 from public.chat_channels c
    where c.id = p_channel_id and (
      public.is_admin_master()
      or (
        c.kind = 'unit' and (
          c.clinic_id in (select public.user_clinic_ids())
          or c.clinic_id in (select public.user_staff_scope_clinic_ids())
        )
      )
      or (
        c.kind = 'direct' and exists (
          select 1 from public.chat_channel_members m
          where m.channel_id = c.id and m.user_id = (select auth.uid())
        )
      )
    )
  );
$function$;

-- public.chat_can_dm(uuid): a mesma função, lendo a equipe (com o RisLife).
CREATE OR REPLACE FUNCTION public.chat_can_dm(p_other uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select
    public.is_admin_master()
    -- mesma unidade (compartilham clínica) → sempre.
    or exists (
      select 1 from public.user_clinic_roles a
      join public.user_clinic_roles b on a.clinic_id = b.clinic_id
      where a.user_id = (select auth.uid()) and b.user_id = p_other
    )
    -- franqueadora → unidade (eu franqueadora, escopo cobre a unidade do outro).
    or exists (
      select 1
      from public.user_clinic_roles cf
      join public.clinics ccf on ccf.id = cf.clinic_id and ccf.type = 'franchisor'
      join public.user_clinic_roles ou on ou.user_id = p_other
      join public.clinics cou on cou.id = ou.clinic_id and cou.type = 'franchise_unit'
      where cf.user_id = (select auth.uid())
        and ou.clinic_id in (select public.user_staff_scope_clinic_ids())
        and public.chat_cross_level_allowed(cf.role, ou.role)
    )
    -- unidade → franqueadora (eu unidade, o outro franqueadora).
    or exists (
      select 1
      from public.user_clinic_roles cu
      join public.clinics ccu on ccu.id = cu.clinic_id and ccu.type = 'franchise_unit'
      join public.user_clinic_roles ofr on ofr.user_id = p_other
      join public.clinics cof on cof.id = ofr.clinic_id and cof.type = 'franchisor'
      where cu.user_id = (select auth.uid())
        and public.chat_cross_level_allowed(ofr.role, cu.role)
    );
$function$;

-- public.chat_contacts(): a mesma função, lendo a equipe (com o RisLife).
CREATE OR REPLACE FUNCTION public.chat_contacts()
 RETURNS TABLE(user_id uuid, full_name text, role text, unit_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with cand as (
    select b.user_id
    from public.user_clinic_roles a
    join public.user_clinic_roles b on a.clinic_id = b.clinic_id
    where a.user_id = (select auth.uid()) and b.user_id <> (select auth.uid())
    union
    select ou.user_id
    from public.user_clinic_roles cf
    join public.clinics ccf on ccf.id = cf.clinic_id and ccf.type = 'franchisor'
    join public.user_clinic_roles ou on ou.user_id <> (select auth.uid())
    join public.clinics cou on cou.id = ou.clinic_id and cou.type = 'franchise_unit'
    where cf.user_id = (select auth.uid())
      and ou.clinic_id in (select public.user_staff_scope_clinic_ids())
      and public.chat_cross_level_allowed(cf.role, ou.role)
    union
    select ofr.user_id
    from public.user_clinic_roles cu
    join public.clinics ccu on ccu.id = cu.clinic_id and ccu.type = 'franchise_unit'
    join public.user_clinic_roles ofr on ofr.user_id <> (select auth.uid())
    join public.clinics cof on cof.id = ofr.clinic_id and cof.type = 'franchisor'
    where cu.user_id = (select auth.uid())
      and public.chat_cross_level_allowed(ofr.role, cu.role)
    union
    select p2.id
    from public.profiles p2
    where public.is_admin_master() and p2.id <> (select auth.uid())
  )
  select distinct on (c.user_id)
    c.user_id, p.full_name, ucr.role::text, cl.name
  from (select distinct user_id from cand) c
  join public.profiles p on p.id = c.user_id
  left join public.user_clinic_roles ucr on ucr.user_id = c.user_id
  left join public.clinics cl on cl.id = ucr.clinic_id
  order by c.user_id, cl.type nulls last;
$function$;

-- public.chat_my_channel_ids(): a mesma função, lendo a equipe (com o RisLife).
CREATE OR REPLACE FUNCTION public.chat_my_channel_ids()
 RETURNS TABLE(channel_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  -- Canais das minhas equipes (unidades onde tenho função).
  select c.id
  from public.chat_channels c
  where c.kind = 'unit'
    and c.clinic_id in (select public.user_clinic_ids())
  union
  -- Unidades sob responsabilidade da franqueadora (Admin escolhe a unidade, por
  -- isso não entra automaticamente aqui).
  select c.id
  from public.chat_channels c
  where c.kind = 'unit'
    and not public.is_admin_master()
    and c.clinic_id in (select public.user_staff_scope_clinic_ids())
  union
  -- Conversas diretas em que sou membro.
  select m.channel_id
  from public.chat_channel_members m
  where m.user_id = (select auth.uid())
  union
  -- Qualquer canal já aberto por mim (ex.: unidade que o Admin abriu).
  select r.channel_id
  from public.chat_reads r
  where r.user_id = (select auth.uid());
$function$;

-- public.ensure_unit_chat_channel(uuid): a mesma função, lendo a equipe (com o RisLife).
CREATE OR REPLACE FUNCTION public.ensure_unit_chat_channel(p_clinic_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id uuid;
begin
  if not (
    public.is_admin_master()
    or p_clinic_id in (select public.user_clinic_ids())
    or p_clinic_id in (select public.user_staff_scope_clinic_ids())
  ) then
    raise exception 'NOT_ALLOWED';
  end if;
  select id into v_id from public.chat_channels
  where kind = 'unit' and clinic_id = p_clinic_id;
  if v_id is null then
    insert into public.chat_channels (kind, clinic_id, created_by)
    values ('unit', p_clinic_id, (select auth.uid()))
    returning id into v_id;
  end if;
  return v_id;
end $function$;

-- Conferência (rodar e olhar): 1 · true · 6 · false
select
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'user_staff_scope_clinic_ids') as funcao_da_equipe,
  (pg_get_functiondef('public.user_full_access_clinic_ids()'::regprocedure) like '%rislife_consultant%') as acesso_exclui_rislife,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('can_see_staff', 'can_access_chat_channel', 'chat_can_dm',
                        'chat_contacts', 'chat_my_channel_ids', 'ensure_unit_chat_channel')
      and pg_get_functiondef(p.oid) like '%user_staff_scope_clinic_ids()%') as funcoes_da_equipe,
  has_function_privilege('anon', 'public.user_staff_scope_clinic_ids()', 'execute') as sem_login_executa;

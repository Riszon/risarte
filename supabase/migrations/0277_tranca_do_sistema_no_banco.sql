-- =============================================================================
-- 0277 — A TRANCA DO SISTEMA REAL PASSA A VALER NO BANCO (AP14)
-- -----------------------------------------------------------------------------
-- A 0276 fechou as unidades no caminho das TELAS. Provado no treino em
-- 26/09/2026, antes desta migração: uma pessoa com a unidade A fechada, falando
-- com o banco direto (como a API faria com o token dela), LIA a cliente de A —
-- e o banco dizia que ela "tinha função" lá. O dono mandou corrigir em seguida.
--
-- ⚠️ POR QUE UMA "JANELA" (VIEW) E NÃO REESCREVER AS FUNÇÕES.
-- 70 funções do banco leem `user_clinic_roles` direto, e 40 delas conferem a
-- função de QUEM CHAMA ali mesmo, sem passar pelas funções-base. Reescrever as
-- 40 seria 40 chances de quebrar uma ação do sistema. E o atalho óbvio — a
-- tabela se proteger sozinha — não funciona: as funções rodam como `postgres`,
-- que ignora as regras de segurança por natureza (conferido no banco).
--
-- Então: a tabela passa a se chamar `user_clinic_roles_all`, e no lugar dela,
-- com o MESMO nome, fica uma janela que esconde — só para as perguntas sobre
-- QUEM ESTÁ CHAMANDO — as funções das unidades fechadas para essa pessoa. Todo
-- código que lê `user_clinic_roles` (as 70 funções, as ~130 regras de
-- segurança, o app) passa a obedecer sem ser tocado.
--
--   * O Admin olhando a ficha de alguém vê TODAS as funções dela (o filtro só
--     vale para "eu", nunca para "o outro").
--   * Rotina agendada (sem usuário, `auth.uid()` nulo) vê tudo, como antes.
--   * Admin Master nunca tem unidade fechada.
--   * No TREINO a lista de fechadas fica sempre vazia (`is_mirror_db`).
--
-- ⚠️ A LISTA DE FECHADAS É GUARDADA, NÃO CALCULADA NA HORA. A janela é lida em
-- quase toda consulta, às vezes linha por linha; a regra da 0276 consulta
-- metas, certificados e turmas, pesada demais para isso. `system_closed_clinics`
-- é recalculada pelo próprio banco quando algo que a regra lê muda (gatilhos
-- no fim desta migração). Guarda as FECHADAS porque fechado é a exceção.
--
-- ⚠️ DAQUI EM DIANTE, migração que mexe na ESTRUTURA da tabela de funções
-- (gatilho, política, coluna, índice) usa `user_clinic_roles_all`.
-- `check-migrations` reprova `alter table / create trigger / create policy`
-- em `public.user_clinic_roles`. Ler e gravar dados continua pelo nome de
-- sempre.
--
-- COMO DESFAZER, se algo sair errado na produção (rodar no SQL Editor):
--   drop view if exists public.user_clinic_roles;
--   alter table public.user_clinic_roles_all rename to user_clinic_roles;
-- Isso devolve o banco ao estado da 0276 (a tranca volta a valer só nas
-- telas). A tabela `system_closed_clinics` pode ficar: sem a janela, ninguém
-- a lê.
--
-- Idempotente. Não apaga dado de ninguém: a única coisa que se apaga aqui são
-- linhas da lista DERIVADA de fechadas, que é recalculada a partir da regra.
-- =============================================================================

-- 1) A lista de unidades fechadas por pessoa ---------------------------------
create table if not exists public.system_closed_clinics (
  user_id uuid not null references public.profiles (id) on delete cascade,
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  primary key (user_id, clinic_id)
);

comment on table public.system_closed_clinics is
  'DERIVADA da regra da 0276: unidades onde o sistema real está fechado para a pessoa. Recalculada por gatilho; nunca se escreve à mão (0277).';

alter table public.system_closed_clinics enable row level security;

drop policy if exists system_closed_clinics_select on public.system_closed_clinics;
create policy system_closed_clinics_select on public.system_closed_clinics
  for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin_master());
-- Sem policy de escrita: só a função de recálculo escreve.

grant select on public.system_closed_clinics to authenticated;

-- 2) A tabela vira `_all`, e a janela toma o nome dela -----------------------
do $$
begin
  if exists (
    select 1 from pg_class
     where relname = 'user_clinic_roles'
       and relnamespace = 'public'::regnamespace
       and relkind = 'r'
  ) then
    alter table public.user_clinic_roles rename to user_clinic_roles_all;
  end if;
end $$;

-- `security_invoker`: quem consulta pela API continua sujeito às regras de
-- segurança da tabela (sem isso, a janela rodaria como dona e entregaria as
-- funções de todo mundo a qualquer logado).
create or replace view public.user_clinic_roles
with (security_invoker = true) as
  select *
    from public.user_clinic_roles_all r
   where r.user_id is distinct from auth.uid()
      or not exists (
        select 1 from public.system_closed_clinics c
         where c.user_id = r.user_id
           and c.clinic_id = r.clinic_id
      );

comment on view public.user_clinic_roles is
  'Janela sobre user_clinic_roles_all que esconde, de QUEM CHAMA, as funções das unidades fechadas para ela (0277). Estrutura (gatilho, política, coluna) mexe-se em user_clinic_roles_all.';

-- A janela não herda os valores padrão da tabela: sem isto, gravar uma função
-- nova pela janela falharia por falta de id.
alter view public.user_clinic_roles alter column id set default gen_random_uuid();
alter view public.user_clinic_roles alter column created_at set default now();

grant select, insert, update, delete on public.user_clinic_roles to anon, authenticated, service_role;

-- As duas regras de segurança que liam a tabela pelo nome passam a ler pela
-- janela (uma política guarda a tabela que leu quando foi criada).
drop policy if exists supplier_item_links_write on public.supplier_item_links;
create policy supplier_item_links_write on public.supplier_item_links
  for all to authenticated
  using (
    public.is_admin_master() or public.is_finance_franchisor() or exists (
      select 1 from public.user_clinic_roles r
       where r.user_id = (select auth.uid()) and r.role = 'unit_manager'::public.user_role
    )
  )
  with check (
    public.is_admin_master() or public.is_finance_franchisor() or exists (
      select 1 from public.user_clinic_roles r
       where r.user_id = (select auth.uid()) and r.role = 'unit_manager'::public.user_role
    )
  );

drop policy if exists role_unit_access_select on public.role_unit_access;
create policy role_unit_access_select on public.role_unit_access
  for select to authenticated
  using (
    public.is_admin_master() or exists (
      select 1 from public.user_clinic_roles ucr
       where ucr.id = role_unit_access.user_clinic_role_id
         and ucr.user_id = (select auth.uid())
    )
  );

-- 3) A regra, sem guarda, lendo a TABELA (não a janela) ----------------------
-- A regra precisa ver as funções fechadas — é justamente delas que ela fala.
-- Lendo a janela, a pessoa perguntando sobre si mesma não veria as próprias
-- unidades fechadas, e o Início não teria o que explicar.
drop function if exists public._system_access_raw(uuid);
create or replace function public._system_access_raw(p_user_id uuid)
returns table (clinic_id uuid, clinic_name text, role public.user_role, allowed boolean, reason text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_admin boolean;
  v_porta boolean;
  v_coletiva boolean;
begin
  select coalesce(p.is_admin_master, false) into v_admin
    from public.profiles p where p.id = p_user_id;
  v_porta := public.environment_allowed(p_user_id, 'sistema');
  select (ts.release_scope = 'coletiva') into v_coletiva
    from public.training_settings ts;

  return query
  select
    ucr.clinic_id,
    cl.name,
    ucr.role,
    case
      when coalesce(v_admin, false) then true
      when not v_porta then false
      when sca.user_id is not null then true
      when not exists (select 1 from public.training_requirements tr where tr.role = ucr.role) then true
      when cert.ok and not grupo.pendente then true
      else false
    end,
    case
      when coalesce(v_admin, false) then 'admin_master'
      when not v_porta then 'sistema_fechado'
      when sca.user_id is not null then sca.source
      when not exists (select 1 from public.training_requirements tr where tr.role = ucr.role) then 'sem_metas'
      when cert.ok and grupo.pendente then 'aguardando_grupo'
      when cert.ok then 'certificado'
      else 'aguardando_missao'
    end
  from public.user_clinic_roles_all ucr
  join public.clinics cl on cl.id = ucr.clinic_id
  left join public.system_clinic_access sca
         on sca.user_id = ucr.user_id
        and sca.clinic_id = ucr.clinic_id
        and sca.role = ucr.role
        and sca.revoked_at is null
  cross join lateral (
    select exists (
      select 1 from public.training_certifications c
       where c.user_id = ucr.user_id and c.role = ucr.role
    ) as ok
  ) cert
  cross join lateral (
    select coalesce(v_coletiva, false) and exists (
      select 1
        from public.training_enrollments e
        join public.training_campaigns tc on tc.id = e.campaign_id
       where e.clinic_id = ucr.clinic_id
         and tc.status = 'aberta'
         and tc.kind = 'novatos'
         and e.status <> 'dispensado'
         and not exists (
           select 1 from public.training_certifications c2
            where c2.user_id = e.user_id
              and c2.role = e.role
              and c2.certified_at >= e.invited_at
         )
    ) as pendente
  ) grupo
  where ucr.user_id = p_user_id;
end;
$$;

-- Sem guarda: NINGUÉM de fora chama. Só as funções abaixo.
revoke all on function public._system_access_raw(uuid) from public;

-- A porta pública: a mesma guarda da 0276, agora com o nome da unidade (a
-- tela precisa dele, e a pessoa não enxerga a unidade fechada na lista).
drop function if exists public.system_access_by_clinic(uuid);
create or replace function public.system_access_by_clinic(p_user_id uuid)
returns table (clinic_id uuid, clinic_name text, role public.user_role, allowed boolean, reason text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  -- ⚠️ `is distinct from`, nunca `<>` (AP9).
  if p_user_id is distinct from auth.uid()
     and not public.is_admin_master()
     and not exists (
       select 1 from public.staff_members s
        where s.user_id = p_user_id
          and public.can_see_staff(s.clinic_id, s.user_id)
     ) then
    raise exception 'NOT_ALLOWED';
  end if;

  return query select * from public._system_access_raw(p_user_id);
end;
$$;

revoke all on function public.system_access_by_clinic(uuid) from public;
grant execute on function public.system_access_by_clinic(uuid) to authenticated;

comment on function public.system_access_by_clinic(uuid) is
  'Para cada (unidade, função) da pessoa: o sistema real está aberto ali, e por quê. A régua única da tranca por unidade (0276/0277).';

-- `grant_clinic_access` lê a função da pessoa na unidade: pela TABELA, para o
-- Admin conseguir liberar exatamente a unidade que está fechada.
create or replace function public.grant_clinic_access(
  p_user_id uuid,
  p_clinic_id uuid,
  p_note text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.user_role;
begin
  if not public.is_admin_master() then
    raise exception 'NOT_ALLOWED';
  end if;
  if length(btrim(coalesce(p_note, ''))) = 0 then
    raise exception 'NOTE_REQUIRED';
  end if;

  select ucr.role into v_role
    from public.user_clinic_roles_all ucr
   where ucr.user_id = p_user_id and ucr.clinic_id = p_clinic_id;
  if v_role is null then
    raise exception 'NO_ROLE_IN_CLINIC';
  end if;

  insert into public.system_clinic_access
    (user_id, clinic_id, role, source, note, granted_by)
  values (p_user_id, p_clinic_id, v_role, 'manual', btrim(p_note), auth.uid())
  on conflict (user_id, clinic_id, role) do update
    set source = 'manual',
        note = excluded.note,
        granted_at = now(),
        granted_by = excluded.granted_by,
        revoked_at = null,
        revoked_by = null;
end;
$$;

revoke all on function public.grant_clinic_access(uuid, uuid, text) from public;
grant execute on function public.grant_clinic_access(uuid, uuid, text) to authenticated;

-- 4) O recálculo --------------------------------------------------------------
create or replace function public.refresh_system_closed(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_id is null then
    return;
  end if;
  delete from public.system_closed_clinics where user_id = p_user_id;
  -- No treino não há tranca: lá é onde se pratica.
  if public.is_mirror_db() then
    return;
  end if;
  insert into public.system_closed_clinics (user_id, clinic_id)
  select distinct p_user_id, r.clinic_id
    from public._system_access_raw(p_user_id) r
   where not r.allowed
  on conflict do nothing;
end;
$$;

revoke all on function public.refresh_system_closed(uuid) from public;

create or replace function public.refresh_system_closed_all()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
begin
  -- Quem saiu de todas as unidades não deixa sobra.
  delete from public.system_closed_clinics c
   where not exists (select 1 from public.user_clinic_roles_all r where r.user_id = c.user_id);
  for v_user in select distinct user_id from public.user_clinic_roles_all loop
    perform public.refresh_system_closed(v_user);
  end loop;
end;
$$;

revoke all on function public.refresh_system_closed_all() from public;

-- 5) Os gatilhos: tudo o que a regra lê ---------------------------------------
-- Por pessoa: a função dela, a porta dela, a liberação dela, se é Admin.
create or replace function public.trg_refresh_system_closed_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- (`profiles` tem gatilho próprio: lá a pessoa é `id`, não `user_id`, e
  -- citar um campo que o registro não tem derruba o gatilho na hora.)
  if tg_op in ('UPDATE', 'DELETE') then
    perform public.refresh_system_closed(old.user_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    perform public.refresh_system_closed(new.user_id);
  end if;
  return null;
end;
$$;

create or replace function public.trg_refresh_system_closed_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.refresh_system_closed(new.id);
  return null;
end;
$$;

drop trigger if exists system_closed_on_roles on public.user_clinic_roles_all;
create trigger system_closed_on_roles
  after insert or update or delete on public.user_clinic_roles_all
  for each row execute function public.trg_refresh_system_closed_user();

drop trigger if exists system_closed_on_environments on public.user_environments;
create trigger system_closed_on_environments
  after insert or update or delete on public.user_environments
  for each row execute function public.trg_refresh_system_closed_user();

drop trigger if exists system_closed_on_access on public.system_clinic_access;
create trigger system_closed_on_access
  after insert or update or delete on public.system_clinic_access
  for each row execute function public.trg_refresh_system_closed_user();

drop trigger if exists system_closed_on_admin on public.profiles;
create trigger system_closed_on_admin
  after update of is_admin_master on public.profiles
  for each row execute function public.trg_refresh_system_closed_profile();

-- Para todos: metas, forma de liberação, turmas, matrículas e certificados
-- (a coletiva faz o certificado de um mudar a unidade dos outros). Uma vez por
-- comando, não por linha.
create or replace function public.trg_refresh_system_closed_all()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.refresh_system_closed_all();
  return null;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'training_requirements', 'training_settings', 'training_campaigns',
    'training_enrollments', 'training_certifications'
  ] loop
    execute format('drop trigger if exists system_closed_on_%1$s on public.%1$I', t);
    execute format(
      'create trigger system_closed_on_%1$s after insert or update or delete on public.%1$I
         for each statement execute function public.trg_refresh_system_closed_all()',
      t
    );
  end loop;
end $$;

-- 6) A primeira conta, e o aviso para a API reler a estrutura ------------------
select public.refresh_system_closed_all();

notify pgrst, 'reload schema';

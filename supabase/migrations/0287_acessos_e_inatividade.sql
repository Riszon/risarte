-- =============================================================================
-- 0287 — O REGISTRO DE CADA ACESSO, A INATIVIDADE E O LOGIN POR DIA
-- -----------------------------------------------------------------------------
-- Pedido do dono (09/10/2026): "melhore a auditoria do riSZon (...) tempo de
-- atividade ou inatividade no sistema. O login de cada usuário deve
-- desconectar por inatividade por um tempo sem acesso, ou quando muda a data,
-- ficando registrado cada dia que fez o acesso."
--
-- O QUE SE DESCOBRIU AO MEDIR, antes de construir:
--   * A trilha NUNCA gravou um login. Zero em 283 registros na produção (7
--     contas já tinham entrado) e zero em 1.112 no treino. O registro era
--     disparado junto com a troca de tela e se perdia — a mesma corrida do
--     relato OC-00093.
--   * Não existia saída registrada, tempo de uso, nem fim de sessão: quem
--     deixava o navegador aberto ficava logado indefinidamente.
--
-- DECISÕES DO DONO:
--   * 60 minutos de inatividade como padrão, configurável pelo Admin POR
--     FUNÇÃO;
--   * o acesso vale só para a DATA em que começou: no dia novo, pede login;
--   * gravação de consulta em andamento conta como atividade (não desconecta);
--   * cada acesso guarda o navegador e o endereço de internet (IP).
--
-- COMO FUNCIONA:
--   * `access_sessions` — uma linha por login, amarrada ao identificador da
--     sessão do Supabase que vem DENTRO do token (`session_id`). A pessoa não
--     escolhe esse número, então não consegue mexer no acesso de outra.
--   * Ninguém escreve nessa tabela direto: só as três funções abaixo.
--   * QUEM DECIDE SE O ACESSO VENCEU É O BANCO (`access_session_check`), lido a
--     cada requisição. O aviso na tela é cortesia; a regra mora aqui.
--   * A pessoa com várias funções fica com o tempo MAIS CURTO entre elas — a
--     regra não depende de qual unidade está aberta, e o banco e a tela chegam
--     ao mesmo número.
--
-- Cria duas tabelas e quatro funções. Não altera nem apaga nada do que existe.
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) O REGISTRO DE CADA ACESSO
-- -----------------------------------------------------------------------------
create table if not exists public.access_sessions (
  id uuid primary key default gen_random_uuid(),
  -- A sessão do Supabase (vem no token). Uma linha por sessão.
  auth_session_id uuid not null,
  -- Nulo só se a conta for apagada: o registro do acesso fica.
  user_id uuid references public.profiles (id) on delete set null,
  -- A data civil brasileira em que o acesso começou — é ela que vence à
  -- meia-noite, não o relógio de quem programou.
  access_day date not null,
  -- 'login' = entrou com a senha; 'retomada' = já estava logado quando este
  -- registro passou a existir (ou a sessão veio por link de acesso).
  origin text not null default 'login' check (origin in ('login', 'retomada')),
  started_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  -- Tempo em uso: soma dos intervalos entre dois sinais de atividade seguidos.
  active_seconds integer not null default 0 check (active_seconds >= 0),
  -- Gravação de consulta em andamento: até este instante o acesso não vence.
  protected_until timestamptz,
  ended_at timestamptz,
  end_reason text check (
    end_reason is null or end_reason in ('saiu', 'inatividade', 'virada_do_dia')
  ),
  user_agent text,
  ip text
);

do $$
begin
  alter table public.access_sessions
    add constraint access_sessions_auth_session_key unique (auth_session_id);
exception when duplicate_object or duplicate_table then null;
end $$;

create index if not exists access_sessions_user_day_idx
  on public.access_sessions (user_id, access_day desc);
create index if not exists access_sessions_day_idx
  on public.access_sessions (access_day desc);

alter table public.access_sessions enable row level security;

-- Cada um lê os seus; o Admin Master lê todos. Sem INSERT/UPDATE/DELETE de
-- propósito: registro de acesso que a própria pessoa edita não é registro.
drop policy if exists "access_sessions_select" on public.access_sessions;
create policy "access_sessions_select" on public.access_sessions
  for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin_master());

comment on table public.access_sessions is
  'Um registro por login (0287): dia, início, última atividade, fim e motivo, '
  'tempo em uso, navegador e IP. Só as funções access_session_* escrevem.';

-- -----------------------------------------------------------------------------
-- 2) O TEMPO DE INATIVIDADE, POR FUNÇÃO
-- -----------------------------------------------------------------------------
-- `papel`: '*' = padrão de todos; 'admin_master'; ou uma função (o texto do
-- enum user_role). Função sem linha usa o padrão.
create table if not exists public.access_idle_settings (
  papel text primary key,
  idle_minutes integer not null check (idle_minutes between 5 and 720),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id)
);

insert into public.access_idle_settings (papel, idle_minutes)
values ('*', 60)
on conflict (papel) do nothing;

alter table public.access_idle_settings enable row level security;

drop policy if exists "access_idle_settings_select" on public.access_idle_settings;
create policy "access_idle_settings_select" on public.access_idle_settings
  for select to authenticated using (true);

drop policy if exists "access_idle_settings_admin" on public.access_idle_settings;
create policy "access_idle_settings_admin" on public.access_idle_settings
  for all to authenticated
  using (public.is_admin_master())
  with check (public.is_admin_master());

comment on table public.access_idle_settings is
  'Minutos sem uso até desconectar (0287). papel = ''*'' (padrão), '
  '''admin_master'' ou uma função. Quem tem várias funções fica com o menor.';

-- -----------------------------------------------------------------------------
-- 3) O LIMITE DE UMA PESSOA: o mais curto entre as funções dela
-- -----------------------------------------------------------------------------
-- Lê `user_clinic_roles_all` de propósito: a função conta mesmo na unidade
-- onde o sistema real ainda está fechado para a pessoa (0277).
create or replace function public.access_idle_limit(p_user uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select min(s.idle_minutes)
      from public.access_idle_settings s
      where s.papel in (
              select ucr.role::text
              from public.user_clinic_roles_all ucr
              where ucr.user_id = p_user
            )
         or (
              s.papel = 'admin_master'
              and exists (
                select 1 from public.profiles p
                where p.id = p_user and p.is_admin_master
              )
            )
    ),
    (select s.idle_minutes from public.access_idle_settings s where s.papel = '*'),
    60
  );
$$;

revoke execute on function public.access_idle_limit(uuid)
  from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4) ENCERRAR (uso interno): fecha a linha e grava a saída na trilha
-- -----------------------------------------------------------------------------
create or replace function public.access_session_close(
  p_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
begin
  update public.access_sessions
     set ended_at = now(), end_reason = p_reason
   where id = p_id and ended_at is null
   returning user_id into v_user;
  if not found then
    return;
  end if;
  insert into public.audit_logs (user_id, action, entity_type, entity_id, details)
  values (v_user, 'logout', 'session', p_id::text,
          jsonb_build_object('motivo', p_reason));
end;
$$;

revoke execute on function public.access_session_close(uuid, text)
  from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 5) CONFERIR (a cada requisição): o acesso desta sessão ainda vale?
-- -----------------------------------------------------------------------------
-- Devolve {estado, limite_min, dia}:
--   'ok'            — vale (se não existia registro, acabou de ser criado);
--   'inatividade'   — passou do limite sem uso: foi encerrado AGORA;
--   'virada_do_dia' — o acesso é de outro dia: foi encerrado AGORA;
--   'encerrada'     — já tinha sido encerrado antes;
--   'sem_sessao'    — o token não traz sessão (chave de serviço, anônimo).
--
-- A margem de 2 minutos sobre o limite existe porque a tela avisa e encerra
-- sozinha no limite: sem a folga, um sinal de atividade a caminho perderia a
-- corrida para a conferência.
create or replace function public.access_session_check(
  p_user_agent text default null,
  p_ip text default null,
  p_origin text default 'retomada'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sid uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  v_uid uuid := (select auth.uid());
  v_hoje date := public.today_br();
  v_limite integer;
  v_row public.access_sessions%rowtype;
  v_novo uuid;
  v_origem text := case when p_origin = 'login' then 'login' else 'retomada' end;
begin
  if v_sid is null or v_uid is null then
    return jsonb_build_object('estado', 'sem_sessao');
  end if;
  v_limite := public.access_idle_limit(v_uid);

  select * into v_row
  from public.access_sessions
  where auth_session_id = v_sid;

  if not found then
    insert into public.access_sessions
      (auth_session_id, user_id, access_day, origin, user_agent, ip)
    values
      (v_sid, v_uid, v_hoje, v_origem,
       nullif(left(btrim(coalesce(p_user_agent, '')), 300), ''),
       nullif(left(btrim(coalesce(p_ip, '')), 64), ''))
    on conflict (auth_session_id) do nothing
    returning id into v_novo;
    if v_novo is not null then
      insert into public.audit_logs (user_id, action, entity_type, entity_id, details)
      values (v_uid, 'login', 'session', v_novo::text,
              jsonb_build_object('origem', v_origem));
    end if;
    return jsonb_build_object('estado', 'ok', 'limite_min', v_limite, 'dia', v_hoje);
  end if;

  if v_row.ended_at is not null then
    return jsonb_build_object(
      'estado', 'encerrada',
      'motivo', v_row.end_reason,
      'limite_min', v_limite,
      'dia', v_row.access_day
    );
  end if;

  -- Gravação de consulta em andamento: não vence por nenhum dos dois motivos.
  if v_row.protected_until is null or v_row.protected_until <= now() then
    if v_row.access_day < v_hoje then
      perform public.access_session_close(v_row.id, 'virada_do_dia');
      return jsonb_build_object('estado', 'virada_do_dia', 'limite_min', v_limite, 'dia', v_row.access_day);
    end if;
    if now() - v_row.last_activity_at > make_interval(mins => v_limite + 2) then
      perform public.access_session_close(v_row.id, 'inatividade');
      return jsonb_build_object('estado', 'inatividade', 'limite_min', v_limite, 'dia', v_row.access_day);
    end if;
  end if;

  return jsonb_build_object('estado', 'ok', 'limite_min', v_limite, 'dia', v_row.access_day);
end;
$$;

revoke execute on function public.access_session_check(text, text, text)
  from public, anon, authenticated;
grant execute on function public.access_session_check(text, text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 6) SINAL DE ATIVIDADE (a tela manda quando a pessoa mexe; no máximo 1/min)
-- -----------------------------------------------------------------------------
-- Soma o tempo em uso quando o sinal anterior foi há pouco (até 5 minutos):
-- um intervalo maior que isso é tempo PARADO, não em uso.
--
-- ⚠️ NÃO RESSUSCITA ACESSO VENCIDO. Uma aba esquecida que volta três horas
-- depois manda o sinal no primeiro movimento do mouse — e aqui ela descobre
-- que o acesso acabou, em vez de reabri-lo.
create or replace function public.access_session_touch(p_gravando boolean default false)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sid uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  v_uid uuid := (select auth.uid());
  v_row public.access_sessions%rowtype;
  v_limite integer;
  v_protegido boolean;
begin
  if v_sid is null or v_uid is null then
    return 'sem_sessao';
  end if;
  select * into v_row
  from public.access_sessions
  where auth_session_id = v_sid
  for update;
  if not found then
    return 'sem_registro';
  end if;
  if v_row.ended_at is not null then
    return 'encerrada';
  end if;

  v_protegido := coalesce(p_gravando, false)
    or (v_row.protected_until is not null and v_row.protected_until > now());
  if not v_protegido then
    v_limite := public.access_idle_limit(v_uid);
    if v_row.access_day < public.today_br() then
      perform public.access_session_close(v_row.id, 'virada_do_dia');
      return 'encerrada';
    end if;
    if now() - v_row.last_activity_at > make_interval(mins => v_limite + 2) then
      perform public.access_session_close(v_row.id, 'inatividade');
      return 'encerrada';
    end if;
  end if;

  update public.access_sessions
     set active_seconds = active_seconds + case
           when now() - last_activity_at <= interval '5 minutes'
           then greatest(0, floor(extract(epoch from now() - last_activity_at))::integer)
           else 0
         end,
         last_activity_at = now(),
         protected_until = case
           when coalesce(p_gravando, false) then now() + interval '3 minutes'
           else null
         end
   where id = v_row.id;
  return 'ok';
end;
$$;

revoke execute on function public.access_session_touch(boolean)
  from public, anon, authenticated;
grant execute on function public.access_session_touch(boolean) to authenticated;

-- -----------------------------------------------------------------------------
-- 7) ENCERRAR O PRÓPRIO ACESSO (Sair, ou a tela encerrando por inatividade)
-- -----------------------------------------------------------------------------
create or replace function public.access_session_end(p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sid uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  v_id uuid;
begin
  if v_sid is null then
    return;
  end if;
  if p_reason not in ('saiu', 'inatividade', 'virada_do_dia') then
    raise exception 'INVALID_REASON';
  end if;
  select id into v_id
  from public.access_sessions
  where auth_session_id = v_sid and ended_at is null;
  if v_id is not null then
    perform public.access_session_close(v_id, p_reason);
  end if;
end;
$$;

revoke execute on function public.access_session_end(text)
  from public, anon, authenticated;
grant execute on function public.access_session_end(text) to authenticated;

notify pgrst, 'reload schema';

-- =============================================================================
-- 0365 — A auditoria reconhece a assistente virtual (Rita, Fase 0A.1, parte core)
-- =============================================================================
-- Plano: docs/sdr/PLANO-FASE-0A.md, entrega 0A.1 (decisões DA2 e DA3, aprovadas
-- pelo dono em 03/11/2026; decisão 1 de docs/sdr/DECISOES_RITA.md).
--
-- O QUE MUDA
--   1. `profiles.kind`: 'person' (todo mundo, padrão) ou 'agent' (a Rita).
--      Só a chave de serviço ou o próprio banco mudam esse campo; uma pessoa
--      logada não consegue se marcar como assistente nem desmarcar a Rita.
--      Pode existir UMA assistente por banco (índice).
--   2. `audit_changes.actor` aceita 'assistente'.
--   3. `audit_capture` (0288) lê `current_setting('rita.actor', true)`: quando
--      NÃO há pessoa logada e o valor é o id de um perfil 'agent', a linha da
--      trilha sai com `actor = 'assistente'` e `user_id` = a Rita. Uma pessoa
--      logada continua sendo sempre ela mesma (o valor é ignorado). Valor que
--      não é de assistente é ignorado (cai em 'servico'/'sistema', como antes).
--      A regra "a auditoria nunca derruba a operação" continua (todo erro vira
--      `raise warning`).
--   4. `audit_attach_all` e `audit_missing_tables` passam a olhar também o
--      schema `rita` (criado na 3000). Até lá ele não existe e nada muda.
--
-- Não altera dado de ninguém: todo perfil existente nasce 'person'.
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) profiles.kind
-- -----------------------------------------------------------------------------
alter table public.profiles
  add column if not exists kind text not null default 'person';

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'profiles_kind_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_kind_check check (kind in ('person', 'agent'));
  end if;
end $$;

-- Uma assistente só por banco.
create unique index if not exists profiles_one_agent
  on public.profiles (kind) where kind = 'agent';

-- Só a chave de serviço (ou o próprio banco) define quem é assistente.
create or replace function public.profiles_kind_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_role text := coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    ''
  );
begin
  if v_role in ('authenticated', 'anon') then
    if tg_op = 'INSERT' and new.kind is distinct from 'person' then
      raise exception 'PROFILE_KIND_LOCKED'
        using hint = 'Só o sistema define a assistente virtual.';
    elsif tg_op = 'UPDATE' and new.kind is distinct from old.kind then
      raise exception 'PROFILE_KIND_LOCKED'
        using hint = 'Só o sistema define a assistente virtual.';
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function public.profiles_kind_guard() from public, anon, authenticated;

drop trigger if exists profiles_kind_guard on public.profiles;
create trigger profiles_kind_guard
  before insert or update of kind on public.profiles
  for each row execute function public.profiles_kind_guard();

-- -----------------------------------------------------------------------------
-- 2) audit_changes.actor aceita 'assistente'
-- -----------------------------------------------------------------------------
alter table public.audit_changes drop constraint if exists audit_changes_actor_check;
alter table public.audit_changes
  add constraint audit_changes_actor_check
  check (actor in ('usuario', 'servico', 'sistema', 'assistente'));

-- -----------------------------------------------------------------------------
-- 3) audit_capture: a mesma da 0288, com a autora declarada na transação
-- -----------------------------------------------------------------------------
create or replace function public.audit_capture()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_row jsonb;
  v_changes jsonb := '{}'::jsonb;
  v_key text;
  v_val jsonb;
  v_antes jsonb;
  v_depois jsonb;
  v_claims jsonb;
  v_uid uuid;
  v_sid uuid;
  v_actor text;
  v_agente text;
  v_row_id text;
  v_label text;
  v_clinic uuid;
  v_client uuid;
begin
  begin
    if tg_op = 'DELETE' then
      v_old := to_jsonb(old);
      v_row := v_old;
    elsif tg_op = 'INSERT' then
      v_new := to_jsonb(new);
      v_row := v_new;
    else
      v_old := to_jsonb(old);
      v_new := to_jsonb(new);
      v_row := v_new;
    end if;

    -- O que mudou. Segredo vira "[oculto]"; valor gigante entra cortado.
    for v_key in select jsonb_object_keys(v_row) loop
      if tg_op = 'UPDATE' then
        -- A data de "atualizado em" muda sozinha em toda alteração: não é
        -- informação (no Indica +Risos ela se chama `atualizado_em`).
        continue when v_key in ('updated_at', 'atualizado_em');
        v_antes := v_old -> v_key;
        v_depois := v_new -> v_key;
        continue when v_antes is not distinct from v_depois;
        if v_key ~* '(password|secret|token|api_key|apikey|_hash$|credential)' then
          v_antes := '"[oculto]"'::jsonb;
          v_depois := '"[oculto]"'::jsonb;
        else
          if pg_column_size(v_antes) > 20000 then
            v_antes := to_jsonb(left(v_antes #>> '{}', 4000) || ' …[cortado]');
          end if;
          if pg_column_size(v_depois) > 20000 then
            v_depois := to_jsonb(left(v_depois #>> '{}', 4000) || ' …[cortado]');
          end if;
        end if;
        v_changes := v_changes || jsonb_build_object(
          v_key, jsonb_build_object('antes', v_antes, 'depois', v_depois)
        );
      else
        v_val := v_row -> v_key;
        continue when v_val is null or v_val = 'null'::jsonb;
        if v_key ~* '(password|secret|token|api_key|apikey|_hash$|credential)' then
          v_val := '"[oculto]"'::jsonb;
        elsif pg_column_size(v_val) > 20000 then
          v_val := to_jsonb(left(v_val #>> '{}', 4000) || ' …[cortado]');
        end if;
        v_changes := v_changes || jsonb_build_object(v_key, v_val);
      end if;
    end loop;

    -- Alteração que não mudou nada (ou só o "atualizado em") não é registrada.
    if tg_op = 'UPDATE' and v_changes = '{}'::jsonb then
      return null;
    end if;

    -- Quem fez.
    v_claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
    v_uid := nullif(v_claims ->> 'sub', '')::uuid;
    v_sid := nullif(v_claims ->> 'session_id', '')::uuid;
    v_actor := case
      when v_uid is not null then 'usuario'
      when v_claims ->> 'role' = 'service_role' then 'servico'
      else 'sistema'
    end;

    -- 0365: sem pessoa logada, a assistente declarada na transação (as
    -- funções `rita.*` fazem `set_config('rita.actor', <id>, true)`). Só vale
    -- se o id for mesmo o perfil 'agent'; qualquer outro valor é ignorado.
    if v_uid is null then
      v_agente := nullif(current_setting('rita.actor', true), '');
      if v_agente ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         and exists (
           select 1 from public.profiles p
           where p.id = v_agente::uuid and p.kind = 'agent'
         ) then
        v_uid := v_agente::uuid;
        v_actor := 'assistente';
      end if;
    end if;

    -- Qual registro.
    select string_agg(coalesce(v_row ->> k, ''), ',' order by ord)
      into v_row_id
    from unnest(string_to_array(coalesce(tg_argv[0], 'id'), ',')) with ordinality as t(k, ord);

    -- O CÓDIGO do documento nunca some (regra do projeto) e o nome diz de
    -- quem se trata: quando o registro tem os dois, o rótulo leva os dois.
    v_label := nullif(left(concat_ws(' · ',
      coalesce(nullif(v_row ->> 'code', ''), nullif(v_row ->> 'codigo', '')),
      coalesce(
      nullif(v_row ->> 'full_name', ''),
      nullif(v_row ->> 'trade_name', ''),
      nullif(v_row ->> 'legal_name', ''),
      nullif(v_row ->> 'name', ''),
      nullif(v_row ->> 'nome', ''),
      nullif(v_row ->> 'title', ''),
      nullif(v_row ->> 'titulo', ''),
      nullif(v_row ->> 'procedure_name', ''),
      nullif(v_row ->> 'description', ''),
      nullif(v_row ->> 'descricao', '')
      )
    ), 160), '');

    if (v_row ->> 'clinic_id') ~ '^[0-9a-f-]{36}$' then
      v_clinic := (v_row ->> 'clinic_id')::uuid;
    end if;
    if tg_table_schema = 'public' and tg_table_name = 'clients' then
      v_client := (v_row ->> 'id')::uuid;
    elsif (v_row ->> 'client_id') ~ '^[0-9a-f-]{36}$' then
      v_client := (v_row ->> 'client_id')::uuid;
    end if;

    insert into public.audit_changes
      (user_id, actor, auth_session_id, schema_name, table_name, op,
       row_id, row_label, clinic_id, client_id, changes, tx)
    values
      (v_uid, v_actor, v_sid, tg_table_schema, tg_table_name,
       case tg_op when 'INSERT' then 'I' when 'UPDATE' then 'U' else 'D' end,
       v_row_id, v_label, v_clinic, v_client, v_changes, txid_current());
  exception when others then
    -- ⚠️ A AUDITORIA NUNCA DERRUBA A OPERAÇÃO. O erro vai para o log do banco.
    raise warning 'audit_capture falhou em %.% (%): %',
      tg_table_schema, tg_table_name, tg_op, sqlerrm;
  end;
  return null;
end;
$$;

revoke execute on function public.audit_capture() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4) O schema `rita` entra na lista dos auditados (iguais à 0288, + 'rita')
-- -----------------------------------------------------------------------------
create or replace function public.audit_missing_tables()
returns table (schema_name text, table_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select n.nspname::text, c.relname::text
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where c.relkind = 'r'
    and n.nspname in ('public', 'empresarial', 'indica', 'rita')
    and public.is_admin_master()
    and not exists (
      select 1 from public.audit_excluded_tables x
      where x.schema_name = n.nspname and x.table_name = c.relname
    )
    and not exists (
      select 1 from pg_catalog.pg_trigger t
      where t.tgrelid = c.oid and t.tgname = 'audit_capture_trg' and not t.tgisinternal
    )
  order by 1, 2;
$$;

revoke execute on function public.audit_missing_tables() from public, anon, authenticated;
grant execute on function public.audit_missing_tables() to authenticated;

create or replace function public.audit_attach_all()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_pk text;
  v_n integer := 0;
begin
  -- Prender gatilho pede a tabela por um instante. Se alguém estiver gravando
  -- nela, espera no máximo 8 segundos e DESISTE (a migração inteira é desfeita
  -- e basta rodar de novo) — melhor que deixar a equipe com a tela parada.
  perform set_config('lock_timeout', '8s', true);

  for r in
    select n.nspname, c.relname, c.oid
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where c.relkind = 'r'
      and n.nspname in ('public', 'empresarial', 'indica', 'rita')
      and not exists (
        select 1 from public.audit_excluded_tables x
        where x.schema_name = n.nspname and x.table_name = c.relname
      )
      and not exists (
        select 1 from pg_catalog.pg_trigger t
        where t.tgrelid = c.oid and t.tgname = 'audit_capture_trg' and not t.tgisinternal
      )
    order by 1, 2
  loop
    select string_agg(a.attname, ',' order by k.ord)
      into v_pk
    from pg_catalog.pg_index i
    cross join lateral unnest(i.indkey) with ordinality as k(attnum, ord)
    join pg_catalog.pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum
    where i.indrelid = r.oid and i.indisprimary;

    execute format(
      'create trigger audit_capture_trg after insert or update or delete on %I.%I '
      'for each row execute function public.audit_capture(%L)',
      r.nspname, r.relname, coalesce(v_pk, 'id')
    );
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

revoke execute on function public.audit_attach_all() from public, anon, authenticated;

notify pgrst, 'reload schema';

-- -----------------------------------------------------------------------------
-- Conferência (rodar depois; esperado: 1 · 1 · true · true · 0)
-- -----------------------------------------------------------------------------
-- select
--   (select count(*) from information_schema.columns
--     where table_schema = 'public' and table_name = 'profiles' and column_name = 'kind') as coluna_kind,
--   (select count(*) from pg_trigger where tgname = 'profiles_kind_guard') as trava_kind,
--   (select pg_get_constraintdef(oid) like '%assistente%' from pg_constraint
--     where conname = 'audit_changes_actor_check') as actor_aceita_assistente,
--   (select prosrc like '%rita.actor%' from pg_proc
--     where oid = 'public.audit_capture()'::regprocedure) as captura_le_a_rita,
--   (select count(*) from public.profiles where kind <> 'person') as perfis_nao_pessoa;

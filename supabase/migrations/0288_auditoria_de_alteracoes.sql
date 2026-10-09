-- =============================================================================
-- 0288 — A AUDITORIA REGISTRA O QUE MUDOU, EM TODOS OS CADASTROS (etapa 2 de 3)
-- -----------------------------------------------------------------------------
-- Pedido do dono (09/10/2026): "melhore a auditoria do riSZon, com mais
-- detalhes e possibilidades de enxergar o que cada usuário fez e alterou".
--
-- O QUE EXISTIA: a trilha (`audit_logs`) dependia de cada tela lembrar de
-- registrar — e a maioria registrava só "alterou cliente", sem dizer o quê.
-- Medido em 09/10/2026: 17 de 205 tipos de registro guardavam algum detalhe.
--
-- O QUE PASSA A EXISTIR: o BANCO registra sozinho cada inclusão, alteração e
-- exclusão, em todas as tabelas de cadastro — quem, quando, em qual registro,
-- e o conteúdo ANTES e DEPOIS de cada campo que mudou. Não depende de nenhuma
-- tela lembrar: é um gatilho só (`audit_capture`), preso em cada tabela.
--
-- ⚠️ DECISÕES DO DONO (09/10/2026), que mudam uma regra antiga do projeto:
--   * GUARDA TUDO, antes e depois, inclusive dado pessoal e de saúde. A regra
--     anterior (CLAUDE.md §6) era "nunca dado pessoal na trilha". Justificativa
--     dele: "o acesso à auditoria é para o admin, poucos acessos e tudo dentro
--     do sistema".
--   * TODAS as tabelas de uma vez (núcleo, Empresarial e Indica +Risos).
--   * SÓ o Admin Master lê.
--   * CLIENTE ANONIMIZADO: a auditoria MANTÉM o conteúdo antigo. Avisado de que
--     este é o ponto juridicamente fraco (a anonimização é o direito de
--     exclusão da LGPD) e de que vale conferir com o jurídico; decisão mantida.
--   * O CHAT da equipe fica de fora (conversa entre colegas não é cadastro).
--
-- O QUE NÃO É AUDITADO, e por quê — a lista mora em `audit_excluded_tables`,
-- com o motivo de cada uma, para ninguém precisar adivinhar:
--   * a própria trilha e os registros de acesso (auditar a auditoria é laço);
--   * tabelas que JÁ SÃO histórico de mudança (`*_history`, `*_changes`, ...);
--   * o chat (decisão acima) e o que é efêmero (avisos, presença);
--   * o que é DERIVADO de outra tabela (saldo de estoque, contadores) — a
--     mudança de verdade já foi registrada na origem;
--   * registros técnicos (migrações aplicadas, retorno de webhooks).
-- O Risarte Academy (schema `treinamento`) NÃO é tocado: é outro sistema, e
-- nada muda lá sem o dono ver antes (CLAUDE.md §0).
--
-- GARANTIAS:
--   * O GATILHO NUNCA DERRUBA A OPERAÇÃO. Se registrar a alteração falhar, a
--     alteração em si segue e o erro vai para o log do banco. Auditoria que
--     impede a recepção de agendar seria pior que auditoria nenhuma.
--   * A TRILHA NÃO SE EDITA NEM SE APAGA: gatilhos recusam UPDATE, DELETE e
--     TRUNCATE em `audit_changes` (ordem do dono: nada apaga dado sem pedir).
--     Sem chave estrangeira de propósito — nenhum CASCADE de outra tabela
--     alcança a trilha (lição do TRUNCATE CASCADE, CLAUDE.md §0d).
--   * SEGREDO NÃO ENTRA: colunas de token/senha/hash são gravadas como
--     "[oculto]". Dado pessoal entra (decisão do dono); credencial, não.
--   * Valor gigante (acima de ~20 KB) entra cortado, com a marca do corte.
--
-- TABELA NOVA NO FUTURO: precisa do gatilho. `audit_attach_all()` prende em
-- todas as que faltarem (idempotente), `audit_missing_tables()` lista as que
-- ficaram sem — a tela de Auditoria avisa — e a Regra 9 do `check-migrations`
-- reprova migração que cria tabela sem chamar `audit_attach_all()`.
--
-- Cria 2 tabelas e 5 funções e prende 1 gatilho em cada tabela de cadastro.
-- Não altera dado nem coluna de tabela existente. Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) A TRILHA DE ALTERAÇÕES
-- -----------------------------------------------------------------------------
create table if not exists public.audit_changes (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default clock_timestamp(),
  -- Quem fez. Nulo = não foi uma pessoa logada (rotina agendada, função do
  -- sistema, chave de serviço) — `actor` diz qual.
  user_id uuid,
  actor text not null default 'usuario' check (actor in ('usuario', 'servico', 'sistema')),
  -- O acesso (0287) em que a pessoa estava.
  auth_session_id uuid,
  schema_name text not null,
  table_name text not null,
  op text not null check (op in ('I', 'U', 'D')),
  -- A chave do registro (colunas da chave primária, separadas por vírgula).
  row_id text,
  -- Um nome legível tirado do próprio registro (código, nome, título), para a
  -- tela dizer QUAL registro sem precisar consultar outra tabela.
  row_label text,
  clinic_id uuid,
  client_id uuid,
  -- U: {campo: {antes, depois}} só dos campos que mudaram.
  -- I: {campo: valor} do registro criado.  D: {campo: valor} do registro apagado.
  changes jsonb not null,
  -- Tudo o que aconteceu na mesma operação do banco tem o mesmo número.
  tx bigint
);

create index if not exists audit_changes_when_idx on public.audit_changes (occurred_at desc);
create index if not exists audit_changes_user_idx on public.audit_changes (user_id, occurred_at desc);
create index if not exists audit_changes_row_idx on public.audit_changes (schema_name, table_name, row_id);
create index if not exists audit_changes_client_idx on public.audit_changes (client_id, occurred_at desc)
  where client_id is not null;

alter table public.audit_changes enable row level security;

drop policy if exists "audit_changes_select_admin" on public.audit_changes;
create policy "audit_changes_select_admin" on public.audit_changes
  for select to authenticated
  using (public.is_admin_master());

comment on table public.audit_changes is
  'Auditoria de alterações (0288): cada inclusão, alteração e exclusão das '
  'tabelas de cadastro, com o antes e o depois. Só o Admin Master lê; ninguém '
  'edita nem apaga. Escrita só pelo gatilho audit_capture.';

-- A trilha não se edita nem se apaga.
create or replace function public.audit_changes_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'AUDIT_IMMUTABLE'
    using hint = 'A auditoria de alterações não pode ser editada nem apagada.';
end;
$$;

drop trigger if exists audit_changes_no_update on public.audit_changes;
create trigger audit_changes_no_update
  before update or delete on public.audit_changes
  for each row execute function public.audit_changes_immutable();

drop trigger if exists audit_changes_no_truncate on public.audit_changes;
create trigger audit_changes_no_truncate
  before truncate on public.audit_changes
  for each statement execute function public.audit_changes_immutable();

-- -----------------------------------------------------------------------------
-- 2) O QUE NÃO É AUDITADO, com o motivo
-- -----------------------------------------------------------------------------
create table if not exists public.audit_excluded_tables (
  schema_name text not null,
  table_name text not null,
  motivo text not null,
  primary key (schema_name, table_name)
);

alter table public.audit_excluded_tables enable row level security;
drop policy if exists "audit_excluded_tables_select_admin" on public.audit_excluded_tables;
create policy "audit_excluded_tables_select_admin" on public.audit_excluded_tables
  for select to authenticated
  using (public.is_admin_master());

insert into public.audit_excluded_tables (schema_name, table_name, motivo) values
  -- a própria trilha e os acessos
  ('public', 'audit_changes', 'É a própria trilha de alterações'),
  ('public', 'audit_logs', 'É a própria trilha de ações'),
  ('public', 'audit_excluded_tables', 'Lista de controle da auditoria'),
  ('public', 'access_sessions', 'Registro de acessos (já é auditoria; muda a cada minuto de uso)'),
  -- já são histórico de mudança
  ('public', 'agenda_closure_history', 'Já é histórico'),
  ('public', 'agenda_open_day_history', 'Já é histórico'),
  ('public', 'agenda_plan_item_history', 'Já é histórico'),
  ('public', 'appointment_changes', 'Já é histórico'),
  ('public', 'client_changes', 'Já é histórico'),
  ('public', 'client_clinic_history', 'Já é histórico'),
  ('public', 'clinical_anamnesis_revisions', 'Já é histórico'),
  ('public', 'clinical_note_revisions', 'Já é histórico'),
  ('public', 'commercial_card_events', 'Já é histórico'),
  ('public', 'journey_phase_history', 'Já é histórico'),
  ('public', 'ppr_events', 'Já é histórico'),
  ('public', 'procedure_changes', 'Já é histórico'),
  ('public', 'staff_member_changes', 'Já é histórico'),
  ('public', 'treatment_plan_events', 'Já é histórico'),
  ('public', 'treatment_plan_status_events', 'Já é histórico'),
  ('empresarial', 'commercial_lead_stage_history', 'Já é histórico'),
  ('empresarial', 'membership_history', 'Já é histórico'),
  ('indica', 'indicacao_eventos', 'Já é histórico'),
  -- o chat (decisão do dono) e o que é efêmero
  ('public', 'chat_messages', 'Chat da equipe: conversa, não cadastro (decisão do dono)'),
  ('public', 'chat_channels', 'Chat da equipe (decisão do dono)'),
  ('public', 'chat_channel_members', 'Chat da equipe (decisão do dono)'),
  ('public', 'chat_reactions', 'Chat da equipe (decisão do dono)'),
  ('public', 'chat_reads', 'Chat da equipe (decisão do dono)'),
  ('public', 'chat_blocked_users', 'Chat da equipe (decisão do dono)'),
  ('public', 'user_presence', 'Efêmero: quem está online agora'),
  ('public', 'notifications', 'Avisos gerados pelo sistema; o que muda é só "lido"'),
  ('public', 'finance_alerts', 'Alertas gerados pela rotina do financeiro'),
  ('empresarial', 'funnel_alerts', 'Alertas gerados pela rotina do funil'),
  ('indica', 'alertas_fraude', 'Alertas gerados pela rotina antifraude'),
  ('indica', 'mensagens', 'Mensagens prontas enviadas: registro de envio, não cadastro'),
  -- derivado de outra tabela
  ('public', 'stock_balances', 'Derivado: o saldo é a soma dos movimentos (que são auditados)'),
  ('public', 'system_closed_clinics', 'Derivado da regra de liberação por unidade'),
  ('public', 'clinic_client_counters', 'Contador de código de cliente'),
  -- registros técnicos
  ('public', 'schema_migrations', 'Controle das migrações aplicadas'),
  ('public', 'mirror_state', 'Controle do espelho do treino'),
  ('public', 'mirror_user_map', 'Controle do espelho do treino'),
  ('empresarial', 'asaas_webhook_events', 'Retorno técnico do ASAAS'),
  ('empresarial', 'zapsign_webhook_events', 'Retorno técnico da ZapSign'),
  ('indica', 'falhas_automacao', 'Registro técnico de falha de automação'),
  ('indica', 'rotinas_execucoes', 'Registro técnico de execução de rotina')
on conflict (schema_name, table_name) do nothing;

-- -----------------------------------------------------------------------------
-- 3) O GATILHO: um só, para todas as tabelas
-- -----------------------------------------------------------------------------
-- TG_ARGV[0] = colunas da chave primária, separadas por vírgula.
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
-- 4) QUAIS TABELAS ESTÃO SEM O GATILHO (devia ser sempre nenhuma)
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
    and n.nspname in ('public', 'empresarial', 'indica')
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

-- -----------------------------------------------------------------------------
-- 5) PRENDER O GATILHO EM TODAS AS TABELAS QUE FALTAM
-- -----------------------------------------------------------------------------
-- Idempotente: quem já tem, fica como está. Devolve quantas ganharam agora.
-- Toda migração que criar tabela chama isto no fim (Regra 9 do check-migrations).
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
      and n.nspname in ('public', 'empresarial', 'indica')
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

select public.audit_attach_all();

notify pgrst, 'reload schema';

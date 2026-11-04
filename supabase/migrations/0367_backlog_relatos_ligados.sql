-- =============================================================================
-- 0367 — RELATO → BACKLOG (BK4, 04/11/2026)
--
-- Na tela de Problemas (aberta pela boia), o Admin Master passa a ter, ao lado
-- de "Preparar briefing", o botão "Enviar para o backlog": o relato vira um
-- item novo ou se liga a um item que já existe (vários relatos do mesmo
-- defeito, um item só). Decisão do dono (B-D4): o relato fica "Em análise" até
-- o item ser resolvido. Plano em `docs/backlog/TELA-BACKLOG-PLANO.md`.
--
-- POR QUE MUDAR A TABELA DA 0366. A `backlog_item_reports` apontava para
-- `system_reports` por chave estrangeira. Mas a tela de Problemas da produção
-- mostra também os relatos do TREINO (0264), que moram no outro banco: o id
-- deles não existe aqui, e a ligação seria recusada. Agora a ligação guarda o
-- AMBIENTE, o id, o código e o título do relato (uma foto, para a tela do item
-- não ter de ir ao outro banco), sem a chave estrangeira.
--
-- A tabela está VAZIA nos dois bancos: na 0366 nenhuma função gravava nela.
-- Nada se perde; nenhum comando aqui apaga linha.
--
-- Idempotente.
-- =============================================================================

alter table public.backlog_item_reports
  drop constraint if exists backlog_item_reports_report_id_fkey;
alter table public.backlog_item_reports
  drop constraint if exists backlog_item_reports_pkey;

alter table public.backlog_item_reports
  add column if not exists ambiente text not null default 'sistema',
  add column if not exists report_code text not null default '',
  add column if not exists report_title text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'backlog_item_reports_ambiente_ok'
       and conrelid = 'public.backlog_item_reports'::regclass
  ) then
    alter table public.backlog_item_reports
      add constraint backlog_item_reports_ambiente_ok check (ambiente in ('sistema', 'treino'));
  end if;
  if not exists (
    select 1 from pg_constraint
     where conname = 'backlog_item_reports_pkey'
       and conrelid = 'public.backlog_item_reports'::regclass
  ) then
    alter table public.backlog_item_reports
      add constraint backlog_item_reports_pkey primary key (item_id, ambiente, report_id);
  end if;
end $$;

drop index if exists public.backlog_item_reports_report_idx;
create index if not exists backlog_item_reports_relato_idx
  on public.backlog_item_reports (ambiente, report_id);

comment on table public.backlog_item_reports is
  '0366/0367: que relato virou que item do backlog. O relato pode ser do treino (outro banco), por isso guarda ambiente, id, código e título, sem chave estrangeira. Grava só backlog_link_report.';

-- -----------------------------------------------------------------------------
-- Ligar um relato a um item. Idempotente: ligar de novo não duplica nem gera
-- outro evento. Devolve se a ligação é nova.
-- -----------------------------------------------------------------------------
create or replace function public.backlog_link_report(
  p_code text,
  p_ambiente text,
  p_report_id uuid,
  p_report_code text,
  p_report_title text default null,
  p_author_label text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item uuid;
  v_novo boolean;
begin
  if not public._backlog_can_write() then
    raise exception 'NOT_ALLOWED';
  end if;
  if p_ambiente not in ('sistema', 'treino') then
    raise exception 'AMBIENTE_INVALIDO';
  end if;
  if p_report_id is null or nullif(btrim(p_report_code), '') is null then
    raise exception 'REPORT_REQUIRED';
  end if;

  select id into v_item from public.backlog_items where code = upper(btrim(p_code));
  if v_item is null then
    raise exception 'ITEM_NOT_FOUND';
  end if;

  insert into public.backlog_item_reports
    (item_id, ambiente, report_id, report_code, report_title, linked_by)
  values (
    v_item, p_ambiente, p_report_id, btrim(p_report_code),
    nullif(left(btrim(coalesce(p_report_title, '')), 300), ''),
    (select auth.uid())
  )
  on conflict (item_id, ambiente, report_id) do nothing;
  get diagnostics v_novo = row_count;

  if v_novo then
    perform public._backlog_event(
      v_item, 'relato', null,
      btrim(p_report_code) || case when p_ambiente = 'treino' then ' (treino)' else '' end,
      null, p_author_label
    );
  end if;
  return v_novo;
end;
$$;

revoke execute on function public.backlog_link_report(text, text, uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.backlog_link_report(text, text, uuid, text, text, text)
  to authenticated, service_role;

notify pgrst, 'reload schema';

-- Conferência (só leitura): esperado 3 · false · true · true
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'backlog_item_reports'
      and column_name in ('ambiente', 'report_code', 'report_title')) as colunas_3,
  exists (select 1 from pg_constraint
           where conname = 'backlog_item_reports_report_id_fkey') as chave_antiga_false,
  exists (select 1 from pg_constraint
           where conname = 'backlog_item_reports_pkey') as chave_nova,
  not has_function_privilege('anon',
    'public.backlog_link_report(text,text,uuid,text,text,text)', 'execute') as sem_login_fechado;

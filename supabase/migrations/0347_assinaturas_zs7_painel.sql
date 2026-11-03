-- =============================================================================
-- 0347 — ASSINATURA DIGITAL (ZapSign) — FASE ZS7: o painel e os relatórios
-- -----------------------------------------------------------------------------
-- Plano ZS0 (docs/assinaturas/PLANO-ZS0.md §9 e §11, fase ZS7). Pedido do dono
-- (02/11/2026): cada número do período abre a LISTA dos pacotes (assinados,
-- faltam assinar, recusados, vencidos, cancelados), com o link para o pacote e
-- para a negociação de origem.
--
--   * `signature_report_rows(...)` — UMA leitura para o painel, as listas, os
--     relatórios (PDF e planilha) e o relatório mensal: os pacotes que dizem
--     respeito ao período (enviados, concluídos, encerrados nele, ou ainda
--     aguardando assinatura), com os tempos e os documentos de cada um. A conta
--     dos números mora no aplicativo (`src/lib/signatures/indicadores.ts`,
--     regra pura e testada) em cima destas linhas — tela, relatório e e-mail
--     nunca divergem.
--     É `security invoker`: a RLS de `signature_packages` recorta o que cada
--     um vê (a unidade, a rede com `painel_rede`, a trava do RisLife). Pela
--     chave de serviço (o relatório mensal) vê a rede inteira.
--   * `signature_job_runs` aceita a rotina `monthly` (o relatório do dia 1º).
--
-- Idempotente. Não apaga dado.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) O rastro das rotinas aceita a mensal
-- -----------------------------------------------------------------------------
alter table public.signature_job_runs drop constraint if exists signature_job_runs_job_check;
alter table public.signature_job_runs
  add constraint signature_job_runs_job_check check (job in ('daily', 'hourly', 'monthly'));

create or replace function public.signature_log_job_run(p_job text, p_stats jsonb, p_error text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_job is null or p_job not in ('daily', 'hourly', 'monthly') then
    raise exception 'JOB_INVALID';
  end if;
  insert into public.signature_job_runs (job, stats, error)
  values (p_job, coalesce(p_stats, '{}'::jsonb), left(p_error, 500));
end;
$$;

revoke execute on function public.signature_log_job_run(text, jsonb, text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2) A leitura do período
-- -----------------------------------------------------------------------------
-- Datas em `p_from`/`p_to` são dias de Brasília (inclusive). Filtros nulos =
-- sem filtro. Rascunho nunca enviado não entra (não é envio).
create or replace function public.signature_report_rows(
  p_from date,
  p_to date,
  p_clinic_ids uuid[] default null,
  p_audience text default null,
  p_template_id uuid default null,
  p_sent_by uuid default null
)
returns table (
  id uuid,
  number text,
  clinic_id uuid,
  clinic_name text,
  audience text,
  status text,
  current_stage text,
  client_name text,
  client_id uuid,
  company_id uuid,
  lead_id uuid,
  origin_type text,
  origin_id uuid,
  sent_at timestamptz,
  client_signed_at timestamptz,
  completed_at timestamptz,
  expires_at timestamptz,
  ended_at timestamptz,
  cancel_reason text,
  refused_reason text,
  sent_by uuid,
  sent_by_name text,
  cancelled_by_name text,
  items jsonb
)
language sql
stable
security invoker
set search_path = ''
as $$
  with base as (
    select p.*,
           case when p.status in ('refused', 'expired', 'cancelled')
                then coalesce(p.cancelled_at, p.updated_at) end as fim
      from public.signature_packages p
     where p.sent_at is not null
       and (p_clinic_ids is null or p.clinic_id = any (p_clinic_ids))
       and (p_audience is null or p.audience = p_audience)
       and (p_sent_by is null or p.sent_by = p_sent_by)
       and (p_template_id is null or exists (
             select 1 from public.signature_package_items i
              where i.package_id = p.id and i.template_id = p_template_id))
  )
  select b.id, b.number, b.clinic_id,
         coalesce(c.name, b.cover_data->>'clinic_name') as clinic_name,
         b.audience, b.status, b.current_stage,
         b.cover_data->>'client_name' as client_name,
         b.client_id, b.company_id, b.lead_id, b.origin_type, b.origin_id,
         b.sent_at, b.client_signed_at, b.completed_at, b.expires_at,
         b.fim as ended_at,
         b.cancel_reason, b.refused_reason, b.sent_by,
         ps.full_name as sent_by_name,
         pc.full_name as cancelled_by_name,
         coalesce((
           select jsonb_agg(jsonb_build_object('title', i.title, 'template_id', i.template_id, 'kind', t.kind) order by i.sort_order)
             from public.signature_package_items i
             left join public.signature_templates t on t.id = i.template_id
            where i.package_id = b.id
         ), '[]'::jsonb) as items
    from base b
    left join public.clinics c on c.id = b.clinic_id
    left join public.profiles ps on ps.id = b.sent_by
    left join public.profiles pc on pc.id = b.cancelled_by
   where (b.sent_at at time zone 'America/Sao_Paulo')::date between p_from and p_to
      or (b.completed_at at time zone 'America/Sao_Paulo')::date between p_from and p_to
      or (b.client_signed_at at time zone 'America/Sao_Paulo')::date between p_from and p_to
      or (b.fim at time zone 'America/Sao_Paulo')::date between p_from and p_to
      or b.status in ('sent', 'partially_signed')
   order by b.sent_at desc;
$$;

revoke execute on function public.signature_report_rows(date, date, uuid[], text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.signature_report_rows(date, date, uuid[], text, uuid, uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Conferência (só contagens, nenhum dado pessoal)
-- -----------------------------------------------------------------------------
select
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'signature_report_rows') as leitura,
  has_function_privilege('anon', 'public.signature_report_rows(date, date, uuid[], text, uuid, uuid)', 'execute') as leitura_sem_login,
  has_function_privilege('authenticated', 'public.signature_report_rows(date, date, uuid[], text, uuid, uuid)', 'execute') as leitura_logado,
  (select pg_get_constraintdef(oid) like '%monthly%' from pg_constraint where conname = 'signature_job_runs_job_check') as rastro_mensal;

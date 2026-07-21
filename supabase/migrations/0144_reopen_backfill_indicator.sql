-- =============================================================================
-- Risarte Odontologia — Migration 0144 (Cockpit — Bloco D, Entrega 3 + correção)
-- (1) Backfill: reabre procedimentos JÁ marcados como revisão / reprovado-refazer
--     cujas sessões continuaram finalizadas (foram marcados antes da lógica de
--     reabertura da 0143). (2) garante enum/coluna (idempotente).
-- =============================================================================

alter type public.appointment_type add value if not exists 'revision';
alter type public.appointment_type add value if not exists 'redo';

alter table public.treatment_sessions
  add column if not exists redo_kind text
    check (redo_kind is null or redo_kind in ('revisao','refacao'));

-- (1a) REVISÃO já marcada e sem sessão de revisão pendente → cria a sessão.
insert into public.treatment_sessions
  (client_id, clinic_id, plan_id, item_id, procedure_id, procedure_name,
   session_index, session_total, name, redo_kind)
select tp.client_id, r.clinic_id, r.plan_id, r.item_id, i.procedure_id,
  coalesce(i.description, 'Procedimento'),
  coalesce((select max(session_index) from public.treatment_sessions ts
            where ts.item_id = r.item_id), 0) + 1,
  1, 'Revisão do procedimento', 'revisao'
from public.plan_quality_reviews r
join public.treatment_plans tp on tp.id = r.plan_id
join public.treatment_plan_option_items i on i.id = r.item_id
where r.status = 'revisao'
  and not exists (
    select 1 from public.treatment_sessions ts
    where ts.item_id = r.item_id and ts.status <> 'done'
      and ts.redo_kind = 'revisao'
  );

-- (1b) REPROVADO → refazer: reabre as sessões que ainda estão finalizadas.
update public.treatment_sessions ts
  set status = 'pending', done_at = null, executed_by = null,
      appointment_id = null, redo_kind = 'refacao'
from public.plan_quality_reviews r
where r.item_id = ts.item_id
  and r.status = 'reprovado'
  and r.resolution in ('redo_same','redo_other')
  and ts.status = 'done';

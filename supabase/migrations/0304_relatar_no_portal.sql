-- =============================================================================
-- 0304 — RELATAR UM PROBLEMA NO MODO PORTAL (OC-00111)
--
-- Relato OC-00111 (19/10/2026): "não consigo relatar o problema na própria
-- tela" — a pessoa ainda no modo portal (sistema real fechado, só o Início).
-- Duas travas, uma em cima da outra:
--
--   1. A TELA: a boia do portal nascia com `temUnidade={false}` e mandava
--      "escolher uma unidade no menu lateral" — que no portal não existe.
--      (Corrigido no código.)
--   2. O BANCO: o relato só entra em unidade de `user_clinic_ids()`, que lê a
--      janela `user_clinic_roles` (0277) — e a janela ESCONDE as unidades
--      fechadas da própria pessoa. No portal, todas estão fechadas: o banco
--      recusaria qualquer relato. O relato OC-00111 só existe porque foi
--      registrado no TREINO.
--
-- O QUE MUDA (decisão do dono, 19/10/2026: "automático, a da ficha"):
--   `my_report_clinic()` devolve a unidade da FICHA de Risartano da pessoa (a
--   mais antiga; sem ficha, a primeira unidade onde ela tem função) e as
--   funções dela ali — lendo a TABELA (`user_clinic_roles_all`), que enxerga
--   as fechadas. A regra de inclusão de `system_reports` passa a aceitar
--   também essa unidade. Continua valendo: só em nome da própria pessoa.
--
-- Nenhuma tabela nova. Nada apaga dado. Idempotente.
-- =============================================================================

create or replace function public.my_report_clinic()
returns table (clinic_id uuid, roles public.user_role[])
language sql
stable
security definer
set search_path = ''
as $$
  with eu as (
    select (select auth.uid()) as id
  ), escolhida as (
    select coalesce(
      (select s.clinic_id
         from public.staff_members s, eu
        where s.user_id = eu.id
        order by s.created_at
        limit 1),
      (select r.clinic_id
         from public.user_clinic_roles_all r, eu
        where r.user_id = eu.id
        order by r.clinic_id
        limit 1)
    ) as clinic_id
  )
  select e.clinic_id,
         coalesce(
           (select array_agg(r.role order by r.role)
              from public.user_clinic_roles_all r, eu
             where r.user_id = eu.id and r.clinic_id = e.clinic_id),
           '{}'::public.user_role[]
         )
    from escolhida e, eu
   where eu.id is not null
     and e.clinic_id is not null;
$$;

revoke execute on function public.my_report_clinic() from public, anon, authenticated;
grant execute on function public.my_report_clinic() to authenticated;

-- Qualquer pessoa relata, e só em nome dela mesma, numa clínica que é dela —
-- agora também a da FICHA, que a tranca do portal esconde de `user_clinic_ids`.
drop policy if exists "system_reports_insert" on public.system_reports;
create policy "system_reports_insert" on public.system_reports
  for insert to authenticated
  with check (
    reporter_id = (select auth.uid())
    and (
      public.is_admin_master()
      or clinic_id in (select public.user_clinic_ids())
      or clinic_id in (select m.clinic_id from public.my_report_clinic() m)
    )
  );

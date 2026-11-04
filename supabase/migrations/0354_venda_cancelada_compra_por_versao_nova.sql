-- =============================================================================
-- 0354 — DEPOIS DA VENDA CANCELADA, COMPRA-SE POR UMA VERSÃO NOVA (AP63)
--
-- Decisão do dono (03/11/2026), na AP63: "depois de cancelar, o cliente compra
-- de novo por uma nova versão do plano com negociação nova. Deve ficar
-- registrado no histórico que teve uma venda cancelada."
-- Plano em docs/comercial/AP63-AP64-PLANO.md (§2).
--
-- O caminho pelo termo de cancelamento já funcionava (Fase 6 → planejamento →
-- versão nova → Comercial; a 0250 reabre o cartão). Dois furos:
--
-- 1) O CANCELAMENTO RÁPIDO LEVAVA A UM BECO. `cancel_negotiation` (0205)
--    devolve o cliente à Fase 4. Dali, "Devolver ao planejamento"
--    (`return_commercial_to_planning`, última definição na 0266) reabria como
--    RASCUNHO o plano aprovado mais novo — o da venda cancelada. O Planner
--    editaria o plano vendido em vez de fazer a versão nova, e o registro do
--    que foi vendido se perderia.
--    Agora: se o plano tem negociação CANCELADA, ele não é reaberto. O cliente
--    vai ao Centro de Planejamento do mesmo jeito, e o aviso ao Planner diz
--    para criar uma NOVA VERSÃO.
--
-- 2) A COMPRA NOVA NÃO MOSTRAVA O CANCELAMENTO. O evento "venda_cancelada"
--    (0208) fica só no plano antigo. Agora toda versão nova nasce com um
--    evento "venda_cancelada_anterior" para cada venda cancelada dos planos
--    anteriores do cliente; a tela mostra esses eventos como aviso fixo no
--    plano e na negociação.
--
-- Nada apaga. Idempotente: rodar de novo não muda nada.
-- =============================================================================

-- 1) A devolução não reabre o plano da venda cancelada ---------------------------
create or replace function public.return_commercial_to_planning(p_client_id uuid, p_considerations text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_clinic uuid;
  v_phase public.journey_phase;
  v_plan uuid;
  v_cancelada boolean := false;
  v_client_name text;
  v_user uuid := (select auth.uid());
begin
  select clinic_id, journey_phase into v_clinic, v_phase
  from public.clients where id = p_client_id;
  if v_clinic is null then raise exception 'CLIENT_NOT_FOUND'; end if;
  if v_phase <> 'commercial_conversion' then raise exception 'WRONG_PHASE'; end if;

  if not (
    public.is_admin_master()
    or exists (select 1 from public.providers_with_access(v_clinic, 'commercial_consultant') p
               where p.user_id = v_user)
  ) then
    raise exception 'NOT_ALLOWED';
  end if;

  if coalesce(btrim(p_considerations), '') = '' then
    raise exception 'CONSIDERATIONS_REQUIRED';
  end if;

  select id into v_plan from public.treatment_plans
  where client_id = p_client_id and status = 'approved'
  order by created_at desc limit 1;

  -- AP63: o plano da venda cancelada fica como está (é o registro do que foi
  -- vendido). A compra nova sai de uma versão nova.
  if v_plan is not null then
    v_cancelada := exists (
      select 1 from public.plan_negotiations n
      where n.plan_id = v_plan and n.status = 'cancelada'
    );
  end if;

  update public.plan_negotiations set status = 'devolvida', updated_at = now()
  where client_id = p_client_id and status in ('em_negociacao', 'aguardando_autorizacao');

  if v_plan is not null and v_cancelada then
    insert into public.treatment_plan_events (plan_id, clinic_id, event_type, description, actor_id)
    values (v_plan, v_clinic, 'devolvido_comercial',
      'Devolvido pelo Comercial depois da venda cancelada — este plano não é reaberto; '
        || 'para vender de novo, o Planner cria uma nova versão. Considerações do Consultor: '
        || btrim(p_considerations),
      v_user);
  elsif v_plan is not null then
    insert into public.treatment_plan_events (plan_id, clinic_id, event_type, description, actor_id)
    values (v_plan, v_clinic, 'devolvido_comercial',
      'Devolvido pelo Comercial — considerações do Consultor: ' || btrim(p_considerations),
      v_user);

    update public.treatment_plans set
      status = 'draft',
      lifecycle = null,
      commercial_return_note = btrim(p_considerations),
      commercial_returned_at = now(),
      commercial_returned_by = v_user,
      updated_at = now()
    where id = v_plan;
  end if;

  -- 0266: o ATO é autorizado, não o movimento cru (ver a 0266).
  perform set_config('risarte.ato', 'devolucao_comercial', true);
  perform public.move_client_phase(p_client_id, 'planning_center');

  select full_name into v_client_name from public.clients where id = p_client_id;
  insert into public.notifications (user_id, clinic_id, title, body, link)
  select distinct ucr.user_id, v_clinic,
    case when v_cancelada
         then 'Venda cancelada — criar NOVA VERSÃO do plano'
         else 'Plano DEVOLVIDO pelo Comercial — reabrir e ajustar' end,
    case when v_cancelada
         then coalesce(v_client_name, 'Cliente')
           || ' teve a venda cancelada e voltou ao planejamento. O plano vendido '
           || 'fica guardado: crie uma nova versão para a compra nova. '
           || 'Considerações do Consultor: ' || btrim(p_considerations)
         else coalesce(v_client_name, 'Cliente')
           || ' — o plano foi reaberto (situação REPLANEJAMENTO) com as considerações '
           || 'do Consultor em destaque. Ajuste e envie novamente para aprovação.' end,
    '/planejamento/' || p_client_id
  from public.user_clinic_roles ucr
  where ucr.role = 'planner_dentist' and ucr.user_id <> v_user;
end;
$$;

revoke execute on function public.return_commercial_to_planning(uuid, text) from public, anon, authenticated;
grant execute on function public.return_commercial_to_planning(uuid, text) to authenticated;

-- 2) A versão nova nasce sabendo das vendas canceladas ---------------------------
create or replace function public.treatment_plan_log_cancelled_sales()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.previous_plan_id is null then
    return new;
  end if;

  insert into public.treatment_plan_events (plan_id, clinic_id, event_type, description, actor_id, created_at)
  select new.id, new.clinic_id, 'venda_cancelada_anterior',
         'Venda anterior cancelada (plano versão ' || coalesce(p.version_no::text, '?') || ', em '
           || to_char(e.created_at at time zone 'America/Sao_Paulo', 'DD/MM/YYYY') || ') — '
           || coalesce(nullif(regexp_replace(e.description, '^Venda cancelada — ', ''), ''), 'sem detalhe'),
         e.actor_id, now()
  from public.treatment_plan_events e
  join public.treatment_plans p on p.id = e.plan_id
  where p.client_id = new.client_id
    and p.id <> new.id
    and e.event_type = 'venda_cancelada'
  order by e.created_at;

  return new;
end;
$$;

revoke execute on function public.treatment_plan_log_cancelled_sales() from public, anon, authenticated;

drop trigger if exists treatment_plan_log_cancelled_sales_trg on public.treatment_plans;
create trigger treatment_plan_log_cancelled_sales_trg
  after insert on public.treatment_plans
  for each row execute function public.treatment_plan_log_cancelled_sales();

-- Conferência (só leitura) ------------------------------------------------------
select
  position('v_cancelada' in pg_get_functiondef('public.return_commercial_to_planning(uuid, text)'::regprocedure)) > 0
    as devolucao_respeita_venda_cancelada,
  (select count(*) from pg_trigger
    where tgname = 'treatment_plan_log_cancelled_sales_trg' and not tgisinternal) as gatilho_esperado_1,
  has_function_privilege('anon', 'public.return_commercial_to_planning(uuid, text)', 'execute')
    as sem_login_executa_esperado_false,
  (select count(*) from public.plan_negotiations where status = 'cancelada') as negociacoes_canceladas;

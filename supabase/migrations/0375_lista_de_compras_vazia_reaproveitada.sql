-- =============================================================================
-- 0375 — LISTA DE COMPRAS VAZIA É REAPROVEITADA (AP71)
-- -----------------------------------------------------------------------------
-- "Gerar lista de compras" criava uma lista NOVA a cada clique, mesmo quando
-- nada estava abaixo do mínimo. No treino, Cambé ficou com três listas em
-- Rascunho com 0 itens (duas criadas no mesmo minuto: clique duplo).
--
-- Não dá para simplesmente recusar a lista vazia: é nela que a pessoa
-- acrescenta as linhas à mão (compra que não vem do estoque). Então:
--
--   1. Se a unidade JÁ TEM uma lista em Rascunho, do mesmo tipo (local ou não)
--      e SEM NENHUM ITEM, ela é reaproveitada — recebe o que estiver abaixo do
--      mínimo agora e é devolvida. Nenhuma lista nova nasce.
--   2. Uma trava por unidade (advisory lock da transação) faz o segundo clique
--      esperar o primeiro: ele encontra a lista que o primeiro criou e, se ela
--      continuou vazia, devolve a mesma.
--
-- Lista com item NÃO é reaproveitada: gerar de novo cria outra, como sempre.
-- As listas vazias que já existem continuam lá (nada é apagado): a próxima
-- geração reaproveita a mais antiga, e as demais saem pelo Cancelar da tela.
--
-- A função é a definição em vigor (0296), com os dois acréscimos. A guarda de
-- quem pode (`can_request_purchase`) não mudou.
-- Idempotente.
-- =============================================================================

create or replace function public.build_purchase_request(p_clinic_id uuid, p_is_local boolean default false)
 returns uuid
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_user uuid := (select auth.uid());
  v_id uuid;
  v_row record;
  v_est record;
begin
  if not (public.is_admin_master() or public.can_request_purchase(p_clinic_id)) then
    raise exception 'NOT_ALLOWED';
  end if;

  -- AP71: um clique por vez em cada unidade. Solta sozinha no fim da transação.
  perform pg_advisory_xact_lock(hashtextextended('build_purchase_request:' || p_clinic_id::text, 0));

  -- AP71: rascunho vazio do mesmo tipo é reaproveitado (o mais antigo).
  select r.id into v_id
    from public.purchase_requests r
   where r.clinic_id = p_clinic_id
     and r.status = 'rascunho'
     and r.is_local = coalesce(p_is_local, false)
     and not exists (
       select 1 from public.purchase_request_items i where i.request_id = r.id
     )
   order by r.created_at
   limit 1;

  if v_id is null then
    insert into public.purchase_requests (clinic_id, is_local, created_by)
    values (p_clinic_id, coalesce(p_is_local, false), v_user)
    returning id into v_id;
  end if;

  for v_row in
    select * from public.replenishment_list(p_clinic_id)
     where suggested_packages > 0
  loop
    select * into v_est
      from public.estimated_purchase_cost(p_clinic_id, v_row.item_id);

    insert into public.purchase_request_items (
      request_id, item_id, description, quantity, purchase_unit,
      estimated_unit_cents, estimated_total_cents, estimate_source,
      estimate_date
    ) values (
      v_id, v_row.item_id,
      v_row.item_name || coalesce(' — ' || v_row.brand, ''),
      v_row.suggested_packages, v_row.purchase_unit,
      coalesce(v_est.unit_cents, 0),
      round(coalesce(v_est.unit_cents, 0) * v_row.suggested_packages)::bigint,
      coalesce(v_est.source, 'sem_referencia'),
      v_est.reference_date
    )
    on conflict (request_id, item_id) do nothing;
  end loop;

  return v_id;
end;
$function$;

revoke execute on function public.build_purchase_request(uuid, boolean) from public, anon;
grant execute on function public.build_purchase_request(uuid, boolean) to authenticated;

-- -----------------------------------------------------------------------------
-- Conferência (só contagens)
-- -----------------------------------------------------------------------------
select
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'build_purchase_request'
      and pg_get_functiondef(p.oid) like '%pg_advisory_xact_lock%')
    as funcao_com_a_trava_esperado_1,
  has_function_privilege('anon', 'public.build_purchase_request(uuid, boolean)', 'execute')
    as sem_login_executa_esperado_false,
  (select count(*) from public.purchase_requests r
    where r.status = 'rascunho'
      and not exists (select 1 from public.purchase_request_items i where i.request_id = r.id))
    as rascunhos_vazios_hoje;

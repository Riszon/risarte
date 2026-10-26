-- =============================================================================
-- 0323 — COMPRAS: QUEM PEDIU, E OS AVISOS QUE FALTAVAM (OC-00129 + OC-00130)
-- -----------------------------------------------------------------------------
-- Dois relatos do Admin Master, tratados como um caso:
--
--   OC-00130 — na aba Pedir, as listas não diziam quem pediu nem a que horas.
--   OC-00129 — uma lista "Enviada" não aparecia para aprovar.
--
-- O segundo NÃO é defeito da aprovação: "Enviada" quer dizer que a lista está
-- com a Franqueadora, esperando entrar numa rodada de negociação. A aprovação
-- só nasce quando a rodada FECHA (0241). O que faltava era alguém ficar
-- sabendo: o envio não avisava quem compra, e o fechamento não avisava quem
-- aprova. A lista ficava parada sem ninguém ter culpa.
--
-- O que esta migração faz:
--   1. `purchase_request_authors`: quem montou e quem enviou cada lista, com a
--      função — os nomes de outra unidade não passam pela regra de `profiles`
--      (só colegas), e a Franqueadora precisa ver quem pediu.
--   2. `send_purchase_request` passa a AVISAR o Comprador, o Financeiro da
--      Franqueadora e o Admin Master (decisão do dono, 26/10/2026).
--   3. `close_purchase_round` passa a AVISAR quem aprova a compra de cada
--      unidade (a régua de `can_decide_purchase`, 0294). Sem gerente na
--      unidade, o aviso vai ao Admin Master — aviso que não chega a ninguém é
--      o defeito que esta migração corrige.
--
-- ⚠️ O AVISO NASCE DENTRO DA FUNÇÃO DO ATO (como na 0316/0321): mesma
-- transação; se o ato falha, ninguém é avisado de algo que não aconteceu.
--
-- Idempotente (create or replace, mesmo retorno). Nada apaga dado. Nenhuma
-- tabela nova.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) QUEM PEDIU
-- -----------------------------------------------------------------------------
create or replace function public.purchase_request_authors(p_ids uuid[])
returns table (
  request_id uuid,
  created_by_name text,
  created_by_role text,
  sent_by_name text,
  sent_by_role text
)
language sql
stable
security definer
set search_path = ''
as $$
  -- A função de quem age NA UNIDADE da lista; sem função lá (Admin, ou o
  -- Financeiro da Franqueadora agindo numa unidade), a primeira que tiver.
  with pessoa as (
    select r.id as request_id, r.clinic_id, x.kind, x.user_id
    from public.purchase_requests r
    cross join lateral (values ('criou', r.created_by), ('enviou', r.sent_by)) as x(kind, user_id)
    where r.id = any(p_ids)
      and x.user_id is not null
      -- A MESMA régua de leitura da lista (0239): quem não vê a lista não vê
      -- quem a pediu.
      and (r.clinic_id in (select public.user_clinic_ids())
           or public.is_admin_master()
           or ((public.is_purchaser() or public.is_finance_franchisor())
               and r.status <> 'rascunho'))
  ),
  rotulo as (
    select p.request_id, p.kind,
           pr.full_name,
           coalesce(
             (select u.role::text from public.user_clinic_roles_all u
               where u.user_id = p.user_id and u.clinic_id = p.clinic_id
               limit 1),
             case when pr.is_admin_master then 'admin_master' end,
             (select u.role::text from public.user_clinic_roles_all u
               where u.user_id = p.user_id
               order by u.role::text limit 1)
           ) as role
    from pessoa p
    join public.profiles pr on pr.id = p.user_id
  )
  select r.id,
         c.full_name, c.role,
         s.full_name, s.role
  from public.purchase_requests r
  left join rotulo c on c.request_id = r.id and c.kind = 'criou'
  left join rotulo s on s.request_id = r.id and s.kind = 'enviou'
  where r.id in (select request_id from pessoa);
$$;

revoke execute on function public.purchase_request_authors(uuid[]) from public, anon, authenticated;
grant execute on function public.purchase_request_authors(uuid[]) to authenticated;

-- -----------------------------------------------------------------------------
-- 2) ENVIAR À FRANQUEADORA — agora avisa quem compra
-- -----------------------------------------------------------------------------
create or replace function public.send_purchase_request(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r record;
  v_user uuid := (select auth.uid());
  v_items integer;
  v_total bigint;
  v_clinic text;
  v_who text;
begin
  select * into v_r from public.purchase_requests where id = p_id;
  if v_r.id is null then raise exception 'REQUEST_NOT_FOUND'; end if;
  -- A guarda em vigor desde a 0296 (Coordenador e ASB também enviam).
  if not (public.is_admin_master() or public.can_request_purchase(v_r.clinic_id))
  then
    raise exception 'NOT_ALLOWED';
  end if;
  if v_r.status <> 'rascunho' then raise exception 'ALREADY_SENT'; end if;

  select count(*), coalesce(sum(estimated_total_cents), 0)
    into v_items, v_total
    from public.purchase_request_items where request_id = p_id;
  if v_items = 0 then raise exception 'EMPTY_REQUEST'; end if;

  update public.purchase_requests
     set status = 'enviada', sent_at = now(), sent_by = v_user,
         updated_at = now()
   where id = p_id;

  -- Compra local não passa pela Franqueadora: não há o que avisar.
  if v_r.is_local then return; end if;

  select name into v_clinic from public.clinics where id = v_r.clinic_id;
  select full_name into v_who from public.profiles where id = v_user;

  insert into public.notifications (user_id, clinic_id, title, body, link)
  select distinct d.user_id, v_r.clinic_id,
         'Compras — nova lista ' || coalesce(v_r.code, '') || ' de ' || coalesce(v_clinic, 'uma unidade'),
         'Enviada por ' || coalesce(v_who, 'alguém da unidade')
           || ' em ' || to_char(now() at time zone 'America/Sao_Paulo', 'DD/MM/YYYY "às" HH24:MI')
           || ' — ' || v_items || case when v_items = 1 then ' item' else ' itens' end
           || ', previsão ' || public.brl(v_total)
           || '. Junte numa rodada na Mesa de negociação.',
         '/compras/rodadas'
  from (
    select u.user_id from public.user_clinic_roles_all u
     where u.role in ('purchaser', 'finance_franchisor')
    union
    select p.id from public.profiles p where p.is_admin_master
  ) d
  join public.profiles p on p.id = d.user_id and p.is_active
  where d.user_id <> v_user;
end;
$$;

revoke execute on function public.send_purchase_request(uuid) from public, anon, authenticated;
grant execute on function public.send_purchase_request(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 3) FECHAR A RODADA — agora avisa quem aprova em cada unidade
-- -----------------------------------------------------------------------------
create or replace function public.close_purchase_round(p_round_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_awarded integer;
  v_round_code text;
  u record;
begin
  if not (public.is_admin_master() or public.is_finance_franchisor()
          or public.is_purchaser()) then
    raise exception 'NOT_ALLOWED';
  end if;
  if not exists (select 1 from public.purchase_rounds
                  where id = p_round_id and status in ('aberta', 'cotando')) then
    raise exception 'ROUND_CLOSED';
  end if;

  select count(*) into v_awarded from public.purchase_round_items
   where round_id = p_round_id and awarded_supplier_id is not null;

  if v_awarded = 0 then raise exception 'NOTHING_AWARDED'; end if;

  update public.purchase_rounds
     set status = 'fechada', closed_at = now(), closed_by = v_user,
         updated_at = now()
   where id = p_round_id
  returning code into v_round_code;

  update public.purchase_requests
     set status = 'concluida', updated_at = now()
   where round_id = p_round_id;

  -- A PARTE DA UNIDADE CONGELA AQUI. Sem isso, editar a rodada depois mudaria
  -- silenciosamente o que a unidade já tinha aprovado.
  perform public.materialize_round_allocations(p_round_id);

  -- O AVISO DE APROVAR: um por unidade que tem parte na rodada, para quem
  -- decide por ela (a régua de `can_decide_purchase`, 0294).
  for u in
    select a.clinic_id, c.name, c.type::text as type,
           count(*) as items, coalesce(sum(a.total_cents), 0)::bigint as total
      from public.purchase_allocations a
      join public.clinics c on c.id = a.clinic_id
     where a.round_id = p_round_id and a.status = 'pendente'
     group by a.clinic_id, c.name, c.type
  loop
    insert into public.notifications (user_id, clinic_id, title, body, link)
    select distinct d.user_id, u.clinic_id,
           'Compras — aprovar a compra da ' || u.name,
           'A Franqueadora fechou a negociação ' || coalesce(v_round_code, '')
             || ': ' || u.items || case when u.items = 1 then ' item' else ' itens' end
             || ' para a ' || u.name || ', total ' || public.brl(u.total)
             || '. Sem a aprovação o pedido não nasce. Abra Compras → Aprovar com a '
             || u.name || ' escolhida no menu.',
           '/compras/aprovar'
    from (
      select r.user_id from public.user_clinic_roles_all r
       where r.clinic_id = u.clinic_id
         and (r.role = 'unit_manager'
              or (r.role = 'finance_franchisor' and u.type = 'franchisor'))
      union
      -- Sem quem decida na unidade, o Admin Master (que sempre decide).
      select p.id from public.profiles p
       where p.is_admin_master
         and not exists (
           select 1 from public.user_clinic_roles_all r
            join public.profiles rp on rp.id = r.user_id and rp.is_active
            where r.clinic_id = u.clinic_id
              and (r.role = 'unit_manager'
                   or (r.role = 'finance_franchisor' and u.type = 'franchisor')))
    ) d
    join public.profiles p on p.id = d.user_id and p.is_active;
  end loop;

  return v_awarded;
end;
$$;

revoke execute on function public.close_purchase_round(uuid) from public, anon, authenticated;
grant execute on function public.close_purchase_round(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Conferência (só contagens — nenhum dado pessoal)
-- -----------------------------------------------------------------------------
select
  (select count(*) from pg_proc where proname = 'purchase_request_authors') as funcao_quem_pediu,
  (select count(*) from public.purchase_requests where status = 'enviada') as listas_esperando_rodada,
  (select count(*) from public.user_clinic_roles_all where role = 'purchaser') as compradores,
  (select count(*) from public.purchase_allocations where status = 'pendente') as itens_esperando_aprovacao;

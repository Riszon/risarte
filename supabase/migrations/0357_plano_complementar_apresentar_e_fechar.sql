-- =============================================================================
-- 0357 — O PLANO COMPLEMENTAR, PASSO 2: APRESENTAR, NEGOCIAR E FECHAR (AP64)
--
-- Decisões do dono (03/11/2026), C1–C4 em docs/comercial/AP63-AP64-PLANO.md §6:
--   * C1: o complemento tem a SUA apresentação (Meet, gravação, resumo) —
--     tabela nova `plan_complement_presentations`, uma por plano complementar.
--     A da venda original (`commercial_presentations`, uma por cliente) fica
--     intocada.
--   * C2: o contrato é o mesmo modelo de prestação, com os itens e o resumo do
--     complemento (o app escolhe o resumo pela negociação).
--   * C3: cobrança própria — a negociação do complemento é uma negociação
--     comum, com forma de pagamento e parcelas dela.
--   * C4: a coluna "Complementos" no quadro do Comercial (app).
-- O cliente FICA NA FASE 5 o tempo todo (V1).
--
-- O que muda no banco:
--   1) a tabela da apresentação do complemento;
--   2) aprovado o complemento, ele fica "aguardando apresentação" e os
--      Consultores são avisados (gatilho);
--   3) `accept_negotiation`: o complemento aceita na Fase 5 e confere o resumo
--      da apresentação DELE;
--   4) `_commercial_close_step_raw`: a venda do complemento fecha sem mexer na
--      fase do cliente (e o aviso à Recepção diz "agendar o complemento").
--
-- Nada apaga. Idempotente: rodar de novo não muda nada.
-- =============================================================================

-- 1) A apresentação do complemento (C1) ------------------------------------------
create table if not exists public.plan_complement_presentations (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null unique references public.treatment_plans (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  clinic_id uuid not null references public.clinics (id),
  consultant_id uuid references public.profiles (id),
  meet_link text,
  recording_url text,
  summary text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.plan_complement_presentations is
  'AP64 (0357): a apresentação PRÓPRIA de cada plano complementar (Meet, gravação, resumo). A da venda original fica em commercial_presentations.';

alter table public.plan_complement_presentations enable row level security;

-- As mesmas regras da apresentação da venda original (0151).
drop policy if exists plan_complement_presentations_select on public.plan_complement_presentations;
create policy plan_complement_presentations_select on public.plan_complement_presentations
  for select to authenticated
  using (
    public.is_admin_master()
    or clinic_id in (select public.user_full_access_clinic_ids())
    or public.is_network_viewer()
    or public.has_role_in_clinic(clinic_id,
         array['unit_manager','clinical_coordinator']::public.user_role[])
    or exists (select 1 from public.providers_with_access(clinic_id, 'commercial_consultant') p
               where p.user_id = (select auth.uid()))
    or exists (select 1 from public.providers_with_access(clinic_id, 'commercial_assistant') p
               where p.user_id = (select auth.uid()))
  );

drop policy if exists plan_complement_presentations_write on public.plan_complement_presentations;
create policy plan_complement_presentations_write on public.plan_complement_presentations
  for all to authenticated
  using (
    public.is_admin_master()
    or exists (select 1 from public.providers_with_access(clinic_id, 'commercial_consultant') p
               where p.user_id = (select auth.uid()))
  )
  with check (
    public.is_admin_master()
    or exists (select 1 from public.providers_with_access(clinic_id, 'commercial_consultant') p
               where p.user_id = (select auth.uid()))
  );

-- Só plano COMPLEMENTAR tem esta apresentação, e do mesmo cliente.
create or replace function public.plan_complement_presentation_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.treatment_plans tp
    where tp.id = new.plan_id and tp.client_id = new.client_id
      and tp.complement_of_plan_id is not null
  ) then
    raise exception 'NOT_A_COMPLEMENT';
  end if;
  return new;
end;
$$;
revoke execute on function public.plan_complement_presentation_check() from public, anon, authenticated;
drop trigger if exists plan_complement_presentation_check_trg on public.plan_complement_presentations;
create trigger plan_complement_presentation_check_trg
  before insert or update on public.plan_complement_presentations
  for each row execute function public.plan_complement_presentation_check();

-- 2) Aprovado o complemento: aguardando apresentação + aviso aos Consultores -----
create or replace function public.treatment_plan_complement_approved()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  if new.complement_of_plan_id is null then return new; end if;
  if not (new.status = 'approved' and old.status is distinct from 'approved') then return new; end if;

  update public.treatment_plans
     set lifecycle = 'aguardando_apresentacao', updated_at = now()
   where id = new.id and lifecycle is null;

  select full_name into v_name from public.clients where id = new.client_id;
  insert into public.notifications (user_id, clinic_id, title, body, link)
  select distinct pwa.user_id, new.clinic_id,
    'Plano complementar para apresentar',
    coalesce(v_name, 'Cliente') || ' está em tratamento e tem o plano complementar '
      || coalesce(new.complement_no::text, '') || ' aprovado pelo Coordenador. Apresente ao cliente.',
    '/comercial/' || new.client_id || '?complemento=' || new.id
  from public.providers_with_access(new.clinic_id, 'commercial_consultant') pwa;
  return new;
end;
$$;
revoke execute on function public.treatment_plan_complement_approved() from public, anon, authenticated;
drop trigger if exists treatment_plan_complement_approved_trg on public.treatment_plans;
create trigger treatment_plan_complement_approved_trg
  after update of status on public.treatment_plans
  for each row execute function public.treatment_plan_complement_approved();

-- 3) O aceite: o complemento na Fase 5, com o resumo DELE ------------------------
-- A definição em vigor (0348), com as trocas marcadas "AP64".
create or replace function public.accept_negotiation(p_negotiation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_neg record;
  v_client_phase public.journey_phase;
  v_client_name text;
  v_complemento boolean;
  v_user uuid := (select auth.uid());
begin
  select * into v_neg from public.plan_negotiations where id = p_negotiation_id;
  if v_neg.id is null then raise exception 'NOT_FOUND'; end if;

  select journey_phase into v_client_phase
  from public.clients where id = v_neg.client_id;
  -- AP64 (0357): o complemento é negociado com o cliente em tratamento (Fase 5).
  select tp.complement_of_plan_id is not null into v_complemento
  from public.treatment_plans tp where tp.id = v_neg.plan_id;
  v_complemento := coalesce(v_complemento, false);
  if v_complemento then
    if v_client_phase <> 'treatment_start' then raise exception 'WRONG_PHASE'; end if;
  elsif v_client_phase <> 'commercial_conversion' then
    raise exception 'WRONG_PHASE';
  end if;

  if not (
    public.is_admin_master()
    or exists (select 1 from public.providers_with_access(v_neg.clinic_id, 'commercial_consultant') p
               where p.user_id = v_user)
  ) then
    raise exception 'NOT_ALLOWED';
  end if;

  -- Rodada devolvida: o plano pode ter mudado no replanejamento — o Consultor
  -- precisa revisar e SALVAR a nova rodada antes de registrar o aceite.
  if v_neg.status = 'devolvida' then raise exception 'ROUND_CLOSED'; end if;
  if v_neg.status = 'aguardando_autorizacao' then raise exception 'AWAITING_AUTHORIZATION'; end if;
  if v_neg.rule_violations is not null and not v_neg.rule_authorized then
    raise exception 'NEEDS_AUTHORIZATION';
  end if;
  if v_neg.is_partial and coalesce(btrim(v_neg.partial_reason), '') = '' then
    raise exception 'PARTIAL_REASON_REQUIRED';
  end if;
  if v_neg.payment_method is null then raise exception 'PAYMENT_REQUIRED'; end if;

  -- 0348 (OC-00158): sem o resumo da apresentação, não há aceite. Ele é o
  -- registro do que o cliente ouviu e aceitou, e vai no contrato.
  -- AP64 (C1): o complemento tem a apresentação PRÓPRIA (e o resumo dela).
  if v_complemento then
    if not exists (
      select 1 from public.plan_complement_presentations cp
      where cp.plan_id = v_neg.plan_id
        and coalesce(btrim(cp.summary), '') <> ''
    ) then
      raise exception 'SUMMARY_REQUIRED';
    end if;
  elsif not exists (
    select 1 from public.commercial_presentations cp
    where cp.client_id = v_neg.client_id
      and coalesce(btrim(cp.summary), '') <> ''
  ) then
    raise exception 'SUMMARY_REQUIRED';
  end if;

  update public.plan_negotiations set
    status = 'aceita',
    consultant_id = coalesce(consultant_id, v_user),
    updated_at = now()
  where id = p_negotiation_id;

  select full_name into v_client_name from public.clients where id = v_neg.client_id;
  insert into public.notifications (user_id, clinic_id, title, body, link)
  select distinct pwa.user_id, v_neg.clinic_id,
    'Negociação aceita — preparar fechamento',
    coalesce(v_client_name, 'Cliente')
      || ' aceitou as condições. Prepare o contrato e o pagamento (fechamento).',
    case when v_complemento
         then '/comercial/' || v_neg.client_id || '?complemento=' || v_neg.plan_id || '&aba=fechamento'
         else '/apresentacao/' || v_neg.client_id end
  from public.providers_with_access(v_neg.clinic_id, 'commercial_assistant') pwa
  where pwa.user_id <> v_user;

  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values (v_user, v_neg.clinic_id, 'update', 'plan_negotiation_accept', p_negotiation_id::text, null);
end;
$$;

revoke execute on function public.accept_negotiation(uuid) from public, anon, authenticated;
grant execute on function public.accept_negotiation(uuid) to authenticated;

-- 4) O fechamento: a venda do complemento não mexe na fase -----------------------
-- A definição em vigor (0343), com as trocas marcadas "AP64". A porta
-- `commercial_close_step` (0343) chama esta e não muda.
create or replace function public._commercial_close_step_raw(
  p_negotiation_id uuid,
  p_step text,
  p_value boolean,
  p_user uuid,
  p_source text,
  p_package_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_neg record;
  v_sale public.commercial_sales;
  v_sale_id uuid;
  v_card uuid;
  v_user uuid := p_user;
  v_signed boolean;
  v_paid boolean;
  v_closed boolean := false;
  v_client_name text;
  v_reais text;
  v_label text;
  v_ortho uuid;
  v_complemento boolean;
begin
  select * into v_neg from public.plan_negotiations where id = p_negotiation_id;
  if v_neg.id is null then raise exception 'NOT_FOUND'; end if;
  -- AP64 (0357): a venda de um plano COMPLEMENTAR não mexe na fase do cliente.
  select tp.complement_of_plan_id is not null into v_complemento
  from public.treatment_plans tp where tp.id = v_neg.plan_id;
  v_complemento := coalesce(v_complemento, false);
  -- A guarda de quem clica vale para a marcação MANUAL; a assinatura digital
  -- chega pelo webhook (sem usuário logado) em nome de quem enviou o pacote.
  if p_source = 'manual' and not public.commercial_can_close(v_neg.clinic_id) then raise exception 'NOT_ALLOWED'; end if;
  if v_neg.status <> 'aceita' then raise exception 'NOT_ACCEPTED'; end if;
  -- 0202: 'payment' continua aceito como apelido de 'payment_confirmed' para
  -- não quebrar chamada antiga em cache do navegador.
  if p_step not in ('contract','payment','payment_issued','payment_confirmed') then
    raise exception 'INVALID_STEP';
  end if;

  select * into v_sale from public.commercial_sales where negotiation_id = p_negotiation_id;
  if v_sale.id is null then
    insert into public.commercial_sales
      (negotiation_id, client_id, clinic_id, plan_id, final_cents)
    values (p_negotiation_id, v_neg.client_id, v_neg.clinic_id, v_neg.plan_id, v_neg.final_cents)
    returning * into v_sale;
  end if;
  v_sale_id := v_sale.id;

  if v_sale.closed_at is not null then raise exception 'ALREADY_CLOSED'; end if;

  if p_step = 'contract' then
    update public.commercial_sales set
      contract_signed = p_value,
      contract_signed_at = case when p_value then now() else null end,
      contract_signed_by = case when p_value then v_user else null end,
      -- ZS3 (0343): de onde veio a marcação, e qual pacote assinou.
      contract_signed_source = case when p_value then p_source else null end,
      contract_signature_package_id = case when p_value then p_package_id else null end,
      final_cents = v_neg.final_cents, updated_at = now()
    where id = v_sale_id;
    v_label := 'Contrato ' || case when p_source = 'assinatura_digital' then '(assinatura digital) ' else '' end;
  elsif p_step = 'payment_issued' then
    update public.commercial_sales set
      payment_issued = p_value,
      payment_issued_at = case when p_value then now() else null end,
      payment_issued_by = case when p_value then v_user else null end,
      -- Mesma regra da venda direta (§7.6): valor zerado pelo programa não tem
      -- o que cobrar — emitir já confirma.
      payment_confirmed = case when p_value and coalesce(v_neg.final_cents, 0) <= 0
                               then true else payment_confirmed end,
      payment_confirmed_at = case when p_value and coalesce(v_neg.final_cents, 0) <= 0
                                  then now() else payment_confirmed_at end,
      payment_confirmed_by = case when p_value and coalesce(v_neg.final_cents, 0) <= 0
                                  then v_user else payment_confirmed_by end,
      final_cents = v_neg.final_cents, updated_at = now()
    where id = v_sale_id;
    v_label := 'Cobrança ';
  else
    update public.commercial_sales set
      payment_confirmed = p_value,
      payment_confirmed_at = case when p_value then now() else null end,
      payment_confirmed_by = case when p_value then v_user else null end,
      final_cents = v_neg.final_cents, updated_at = now()
    where id = v_sale_id;
    v_label := 'Pagamento ';
  end if;

  select contract_signed, payment_confirmed into v_signed, v_paid
  from public.commercial_sales where id = v_sale_id;

  v_card := public.commercial_ensure_card(v_neg.client_id);
  perform public.commercial_log_card_event(v_card, v_neg.client_id, v_neg.clinic_id,
    'fechamento_passo',
    v_label || case when p_value then 'confirmado' else 'desmarcado' end);

  -- REGRA DE OURO, inalterada: assinado + pagamento CONFIRMADO = venda.
  if v_signed and v_paid then
    update public.commercial_sales set closed_at = now(), updated_at = now()
    where id = v_sale_id;
    v_closed := true;

    -- AP64: o cliente do complemento já está em tratamento — a fase não muda.
    if not v_complemento then
      update public.journey_phase_history set exited_at = now()
      where client_id = v_neg.client_id and exited_at is null;
      insert into public.journey_phase_history (client_id, clinic_id, phase, moved_by)
      values (v_neg.client_id, v_neg.clinic_id, 'treatment_start', v_user);
      update public.clients set journey_phase = 'treatment_start', phase_entered_at = now()
      where id = v_neg.client_id;
    end if;

    select full_name into v_client_name from public.clients where id = v_neg.client_id;
    v_reais := 'R$ ' || (v_neg.final_cents / 100)::text || ',' ||
               lpad((v_neg.final_cents % 100)::text, 2, '0');

    perform public.commercial_log_card_event(v_card, v_neg.client_id, v_neg.clinic_id,
      'venda_concluida',
      case when v_complemento then 'VENDA DO COMPLEMENTO CONCLUÍDA — ' else 'VENDA CONCLUÍDA — ' end
        || v_reais || ' (contrato assinado + pagamento)');

    insert into public.notifications (user_id, clinic_id, title, body, link)
    select ucr.user_id, v_neg.clinic_id,
      case when v_complemento then 'Complemento fechado — agendar' else 'FECHAMENTO! Iniciar tratamento' end,
      coalesce(v_client_name, 'Cliente')
        || case when v_complemento
                then ' fechou o plano complementar. Agende os novos atendimentos junto com o tratamento em andamento.'
                else ' fechou o plano. Fale com o cliente, dê as boas-vindas e agende o início do tratamento.' end,
      '/agenda?cliente=' || v_neg.client_id
    from public.user_clinic_roles ucr
    where ucr.clinic_id = v_neg.clinic_id and ucr.role = 'receptionist'
      and ucr.user_id is distinct from v_user;

    insert into public.notifications (user_id, clinic_id, title, body, link)
    select ucr.user_id, v_neg.clinic_id,
      'Novo fechamento — acompanhar tratamento',
      coalesce(v_client_name, 'Cliente')
        || ' fechou o plano e vai iniciar o tratamento. Acompanhe a execução com excelência.',
      '/prontuarios/' || v_neg.client_id
    from public.user_clinic_roles ucr
    where ucr.clinic_id = v_neg.clinic_id and ucr.role = 'clinical_coordinator'
      and ucr.user_id is distinct from v_user;

    insert into public.notifications (user_id, clinic_id, title, body, link)
    select ucr.user_id, v_neg.clinic_id,
      'Venda fechada — ' || v_reais,
      coalesce(v_client_name, 'Cliente') || ' — venda de ' || v_reais
        || ' concluída (contrato assinado e pagamento confirmado).',
      '/comercial'
    from public.user_clinic_roles ucr
    where ucr.clinic_id = v_neg.clinic_id and ucr.role = 'unit_manager'
      and ucr.user_id is distinct from v_user;

    -- ORTO8 (0334): venda com ortodontia → o caso nasce aqui. Nunca derruba o
    -- fechamento: se a ortodontia falhar, fica o aviso no log do banco.
    begin
      v_ortho := public._ortho_open_from_sale(p_negotiation_id);
    exception when others then
      raise warning '_ortho_open_from_sale (%): %', p_negotiation_id, sqlerrm;
    end;
  end if;

  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values (v_user, v_neg.clinic_id, 'update', 'commercial_sale', p_negotiation_id::text,
    jsonb_build_object('step', p_step, 'value', p_value, 'closed', v_closed,
                       'ortho_case_id', v_ortho, 'source', p_source, 'package_id', p_package_id));

  return jsonb_build_object('signed', v_signed, 'paid', v_paid, 'closed', v_closed,
                            'ortho_case_id', v_ortho);
end;
$$;

revoke execute on function public._commercial_close_step_raw(uuid, text, boolean, uuid, text, uuid) from public, anon, authenticated;

select public.audit_attach_all();

-- Conferência (só leitura) ------------------------------------------------------
select
  to_regclass('public.plan_complement_presentations') is not null as tabela_existe,
  (select count(*) from pg_trigger
    where tgname in ('plan_complement_presentation_check_trg', 'treatment_plan_complement_approved_trg')
      and not tgisinternal) as gatilhos_esperado_2,
  position('v_complemento' in pg_get_functiondef('public.accept_negotiation(uuid)'::regprocedure)) > 0
    and position('v_complemento' in pg_get_functiondef('public._commercial_close_step_raw(uuid, text, boolean, uuid, text, uuid)'::regprocedure)) > 0
    as aceite_e_fechamento_conhecem_o_complemento,
  has_function_privilege('anon', 'public.accept_negotiation(uuid)', 'execute') as sem_login_aceita_esperado_false;

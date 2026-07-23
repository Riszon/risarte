-- =============================================================================
-- Risarte Odontologia — Migration 0154 (Módulo Comercial — COM4: Fechamento)
-- Regra de ouro: só é VENDA com contrato ASSINADO **e** pagamento CONFIRMADO.
-- Ver docs/COMERCIAL.md §2 (6/7).
--
-- 1) commercial_sales — o fechamento de uma negociação aceita: marcação manual
--    (manual-primeiro) de contrato assinado e pagamento confirmado. Quando os
--    dois estão marcados, a venda é concluída: o cliente vai à Fase 5
--    (Aguardando iniciar tratamento) e dispara os avisos do fechamento.
-- 2) RPC commercial_close_step — marca/desmarca cada passo; ao fechar, move
--    4→5 (inline: o trigger 0017 seta "awaiting_treatment_start") e notifica a
--    Recepção (pop-up forte), o Coordenador e o Gerente (com o VALOR).
-- 3) trg_mark_in_treatment (0110) recriada: ao iniciar o tratamento (1ª sessão),
--    além de virar "Em Tratamento", NOTIFICA o Consultor (o cliente sai da sua
--    lista ativa) e o Gerente.
-- Idempotente.
-- =============================================================================

-- 1) Fechamento -----------------------------------------------------------------
create table if not exists public.commercial_sales (
  id uuid primary key default gen_random_uuid(),
  negotiation_id uuid not null references public.plan_negotiations (id) on delete cascade,
  client_id uuid not null references public.clients (id),
  clinic_id uuid not null references public.clinics (id),
  plan_id uuid references public.treatment_plans (id),
  final_cents integer not null default 0,
  contract_signed boolean not null default false,
  contract_signed_at timestamptz,
  contract_signed_by uuid references public.profiles (id),
  payment_confirmed boolean not null default false,
  payment_confirmed_at timestamptz,
  payment_confirmed_by uuid references public.profiles (id),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (negotiation_id)
);
create index if not exists commercial_sales_client_idx
  on public.commercial_sales (client_id);

alter table public.commercial_sales enable row level security;

-- Leitura: mesma regra da negociação (gestão/rede/equipe da unidade + comercial
-- com escopo). Escrita direta: Admin (o resto passa pela RPC security definer).
drop policy if exists "commercial_sales_select" on public.commercial_sales;
create policy "commercial_sales_select" on public.commercial_sales
  for select to authenticated
  using (
    public.is_admin_master()
    or clinic_id in (select public.user_full_access_clinic_ids())
    or public.is_network_viewer()
    or public.has_role_in_clinic(clinic_id,
         array['unit_manager','clinical_coordinator','receptionist']::public.user_role[])
    or exists (select 1 from public.providers_with_access(clinic_id, 'commercial_consultant') p
               where p.user_id = (select auth.uid()))
    or exists (select 1 from public.providers_with_access(clinic_id, 'commercial_assistant') p
               where p.user_id = (select auth.uid()))
  );

drop policy if exists "commercial_sales_write" on public.commercial_sales;
create policy "commercial_sales_write" on public.commercial_sales
  for all to authenticated
  using (public.is_admin_master())
  with check (public.is_admin_master());

-- Quem pode fechar: Admin, Gerente, Consultor OU Assistente com escopo.
create or replace function public.commercial_can_close(p_clinic_id uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select
    public.is_admin_master()
    or public.has_role_in_clinic(p_clinic_id, array['unit_manager']::public.user_role[])
    or exists (select 1 from public.providers_with_access(p_clinic_id, 'commercial_consultant') p
               where p.user_id = (select auth.uid()))
    or exists (select 1 from public.providers_with_access(p_clinic_id, 'commercial_assistant') p
               where p.user_id = (select auth.uid()));
$$;

-- 2) Marca um passo do fechamento; ao completar os dois, conclui a venda. ------
create or replace function public.commercial_close_step(
  p_negotiation_id uuid,
  p_step text,          -- 'contract' | 'payment'
  p_value boolean
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
  v_user uuid := (select auth.uid());
  v_signed boolean;
  v_paid boolean;
  v_closed boolean := false;
  v_client_name text;
  v_reais text;
begin
  select * into v_neg from public.plan_negotiations where id = p_negotiation_id;
  if v_neg.id is null then raise exception 'NOT_FOUND'; end if;
  if not public.commercial_can_close(v_neg.clinic_id) then raise exception 'NOT_ALLOWED'; end if;
  if v_neg.status <> 'aceita' then raise exception 'NOT_ACCEPTED'; end if;
  if p_step not in ('contract','payment') then raise exception 'INVALID_STEP'; end if;

  -- Garante o registro de fechamento (com o valor final da negociação).
  select * into v_sale from public.commercial_sales where negotiation_id = p_negotiation_id;
  if v_sale.id is null then
    insert into public.commercial_sales
      (negotiation_id, client_id, clinic_id, plan_id, final_cents)
    values (p_negotiation_id, v_neg.client_id, v_neg.clinic_id, v_neg.plan_id, v_neg.final_cents)
    returning * into v_sale;
  end if;
  v_sale_id := v_sale.id;

  -- Venda já concluída não muda mais (protege a regra de ouro já cumprida).
  if v_sale.closed_at is not null then raise exception 'ALREADY_CLOSED'; end if;

  if p_step = 'contract' then
    update public.commercial_sales set
      contract_signed = p_value,
      contract_signed_at = case when p_value then now() else null end,
      contract_signed_by = case when p_value then v_user else null end,
      final_cents = v_neg.final_cents,
      updated_at = now()
    where id = v_sale_id
    returning contract_signed, payment_confirmed into v_signed, v_paid;
  else
    update public.commercial_sales set
      payment_confirmed = p_value,
      payment_confirmed_at = case when p_value then now() else null end,
      payment_confirmed_by = case when p_value then v_user else null end,
      final_cents = v_neg.final_cents,
      updated_at = now()
    where id = v_sale_id
    returning contract_signed, payment_confirmed into v_signed, v_paid;
  end if;

  -- REGRA DE OURO: assinado E pago → venda concluída.
  if v_signed and v_paid then
    update public.commercial_sales set closed_at = now(), updated_at = now()
    where id = v_sale_id;
    v_closed := true;

    -- Move 4→5 inline (o trigger 0017 seta "awaiting_treatment_start").
    update public.journey_phase_history set exited_at = now()
    where client_id = v_neg.client_id and exited_at is null;
    insert into public.journey_phase_history (client_id, clinic_id, phase, moved_by)
    values (v_neg.client_id, v_neg.clinic_id, 'treatment_start', v_user);
    update public.clients set journey_phase = 'treatment_start', phase_entered_at = now()
    where id = v_neg.client_id;

    select full_name into v_client_name from public.clients where id = v_neg.client_id;
    v_reais := 'R$ ' || (v_neg.final_cents / 100)::text || ',' ||
               lpad((v_neg.final_cents % 100)::text, 2, '0');

    -- Recepção — pop-up FORTE (o TreatmentStartPopup escuta "iniciar tratamento").
    insert into public.notifications (user_id, clinic_id, title, body, link)
    select ucr.user_id, v_neg.clinic_id,
      'FECHAMENTO! Iniciar tratamento',
      coalesce(v_client_name, 'Cliente')
        || ' fechou o plano. Fale com o cliente, dê as boas-vindas e agende o início do tratamento.',
      '/agenda?cliente=' || v_neg.client_id
    from public.user_clinic_roles ucr
    where ucr.clinic_id = v_neg.clinic_id and ucr.role = 'receptionist'
      and ucr.user_id is distinct from v_user;

    -- Coordenador Clínico — acompanha a execução do tratamento.
    insert into public.notifications (user_id, clinic_id, title, body, link)
    select ucr.user_id, v_neg.clinic_id,
      'Novo fechamento — acompanhar tratamento',
      coalesce(v_client_name, 'Cliente')
        || ' fechou o plano e vai iniciar o tratamento. Acompanhe a execução com excelência.',
      '/prontuarios/' || v_neg.client_id
    from public.user_clinic_roles ucr
    where ucr.clinic_id = v_neg.clinic_id and ucr.role = 'clinical_coordinator'
      and ucr.user_id is distinct from v_user;

    -- Gerente — com o VALOR da venda.
    insert into public.notifications (user_id, clinic_id, title, body, link)
    select ucr.user_id, v_neg.clinic_id,
      'Venda fechada — ' || v_reais,
      coalesce(v_client_name, 'Cliente') || ' — venda de ' || v_reais
        || ' concluída (contrato assinado e pagamento confirmado).',
      '/comercial'
    from public.user_clinic_roles ucr
    where ucr.clinic_id = v_neg.clinic_id and ucr.role = 'unit_manager'
      and ucr.user_id is distinct from v_user;
  end if;

  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values (v_user, v_neg.clinic_id, 'update', 'commercial_sale', p_negotiation_id::text,
    jsonb_build_object('step', p_step, 'value', p_value, 'closed', v_closed));

  return jsonb_build_object('signed', v_signed, 'paid', v_paid, 'closed', v_closed);
end;
$$;

revoke all on function public.commercial_can_close(uuid) from public;
revoke all on function public.commercial_close_step(uuid, text, boolean) from public;
grant execute on function public.commercial_close_step(uuid, text, boolean) to authenticated;

-- 3) 1ª sessão concluída → "Em Tratamento" + avisa Consultor e Gerente. --------
create or replace function public.trg_mark_in_treatment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic uuid;
  v_client_name text;
  v_user uuid := (select auth.uid());
begin
  if new.status = 'done' and (old.status is distinct from 'done') then
    update public.clients
    set journey_status = 'in_treatment'
    where id = new.client_id
      and journey_phase = 'treatment_start'
      and journey_status = 'awaiting_treatment_start';

    -- Só quando REALMENTE virou "em tratamento" agora (1 linha afetada acima).
    if found then
      select clinic_id, full_name into v_clinic, v_client_name
      from public.clients where id = new.client_id;

      -- Consultor(es) — o cliente sai da lista ativa do comercial.
      insert into public.notifications (user_id, clinic_id, title, body, link)
      select distinct pwa.user_id, v_clinic,
        'Tratamento iniciado',
        coalesce(v_client_name, 'Cliente')
          || ' iniciou o tratamento (1ª sessão concluída). Sai da sua lista ativa do comercial.',
        '/comercial'
      from public.providers_with_access(v_clinic, 'commercial_consultant') pwa
      where pwa.user_id is distinct from v_user;

      -- Gerente — acompanhamento do funil.
      insert into public.notifications (user_id, clinic_id, title, body, link)
      select ucr.user_id, v_clinic,
        'Tratamento iniciado',
        coalesce(v_client_name, 'Cliente') || ' iniciou o tratamento.',
        '/comercial'
      from public.user_clinic_roles ucr
      where ucr.clinic_id = v_clinic and ucr.role = 'unit_manager'
        and ucr.user_id is distinct from v_user;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists mark_in_treatment on public.treatment_sessions;
create trigger mark_in_treatment
  after update of status on public.treatment_sessions
  for each row
  execute function public.trg_mark_in_treatment();

-- =============================================================================
-- 0208 — O HISTÓRICO DO PLANO PASSA A REGISTRAR O COMERCIAL
-- -----------------------------------------------------------------------------
-- O dono abriu o "Histórico do plano" de um plano JÁ VENDIDO E CANCELADO e viu
-- só quatro linhas: criado, enviado para aprovação, aprovado, enviado ao
-- Comercial. Depois disso, silêncio — como se o plano tivesse parado ali.
--
-- A tabela `treatment_plan_events` existia desde a 0148, mas **só o clínico
-- escrevia nela**. Nada do comercial — aceite, código de venda, fechamento,
-- cancelamento — chegava ao histórico. Quem abrisse a ficha meses depois não
-- conseguiria contar a história do caso.
--
-- Registro por GATILHO, não dentro de cada função: assim pega TODOS os
-- caminhos, inclusive os que ainda vão existir, e nenhuma função nova precisa
-- lembrar de registrar. Foi esquecer disso que criou o buraco.
--
-- E o CÓDIGO DA VENDA entra em cada evento: é ele que amarra plano, cobranças,
-- termo e histórico. Evento sem código obriga a garimpar em três telas.
-- Idempotente.
-- =============================================================================

create or replace function public.log_plan_event(
  p_plan_id uuid,
  p_clinic_id uuid,
  p_type text,
  p_description text,
  p_actor uuid default null
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.treatment_plan_events
    (plan_id, clinic_id, event_type, description, actor_id)
  select p_plan_id, p_clinic_id, p_type, p_description,
         coalesce(p_actor, (select auth.uid()))
  where p_plan_id is not null;
$$;

-- -----------------------------------------------------------------------------
-- 1) A NEGOCIAÇÃO: aceite, autorização, código, cancelamento
-- -----------------------------------------------------------------------------
create or replace function public.log_negotiation_plan_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text := coalesce(new.code, '(sem código)');
begin
  -- O código nasce no fechamento: é o marco que amarra tudo.
  if new.code is not null and old.code is distinct from new.code then
    perform public.log_plan_event(
      new.plan_id, new.clinic_id, 'codigo_venda',
      'Código de venda gerado: ' || new.code);
  end if;

  if new.status is distinct from old.status then
    if new.status = 'aceita' then
      perform public.log_plan_event(
        new.plan_id, new.clinic_id, 'venda_aceita',
        'Cliente ACEITOU as condições — ' || v_code);
    elsif new.status = 'aguardando_autorizacao' then
      perform public.log_plan_event(
        new.plan_id, new.clinic_id, 'aguardando_autorizacao',
        'Negociação fora da regra — aguardando autorização do Gerente ('
          || v_code || ')');
    elsif new.status = 'perdida' then
      perform public.log_plan_event(
        new.plan_id, new.clinic_id, 'venda_perdida',
        'Negociação marcada como PERDIDA — ' || v_code);
    elsif new.status = 'cancelada' then
      perform public.log_plan_event(
        new.plan_id, new.clinic_id, 'venda_cancelada',
        'Plano CANCELADO — ' || v_code);
    elsif new.status = 'devolvida' then
      perform public.log_plan_event(
        new.plan_id, new.clinic_id, 'devolvida_planejamento',
        'Devolvida ao Centro de Planejamento — ' || v_code);
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists plan_negotiations_log_event on public.plan_negotiations;
create trigger plan_negotiations_log_event
  after update on public.plan_negotiations
  for each row execute function public.log_negotiation_plan_event();

-- -----------------------------------------------------------------------------
-- 2) O FECHAMENTO: cada passo e a venda concluída
-- -----------------------------------------------------------------------------
create or replace function public.log_sale_plan_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text;
  v_reais text;
begin
  select coalesce(n.code, '(sem código)') into v_code
  from public.plan_negotiations n where n.id = new.negotiation_id;

  v_reais := 'R$ ' || (coalesce(new.final_cents, 0) / 100)::text || ',' ||
             lpad((coalesce(new.final_cents, 0) % 100)::text, 2, '0');

  if new.contract_signed and not coalesce(old.contract_signed, false) then
    perform public.log_plan_event(new.plan_id, new.clinic_id, 'contrato_assinado',
      'Contrato assinado — ' || v_code);
  end if;
  if new.payment_issued and not coalesce(old.payment_issued, false) then
    perform public.log_plan_event(new.plan_id, new.clinic_id, 'cobranca_emitida',
      'Cobrança emitida — ' || v_code);
  end if;
  if new.payment_confirmed and not coalesce(old.payment_confirmed, false) then
    perform public.log_plan_event(new.plan_id, new.clinic_id, 'pagamento_confirmado',
      'Pagamento confirmado — ' || v_code);
  end if;
  if new.closed_at is not null and old.closed_at is null then
    perform public.log_plan_event(new.plan_id, new.clinic_id, 'venda_concluida',
      'VENDA CONCLUÍDA — ' || v_code || ' · ' || v_reais);
  end if;
  if new.cancelled_at is not null and old.cancelled_at is null then
    perform public.log_plan_event(new.plan_id, new.clinic_id, 'venda_cancelada',
      'Venda cancelada — ' || v_code
        || coalesce(' · ' || new.cancel_reason, ''));
  end if;

  return new;
end;
$$;

drop trigger if exists commercial_sales_log_event on public.commercial_sales;
create trigger commercial_sales_log_event
  after update on public.commercial_sales
  for each row execute function public.log_sale_plan_event();

-- -----------------------------------------------------------------------------
-- 3) O TERMO DE CANCELAMENTO: com o acerto de contas no texto
-- -----------------------------------------------------------------------------
create or replace function public.log_cancellation_plan_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_neg_code text;
begin
  if new.status = 'efetivado' and old.status is distinct from 'efetivado' then
    select coalesce(n.code, '(sem código)') into v_neg_code
    from public.plan_negotiations n where n.id = new.negotiation_id;

    perform public.log_plan_event(
      new.plan_id, new.clinic_id, 'cancelamento_efetivado',
      'Cancelamento efetivado — venda ' || v_neg_code
        || ', termo ' || coalesce(new.code, '')
        || ' · ' || new.reason
        || case when new.client_owes_cents > 0
                then '. Paciente deve R$ ' || (new.client_owes_cents / 100)::text
                when new.clinic_refunds_cents > 0
                then '. Clínica devolve R$ ' || (new.clinic_refunds_cents / 100)::text
                else '. Sem saldo entre as partes' end);
  end if;
  if new.status = 'assinado' and old.status is distinct from 'assinado' then
    perform public.log_plan_event(
      new.plan_id, new.clinic_id, 'termo_cancelamento_assinado',
      'Termo de cancelamento ' || coalesce(new.code, '') || ' assinado pelo paciente');
  end if;
  return new;
end;
$$;

drop trigger if exists plan_cancellations_log_event on public.plan_cancellations;
create trigger plan_cancellations_log_event
  after update on public.plan_cancellations
  for each row execute function public.log_cancellation_plan_event();

-- -----------------------------------------------------------------------------
-- 4) REPARO: o que já aconteceu entra no histórico com a data verdadeira
-- -----------------------------------------------------------------------------
-- Sem isto, os planos já vendidos continuariam com a história truncada.
insert into public.treatment_plan_events
  (plan_id, clinic_id, event_type, description, created_at)
select n.plan_id, n.clinic_id, 'codigo_venda',
       'Código de venda gerado: ' || n.code, n.updated_at
from public.plan_negotiations n
where n.code is not null and n.plan_id is not null
  and not exists (
    select 1 from public.treatment_plan_events e
    where e.plan_id = n.plan_id and e.event_type = 'codigo_venda');

insert into public.treatment_plan_events
  (plan_id, clinic_id, event_type, description, created_at)
select n.plan_id, n.clinic_id, 'venda_concluida',
       'VENDA CONCLUÍDA — ' || coalesce(n.code, '(sem código)')
         || ' · R$ ' || (coalesce(s.final_cents, 0) / 100)::text,
       s.closed_at
from public.commercial_sales s
join public.plan_negotiations n on n.id = s.negotiation_id
where s.closed_at is not null and n.plan_id is not null
  and not exists (
    select 1 from public.treatment_plan_events e
    where e.plan_id = n.plan_id and e.event_type = 'venda_concluida');

insert into public.treatment_plan_events
  (plan_id, clinic_id, event_type, description, created_at)
select c.plan_id, c.clinic_id, 'cancelamento_efetivado',
       'Cancelamento efetivado — venda ' || coalesce(n.code, '(sem código)')
         || ', termo ' || coalesce(c.code, '') || ' · ' || c.reason,
       c.applied_at
from public.plan_cancellations c
join public.plan_negotiations n on n.id = c.negotiation_id
where c.status = 'efetivado' and c.plan_id is not null
  and not exists (
    select 1 from public.treatment_plan_events e
    where e.plan_id = c.plan_id and e.event_type = 'cancelamento_efetivado');

select
  (select count(*) from public.treatment_plan_events) as eventos_no_historico,
  (select count(*) from public.treatment_plan_events
    where event_type = 'codigo_venda') as eventos_de_codigo,
  (select count(*) from public.treatment_plan_events
    where event_type = 'cancelamento_efetivado') as eventos_de_cancelamento;

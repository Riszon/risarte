-- =============================================================================
-- 0193 — FIN2.4: fechamento da renegociação (mesmas etapas da venda)
-- -----------------------------------------------------------------------------
-- O dono pediu que a renegociação emitisse contrato (ZapSign) e cobrança
-- (ASAAS), "como é feito no fechamento das vendas". Ao verificar, o fechamento
-- das vendas do core NÃO chama ZapSign nem ASAAS: ele marca três etapas À MÃO
-- (contrato assinado / cobrança emitida / pagamento confirmado). As integrações
-- reais só existem no módulo Empresarial.
--
-- Decisão do dono (04/08/2026): a renegociação ganha o MESMO fluxo manual de
-- hoje, para quando o core ganhar ZapSign/ASAAS as duas entrarem juntas sem
-- retrabalho.
--
-- A REGRA DE OURO vale aqui também: acordo assinado + pagamento confirmado =
-- renegociação fechada.
-- Idempotente.
-- =============================================================================

alter table public.payment_renegotiations
  add column if not exists contract_signed boolean not null default false,
  add column if not exists contract_signed_at timestamptz,
  add column if not exists contract_signed_by uuid references public.profiles (id),
  add column if not exists payment_issued boolean not null default false,
  add column if not exists payment_issued_at timestamptz,
  add column if not exists payment_issued_by uuid references public.profiles (id),
  add column if not exists payment_confirmed boolean not null default false,
  add column if not exists payment_confirmed_at timestamptz,
  add column if not exists payment_confirmed_by uuid references public.profiles (id),
  add column if not exists closed_at timestamptz;

comment on column public.payment_renegotiations.contract_signed is
  'Etapa manual, igual ao fechamento da venda. Quando o core ganhar ZapSign, '
  'é aqui que o retorno da assinatura entra.';

-- -----------------------------------------------------------------------------
-- Marcar (ou desmarcar) uma etapa
-- -----------------------------------------------------------------------------
-- Quem opera as etapas é quem atende no balcão — a mesma regra da baixa
-- (recepção, gerente, financeiro da franqueadora, admin). Criar a renegociação
-- continua sendo ato de gestão (can_renegotiate).
create or replace function public.renegotiation_close_step(
  p_id uuid,
  p_step text,      -- 'contract' | 'payment_issued' | 'payment_confirmed'
  p_value boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r record;
  v_user uuid := (select auth.uid());
  v_signed boolean;
  v_confirmed boolean;
begin
  select * into v_r from public.payment_renegotiations where id = p_id;
  if v_r.id is null then raise exception 'RENEGOTIATION_NOT_FOUND'; end if;
  if not public.can_receive_payment(v_r.clinic_id) then
    raise exception 'NOT_ALLOWED';
  end if;
  -- Renegociação que ainda espera autorização não tem o que assinar.
  if v_r.status <> 'aplicada' then raise exception 'NOT_APPLIED'; end if;
  if p_step not in ('contract', 'payment_issued', 'payment_confirmed') then
    raise exception 'INVALID_STEP';
  end if;

  if p_step = 'contract' then
    update public.payment_renegotiations set
      contract_signed = p_value,
      contract_signed_at = case when p_value then now() else null end,
      contract_signed_by = case when p_value then v_user else null end
    where id = p_id;
  elsif p_step = 'payment_issued' then
    update public.payment_renegotiations set
      payment_issued = p_value,
      payment_issued_at = case when p_value then now() else null end,
      payment_issued_by = case when p_value then v_user else null end
    where id = p_id;
  else
    update public.payment_renegotiations set
      payment_confirmed = p_value,
      payment_confirmed_at = case when p_value then now() else null end,
      payment_confirmed_by = case when p_value then v_user else null end
    where id = p_id;
  end if;

  select contract_signed, payment_confirmed into v_signed, v_confirmed
  from public.payment_renegotiations where id = p_id;

  -- Regra de ouro: assinado + confirmado = acordo fechado.
  update public.payment_renegotiations
     set closed_at = case when v_signed and v_confirmed then now() else null end
   where id = p_id;

  insert into public.audit_logs
    (user_id, clinic_id, action, entity_type, entity_id, details)
  values (v_user, v_r.clinic_id, 'update', 'renegotiation_close', p_id::text,
    jsonb_build_object('step', p_step, 'value', p_value,
                       'closed', v_signed and v_confirmed));
end;
$$;

grant execute on function public.renegotiation_close_step(uuid, text, boolean)
  to authenticated;

select count(*)::integer as renegociacoes from public.payment_renegotiations;

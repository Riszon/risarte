-- =============================================================================
-- 1013 — ESTORNAR A BAIXA DE UMA COBRANÇA (Risarte Empresarial)
-- =============================================================================
-- Relato OC-00058 (Franqueadora, 21/09/2026): *"ao baixar como pago a fatura do
-- empresarial, o sistema não permite realizar o estorno do pagamento"*.
--
-- **Não era regra — era ausência.** Existia `settle_billing` e mais nada: nem
-- função, nem botão, nem coluna para registrar um estorno. Quem baixasse a
-- cobrança errada ficava sem saída dentro do sistema.
--
-- O QUE A BAIXA FAZ, e portanto o que o estorno precisa desfazer:
--   1. calcula e grava o split (Risarte / RisLife);
--   2. marca PAID com a data do pagamento;
--   3. **pode reativar a empresa** que estava suspensa por inadimplência.
-- O terceiro item é o que torna isto mais que um "desmarcar": estornar sem
-- olhar a suspensão deixaria uma empresa devedora usando o benefício.
--
-- ⚠️ NADA SE APAGA — o estorno deixa rastro. A tabela já tinha esse hábito
-- (`cancelled_at`/`cancel_reason`/`cancelled_by`); o estorno segue o mesmo
-- padrão, com MOTIVO OBRIGATÓRIO. Baixa desfeita sem explicação é a que vira
-- discussão de memória três meses depois, quando o valor não fecha.

alter table empresarial.adhesion_billing
  add column if not exists reversed_at timestamptz,
  add column if not exists reversal_reason text,
  add column if not exists reversed_by uuid references public.profiles (id);

comment on column empresarial.adhesion_billing.reversed_at is
  'Quando a baixa foi estornada (1013). A cobrança volta a pendente/em atraso, mas o rastro do estorno fica.';

create or replace function empresarial.reverse_billing(
  p_billing_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bill record;
  v_motivo text := nullif(btrim(coalesce(p_reason, '')), '');
  v_user uuid := (select auth.uid());
  v_grace int := 5; -- o mesmo da checagem diária (`mark_overdue_and_suspend`)
begin
  select * into v_bill from empresarial.adhesion_billing where id = p_billing_id;
  if not found then raise exception 'BILLING_NOT_FOUND'; end if;

  -- Só se estorna o que foi pago. Cancelada e pendente não têm baixa a desfazer,
  -- e deixar passar criaria um "estorno" que não estorna nada — com rastro e
  -- tudo, enganando quem ler depois.
  if v_bill.status <> 'PAID' then raise exception 'NOT_PAID'; end if;
  if v_motivo is null then raise exception 'REASON_REQUIRED'; end if;

  -- A SITUAÇÃO VOLTA A SER A VERDADE DO VENCIMENTO (decisão do dono,
  -- 22/09/2026): vencida volta EM ATRASO, não "pendente". Voltar sempre como
  -- pendente esconderia o atraso e tiraria a cobrança dos alertas de
  -- inadimplência — exatamente onde ela precisa aparecer.
  --
  -- `today_br()` e não `current_date`: dia de negócio é data civil brasileira
  -- (§0d do CLAUDE.md). Das 21h à meia-noite o UTC já é amanhã, e uma cobrança
  -- que vence hoje voltaria marcada como vencida.
  update empresarial.adhesion_billing
     set status = case
           when due_date is not null and due_date < public.today_br() then 'OVERDUE'
           else 'PENDING'
         end,
         paid_at = null,
         split_risarte_cents = null,
         split_rislife_cents = null,
         reversed_at = now(),
         reversal_reason = v_motivo,
         reversed_by = v_user
   where id = p_billing_id;

  -- A EMPRESA VOLTA A RESPONDER PELO QUE DEVE. A baixa pode tê-la reativado;
  -- desfeita a baixa, a checagem roda de novo — só para ESTA empresa, e com a
  -- mesma carência de 5 dias da rotina diária. Sem isto, estornar seria um
  -- jeito silencioso de manter ativa uma empresa inadimplente.
  if exists (
    select 1 from empresarial.adhesion_billing b
     where b.company_id = v_bill.company_id
       and b.status = 'OVERDUE'
       and b.due_date is not null
       and b.due_date < public.today_br() - v_grace
  ) then
    update empresarial.companies
       set status = 'SUSPENDED', auto_suspended_at = now()
     where id = v_bill.company_id and status = 'ACTIVE';
  else
    -- Continua em dia: se estava suspensa pelo sistema, segue ativa.
    perform empresarial.refresh_company_suspension(v_bill.company_id);
  end if;

  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values (
    v_user, null, 'update', 'empresarial_billing', p_billing_id::text,
    jsonb_build_object('estorno', true, 'de', v_bill.status)
  );
end;
$$;

revoke all on function empresarial.reverse_billing(uuid, text) from public;
grant execute on function empresarial.reverse_billing(uuid, text) to authenticated;

comment on function empresarial.reverse_billing(uuid, text) is
  'Desfaz a baixa de uma cobrança do Empresarial: limpa pagamento e split, devolve a situação do vencimento (pendente/em atraso), reavalia a suspensão da empresa e guarda o motivo com quem estornou (1013).';

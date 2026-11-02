-- =============================================================================
-- 1038 — EMPRESARIAL: A ASSINATURA DIGITAL CHEGA AO FUNIL E À EMPRESA (ZS5)
-- -----------------------------------------------------------------------------
-- Plano ZS0 (docs/assinaturas/PLANO-ZS0.md §4.6 e §11, fase ZS5). O pacote de
-- assinatura mora no módulo do core (`public.signature_*`); aqui ficam os
-- EFEITOS dele no Empresarial:
--
--   1) O SELO SOZINHO. Pacote de empresa nascido no LEAD, com o contrato de
--      adesão (modelo de tipo `adhesion`), que fica ASSINADO por todos →
--      `commercial_leads.contract_signed_at` é marcado (só se ainda estava
--      vazio) e uma anotação entra no histórico do lead. Os gatilhos da 1010 e
--      da 1028 seguem valendo: com o boleto da implantação já pago, o cartão
--      vai para Fechamento (ganho) como sempre foi. O botão manual continua.
--   2) O CONTRATO ANTIGO ESPELHA O PACOTE. `empresarial.contracts` ganha
--      `package_id`; a aba Contratos da empresa grava a linha ao enviar, e a
--      situação dela acompanha o pacote (enviado, assinado, cancelado).
--
-- O efeito NUNCA derruba o pacote: falhou, fica `raise warning` no log do
-- banco e um evento `lead_seal_failed` no histórico do pacote.
--
-- O pacote nascido no lead aparece na empresa depois que ela é criada SEM
-- mexer no pacote (assinado não muda, 0340): a tela da empresa procura também
-- pelo lead de origem (`companies.origin_lead_id`).
--
-- Idempotente. Não apaga dado. Nenhuma tabela nova.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) `empresarial.contracts.package_id`
-- -----------------------------------------------------------------------------
alter table empresarial.contracts
  add column if not exists package_id uuid references public.signature_packages (id);

create unique index if not exists contracts_package_uidx
  on empresarial.contracts (package_id)
  where package_id is not null;

comment on column empresarial.contracts.package_id is
  'ZS5 (1038): o pacote de assinatura digital deste contrato. A situação da '
  'linha acompanha o pacote por gatilho (empresarial.signature_package_effects).';

-- -----------------------------------------------------------------------------
-- 2) Os efeitos do pacote no Empresarial
-- -----------------------------------------------------------------------------
create or replace function empresarial.signature_package_effects()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_has_adhesion boolean;
  v_sealed integer;
  v_contract_status text;
begin
  -- 2a) O selo do contrato no lead.
  if new.status = 'signed' and new.lead_id is not null then
    begin
      select exists (
        select 1 from public.signature_package_items i
          join public.signature_templates t on t.id = i.template_id
         where i.package_id = new.id and t.kind = 'adhesion'
      ) into v_has_adhesion;

      if v_has_adhesion then
        update empresarial.commercial_leads
           set contract_signed_at = coalesce(new.completed_at, now())
         where id = new.lead_id
           and contract_signed_at is null;
        get diagnostics v_sealed = row_count;

        if v_sealed > 0 then
          insert into empresarial.commercial_lead_activities (lead_id, author_id, kind, note)
          values (new.lead_id, new.sent_by, 'NOTE',
                  'Contrato assinado: marcado pela assinatura digital (pacote ' || new.number || ').');
          insert into public.signature_events (package_id, event_type, payload)
          values (new.id, 'lead_sealed', jsonb_build_object('lead_id', new.lead_id));
        end if;
      end if;
    exception when others then
      raise warning 'signature_package_effects: selo do lead (%): %', new.lead_id, sqlerrm;
      insert into public.signature_events (package_id, event_type, error)
      values (new.id, 'lead_seal_failed', left(sqlerrm, 300));
    end;
  end if;

  -- 2b) O contrato antigo acompanha o pacote.
  v_contract_status := case new.status
    when 'draft' then 'DRAFT'
    when 'sent' then 'SENT'
    when 'partially_signed' then 'SENT'
    when 'signed' then 'SIGNED'
    else 'CANCELLED'
  end;
  begin
    update empresarial.contracts
       set status = v_contract_status,
           sent_at = coalesce(sent_at, new.sent_at),
           signed_at = case when new.status = 'signed'
                            then coalesce(signed_at, new.completed_at, now())
                            else signed_at end
     where package_id = new.id
       and status is distinct from v_contract_status;
  exception when others then
    raise warning 'signature_package_effects: contrato (%): %', new.id, sqlerrm;
  end;

  return null;
end;
$fn$;

comment on function empresarial.signature_package_effects() is
  'ZS5 (1038): efeitos do pacote de assinatura no Empresarial. Assinado com o '
  'contrato de adesão e nascido no lead → marca contract_signed_at; e a linha '
  'de empresarial.contracts acompanha a situação do pacote. Nunca derruba o '
  'pacote (erro vira warning + evento).';

revoke execute on function empresarial.signature_package_effects()
  from public, anon, authenticated;

drop trigger if exists signature_packages_empresarial_effects
  on public.signature_packages;
create trigger signature_packages_empresarial_effects
  after update on public.signature_packages
  for each row
  when (new.audience = 'company' and old.status is distinct from new.status)
  execute function empresarial.signature_package_effects();

notify pgrst, 'reload schema';

-- -----------------------------------------------------------------------------
-- Conferência (só contagens, nenhum dado pessoal)
-- -----------------------------------------------------------------------------
select
  (select count(*) from information_schema.columns
    where table_schema = 'empresarial' and table_name = 'contracts' and column_name = 'package_id') as coluna_package_id,
  (select count(*) from pg_trigger
    where tgname = 'signature_packages_empresarial_effects' and not tgisinternal) as gatilho,
  has_function_privilege('anon', 'empresarial.signature_package_effects()', 'execute') as efeitos_sem_login,
  (select count(*) from empresarial.contracts where package_id is not null) as contratos_ligados;

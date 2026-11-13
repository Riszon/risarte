-- =============================================================================
-- 1044 — O INÍCIO DO CONTRATO NASCE NO 1º PAGAMENTO (OC-00012)
--
-- Relato (13/11/2026, PRODUÇÃO, dono): "na tela de boas-vindas da empresa
-- aparece que não tem data de início da carência, sendo que o contrato já foi
-- assinado e já foi pago também". Lido no banco: Cooperativa Recicla Brasil,
-- contrato assinado em 10/11, 1ª cobrança paga em 11/11, empresa criada em
-- 12/11 — e `companies.contract_started_at` vazio. Esse campo (base da carência
-- da EMPRESA, 0097) só era preenchido à mão, no cadastro da empresa.
--
-- Decisão do dono (13/11/2026): a carência da empresa conta do 1º PAGAMENTO.
--
--   1) gatilho em `adhesion_billing`: a cobrança que vira PAGA preenche o
--      início do contrato com o dia (Brasil) do pagamento — só se ele estiver
--      VAZIO. Data digitada à mão nunca é sobrescrita. Vale para todo caminho
--      que dá baixa (tela, ASAAS, Financeiro), porque mora na tabela.
--   2) acerto: empresa com início vazio e cobrança já paga recebe o dia do
--      pagamento mais antigo (na produção, a Cooperativa — autorizado pelo
--      dono em 13/11/2026).
--
-- O gatilho é BLINDADO: se falhar, a baixa da cobrança segue (aviso no log),
-- como os gatilhos do Indica (2005). Idempotente. Não apaga nada.
-- =============================================================================

create or replace function empresarial.billing_starts_contract()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'PAID' and new.paid_at is not null
     and (tg_op = 'INSERT' or old.status is distinct from 'PAID') then
    begin
      update empresarial.companies
         set contract_started_at = (new.paid_at at time zone 'America/Sao_Paulo')::date
       where id = new.company_id
         and contract_started_at is null;
    exception when others then
      raise warning 'billing_starts_contract (cobrança %): %', new.id, sqlerrm;
    end;
  end if;
  return new;
end;
$$;
revoke execute on function empresarial.billing_starts_contract() from public, anon, authenticated;

comment on function empresarial.billing_starts_contract() is
  'OC-00012 (1044): a 1ª cobrança paga preenche companies.contract_started_at (base da carência da empresa) quando ele está vazio. Nunca sobrescreve a data digitada.';

drop trigger if exists billing_starts_contract on empresarial.adhesion_billing;
create trigger billing_starts_contract
  after insert or update of status, paid_at on empresarial.adhesion_billing
  for each row execute function empresarial.billing_starts_contract();

-- Acerto do que já foi pago antes desta migração (só onde está vazio).
update empresarial.companies c
   set contract_started_at = p.primeiro
  from (
    select b.company_id, min((b.paid_at at time zone 'America/Sao_Paulo')::date) as primeiro
      from empresarial.adhesion_billing b
     where b.status = 'PAID' and b.paid_at is not null
     group by b.company_id
  ) p
 where p.company_id = c.id
   and c.contract_started_at is null;

-- CONFERÊNCIA (só leitura). Esperado: gatilho = 1; empresas_pagas_sem_inicio = 0.
select
  (select count(*) from pg_trigger t
     join pg_class r on r.oid = t.tgrelid
     join pg_namespace n on n.oid = r.relnamespace
    where n.nspname = 'empresarial' and r.relname = 'adhesion_billing'
      and t.tgname = 'billing_starts_contract') as gatilho,
  (select count(*) from empresarial.companies c
    where c.contract_started_at is null
      and exists (select 1 from empresarial.adhesion_billing b
                   where b.company_id = c.id and b.status = 'PAID')) as empresas_pagas_sem_inicio;

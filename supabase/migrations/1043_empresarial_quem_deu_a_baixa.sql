-- =============================================================================
-- 1043 — EMPRESARIAL: QUEM DEU A BAIXA NA COBRANÇA (AP129)
--
-- A cobrança do Empresarial (`adhesion_billing`) guardava QUANDO foi paga
-- (`paid_at`), quem cancelou e quem estornou — mas não quem deu a baixa.
-- Segunda rodada do pedido do dono "quem lançou e quem deu baixa" (0372).
--
-- O QUE MUDA:
--   1) coluna `paid_by`;
--   2) um gatilho carimba a pessoa logada quando a cobrança vira PAGA, por
--      QUALQUER caminho (a baixa pela tela, o 1º pagamento do funil). Baixa
--      sem pessoa (webhook do ASAAS, rotina) fica sem nome — a tela diz "pelo
--      sistema". Quando a cobrança deixa de estar paga, o carimbo sai.
--   3) `empresarial.billing_settlers`: o nome de quem deu a baixa, para quem
--      enxerga a empresa (a regra de `profiles` só mostra colegas da unidade).
--
-- ⚠️ As cobranças JÁ pagas ficam sem nome ("autor não registrado"): o
-- sistema não guardou, e a migração não inventa.
--
-- Nada é apagado. Idempotente.
-- =============================================================================

alter table empresarial.adhesion_billing
  add column if not exists paid_by uuid references public.profiles (id) on delete set null;

comment on column empresarial.adhesion_billing.paid_by is
  'AP129 (1043): quem deu a baixa. Nulo = baixa sem pessoa (webhook, rotina) ou anterior a esta coluna.';

create or replace function empresarial.adhesion_billing_stamp_payer()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.status = 'PAID' then
    if tg_op = 'INSERT' or old.status is distinct from 'PAID' then
      new.paid_by := coalesce(new.paid_by, (select auth.uid()));
    end if;
  else
    new.paid_by := null;
  end if;
  return new;
end;
$$;
revoke execute on function empresarial.adhesion_billing_stamp_payer() from public, anon, authenticated;

drop trigger if exists adhesion_billing_stamp_payer on empresarial.adhesion_billing;
create trigger adhesion_billing_stamp_payer
  before insert or update of status on empresarial.adhesion_billing
  for each row execute function empresarial.adhesion_billing_stamp_payer();

create or replace function empresarial.billing_settlers(p_ids uuid[])
returns table (
  billing_id uuid,
  paid_by_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  select b.id, p.full_name::text
  from empresarial.adhesion_billing b
  join public.profiles p on p.id = b.paid_by
  where b.id = any(p_ids)
    and (
      public.is_admin_master()
      or empresarial.is_program_finance()
      or b.company_id in (select empresarial.accessible_company_ids())
    );
$$;

revoke execute on function empresarial.billing_settlers(uuid[]) from public, anon, authenticated;
grant execute on function empresarial.billing_settlers(uuid[]) to authenticated;

comment on function empresarial.billing_settlers(uuid[]) is
  'AP129: nome de quem deu a baixa em cada cobrança, para quem enxerga a empresa.';

-- CONFERÊNCIA (só leitura). Esperado: coluna = 1, gatilho = 1, funcao = 1,
-- anon_executa = false.
select
  (select count(*) from information_schema.columns
    where table_schema = 'empresarial' and table_name = 'adhesion_billing' and column_name = 'paid_by') as coluna,
  (select count(*) from pg_trigger where tgname = 'adhesion_billing_stamp_payer') as gatilho,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'empresarial' and p.proname = 'billing_settlers') as funcao,
  (select bool_or(has_function_privilege('anon', p.oid, 'execute'))
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'empresarial' and p.proname = 'billing_settlers') as anon_executa,
  (select count(*) from empresarial.adhesion_billing where status = 'PAID' and paid_by is null) as pagas_sem_nome;

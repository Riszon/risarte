-- 0403 — RECEBÍVEIS SÓ PARA QUEM VÊ O FINANCEIRO DO CLIENTE (aprovada pelo dono em 13/11/2026,
-- mantendo SDR e Coordenador no parcelamento da venda direta).
--
-- Achado de 13/11/2026 (treino, sessões das contas de teste): ASB, TSB, SDR,
-- Planner, Consultor, Assistente comercial e Comprador liam pela API as
-- parcelas, os recebimentos e as renegociações dos pacientes — a tela não
-- mostra nada disso a eles (aba Financeiro da ficha = `canSeeReceivables`).
-- A causa: as políticas de leitura liberavam `clinic_id in
-- user_full_access_clinic_ids()`, que é "qualquer papel que não seja dentista
-- nem RisLife" (inclui clínico, compras e o comercial de escopo "todas").
--
-- O RECORTE, igual à regra da tela:
--   * leem TUDO da unidade: Admin Master, Financeiro da Franqueadora, a equipe
--     da Franqueadora (`is_network_viewer`, já liberada hoje nas parcelas —
--     é quem abre /financeiro/recebiveis e o Painel da rede) e, NA unidade,
--     Gerente, Recepção (recebe no balcão) e Franqueado.
--   * leem SÓ o parcelamento DA VENDA que trabalham (linhas com
--     `negotiation_id` ou `direct_sale_id`), porque as telas do fechamento
--     dependem disso:
--       - Consultor e Assistente comercial (escopo deles): apresentação,
--         cockpit comercial, orçamento impresso, Vendas diretas;
--       - Planner: orçamento impresso (só negociação);
--       - SDR e Coordenador clínico: lista de Vendas diretas (só venda direta).
--   * os demais (ASB, TSB, Comprador, papéis sem relação) passam a ler ZERO.
--
-- `charges` e `payment_waivers` não mudam: a política delas já pergunta
-- "consegue ler a parcela?" e herda o recorte sozinha.
-- Toda função que grava ou calcula sobre estas tabelas é SECURITY DEFINER
-- (conferido no catálogo em 13/11/2026: nenhuma função comum nem visão lê
-- estas tabelas) — o selo, a baixa, o boleto e a régua não são afetados.
--
-- Idempotente. Sem tabela nova (nada para a auditoria).

-- 1) Quem vê o financeiro do cliente naquela unidade — a mesma regra do
--    `canSeeReceivables` da ficha, mais a equipe da Franqueadora.
create or replace function public.can_see_receivables(p_clinic_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_clinic_id is not null and (
    public.is_admin_master()
    or public.is_finance_franchisor()
    or public.is_network_viewer()
    or public.has_role_in_clinic(
         p_clinic_id,
         array['unit_manager', 'receptionist', 'franchisee']::public.user_role[])
  );
$$;
revoke execute on function public.can_see_receivables(uuid) from public, anon, authenticated;
grant execute on function public.can_see_receivables(uuid) to authenticated;

-- 2) Quem lê o parcelamento de UMA venda (negociação ou venda direta), sem
--    ver o resto do financeiro do cliente.
create or replace function public.can_see_sale_schedule(
  p_clinic_id uuid,
  p_negotiation_id uuid,
  p_direct_sale_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_clinic_id is not null
    and (p_negotiation_id is not null or p_direct_sale_id is not null)
    and (
      exists (select 1 from public.providers_with_access(p_clinic_id, 'commercial_consultant') p
               where p.user_id = (select auth.uid()))
      or exists (select 1 from public.providers_with_access(p_clinic_id, 'commercial_assistant') p
                  where p.user_id = (select auth.uid()))
      or (p_negotiation_id is not null and public.is_planner())
      or (p_direct_sale_id is not null and (
            public.has_role_in_clinic(p_clinic_id, array['clinical_coordinator']::public.user_role[])
            or exists (select 1 from public.providers_with_access(p_clinic_id, 'sdr') p
                        where p.user_id = (select auth.uid()))))
    );
$$;
revoke execute on function public.can_see_sale_schedule(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.can_see_sale_schedule(uuid, uuid, uuid) to authenticated;

-- 3) Parcelas.
drop policy if exists "payment_installments_select" on public.payment_installments;
create policy "payment_installments_select" on public.payment_installments
  for select to authenticated
  using (
    public.can_see_receivables(clinic_id)
    or public.can_see_sale_schedule(clinic_id, negotiation_id, direct_sale_id)
  );

-- 4) Recebimentos (a baixa no balcão, o estorno): só quem vê o financeiro.
drop policy if exists "payment_receipts_select" on public.payment_receipts;
create policy "payment_receipts_select" on public.payment_receipts
  for select to authenticated
  using (public.can_see_receivables(clinic_id));

-- 5) Renegociações (e o termo /renegociacoes/[id]/acordo): idem.
drop policy if exists "payment_renegotiations_select" on public.payment_renegotiations;
create policy "payment_renegotiations_select" on public.payment_renegotiations
  for select to authenticated
  using (public.can_see_receivables(clinic_id));

-- 6) Cobranças do Asaas (boleto/Pix) e dispensas: nasceram na 4004 herdando
--    "consegue ler a parcela?". Com o parcelamento da venda aberto ao
--    comercial, ao SDR e ao Coordenador, elas viriam junto — e nenhuma tela
--    deles lê estas tabelas (só a aba Financeiro e as ações de cobrança).
--    Passam a pedir o financeiro da unidade. (Tabelas criadas na faixa 4000;
--    a 4004 deve continuar NÃO recriando estas políticas — se recriar, volta
--    o vazamento. O teste `recebiveis-so-quem-ve-o-financeiro` reprova.)
drop policy if exists "charges_select" on public.charges;
create policy "charges_select" on public.charges
  for select to authenticated
  using (public.can_see_receivables(clinic_id));

drop policy if exists "payment_waivers_select" on public.payment_waivers;
create policy "payment_waivers_select" on public.payment_waivers
  for select to authenticated
  using (public.can_see_receivables(clinic_id));

-- Linha de conferência (rodar DEPOIS, no SQL Editor; esperado: 5 linhas, todas
-- com `usa_helper = true`):
-- select tablename, policyname,
--        qual like '%can_see_receivables%' as usa_helper
--   from pg_policies
--  where schemaname = 'public'
--    and tablename in ('payment_installments','payment_receipts','payment_renegotiations','charges','payment_waivers')
--    and cmd = 'SELECT'
--  order by 1;

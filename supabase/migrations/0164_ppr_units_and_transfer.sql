-- =============================================================================
-- Risarte Odontologia — Migration 0164 (PPR+ — unidade do beneficiário,
-- transferência de unidade e benefícios válidos na rede)
--
-- Regras passadas pelo dono em 25/07/2026:
--   1) O plano é da UNIDADE: cada beneficiário fica vinculado a uma unidade
--      (vai no cartão). A unidade do TITULAR é a unidade do plano.
--   2) Titular transferido de unidade: cancela o plano na unidade A e faz nova
--      adesão na B; a B "puxa" o plano anterior (inclusive os dependentes) para
--      sugerir a continuidade. Guardamos o vínculo entre as duas adesões.
--   3) O DEPENDENTE pode estar em unidade diferente do titular; se ele mudar de
--      unidade, só muda a informação (não recria o plano). O titular continua
--      responsável pelo contrato e pelo pagamento.
--   4) O beneficiário usa os benefícios em QUALQUER unidade da rede
--      (compartilhamento) — por isso a leitura do plano deixa de ser exclusiva
--      da unidade dona.
-- Idempotente.
-- =============================================================================

-- 1) Unidade do beneficiário + vínculo da transferência -------------------------
comment on column public.ppr_beneficiaries.clinic_id is
  'Unidade a que ESTE beneficiário pertence (pode ser diferente da unidade do plano). Aparece no cartão.';

alter table public.ppr_memberships
  add column if not exists transferred_from_id uuid references public.ppr_memberships (id);
comment on column public.ppr_memberships.transferred_from_id is
  'Adesão anterior (outra unidade) da qual esta é a continuidade.';

-- Uso do benefício ligado à venda direta que o consumiu (para desfazer se a
-- venda for cancelada).
alter table public.ppr_benefit_usages
  add column if not exists direct_sale_id uuid references public.direct_sales (id) on delete set null;

create index if not exists ppr_beneficiaries_clinic_idx
  on public.ppr_beneficiaries (clinic_id);
create index if not exists ppr_memberships_transfer_idx
  on public.ppr_memberships (transferred_from_id);

-- 2) Leitura em qualquer unidade (regra 4) --------------------------------------
-- Beneficiário: enxerga quem é da unidade do PLANO, quem é da unidade do
-- BENEFICIÁRIO e quem tem acesso ao histórico do cliente (compartilhamento).
drop policy if exists "ppr_beneficiaries_select" on public.ppr_beneficiaries;
create policy "ppr_beneficiaries_select" on public.ppr_beneficiaries
  for select to authenticated
  using (
    public.is_admin_master()
    or public.is_network_viewer()
    or clinic_id in (select public.user_full_access_clinic_ids())
    or public.has_role_in_clinic(clinic_id,
         array['unit_manager','franchisee','receptionist','clinical_coordinator',
               'dentist','planner_dentist','tsb','asb','sdr']::public.user_role[])
    or public.user_has_client_history_access(client_id)
    or exists (select 1 from public.ppr_memberships m where m.id = membership_id)
  );

-- Adesão: além da unidade dona, quem tem acesso ao cliente titular.
drop policy if exists "ppr_memberships_select" on public.ppr_memberships;
create policy "ppr_memberships_select" on public.ppr_memberships
  for select to authenticated
  using (
    public.is_admin_master()
    or clinic_id in (select public.user_full_access_clinic_ids())
    or public.is_network_viewer()
    or public.has_role_in_clinic(clinic_id,
         array['unit_manager','franchisee','receptionist','clinical_coordinator',
               'dentist','planner_dentist','tsb','asb']::public.user_role[])
    or public.user_has_client_history_access(holder_client_id)
    or exists (select 1 from public.providers_with_access(clinic_id, 'commercial_consultant') p
               where p.user_id = (select auth.uid()))
    or exists (select 1 from public.providers_with_access(clinic_id, 'commercial_assistant') p
               where p.user_id = (select auth.uid()))
  );

-- Escrita do beneficiário: unidade do plano OU unidade do próprio beneficiário
-- (para a unidade B poder atualizar o dependente que passou a ser dela).
drop policy if exists "ppr_beneficiaries_write" on public.ppr_beneficiaries;
create policy "ppr_beneficiaries_write" on public.ppr_beneficiaries
  for all to authenticated
  using (
    public.is_admin_master()
    or public.has_role_in_clinic(clinic_id,
         array['unit_manager','receptionist','clinical_coordinator']::public.user_role[])
    or exists (
      select 1 from public.ppr_memberships m
      where m.id = membership_id
        and (public.has_role_in_clinic(m.clinic_id,
               array['unit_manager','receptionist','clinical_coordinator']::public.user_role[])
             or exists (select 1 from public.providers_with_access(m.clinic_id, 'commercial_consultant') p
                        where p.user_id = (select auth.uid())))
    )
  )
  with check (
    public.is_admin_master()
    or public.has_role_in_clinic(clinic_id,
         array['unit_manager','receptionist','clinical_coordinator']::public.user_role[])
    or exists (
      select 1 from public.ppr_memberships m
      where m.id = membership_id
        and (public.has_role_in_clinic(m.clinic_id,
               array['unit_manager','receptionist','clinical_coordinator']::public.user_role[])
             or exists (select 1 from public.providers_with_access(m.clinic_id, 'commercial_consultant') p
                        where p.user_id = (select auth.uid())))
    )
  );

-- Uso do benefício: quem atende o cliente (em qualquer unidade) registra.
drop policy if exists "ppr_benefit_usages_select" on public.ppr_benefit_usages;
create policy "ppr_benefit_usages_select" on public.ppr_benefit_usages
  for select to authenticated
  using (
    public.is_admin_master()
    or public.is_network_viewer()
    or clinic_id in (select public.user_full_access_clinic_ids())
    or public.has_role_in_clinic(clinic_id,
         array['unit_manager','franchisee','receptionist','clinical_coordinator',
               'dentist','planner_dentist','tsb','asb']::public.user_role[])
    or public.user_has_client_history_access(client_id)
  );

drop policy if exists "ppr_benefit_usages_write" on public.ppr_benefit_usages;
create policy "ppr_benefit_usages_write" on public.ppr_benefit_usages
  for all to authenticated
  using (
    public.is_admin_master()
    or public.has_role_in_clinic(clinic_id,
         array['unit_manager','receptionist','clinical_coordinator','dentist',
               'tsb','asb']::public.user_role[])
  )
  with check (
    public.is_admin_master()
    or public.has_role_in_clinic(clinic_id,
         array['unit_manager','receptionist','clinical_coordinator','dentist',
               'tsb','asb']::public.user_role[])
  );

-- 3) Selo do prontuário: o cancelamento por TRANSFERÊNCIA não apaga o selo do
--    dependente que continua no plano novo — o gatilho já cuida disso porque a
--    nova adesão sobrescreve o vínculo do cliente. Só reforçamos a ordem: ao
--    cancelar, limpa apenas quem AINDA aponta para a adesão cancelada.
create or replace function public.ppr_sync_client_flags()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'cancelado' then
    update public.clients c
    set ppr_membership_id = null, ppr_active = null
    where c.ppr_membership_id = new.id;
  else
    update public.clients c
    set ppr_membership_id = new.id,
        ppr_active = (new.status = 'ativo')
    where c.id in (
      select b.client_id from public.ppr_beneficiaries b
      where b.membership_id = new.id and b.left_at is null
    );
  end if;
  return new;
end;
$$;

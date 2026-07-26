-- =============================================================================
-- Risarte Odontologia — Migration 0163 (PPR+ — limpeza de adesões órfãs)
--
-- No primeiro teste do PPR3 o cadastro dos beneficiários falhou (o insert em
-- lote exigia colunas iguais em todas as linhas) e sobrou a adesão SEM nenhum
-- beneficiário. O código já foi corrigido e agora desfaz a adesão sozinho;
-- esta migração apaga o que ficou para trás.
--
-- Só remove adesões que: não têm NENHUM beneficiário, ainda estão aguardando
-- ativação e não têm cobrança lançada. Idempotente.
-- =============================================================================

delete from public.ppr_events e
where exists (
  select 1 from public.ppr_memberships m
  where m.id = e.membership_id
    and m.status = 'aguardando_ativacao'
    and not exists (select 1 from public.ppr_beneficiaries b where b.membership_id = m.id)
    and not exists (select 1 from public.ppr_charges c where c.membership_id = m.id)
);

delete from public.ppr_memberships m
where m.status = 'aguardando_ativacao'
  and not exists (select 1 from public.ppr_beneficiaries b where b.membership_id = m.id)
  and not exists (select 1 from public.ppr_charges c where c.membership_id = m.id);

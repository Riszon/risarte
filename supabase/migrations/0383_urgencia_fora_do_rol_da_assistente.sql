-- =============================================================================
-- 0383 — URGÊNCIA NUNCA ENTRA NO ROL DA ASSISTENTE VIRTUAL (AP132)
--
-- O QUE ACONTECEU (treino, trilha de auditoria, 09/11/2026 23h42): as duas
-- consultas de Urgência foram marcadas como "a assistente virtual pode
-- oferecer". A 0369 as deixou FORA do rol (decisão 38: a assistente RECONHECE
-- a urgência e passa para a equipe) — mas nada impedia marcar depois, e
-- `rita.catalog` passava a listá-las.
--
-- DECISÃO DO DONO (10/11/2026): proibir. O banco recusa, a tela esconde a
-- caixa, e as que foram marcadas voltam a ficar fora do rol.
--
-- O QUE MUDA:
--   1) os procedimentos de urgência marcados voltam a `rita_can_offer = false`
--      (a conferência abaixo mostra quantos eram, ANTES de mudar);
--   2) uma trava na tabela: urgência + "pode oferecer" não grava, por nenhum
--      caminho (tela, API, importação).
--
-- Nada é apagado. Idempotente.
-- =============================================================================

-- CONFERÊNCIA ANTES (só leitura): quem está marcado hoje.
select p.name as procedimento_de_urgencia_que_estava_no_rol
from public.procedures p
where p.rita_role = 'urgency' and p.rita_can_offer
order by p.name;

update public.procedures
   set rita_can_offer = false
 where rita_role = 'urgency'
   and rita_can_offer;

alter table public.procedures
  drop constraint if exists procedures_rita_urgency_not_offered;

alter table public.procedures
  add constraint procedures_rita_urgency_not_offered
  check (rita_role is distinct from 'urgency' or not rita_can_offer);

comment on constraint procedures_rita_urgency_not_offered on public.procedures is
  'AP132: urgência nunca entra no rol da assistente virtual — ela reconhece e passa para a equipe (decisão 38).';

-- CONFERÊNCIA FINAL (só leitura). Esperado: trava_existe = true,
-- urgencias_no_rol = 0.
select
  exists (select 1 from pg_constraint where conname = 'procedures_rita_urgency_not_offered') as trava_existe,
  (select count(*) from public.procedures where rita_role = 'urgency' and rita_can_offer) as urgencias_no_rol,
  (select count(*) from public.procedures where rita_role = 'urgency') as urgencias;

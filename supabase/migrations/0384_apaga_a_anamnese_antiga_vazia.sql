-- =============================================================================
-- 0384 — APAGA AS DUAS TABELAS DA ANAMNESE ANTIGA, VAZIAS E SEM USO (AP135)
--
-- `clinical_anamnesis` (0052) e a irmã `clinical_anamnesis_revisions` eram a
-- anamnese de antes das fichas (`anamnesis_fills`). O último código que
-- gravava nelas saiu na 0.410.0 (AP72); nenhuma tela, função, visão ou outra
-- tabela depende delas (conferido no catálogo do treino em 10/11/2026).
--
-- PEDIDO DO DONO (10/11/2026): "pode preparar a migração que apaga, SE
-- estiver vazia na produção". MEDIDO NA PRODUÇÃO em 10/11/2026, só leitura:
-- 0 linhas em cada uma (as fichas novas, `anamnesis_fills`, têm 2 — não são
-- tocadas).
--
-- ⚠️ A MIGRAÇÃO CONFERE DE NOVO ANTES DE APAGAR: se qualquer uma das duas
-- tiver UMA linha que seja, ela PARA com erro e nada é apagado.
--
-- Idempotente (rodar de novo não faz nada).
-- =============================================================================

do $$
declare
  v_n bigint := 0;
  v_m bigint := 0;
begin
  if to_regclass('public.clinical_anamnesis') is not null then
    execute 'select count(*) from public.clinical_anamnesis' into v_n;
  end if;
  if to_regclass('public.clinical_anamnesis_revisions') is not null then
    execute 'select count(*) from public.clinical_anamnesis_revisions' into v_m;
  end if;
  if v_n > 0 or v_m > 0 then
    raise exception 'ANAMNESE_ANTIGA_COM_DADO: clinical_anamnesis = %, clinical_anamnesis_revisions = %. Nada foi apagado.', v_n, v_m;
  end if;
end $$;

-- DESTRUTIVO: tabela sem uso desde a 0.410.0, com 0 linhas conferidas na produção e reconferidas pelo bloco acima (para com erro se houver dado)
drop table if exists public.clinical_anamnesis_revisions;
-- DESTRUTIVO: tabela sem uso desde a 0.410.0, com 0 linhas conferidas na produção e reconferidas pelo bloco acima (para com erro se houver dado)
drop table if exists public.clinical_anamnesis;

-- CONFERÊNCIA (só leitura). Esperado: as duas `false`; fichas_novas igual a antes.
select
  to_regclass('public.clinical_anamnesis') is not null as antiga_existe,
  to_regclass('public.clinical_anamnesis_revisions') is not null as revisoes_existem,
  (select count(*) from public.anamnesis_fills) as fichas_novas;

-- =============================================================================
-- 0183 — J11: "Não foi possível concluir o atendimento" (sem motivo)
-- -----------------------------------------------------------------------------
-- Bug relatado pelo dono (31/07/2026, com print): ao concluir o atendimento no
-- painel de Atendimento aparecia a mensagem genérica, sem dizer o porquê.
--
-- Causa: a migração 0176 criou `conclude_attendance_partial` com um argumento
-- NOVO (`p_extra_ids`, para concluir sessões não planejadas) — mas a versão
-- ANTIGA de 3 argumentos (0105) continuou existindo. `create or replace` só
-- substitui a função de MESMA assinatura; com assinatura diferente ele CRIA
-- outra. Ficaram duas, e a chamada de 3 argumentos virou ambígua:
--
--   PGRST203 "Could not choose the best candidate function between:
--     conclude_attendance_partial(uuid, uuid[], jsonb)
--     conclude_attendance_partial(uuid, uuid[], jsonb, uuid[])"
--
-- (Confirmado chamando as duas assinaturas no banco: a de 3 dá PGRST203; a de
-- 4 responde normalmente.) Concluir pela aba "Desenvolvimento clínico"
-- funcionava porque de lá a chamada já mandava os 4 argumentos.
--
-- Aqui: remove a versão antiga, deixando UMA função. O app também passou a
-- mandar sempre os 4 argumentos e a traduzir os erros (NOTE_REQUIRED,
-- NOT_ALLOWED, APPOINTMENT_NOT_FOUND) em vez da mensagem genérica.
-- Idempotente.
-- =============================================================================

drop function if exists public.conclude_attendance_partial(uuid, uuid[], jsonb);

-- Garantia: a versão boa (4 argumentos) continua executável pelo app.
grant execute on function
  public.conclude_attendance_partial(uuid, uuid[], jsonb, uuid[])
  to authenticated;

-- -----------------------------------------------------------------------------
-- Varredura preventiva: qualquer OUTRA função do projeto com o mesmo nome e
-- assinaturas diferentes cai no mesmo problema. Lista as duplicadas no log
-- (não altera nada) para conferência.
-- -----------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select p.proname, count(*) as versoes
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
    group by p.proname
    having count(*) > 1
  loop
    raise notice 'ATENÇÃO: % tem % versões (assinaturas diferentes)',
      r.proname, r.versoes;
  end loop;
end $$;

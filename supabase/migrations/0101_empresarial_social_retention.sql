-- =============================================================================
-- 0101 — Risarte Empresarial (Fase 8): Riso+ Social + retenção/LGPD
-- -----------------------------------------------------------------------------
-- (a) Rotina de RETENÇÃO: dados do programa de colaboradores que saíram há mais
--     de 5 anos são ANONIMIZADOS (LGPD) — mantém os agregados (empresa/período),
--     apaga os dados pessoais. Agendada mensalmente (pg_cron, best-effort).
-- (b) social_tokens já existe (0097): as regras de geração/atribuição são no app.
-- Idempotente.
-- =============================================================================

create or replace function empresarial.run_retention(p_years int default 5)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int := 0;
  v_cut timestamptz := now() - make_interval(years => p_years);
begin
  -- Colaboradores que saíram há mais de N anos → anonimiza dados pessoais.
  update empresarial.employees
    set cpf = 'ANON' || left(md5(id::text), 8),
        full_name = 'Colaborador anonimizado',
        phone = '',
        email = null
  where status = 'INACTIVE'
    and left_at is not null
    and left_at < v_cut
    and full_name <> 'Colaborador anonimizado';
  get diagnostics v_count = row_count;

  -- Dependentes desses colaboradores → anonimiza também.
  update empresarial.dependents d
    set cpf = 'ANON' || left(md5(d.id::text), 8),
        full_name = 'Dependente anonimizado',
        phone = null
  from empresarial.employees e
  where d.employee_id = e.id
    and e.left_at is not null
    and e.left_at < v_cut
    and d.full_name is distinct from 'Dependente anonimizado';

  return v_count;
end $$;

grant execute on function empresarial.run_retention(int) to authenticated;

-- Agendamento mensal (dia 1, 03h). Best-effort: se pg_cron não existir, ignora.
do $$
begin
  perform cron.schedule(
    'empresarial_retention',
    '0 3 1 * *',
    'select empresarial.run_retention();'
  );
exception when others then
  null;
end $$;

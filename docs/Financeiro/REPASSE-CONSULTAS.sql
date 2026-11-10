-- =============================================================================
-- REPASSE DOS DENTISTAS — CONSULTA SÓ DE LEITURA (não muda nada).
-- Rodar na PRODUÇÃO, no SQL Editor. É um comando só e devolve UMA tabela
-- (pergunta / unidade / resposta). Mostra só contagens e valores — nenhum
-- nome, CPF ou telefone. Serve para responder: "por que nenhum repasse foi
-- gerado até hoje?"
-- =============================================================================
with
s as (
  select ts.*, (ts.status = 'done') as concluida,
         exists (select 1 from public.provider_payouts p where p.session_id = ts.id) as tem_repasse
    from public.treatment_sessions ts
),
linhas as (
  -- 1) Sessões concluídas e quantas viraram repasse
  select 1 as ordem, '1) Sessões concluídas' as pergunta, c.name as unidade,
         count(*) filter (where s.concluida)::text as resposta
    from s join public.clinics c on c.id = s.clinic_id group by c.name
  union all
  select 2, '2) ...das concluídas, com repasse apurado', c.name,
         count(*) filter (where s.concluida and s.tem_repasse)::text
    from s join public.clinics c on c.id = s.clinic_id group by c.name
  union all
  select 3, '3) ...concluídas SEM profissional (nem quem executou, nem o do Planner)', c.name,
         count(*) filter (where s.concluida and s.executed_by is null and s.planner_provider_id is null)::text
    from s join public.clinics c on c.id = s.clinic_id group by c.name
  union all
  select 4, '4) ...concluídas SEM procedimento ligado', c.name,
         count(*) filter (where s.concluida and s.procedure_id is null)::text
    from s join public.clinics c on c.id = s.clinic_id group by c.name
  union all
  select 5, '5) ...concluídas, de plano, sem repasse (procedimento ainda com sessão aberta, ou falha)', c.name,
         count(*) filter (where s.concluida and not s.tem_repasse and s.item_id is not null
                            and s.procedure_id is not null
                            and coalesce(s.executed_by, s.planner_provider_id) is not null
                            and s.redo_kind is distinct from 'revisao')::text
    from s join public.clinics c on c.id = s.clinic_id group by c.name
  union all
  select 6, '6) ...concluídas, venda direta/avulsa, sem repasse (não deveria existir)', c.name,
         count(*) filter (where s.concluida and not s.tem_repasse and s.item_id is null
                            and s.procedure_id is not null
                            and coalesce(s.executed_by, s.planner_provider_id) is not null
                            and s.redo_kind is distinct from 'revisao')::text
    from s join public.clinics c on c.id = s.clinic_id group by c.name
  union all
  -- 2) O que existe apurado
  select 10, '10) Repasses apurados — mês ' || to_char(p.accrual_date, 'YYYY-MM'), c.name,
         count(*) || ' linhas · R$ ' || to_char(sum(p.amount_cents) / 100.0, 'FM999G999G990D00')
         || ' · ' || count(*) filter (where p.amount_cents = 0) || ' com valor ZERO'
         || ' · ' || count(*) filter (where p.closing_id is not null) || ' já em fechamento'
         || ' · ' || count(*) filter (where p.ortho_maintenance_id is not null) || ' de manutenção orto'
         || ' · ' || count(distinct p.provider_id) || ' profissionais'
    from public.provider_payouts p join public.clinics c on c.id = p.clinic_id
   group by c.name, to_char(p.accrual_date, 'YYYY-MM')
  union all
  select 11, '11) Meses fechados (payout_closings)', c.name,
         to_char(k.period_month, 'YYYY-MM') || ' · ' || k.status || ' · R$ '
         || to_char(k.total_cents / 100.0, 'FM999G999G990D00')
    from public.payout_closings k join public.clinics c on c.id = k.clinic_id
  union all
  select 12, '12) Contas a pagar de repasse (2.1.01) e bônus (2.1.02)', c.name,
         pa.account_code || ' · ' || pa.status || ' · ' || count(*) || ' contas · R$ '
         || to_char(sum(pa.amount_cents) / 100.0, 'FM999G999G990D00')
    from public.payables pa join public.clinics c on c.id = pa.clinic_id
   where pa.account_code in ('2.1.01', '2.1.02')
   group by c.name, pa.account_code, pa.status
  union all
  -- 3) O cadastro que dá o VALOR
  select 20, '20) Dentistas/coordenadores na unidade (total · SEM nível de carreira)', c.name,
         count(*) || ' · ' || count(*) filter (where r.career_level_id is null) || ' sem nível'
    from public.user_clinic_roles_all r join public.clinics c on c.id = r.clinic_id
   where r.role in ('dentist', 'clinical_coordinator', 'planner_dentist')
   group by c.name
  union all
  select 21, '21) Gerentes e coordenadores clínicos por unidade', c.name,
         count(*) filter (where r.role = 'unit_manager') || ' gerente(s) · '
         || count(*) filter (where r.role = 'clinical_coordinator') || ' coordenador(es)'
    from public.user_clinic_roles_all r join public.clinics c on c.id = r.clinic_id
   where r.role in ('unit_manager', 'clinical_coordinator')
   group by c.name
  union all
  select 22, '22) Dentistas que atendem em mais de uma unidade', '(rede)',
         count(*)::text
    from (select r.user_id from public.user_clinic_roles_all r
           where r.role in ('dentist', 'clinical_coordinator')
           group by r.user_id having count(distinct r.clinic_id) > 1) x
  union all
  select 23, '23) Níveis de carreira cadastrados (ativos)', coalesce(c.name, '(rede)'),
         count(*) filter (where l.active)::text
    from public.career_levels l left join public.clinics c on c.id = l.clinic_id
   group by c.name
  union all
  select 24, '24) Linhas na tabela de repasse (por nível · individuais)', coalesce(c.name, '(rede)'),
         count(*) filter (where t.level_id is not null) || ' · '
         || count(*) filter (where t.provider_id is not null)
    from public.provider_payout_rates t left join public.clinics c on c.id = t.clinic_id
   group by c.name
  union all
  select 25, '25) Procedimentos ativos (total · com repasse no cadastro, fixo ou %)', '(rede)',
         count(*) || ' · ' || count(*) filter (
           where coalesce(pc.commission_fixed_cents, 0) > 0 or coalesce(pc.commission_percent, 0) > 0)
    from public.procedures p left join public.procedure_commissions pc on pc.procedure_id = p.id
   where p.is_active
  union all
  select 26, '26) Sessões de revisão / refação', c.name,
         count(*) filter (where s.redo_kind = 'revisao') || ' revisão · '
         || count(*) filter (where s.redo_kind = 'refacao') || ' refação'
    from s join public.clinics c on c.id = s.clinic_id group by c.name
)
select pergunta, unidade, resposta from linhas order by ordem, unidade, resposta;

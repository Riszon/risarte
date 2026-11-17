-- AP175 — MEDIÇÃO SÓ DE LEITURA (não muda nada no banco).
-- Colar no SQL Editor da PRODUÇÃO e rodar. Devolve UMA linha de contagens,
-- sem nome de paciente nem de profissional.
--
-- manutencoes_de_sessao      agendamentos de sessão de plano que viraram manutenção ortodôntica
-- casos_afetados             casos ortodônticos com pelo menos uma dessas
-- de_outra_especialidade     dessas, as que eram de procedimento que NÃO é ortodontia
-- realizadas                 dessas, as já concluídas (as que podem ter gerado repasse)
-- repasses_em_dobro          atendimentos que pagaram a sessão do plano E a manutenção
-- valor_da_manutencao_dobrada soma, em R$, do repasse de manutenção nesses atendimentos
-- ortodontista_pela_agenda   casos em que a agenda definiu o ortodontista sozinha (regra Q3)
select
  (select count(*)
     from public.ortho_maintenances m
     join public.appointments a on a.id = m.appointment_id
    where a.treatment_session_id is not null)                              as manutencoes_de_sessao,
  (select count(distinct m.case_id)
     from public.ortho_maintenances m
     join public.appointments a on a.id = m.appointment_id
    where a.treatment_session_id is not null)                              as casos_afetados,
  (select count(*)
     from public.ortho_maintenances m
     join public.appointments a on a.id = m.appointment_id
     join public.treatment_sessions s on s.id = a.treatment_session_id
     left join public.procedures p on p.id = s.procedure_id
    where coalesce(p.specialty, '') not ilike '%ortod%')                   as de_outra_especialidade,
  (select count(*)
     from public.ortho_maintenances m
     join public.appointments a on a.id = m.appointment_id
    where a.treatment_session_id is not null and m.status = 'realizada')   as realizadas,
  (select count(*)
     from public.ortho_maintenances m
     join public.appointments a on a.id = m.appointment_id
     join public.treatment_sessions s on s.id = a.treatment_session_id
    where exists (select 1 from public.provider_payouts p where p.ortho_maintenance_id = m.id)
      and exists (select 1 from public.provider_payouts p
                   join public.treatment_sessions x on x.id = p.session_id
                  where x.item_id = s.item_id))                            as repasses_em_dobro,
  (select coalesce(sum(p.amount_cents), 0) / 100.0
     from public.ortho_maintenances m
     join public.appointments a on a.id = m.appointment_id
     join public.treatment_sessions s on s.id = a.treatment_session_id
     join public.provider_payouts p on p.ortho_maintenance_id = m.id
    where exists (select 1 from public.provider_payouts q
                   join public.treatment_sessions x on x.id = q.session_id
                  where x.item_id = s.item_id))                            as valor_da_manutencao_dobrada,
  (select count(distinct e.case_id)
     from public.ortho_events e
    where e.event_type = 'ortodontista_definido')                          as ortodontista_pela_agenda;

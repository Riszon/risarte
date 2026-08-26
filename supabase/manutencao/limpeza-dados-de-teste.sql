-- =============================================================================
-- LIMPEZA DOS DADOS DE TESTE — preparação para o lançamento (26/08/2026)
-- -----------------------------------------------------------------------------
-- ⚠️ ISTO NÃO É UMA MIGRAÇÃO, E POR ISSO NÃO MORA EM `supabase/migrations/`.
--
-- O `scripts/apply-migrations.mjs` roda TODOS os arquivos daquela pasta, em
-- ordem. Um arquivo que apaga dados vivendo lá seria uma bomba de efeito
-- retardado: qualquer reconstrução futura — ou alguém reaplicando as migrações
-- por engano — esvaziaria a produção inteira. Manutenção fica aqui, é rodada à
-- mão, uma vez, com decisão de gente.
--
-- O QUE ELE FAZ: apaga todo o movimento gerado nos testes e mantém o cadastro e
-- a configuração, para o sistema começar pronto para trabalhar e sem paciente
-- nenhum.
--
-- ⚠️ ANTES DE RODAR: cópia de segurança feita (`npm run backup:producao`).
-- ⚠️ DEPOIS DE RODAR: os ARQUIVOS do armazenamento continuam lá. O banco não os
--    alcança — são apagados à parte, pelo `npm run limpar:arquivos`.
--
-- Decisões do dono (26/08/2026):
--   1. A numeração dos pacientes RECOMEÇA do 1 (CAM-00001).
--   2. O Chat perde as MENSAGENS e mantém os canais e as regras de contato.
--   3. Fornecedores, contas bancárias, cadastro de Risartano e o calendário de
--      feriados/fechamentos TAMBÉM saem — nenhum deles é dado real ainda.
--   4. O módulo Empresarial é limpo JUNTO. Não havia como deixá-lo de fora:
--      `empresarial.employees.client_id` aponta para `clients`, então apagar
--      paciente quebraria o vínculo de qualquer jeito. Vínculo quebrado em
--      silêncio é pior que registro apagado com decisão.
--
-- Roda tudo em UMA transação: ou apaga tudo, ou não apaga nada. Metade apagada
-- deixaria o razão sem contrapartida e o estoque sem origem — pior que o estado
-- de agora.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. EMPRESARIAL — primeiro, e por DELETE, não por TRUNCATE.
-- -----------------------------------------------------------------------------
-- `truncate ... cascade` esvazia a tabela referenciada INTEIRA, ignorando o
-- `on delete` que o autor escreveu. Aqui isso apagaria também o padrão da REDE
-- (as linhas com `company_id` nulo em preço de adesão, split e benefícios), que
-- é configuração e tem de ficar. O DELETE respeita a cascata desenhada pelo
-- outro projeto — que é de quem é essa decisão.
--
-- Filhos antes dos pais, para o efeito ser explícito em vez de arrastado.
delete from empresarial.commercial_lead_activities;
delete from empresarial.commercial_leads;
delete from empresarial.benefit_usage;
delete from empresarial.social_tokens;
delete from empresarial.adhesion_billing;
delete from empresarial.membership_history;
delete from empresarial.dependents;
delete from empresarial.employees;
delete from empresarial.company_files;
delete from empresarial.company_documents;
delete from empresarial.companies;

-- Só o que era exceção DA EMPRESA. O padrão da rede (`company_id` nulo) fica.
delete from empresarial.procedure_benefits where company_id is not null;
delete from empresarial.adhesion_pricing    where company_id is not null;
delete from empresarial.split_rules         where company_id is not null;

-- -----------------------------------------------------------------------------
-- 2. NÚCLEO — todo o movimento.
-- -----------------------------------------------------------------------------
-- Uma lista explícita, e não `truncate clients cascade`: com cascata, o Postgres
-- decide sozinho até onde ir, e uma tabela de configuração que ganhasse uma
-- chave estrangeira amanhã seria esvaziada sem ninguém perceber. A lista é
-- longa de propósito — ela é a decisão, escrita.
--
-- `cascade` continua aqui só para resolver a ORDEM entre as tabelas da própria
-- lista; a esta altura não há mais nada fora dela apontando para cá.
truncate table
  -- pacientes e o que pendura neles
  public.clients,
  public.client_changes,
  public.client_clinic_history,
  public.client_consents,
  public.client_guardians,
  public.client_shares,
  public.clinic_client_counters,          -- zera a numeração: o próximo é o 00001

  -- anamnese respondida (o MODELO e as perguntas ficam)
  public.anamnesis_fills,
  public.anamnesis_answers,

  -- clínico
  public.clinical_evaluations,
  public.clinical_media,
  public.clinical_notes,
  public.clinical_note_revisions,
  public.clinical_progress_notes,
  public.clinical_guidance,
  public.clinical_requests,
  public.clinical_request_media,
  public.clinical_documents,
  public.clinical_anamnesis,
  public.clinical_anamnesis_revisions,
  public.protocol_change_proposals,

  -- jornada e atendimento
  public.journey_phase_history,
  public.journey_decisions,
  public.attendance_session_outcomes,
  public.appointments,
  public.appointment_changes,
  public.appointment_participants,
  public.appointment_provider_swaps,

  -- planos de tratamento
  public.treatment_plans,
  public.treatment_plan_events,
  public.treatment_plan_options,
  public.treatment_plan_option_items,
  public.treatment_plan_stages,
  public.treatment_plan_status_events,
  public.treatment_sessions,
  public.plan_session_joins,
  public.plan_quality_reviews,
  public.plan_cancellations,
  public.planning_supplements,

  -- comercial
  public.plan_negotiations,
  public.plan_negotiation_items,
  public.commercial_sales,
  public.commercial_cards,
  public.commercial_card_events,
  public.commercial_followup_attempts,
  public.commercial_presentations,
  public.direct_sales,
  public.direct_sale_items,

  -- financeiro
  public.financial_entries,
  public.payment_installments,
  public.payment_receipts,
  public.payment_renegotiations,
  public.payables,
  public.payable_payments,
  public.payable_recurrences,
  public.split_charges,
  public.finance_alerts,
  public.budget_lines,
  public.fiscal_periods,                  -- mês fechado de teste recusaria lançamento novo
  public.bank_accounts,
  public.bank_transactions,
  public.bank_statement_imports,
  public.fixed_assets,
  public.asset_depreciations,
  public.provider_payouts,
  public.payout_closings,

  -- estoque (o CATÁLOGO de itens e os kits ficam; o saldo zera)
  public.stock_movements,
  public.stock_balances,
  public.stock_counts,
  public.stock_count_items,
  public.stock_purchases,

  -- compras e fornecedores
  public.purchase_requests,
  public.purchase_request_items,
  public.purchase_rounds,
  public.purchase_round_items,
  public.purchase_quotes,
  public.purchase_quote_items,
  public.purchase_allocations,
  public.purchase_orders,
  public.purchase_order_items,
  public.purchase_receipts,
  public.purchase_receipt_items,
  public.suppliers,
  public.supplier_item_links,

  -- PPR+ (os PLANOS e os benefícios do plano ficam)
  public.ppr_beneficiaries,
  public.ppr_memberships,
  public.ppr_charges,
  public.ppr_events,
  public.ppr_benefit_usages,
  public.ppr_social_points,

  -- agenda: feriados, fechamentos e planejamento de dias
  public.clinic_holiday_decisions,
  public.agenda_closures,
  public.agenda_closure_providers,
  public.agenda_closure_rooms,
  public.agenda_closure_history,
  public.agenda_open_days,
  public.agenda_open_day_staff,
  public.agenda_open_day_history,
  public.agenda_plan_items,
  public.agenda_plan_item_history,
  public.agenda_plan_item_people,

  -- RH (Risartanos)
  public.staff_members,
  public.staff_member_changes,
  public.staff_clinic_schedule,

  -- Chat: só as MENSAGENS (canais, membros e regras de contato ficam)
  public.chat_messages,
  public.chat_reactions,
  public.chat_reads,

  -- avisos, auditoria e presença
  public.notifications,
  public.audit_logs,
  public.user_presence
restart identity cascade;

-- -----------------------------------------------------------------------------
-- 3. CÓDIGOS DE DOCUMENTO — voltam ao 00001.
-- -----------------------------------------------------------------------------
-- PT-, VD- e RN- saem todos da MESMA sequência (é o que garante que um número
-- nunca vale para dois documentos diferentes). CN-, RC-, PD- e AT- são contados
-- a partir das próprias tabelas, então recomeçam sozinhos.
--
-- `procedure_code_seq` NÃO entra: o catálogo de procedimentos fica, e reiniciar
-- daria o mesmo código a dois procedimentos diferentes.
alter sequence public.sale_code_seq restart with 1;
alter sequence public.purchase_request_code_seq restart with 1;
alter sequence public.staff_member_code_seq restart with 1;

-- Contador de rede dos códigos de programa (PPR-, PRE-), criado pela 0245.
-- Condicional de propósito: se a 0245 ainda não tiver sido aplicada, a limpeza
-- segue em vez de falhar inteira por causa de uma sequência que não existe.
do $$
begin
  if exists (
    select 1 from pg_class
    where relname = 'client_prefixed_code_seq' and relkind = 'S'
  ) then
    perform setval('public.client_prefixed_code_seq', 1, false);
  end if;
end $$;

commit;

-- =============================================================================
-- CONFERÊNCIA — o que ficou de pé.
-- =============================================================================
select 'clínicas'          as cadastro, count(*) from public.clinics
union all select 'usuários',            count(*) from public.profiles
union all select 'papéis',              count(*) from public.user_clinic_roles
union all select 'procedimentos',       count(*) from public.procedures
union all select 'protocolo de sessões',count(*) from public.procedure_sessions
union all select 'plano de contas',     count(*) from public.chart_of_accounts
union all select 'centros de custo',    count(*) from public.cost_centers
union all select 'itens de estoque',    count(*) from public.stock_items
union all select 'kits',                count(*) from public.stock_kits
union all select 'taxas da rede',       count(*) from public.network_fee_types
union all select 'planos PPR+',         count(*) from public.ppr_plans
union all select 'modelos de documento',count(*) from public.document_templates
union all select 'fichas de anamnese',  count(*) from public.anamnesis_templates
union all select '— PACIENTES',         count(*) from public.clients
union all select '— agendamentos',      count(*) from public.appointments
union all select '— lançamentos',       count(*) from public.financial_entries
union all select '— empresas (Empr.)',  count(*) from empresarial.companies;

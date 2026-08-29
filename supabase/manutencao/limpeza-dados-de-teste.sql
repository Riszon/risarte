-- =============================================================================
-- LIMPEZA DOS DADOS DE TESTE — preparação para o lançamento
-- Reescrito em 28/08/2026 com as decisões novas do dono.
-- -----------------------------------------------------------------------------
-- ⚠️ ISTO NÃO É UMA MIGRAÇÃO, E POR ISSO NÃO MORA EM `supabase/migrations/`.
--
-- O `scripts/apply-migrations.mjs` roda TODOS os arquivos daquela pasta, em
-- ordem. Um arquivo que apaga dados vivendo lá seria uma bomba de efeito
-- retardado: qualquer reconstrução futura — ou alguém reaplicando as migrações
-- por engano — esvaziaria a produção inteira. Manutenção fica aqui, é rodada à
-- mão, uma vez, com decisão de gente.
--
-- ⚠️ ANTES DE RODAR: cópia de segurança feita (`npm run backup:producao`).
-- ⚠️ DEPOIS DE RODAR: os ARQUIVOS do armazenamento continuam lá — o banco não
--    os alcança. Saem pelo `npm run limpar:arquivos -- --confirmar`.
-- ⚠️ NINGUÉM usando o sistema enquanto roda.
--
-- O QUE FICA DE PÉ, no fim:
--   • a franqueadora (RF — RISARTE Franchising) e mais nenhuma unidade;
--   • o Admin Master e mais nenhum usuário;
--   • o plano de contas, os centros de custo, as taxas da rede, as
--     especialidades, os níveis de carreira, as categorias de bens, a
--     configuração de adquirente e as réguas de SLA/inatividade da REDE;
--   • os modelos de documento, as fichas de anamnese e os 4 planos PPR+;
--   • no Empresarial, a Agropecuária Inocente com seus colaboradores.
--
-- O QUE SAI: todo o movimento; as unidades Cambé, Londrina e Roteiro com as
-- configurações delas; os 19 demais usuários; o catálogo de procedimentos; os
-- itens e kits de estoque; as outras três empresas.
--
-- CONSEQUÊNCIAS ACEITAS PELO DONO (28/08/2026), porque são inevitáveis:
--   • apagar os procedimentos derruba junto os repasses por procedimento e por
--     nível, os custos, os vínculos de kit, as **vantagens dos planos PPR+** e
--     os benefícios do Empresarial que apontam para procedimento. Os 4 planos
--     PPR+ continuam existindo; as vantagens serão relançadas.
--   • os colaboradores da Agropecuária ficam **sem vínculo com ficha de
--     paciente e sem unidade** — as fichas somem todas e as unidades saem.
--   • a autoria ("criado por") do que fica passa para o Admin Master. Sem isso
--     o banco recusaria apagar os usuários, e o registro perderia dono.
--
-- Roda tudo em UMA transação: ou apaga tudo, ou não apaga nada.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 0. AS TRÊS ÂNCORAS — e a recusa em seguir sem elas.
-- -----------------------------------------------------------------------------
-- Um erro de digitação aqui (código de clínica, nome da empresa) faria o script
-- apagar exatamente o que devia preservar. Então ele confere ANTES de tocar em
-- qualquer coisa, e para com uma mensagem em vez de fazer estrago silencioso.
do $$
declare
  v_clinica uuid;
  v_admin uuid;
  v_empresa uuid;
begin
  select id into v_clinica from public.clinics where code = 'RF';
  if v_clinica is null then
    raise exception 'PAREI: não achei a clínica de código RF (a franqueadora).';
  end if;

  select id into v_admin from public.profiles where is_admin_master limit 1;
  if v_admin is null then
    raise exception 'PAREI: não achei nenhum usuário Admin Master.';
  end if;

  select id into v_empresa from empresarial.companies
   where trade_name ilike '%Agropecu%Inocente%'
      or legal_name ilike '%Agropecu%Inocente%';
  if v_empresa is null then
    raise exception 'PAREI: não achei a empresa Agropecuária Inocente.';
  end if;

  raise notice 'Âncoras encontradas. Seguindo.';
end $$;

-- -----------------------------------------------------------------------------
-- 1. EMPRESARIAL — fica só a Agropecuária Inocente, com as pessoas dela.
-- -----------------------------------------------------------------------------
-- Por DELETE, não por TRUNCATE: `truncate ... cascade` esvazia a tabela
-- referenciada INTEIRA, ignorando o `on delete` que o autor escreveu — e aqui
-- isso apagaria os colaboradores que devem ficar, além do padrão da REDE (as
-- linhas com `company_id` nulo em preço de adesão, split e benefícios).
delete from empresarial.commercial_lead_activities;
delete from empresarial.commercial_leads;
delete from empresarial.benefit_usage;      -- uso de benefício por paciente de teste
delete from empresarial.adhesion_billing;   -- faturamento de teste
delete from empresarial.social_tokens;

-- As outras três empresas saem com tudo o que é delas (colaboradores,
-- dependentes, documentos, benefícios e regras próprias, por cascata).
delete from empresarial.companies
 where id <> (
   select id from empresarial.companies
    where trade_name ilike '%Agropecu%Inocente%'
       or legal_name ilike '%Agropecu%Inocente%'
 );

-- Benefícios por procedimento saem inteiros: os procedimentos vão embora logo
-- abaixo, e benefício apontando para procedimento que não existe mais é lixo.
delete from empresarial.procedure_benefits;

-- -----------------------------------------------------------------------------
-- 2. O MOVIMENTO DO NÚCLEO.
-- -----------------------------------------------------------------------------
-- Lista explícita, e não `truncate clients cascade`: com cascata o Postgres
-- decide sozinho até onde ir — e passaria por cima do `on delete set null` de
-- `empresarial.employees`, apagando os colaboradores que devem ficar.
--
-- `clients` NÃO entra aqui de propósito. Ele é apagado por DELETE logo depois,
-- justamente para que o `set null` valha e os colaboradores sobrevivam.
truncate table
  -- o que pendura no paciente
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

  -- estoque (movimento; o catálogo sai no passo 3)
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

  -- PPR+ (os PLANOS ficam; as adesões e o uso saem)
  -- `ppr_memberships` NÃO entra aqui — ver o aviso das duas pontes, abaixo.
  public.ppr_beneficiaries,
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
  -- `staff_members` NÃO entra aqui — ver o aviso das duas pontes, abaixo.
  public.staff_member_changes,
  public.staff_clinic_schedule,

  -- Chat: mensagens e o que pendura nelas
  public.chat_messages,
  public.chat_reactions,
  public.chat_reads,

  -- avisos, auditoria e presença
  public.notifications,
  public.audit_logs,
  public.user_presence
restart identity cascade;

-- ⚠️ AS DUAS PONTES — e por que `staff_members` e `ppr_memberships` ficaram
-- fora do TRUNCATE acima.
--
-- `truncate ... cascade` não para na tabela citada: ele arrasta quem depende
-- dela, e continua arrastando. A ficha do paciente APONTA para essas duas
-- (`clients.staff_member_id` e `clients.ppr_membership_id`), então truncar
-- qualquer uma das duas truncava `clients` junto — e, de `clients`, o Postgres
-- seguiu para `benefit_usage`, `employees`, `dependents`, `membership_history`,
-- `social_tokens` e `employee_files`. Ou seja: **apagava os colaboradores da
-- empresa que devia ficar**, passando por cima do `on delete set null` que
-- existe justamente para protegê-los.
--
-- Achado pelo ensaio no banco de teste, com o Postgres dizendo em voz alta até
-- onde tinha ido ("truncate cascades to table ..."). É o tipo de estrago que
-- não dá erro: só some.
--
-- Por isso a ordem aqui é: primeiro os pacientes por DELETE (aí o `set null`
-- vale e os colaboradores sobrevivem), e só depois as duas pontes — que a esta
-- altura já não têm mais ninguém apontando para elas.
--
-- ⚠️ E COM A ADESÃO DO PPR+ HÁ UM ABRAÇO A DESFAZER ANTES. A ficha aponta para
-- a adesão (`clients.ppr_membership_id`) e a adesão aponta para a ficha
-- (`ppr_memberships.holder_client_id`), as duas ligações BLOQUEANDO: nenhuma das
-- duas pode sair primeiro, e o banco recusa as duas ordens. Foi o erro que
-- apareceu na primeira tentativa de rodar na produção (23503) — o ensaio no
-- banco de teste não pegou porque lá não havia adesão de PPR+ nenhuma.
--
-- Solta-se o laço por um lado: a ficha deixa de apontar para a adesão, a adesão
-- sai, e aí a ficha sai. Nada se perde — as duas vão embora de qualquer forma.
update public.clients set ppr_membership_id = null where ppr_membership_id is not null;
delete from public.ppr_memberships;

delete from public.clients;
delete from public.staff_members;

-- -----------------------------------------------------------------------------
-- 3. O CATÁLOGO — procedimentos e estoque saem para serem relançados.
-- -----------------------------------------------------------------------------
-- O que aponta para procedimento e NÃO tem cascata precisa sair antes, senão o
-- banco recusa. É aqui que as vantagens do PPR+ ligadas a procedimento morrem —
-- consequência aceita, não descuido.
delete from public.provider_payout_rates;
delete from public.procedure_costs;
delete from public.procedure_cost_items;
delete from public.clinic_procedure_prices;
delete from public.procedure_changes;
delete from public.procedure_kit_links;
delete from public.procedure_sessions;
-- As DUAS tabelas do PPR+ que apontam para procedimento: as vantagens
-- (`perks`) e as coberturas do plano (`plan_benefits`). A segunda faltava, e o
-- banco recusou a exclusão dos procedimentos na segunda tentativa de rodar na
-- produção (23503). Os PLANOS continuam de pé; o que aponta para procedimento
-- sai, e será relançado junto com o catálogo.
delete from public.ppr_plan_perks;
delete from public.ppr_plan_benefits;
delete from public.procedures;

delete from public.stock_kit_items;
delete from public.stock_kits;
delete from public.stock_items;

-- -----------------------------------------------------------------------------
-- 4. TUDO O QUE É DE OUTRA UNIDADE.
-- -----------------------------------------------------------------------------
-- REGRA GENÉRICA, de propósito. Listar tabela por tabela deixaria alguma para
-- trás — e "alguma tabela esquecida" aqui significa configuração fantasma de uma
-- clínica que não existe mais. O banco sabe quem aponta para `clinics`: o laço
-- pergunta a ele e apaga, em toda tabela, as linhas de qualquer unidade que não
-- seja a franqueadora. Linha com unidade em branco é padrão da REDE e fica.
--
-- Em VOLTAS porque a ordem importa: apagar a sala antes do que usa a sala é
-- recusado. Em vez de adivinhar a ordem certa, tenta, deixa falhar o que ainda
-- tem dependente, e repete — cada volta destrava a seguinte.
--
-- ⚠️ SÓ NO SCHEMA `public`, e isto NÃO é detalhe. No `empresarial`, a unidade do
-- colaborador é um ESPELHO da unidade do paciente (existe para o controle de
-- acesso), não a dona do registro: o colaborador pertence à EMPRESA. A primeira
-- versão desta regra varria os dois schemas e apagou os colaboradores da empresa
-- que devia ficar — achado pelo ensaio no banco de teste, antes de chegar à
-- produção. Lá o `on delete set null` da chave estrangeira já resolve sozinho:
-- some a unidade, o colaborador fica sem unidade, e continua existindo.
do $$
declare
  v_clinica uuid := (select id from public.clinics where code = 'RF');
  r record;
  sobrou boolean := true;
  volta int := 0;
begin
  while sobrou and volta < 15 loop
    sobrou := false;
    volta := volta + 1;
    for r in
      select c.conrelid::regclass::text as tabela, a.attname as coluna
        from pg_constraint c
        join pg_attribute a
          on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
        join pg_class t on t.oid = c.conrelid
        join pg_namespace n on n.oid = t.relnamespace
       where c.contype = 'f'
         and c.confrelid = 'public.clinics'::regclass
         and array_length(c.conkey, 1) = 1
         and c.conrelid <> 'public.clinics'::regclass
         and n.nspname = 'public'          -- ⚠️ ver o aviso acima
    loop
      begin
        execute format(
          'delete from %s where %I is not null and %I <> $1',
          r.tabela, r.coluna, r.coluna
        ) using v_clinica;
      exception when foreign_key_violation then
        sobrou := true;   -- ainda tem quem dependa; a próxima volta pega
      end;
    end loop;
  end loop;
  if sobrou then
    raise exception 'PAREI: não consegui limpar as outras unidades em % voltas.', volta;
  end if;
  raise notice 'Outras unidades limpas em % volta(s).', volta;
end $$;

-- -----------------------------------------------------------------------------
-- 5. OS OUTROS USUÁRIOS — primeiro o que os aponta como PESSOA.
-- -----------------------------------------------------------------------------
-- Papel e participação em canal são vínculos da pessoa: não se transferem para
-- o Admin Master, apagam-se junto com ela.
delete from public.user_clinic_roles
 where user_id <> (select id from public.profiles where is_admin_master limit 1);
delete from public.chat_channel_members
 where user_id <> (select id from public.profiles where is_admin_master limit 1);
delete from public.chat_blocked_users;
delete from public.chat_contact_rules;
delete from public.chat_channels;

-- -----------------------------------------------------------------------------
-- 6. A AUTORIA DO QUE FICA PASSA PARA O ADMIN MASTER.
-- -----------------------------------------------------------------------------
-- Outra regra genérica: o banco sabe quem aponta para `profiles`. Toda coluna
-- que ainda tiver um usuário que vai embora passa a apontar para o Admin
-- Master. Sem isso o banco recusaria apagar os usuários — e apagar a coluna em
-- vez de reatribuir deixaria cadastro sem dono, que é pior: "quem cadastrou
-- este procedimento?" passaria a não ter resposta.
do $$
declare
  v_admin uuid := (select id from public.profiles where is_admin_master limit 1);
  r record;
  n bigint;
  total bigint := 0;
begin
  -- Também só no `public`: no `empresarial` toda ligação com usuário já é
  -- "esvazia quando o usuário sai" (`on delete set null`), e o consultor
  -- responsável por uma empresa não deve virar o Admin Master por tabela.
  for r in
    select c.conrelid::regclass::text as tabela, a.attname as coluna
      from pg_constraint c
      join pg_attribute a
        on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
      join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
     where c.contype = 'f'
       and c.confrelid = 'public.profiles'::regclass
       and array_length(c.conkey, 1) = 1
       and c.conrelid <> 'public.profiles'::regclass
       and n.nspname = 'public'
  loop
    execute format(
      'update %s set %I = $1 where %I is not null and %I <> $1',
      r.tabela, r.coluna, r.coluna, r.coluna
    ) using v_admin;
    get diagnostics n = row_count;
    if n > 0 then
      total := total + n;
      raise notice '  autoria reatribuída: % linhas em %.%', n, r.tabela, r.coluna;
    end if;
  end loop;
  raise notice 'Autoria reatribuída ao Admin Master: % linha(s).', total;
end $$;

-- -----------------------------------------------------------------------------
-- 7. AS CLÍNICAS E OS USUÁRIOS.
-- -----------------------------------------------------------------------------
delete from public.clinics where code <> 'RF';

-- `profiles.id` aponta para `auth.users` com cascata: apagar o usuário de login
-- leva o perfil junto. O caminho contrário deixaria login órfão, capaz de
-- entrar no sistema sem perfil.
delete from auth.users
 where id <> (select id from public.profiles where is_admin_master limit 1);

-- -----------------------------------------------------------------------------
-- 8. CÓDIGOS DE DOCUMENTO — voltam ao 00001.
-- -----------------------------------------------------------------------------
-- PT-, VD- e RN- saem todos da MESMA sequência (é o que garante que um número
-- nunca vale para dois documentos). CN-, RC-, PD- e AT- são contados a partir
-- das próprias tabelas, então recomeçam sozinhos.
alter sequence public.sale_code_seq restart with 1;
alter sequence public.purchase_request_code_seq restart with 1;
alter sequence public.staff_member_code_seq restart with 1;
alter sequence public.procedure_code_seq restart with 1;  -- o catálogo saiu inteiro

-- Contador de rede dos códigos de programa (PPR-, PRE-), criado pela 0245.
-- Condicional: se a 0245 ainda não tiver sido aplicada, a limpeza segue em vez
-- de falhar inteira por causa de uma sequência que não existe.
do $$
begin
  if exists (
    select 1 from pg_class
    where relname = 'client_prefixed_code_seq' and relkind = 'S'
  ) then
    perform setval('public.client_prefixed_code_seq', 1, false);
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 9. A TRAVA FINAL — confere o que tinha de sobreviver, antes de confirmar.
-- -----------------------------------------------------------------------------
-- Esta transação ainda não foi confirmada. Se qualquer uma destas afirmações for
-- falsa, o erro desfaz TUDO e a produção fica exatamente como estava. É a
-- diferença entre "descobri o estrago depois" e "não houve estrago" — e ela
-- existe porque o ensaio mostrou que dá para apagar o que se queria preservar
-- sem receber um único erro pelo caminho.
do $$
declare
  n int;
begin
  select count(*) into n from public.clinics;
  if n <> 1 then raise exception 'PAREI: deveria sobrar 1 clínica, sobraram %.', n; end if;

  if not exists (select 1 from public.clinics where code = 'RF') then
    raise exception 'PAREI: a clínica que sobrou não é a franqueadora (RF).';
  end if;

  select count(*) into n from public.profiles;
  if n <> 1 then raise exception 'PAREI: deveria sobrar 1 usuário, sobraram %.', n; end if;

  if not exists (select 1 from public.profiles where is_admin_master) then
    raise exception 'PAREI: o usuário que sobrou não é o Admin Master.';
  end if;

  select count(*) into n from empresarial.companies;
  if n <> 1 then raise exception 'PAREI: deveria sobrar 1 empresa, sobraram %.', n; end if;

  -- A Agropecuária tem colaboradores cadastrados; se sobraram zero, alguma
  -- cascata os levou — que foi exatamente o defeito achado no ensaio.
  select count(*) into n from empresarial.employees;
  if n = 0 then
    raise exception 'PAREI: os colaboradores da empresa sumiram (alguma cascata os levou).';
  end if;

  -- O que fica é o que faz o sistema funcionar: sem plano de contas não há
  -- financeiro, e um "sobrou zero" aqui seria descoberto tarde demais.
  select count(*) into n from public.chart_of_accounts;
  if n = 0 then raise exception 'PAREI: o plano de contas ficou vazio.'; end if;

  raise notice 'Conferência interna passou. Confirmando.';
end $$;

commit;

-- =============================================================================
-- CONFERÊNCIA — o que ficou de pé.
-- =============================================================================
select 'clínicas (esperado 1)'   as item, count(*) from public.clinics
union all select 'usuários (esperado 1)',      count(*) from public.profiles
union all select 'plano de contas',            count(*) from public.chart_of_accounts
union all select 'centros de custo',           count(*) from public.cost_centers
union all select 'taxas da rede',              count(*) from public.network_fee_types
union all select 'especialidades',             count(*) from public.specialties
union all select 'níveis de carreira',         count(*) from public.career_levels
union all select 'categorias de bens',         count(*) from public.asset_categories
union all select 'modelos de documento',       count(*) from public.document_templates
union all select 'fichas de anamnese',         count(*) from public.anamnesis_templates
union all select 'perguntas de anamnese',      count(*) from public.anamnesis_questions
union all select 'planos PPR+',                count(*) from public.ppr_plans
union all select '— PACIENTES (esperado 0)',   count(*) from public.clients
union all select '— procedimentos (esperado 0)', count(*) from public.procedures
union all select '— itens de estoque (esp. 0)', count(*) from public.stock_items
union all select '— agendamentos (esperado 0)', count(*) from public.appointments
union all select '— lançamentos (esperado 0)',  count(*) from public.financial_entries
union all select 'empresas (esperado 1)',      count(*) from empresarial.companies
union all select 'colaboradores (Agropec.)',   count(*) from empresarial.employees
union all select 'dependentes (Agropec.)',     count(*) from empresarial.dependents;

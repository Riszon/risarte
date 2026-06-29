-- =============================================================================
-- 0053 — Fichas de anamnese configuráveis (Anamnese A2)
-- -----------------------------------------------------------------------------
-- Modelos de ficha de anamnese (templates) + perguntas. O Admin Master cria as
-- fichas-padrão da rede e suas perguntas (clinic_id NULL = pergunta da rede). O
-- Coordenador Clínico pode ACRESCENTAR perguntas específicas da sua unidade
-- (clinic_id = unidade) a uma ficha existente, sem excluir as perguntas da rede
-- e sem criar fichas próprias. O preenchimento por cliente vem na A3.
--
-- Já semeia a ficha "Geral" com as perguntas do PDF do dono. Idempotente.
-- =============================================================================

create table if not exists public.anamnesis_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  is_active boolean not null default true,
  is_default boolean not null default false,
  sort_order int not null default 0,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz
);
alter table public.anamnesis_templates enable row level security;

-- Perguntas de uma ficha. clinic_id NULL = pergunta-padrão da rede (Admin);
-- clinic_id preenchido = acréscimo da unidade (Coordenador).
create table if not exists public.anamnesis_questions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null
    references public.anamnesis_templates (id) on delete cascade,
  clinic_id uuid references public.clinics (id),
  section text,
  label text not null,
  kind text not null check (
    kind in (
      'yes_no', 'yes_no_unknown', 'single_choice',
      'multi_choice', 'short_text', 'long_text'
    )
  ),
  options jsonb,           -- escolhas (single_choice / multi_choice)
  detail_prompt text,      -- se preenchido, abre um campo de detalhe ao marcar "Sim"
  required boolean not null default false,
  sort_order int not null default 0,
  alert_when jsonb,        -- ex.: {"equals":"sim"} ou {"any_of":["AIDS",...]}
  alert_message text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);
create index if not exists anamnesis_questions_template_idx
  on public.anamnesis_questions (template_id);
alter table public.anamnesis_questions enable row level security;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
-- Templates: qualquer autenticado lê (não é dado de paciente); só Admin escreve.
drop policy if exists "anamnesis_templates_select" on public.anamnesis_templates;
create policy "anamnesis_templates_select" on public.anamnesis_templates
  for select to authenticated using (true);

drop policy if exists "anamnesis_templates_write" on public.anamnesis_templates;
create policy "anamnesis_templates_write" on public.anamnesis_templates
  for all to authenticated
  using (public.is_admin_master())
  with check (public.is_admin_master());

-- Perguntas: qualquer autenticado lê. Admin escreve as da rede (clinic_id null);
-- o Coordenador escreve só as da sua unidade (clinic_id = unidade dele).
drop policy if exists "anamnesis_questions_select" on public.anamnesis_questions;
create policy "anamnesis_questions_select" on public.anamnesis_questions
  for select to authenticated using (true);

drop policy if exists "anamnesis_questions_insert" on public.anamnesis_questions;
create policy "anamnesis_questions_insert" on public.anamnesis_questions
  for insert to authenticated
  with check (
    public.is_admin_master()
    or (
      clinic_id is not null
      and public.has_role_in_clinic(clinic_id, array['clinical_coordinator']::public.user_role[])
    )
  );

drop policy if exists "anamnesis_questions_update" on public.anamnesis_questions;
create policy "anamnesis_questions_update" on public.anamnesis_questions
  for update to authenticated
  using (
    public.is_admin_master()
    or (
      clinic_id is not null
      and public.has_role_in_clinic(clinic_id, array['clinical_coordinator']::public.user_role[])
    )
  )
  with check (
    public.is_admin_master()
    or (
      clinic_id is not null
      and public.has_role_in_clinic(clinic_id, array['clinical_coordinator']::public.user_role[])
    )
  );

drop policy if exists "anamnesis_questions_delete" on public.anamnesis_questions;
create policy "anamnesis_questions_delete" on public.anamnesis_questions
  for delete to authenticated
  using (
    public.is_admin_master()
    or (
      clinic_id is not null
      and public.has_role_in_clinic(clinic_id, array['clinical_coordinator']::public.user_role[])
    )
  );

-- -----------------------------------------------------------------------------
-- Seed: ficha "Geral" (perguntas da rede, do PDF). Só insere se ainda não há.
-- -----------------------------------------------------------------------------
do $$
declare
  v_tpl uuid;
  v_alert_sim jsonb := '{"equals":"sim"}'::jsonb;
begin
  select id into v_tpl from public.anamnesis_templates where name = 'Geral' limit 1;
  if v_tpl is null then
    insert into public.anamnesis_templates (name, description, is_default, sort_order)
    values ('Geral', 'Ficha de anamnese padrão (saúde geral, hábitos, doenças, medicamentos, alergias e seção feminina).', true, 0)
    returning id into v_tpl;
  end if;

  if not exists (
    select 1 from public.anamnesis_questions where template_id = v_tpl and clinic_id is null
  ) then
    insert into public.anamnesis_questions
      (template_id, section, label, kind, options, detail_prompt, required, sort_order, alert_when, alert_message)
    values
      (v_tpl, 'Saúde geral', 'Está em tratamento ou acompanhamento médico?', 'yes_no', null, 'Qual é o tratamento? Nome e telefone do médico responsável.', true, 10, v_alert_sim, 'Paciente em tratamento/acompanhamento médico.'),
      (v_tpl, 'Saúde geral', 'Quando fez o último exame físico médico?', 'short_text', null, null, false, 20, null, null),
      (v_tpl, 'Saúde geral', 'Quando fez seu último tratamento odontológico?', 'short_text', null, null, false, 30, null, null),

      (v_tpl, 'Hábitos', 'Range os dentes à noite?', 'yes_no_unknown', null, null, false, 40, null, null),
      (v_tpl, 'Hábitos', 'Aperta os dentes costumeiramente?', 'yes_no_unknown', null, null, false, 50, null, null),
      (v_tpl, 'Hábitos', 'Sente dificuldade em abrir a boca?', 'yes_no', null, null, false, 60, null, null),
      (v_tpl, 'Hábitos', 'Você fuma?', 'yes_no', null, null, false, 70, v_alert_sim, 'Paciente fumante.'),
      (v_tpl, 'Hábitos', 'Você bebe?', 'yes_no', null, null, false, 80, null, null),

      (v_tpl, 'Doenças', 'Marque as doenças/condições que tem ou já teve:', 'multi_choice',
        '["Febre reumática","Doença cardíaca reumática","Anormalidade cardíaca desde o nascimento","Doença cardiovascular","Problemas cardíacos","Angina","Derrame","Pressão arterial alta","Murmúrio cardíaco","Asma","Sinusite","Diabetes","Osteoporose","Anemia (incluindo anemia falciforme)","Hepatite, icterícia ou doença hepática","Úlcera estomacal","Tuberculose","AIDS"]'::jsonb,
        null, false, 90,
        '{"any_of":["Doença cardíaca reumática","Anormalidade cardíaca desde o nascimento","Doença cardiovascular","Problemas cardíacos","Angina","Derrame","Pressão arterial alta","Murmúrio cardíaco","Diabetes","Hepatite, icterícia ou doença hepática","Tuberculose","AIDS"]}'::jsonb,
        'Condição de saúde relevante marcada — atenção no atendimento.'),
      (v_tpl, 'Doenças', 'Tem ou teve alguma outra doença/alteração não citada acima?', 'yes_no', null, 'Cite qual.', false, 100, null, null),

      (v_tpl, 'Medicamentos', 'Está fazendo uso de alguma droga ou medicamento (incluindo homeopáticos)?', 'yes_no', null, 'Quais medicamentos e por quê?', false, 110, v_alert_sim, 'Paciente faz uso de medicamento(s).'),

      (v_tpl, 'Sangramento e cicatrização', 'Tem problemas de cicatrização ou sangramento?', 'yes_no', null, null, false, 120, v_alert_sim, 'Risco de sangramento/cicatrização.'),
      (v_tpl, 'Sangramento e cicatrização', 'Tem hematomas com frequência?', 'yes_no', null, null, false, 130, v_alert_sim, 'Hematomas frequentes.'),
      (v_tpl, 'Sangramento e cicatrização', 'Já precisou de transfusão sanguínea?', 'yes_no', null, null, false, 140, null, null),

      (v_tpl, 'Histórico odontológico', 'Já teve algum problema associado a tratamento odontológico?', 'yes_no', null, 'Explique.', false, 150, null, null),
      (v_tpl, 'Histórico odontológico', 'Já tomou anestesia em tratamento odontológico?', 'yes_no', null, null, false, 160, null, null),
      (v_tpl, 'Histórico odontológico', 'Já tomou anestesia geral?', 'yes_no', null, null, false, 170, null, null),
      (v_tpl, 'Histórico odontológico', 'Já tomou anestesia local?', 'yes_no', null, null, false, 180, null, null),
      (v_tpl, 'Histórico odontológico', 'Teve problemas com anestesia?', 'yes_no', null, 'Explique.', false, 190, v_alert_sim, 'Histórico de problema com anestesia.'),
      (v_tpl, 'Histórico odontológico', 'Já fez alguma cirurgia odontológica (extração, biópsia, implante, enxerto ósseo)?', 'yes_no', null, 'Como foi?', false, 200, null, null),

      (v_tpl, 'Alergias', 'Tem alergia a algum medicamento?', 'yes_no', null, 'Especifique.', false, 210, v_alert_sim, 'Alergia a medicamento.'),
      (v_tpl, 'Alergias', 'Tem alergia a algum alimento?', 'yes_no', null, 'Especifique.', false, 220, null, null),
      (v_tpl, 'Alergias', 'Tem algum outro tipo de alergia?', 'yes_no', null, 'Especifique.', false, 230, null, null),

      (v_tpl, 'Outras informações', 'Sabe seu tipo sanguíneo?', 'yes_no', null, 'Especifique.', false, 240, null, null),
      (v_tpl, 'Outras informações', 'Foi hospitalizado nos últimos 5 anos?', 'yes_no', null, 'Qual o motivo?', false, 250, null, null),

      (v_tpl, 'Específicas para mulheres', 'Toma anticoncepcional?', 'yes_no', null, null, false, 260, null, null),
      (v_tpl, 'Específicas para mulheres', 'Está ou pode estar grávida?', 'yes_no', null, 'Tempo de gestação?', false, 270, v_alert_sim, 'Paciente gestante ou possível gestação.'),
      (v_tpl, 'Específicas para mulheres', 'Está amamentando?', 'yes_no', null, null, false, 280, v_alert_sim, 'Paciente amamentando.'),
      (v_tpl, 'Específicas para mulheres', 'Já entrou em processo de menopausa?', 'yes_no', null, 'Está sendo orientada por um ginecologista?', false, 290, null, null),
      (v_tpl, 'Específicas para mulheres', 'Toma hormônios?', 'yes_no', null, null, false, 300, null, null),
      (v_tpl, 'Específicas para mulheres', 'Toma cálcio?', 'yes_no', null, null, false, 310, null, null),
      (v_tpl, 'Específicas para mulheres', 'Toma algum remédio para os ossos?', 'yes_no', null, null, false, 320, null, null),

      (v_tpl, 'Observações', 'Observações gerais', 'long_text', null, null, false, 330, null, null),

      (v_tpl, 'Contato de emergência', 'Nome do contato de emergência (familiar ou amigo)', 'short_text', null, null, false, 340, null, null),
      (v_tpl, 'Contato de emergência', 'Telefone do contato de emergência', 'short_text', null, null, false, 350, null, null);
  end if;
end $$;

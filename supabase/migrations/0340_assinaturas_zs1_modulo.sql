-- =============================================================================
-- 0340 — ASSINATURA DIGITAL (ZapSign) — FASE ZS1: o alicerce no banco
-- -----------------------------------------------------------------------------
-- Plano aprovado pelo dono em 31/10/2026: docs/assinaturas/PLANO-ZS0.md
-- (seções 4.3, 6 e 8). Esta migração cria o módulo `signature_*` no schema
-- `public`: tabelas, RLS, a função `signature_can`, os gatilhos de blindagem,
-- o bucket privado dos PDFs e as permissões semeadas. Nenhum envio acontece
-- ainda (ZS2); nenhum webhook (ZS3).
--
-- ⚠️ EXCEÇÃO À REGRA DA 0246, RESTRITA A ESTE MÓDULO (decisão do dono):
-- as políticas de RLS daqui LEEM a `permission_matrix` por
-- `public.signature_can(capacidade, unidade)`. Mudar um papel na tela
-- Administração → Permissões muda o banco também, sem código. Fora deste
-- módulo a 0246 continua valendo: a matriz só governa a tela.
--
-- O que fica FIXO (não passa pela matriz):
--   * Admin Master e Admin Principal (`is_owner`) sempre podem.
--   * O Consultor RisLife só enxerga pacotes de empresas/leads em que é o
--     consultor responsável (`signature_consultant_scope_ok`). Pacote de
--     paciente não é dele.
--
-- Blindagens:
--   * NENHUMA policy de DELETE em tabela do módulo.
--   * `signature_packages_no_delete`: pacote nunca é apagado, nem pela chave
--     de serviço.
--   * `signature_packages_guard_signed`: pacote assinado só aceita gravar o
--     caminho do PDF assinado e a conclusão; nunca sai de `signed`.
--   * `signature_events` é imutável (sem UPDATE/DELETE).
--   * Bucket `signature-documents`: privado, 10 MB, só PDF; leitura por quem
--     vê o pacote; sem UPDATE/DELETE para `authenticated` (os PDFs nascem no
--     servidor, pela chave de serviço).
--
-- Idempotente. Não apaga dado. Dinheiro em centavos.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) QUEM PODE — a função que lê a matriz
-- -----------------------------------------------------------------------------
-- Os padrões de fábrica do código (`src/lib/permissions.ts`, grupo
-- "Assinaturas digitais"), para quando a matriz está VAZIA — o aplicativo faz
-- o mesmo (`matrizPadrao()`). Mudou lá, muda aqui (há teste que compara os
-- dois: `assinaturas-permissoes.test.ts`).
create or replace function public.signature_default_roles(p_capability text)
returns public.user_role[]
language sql
immutable
set search_path = ''
as $$
  select case p_capability
    when 'modulo.assinaturas' then
      array['commercial_consultant','rislife_consultant','commercial_assistant',
            'finance_franchisor','unit_manager','clinical_coordinator']::public.user_role[]
    when 'acao.assinaturas.enviar' then
      array['commercial_consultant','rislife_consultant','commercial_assistant',
            'finance_franchisor','unit_manager']::public.user_role[]
    when 'acao.assinaturas.cancelar' then
      array['commercial_consultant','rislife_consultant','commercial_assistant',
            'finance_franchisor','unit_manager']::public.user_role[]
    when 'acao.assinaturas.visualizar' then
      array['commercial_consultant','rislife_consultant','commercial_assistant',
            'finance_franchisor','unit_manager','clinical_coordinator']::public.user_role[]
    when 'acao.assinaturas.baixar' then
      array['commercial_consultant','rislife_consultant','commercial_assistant',
            'finance_franchisor','unit_manager','clinical_coordinator']::public.user_role[]
    when 'acao.assinaturas.painel_unidade' then
      array['commercial_consultant','rislife_consultant','commercial_assistant',
            'finance_franchisor','unit_manager']::public.user_role[]
    when 'acao.assinaturas.painel_rede' then
      array['finance_franchisor']::public.user_role[]
    else '{}'::public.user_role[]
  end;
$$;

revoke execute on function public.signature_default_roles(text) from public, anon, authenticated;

-- Esta pessoa pode esta capacidade nesta unidade?
--   * Admin Master / Admin Principal: sempre.
--   * Papéis considerados: os que a pessoa tem NA unidade, mais os que tem na
--     Franqueadora quando o escopo dela alcança a unidade
--     (`user_full_access_clinic_ids`). Com `p_clinic_id` nulo, vale qualquer
--     papel em qualquer unidade (é como o menu pergunta).
--   * Com a matriz gravada: algum desses papéis está marcado para a
--     capacidade. Matriz vazia: os padrões de fábrica acima.
-- `user_clinic_roles` é a janela da 0277: a tranca por unidade já vale.
create or replace function public.signature_can(p_capability text, p_clinic_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_roles public.user_role[];
  v_matrix_in_use boolean;
begin
  if v_uid is null or p_capability is null then
    return false;
  end if;
  if public.is_admin_master() or public.is_owner() then
    return true;
  end if;

  select coalesce(array_agg(distinct ucr.role), '{}'::public.user_role[])
    into v_roles
    from public.user_clinic_roles ucr
    join public.clinics c on c.id = ucr.clinic_id
   where ucr.user_id = v_uid
     and (
       p_clinic_id is null
       or ucr.clinic_id = p_clinic_id
       or (c.type = 'franchisor'
           and p_clinic_id in (select public.user_full_access_clinic_ids()))
     );

  if coalesce(array_length(v_roles, 1), 0) = 0 then
    return false;
  end if;

  select exists (select 1 from public.permission_matrix) into v_matrix_in_use;

  if v_matrix_in_use then
    return exists (
      select 1 from public.permission_matrix pm
       where pm.capability = p_capability
         and pm.allowed
         and pm.role = any (v_roles)
    );
  end if;

  return exists (
    select 1 from unnest(public.signature_default_roles(p_capability)) as r
     where r = any (v_roles)
  );
end;
$$;

revoke execute on function public.signature_can(text, uuid) from public, anon, authenticated;
grant execute on function public.signature_can(text, uuid) to authenticated;

-- A trava FIXA do Consultor RisLife (fora da matriz): quem só tem o papel de
-- Consultor RisLife enxerga apenas os pacotes da empresa ou do lead em que é
-- o responsável. Quem tem qualquer outro papel não é limitado por aqui (a
-- matriz e a unidade já decidem). Pacote sem empresa e sem lead (paciente)
-- não é do RisLife.
create or replace function public.signature_consultant_scope_ok(p_company_id uuid, p_lead_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_only_rislife boolean;
begin
  if v_uid is null then
    return false;
  end if;
  if public.is_admin_master() or public.is_owner() then
    return true;
  end if;

  select bool_and(ucr.role = 'rislife_consultant') and count(*) > 0
    into v_only_rislife
    from public.user_clinic_roles ucr
   where ucr.user_id = v_uid;

  if not coalesce(v_only_rislife, false) then
    return true;
  end if;

  if p_company_id is not null and exists (
       select 1 from empresarial.companies c
        where c.id = p_company_id and c.assigned_consultant_id = v_uid) then
    return true;
  end if;
  if p_lead_id is not null and exists (
       select 1 from empresarial.commercial_leads l
        where l.id = p_lead_id and l.consultant_id = v_uid) then
    return true;
  end if;
  return false;
end;
$$;

revoke execute on function public.signature_consultant_scope_ok(uuid, uuid) from public, anon, authenticated;
grant execute on function public.signature_consultant_scope_ok(uuid, uuid) to authenticated;

-- `updated_at` sozinho.
create or replace function public.signature_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- 2) CONFIGURAÇÃO DA REDE (uma linha)
-- -----------------------------------------------------------------------------
create table if not exists public.signature_settings (
  id boolean primary key default true check (id),
  -- Acima deste valor (centavos) a autenticação do cliente é reforçada
  -- (selfie + código). Padrão R$ 5.000,00.
  strong_auth_threshold_cents integer not null default 500000 check (strong_auth_threshold_cents >= 0),
  patient_expiry_days integer not null default 7 check (patient_expiry_days between 1 and 90),
  company_expiry_days integer not null default 15 check (company_expiry_days between 1 and 90),
  -- Em que dias depois do envio quem enviou recebe o lembrete do que está parado.
  reminder_days integer[] not null default '{2,5}'::integer[],
  -- As faixas de espera do painel (≤2, 3–5, 6–7, >7 dias).
  waiting_buckets_days integer[] not null default '{2,5,7}'::integer[],
  default_message text not null default
    'Olá, {{nome}}! A {{unidade}} enviou um documento para a sua assinatura digital. Abra o link para ler e assinar: {{link}} — o prazo vai até {{prazo}}. Qualquer dúvida, é só responder esta mensagem.',
  -- A ZapSign manda e-mail aos signatários? Padrão: não (o riSZon manda o link).
  zapsign_emails_enabled boolean not null default false,
  zapsign_plan_name text,
  zapsign_monthly_limit integer check (zapsign_monthly_limit is null or zapsign_monthly_limit >= 0),
  zapsign_alert_percent integer not null default 80 check (zapsign_alert_percent between 1 and 100),
  -- [{ "name": "...", "email": "..." }] — quem recebe o relatório mensal.
  monthly_report_recipients jsonb not null default '[]'::jsonb,
  -- Pacote sem evento há mais de X horas é conferido na ZapSign pelo cron.
  reconcile_after_hours integer not null default 6 check (reconcile_after_hours between 1 and 168),
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

comment on table public.signature_settings is
  'ZS1: parâmetros da rede para a assinatura digital (uma linha). Editada em /assinaturas/configuracoes por quem tem acao.assinaturas.configurar (Admin Master sempre).';

alter table public.signature_settings enable row level security;

drop policy if exists "signature_settings_select" on public.signature_settings;
create policy "signature_settings_select" on public.signature_settings
  for select to authenticated
  using (public.signature_can('modulo.assinaturas', null)
         or public.signature_can('acao.assinaturas.configurar', null));

drop trigger if exists signature_settings_touch on public.signature_settings;
create trigger signature_settings_touch
  before update on public.signature_settings
  for each row execute function public.signature_touch_updated_at();

insert into public.signature_settings (id) values (true)
on conflict (id) do nothing;

-- A porta de gravação da configuração.
create or replace function public.signature_save_settings(
  p_strong_auth_threshold_cents integer,
  p_patient_expiry_days integer,
  p_company_expiry_days integer,
  p_reminder_days integer[],
  p_waiting_buckets_days integer[],
  p_default_message text,
  p_zapsign_emails_enabled boolean,
  p_zapsign_plan_name text,
  p_zapsign_monthly_limit integer,
  p_zapsign_alert_percent integer,
  p_monthly_report_recipients jsonb,
  p_reconcile_after_hours integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.signature_can('acao.assinaturas.configurar', null) then
    raise exception 'NOT_ALLOWED';
  end if;
  if p_default_message is null or btrim(p_default_message) = '' then
    raise exception 'MESSAGE_REQUIRED';
  end if;
  if p_monthly_report_recipients is not null
     and jsonb_typeof(p_monthly_report_recipients) <> 'array' then
    raise exception 'RECIPIENTS_INVALID';
  end if;

  update public.signature_settings set
    strong_auth_threshold_cents = coalesce(p_strong_auth_threshold_cents, strong_auth_threshold_cents),
    patient_expiry_days = coalesce(p_patient_expiry_days, patient_expiry_days),
    company_expiry_days = coalesce(p_company_expiry_days, company_expiry_days),
    reminder_days = coalesce(p_reminder_days, reminder_days),
    waiting_buckets_days = coalesce(p_waiting_buckets_days, waiting_buckets_days),
    default_message = btrim(p_default_message),
    zapsign_emails_enabled = coalesce(p_zapsign_emails_enabled, zapsign_emails_enabled),
    zapsign_plan_name = nullif(btrim(coalesce(p_zapsign_plan_name, '')), ''),
    zapsign_monthly_limit = p_zapsign_monthly_limit,
    zapsign_alert_percent = coalesce(p_zapsign_alert_percent, zapsign_alert_percent),
    monthly_report_recipients = coalesce(p_monthly_report_recipients, monthly_report_recipients),
    reconcile_after_hours = coalesce(p_reconcile_after_hours, reconcile_after_hours),
    updated_by = (select auth.uid())
  where id = true;
end;
$$;

revoke execute on function public.signature_save_settings(integer, integer, integer, integer[], integer[], text, boolean, text, integer, integer, jsonb, integer) from public, anon, authenticated;
grant execute on function public.signature_save_settings(integer, integer, integer, integer[], integer[], text, boolean, text, integer, integer, jsonb, integer) to authenticated;

-- -----------------------------------------------------------------------------
-- 3) MODELOS E KITS (vazios na ZS1; a ZS2 semeia os 5 modelos)
-- -----------------------------------------------------------------------------
create table if not exists public.signature_templates (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z][a-z0-9_]{1,59}$'),
  name text not null check (btrim(name) <> ''),
  audience text not null check (audience in ('patient', 'company')),
  kind text not null check (kind in ('contract', 'consent', 'budget', 'image_release', 'adhesion', 'other')),
  -- { preamble, sections: [{ title, body }], closing }. Nulo quando o texto
  -- vem de fora (`source`).
  body jsonb,
  source text check (source is null or source in ('empresarial_contract_templates')),
  variables text[] not null default '{}'::text[],
  auth_level text not null default 'by_amount' check (auth_level in ('simple', 'strong', 'by_amount')),
  witness_count integer not null default 0 check (witness_count between 0 and 2),
  witness_mode text not null default 'choose_at_send' check (witness_mode in ('fixed', 'choose_at_send')),
  default_witness_staff_ids uuid[] not null default '{}'::uuid[],
  risarte_signer_mode text not null default 'role' check (risarte_signer_mode in ('role', 'sender', 'user', 'none')),
  risarte_signer_role public.user_role,
  risarte_signer_user_id uuid references public.profiles (id) on delete set null,
  is_active boolean not null default true,
  is_provisional_text boolean not null default true,
  sort_order integer not null default 0,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.signature_templates is
  'ZS1: modelos de documento para assinatura digital (contrato, TCLE, orçamento aprovado, autorização de imagem, adesão empresarial). Texto no formato do Empresarial ({{campos}}).';

alter table public.signature_templates enable row level security;

drop policy if exists "signature_templates_select" on public.signature_templates;
create policy "signature_templates_select" on public.signature_templates
  for select to authenticated
  using (public.signature_can('modulo.assinaturas', null)
         or public.signature_can('acao.assinaturas.configurar', null));

drop trigger if exists signature_templates_touch on public.signature_templates;
create trigger signature_templates_touch
  before update on public.signature_templates
  for each row execute function public.signature_touch_updated_at();

create table if not exists public.signature_kits (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  audience text not null check (audience in ('patient', 'company')),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.signature_kits is
  'ZS1: kits — conjuntos de modelos enviados juntos num pacote.';

alter table public.signature_kits enable row level security;

drop policy if exists "signature_kits_select" on public.signature_kits;
create policy "signature_kits_select" on public.signature_kits
  for select to authenticated
  using (public.signature_can('modulo.assinaturas', null)
         or public.signature_can('acao.assinaturas.configurar', null));

drop trigger if exists signature_kits_touch on public.signature_kits;
create trigger signature_kits_touch
  before update on public.signature_kits
  for each row execute function public.signature_touch_updated_at();

create table if not exists public.signature_kit_items (
  id uuid primary key default gen_random_uuid(),
  kit_id uuid not null references public.signature_kits (id) on delete cascade,
  template_id uuid not null references public.signature_templates (id) on delete restrict,
  sort_order integer not null default 0,
  unique (kit_id, template_id)
);

comment on table public.signature_kit_items is
  'ZS1: os modelos de cada kit, na ordem.';

create index if not exists signature_kit_items_kit_idx on public.signature_kit_items (kit_id, sort_order);

alter table public.signature_kit_items enable row level security;

drop policy if exists "signature_kit_items_select" on public.signature_kit_items;
create policy "signature_kit_items_select" on public.signature_kit_items
  for select to authenticated
  using (exists (select 1 from public.signature_kits k where k.id = kit_id));

-- -----------------------------------------------------------------------------
-- 4) O PACOTE (= 1 documento na ZapSign) e o número legível ASS-000001
-- -----------------------------------------------------------------------------
create sequence if not exists public.signature_package_number_seq;

create table if not exists public.signature_packages (
  id uuid primary key default gen_random_uuid(),
  number text not null unique
    default ('ASS-' || lpad(nextval('public.signature_package_number_seq')::text, 6, '0')),
  -- A unidade emissora. Pacote do Empresarial sai da Franqueadora.
  clinic_id uuid not null references public.clinics (id) on delete restrict,
  issuer_cnpj text,
  audience text not null check (audience in ('patient', 'company')),
  origin_type text not null check (origin_type in
    ('client', 'plan_negotiation', 'treatment_plan', 'company', 'company_document', 'commercial_lead')),
  origin_id uuid,
  client_id uuid references public.clients (id) on delete set null,
  -- Ligação com o Empresarial POR COLUNA (plano §6): sem chave estrangeira
  -- aqui, para o core não depender do schema `empresarial` na ordem das
  -- migrações. A ZS5 (1038) liga do lado de lá.
  company_id uuid,
  lead_id uuid,
  company_document_id uuid,
  zapsign_doc_token text unique,
  zapsign_open_id integer,
  status text not null default 'draft' check (status in
    ('draft', 'sent', 'partially_signed', 'signed', 'refused', 'expired', 'cancelled')),
  current_stage text not null default 'client' check (current_stage in ('client', 'witnesses', 'risarte', 'done')),
  linked_amount_cents integer check (linked_amount_cents is null or linked_amount_cents >= 0),
  auth_level_applied text check (auth_level_applied is null or auth_level_applied in ('simple', 'strong')),
  auth_reason text,
  sent_at timestamptz,
  client_signed_at timestamptz,
  expires_at timestamptz,
  completed_at timestamptz,
  merged_pdf_path text,
  signed_pdf_path text,
  merged_page_count integer check (merged_page_count is null or merged_page_count > 0),
  sent_by uuid references public.profiles (id) on delete set null,
  cancel_reason text,
  cancelled_by uuid references public.profiles (id) on delete set null,
  cancelled_at timestamptz,
  refused_reason text,
  resent_from_package_id uuid references public.signature_packages (id) on delete set null,
  -- 'aaaa-mm' — o mês em que o documento foi criado na ZapSign (consumo).
  plan_month text check (plan_month is null or plan_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  cover_data jsonb,
  channel_used text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.signature_packages is
  'ZS1: o envio para assinatura digital (= 1 documento na ZapSign). Nunca é apagado (gatilho); assinado não muda de situação (gatilho).';

create index if not exists signature_packages_clinic_status_idx on public.signature_packages (clinic_id, status, sent_at);
create index if not exists signature_packages_client_idx on public.signature_packages (client_id);
create index if not exists signature_packages_company_idx on public.signature_packages (company_id);
create index if not exists signature_packages_lead_idx on public.signature_packages (lead_id);
create index if not exists signature_packages_plan_month_idx on public.signature_packages (plan_month);

alter table public.signature_packages enable row level security;

-- Quem vê o pacote: a capacidade de visualizar NA unidade emissora (ou o
-- painel da rede, que libera todas), E a trava fixa do RisLife.
drop policy if exists "signature_packages_select" on public.signature_packages;
create policy "signature_packages_select" on public.signature_packages
  for select to authenticated
  using (
    (public.signature_can('acao.assinaturas.visualizar', clinic_id)
     or public.signature_can('acao.assinaturas.painel_rede', null))
    and public.signature_consultant_scope_ok(company_id, lead_id)
  );

drop trigger if exists signature_packages_touch on public.signature_packages;
create trigger signature_packages_touch
  before update on public.signature_packages
  for each row execute function public.signature_touch_updated_at();

-- A mesma pergunta, para as tabelas filhas e para o Storage.
create or replace function public.signature_can_view_package(p_package_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.signature_packages p
     where p.id = p_package_id
       and (public.signature_can('acao.assinaturas.visualizar', p.clinic_id)
            or public.signature_can('acao.assinaturas.painel_rede', null))
       and public.signature_consultant_scope_ok(p.company_id, p.lead_id)
  );
$$;

revoke execute on function public.signature_can_view_package(uuid) from public, anon, authenticated;
grant execute on function public.signature_can_view_package(uuid) to authenticated;

-- PACOTE NUNCA É APAGADO — nem pela chave de serviço. Documento assinado é
-- prova; rascunho que sobrou vira `cancelled`.
create or replace function public.signature_packages_no_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'SIGNATURE_PACKAGE_NO_DELETE'
    using hint = 'Pacote de assinatura não pode ser excluído. Cancele-o.';
end;
$$;

drop trigger if exists signature_packages_no_delete on public.signature_packages;
create trigger signature_packages_no_delete
  before delete on public.signature_packages
  for each row execute function public.signature_packages_no_delete();

-- PACOTE ASSINADO NÃO MUDA: só o caminho do PDF assinado, a conclusão e o
-- `updated_at` podem ser gravados depois de `signed`. Qualquer outra coluna
-- (inclusive a situação) é recusada — assinado não cancela, não expira, não
-- volta a rascunho.
create or replace function public.signature_packages_guard_signed()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_allowed public.signature_packages;
begin
  if old.status <> 'signed' then
    return new;
  end if;
  v_allowed := old;
  v_allowed.signed_pdf_path := new.signed_pdf_path;
  v_allowed.completed_at := new.completed_at;
  v_allowed.updated_at := new.updated_at;
  if row(new.*) is distinct from row(v_allowed.*) then
    raise exception 'SIGNATURE_PACKAGE_SIGNED_LOCKED'
      using hint = 'Pacote assinado não muda: só o PDF assinado e a data de conclusão podem ser gravados.';
  end if;
  return new;
end;
$$;

drop trigger if exists signature_packages_guard_signed on public.signature_packages;
create trigger signature_packages_guard_signed
  before update on public.signature_packages
  for each row execute function public.signature_packages_guard_signed();

-- -----------------------------------------------------------------------------
-- 5) OS DOCUMENTOS DO PACOTE
-- -----------------------------------------------------------------------------
create table if not exists public.signature_package_items (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references public.signature_packages (id) on delete cascade,
  sort_order integer not null default 0,
  -- Nulo = PDF avulso anexado.
  template_id uuid references public.signature_templates (id) on delete set null,
  title text not null check (btrim(title) <> ''),
  source_pdf_path text,
  -- O retrato dos valores no momento do envio: "qual versão foi assinada".
  rendered_data jsonb,
  first_page integer check (first_page is null or first_page > 0),
  last_page integer check (last_page is null or last_page > 0),
  origin_type text,
  origin_id uuid,
  created_at timestamptz not null default now()
);

comment on table public.signature_package_items is
  'ZS1: cada documento de um pacote de assinatura, com o retrato dos valores preenchidos e as páginas no PDF mesclado.';

create index if not exists signature_package_items_package_idx on public.signature_package_items (package_id, sort_order);

alter table public.signature_package_items enable row level security;

drop policy if exists "signature_package_items_select" on public.signature_package_items;
create policy "signature_package_items_select" on public.signature_package_items
  for select to authenticated
  using (public.signature_can_view_package(package_id));

-- -----------------------------------------------------------------------------
-- 6) OS SIGNATÁRIOS
-- -----------------------------------------------------------------------------
create table if not exists public.signature_signers (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references public.signature_packages (id) on delete cascade,
  sort_order integer not null default 0,
  -- 1 = cliente (e o lado dele), 2 = testemunhas, 3 = representantes da Risarte.
  order_group integer not null default 1 check (order_group between 1 and 3),
  signer_type text not null check (signer_type in
    ('client', 'legal_guardian', 'company_representative', 'witness', 'risarte_representative', 'other')),
  name text not null check (btrim(name) <> ''),
  cpf text,
  email text,
  phone text,
  -- Quando o signatário é alguém do sistema (representante, testemunha).
  user_id uuid references public.profiles (id) on delete set null,
  staff_member_id uuid references public.staff_members (id) on delete set null,
  zapsign_signer_token text unique,
  sign_url text,
  status text not null default 'pending' check (status in ('pending', 'link_opened', 'signed', 'refused')),
  signed_at timestamptz,
  last_notified_at timestamptz,
  auth_mode_applied text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.signature_signers is
  'ZS1: quem assina cada pacote, em que ordem e em que pé está. Dado pessoal (CPF, telefone, e-mail): leitura só por quem vê o pacote ou pela própria pessoa.';

create index if not exists signature_signers_package_idx on public.signature_signers (package_id, order_group, sort_order);
create index if not exists signature_signers_user_idx on public.signature_signers (user_id) where user_id is not null;

alter table public.signature_signers enable row level security;

-- Quem vê o pacote vê os signatários; e cada pessoa do sistema vê a PRÓPRIA
-- linha ("Minhas assinaturas pendentes", ZS3).
drop policy if exists "signature_signers_select" on public.signature_signers;
create policy "signature_signers_select" on public.signature_signers
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.signature_can_view_package(package_id)
  );

drop trigger if exists signature_signers_touch on public.signature_signers;
create trigger signature_signers_touch
  before update on public.signature_signers
  for each row execute function public.signature_touch_updated_at();

-- -----------------------------------------------------------------------------
-- 7) O LOG IMUTÁVEL DOS EVENTOS (webhook, ações, erros)
-- -----------------------------------------------------------------------------
create table if not exists public.signature_events (
  id bigint generated always as identity primary key,
  package_id uuid references public.signature_packages (id) on delete restrict,
  event_type text not null check (btrim(event_type) <> ''),
  -- Idempotência do webhook: o mesmo evento chegando duas vezes não entra.
  event_key text unique,
  -- O MÍNIMO do payload (tokens, situação, datas). Nunca o PDF nem dado pessoal
  -- além do que já está no pacote.
  payload jsonb,
  actor_user_id uuid references public.profiles (id) on delete set null,
  error text,
  created_at timestamptz not null default now()
);

comment on table public.signature_events is
  'ZS1: o que aconteceu com cada pacote (webhook da ZapSign, ações, falhas). Imutável: sem UPDATE nem DELETE. Fora da auditoria (já é a trilha do módulo).';

create index if not exists signature_events_package_idx on public.signature_events (package_id, created_at);

alter table public.signature_events enable row level security;

drop policy if exists "signature_events_select" on public.signature_events;
create policy "signature_events_select" on public.signature_events
  for select to authenticated
  using (
    package_id is not null and public.signature_can_view_package(package_id)
    or (package_id is null and public.is_admin_master())
  );

create or replace function public.signature_events_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'SIGNATURE_EVENT_IMMUTABLE'
    using hint = 'O registro de eventos da assinatura não se altera nem se apaga.';
end;
$$;

drop trigger if exists signature_events_immutable on public.signature_events;
create trigger signature_events_immutable
  before update or delete on public.signature_events
  for each row execute function public.signature_events_immutable();

-- -----------------------------------------------------------------------------
-- 8) REGISTROS TÉCNICOS: lembretes, alertas do plano e fila de e-mail
-- -----------------------------------------------------------------------------
create table if not exists public.signature_reminders (
  package_id uuid not null references public.signature_packages (id) on delete cascade,
  day_offset integer not null check (day_offset >= 0),
  sent_at timestamptz not null default now(),
  primary key (package_id, day_offset)
);

comment on table public.signature_reminders is
  'ZS1: dedupe dos lembretes a quem enviou (um por pacote e dia configurado). Registro técnico, fora da auditoria.';

alter table public.signature_reminders enable row level security;

drop policy if exists "signature_reminders_select" on public.signature_reminders;
create policy "signature_reminders_select" on public.signature_reminders
  for select to authenticated
  using (public.signature_can_view_package(package_id));

create table if not exists public.signature_plan_alerts (
  plan_month text not null check (plan_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  threshold_percent integer not null check (threshold_percent between 1 and 100),
  used_count integer not null default 0,
  monthly_limit integer,
  sent_at timestamptz not null default now(),
  primary key (plan_month, threshold_percent)
);

comment on table public.signature_plan_alerts is
  'ZS1: dedupe dos alertas de consumo do plano ZapSign (um por mês e faixa). Registro técnico, fora da auditoria.';

alter table public.signature_plan_alerts enable row level security;

drop policy if exists "signature_plan_alerts_select" on public.signature_plan_alerts;
create policy "signature_plan_alerts_select" on public.signature_plan_alerts
  for select to authenticated
  using (public.signature_can('acao.assinaturas.painel_rede', null)
         or public.signature_can('acao.assinaturas.configurar', null));

create table if not exists public.signature_outbox (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('signed_copy', 'plan_alert', 'monthly_report', 'other')),
  package_id uuid references public.signature_packages (id) on delete set null,
  to_email text not null check (btrim(to_email) <> ''),
  to_name text,
  subject text not null check (btrim(subject) <> ''),
  body_text text not null,
  attachment_path text,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

comment on table public.signature_outbox is
  'ZS1: fila de e-mails do módulo (cópia assinada, alerta de consumo, relatório mensal), enviada pelo cron horário quando houver adaptador de e-mail. Registro técnico, fora da auditoria. Só o servidor lê e grava.';

create index if not exists signature_outbox_pending_idx on public.signature_outbox (status, created_at) where status = 'pending';

alter table public.signature_outbox enable row level security;

drop policy if exists "signature_outbox_select" on public.signature_outbox;
create policy "signature_outbox_select" on public.signature_outbox
  for select to authenticated
  using (public.is_admin_master());

-- -----------------------------------------------------------------------------
-- 9) O BUCKET PRIVADO DOS PDFs
-- -----------------------------------------------------------------------------
-- Caminho: {clinic_id}/{audience}/{package_id}/merged.pdf | signed.pdf | ...
-- 10 MB por arquivo (limite da ZapSign) e só PDF. Gravação só pela chave de
-- serviço (os PDFs nascem no servidor): nenhuma policy de INSERT, UPDATE ou
-- DELETE para `authenticated`.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('signature-documents', 'signature-documents', false, 10485760, array['application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- A terceira pasta do caminho é o pacote.
create or replace function public.signature_package_of_path(p_name text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when (storage.foldername(p_name))[3] ~
         '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then ((storage.foldername(p_name))[3])::uuid
    else null
  end;
$$;

revoke execute on function public.signature_package_of_path(text) from public, anon, authenticated;
grant execute on function public.signature_package_of_path(text) to authenticated;

drop policy if exists "signature_documents_select" on storage.objects;
create policy "signature_documents_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'signature-documents'
    and public.signature_can_view_package(public.signature_package_of_path(name))
  );

-- Se alguma versão anterior tiver criado policies de escrita, elas saem: só o
-- servidor grava aqui.
drop policy if exists "signature_documents_insert" on storage.objects;
drop policy if exists "signature_documents_update" on storage.objects;
drop policy if exists "signature_documents_delete" on storage.objects;

-- -----------------------------------------------------------------------------
-- 10) AS PERMISSÕES NA MATRIZ (plano §8) — e o padrão fixado
-- -----------------------------------------------------------------------------
-- Só semeia se a matriz já estiver em uso (como a 0318): semear numa matriz
-- vazia trocaria o padrão de código de TODAS as permissões por estas oito.
-- `on conflict do nothing`: rodar de novo não desfaz ajuste do dono.
-- `acao.assinaturas.configurar` não tem papel: só o Admin Master (pela flag).
do $$
begin
  if exists (select 1 from public.permission_matrix) then
    insert into public.permission_matrix (capability, role)
    select cap, r
      from (values
        ('modulo.assinaturas'), ('acao.assinaturas.enviar'), ('acao.assinaturas.cancelar'),
        ('acao.assinaturas.visualizar'), ('acao.assinaturas.baixar'),
        ('acao.assinaturas.painel_unidade'), ('acao.assinaturas.painel_rede')
      ) as caps(cap)
      cross join lateral unnest(public.signature_default_roles(cap)) as r
    on conflict (capability, role) do nothing;
  end if;
end;
$$;

-- O padrão fixado (0292) nasce igual ao de fábrica, para o selo "fora do
-- padrão" ter referência desde o primeiro dia.
insert into public.permission_defaults (capability, roles)
select cap, public.signature_default_roles(cap)
  from (values
    ('modulo.assinaturas'), ('acao.assinaturas.enviar'), ('acao.assinaturas.cancelar'),
    ('acao.assinaturas.visualizar'), ('acao.assinaturas.baixar'),
    ('acao.assinaturas.painel_unidade'), ('acao.assinaturas.painel_rede'),
    ('acao.assinaturas.configurar')
  ) as caps(cap)
on conflict (capability) do nothing;

-- -----------------------------------------------------------------------------
-- 11) AUDITORIA (0288): cadastros entram; registros técnicos ficam fora
-- -----------------------------------------------------------------------------
insert into public.audit_excluded_tables (schema_name, table_name, motivo) values
  ('public', 'signature_events', 'Já é a trilha imutável do módulo de assinaturas (webhook e ações).'),
  ('public', 'signature_reminders', 'Dedupe de lembretes (registro técnico da rotina).'),
  ('public', 'signature_plan_alerts', 'Dedupe de alertas de consumo do plano (registro técnico da rotina).'),
  ('public', 'signature_outbox', 'Fila de e-mail do módulo (registro técnico; só o servidor grava).')
on conflict (schema_name, table_name) do nothing;

select public.audit_attach_all();

-- -----------------------------------------------------------------------------
-- Conferência (só contagens — nenhum dado pessoal)
-- -----------------------------------------------------------------------------
select
  (select count(*) from pg_tables where schemaname = 'public' and tablename like 'signature\_%') as tabelas,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('signature_can', 'signature_can_view_package',
      'signature_consultant_scope_ok', 'signature_save_settings', 'signature_default_roles')) as funcoes,
  (select count(*) from pg_trigger where tgname in
    ('signature_packages_no_delete', 'signature_packages_guard_signed', 'signature_events_immutable')) as gatilhos,
  (select count(*) from pg_policies where schemaname = 'public' and tablename like 'signature\_%' and cmd = 'DELETE') as policies_de_delete,
  (select count(*) from storage.buckets where id = 'signature-documents') as bucket,
  (select count(*) from public.permission_matrix where capability like '%assinaturas%') as permissoes_semeadas,
  (select count(*) from public.signature_settings) as configuracao;

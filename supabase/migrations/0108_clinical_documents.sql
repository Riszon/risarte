-- =============================================================================
-- 0108 — Documentos clínicos (H4.6 C — Módulo do Dentista)
-- -----------------------------------------------------------------------------
-- O Dentista emite documentos do atendimento: prescrição de medicação, atestado,
-- declaração e orientações/cuidados. Começamos SIMPLES: texto (a partir de um
-- modelo, opcional) + geração de PDF pela impressão do navegador; sem assinatura
-- digital / envio externo (adiado). Os modelos seguem a cascata: rede
-- (clinic_id null, criados pela franqueadora/Admin) + acréscimos por unidade.
-- Idempotente.
-- =============================================================================

-- Modelos reutilizáveis por tipo (rede + unidade).
create table if not exists public.document_templates (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid references public.clinics (id),   -- null = rede (franqueadora)
  kind text not null
    check (kind in ('prescription', 'certificate', 'declaration', 'guidance')),
  title text not null,
  body text not null default '',
  is_active boolean not null default true,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists document_templates_kind_idx
  on public.document_templates (kind, is_active);
alter table public.document_templates enable row level security;

-- Leitura: Admin tudo; gestão da unidade (escopo) tudo da unidade; demais leem os
-- modelos ATIVOS da rede + das suas unidades (modelos não têm dado de paciente).
drop policy if exists "document_templates_select" on public.document_templates;
create policy "document_templates_select" on public.document_templates
  for select to authenticated
  using (
    public.is_admin_master()
    or clinic_id in (select public.user_full_access_clinic_ids())
    or (
      is_active
      and (clinic_id is null or clinic_id in (select public.user_clinic_ids()))
    )
  );

-- Escrita: Admin (modelos da rede — "a franqueadora cria") + Gerente da unidade
-- (modelos da própria unidade).
drop policy if exists "document_templates_write" on public.document_templates;
create policy "document_templates_write" on public.document_templates
  for all to authenticated
  using (
    public.is_admin_master()
    or (
      clinic_id is not null
      and public.has_role_in_clinic(clinic_id, array['unit_manager']::public.user_role[])
    )
  )
  with check (
    public.is_admin_master()
    or (
      clinic_id is not null
      and public.has_role_in_clinic(clinic_id, array['unit_manager']::public.user_role[])
    )
  );

-- Documentos emitidos (por cliente).
create table if not exists public.clinical_documents (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  clinic_id uuid not null references public.clinics (id),
  author_id uuid not null references public.profiles (id),
  kind text not null
    check (kind in ('prescription', 'certificate', 'declaration', 'guidance')),
  title text not null,
  body text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists clinical_documents_client_idx
  on public.clinical_documents (client_id, created_at desc);
alter table public.clinical_documents enable row level security;

-- Leitura: espelha os demais registros clínicos (dentista/coordenador da unidade
-- + Planner + Admin/escopo + acesso pelo histórico do cliente).
drop policy if exists "clinical_documents_select" on public.clinical_documents;
create policy "clinical_documents_select" on public.clinical_documents
  for select to authenticated
  using (
    public.is_admin_master()
    or clinic_id in (select public.user_full_access_clinic_ids())
    or public.is_planner()
    or public.has_role_in_clinic(clinic_id, array['dentist','clinical_coordinator']::public.user_role[])
    or public.user_has_client_history_access(client_id)
  );

-- Emissão: o próprio Dentista ou Coordenador (autor = auth.uid()); ou Admin.
drop policy if exists "clinical_documents_insert" on public.clinical_documents;
create policy "clinical_documents_insert" on public.clinical_documents
  for insert to authenticated
  with check (
    public.is_admin_master()
    or (
      author_id = (select auth.uid())
      and public.has_role_in_clinic(clinic_id, array['dentist','clinical_coordinator']::public.user_role[])
    )
  );

-- Edição: só o autor corrige o próprio documento (ou Admin). Sem DELETE.
drop policy if exists "clinical_documents_update" on public.clinical_documents;
create policy "clinical_documents_update" on public.clinical_documents
  for update to authenticated
  using (public.is_admin_master() or author_id = (select auth.uid()))
  with check (public.is_admin_master() or author_id = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- Seeds de modelos da REDE (orientações e um par de modelos), idempotentes.
-- -----------------------------------------------------------------------------
insert into public.document_templates (clinic_id, kind, title, body)
select v.clinic_id, v.kind, v.title, v.body
from (values
  (null::uuid, 'guidance', 'Pós-operatório de extração',
   E'- Morda a gaze por 30 a 40 minutos.\n- Não bocheche nem cuspa com força nas primeiras 24h.\n- Evite esforço físico e alimentos quentes hoje.\n- Alimente-se de líquidos e pastosos frios/gelados.\n- Higienize os demais dentes normalmente, com cuidado na região.\n- Em caso de sangramento persistente ou dor intensa, entre em contato.'),
  (null::uuid, 'guidance', 'Cuidados com prótese',
   E'- Higienize a prótese após as refeições com escova e sabão neutro.\n- Retire a prótese para dormir (quando removível) e guarde em água.\n- Evite alimentos muito duros/pegajosos no período de adaptação.\n- Retorne para ajustes se houver dor ou feridas.'),
  (null::uuid, 'guidance', 'Cuidados com aparelho ortodôntico',
   E'- Escove após todas as refeições, incluindo entre os braquetes.\n- Use fio dental com passa-fio e escova interdental.\n- Evite alimentos duros e pegajosos (que soltam o aparelho).\n- Compareça às manutenções na data marcada.\n- Se soltar um braquete ou machucar, entre em contato.'),
  (null::uuid, 'guidance', 'Pós-clareamento dental',
   E'- Nas primeiras 48h evite alimentos e bebidas com corante (café, chá, vinho, refrigerante escuro, molhos).\n- Evite cigarro.\n- Sensibilidade leve é normal e passageira.\n- Mantenha a higiene habitual.'),
  (null::uuid, 'guidance', 'Pós-operatório de implante',
   E'- Não faça esforço físico nas primeiras 72h.\n- Aplique gelo na face na região nas primeiras 24h (15 min sim, 15 não).\n- Alimentação fria/gelada e pastosa nos primeiros dias.\n- Não fume.\n- Tome a medicação conforme prescrito e retorne na data marcada.'),
  (null::uuid, 'certificate', 'Atestado odontológico',
   E'Atesto para os devidos fins que o(a) paciente compareceu a atendimento odontológico nesta data, necessitando de afastamento de suas atividades por ___ dia(s), a partir de ___/___/______.\n\nCID (opcional): ______'),
  (null::uuid, 'declaration', 'Declaração de comparecimento',
   E'Declaro para os devidos fins que o(a) paciente compareceu a atendimento odontológico nesta clínica na data de hoje, no período das ____h às ____h.')
) as v(clinic_id, kind, title, body)
where not exists (
  select 1 from public.document_templates t
  where t.clinic_id is null and t.kind = v.kind and t.title = v.title
);

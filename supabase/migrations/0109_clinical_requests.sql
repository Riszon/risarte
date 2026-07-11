-- =============================================================================
-- 0109 — Falar com quem planeja (H4.6 D — Módulo do Dentista)
-- -----------------------------------------------------------------------------
-- O Dentista pode: (1) SUGERIR reavaliação ao Coordenador (só sugere + avisa; não
-- move de fase) e (2) PEDIR revisão do planejamento — com alerta INSISTENTE
-- (re-aviso diário) ao Coordenador até ser resolvido. Ambos aceitam ANEXOS
-- (foto/vídeo/áudio/radiografia) no bucket clinical-media. Escrita via RPCs
-- SECURITY DEFINER (para notificar entre usuários). Idempotente.
-- =============================================================================

create table if not exists public.clinical_requests (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  clinic_id uuid not null references public.clinics (id),
  kind text not null check (kind in ('reevaluation', 'plan_revision')),
  body text not null default '',
  status text not null default 'open' check (status in ('open', 'resolved')),
  requested_by uuid not null references public.profiles (id),
  resolved_by uuid references public.profiles (id),
  resolved_at timestamptz,
  resolution_note text,
  created_at timestamptz not null default now()
);
create index if not exists clinical_requests_client_idx
  on public.clinical_requests (client_id, created_at desc);
create index if not exists clinical_requests_open_idx
  on public.clinical_requests (clinic_id, status, kind);
alter table public.clinical_requests enable row level security;

-- Leitura: dentista/coordenador da unidade + Planner + Admin/escopo + histórico.
-- (Escrita é só via RPC SECURITY DEFINER — sem policy de insert/update.)
drop policy if exists "clinical_requests_select" on public.clinical_requests;
create policy "clinical_requests_select" on public.clinical_requests
  for select to authenticated
  using (
    public.is_admin_master()
    or clinic_id in (select public.user_full_access_clinic_ids())
    or public.is_planner()
    or public.has_role_in_clinic(clinic_id, array['dentist','clinical_coordinator']::public.user_role[])
    or public.user_has_client_history_access(client_id)
  );

-- Anexos dos pedidos (metadados; o arquivo vai para o bucket clinical-media).
create table if not exists public.clinical_request_media (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.clinical_requests (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  clinic_id uuid not null references public.clinics (id),
  kind text not null,
  storage_path text not null,
  original_name text,
  content_type text,
  size_bytes int,
  uploaded_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);
create index if not exists clinical_request_media_req_idx
  on public.clinical_request_media (request_id);
alter table public.clinical_request_media enable row level security;

drop policy if exists "clinical_request_media_select" on public.clinical_request_media;
create policy "clinical_request_media_select" on public.clinical_request_media
  for select to authenticated
  using (
    public.is_admin_master()
    or clinic_id in (select public.user_full_access_clinic_ids())
    or public.is_planner()
    or public.has_role_in_clinic(clinic_id, array['dentist','clinical_coordinator']::public.user_role[])
    or public.user_has_client_history_access(client_id)
  );

-- Inserção do anexo: o próprio dentista/coordenador (uploaded_by = auth.uid()).
drop policy if exists "clinical_request_media_insert" on public.clinical_request_media;
create policy "clinical_request_media_insert" on public.clinical_request_media
  for insert to authenticated
  with check (
    public.is_admin_master()
    or (
      uploaded_by = (select auth.uid())
      and public.has_role_in_clinic(clinic_id, array['dentist','clinical_coordinator']::public.user_role[])
    )
  );

-- -----------------------------------------------------------------------------
-- Storage: o Dentista também pode ENVIAR e LER arquivos da pasta da sua unidade
-- no bucket clinical-media (antes era só o Coordenador). Caminho: <clinic>/<client>/…
-- -----------------------------------------------------------------------------
drop policy if exists "risarte_clinical_media_insert" on storage.objects;
create policy "risarte_clinical_media_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'clinical-media'
    and (
      public.is_admin_master()
      or public.has_role_in_clinic(
        (storage.foldername(name))[1]::uuid,
        array['clinical_coordinator','dentist']::public.user_role[]
      )
    )
  );

drop policy if exists "risarte_clinical_media_select" on storage.objects;
create policy "risarte_clinical_media_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'clinical-media'
    and (
      public.is_admin_master()
      or public.is_planner()
      or (storage.foldername(name))[1]::uuid in (select public.user_full_access_clinic_ids())
      or public.has_role_in_clinic(
        (storage.foldername(name))[1]::uuid,
        array['clinical_coordinator','dentist']::public.user_role[]
      )
      or public.user_has_client_history_access((storage.foldername(name))[2]::uuid)
    )
  );

-- -----------------------------------------------------------------------------
-- create_clinical_request: cria o pedido e avisa o Coordenador da unidade.
-- -----------------------------------------------------------------------------
create or replace function public.create_clinical_request(
  p_client_id uuid,
  p_kind text,
  p_body text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic uuid;
  v_name text;
  v_requester text;
  v_id uuid;
  v_title text;
begin
  if p_kind not in ('reevaluation', 'plan_revision') then
    raise exception 'INVALID_KIND';
  end if;
  select clinic_id, full_name into v_clinic, v_name
  from public.clients where id = p_client_id;
  if v_clinic is null then raise exception 'CLIENT_NOT_FOUND'; end if;

  if not (
    public.is_admin_master()
    or public.has_role_in_clinic(v_clinic, array['dentist']::public.user_role[])
  ) then
    raise exception 'NOT_ALLOWED';
  end if;

  insert into public.clinical_requests (client_id, clinic_id, kind, body, requested_by)
  values (p_client_id, v_clinic, p_kind, coalesce(p_body, ''), (select auth.uid()))
  returning id into v_id;

  select full_name into v_requester
  from public.profiles where id = (select auth.uid());

  v_title := case p_kind
    when 'reevaluation' then 'Sugestão de reavaliação: ' || v_name
    else 'Revisão do plano solicitada: ' || v_name
  end;

  insert into public.notifications (user_id, clinic_id, title, body, link)
  select ucr.user_id, v_clinic, v_title,
         coalesce(v_requester, 'O dentista') || ' registrou um pedido para o '
           || 'coordenador clínico.',
         '/clientes/' || p_client_id
  from public.user_clinic_roles ucr
  where ucr.clinic_id = v_clinic and ucr.role = 'clinical_coordinator';

  return v_id;
end;
$$;

grant execute on function public.create_clinical_request(uuid, text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- resolve_clinical_request: o Coordenador resolve e avisa quem pediu.
-- -----------------------------------------------------------------------------
create or replace function public.resolve_clinical_request(
  p_request_id uuid,
  p_note text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic uuid;
  v_client uuid;
  v_requester uuid;
  v_status text;
  v_name text;
  v_resolver text;
begin
  select clinic_id, client_id, requested_by, status
    into v_clinic, v_client, v_requester, v_status
  from public.clinical_requests where id = p_request_id;
  if v_clinic is null then raise exception 'REQUEST_NOT_FOUND'; end if;

  if not (
    public.is_admin_master()
    or public.has_role_in_clinic(v_clinic, array['clinical_coordinator']::public.user_role[])
  ) then
    raise exception 'NOT_ALLOWED';
  end if;
  if v_status = 'resolved' then return; end if;

  update public.clinical_requests
  set status = 'resolved',
      resolved_by = (select auth.uid()),
      resolved_at = now(),
      resolution_note = nullif(btrim(p_note), '')
  where id = p_request_id;

  select full_name into v_name from public.clients where id = v_client;
  select full_name into v_resolver from public.profiles where id = (select auth.uid());

  insert into public.notifications (user_id, clinic_id, title, body, link)
  values (
    v_requester, v_clinic,
    'Pedido respondido: ' || v_name,
    coalesce(v_resolver, 'O coordenador') || ' respondeu ao seu pedido.',
    '/clientes/' || v_client
  );
end;
$$;

grant execute on function public.resolve_clinical_request(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- notify_insistent_requests: re-avisa (1x/dia) o Coordenador sobre PEDIDOS DE
-- REVISÃO DO PLANO ainda em aberto — o "alerta insistente até resolver".
-- -----------------------------------------------------------------------------
create or replace function public.notify_insistent_requests(p_clinic_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (
    public.is_admin_master()
    or public.has_role_in_clinic(p_clinic_id, array['clinical_coordinator']::public.user_role[])
  ) then
    return;
  end if;

  insert into public.notifications (user_id, clinic_id, title, body, link)
  select ucr.user_id, p_clinic_id,
         'Revisão do plano pendente: ' || c.full_name,
         'Há um pedido de revisão do planejamento em aberto aguardando sua resposta.',
         '/clientes/' || c.id
  from public.clinical_requests r
  join public.clients c on c.id = r.client_id
  join public.user_clinic_roles ucr
    on ucr.clinic_id = p_clinic_id and ucr.role = 'clinical_coordinator'
  where r.clinic_id = p_clinic_id
    and r.kind = 'plan_revision'
    and r.status = 'open'
    and not exists (
      select 1 from public.notifications n
      where n.user_id = ucr.user_id
        and n.title = 'Revisão do plano pendente: ' || c.full_name
        and n.created_at >= current_date
    );
end;
$$;

grant execute on function public.notify_insistent_requests(uuid) to authenticated;

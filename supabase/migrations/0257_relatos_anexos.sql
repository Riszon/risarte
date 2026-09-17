-- =============================================================================
-- 0257 — PROBLEMAS 2.0, PARTE B: anexos e captura de tela
-- -----------------------------------------------------------------------------
-- Pedido do dono (16/09/2026): "deve ter uma possibilidade de anexar arquivo
-- para demonstrar algum problema. Deve ter como printar a própria tela do
-- sistema para mostrar o erro ou o problema."
--
-- ⚠️ O PRINT É O ANEXO MAIS PERIGOSO DO SISTEMA. Ele mostra o que estava na
-- tela — e na tela de uma clínica quase sempre há nome de paciente. Por isso:
--   * pasta PRIVADA, acesso só por link temporário (mesma regra das fotos
--     clínicas, 0025);
--   * quem vê o anexo é exatamente quem vê o relato — a régua é a RLS da 0247,
--     não uma segunda;
--   * o caminho do arquivo NÃO leva o nome original (que pode ser "print ficha
--     Maria Souza.png"): é `<relato>/<uuid>.<ext>`;
--   * existe REMOÇÃO — por quem enviou ou pelo Admin Master. A conversa não se
--     apaga (0256), mas um print com dado de paciente enviado por engano tem de
--     poder sair. Fica a lápide: "anexo removido", com quem e quando.
--
-- A 0256 fez `add_system_report_comment` e `answer_system_report` devolverem
-- nada; aqui elas passam a devolver o id da mensagem criada, para o anexo
-- enviado junto ficar PRESO àquela mensagem na conversa. Mudar o tipo de
-- retorno exige `drop function` antes (a lição da 0232).
--
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) A pasta
-- -----------------------------------------------------------------------------
-- 10 MB por arquivo e só os tipos que fazem sentido para mostrar um problema.
-- O limite mora no BUCKET, não só na tela: a tela pode ser contornada, o
-- Storage não.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'system-reports', 'system-reports', false, 10485760,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif',
        'application/pdf', 'video/mp4', 'video/webm']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- -----------------------------------------------------------------------------
-- 2) O registro de cada anexo
-- -----------------------------------------------------------------------------
create table if not exists public.system_report_attachments (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.system_reports (id) on delete cascade,
  -- Nulo = anexo do relato em si (enviado junto com o registro).
  message_id uuid references public.system_report_messages (id) on delete cascade,
  uploaded_by uuid references public.profiles (id),
  storage_path text not null unique,
  file_name text not null check (btrim(file_name) <> ''),
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  -- 'captura' = tirada pelo botão do sistema; 'arquivo' = escolhido/colado.
  -- A diferença importa para quem corrige: a captura é a tela como estava.
  kind text not null default 'arquivo' check (kind in ('captura', 'arquivo')),
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  removed_by uuid references public.profiles (id)
);

comment on table public.system_report_attachments is
  'Anexos dos relatos (prints e arquivos). O arquivo mora no bucket privado system-reports; removido = lápide com quem e quando, arquivo apagado.';

create index if not exists system_report_attachments_report_idx
  on public.system_report_attachments (report_id, created_at);

alter table public.system_report_attachments enable row level security;

-- Quem vê o relato vê os anexos. Mesma subconsulta da conversa (0256).
drop policy if exists "system_report_attachments_select" on public.system_report_attachments;
create policy "system_report_attachments_select" on public.system_report_attachments
  for select to authenticated
  using (
    exists (select 1 from public.system_reports r where r.id = report_id)
  );

-- Sem política de escrita: só pelas funções abaixo.

-- -----------------------------------------------------------------------------
-- 3) Quem pode anexar — UMA régua, usada pelo Storage e pela função
-- -----------------------------------------------------------------------------
-- Quem relatou (enquanto está aberto — encerrado se reabre primeiro) e o Admin
-- Master (sempre). Quem só enxerga o relato por ser da mesma unidade NÃO anexa:
-- a conversa é entre quem relatou e o suporte.
create or replace function public.can_attach_to_system_report(p_report_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin_master()
      or exists (
        select 1
          from public.system_reports r
         where r.id = p_report_id
           and r.reporter_id = (select auth.uid())
           and r.status in ('aberto', 'em_analise')
      );
$$;

revoke all on function public.can_attach_to_system_report(uuid) from public;
grant execute on function public.can_attach_to_system_report(uuid) to authenticated;

-- O primeiro pedaço do caminho é o id do relato. Comparado como TEXTO: um
-- caminho malformado com `::uuid` levantaria erro dentro da política, e o
-- envio falharia com uma mensagem que ninguém entende.
create or replace function public.system_report_of_path(p_name text)
returns uuid
language sql
stable
set search_path = ''
as $$
  select case
    when (storage.foldername(p_name))[1] ~
         '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then ((storage.foldername(p_name))[1])::uuid
    else null
  end;
$$;

drop policy if exists "system_reports_files_select" on storage.objects;
create policy "system_reports_files_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'system-reports'
    and exists (
      select 1 from public.system_reports r
       where r.id = public.system_report_of_path(name)
    )
  );

drop policy if exists "system_reports_files_insert" on storage.objects;
create policy "system_reports_files_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'system-reports'
    and public.system_report_of_path(name) is not null
    and public.can_attach_to_system_report(public.system_report_of_path(name))
  );

-- Apagar o arquivo: quem enviou ou o Admin Master. A lápide na tabela é
-- escrita pela função de remoção.
drop policy if exists "system_reports_files_delete" on storage.objects;
create policy "system_reports_files_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'system-reports'
    and (
      public.is_admin_master()
      or owner_id = (select auth.uid())::text
    )
  );

-- -----------------------------------------------------------------------------
-- 4) Registrar o anexo
-- -----------------------------------------------------------------------------
create or replace function public.add_system_report_attachment(
  p_report_id uuid,
  p_message_id uuid,
  p_path text,
  p_file_name text,
  p_mime_type text,
  p_size_bytes bigint,
  p_kind text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_id uuid;
  v_total integer;
begin
  if not public.can_attach_to_system_report(p_report_id) then
    raise exception 'NOT_ALLOWED';
  end if;

  -- O caminho tem de ser DESTE relato: sem isto, alguém registraria no seu
  -- relato um arquivo que subiu para o relato de outra pessoa.
  if public.system_report_of_path(p_path) is distinct from p_report_id then
    raise exception 'PATH_MISMATCH';
  end if;

  -- E o arquivo tem de EXISTIR. Registro sem arquivo vira um anexo quebrado
  -- na conversa, e ninguém saberia se falhou o envio ou o link.
  if not exists (
    select 1 from storage.objects o
     where o.bucket_id = 'system-reports' and o.name = p_path
  ) then
    raise exception 'FILE_NOT_FOUND';
  end if;

  if p_message_id is not null and not exists (
    select 1 from public.system_report_messages m
     where m.id = p_message_id
       and m.report_id = p_report_id
       and m.author_id = v_user
  ) then
    raise exception 'MESSAGE_MISMATCH';
  end if;

  -- 10 por relato, contando só os que não foram removidos. Sem teto, um
  -- relato viraria depósito de arquivos.
  select count(*) into v_total
    from public.system_report_attachments
   where report_id = p_report_id and removed_at is null;
  if v_total >= 10 then
    raise exception 'TOO_MANY_ATTACHMENTS';
  end if;

  insert into public.system_report_attachments
    (report_id, message_id, uploaded_by, storage_path, file_name, mime_type,
     size_bytes, kind)
  values
    (p_report_id, p_message_id, v_user, p_path,
     left(btrim(p_file_name), 160), p_mime_type, p_size_bytes,
     case when p_kind = 'captura' then 'captura' else 'arquivo' end)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.add_system_report_attachment(uuid, uuid, text, text, text, bigint, text) from public;
grant execute on function public.add_system_report_attachment(uuid, uuid, text, text, text, bigint, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 5) Remover — a lápide
-- -----------------------------------------------------------------------------
-- Devolve o caminho para a tela apagar o arquivo pela API do Storage (o
-- Supabase não deixa apagar arquivo por SQL). A ordem é: lápide aqui, arquivo
-- lá. Se o segundo passo falhar, o link já não é mais oferecido a ninguém.
create or replace function public.remove_system_report_attachment(p_attachment_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_path text;
  v_dono uuid;
begin
  select storage_path, uploaded_by into v_path, v_dono
    from public.system_report_attachments
   where id = p_attachment_id and removed_at is null
   for update;

  if not found then
    raise exception 'ATTACHMENT_NOT_FOUND';
  end if;

  if not (public.is_admin_master() or v_dono = v_user) then
    raise exception 'NOT_ALLOWED';
  end if;

  update public.system_report_attachments
     set removed_at = now(), removed_by = v_user
   where id = p_attachment_id;

  return v_path;
end;
$$;

revoke all on function public.remove_system_report_attachment(uuid) from public;
grant execute on function public.remove_system_report_attachment(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 6) As duas portas da conversa passam a devolver o id da mensagem
-- -----------------------------------------------------------------------------
drop function if exists public.add_system_report_comment(uuid, text);
create function public.add_system_report_comment(
  p_report_id uuid,
  p_body text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_texto text := nullif(btrim(coalesce(p_body, '')), '');
  v_dono uuid;
  v_status public.system_report_status;
  v_id uuid;
begin
  if v_texto is null then
    raise exception 'BODY_REQUIRED';
  end if;

  select reporter_id, status into v_dono, v_status
    from public.system_reports
   where id = p_report_id;

  if not found then
    raise exception 'REPORT_NOT_FOUND';
  end if;

  if v_dono is distinct from v_user then
    raise exception 'NOT_ALLOWED';
  end if;

  if v_status in ('resolvido', 'nao_e_defeito') then
    raise exception 'REPORT_CLOSED';
  end if;

  insert into public.system_report_messages (report_id, author_id, kind, body)
  values (p_report_id, v_user, 'complemento', v_texto)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.add_system_report_comment(uuid, text) from public;
grant execute on function public.add_system_report_comment(uuid, text) to authenticated;

drop function if exists public.answer_system_report(
  uuid, public.system_report_status, text, text
);
create function public.answer_system_report(
  p_report_id uuid,
  p_status public.system_report_status,
  p_answer text,
  p_resolved_version text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_texto text := nullif(btrim(coalesce(p_answer, '')), '');
  v_versao text := nullif(btrim(coalesce(p_resolved_version, '')), '');
  v_atual public.system_report_status;
  v_id uuid;
begin
  if not public.is_admin_master() then
    raise exception 'NOT_ALLOWED';
  end if;

  select status into v_atual
    from public.system_reports
   where id = p_report_id
   for update;

  if not found then
    raise exception 'REPORT_NOT_FOUND';
  end if;

  if p_status in ('resolvido', 'nao_e_defeito')
     and v_atual is distinct from p_status
     and v_texto is null then
    raise exception 'ANSWER_REQUIRED';
  end if;

  if v_texto is null and v_atual = p_status then
    raise exception 'NOTHING_TO_SAVE';
  end if;

  update public.system_reports
     set status = p_status,
         resolved_version = coalesce(v_versao, resolved_version)
   where id = p_report_id;

  if v_texto is not null then
    insert into public.system_report_messages
      (report_id, author_id, kind, body)
    values
      (p_report_id, v_user, 'resposta', v_texto)
    returning id into v_id;

    update public.system_reports
       set answer = v_texto,
           answered_by = v_user,
           answered_at = now(),
           first_response_at = coalesce(first_response_at, now()),
           reporter_seen_answer_at = null
     where id = p_report_id;
  end if;

  -- Nulo quando só a situação mudou: não há mensagem para prender anexo.
  return v_id;
end;
$$;

revoke all on function public.answer_system_report(
  uuid, public.system_report_status, text, text
) from public;
grant execute on function public.answer_system_report(
  uuid, public.system_report_status, text, text
) to authenticated;

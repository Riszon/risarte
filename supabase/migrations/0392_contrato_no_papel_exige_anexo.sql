-- =============================================================================
-- 0392 — CONTRATO "ASSINADO NO PAPEL" SÓ COM O PAPEL ANEXADO (OC-00171)
--
-- Relato (09/11/2026, treino): "Comercial fechou o tratamento sem enviar a
-- assinatura. Até sem CPF válido no sistema ele está." Lido no banco: o
-- consultor marcou "Contrato assinado" À MÃO (origem `manual`, sem pacote) e
-- confirmou o pagamento — o caminho permitido para o contrato assinado no
-- papel, mas sem nenhuma prova de que o papel existia.
--
-- Decisão do dono (10/11/2026): marcar o contrato à mão EXIGE anexar a foto
-- ou o PDF do contrato assinado. A assinatura digital (ZapSign) continua
-- marcando sozinha; vendas já fechadas ficam como estão; desmarcar continua
-- livre; o CPF inválido continua só avisando (AP90).
--
-- O que muda:
--   1) a pasta privada `contratos-papel` (10 MB; imagem ou PDF), caminho
--      `<negociação>/<uuid>.<ext>` — sem o nome do paciente no caminho;
--   2) quatro colunas em `commercial_sales` com o papel e quem anexou;
--   3) `commercial_mark_paper_contract`: grava o papel E marca o contrato,
--      numa transação, pela mesma conta do fechamento (`_commercial_close_step_raw`);
--   4) a TRAVA, em gatilho: virar "assinado" com origem `manual` sem papel é
--      recusado (PAPER_REQUIRED) — por qualquer caminho, não só pela tela.
--
-- Idempotente. Não mexe em dado existente.
-- =============================================================================

-- 1) A pasta ------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'contratos-papel', 'contratos-papel', false, 10485760,
  array['image/png', 'image/jpeg', 'image/webp', 'application/pdf']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 2) As colunas ---------------------------------------------------------------
alter table public.commercial_sales
  add column if not exists contract_paper_path text,
  add column if not exists contract_paper_name text,
  add column if not exists contract_paper_by uuid references public.profiles (id),
  add column if not exists contract_paper_at timestamptz;

comment on column public.commercial_sales.contract_paper_path is
  'OC-00171 (0392): o contrato assinado no papel (pasta privada contratos-papel). Obrigatório para marcar o contrato à mão.';

-- 3) De que negociação é um arquivo da pasta ------------------------------------
create or replace function public.negotiation_of_paper_path(p_name text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  return split_part(p_name, '/', 1)::uuid;
exception when others then
  return null;
end;
$$;
revoke execute on function public.negotiation_of_paper_path(text) from public, anon, authenticated;
grant execute on function public.negotiation_of_paper_path(text) to authenticated;

-- Quem pode ANEXAR: quem fecha a venda daquela unidade, com a negociação aceita.
create or replace function public.can_attach_contract_paper(p_negotiation uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
     and exists (
       select 1 from public.plan_negotiations n
        where n.id = p_negotiation
          and n.status = 'aceita'
          and public.commercial_can_close(n.clinic_id)
     );
$$;
revoke execute on function public.can_attach_contract_paper(uuid) from public, anon, authenticated;
grant execute on function public.can_attach_contract_paper(uuid) to authenticated;

-- Regras da pasta: VER = quem vê a negociação (a regra da tabela decide);
-- ENVIAR = quem fecha; APAGAR = só o Admin Master (o papel é a prova da venda).
drop policy if exists "contratos_papel_select" on storage.objects;
create policy "contratos_papel_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'contratos-papel'
    and exists (
      select 1 from public.plan_negotiations n
       where n.id = public.negotiation_of_paper_path(name)
    )
  );

drop policy if exists "contratos_papel_insert" on storage.objects;
create policy "contratos_papel_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'contratos-papel'
    and public.negotiation_of_paper_path(name) is not null
    and public.can_attach_contract_paper(public.negotiation_of_paper_path(name))
  );

drop policy if exists "contratos_papel_delete" on storage.objects;
create policy "contratos_papel_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'contratos-papel' and public.is_admin_master());

-- 4) A TRAVA ------------------------------------------------------------------
create or replace function public.commercial_sales_paper_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.contract_signed
     and coalesce(new.contract_signed_source, '') = 'manual'
     and (tg_op = 'INSERT' or not coalesce(old.contract_signed, false))
     and coalesce(btrim(new.contract_paper_path), '') = '' then
    raise exception 'PAPER_REQUIRED';
  end if;
  return new;
end;
$$;
revoke execute on function public.commercial_sales_paper_guard() from public, anon, authenticated;

drop trigger if exists commercial_sales_paper_guard on public.commercial_sales;
create trigger commercial_sales_paper_guard
  before insert or update of contract_signed, contract_signed_source, contract_paper_path
  on public.commercial_sales
  for each row execute function public.commercial_sales_paper_guard();

-- 5) Anexar o papel e marcar o contrato, juntos ---------------------------------
create or replace function public.commercial_mark_paper_contract(
  p_negotiation_id uuid,
  p_path text,
  p_name text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_neg record;
begin
  if v_user is null then raise exception 'NOT_ALLOWED'; end if;
  select * into v_neg from public.plan_negotiations where id = p_negotiation_id;
  if v_neg.id is null then raise exception 'NOT_FOUND'; end if;
  if not public.commercial_can_close(v_neg.clinic_id) then raise exception 'NOT_ALLOWED'; end if;
  if v_neg.status <> 'aceita' then raise exception 'NOT_ACCEPTED'; end if;

  -- O arquivo tem de estar na pasta, na pasta DESTA negociação.
  if public.negotiation_of_paper_path(p_path) is distinct from p_negotiation_id
     or not exists (
       select 1 from storage.objects o
        where o.bucket_id = 'contratos-papel' and o.name = p_path
     ) then
    raise exception 'FILE_NOT_FOUND';
  end if;

  -- A venda nasce aqui se ainda não existe (como no fechamento).
  insert into public.commercial_sales (negotiation_id, client_id, clinic_id, plan_id, final_cents)
  select v_neg.id, v_neg.client_id, v_neg.clinic_id, v_neg.plan_id, v_neg.final_cents
   where not exists (select 1 from public.commercial_sales s where s.negotiation_id = v_neg.id);

  if exists (select 1 from public.commercial_sales s
              where s.negotiation_id = v_neg.id and s.closed_at is not null) then
    raise exception 'ALREADY_CLOSED';
  end if;

  update public.commercial_sales set
    contract_paper_path = p_path,
    contract_paper_name = nullif(btrim(coalesce(p_name, '')), ''),
    contract_paper_by = v_user,
    contract_paper_at = now(),
    updated_at = now()
  where negotiation_id = v_neg.id;

  -- A marcação em si: a MESMA conta do fechamento (porta da 0343).
  return public._commercial_close_step_raw(p_negotiation_id, 'contract', true, v_user, 'manual', null);
end;
$$;
revoke execute on function public.commercial_mark_paper_contract(uuid, text, text) from public, anon, authenticated;
grant execute on function public.commercial_mark_paper_contract(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';

-- =============================================================================
-- 0281 — A LIBERAÇÃO: MISSÃO CUMPRIDA VIRA CERTIFICADO E ABRE O SISTEMA REAL
--        (portão de certificação, Etapa 3 — parte 2)
-- -----------------------------------------------------------------------------
-- A tranca por unidade e função (0276/0277) já sabe LER o certificado; faltava
-- quem o GRAVA. Esta migração é essa peça.
--
-- ⚠️ SÓ O SERVIDOR REGISTRA A CONCLUSÃO. A missão é medida no banco de TREINO,
-- que este banco não enxerga. Quem mede é o servidor do riSZon (com o código da
-- Etapa 2), e só DEPOIS de medir ele chama `record_training_completion` — que
-- aceita APENAS a chave de serviço. Se a função respondesse a um usuário
-- logado, qualquer um se daria o certificado pela API com um "cumpri" escrito
-- à mão. (Regra 7: revoke de public, anon E authenticated.)
--
-- O QUE ACONTECE AO CUMPRIR, pelos eixos que o Admin já configura (0271):
--   * gatilho AUTOMÁTICO, ou qualquer RECICLAGEM → certificado na hora;
--     (reciclagem: decisão do dono, 26/09/2026 — "volta sozinho": quem já foi
--      aprovado uma vez não fica parado esperando um clique)
--   * gatilho APROVAÇÃO → "cumpriu, aguardando aprovação" e aviso ao Admin;
--     o certificado só nasce no Aprovar (`approve_training_completion`).
--
-- O QUE O CERTIFICADO FAZ, sozinho, pela regra da 0276/0277:
--   * abre as unidades onde a pessoa tem AQUELA função (uma missão por função);
--   * na COLETIVA, a unidade espera o grupo inteiro cumprir;
--   * a RECICLAGEM devolve o acesso que o próprio portão suspendeu
--     (`restore_training_access` — só o que ELE tirou, trava da 0274).
--
-- A PORTA DA FICHA (0259): quem nunca teve a porta registrada (o novato) ganha
-- a porta aberta. Porta FECHADA À MÃO pelo Admin NÃO é reaberta — o
-- certificado é gravado e o Admin é avisado (decisão do dono, 26/09/2026: um
-- bloqueio manual tem um motivo que o portão não conhece).
--
-- Idempotente. Não apaga nada.
-- =============================================================================

-- 1) O que a matrícula guarda da conclusão -----------------------------------
alter table public.training_enrollments
  add column if not exists result_snapshot jsonb,
  add column if not exists approval_status text,
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by uuid references public.profiles (id);

alter table public.training_enrollments
  drop constraint if exists training_enrollments_approval_status_check;
alter table public.training_enrollments
  add constraint training_enrollments_approval_status_check
  check (approval_status is null or approval_status in ('pendente', 'aprovada'));

comment on column public.training_enrollments.result_snapshot is
  'Os números medidos no treino no momento da conclusão (0281). É o que o Admin vê para aprovar, e o que vai para o certificado.';
comment on column public.training_enrollments.approval_status is
  'Só no gatilho "aprovação": pendente até o Admin aprovar (0281). Nulo = não precisou.';

-- 2) A peça interna: grava o certificado e abre a porta ------------------------
-- Sem guarda própria: quem a chama (as duas funções abaixo) já decidiu.
drop function if exists public._certify_enrollment(uuid, uuid);
create or replace function public._certify_enrollment(p_enrollment_id uuid, p_approver uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  e record;
  v_porta boolean;
  v_resultado text;
begin
  select te.*, tc.kind
    into e
    from public.training_enrollments te
    join public.training_campaigns tc on tc.id = te.campaign_id
   where te.id = p_enrollment_id;
  if not found then
    raise exception 'ENROLLMENT_NOT_FOUND';
  end if;

  insert into public.training_certifications
    (user_id, role, clinic_id, campaign_id, approved_by, snapshot)
  values
    (e.user_id, e.role, e.clinic_id, e.campaign_id, p_approver,
     coalesce(e.result_snapshot, '{}'::jsonb));

  update public.training_enrollments
     set approval_status = case when p_approver is not null then 'aprovada' else approval_status end,
         approved_at = case when p_approver is not null then now() else approved_at end,
         approved_by = coalesce(p_approver, approved_by)
   where id = p_enrollment_id;

  -- Reciclagem com o acesso suspenso: devolve (só o que o portão tirou).
  if e.access_suspended_at is not null then
    perform public.restore_training_access(p_enrollment_id);
  end if;

  -- A porta da ficha.
  select ue.allowed into v_porta
    from public.user_environments ue
   where ue.user_id = e.user_id and ue.environment = 'sistema';

  if not found then
    insert into public.user_environments (user_id, environment, allowed, granted_by)
    values (e.user_id, 'sistema', true, p_approver);
    v_resultado := 'liberado';
  elsif v_porta then
    v_resultado := 'liberado';
  else
    v_resultado := 'porta_fechada';
    insert into public.notifications (user_id, title, body, link)
    select p.id,
           'Missão cumprida, mas o sistema real está fechado na ficha',
           'Uma pessoa cumpriu a missão de certificação, mas o acesso ao sistema real dela foi retirado à mão na ficha. O certificado foi gravado; libere na ficha se for o caso.',
           '/admin/certificacao'
      from public.profiles p
     where p.is_admin_master and p.is_active;
  end if;

  insert into public.notifications (user_id, title, body, link)
  values (
    e.user_id,
    'Missão de certificação cumprida',
    case v_resultado
      when 'liberado' then 'Parabéns! O sistema real está liberado nas unidades onde você tem esta função. Se a unidade estiver numa turma coletiva, ela abre quando o grupo todo cumprir — veja no Início.'
      else 'Parabéns! Sua certificação foi registrada. O acesso ao sistema real depende de uma liberação do Admin na sua ficha.'
    end,
    '/'
  );

  return v_resultado;
end;
$$;

revoke execute on function public._certify_enrollment(uuid, uuid) from public, anon, authenticated;

-- 3) Registrar a conclusão — SÓ o servidor, depois de medir -------------------
drop function if exists public.record_training_completion(uuid, jsonb);
create or replace function public.record_training_completion(p_enrollment_id uuid, p_snapshot jsonb)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  e record;
  v_gatilho text;
begin
  select te.*, tc.kind, tc.status as turma_status
    into e
    from public.training_enrollments te
    join public.training_campaigns tc on tc.id = te.campaign_id
   where te.id = p_enrollment_id
   for update of te;
  if not found then
    raise exception 'ENROLLMENT_NOT_FOUND';
  end if;

  -- Já registrada: devolve o estado, sem certificar duas vezes (o Início pode
  -- ser aberto dez vezes seguidas por quem acabou de cumprir).
  if e.status = 'concluido' then
    return case
      when e.approval_status = 'pendente' then 'aguardando_aprovacao'
      else 'ja_registrado'
    end;
  end if;

  if e.status <> 'em_andamento' or e.started_at is null then
    raise exception 'NOT_STARTED';
  end if;
  if e.turma_status <> 'aberta' then
    raise exception 'CAMPAIGN_CLOSED';
  end if;

  update public.training_enrollments
     set status = 'concluido',
         completed_at = now(),
         result_snapshot = coalesce(p_snapshot, '{}'::jsonb)
   where id = p_enrollment_id;

  select ts.release_trigger into v_gatilho from public.training_settings ts;

  if e.kind = 'reciclagem' or coalesce(v_gatilho, 'aprovacao') = 'automatica' then
    return public._certify_enrollment(p_enrollment_id, null);
  end if;

  update public.training_enrollments
     set approval_status = 'pendente'
   where id = p_enrollment_id;

  insert into public.notifications (user_id, title, body, link)
  select p.id,
         'Missão cumprida — aguardando a sua aprovação',
         'Uma pessoa cumpriu a missão de certificação. Confira os números e aprove em Administração → Certificação.',
         '/admin/certificacao'
    from public.profiles p
   where p.is_admin_master and p.is_active;

  insert into public.notifications (user_id, title, body, link)
  values (
    e.user_id,
    'Missão cumprida — aguardando aprovação',
    'Você cumpriu a missão de certificação. Agora o Admin confere e aprova; o sistema real abre em seguida.',
    '/'
  );

  return 'aguardando_aprovacao';
end;
$$;

-- ⚠️ SÓ A CHAVE DE SERVIÇO. Logado nenhum chama isto — nem o Admin.
revoke execute on function public.record_training_completion(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.record_training_completion(uuid, jsonb) to service_role;

-- 4) Aprovar — o Admin Master, na tela de Certificação -------------------------
drop function if exists public.approve_training_completion(uuid);
create or replace function public.approve_training_completion(p_enrollment_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  if not public.is_admin_master() then
    raise exception 'NOT_ALLOWED';
  end if;

  select te.approval_status into v_status
    from public.training_enrollments te
   where te.id = p_enrollment_id
   for update;
  if not found then
    raise exception 'ENROLLMENT_NOT_FOUND';
  end if;
  -- Dois cliques (ou dois Admins) não geram dois certificados.
  if v_status is distinct from 'pendente' then
    raise exception 'NOT_PENDING';
  end if;

  return public._certify_enrollment(p_enrollment_id, auth.uid());
end;
$$;

revoke execute on function public.approve_training_completion(uuid) from public, anon, authenticated;
grant execute on function public.approve_training_completion(uuid) to authenticated;

notify pgrst, 'reload schema';

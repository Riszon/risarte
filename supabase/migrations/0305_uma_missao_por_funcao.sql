-- =============================================================================
-- 0305 — UMA MISSÃO POR FUNÇÃO, MESMO EM DUAS UNIDADES (AP52)
--
-- Achado no OC-00111 (produção, 19/10/2026): uma dentista convocada como
-- DENTISTA em duas turmas abertas ao mesmo tempo (TR-00004 em Cambé,
-- TR-00005 em Londrina). A certificação é por FUNÇÃO (0273) e a contagem no
-- treino não separa unidade — as duas missões mediam o MESMO trabalho:
--   - o Início mostrava dois quadros de dentista;
--   - aceitando os dois, cumprir gerava DOIS certificados;
--   - com um certificado o acesso já abria nas duas, mas o outro quadro
--     continuava pedindo "Aceitar".
--
-- O QUE MUDA (decisão do dono, 19/10/2026: "uma missão vale para as duas"):
-- as matrículas IRMÃS — mesma pessoa, mesma função, mesmo tipo de turma, em
-- turmas abertas — andam juntas (`_sync_training_siblings`):
--   1. ACEITAR numa começa as irmãs, com o MESMO marco (`started_at`) — se uma
--      já tinha começado, vale o marco dela (o trabalho já feito não se perde);
--   2. CUMPRIR conclui as irmãs, com os mesmos números e a mesma situação de
--      aprovação — e o certificado sai UMA vez;
--   3. APROVAR uma aprova as irmãs.
-- A pessoa continua contando no grupo de CADA unidade (coletiva): cada unidade
-- espera por ela, e ela libera as duas de uma vez.
--
-- Os casos que já existem são acertados aqui (a irmã convocada de quem já
-- começou passa a "em andamento", com o marco da que começou).
-- Nada apaga dado. Idempotente.
-- =============================================================================

-- 1) A peça: alinha as irmãs com uma matrícula ----------------------------------
-- Sem guarda própria: só as funções abaixo chamam, depois de decidir.
create or replace function public._sync_training_siblings(p_enrollment_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  e record;
  v_n integer;
begin
  select te.*, tc.kind
    into e
    from public.training_enrollments te
    join public.training_campaigns tc on tc.id = te.campaign_id
   where te.id = p_enrollment_id;
  if not found or e.status not in ('em_andamento', 'concluido') then
    return 0;
  end if;

  update public.training_enrollments s
     set started_at = coalesce(s.started_at, e.started_at),
         status = case when e.status = 'concluido' then 'concluido' else 'em_andamento' end,
         completed_at = case when e.status = 'concluido' then coalesce(s.completed_at, e.completed_at) else s.completed_at end,
         result_snapshot = case when e.status = 'concluido' then e.result_snapshot else s.result_snapshot end,
         approval_status = case when e.status = 'concluido' then e.approval_status else s.approval_status end,
         approved_at = case when e.status = 'concluido' then e.approved_at else s.approved_at end,
         approved_by = case when e.status = 'concluido' then e.approved_by else s.approved_by end,
         -- Certificada a missão, a suspensão da reciclagem acaba nas irmãs também
         -- (a porta já foi devolvida pela matrícula que certificou).
         access_suspended_at = case
           when e.status = 'concluido' and e.approval_status is distinct from 'pendente' then null
           else s.access_suspended_at
         end
    from public.training_campaigns tc
   where tc.id = s.campaign_id
     and tc.status = 'aberta'
     and tc.kind = e.kind
     and s.user_id = e.user_id
     and s.role = e.role
     and s.id <> e.id
     and s.status <> 'dispensado'
     -- Nunca volta atrás: concluída não reabre, em andamento não volta a convocada.
     and (s.status = 'convocado'
          or (s.status = 'em_andamento' and e.status = 'concluido')
          or (s.status = 'concluido' and e.status = 'concluido'
              and s.approval_status is distinct from e.approval_status));
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke execute on function public._sync_training_siblings(uuid) from public, anon, authenticated;

-- 2) Aceitar: o marco vale para as irmãs ----------------------------------------
create or replace function public.start_training_mission(p_enrollment_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_started timestamptz;
  v_user uuid;
  v_status text;
  v_role public.user_role;
  v_kind text;
  v_marco_irma timestamptz;
begin
  select e.user_id, e.status, e.started_at, e.role, tc.kind
    into v_user, v_status, v_started, v_role, v_kind
    from public.training_enrollments e
    join public.training_campaigns tc on tc.id = e.campaign_id
   where e.id = p_enrollment_id;

  if v_user is null then
    raise exception 'ENROLLMENT_NOT_FOUND';
  end if;

  -- ⚠️ `IS DISTINCT FROM`, NUNCA `<>` (AP9): com `auth.uid()` nulo, `<>` não
  -- dispararia e a trava ficaria aberta para quem não está logado.
  if v_user is distinct from auth.uid() then
    raise exception 'ONLY_THE_PERSON_STARTS';
  end if;

  -- Já começou: devolve o marco original (o clique duplo não reinicia) — e
  -- alinha as irmãs, caso alguma ainda esteja só convocada.
  if v_started is not null then
    perform public._sync_training_siblings(p_enrollment_id);
    return v_started;
  end if;

  if v_status = 'dispensado' then
    raise exception 'ENROLLMENT_DISMISSED';
  end if;

  -- AP52: se uma irmã (mesma função, outra unidade) já começou, vale o marco
  -- DELA — é a mesma missão, e o trabalho feito desde então já conta.
  select min(s.started_at) into v_marco_irma
    from public.training_enrollments s
    join public.training_campaigns tc on tc.id = s.campaign_id
   where s.user_id = v_user
     and s.role = v_role
     and tc.kind = v_kind
     and tc.status = 'aberta'
     and s.started_at is not null
     and s.id <> p_enrollment_id;

  update public.training_enrollments
     set started_at = coalesce(v_marco_irma, now()), status = 'em_andamento'
   where id = p_enrollment_id
  returning started_at into v_started;

  perform public._sync_training_siblings(p_enrollment_id);
  return v_started;
end;
$$;

revoke execute on function public.start_training_mission(uuid) from public, anon, authenticated;
grant execute on function public.start_training_mission(uuid) to authenticated;

-- 3) O certificado: UMA vez por missão, e as irmãs acompanham -------------------
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

  -- AP52: a irmã já certificou esta missão (mesma função, desde a
  -- convocação) — não grava o segundo certificado.
  if not exists (
    select 1 from public.training_certifications c
     where c.user_id = e.user_id and c.role = e.role
       and c.certified_at >= e.invited_at
  ) then
    insert into public.training_certifications
      (user_id, role, clinic_id, campaign_id, approved_by, snapshot)
    values
      (e.user_id, e.role, e.clinic_id, e.campaign_id, p_approver,
       coalesce(e.result_snapshot, '{}'::jsonb));
  end if;

  update public.training_enrollments
     set approval_status = case when p_approver is not null then 'aprovada' else approval_status end,
         approved_at = case when p_approver is not null then now() else approved_at end,
         approved_by = coalesce(p_approver, approved_by)
   where id = p_enrollment_id;

  -- Reciclagem com o acesso suspenso: devolve (só o que o portão tirou).
  if e.access_suspended_at is not null then
    perform public.restore_training_access(p_enrollment_id);
  end if;

  -- AP52: as irmãs ficam aprovadas junto.
  perform public._sync_training_siblings(p_enrollment_id);

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

-- 4) Cumprir: as irmãs concluem junto -------------------------------------------
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

  -- Já registrada (por ela ou por uma irmã): devolve o estado, sem certificar
  -- duas vezes.
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
    -- `_certify_enrollment` alinha as irmãs no fim.
    return public._certify_enrollment(p_enrollment_id, null);
  end if;

  update public.training_enrollments
     set approval_status = 'pendente'
   where id = p_enrollment_id;

  -- AP52: as irmãs também ficam cumpridas, aguardando a mesma aprovação.
  perform public._sync_training_siblings(p_enrollment_id);

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

-- 5) Os casos que já existem ----------------------------------------------------
-- Primeiro as concluídas (levam as irmãs junto), depois as em andamento.
do $$
declare
  r record;
begin
  for r in
    select e.id
      from public.training_enrollments e
      join public.training_campaigns tc on tc.id = e.campaign_id
     where tc.status = 'aberta'
       and e.status in ('concluido', 'em_andamento')
     order by (e.status = 'concluido') desc, e.started_at nulls last
  loop
    perform public._sync_training_siblings(r.id);
  end loop;
end $$;

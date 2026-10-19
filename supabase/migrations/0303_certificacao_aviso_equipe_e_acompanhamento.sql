-- =============================================================================
-- 0303 — CERTIFICAÇÃO: AVISO AO CONVOCAR, A EQUIPE E O ACOMPANHAMENTO (OC-00003)
--
-- Relato OC-00003 (Admin Master, produção, 18/10/2026): "ao convocar a pessoa,
-- o sistema não gera nenhum alerta para quem foi convocado (teste com
-- DENTISTA)". O que se achou:
--
--   - REGRA, que segue: a convocação aparece como um QUADRO no Início do
--     sistema REAL — nunca no treino, porque a certificação é guardada na
--     produção (0273). O teste foi feito entrando como o dentista no TREINO.
--   - E de fato nenhum aviso no SINO era criado ao convocar (na produção, os
--     dois dentistas da TR-00002 não receberam nenhum).
--
-- O QUE MUDA (decisões do dono, 19/10/2026):
--   1. AVISO NO SINO ao convocar: gatilho na matrícula. Cobre toda porta que
--      cria matrícula, hoje e no futuro. O aviso nunca derruba a convocação
--      (erro vira `raise warning`). Os já convocados de turma aberta, sem
--      aviso, recebem o seu agora.
--   2. A ÚLTIMA MEDIÇÃO fica guardada na matrícula (`progress_snapshot`), por
--      `record_training_progress` — só o SERVIDOR grava (chave de serviço),
--      depois de medir no treino. É ela que a equipe e o painel do Admin leem:
--      medir 2.000 pessoas a cada abertura de tela seria impossível.
--   3. A EQUIPE (`my_training_group`): na liberação COLETIVA, a pessoa vê o
--      grupo da unidade — nome, função, situação e o último progresso medido.
--      O grupo é o MESMO que segura a unidade (`_system_access_raw`, 0277):
--      matrículas de turmas de novatos abertas, na mesma unidade, não
--      dispensadas.
--
-- Nada apaga dado. Idempotente.
-- =============================================================================

-- 1) A última medição na matrícula ---------------------------------------------
alter table public.training_enrollments
  add column if not exists progress_snapshot jsonb,
  add column if not exists progress_measured_at timestamptz;

comment on column public.training_enrollments.progress_snapshot is
  'Última medição da missão (itens, percentual), gravada pelo servidor depois de medir no treino. Retrato, não régua: quem decide "cumpriu" é a medição na hora (0281).';

create or replace function public.record_training_progress(
  p_enrollment_id uuid,
  p_snapshot jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_snapshot is null or jsonb_typeof(p_snapshot) <> 'object' then
    raise exception 'INVALID_SNAPSHOT';
  end if;
  update public.training_enrollments
     set progress_snapshot = p_snapshot,
         progress_measured_at = now()
   where id = p_enrollment_id;
end;
$$;

-- Só o servidor grava (como `record_training_completion`, 0281): o número que
-- a equipe e o Admin leem não pode vir do navegador.
revoke execute on function public.record_training_progress(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.record_training_progress(uuid, jsonb) to service_role;

-- 2) O aviso no sino ao convocar -----------------------------------------------
create or replace function public.training_enrollment_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    insert into public.notifications (user_id, title, body, link)
    values (
      new.user_id,
      'Você foi convocado para a certificação',
      'Abra o Início do sistema REAL para ver o que você vai cumprir e aceitar a missão. A missão é cumprida trabalhando no ambiente de treino.',
      '/'
    );
  exception when others then
    -- O aviso nunca derruba a convocação.
    raise warning 'training_enrollment_notify: %', sqlerrm;
  end;
  return new;
end;
$$;

revoke execute on function public.training_enrollment_notify() from public, anon, authenticated;

drop trigger if exists training_enrollment_notify_trg on public.training_enrollments;
create trigger training_enrollment_notify_trg
  after insert on public.training_enrollments
  for each row execute function public.training_enrollment_notify();

-- Os já convocados de turma aberta que nunca receberam o aviso recebem agora.
insert into public.notifications (user_id, title, body, link)
select distinct e.user_id,
       'Você foi convocado para a certificação',
       'Abra o Início do sistema REAL para ver o que você vai cumprir e aceitar a missão. A missão é cumprida trabalhando no ambiente de treino.',
       '/'
  from public.training_enrollments e
  join public.training_campaigns tc on tc.id = e.campaign_id
 where tc.status = 'aberta'
   and e.status = 'convocado'
   and not exists (
     select 1 from public.notifications n
      where n.user_id = e.user_id
        and n.title = 'Você foi convocado para a certificação'
   );

-- 3) A equipe: o grupo da unidade na liberação coletiva ------------------------
create or replace function public.my_training_group()
returns table (
  clinic_id uuid,
  clinic_name text,
  user_id uuid,
  full_name text,
  role public.user_role,
  status text,
  started_at timestamptz,
  certified boolean,
  approval_status text,
  progress_snapshot jsonb,
  progress_measured_at timestamptz,
  is_me boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
begin
  if v_me is null then raise exception 'NOT_ALLOWED'; end if;

  -- Só existe "grupo" na liberação coletiva.
  if not exists (
    select 1 from public.training_settings ts where ts.release_scope = 'coletiva'
  ) then
    return;
  end if;

  return query
  with minhas as (
    -- As unidades onde EU estou numa turma de novatos aberta.
    select distinct e.clinic_id
      from public.training_enrollments e
      join public.training_campaigns tc on tc.id = e.campaign_id
     where e.user_id = v_me
       and tc.status = 'aberta'
       and tc.kind = 'novatos'
       and e.status <> 'dispensado'
       and e.clinic_id is not null
  )
  -- O grupo é o MESMO que segura a unidade (`_system_access_raw`, 0277).
  select
    e.clinic_id,
    cl.name::text,
    e.user_id,
    coalesce(p.full_name, p.email)::text,
    e.role,
    e.status,
    e.started_at,
    exists (
      select 1 from public.training_certifications c
       where c.user_id = e.user_id and c.role = e.role
         and c.certified_at >= e.invited_at
    ),
    e.approval_status,
    e.progress_snapshot,
    e.progress_measured_at,
    e.user_id = v_me
  from public.training_enrollments e
  join public.training_campaigns tc on tc.id = e.campaign_id
  join minhas m on m.clinic_id = e.clinic_id
  join public.clinics cl on cl.id = e.clinic_id
  left join public.profiles p on p.id = e.user_id
  where tc.status = 'aberta'
    and tc.kind = 'novatos'
    and e.status <> 'dispensado'
  order by cl.name, coalesce(p.full_name, p.email);
end;
$$;

revoke execute on function public.my_training_group() from public, anon, authenticated;
grant execute on function public.my_training_group() to authenticated;

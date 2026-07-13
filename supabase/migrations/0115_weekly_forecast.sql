-- =============================================================================
-- 0115 — Previsão semanal do dentista (H4.6 E4)
-- -----------------------------------------------------------------------------
-- No fim de semana (sáb/dom), o dentista recebe um aviso com a PRÓXIMA semana:
-- quantos atendimentos e em quantas unidades. Disparado quando ele abre o
-- sistema (2º plano), deduplicado por semana. O informativo detalhado (data /
-- unidade / horário / tipo) é a tela "Minha Agenda" (E3), para onde o aviso
-- aponta. Sem envio externo (adiado). Idempotente.
-- =============================================================================

create or replace function public.notify_weekly_forecast()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_dow int := extract(dow from current_date)::int;   -- 0=Dom … 6=Sáb
  v_next_mon date;
  v_next_sun date;
  v_count int;
  v_units int;
  v_clinic uuid;
  v_title text;
begin
  if v_user is null then return; end if;
  -- Só no fim de semana (sábado ou domingo).
  if v_dow not in (0, 6) then return; end if;

  -- Segunda-feira da PRÓXIMA semana.
  v_next_mon := (current_date - ((v_dow + 6) % 7)) + 7;
  v_next_sun := v_next_mon + 6;

  select count(*), count(distinct clinic_id)
    into v_count, v_units
  from public.appointments
  where provider_user_id = v_user
    and starts_at >= v_next_mon::timestamp
    and starts_at < (v_next_mon + 7)::timestamp
    and status not in ('cancelled', 'no_show');
  if coalesce(v_count, 0) = 0 then return; end if;

  select clinic_id into v_clinic
  from public.appointments
  where provider_user_id = v_user
    and starts_at >= v_next_mon::timestamp
    and starts_at < (v_next_mon + 7)::timestamp
    and status not in ('cancelled', 'no_show')
  order by starts_at
  limit 1;

  v_title := 'Sua semana: ' || to_char(v_next_mon, 'DD/MM')
    || ' a ' || to_char(v_next_sun, 'DD/MM');

  insert into public.notifications (user_id, clinic_id, title, body, link)
  select v_user, v_clinic, v_title,
         'Você tem ' || v_count || ' atendimento(s) em ' || v_units
           || ' unidade(s) na próxima semana. Veja em Minha Agenda.',
         '/minha-agenda?semana=1'
  where not exists (
    select 1 from public.notifications n
    where n.user_id = v_user and n.title = v_title
  );
end;
$$;

grant execute on function public.notify_weekly_forecast() to authenticated;

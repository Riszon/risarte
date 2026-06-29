-- =============================================================================
-- 0051 — Aviso de aniversariantes para a Recepção (Prontuários P2)
-- -----------------------------------------------------------------------------
-- notify_birthday_clients: cria (de forma idempotente) UMA notificação por
-- recepcionista da unidade, listando os aniversariantes a parabenizar. O app
-- calcula quais datas cobrir (hoje + dias fechados imediatamente à frente, para
-- antecipar fim de semana/feriado) usando a configuração da agenda e os feriados
-- (lib/agenda-settings.ts + lib/holidays.ts) e passa o array de datas.
--
-- Dedupe pelo `link` (que carrega a data da rodada): reabrir o sistema no mesmo
-- dia não duplica; no dia seguinte o link muda e um novo aviso é criado.
-- Sem novas tabelas.
-- =============================================================================

create or replace function public.notify_birthday_clients(
  p_clinic_id uuid,
  p_dates date[],
  p_run_date date
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_md text[];
  v_list text;
  v_count integer;
  v_link text;
  v_anticipa boolean;
begin
  -- Só membros da unidade (ou Admin Master) disparam o aviso.
  if not (
    public.is_admin_master()
    or exists (
      select 1 from public.user_clinic_roles ucr
      where ucr.clinic_id = p_clinic_id
        and ucr.user_id = (select auth.uid())
    )
  ) then
    return;
  end if;
  if p_dates is null or array_length(p_dates, 1) is null then
    return;
  end if;

  -- Mês/dia (MM-DD) de cada data a cobrir.
  select array_agg(to_char(d, 'MM-DD')) into v_md
  from unnest(p_dates) as d;

  -- Aniversariantes da unidade nessas datas (compara mês/dia, ignora o ano).
  select
    string_agg(
      c.full_name || ' (' || to_char(c.birth_date, 'DD/MM') || ')',
      ', ' order by to_char(c.birth_date, 'MM-DD'), c.full_name
    ),
    count(*)
  into v_list, v_count
  from public.clients c
  where (c.clinic_id = p_clinic_id or c.preferred_clinic_id = p_clinic_id)
    and c.status <> 'anonymized'
    and c.birth_date is not null
    and to_char(c.birth_date, 'MM-DD') = any (v_md);

  if v_count is null or v_count = 0 then
    return; -- ninguém faz aniversário nas datas cobertas
  end if;

  v_anticipa := array_length(p_dates, 1) > 1;
  v_link := '/prontuarios?aba=aniversariantes&dia='
    || to_char(p_run_date, 'YYYY-MM-DD');

  insert into public.notifications (user_id, clinic_id, title, body, link)
  select ucr.user_id, p_clinic_id,
    'Aniversariantes — ' || to_char(p_run_date, 'DD/MM'),
    case when v_anticipa
      then 'Parabenize (inclui dias fechados à frente): ' || v_list
      else 'Parabenize hoje: ' || v_list
    end,
    v_link
  from public.user_clinic_roles ucr
  where ucr.clinic_id = p_clinic_id
    and ucr.role = 'receptionist'
    and not exists (
      select 1 from public.notifications n
      where n.user_id = ucr.user_id
        and n.link = v_link
    );
end $$;

grant execute on function public.notify_birthday_clients(uuid, date[], date)
  to authenticated;

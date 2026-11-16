-- =============================================================================
-- 0410 — LEVANTAMENTO DE DÍVIDAS, FASE 8: OS AVISOS
-- -----------------------------------------------------------------------------
-- Plano aprovado pelo dono em 13/11/2026: docs/Financeiro/DIVIDAS-PLANO.md
-- (4.4 e D12). A 0408 já mandava os três avisos do acordo (parcela em atraso,
-- acordo quebrado, acordo aguardando aprovação). Aqui entram os outros:
--
--   rotina diária (`_debt_notices_daily`, chamada pela `debt_daily_run`):
--     * proposta vencendo — nos dias da regra (`proposal_alert_days`, 7 e 2);
--     * parcela de acordo vencendo — 3 dias antes;
--     * prestes a virar inadimplente — `about_to_default_days` antes do prazo;
--     * checklist de encerramento parado — `closing_stale_days` depois de
--       quitada;
--     * baixa da negativação não confirmada — passado o prazo do credor;
--     * próxima ação vencida.
--   na hora (gatilho):
--     * novo protesto ou nova ação judicial — CRÍTICO (o Admin Master também).
--       A carga da planilha não avisa um a um: protesto de dívida ou grupo
--       criados na MESMA transação (a importação) fica de fora.
--
-- Quem recebe (D12): o responsável da dívida; sem ele, os Financeiros da
-- Franqueadora; o Admin Master só nos críticos. Uma vez por assunto (a porta
-- `_debt_notify` e a tabela `debt_notices`, 0408). Nunca quem fez a ação.
--
-- Idempotente. Não apaga dado. Recria `debt_daily_run` (partindo da 0408).
-- =============================================================================

-- O número de uma regra: o do devedor, senão o da rede, senão o padrão.
create or replace function public._debt_setting_int(p_clinic_id uuid, p_key text, p_default integer)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select (to_jsonb(s) ->> p_key)::integer from public.debt_settings s where s.clinic_id = p_clinic_id),
    (select (to_jsonb(s) ->> p_key)::integer from public.debt_settings s where s.clinic_id is null),
    p_default);
$$;
revoke execute on function public._debt_setting_int(uuid, text, integer) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 1) OS AVISOS DA ROTINA
-- -----------------------------------------------------------------------------
create or replace function public._debt_notices_daily()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_n integer := 0;
  v_hoje date := public.today_br();
  v_dias integer[];
  v_k integer;
  v_owner uuid;
  v_debt uuid;
  v_vira date;
  v_about integer;
begin
  -- Proposta vencendo: um aviso por marco da regra (o menor que já chegou).
  for r in
    select pr.id, pr.debt_id, pr.group_id, pr.valid_until, pr.amount_cents,
           coalesce(d.clinic_id, g.clinic_id) as clinic_id,
           coalesce(pr.debt_id, (select x.id from public.debts x where x.group_id = pr.group_id and x.deleted_at is null order by x.code limit 1)) as alvo,
           s.name as credor
      from public.debt_proposals pr
      left join public.debts d on d.id = pr.debt_id
      left join public.debt_groups g on g.id = pr.group_id
      left join public.suppliers s on s.id = coalesce(d.supplier_id, g.supplier_id)
     where pr.status = 'ativa' and pr.valid_until is not null and pr.valid_until >= v_hoje
  loop
    if r.alvo is null then continue; end if;
    v_dias := coalesce(
      (select s.proposal_alert_days from public.debt_settings s where s.clinic_id = r.clinic_id),
      (select s.proposal_alert_days from public.debt_settings s where s.clinic_id is null),
      '{7,2}');
    select min(k) into v_k from unnest(v_dias) k where k >= (r.valid_until - v_hoje);
    if v_k is null then continue; end if;
    select owner_user_id into v_owner from public.debts where id = r.alvo;
    v_n := v_n + public._debt_notify(r.id, 'proposta_vencendo', v_k::text, r.clinic_id, v_owner, false, false,
      'Dívidas: proposta vencendo em ' || to_char(r.valid_until, 'DD/MM/YYYY'),
      'A proposta de ' || public.brl(r.amount_cents) || ' de ' || coalesce(r.credor, 'um credor')
        || ' vale até ' || to_char(r.valid_until, 'DD/MM/YYYY') || '. Aceite (Renegociar dívida) ou registre a nova condição.',
      '/financeiro/dividas/' || r.alvo || '?aba=propostas');
  end loop;

  -- Parcela de acordo vencendo: 3 dias antes.
  for r in
    select p.id, p.due_date, p.amount_cents - coalesce(p.paid_amount_cents, 0) as falta, a.code, a.clinic_id,
           a.primary_debt_id, s.name as credor
      from public.payables p
      join public.debt_agreements a on a.id = p.debt_agreement_id
      left join public.suppliers s on s.id = a.supplier_id
     where p.debt_link = 'acordo' and p.status in ('aberta', 'parcial')
       and p.due_date between v_hoje and v_hoje + 3
       and a.status in ('em_andamento', 'quebrado')
  loop
    select owner_user_id into v_owner from public.debts where id = r.primary_debt_id;
    v_n := v_n + public._debt_notify(r.id, 'parcela_vencendo', '', r.clinic_id, v_owner, false, false,
      'Dívidas: parcela do acordo ' || r.code || ' vence em ' || to_char(r.due_date, 'DD/MM/YYYY'),
      'Faltam ' || public.brl(r.falta) || '. Credor: ' || coalesce(r.credor, '—') || '.',
      '/financeiro/dividas/' || r.primary_debt_id || '?aba=acordos');
  end loop;

  -- Prestes a virar inadimplente: o vencimento mais antigo em aberto + o prazo.
  for r in
    select d.id, d.code, d.clinic_id, d.supplier_id, d.owner_user_id,
           coalesce(pos.oldest_open_due, d.due_date) as venc, s.name as credor
      from public.debts d
      left join lateral public._debt_positions(array[d.id]) pos on true
      left join public.suppliers s on s.id = d.supplier_id
     where d.deleted_at is null and d.status = 'em_atraso'
  loop
    v_vira := r.venc + public._debt_days_to_default(r.clinic_id, r.supplier_id) + 1;
    v_about := public._debt_setting_int(r.clinic_id, 'about_to_default_days', 5);
    if v_vira - v_hoje > v_about or v_vira <= v_hoje then continue; end if;
    v_n := v_n + public._debt_notify(r.id, 'prestes_inadimplente', r.venc::text, r.clinic_id, r.owner_user_id, false, false,
      'Dívidas: ' || r.code || ' vira inadimplente em ' || to_char(v_vira, 'DD/MM/YYYY'),
      'Credor: ' || coalesce(r.credor, '—') || '. Negocie antes do prazo, se der.',
      '/financeiro/dividas/' || r.id);
  end loop;

  -- Checklist de encerramento parado.
  for r in
    select d.id, d.code, d.clinic_id, d.owner_user_id, d.status_changed_at::date as desde
      from public.debts d
     where d.deleted_at is null and d.status = 'quitada_pendencias'
       and exists (select 1 from public.debt_closing_items c where c.debt_id = d.id and c.applicable and c.done_on is null)
  loop
    if v_hoje - r.desde < public._debt_setting_int(r.clinic_id, 'closing_stale_days', 15) then continue; end if;
    v_n := v_n + public._debt_notify(r.id, 'checklist_parado', r.desde::text, r.clinic_id, r.owner_user_id, false, false,
      'Dívidas: encerramento de ' || r.code || ' parado',
      'Quitada desde ' || to_char(r.desde, 'DD/MM/YYYY') || ' e o checklist de encerramento ainda tem pendência.',
      '/financeiro/dividas/' || r.id || '?aba=encerramento');
  end loop;

  -- Baixa da negativação não confirmada, passado o prazo do credor.
  for r in
    select c.id, c.due_on, d.id as debt_id, d.code, d.clinic_id, d.owner_user_id
      from public.debt_closing_items c
      join public.debts d on d.id = c.debt_id and d.deleted_at is null
     where c.item = 'baixa_negativacao' and c.applicable and c.done_on is null
       and c.due_on is not null and c.due_on < v_hoje
  loop
    v_n := v_n + public._debt_notify(r.id, 'baixa_negativacao', '', r.clinic_id, r.owner_user_id, false, false,
      'Dívidas: baixa da negativação de ' || r.code || ' não confirmada',
      'O prazo do credor para tirar o nome terminou em ' || to_char(r.due_on, 'DD/MM/YYYY')
        || '. Confira no Serasa/SPC e marque no encerramento.',
      '/financeiro/dividas/' || r.debt_id || '?aba=encerramento');
  end loop;

  -- Próxima ação vencida.
  for r in
    select d.id, d.code, d.clinic_id, d.owner_user_id, d.next_action, d.next_action_on
      from public.debts d
     where d.deleted_at is null and d.next_action_on is not null and d.next_action_on < v_hoje
       and d.status not in ('baixada', 'quitada_pendencias', 'quitada_encerrada')
  loop
    v_n := v_n + public._debt_notify(r.id, 'proxima_acao', r.next_action_on::text, r.clinic_id, r.owner_user_id, false, false,
      'Dívidas: próxima ação de ' || r.code || ' vencida',
      coalesce(nullif(btrim(r.next_action), ''), 'Próxima ação') || ' — era para ' || to_char(r.next_action_on, 'DD/MM/YYYY') || '.',
      '/financeiro/dividas/' || r.id);
  end loop;

  return v_n;
end;
$$;
revoke execute on function public._debt_notices_daily() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2) NOVO PROTESTO OU AÇÃO JUDICIAL — crítico, na hora
-- -----------------------------------------------------------------------------
create or replace function public.debt_restriction_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_debt uuid;
  v_clinic uuid;
  v_owner uuid;
  v_code text;
  v_credor text;
  v_carga boolean;
  v_oque text;
begin
  if tg_table_name = 'debt_protests' then
    v_debt := coalesce(new.debt_id,
      (select x.id from public.debts x where x.group_id = new.group_id and x.deleted_at is null order by x.code limit 1));
    v_oque := 'protesto';
    -- A carga da planilha (dívida ou grupo criados nesta mesma transação) não avisa um a um.
    v_carga := exists (select 1 from public.debts x where x.id = new.debt_id and x.import_batch_id is not null and x.created_at = now())
            or exists (select 1 from public.debt_groups g where g.id = new.group_id and g.created_at = now());
  else
    v_debt := new.debt_id;
    v_oque := 'ação judicial';
    v_carga := exists (select 1 from public.debts x where x.id = new.debt_id and x.import_batch_id is not null and x.created_at = now());
  end if;
  if v_carga or v_debt is null then return null; end if;

  select d.clinic_id, d.owner_user_id, d.code, s.name into v_clinic, v_owner, v_code, v_credor
    from public.debts d left join public.suppliers s on s.id = d.supplier_id
   where d.id = v_debt;
  perform public._debt_notify(new.id, case when tg_table_name = 'debt_protests' then 'novo_protesto' else 'nova_acao' end,
    '', v_clinic, v_owner, true, false,
    'Dívidas: novo ' || v_oque || ' em ' || coalesce(v_code, 'uma dívida'),
    'Foi lançado um ' || v_oque || ' de ' || coalesce(v_credor, 'um credor') || '. Veja as restrições da dívida.',
    '/financeiro/dividas/' || v_debt || '?aba=restricoes');
  return null;
exception when others then
  -- O aviso nunca derruba o lançamento.
  raise warning 'debt_restriction_notify: %', sqlerrm;
  return null;
end;
$$;
revoke execute on function public.debt_restriction_notify() from public, anon, authenticated;

drop trigger if exists debt_protests_notify on public.debt_protests;
create trigger debt_protests_notify after insert on public.debt_protests
  for each row execute function public.debt_restriction_notify();
drop trigger if exists debt_lawsuits_notify on public.debt_lawsuits;
create trigger debt_lawsuits_notify after insert on public.debt_lawsuits
  for each row execute function public.debt_restriction_notify();

-- -----------------------------------------------------------------------------
-- 3) A ROTINA DIÁRIA (corpo da 0408 + os avisos)
-- -----------------------------------------------------------------------------
create or replace function public.debt_daily_run()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_n integer := 0;
  v_old text;
  v_d uuid;
  v_prev date := date_trunc('month', public.today_br() - interval '1 month')::date;
begin
  -- 0408: os acordos primeiro (a situação da dívida depende deles).
  perform public._debt_agreements_daily();

  for r in select id, status from public.debts where deleted_at is null loop
    v_old := r.status;
    if public._debt_refresh_status(r.id, true) is distinct from v_old then
      v_n := v_n + 1;
    end if;
  end loop;

  -- Proposta com validade vencida deixa de ser "ativa" (0405).
  for r in
    update public.debt_proposals
       set status = 'expirada', status_changed_at = now(), status_reason = 'Validade vencida'
     where status = 'ativa' and valid_until is not null and valid_until < public.today_br()
    returning id, debt_id, group_id
  loop
    for v_d in select id from public.debts where (id = r.debt_id or group_id = r.group_id) and deleted_at is null loop
      insert into public.debt_events (debt_id, user_id, kind, note, data)
      values (v_d, null, 'proposta_expirada', 'Validade vencida', jsonb_build_object('id', r.id));
    end loop;
  end loop;

  -- 0410: os avisos (depois da situação do dia).
  perform public._debt_notices_daily();

  -- A fotografia do mês que fechou (0407): uma vez só.
  if not exists (select 1 from public.debt_month_positions where month = v_prev) then
    perform public._debt_snapshot_month(v_prev);
  end if;
  return v_n;
end;
$$;
revoke execute on function public.debt_daily_run() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- CONFERÊNCIA (rodar à parte, depois): o esperado é 2 · 2 · true
-- -----------------------------------------------------------------------------
-- select
--   (select count(*) from pg_trigger where tgname in ('debt_protests_notify', 'debt_lawsuits_notify')) as gatilhos,
--   (select count(*) from pg_proc where proname in ('_debt_notices_daily', 'debt_restriction_notify')) as funcoes,
--   (select pg_get_functiondef(oid) like '%_debt_notices_daily%' from pg_proc where proname = 'debt_daily_run') as na_rotina;

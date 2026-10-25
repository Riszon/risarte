-- =============================================================================
-- 0322 — METAS SMART, ETAPA M5: RESULTADOS E ROTINA
-- -----------------------------------------------------------------------------
-- Plano e decisões do dono: docs/metas/METAS-PLANO.md, §9e (R1–R5, aprovadas
-- em 25/10/2026). Continua a 0318–0321.
--
-- O que esta migração faz:
--   1. MODELOS no banco (`goal_templates`): os 8 da M4 viram o ponto de partida
--      e o Admin e a Franqueadora passam a criar, editar e desativar pela tela
--      (R3: a mesma régua de criar meta da rede). Gravar só pela porta.
--   2. A LEITURA DOS RESULTADOS (`goal_results_report`): das metas encerradas
--      no período que a pessoa VÊ (R2), o percentual e se atingiu — da meta,
--      de cada unidade e de cada pessoa (R4: pessoas só para quem pode editar
--      a meta; cada um vê o próprio). Só percentuais: nenhum valor em R$ (D3).
--
-- Idempotente. Nada apaga dado.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) MODELOS
-- -----------------------------------------------------------------------------
create table if not exists public.goal_templates (
  id uuid primary key default gen_random_uuid(),
  -- Chave dos modelos semeados (M4); nulo nos criados pela tela.
  key text unique,
  name text not null,
  summary text,
  indicator text not null,
  direction text not null default 'increase' check (direction in ('increase', 'decrease')),
  target_mode text not null default 'collective' check (target_mode in ('collective', 'individual', 'both')),
  filters jsonb not null default '{}'::jsonb,
  duration text not null default 'mes' check (duration in ('mes', 'trimestre')),
  how_text text,
  resources_text text,
  strategic_objective text,
  relevance_text text,
  is_active boolean not null default true,
  position integer not null default 100,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now()
);
alter table public.goal_templates enable row level security;

-- Quem cria meta usa os modelos ativos; quem edita modelos vê também os
-- desativados.
drop policy if exists goal_templates_select on public.goal_templates;
create policy goal_templates_select on public.goal_templates
  for select to authenticated
  using (is_active or public.is_admin_master() or public.is_network_viewer());

-- Os 8 da M4 (src/lib/metas/modelos.ts — a régua `metas.test.ts` compara).
insert into public.goal_templates
  (key, name, summary, indicator, direction, target_mode, filters, duration,
   how_text, resources_text, strategic_objective, relevance_text, position)
values
  ('mes_riso_mais', 'Mês do Riso+', 'Adesões ao Riso+ no mês, por consultor.', 'ppr_adhesions', 'increase', 'individual', '{}'::jsonb, 'mes', 'Oferecer o Riso+ em toda apresentação e no retorno dos clientes que ainda não aderiram.', 'Material do Riso+ na recepção e o roteiro de oferta do Comercial.', 'programs', 'O Riso+ fideliza e dá receita recorrente; um mês de foco cria o hábito da oferta.', 0),
  ('avaliacoes_do_mes', 'Avaliações do mês', 'Avaliações realizadas na unidade no mês.', 'evaluations_done', 'increase', 'collective', '{}'::jsonb, 'mes', 'Confirmar a véspera de cada avaliação e reagendar na hora quem desmarcar.', 'A agenda de avaliação aberta e a confirmação pela recepção.', 'growth', 'Toda venda começa numa avaliação: é o primeiro número do funil.', 1),
  ('reduzir_faltas', 'Reduzir faltas', 'Taxa de faltas dos agendamentos, para baixo.', 'no_show_rate', 'decrease', 'collective', '{}'::jsonb, 'mes', 'Confirmar todo agendamento na véspera e oferecer outro horário a quem não puder vir.', 'A lista de confirmação da recepção e as mensagens prontas de lembrete.', 'efficiency', 'Cada falta é uma cadeira parada que já estava paga.', 2),
  ('ortodontia_trimestre', 'Ortodontia no trimestre', 'Procedimentos de Ortodontia realizados em três meses.', 'procedures_done', 'increase', 'collective', '{"specialties": ["Ortodontia"]}'::jsonb, 'trimestre', 'Indicar a avaliação ortodôntica nas consultas de rotina e abrir horários à tarde.', 'A cadeira de ortodontia e a agenda do ortodontista.', 'growth', 'A ortodontia ocupa a cadeira por meses e sustenta a receita do trimestre.', 3),
  ('inadimplencia_limite', 'Inadimplência abaixo do limite', 'O percentual em atraso, para baixo.', 'overdue_rate', 'decrease', 'collective', '{}'::jsonb, 'mes', 'Lembrar o vencimento antes do dia e ligar no dia seguinte ao atraso.', 'A tela de Recebíveis e as mensagens de cobrança.', 'financial_health', 'Dinheiro em atraso é caixa que falta para pagar as contas do mês.', 4),
  ('ocupacao_cadeira', 'Ocupação da cadeira', 'Ocupação das cadeiras no mês (a conta do Planejamento Anual).', 'chair_occupancy', 'increase', 'collective', '{}'::jsonb, 'mes', 'Preencher os buracos da agenda com retornos e encaixes antes de abrir horário novo.', 'A agenda da unidade e a lista de retornos pendentes.', 'efficiency', 'A cadeira ociosa é o custo fixo que não volta.', 5),
  ('novos_clientes', 'Novos clientes', 'Clientes novos cadastrados no mês.', 'new_clients', 'increase', 'collective', '{}'::jsonb, 'mes', 'Cadastrar todo contato que chegar e pedir indicação aos clientes satisfeitos.', 'O Indica +Risos e o cadastro pela recepção e pela SDR.', 'growth', 'Sem cliente novo a agenda envelhece.', 6),
  ('ticket_medio', 'Ticket médio', 'Valor médio de cada venda fechada, por consultor.', 'sales_ticket', 'increase', 'individual', '{}'::jsonb, 'mes', 'Apresentar o plano completo antes das alternativas e mostrar o valor de cada etapa.', 'A apresentação do plano e a tabela de pagamento.', 'growth', 'Vender melhor cada caso rende mais que atender mais casos.', 7)
on conflict (key) do nothing;

-- R3: Admin e Franqueadora (espelho de `podeCriarMetaDaRede`).
create or replace function public._goal_can_edit_templates()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
     and coalesce(public.is_admin_master() or public.is_network_viewer(), false);
$$;

create or replace function public.goal_template_save(p_id uuid, p_data jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_id uuid := p_id;
  v_meta record;
  v_direction text := coalesce(p_data ->> 'direction', 'increase');
  v_mode text := coalesce(p_data ->> 'target_mode', 'collective');
begin
  if not public._goal_can_edit_templates() then raise exception 'GOAL_NOT_ALLOWED'; end if;
  if nullif(trim(coalesce(p_data ->> 'name', '')), '') is null then raise exception 'GOAL_NAME_REQUIRED'; end if;
  select * into v_meta from public._goal_indicator_meta(p_data ->> 'indicator') m;
  if v_meta.kind is null then raise exception 'GOAL_UNKNOWN_INDICATOR'; end if;
  -- As mesmas regras de direção e de dono por pessoa da meta (goal_save).
  if v_direction not in ('increase', 'decrease') then raise exception 'GOAL_BAD_DIRECTION'; end if;
  if v_meta.kind = 'sum' and v_direction <> 'increase' and not v_meta.can_decrease then
    raise exception 'GOAL_BAD_DIRECTION';
  end if;
  if v_meta.kind = 'sum' and v_meta.can_decrease and v_direction <> 'decrease' then
    raise exception 'GOAL_BAD_DIRECTION';
  end if;
  if v_mode not in ('collective', 'individual', 'both') then raise exception 'GOAL_NOT_PER_PERSON'; end if;
  if not v_meta.per_person and v_mode <> 'collective' then raise exception 'GOAL_NOT_PER_PERSON'; end if;
  if coalesce(p_data ->> 'duration', 'mes') not in ('mes', 'trimestre') then raise exception 'GOAL_BAD_PERIOD'; end if;

  if v_id is null then
    insert into public.goal_templates (name, indicator, created_by, updated_by)
    values (trim(p_data ->> 'name'), p_data ->> 'indicator', v_user, v_user)
    returning id into v_id;
  elsif not exists (select 1 from public.goal_templates t where t.id = v_id) then
    raise exception 'GOAL_NOT_FOUND';
  end if;

  update public.goal_templates set
    name = trim(p_data ->> 'name'),
    summary = nullif(trim(coalesce(p_data ->> 'summary', '')), ''),
    indicator = p_data ->> 'indicator',
    direction = v_direction,
    target_mode = v_mode,
    filters = coalesce(p_data -> 'filters', '{}'::jsonb),
    duration = coalesce(p_data ->> 'duration', 'mes'),
    how_text = nullif(trim(coalesce(p_data ->> 'how_text', '')), ''),
    resources_text = nullif(trim(coalesce(p_data ->> 'resources_text', '')), ''),
    strategic_objective = nullif(p_data ->> 'strategic_objective', ''),
    relevance_text = nullif(trim(coalesce(p_data ->> 'relevance_text', '')), ''),
    updated_by = v_user,
    updated_at = now()
  where id = v_id;
  return v_id;
end;
$$;

-- Desativar em vez de apagar: o modelo some do assistente e volta quando
-- reativado (nenhuma meta depende dele — a meta copia os campos ao nascer).
create or replace function public.goal_template_set_active(p_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public._goal_can_edit_templates() then raise exception 'GOAL_NOT_ALLOWED'; end if;
  update public.goal_templates
     set is_active = coalesce(p_active, true), updated_by = (select auth.uid()), updated_at = now()
   where id = p_id;
  if not found then raise exception 'GOAL_NOT_FOUND'; end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 2) A LEITURA DOS RESULTADOS
-- -----------------------------------------------------------------------------
-- Uma linha por (meta, sujeito): sujeito 'goal' (a meta), 'clinic' (cada
-- unidade com registro) ou 'user' (cada participante, só em meta individual ou
-- "as duas"). Meta mensal: média dos percentuais dos meses e "atingiu" só se
-- atingiu em todos. Lê o resultado CONGELADO (goal_results) — nada é medido de
-- novo. Só percentuais (D3).
create or replace function public.goal_results_report(p_from date, p_to date)
returns table (goal_id uuid, subject_kind text, subject_id uuid, pct numeric, achieved boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with gs as (
    select g.id
      from public.goals g
     where (select auth.uid()) is not null
       and g.status = 'finished'
       and g.ends_on between p_from and p_to
       and public.can_view_goal(g.id)
  ),
  rs as (
    select g as g, g.id as gid, r.id as rid, m.kind, r.snapshot as s, r.value, r.achieved,
           (m.kind = 'sum' and g.direction = 'decrease') as limite,
           public._goal_can_edit(g.id) as ve_pessoas
      from gs
      join public.goals g on g.id = gs.id
      cross join lateral (select * from public._goal_indicator_meta(g.indicator)) m
      join public.goal_results r
        on r.goal_id = g.id
       and r.kind = case when g.periodicity = 'monthly' then 'period' else 'final' end
  ),
  cl as (
    select rs.gid, (e ->> 'id')::uuid as sid,
           public._goal_percent((rs.g).direction, rs.kind, public._goal_value(e), t.alvo,
                                case when rs.limite then null else (rs.g).baseline_value end) as pct,
           public._goal_achieved((rs.g).direction, public._goal_value(e), t.alvo) as ach
      from rs
      cross join lateral jsonb_array_elements(coalesce(rs.s -> 'by_clinic', '[]'::jsonb)) e
      cross join lateral (select public._goal_subject_target(rs.g, 'clinic', (e ->> 'id')::uuid,
                                   coalesce((rs.s ->> 'n_clinics')::int, 1)) as alvo) t
  ),
  pessoas as (
    select rs.gid, rs.rid, rs.ve_pessoas, u.id as sid,
           public._goal_percent((rs.g).direction, rs.kind, v.valor, t.alvo, null) as pct,
           public._goal_achieved((rs.g).direction, v.valor, t.alvo) as ach
      from rs
      cross join lateral (
        select p.user_id as id from public._goal_participants(rs.gid) p
        union
        select (e ->> 'id')::uuid from jsonb_array_elements(coalesce(rs.s -> 'by_user', '[]'::jsonb)) e
      ) u
      left join lateral (
        select e from jsonb_array_elements(coalesce(rs.s -> 'by_user', '[]'::jsonb)) e
         where (e ->> 'id')::uuid = u.id limit 1
      ) b on true
      cross join lateral (select coalesce(public._goal_value(b.e),
                                          case when rs.kind = 'sum' then 0 end) as valor) v
      cross join lateral (select public._goal_subject_target(rs.g, 'user', u.id,
                                   coalesce((rs.s ->> 'n_participants')::int, 0)) as alvo) t
     where (rs.g).target_mode <> 'collective'
  ),
  meta as (
    select rs.gid, rs.gid as sid,
           case when (rs.g).target_mode = 'individual'
                then (select avg(least(p.pct, 100)) from pessoas p where p.rid = rs.rid)
                else public._goal_percent((rs.g).direction, rs.kind, rs.value,
                                          (rs.g).target_value,
                                          case when rs.limite then null else (rs.g).baseline_value end)
           end as pct,
           rs.achieved as ach
      from rs
  ),
  tudo as (
    select gid, 'goal'::text as sk, sid, pct, ach from meta
    union all
    select gid, 'clinic', sid, pct, ach from cl
    union all
    select gid, 'user', sid, pct, ach from pessoas
     where ve_pessoas or sid = (select auth.uid())
  )
  select gid, sk, sid, round(avg(pct), 1), bool_and(ach)
    from tudo
   group by gid, sk, sid;
$$;

-- -----------------------------------------------------------------------------
-- 3) PERMISSÕES DE EXECUÇÃO (AP15) e AUDITORIA
-- -----------------------------------------------------------------------------
revoke execute on function public._goal_can_edit_templates() from public, anon, authenticated;
revoke execute on function public.goal_template_save(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.goal_template_save(uuid, jsonb) to authenticated;
revoke execute on function public.goal_template_set_active(uuid, boolean) from public, anon, authenticated;
grant execute on function public.goal_template_set_active(uuid, boolean) to authenticated;
revoke execute on function public.goal_results_report(date, date) from public, anon, authenticated;
grant execute on function public.goal_results_report(date, date) to authenticated;

select public.audit_attach_all();

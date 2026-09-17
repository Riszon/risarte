-- =============================================================================
-- 0258 — PROBLEMAS 2.0, PARTE C: o painel de indicadores
-- -----------------------------------------------------------------------------
-- Pedido do dono (16/09/2026): problemas relatados × solucionados; sugestões
-- por categoria × implantadas; respostas enviadas; tempo médio para resposta e
-- para resolução; qual unidade mais contribui; qual usuário é mais
-- colaborativo.
--
-- QUEM VÊ (decisão do dono, 16/09/2026):
--   * Admin Master e quem trabalha na Franqueadora → a rede inteira, com o
--     ranking de unidades e de pessoas;
--   * Gerente de unidade e Franqueado → só a(s) própria(s) unidade(s), SEM
--     ranking de pessoas;
--   * o resto da operação → não abre o painel (continua relatando e lendo as
--     respostas na tela de Problemas).
--
-- ⚠️ POR QUE UMA FUNÇÃO `security definer`, e não a tela somando o que lê.
-- A RLS de `system_reports` (0247) mostra à Franqueadora só os relatos da
-- própria clínica dela — o painel da rede, montado pela tela, contaria meia
-- rede e diria que é a rede inteira. E o ranking de pessoas precisa de nomes
-- que a RLS de `profiles` esconde. A função enxerga tudo e por isso decide,
-- ELA, o escopo de quem chamou (a lição da 0227: definer sem guarda entrega o
-- dado a quem pedir).
--
-- AS RÉGUAS, declaradas aqui e repetidas na tela:
--   * o PERÍODO filtra pela data em que o relato foi REGISTRADO (fuso de
--     Brasília). "Solucionados" = dos relatados no período, quantos já estão
--     resolvidos hoje;
--   * "Respostas enviadas" conta mensagens de resposta ESCRITAS no período;
--   * tempo até a 1ª resposta e até a conclusão usam só quem já chegou lá —
--     relato sem resposta não entra como zero (seria o tempo mais rápido de
--     todos);
--   * relato "aproveitado" = RESOLVIDO (erro corrigido, sugestão implantada,
--     dúvida esclarecida). "Não é defeito" conta como participação, não como
--     aproveitado;
--   * os rankings deixam de fora os relatos do próprio Admin Master: é quem
--     corrige, e entraria sempre em primeiro;
--   * a lista de parados é o que está aberto AGORA, de qualquer data, e não
--     leva o título (texto livre pode citar paciente) — só código, parte do
--     sistema, unidade e idade.
--
-- Idempotente. Só leitura.
-- =============================================================================

create or replace function public.system_reports_dashboard(
  p_de date,
  p_ate date,
  p_clinic_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_rede boolean;
  v_unidades uuid[];
  v_grao text;
  v_passo interval;
  v_admins uuid[];
  v_resultado jsonb;
begin
  if v_user is null then
    raise exception 'NOT_ALLOWED';
  end if;
  if p_de is null or p_ate is null or p_ate < p_de or p_ate - p_de > 3700 then
    raise exception 'INVALID_PERIOD';
  end if;

  v_rede := public.is_admin_master() or exists (
    select 1
      from public.user_clinic_roles ucr
      join public.clinics c on c.id = ucr.clinic_id
     where ucr.user_id = v_user
       and c.type = 'franchisor'
  );

  if v_rede then
    v_unidades := case when p_clinic_id is null then null else array[p_clinic_id] end;
  else
    select array_agg(distinct ucr.clinic_id) into v_unidades
      from public.user_clinic_roles ucr
     where ucr.user_id = v_user
       and ucr.role in ('unit_manager', 'franchisee');

    if v_unidades is null then
      raise exception 'NOT_ALLOWED';
    end if;
    if p_clinic_id is not null then
      if not (p_clinic_id = any (v_unidades)) then
        raise exception 'NOT_ALLOWED';
      end if;
      v_unidades := array[p_clinic_id];
    end if;
  end if;

  -- Semana até ~4 meses; mês daí em diante (26 barras semanais já não se leem).
  v_grao := case when p_ate - p_de > 120 then 'month' else 'week' end;
  v_passo := ('1 ' || v_grao)::interval;

  select coalesce(array_agg(id), '{}') into v_admins
    from public.profiles where is_admin_master;

  with base as (
    select r.*,
           (r.created_at at time zone 'America/Sao_Paulo')::date as dia
      from public.system_reports r
     where (v_unidades is null or r.clinic_id = any (v_unidades))
       and (r.created_at at time zone 'America/Sao_Paulo')::date between p_de and p_ate
  ),
  -- Para os rankings: sem os relatos do Admin Master.
  base_ranking as (
    select * from base where not (reporter_id = any (v_admins))
  )
  select jsonb_build_object(
    'escopo', jsonb_build_object(
      'rede', v_rede,
      'grao', v_grao,
      'unidades', (
        select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'nome', c.name) order by c.name), '[]'::jsonb)
          from public.clinics c
         where (v_rede and c.is_active)
            or (not v_rede and c.id in (
                  select ucr.clinic_id from public.user_clinic_roles ucr
                   where ucr.user_id = v_user and ucr.role in ('unit_manager', 'franchisee')))
      )
    ),

    'totais', (
      select jsonb_build_object(
        'relatos', count(*),
        'erros', count(*) filter (where kind = 'erro'),
        'erros_resolvidos', count(*) filter (where kind = 'erro' and status = 'resolvido'),
        'erros_nao_defeito', count(*) filter (where kind = 'erro' and status = 'nao_e_defeito'),
        'duvidas', count(*) filter (where kind = 'duvida'),
        'duvidas_respondidas', count(*) filter (where kind = 'duvida' and first_response_at is not null),
        'sugestoes', count(*) filter (where kind = 'sugestao'),
        'sugestoes_implantadas', count(*) filter (where kind = 'sugestao' and status = 'resolvido'),
        'sugestoes_recusadas', count(*) filter (where kind = 'sugestao' and status = 'nao_e_defeito'),
        'em_aberto', count(*) filter (where status in ('aberto', 'em_analise')),
        'sem_resposta', count(*) filter (where status in ('aberto', 'em_analise') and first_response_at is null),
        'reabertos', count(*) filter (where reopened_count > 0)
      )
      from base
    ),

    'respostas_enviadas', (
      select count(*)
        from public.system_report_messages m
        join public.system_reports r on r.id = m.report_id
       where m.kind = 'resposta'
         and (v_unidades is null or r.clinic_id = any (v_unidades))
         and (m.created_at at time zone 'America/Sao_Paulo')::date between p_de and p_ate
    ),

    'tempos', (
      select jsonb_build_object(
        'resposta_media_h', (
          select round(avg(extract(epoch from first_response_at - created_at) / 3600)::numeric, 1)
            from base where first_response_at is not null),
        'resposta_mediana_h', (
          select round((percentile_cont(0.5) within group (
                   order by extract(epoch from first_response_at - created_at) / 3600))::numeric, 1)
            from base where first_response_at is not null),
        'respondidos', (select count(*) from base where first_response_at is not null),
        'conclusao_media_h', (
          select round(avg(extract(epoch from closed_at - created_at) / 3600)::numeric, 1)
            from base where closed_at is not null and status in ('resolvido', 'nao_e_defeito')),
        'conclusao_mediana_h', (
          select round((percentile_cont(0.5) within group (
                   order by extract(epoch from closed_at - created_at) / 3600))::numeric, 1)
            from base where closed_at is not null and status in ('resolvido', 'nao_e_defeito')),
        'concluidos', (
          select count(*) from base
           where closed_at is not null and status in ('resolvido', 'nao_e_defeito')),
        -- Encerrados antes da 0256 não têm data de conclusão: ficam de fora da
        -- média, e a tela diz quantos são.
        'concluidos_sem_data', (
          select count(*) from base
           where closed_at is null and status in ('resolvido', 'nao_e_defeito'))
      )
    ),

    'por_modulo', (
      select coalesce(jsonb_agg(x order by x.relatos desc, x.modulo), '[]'::jsonb)
        from (
          select coalesce(module, 'sem') as modulo,
                 count(*) as relatos,
                 count(*) filter (where kind = 'sugestao') as sugestoes,
                 count(*) filter (where kind = 'sugestao' and status = 'resolvido') as implantadas,
                 count(*) filter (where kind = 'erro') as erros,
                 count(*) filter (where kind = 'erro' and status = 'resolvido') as erros_resolvidos,
                 count(*) filter (where kind = 'duvida') as duvidas
            from base
           group by 1
        ) x
    ),

    'por_unidade', (
      select coalesce(jsonb_agg(x order by x.aproveitados desc, x.relatos desc, x.nome), '[]'::jsonb)
        from (
          select b.clinic_id,
                 c.name as nome,
                 count(*) as relatos,
                 count(*) filter (where b.status = 'resolvido') as aproveitados,
                 count(*) filter (where b.kind = 'sugestao') as sugestoes,
                 count(*) filter (where b.kind = 'sugestao' and b.status = 'resolvido') as implantadas,
                 count(distinct b.reporter_id) as pessoas
            from base_ranking b
            join public.clinics c on c.id = b.clinic_id
           group by b.clinic_id, c.name
        ) x
    ),

    -- Só para a rede (decisão do dono): unidade não vê ranking de pessoas.
    'por_pessoa', case when not v_rede then null else (
      select coalesce(jsonb_agg(x order by x.aproveitados desc, x.relatos desc, x.nome), '[]'::jsonb)
        from (
          select b.reporter_id,
                 coalesce(p.full_name, '—') as nome,
                 (array_agg(b.reporter_role order by b.created_at desc))[1] as papel,
                 string_agg(distinct c.name, ', ') as unidades,
                 count(*) as relatos,
                 count(*) filter (where b.status = 'resolvido') as aproveitados,
                 count(*) filter (where b.kind = 'sugestao') as sugestoes,
                 count(*) filter (where b.kind = 'sugestao' and b.status = 'resolvido') as implantadas
            from base_ranking b
            left join public.profiles p on p.id = b.reporter_id
            join public.clinics c on c.id = b.clinic_id
           group by b.reporter_id, p.full_name
           order by aproveitados desc, relatos desc
           limit 10
        ) x
    ) end,

    'parados', (
      select coalesce(jsonb_agg(x order by x.criado_em), '[]'::jsonb)
        from (
          select r.code,
                 r.kind,
                 r.status,
                 coalesce(r.module, 'sem') as modulo,
                 c.name as unidade,
                 r.created_at as criado_em,
                 (r.first_response_at is null) as sem_resposta,
                 r.reopened_count
            from public.system_reports r
            join public.clinics c on c.id = r.clinic_id
           where (v_unidades is null or r.clinic_id = any (v_unidades))
             and r.status in ('aberto', 'em_analise')
           order by r.created_at
           limit 10
        ) x
    ),

    'serie', (
      select coalesce(jsonb_agg(s order by s.inicio), '[]'::jsonb)
        from (
          select g.inicio::date as inicio,
                 (select count(*) from base b
                   where b.dia >= g.inicio::date
                     and b.dia < (g.inicio + v_passo)::date) as relatados,
                 (select count(*) from public.system_reports r
                   where (v_unidades is null or r.clinic_id = any (v_unidades))
                     and r.closed_at is not null
                     and r.status in ('resolvido', 'nao_e_defeito')
                     and (r.closed_at at time zone 'America/Sao_Paulo')::date >= greatest(g.inicio::date, p_de)
                     and (r.closed_at at time zone 'America/Sao_Paulo')::date < (g.inicio + v_passo)::date
                     and (r.closed_at at time zone 'America/Sao_Paulo')::date <= p_ate) as concluidos
            from generate_series(
                   date_trunc(v_grao, p_de::timestamp),
                   p_ate::timestamp,
                   v_passo
                 ) as g(inicio)
        ) s
    )
  )
  into v_resultado
  from (select 1) as um;

  return v_resultado;
end;
$$;

comment on function public.system_reports_dashboard(date, date, uuid) is
  'Painel de indicadores dos relatos. Escopo decidido aqui: Admin/Franqueadora = rede (com ranking de pessoas); Gerente/Franqueado = as próprias unidades (sem ranking de pessoas); demais = NOT_ALLOWED.';

revoke all on function public.system_reports_dashboard(date, date, uuid) from public;
grant execute on function public.system_reports_dashboard(date, date, uuid) to authenticated;

-- =============================================================================
-- 2008 — Indica +Risos (IND5): painel, antifraude e relatórios
-- -----------------------------------------------------------------------------
-- Decisões do dono (28/09/2026):
--   * CUSTO do programa aparece de DOIS jeitos, lado a lado:
--       gerado    = Riso Coins que o programa deu (líquido de estornos) ×
--                   valor do Riso Coin + prêmios de equipe aprovados;
--       realizado = resgates ENTREGUES (valor do item) + prêmios aprovados.
--   * Alerta de fraude ALTO em aberto SEGURA os resgates do Embaixador (novo
--     pedido, aprovação e entrega) até a franqueadora analisar. Os pontos
--     continuam contando.
--   * Planilha exportada SEM contato do indicado (a tela cuida; aqui nada sai
--     com telefone, CPF ou e-mail).
--
-- Tudo aqui devolve NÚMEROS agregados, e nomes só de Embaixadores e
-- Risartanos (que a equipe já enxerga). Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Parâmetros
-- -----------------------------------------------------------------------------
insert into indica.config (escopo, unidade_id, grupo, chave, valor, travado, descricao, vigente_desde)
values
  ('rede', null, 'antifraude', 'fraude_conluio_minimo_indicacoes', '4', true,
   'Mínimo de indicações do Embaixador (na janela) para medir concentração num Risartano.', '2026-01-01 00:00-03'),
  ('rede', null, 'antifraude', 'fraude_janela_meses', '12', true,
   'Janela (meses) das regras de mesmo contato, conluio e ciclo fechado.', '2026-01-01 00:00-03'),
  ('rede', null, 'antifraude', 'fraude_tardio_janela_dias', '90', true,
   'Atendimento do indicado até N dias ANTES do registro da indicação = registro tardio.', '2026-01-01 00:00-03'),
  ('rede', null, 'antifraude', 'fraude_severidades',
   '{"volume":"media","contato_embaixador":"alta","contato_repetido":"media","registro_tardio":"alta","conluio":"media","ciclo_fechado":"alta","ajustes":"media"}',
   true,
   'Severidade de cada regra (baixa, media, alta). Alerta ALTO em aberto segura os resgates do Embaixador.',
   '2026-01-01 00:00-03'),
  ('rede', null, 'painel', 'acoes_parada_dias', '3', false,
   'Dias sem movimento para a indicação aparecer em "Ações do dia".', '2026-01-01 00:00-03')
on conflict on constraint config_versao_unica do nothing;

-- -----------------------------------------------------------------------------
-- 2) Alertas: chave (sem repetição), motivo e quem (regra de ajustes/conluio)
-- -----------------------------------------------------------------------------
alter table indica.alertas_fraude
  add column if not exists chave text,
  add column if not exists motivo text,
  add column if not exists usuario_id uuid references public.profiles (id);
-- Um fato vira UM alerta, para sempre: decidido improcedente, não volta.
create unique index if not exists alertas_fraude_chave_uq
  on indica.alertas_fraude (chave) where chave is not null;
create index if not exists alertas_fraude_embaixador_idx
  on indica.alertas_fraude (embaixador_id) where status in ('aberto', 'em_analise');

-- -----------------------------------------------------------------------------
-- 3) Alerta ALTO em aberto segura os resgates (novo, aprovar, entregar)
-- -----------------------------------------------------------------------------
create or replace function indica.resgate_segura_por_alerta()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (tg_op = 'INSERT'
      or (new.status is distinct from old.status and new.status in ('aprovado', 'entregue')))
     and exists (select 1 from indica.alertas_fraude a
                  where a.embaixador_id = new.embaixador_id
                    and a.severidade = 'alta'
                    and a.status in ('aberto', 'em_analise')) then
    raise exception 'INDICA_RESGATE_EM_ANALISE: os resgates deste Embaixador estão em análise pela franqueadora. Fale com a unidade.';
  end if;
  return new;
end;
$$;
drop trigger if exists resgates_segura_por_alerta on indica.resgates;
create trigger resgates_segura_por_alerta
  before insert or update on indica.resgates
  for each row execute function indica.resgate_segura_por_alerta();

-- -----------------------------------------------------------------------------
-- 4) As regras antifraude (rotina diária; a franqueadora pode rodar na hora)
-- -----------------------------------------------------------------------------
create or replace function indica.detectar_fraudes()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_sev jsonb := indica.config_valor('fraude_severidades');
  v_vmax integer := indica.config_numero('fraude_volume_max_indicacoes')::integer;
  v_vjan integer := indica.config_numero('fraude_volume_janela_dias')::integer;
  v_cpct numeric := indica.config_numero('fraude_conluio_percentual');
  v_cmin integer := indica.config_numero('fraude_conluio_minimo_indicacoes')::integer;
  v_amax integer := indica.config_numero('fraude_ajustes_mes_max')::integer;
  v_jm integer := indica.config_numero('fraude_janela_meses')::integer;
  v_tard integer := indica.config_numero('fraude_tardio_janela_dias')::integer;
  v_semana text := to_char(now() at time zone 'America/Sao_Paulo', 'IYYY-IW');
  v_mes text := to_char(now() at time zone 'America/Sao_Paulo', 'YYYY-MM');
  v_inicio_mes timestamptz := date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
  n integer;
  v_res jsonb := '{}'::jsonb;
begin
  if v_uid is not null and not indica.eh_franqueadora() then
    raise exception 'INDICA_SEM_PERMISSAO: a conferência antifraude é da franqueadora.';
  end if;

  -- (a) Volume atípico: mais de N indicações do mesmo Embaixador na janela.
  insert into indica.alertas_fraude (chave, regra, severidade, embaixador_id, unidade_id, detalhes)
  select 'volume:' || i.embaixador_id || ':' || v_semana, 'volume',
         coalesce(v_sev ->> 'volume', 'media'), i.embaixador_id,
         (array_agg(i.unidade_id order by i.registrada_em desc))[1],
         jsonb_build_object('indicacoes', count(*), 'janela_dias', v_vjan, 'limite', v_vmax)
    from indica.indicacoes i
   where i.embaixador_id is not null and i.registrada_em >= now() - make_interval(days => v_vjan)
   group by i.embaixador_id
  having count(*) > v_vmax
  on conflict (chave) where chave is not null do nothing;
  get diagnostics n = row_count;
  v_res := v_res || jsonb_build_object('volume', n);

  -- (b) Mesmo contato: e-mail do indicado = e-mail do Embaixador.
  insert into indica.alertas_fraude (chave, regra, severidade, indicacao_id, embaixador_id, unidade_id, detalhes)
  select 'contato_embaixador:' || i.id, 'contato_embaixador',
         coalesce(v_sev ->> 'contato_embaixador', 'alta'), i.id, i.embaixador_id, i.unidade_id,
         jsonb_build_object('codigo', i.codigo, 'campo', 'e-mail')
    from indica.indicacoes i
    join indica.embaixadores e on e.id = i.embaixador_id
    join public.clients c on c.id = e.cliente_id
   where i.registrada_em >= now() - make_interval(months => v_jm)
     and nullif(btrim(i.indicado_email), '') is not null
     and lower(btrim(i.indicado_email)) = lower(btrim(c.email))
  on conflict (chave) where chave is not null do nothing;
  get diagnostics n = row_count;
  v_res := v_res || jsonb_build_object('contato_embaixador', n);

  -- (c) Mesmo contato: telefone igual ao de indicação de OUTRO Embaixador.
  insert into indica.alertas_fraude (chave, regra, severidade, indicacao_id, embaixador_id, unidade_id, detalhes)
  select 'contato_repetido:' || i.id, 'contato_repetido',
         coalesce(v_sev ->> 'contato_repetido', 'media'), i.id, i.embaixador_id, i.unidade_id,
         jsonb_build_object('codigo', i.codigo,
           'outras', (select jsonb_agg(j.codigo) from indica.indicacoes j
                       where j.id <> i.id and j.embaixador_id is distinct from i.embaixador_id
                         and j.indicado_telefone_digitos = i.indicado_telefone_digitos
                         and j.registrada_em >= now() - make_interval(months => v_jm)))
    from indica.indicacoes i
   where i.embaixador_id is not null
     and i.indicado_telefone_digitos is not null
     and i.registrada_em >= now() - make_interval(months => v_jm)
     and exists (select 1 from indica.indicacoes j
                  where j.id <> i.id and j.embaixador_id is distinct from i.embaixador_id
                    and j.indicado_telefone_digitos = i.indicado_telefone_digitos
                    and j.registrada_em >= now() - make_interval(months => v_jm))
  on conflict (chave) where chave is not null do nothing;
  get diagnostics n = row_count;
  v_res := v_res || jsonb_build_object('contato_repetido', n);

  -- (d) Registro tardio: o indicado já tinha sido atendido (check-in) antes da
  --     indicação existir, dentro da janela.
  insert into indica.alertas_fraude (chave, regra, severidade, indicacao_id, embaixador_id, unidade_id, detalhes)
  select 'registro_tardio:' || i.id, 'registro_tardio',
         coalesce(v_sev ->> 'registro_tardio', 'alta'), i.id, i.embaixador_id, i.unidade_id,
         jsonb_build_object('codigo', i.codigo, 'primeiro_atendimento', min(a.checked_in_at),
                            'registrada_em', i.registrada_em)
    from indica.indicacoes i
    join public.appointments a
      on a.client_id = i.cliente_indicado_id
     and a.checked_in_at is not null
     and a.checked_in_at < i.registrada_em
     and a.checked_in_at >= i.registrada_em - make_interval(days => v_tard)
     and coalesce(a.attendance::text, '') <> 'gave_up'
   where i.cliente_indicado_id is not null
     and i.registrada_em >= now() - make_interval(months => v_jm)
   group by i.id, i.codigo, i.embaixador_id, i.unidade_id, i.registrada_em
  on conflict (chave) where chave is not null do nothing;
  get diagnostics n = row_count;
  v_res := v_res || jsonb_build_object('registro_tardio', n);

  -- (e) Conluio: um Risartano concentra mais de X% das indicações de um
  --     Embaixador (com amostra mínima).
  insert into indica.alertas_fraude (chave, regra, severidade, embaixador_id, unidade_id, usuario_id, detalhes)
  select 'conluio:' || b.embaixador_id || ':' || b.risartano_origem_id, 'conluio',
         coalesce(v_sev ->> 'conluio', 'media'), b.embaixador_id, b.unidade_id, b.risartano_origem_id,
         jsonb_build_object('indicacoes_do_risartano', b.n, 'indicacoes_do_embaixador', t.total,
                            'percentual', round(100.0 * b.n / t.total, 1), 'limite', v_cpct)
    from (select embaixador_id, risartano_origem_id, count(*) as n,
                 (array_agg(unidade_id order by registrada_em desc))[1] as unidade_id
            from indica.indicacoes
           where embaixador_id is not null and risartano_origem_id is not null
             and registrada_em >= now() - make_interval(months => v_jm)
           group by embaixador_id, risartano_origem_id) b
    join (select embaixador_id, count(*) as total
            from indica.indicacoes
           where embaixador_id is not null
             and registrada_em >= now() - make_interval(months => v_jm)
           group by embaixador_id) t on t.embaixador_id = b.embaixador_id
   where t.total >= v_cmin and 100.0 * b.n / t.total > v_cpct
  on conflict (chave) where chave is not null do nothing;
  get diagnostics n = row_count;
  v_res := v_res || jsonb_build_object('conluio', n);

  -- (f) Ciclo fechado: o indicado virou Embaixador e indicou de volta quem o
  --     indicou (pelo cadastro ou pelo telefone).
  insert into indica.alertas_fraude (chave, regra, severidade, indicacao_id, embaixador_id, unidade_id, detalhes)
  select 'ciclo_fechado:' || j.id, 'ciclo_fechado',
         coalesce(v_sev ->> 'ciclo_fechado', 'alta'), j.id, j.embaixador_id, j.unidade_id,
         jsonb_build_object('codigo', j.codigo, 'indicacao_de_ida', i.codigo)
    from indica.indicacoes i
    join indica.embaixadores ei on ei.id = i.embaixador_id
    join public.clients ci on ci.id = ei.cliente_id
    join indica.embaixadores ej on ej.cliente_id = i.cliente_indicado_id
    join indica.indicacoes j on j.embaixador_id = ej.id
   where j.registrada_em >= now() - make_interval(months => v_jm)
     and (j.cliente_indicado_id = ei.cliente_id
          or j.indicado_telefone_digitos = nullif(regexp_replace(coalesce(ci.phone, ''), '\D', '', 'g'), ''))
  on conflict (chave) where chave is not null do nothing;
  get diagnostics n = row_count;
  v_res := v_res || jsonb_build_object('ciclo_fechado', n);

  -- (g) Ajustes manuais: mais de N pelo mesmo usuário no mês.
  insert into indica.alertas_fraude (chave, regra, severidade, usuario_id, detalhes)
  select 'ajustes:' || l.criado_por || ':' || v_mes, 'ajustes',
         coalesce(v_sev ->> 'ajustes', 'media'), l.criado_por,
         jsonb_build_object('ajustes', count(*), 'mes', v_mes, 'limite', v_amax,
                            'riso_coins', sum(l.riso_coins))
    from indica.pontos_lancamentos l
   where l.tipo = 'ajuste' and l.criado_por is not null and l.criado_em >= v_inicio_mes
   group by l.criado_por
  having count(*) > v_amax
  on conflict (chave) where chave is not null do nothing;
  get diagnostics n = row_count;
  v_res := v_res || jsonb_build_object('ajustes', n);

  insert into indica.rotinas_execucoes (resultado)
  values (jsonb_build_object('rotina', 'antifraude') || v_res);
  return v_res;
end;
$$;

-- A franqueadora analisa: em análise → procedente / improcedente (com motivo).
create or replace function indica.tratar_alerta(p_id uuid, p_status text, p_motivo text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  a indica.alertas_fraude;
begin
  if v_uid is not null and not indica.eh_franqueadora() then
    raise exception 'INDICA_SEM_PERMISSAO: quem analisa alerta é a franqueadora.';
  end if;
  if p_status not in ('em_analise', 'procedente', 'improcedente') then
    raise exception 'INDICA_DADOS: situação inválida para o alerta.';
  end if;
  select * into a from indica.alertas_fraude where id = p_id for update;
  if not found then
    raise exception 'INDICA_NAO_ENCONTRADO: alerta não encontrado.';
  end if;
  if a.status in ('procedente', 'improcedente') then
    raise exception 'INDICA_TRANSICAO_INVALIDA: este alerta já foi decidido.';
  end if;
  if p_status <> 'em_analise' and length(btrim(coalesce(p_motivo, ''))) < 3 then
    raise exception 'INDICA_MOTIVO_OBRIGATORIO: informe o que foi apurado.';
  end if;
  update indica.alertas_fraude
     set status = p_status,
         motivo = coalesce(nullif(btrim(p_motivo), ''), motivo),
         resolvido_por = case when p_status = 'em_analise' then null else v_uid end,
         resolvido_em = case when p_status = 'em_analise' then null else now() end
   where id = p_id;
  if v_uid is not null then
    insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
    values (v_uid, a.unidade_id, 'update', 'indica_alerta', p_id::text,
            jsonb_build_object('regra', a.regra, 'status', p_status));
  end if;
  return p_status;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5) Indicadores de um recorte (período, unidade, campanha)
-- -----------------------------------------------------------------------------
-- p_campanha = '00000000-0000-0000-0000-000000000000' → indicações SEM campanha.
-- Taxas por COORTE: das indicações registradas no período, quantas chegaram.
-- Conversões e receita pelo FECHAMENTO no período (como as metas).
create or replace function indica._indicadores(
  p_de timestamptz,
  p_ate timestamptz,
  p_unidade uuid,
  p_campanha uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_sem constant uuid := '00000000-0000-0000-0000-000000000000';
  v_valor numeric := indica.config_numero('valor_riso_coin_centavos');
  r record;
  v_coins bigint;
  v_premios bigint;
  v_resgates bigint;
  v_novos integer;
  v_novos_ind integer;
  v_gerado bigint;
  v_realizado bigint;
begin
  select count(*) filter (where i.registrada_em >= p_de and i.registrada_em < p_ate) as registradas,
         count(*) filter (where i.registrada_em >= p_de and i.registrada_em < p_ate and i.compareceu_em is not null) as compareceram,
         count(*) filter (where i.registrada_em >= p_de and i.registrada_em < p_ate and i.fechou_em is not null) as fecharam,
         count(*) filter (where i.registrada_em >= p_de and i.registrada_em < p_ate and i.status = 'convertida') as convertidas_coorte,
         count(*) filter (where i.status = 'convertida' and i.fechou_em >= p_de and i.fechou_em < p_ate) as conversoes,
         coalesce(sum(i.valor_fechado_centavos) filter (
           where i.status in ('fechou', 'convertida') and i.fechou_em >= p_de and i.fechou_em < p_ate), 0) as receita
    into r
    from indica.indicacoes i
   where (p_unidade is null or i.unidade_id = p_unidade)
     and (p_campanha is null
          or (p_campanha = v_sem and i.campanha_id is null)
          or i.campanha_id = p_campanha);

  -- Custo GERADO: Riso Coins lançados no período (líquido de estornos e ajustes).
  select coalesce(sum(l.riso_coins), 0)
    into v_coins
    from indica.pontos_lancamentos l
    left join indica.indicacoes i on i.id = l.indicacao_id
   where l.criado_em >= p_de and l.criado_em < p_ate
     and l.tipo in ('pendente', 'credito', 'carencia', 'estorno', 'ajuste')
     and (p_unidade is null or coalesce(l.unidade_custo_id, i.unidade_id) = p_unidade)
     and (p_campanha is null
          or (p_campanha = v_sem and l.indicacao_id is not null and i.campanha_id is null)
          or i.campanha_id = p_campanha);

  -- Prêmios de equipe aprovados no período (dinheiro, voucher e experiência).
  select coalesce(sum((p ->> 'valor_centavos')::bigint), 0)
    into v_premios
    from indica.apuracoes a
    join indica.metas_equipe m on m.id = a.meta_id
    cross join lateral jsonb_array_elements(a.premios) x
    cross join lateral (select x -> 'premio' as p) pp
   where a.status in ('aprovada', 'paga') and a.aprovado_em >= p_de and a.aprovado_em < p_ate
     and (p_unidade is null or m.unidade_id = p_unidade)
     and (p_campanha is null
          or (p_campanha = v_sem and m.campanha_id is null)
          or m.campanha_id = p_campanha);

  -- Custo REALIZADO: resgates entregues no período (resgate não é de campanha).
  if p_campanha is null then
    select coalesce(sum(coalesce(g.valor_centavos, round(g.riso_coins * v_valor)::bigint)), 0)
      into v_resgates
      from indica.resgates g
     where g.status = 'entregue' and g.entregue_em >= p_de and g.entregue_em < p_ate
       and (p_unidade is null or g.unidade_id = p_unidade);
  end if;

  -- Clientes novos no período e quantos vieram de indicação.
  select count(*),
         count(*) filter (where exists (
           select 1 from indica.indicacoes i
            where i.cliente_indicado_id = c.id
              and (p_campanha is null
                   or (p_campanha = v_sem and i.campanha_id is null)
                   or i.campanha_id = p_campanha)))
    into v_novos, v_novos_ind
    from public.clients c
    join public.clinics k on k.id = c.clinic_id and k.type = 'franchise_unit'
   where c.created_at >= p_de and c.created_at < p_ate
     and (p_unidade is null or c.clinic_id = p_unidade);

  v_gerado := round(v_coins * v_valor)::bigint + v_premios;
  v_realizado := case when v_resgates is null then null else v_resgates + v_premios end;

  return jsonb_build_object(
    'registradas', r.registradas,
    'compareceram', r.compareceram,
    'fecharam', r.fecharam,
    'convertidas_coorte', r.convertidas_coorte,
    'conversoes', r.conversoes,
    'receita_centavos', r.receita,
    'taxa_comparecimento', case when r.registradas > 0 then round(100.0 * r.compareceram / r.registradas, 1) end,
    'taxa_fechamento', case when r.compareceram > 0 then round(100.0 * r.fecharam / r.compareceram, 1) end,
    'clientes_novos', v_novos,
    'clientes_novos_indicacao', v_novos_ind,
    'percentual_novos_indicacao', case when v_novos > 0 then round(100.0 * v_novos_ind / v_novos, 1) end,
    'riso_coins_gerados', v_coins,
    'premios_equipe_centavos', v_premios,
    'custo_gerado_centavos', v_gerado,
    'custo_realizado_centavos', v_realizado,
    'cac_gerado_centavos', case when r.conversoes > 0 then round(v_gerado::numeric / r.conversoes) end,
    'cac_realizado_centavos', case when r.conversoes > 0 and v_realizado is not null then round(v_realizado::numeric / r.conversoes) end,
    'roi_gerado', case when v_gerado > 0 then round((r.receita - v_gerado)::numeric / v_gerado, 2) end,
    'roi_realizado', case when v_realizado > 0 then round((r.receita - v_realizado)::numeric / v_realizado, 2) end
  );
end;
$$;

-- Guarda comum: rede inteira = franqueadora; uma unidade = quem é dela.
create or replace function indica._pode_ver_recorte(p_unidade uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is null
      or (p_unidade is null and indica.eh_franqueadora())
      or (p_unidade is not null and indica.eh_risartano(p_unidade));
$$;

-- -----------------------------------------------------------------------------
-- 6) O painel do programa
-- -----------------------------------------------------------------------------
create or replace function indica.painel(
  p_de date,
  p_ate date,
  p_unidade uuid default null,
  p_campanha uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_de timestamptz := p_de::timestamp at time zone 'America/Sao_Paulo';
  v_ate timestamptz := (p_ate + 1)::timestamp at time zone 'America/Sao_Paulo';
  v_dur interval;
  v_parada integer := indica.config_numero('acoes_parada_dias', p_unidade)::integer;
  v_atual jsonb;
  v_anterior jsonb;
  v_evolucao jsonb;
  v_top_emb jsonb;
  v_top_ris jsonb;
  v_paradas jsonb;
  v_acoes jsonb;
begin
  if p_ate < p_de then
    raise exception 'INDICA_DADOS: o fim do período precisa ser depois do começo.';
  end if;
  if not indica._pode_ver_recorte(p_unidade) then
    raise exception 'INDICA_SEM_PERMISSAO: a rede inteira é da franqueadora; escolha a sua unidade.';
  end if;
  v_dur := v_ate - v_de;
  v_atual := indica._indicadores(v_de, v_ate, p_unidade, p_campanha);
  v_anterior := indica._indicadores(v_de - v_dur, v_de, p_unidade, p_campanha);

  -- Evolução: 12 meses terminando no mês do fim do período.
  select jsonb_agg(jsonb_build_object(
           'mes', to_char(m.mes, 'YYYY-MM'),
           'conversoes', (select count(*) from indica.indicacoes i
                           where i.status = 'convertida'
                             and i.fechou_em >= (m.mes::timestamp at time zone 'America/Sao_Paulo')
                             and i.fechou_em < ((m.mes + interval '1 month')::timestamp at time zone 'America/Sao_Paulo')
                             and (p_unidade is null or i.unidade_id = p_unidade)
                             and (p_campanha is null or i.campanha_id = p_campanha)),
           'receita_centavos', (select coalesce(sum(i.valor_fechado_centavos), 0) from indica.indicacoes i
                           where i.status in ('fechou', 'convertida')
                             and i.fechou_em >= (m.mes::timestamp at time zone 'America/Sao_Paulo')
                             and i.fechou_em < ((m.mes + interval '1 month')::timestamp at time zone 'America/Sao_Paulo')
                             and (p_unidade is null or i.unidade_id = p_unidade)
                             and (p_campanha is null or i.campanha_id = p_campanha)),
           'registradas', (select count(*) from indica.indicacoes i
                           where i.registrada_em >= (m.mes::timestamp at time zone 'America/Sao_Paulo')
                             and i.registrada_em < ((m.mes + interval '1 month')::timestamp at time zone 'America/Sao_Paulo')
                             and (p_unidade is null or i.unidade_id = p_unidade)
                             and (p_campanha is null or i.campanha_id = p_campanha))
         ) order by m.mes)
    into v_evolucao
    from generate_series(date_trunc('month', p_ate) - interval '11 months', date_trunc('month', p_ate), interval '1 month') as m(mes);

  -- Destaques do período: Embaixadores e Risartanos.
  select coalesce(jsonb_agg(x order by x.conversoes desc, x.indicacoes desc, x.nome), '[]'::jsonb)
    into v_top_emb
    from (select e.id, e.codigo, c.full_name as nome,
                 count(*) filter (where i.registrada_em >= v_de and i.registrada_em < v_ate) as indicacoes,
                 count(*) filter (where i.status = 'convertida' and i.fechou_em >= v_de and i.fechou_em < v_ate) as conversoes
            from indica.indicacoes i
            join indica.embaixadores e on e.id = i.embaixador_id
            join public.clients c on c.id = e.cliente_id
           where (p_unidade is null or i.unidade_id = p_unidade)
             and (p_campanha is null or i.campanha_id = p_campanha)
             and ((i.registrada_em >= v_de and i.registrada_em < v_ate) or (i.fechou_em >= v_de and i.fechou_em < v_ate))
           group by e.id, e.codigo, c.full_name
           order by 5 desc, 4 desc
           limit 5) x;

  select coalesce(jsonb_agg(x order by x.conversoes desc, x.indicacoes desc, x.nome), '[]'::jsonb)
    into v_top_ris
    from (select p.id, p.full_name as nome,
                 count(*) filter (where i.registrada_em >= v_de and i.registrada_em < v_ate) as indicacoes,
                 count(*) filter (where i.status = 'convertida' and i.fechou_em >= v_de and i.fechou_em < v_ate) as conversoes
            from indica.indicacoes i
            join public.profiles p on p.id = i.risartano_origem_id
           where (p_unidade is null or i.unidade_id = p_unidade)
             and (p_campanha is null or i.campanha_id = p_campanha)
             and ((i.registrada_em >= v_de and i.registrada_em < v_ate) or (i.fechou_em >= v_de and i.fechou_em < v_ate))
           group by p.id, p.full_name
           order by 4 desc, 3 desc
           limit 5) x;

  -- Ações do dia (sempre "agora", independem do período).
  select coalesce(jsonb_agg(x order by x.dias desc), '[]'::jsonb)
    into v_paradas
    from (select i.id, i.codigo, i.status,
                 split_part(btrim(i.indicado_nome), ' ', 1) as indicado,
                 (now()::date - coalesce((select max(ev.criado_em) from indica.indicacao_eventos ev
                                          where ev.indicacao_id = i.id), i.registrada_em)::date) as dias
            from indica.indicacoes i
           where i.status in ('registrada', 'validada', 'faltou', 'nao_fechou')
             and (p_unidade is null or i.unidade_id = p_unidade)
             and coalesce((select max(ev.criado_em) from indica.indicacao_eventos ev where ev.indicacao_id = i.id),
                          i.registrada_em) < now() - make_interval(days => v_parada)
           order by 5 desc
           limit 10) x;

  v_acoes := jsonb_build_object(
    'parada_dias', v_parada,
    'paradas', v_paradas,
    'paradas_total', (select count(*) from indica.indicacoes i
                       where i.status in ('registrada', 'validada', 'faltou', 'nao_fechou')
                         and (p_unidade is null or i.unidade_id = p_unidade)
                         and coalesce((select max(ev.criado_em) from indica.indicacao_eventos ev where ev.indicacao_id = i.id),
                                      i.registrada_em) < now() - make_interval(days => v_parada)),
    'faltaram', (select count(*) from indica.indicacoes i
                  where i.status = 'faltou' and (p_unidade is null or i.unidade_id = p_unidade)),
    'resgates_aguardando', (select count(*) from indica.resgates g
                             where g.status in ('solicitado', 'aprovado')
                               and (p_unidade is null or g.unidade_id = p_unidade)),
    'embaixadores_a_vencer', (select count(*) from indica.v_saldo_embaixador s
                               join indica.embaixadores e on e.id = s.embaixador_id
                              where s.a_vencer_30_dias > 0
                                and (p_unidade is null or e.unidade_cadastro_id = p_unidade)),
    'alertas_abertos', (select count(*) from indica.alertas_fraude a
                         where a.status in ('aberto', 'em_analise')
                           and (p_unidade is null or a.unidade_id = p_unidade))
  );

  return jsonb_build_object(
    'atual', v_atual,
    'anterior', v_anterior,
    'anterior_de', to_char((v_de - v_dur) at time zone 'America/Sao_Paulo', 'YYYY-MM-DD'),
    'evolucao', coalesce(v_evolucao, '[]'::jsonb),
    'top_embaixadores', v_top_emb,
    'top_risartanos', v_top_ris,
    'acoes', v_acoes
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- 7) Relatórios: ROI por unidade ou por campanha; coortes por mês
-- -----------------------------------------------------------------------------
create or replace function indica.relatorio_roi(
  p_de date,
  p_ate date,
  p_agrupar text,
  p_unidade uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_de timestamptz := p_de::timestamp at time zone 'America/Sao_Paulo';
  v_ate timestamptz := (p_ate + 1)::timestamp at time zone 'America/Sao_Paulo';
  v_linhas jsonb := '[]'::jsonb;
  g record;
begin
  if p_agrupar not in ('unidade', 'campanha') then
    raise exception 'INDICA_DADOS: agrupe por unidade ou por campanha.';
  end if;
  if not indica._pode_ver_recorte(p_unidade) then
    raise exception 'INDICA_SEM_PERMISSAO: a rede inteira é da franqueadora; escolha a sua unidade.';
  end if;
  if p_agrupar = 'unidade' then
    for g in
      select k.id, k.name from public.clinics k
       where k.type = 'franchise_unit' and k.is_active
         and (p_unidade is null or k.id = p_unidade)
       order by k.name
    loop
      v_linhas := v_linhas || jsonb_build_array(
        jsonb_build_object('grupo_id', g.id, 'grupo', g.name) || indica._indicadores(v_de, v_ate, g.id, null));
    end loop;
  else
    for g in
      select c.id, c.nome from indica.campanhas c
       where c.status <> 'rascunho' and c.inicio < v_ate and c.fim >= v_de
         and (p_unidade is null or c.escopo = 'rede' or p_unidade = any (c.unidades))
      union all
      select '00000000-0000-0000-0000-000000000000'::uuid, 'Sem campanha'
    loop
      v_linhas := v_linhas || jsonb_build_array(
        jsonb_build_object('grupo_id', g.id, 'grupo', g.nome) || indica._indicadores(v_de, v_ate, p_unidade, g.id));
    end loop;
  end if;
  return jsonb_build_object(
    'linhas', v_linhas,
    'total', indica._indicadores(v_de, v_ate, p_unidade, null)
  );
end;
$$;

-- Coortes: das indicações REGISTRADAS em cada mês, até onde chegaram hoje.
create or replace function indica.coortes(p_de date, p_ate date, p_unidade uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_res jsonb;
begin
  if not indica._pode_ver_recorte(p_unidade) then
    raise exception 'INDICA_SEM_PERMISSAO: a rede inteira é da franqueadora; escolha a sua unidade.';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'mes', x.mes,
           'registradas', x.registradas,
           'compareceram', x.compareceram,
           'fecharam', x.fecharam,
           'convertidas', x.convertidas,
           'perdidas', x.perdidas,
           'em_andamento', x.registradas - x.convertidas - x.perdidas,
           'receita_centavos', x.receita,
           'taxa_conversao', case when x.registradas > 0 then round(100.0 * x.convertidas / x.registradas, 1) end
         ) order by x.mes), '[]'::jsonb)
    into v_res
    from (select to_char(i.registrada_em at time zone 'America/Sao_Paulo', 'YYYY-MM') as mes,
                 count(*) as registradas,
                 count(*) filter (where i.compareceu_em is not null) as compareceram,
                 count(*) filter (where i.fechou_em is not null) as fecharam,
                 count(*) filter (where i.status = 'convertida') as convertidas,
                 count(*) filter (where i.status in ('recusada', 'expirada', 'cancelada', 'nao_fechou')) as perdidas,
                 coalesce(sum(i.valor_fechado_centavos) filter (where i.status in ('fechou', 'convertida')), 0) as receita
            from indica.indicacoes i
           where i.registrada_em >= (p_de::timestamp at time zone 'America/Sao_Paulo')
             and i.registrada_em < ((p_ate + 1)::timestamp at time zone 'America/Sao_Paulo')
             and (p_unidade is null or i.unidade_id = p_unidade)
           group by 1) x;
  return v_res;
end;
$$;

-- -----------------------------------------------------------------------------
-- 8) Rotina antifraude (pg_cron 02:50 BRT)
-- -----------------------------------------------------------------------------
do $$
begin
  create extension if not exists pg_cron;
  begin
    perform cron.unschedule('indica-rotina-antifraude');
  exception when others then
    null;
  end;
  perform cron.schedule('indica-rotina-antifraude', '50 5 * * *', 'select indica.detectar_fraudes()');
exception when others then
  raise warning 'INDICA: não foi possível agendar a rotina antifraude (pg_cron): %', sqlerrm;
end;
$$;

-- -----------------------------------------------------------------------------
-- 9) Permissões (AP15)
-- -----------------------------------------------------------------------------
revoke execute on function indica.resgate_segura_por_alerta() from public, anon, authenticated;
revoke execute on function indica.detectar_fraudes() from public, anon, authenticated;
revoke execute on function indica.tratar_alerta(uuid, text, text) from public, anon, authenticated;
revoke execute on function indica._indicadores(timestamptz, timestamptz, uuid, uuid) from public, anon, authenticated;
revoke execute on function indica._pode_ver_recorte(uuid) from public, anon, authenticated;
revoke execute on function indica.painel(date, date, uuid, uuid) from public, anon, authenticated;
revoke execute on function indica.relatorio_roi(date, date, text, uuid) from public, anon, authenticated;
revoke execute on function indica.coortes(date, date, uuid) from public, anon, authenticated;

grant execute on function indica.detectar_fraudes() to authenticated, service_role;
grant execute on function indica.tratar_alerta(uuid, text, text) to authenticated, service_role;
grant execute on function indica.painel(date, date, uuid, uuid) to authenticated, service_role;
grant execute on function indica.relatorio_roi(date, date, text, uuid) to authenticated, service_role;
grant execute on function indica.coortes(date, date, uuid) to authenticated, service_role;

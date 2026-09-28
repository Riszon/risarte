-- =============================================================================
-- 2007 — Indica +Risos (IND4): motor de campanhas e metas da equipe
-- -----------------------------------------------------------------------------
-- Decisões do dono (28/09/2026):
--   * Metas nascem com os VALORES DE 2025 como modelo (25/40/50/55 conversões;
--     R$ 500/1.000/1.500 recepção-CRC; voucher R$ 100/200/300 demais) — o
--     gestor ajusta por unidade antes de ativar. Parâmetro `metas_faixas_padrao`.
--   * Prêmio em DINHEIRO aprovado = só RELATÓRIO para a folha por ora (o
--     contador ainda valida reflexo trabalhista). Nada vai ao Financeiro.
--   * Campanha entra AUTOMÁTICA na indicação: a ativa que vale para a unidade
--     e o público, e havendo mais de uma, a MAIS VANTAJOSA para o Embaixador —
--     sem somar multiplicadores.
--   * Público com SEGMENTOS já: níveis, especialidade do tratamento do
--     Embaixador (procedimentos das vendas dele) e empresa do Empresarial.
--
-- Campanha (campo `regras`):
--   multiplicador               número >= 1
--   pontos_extra                {registro, comparecimento, fechamento}
--   marcos                      [{conversoes: 3, bonus: 300}, …] — bônus quando
--                               o Embaixador chega à N-ª conversão NA campanha
-- Campanha (campo `publico`):   {niveis: [...], especialidades: [...], empresas: [...]}
--                               lista vazia/ausente = todos
-- Campanha (`especialidade`):   especialidade-ALVO — a vantagem da campanha no
--                               FECHAMENTO só vale se a venda do indicado tem
--                               procedimento dessa especialidade
--
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Parâmetros
-- -----------------------------------------------------------------------------
insert into indica.config (escopo, unidade_id, grupo, chave, valor, travado, descricao, vigente_desde)
values
  ('rede', null, 'campanhas', 'valor_riso_coin_centavos', '10', true,
   'Quanto vale 1 Riso Coin em centavos, para orçamento e simulador (1.000 = R$ 100 → 10).', '2026-01-01 00:00-03'),
  ('rede', null, 'campanhas', 'campanha_alerta_orcamento_percentual', '80', true,
   '% do orçamento da campanha que dispara o alerta.', '2026-01-01 00:00-03'),
  ('rede', null, 'equipe', 'metas_trava_qualidade_padrao', '50', false,
   'Comparecimento mínimo (%) das indicações do período para a faixa da meta ser paga.', '2026-01-01 00:00-03'),
  ('rede', null, 'equipe', 'metas_faixas_padrao',
   '[{"nome":"Meta 1","gatilho":25,"premios":{"recepcao_crc":{"tipo":"dinheiro","valor_centavos":50000},"demais":{"tipo":"voucher","valor_centavos":10000}}},
     {"nome":"Meta 2","gatilho":40,"premios":{"recepcao_crc":{"tipo":"dinheiro","valor_centavos":100000},"demais":{"tipo":"voucher","valor_centavos":20000}}},
     {"nome":"Super Meta","gatilho":50,"premios":{"recepcao_crc":{"tipo":"dinheiro","valor_centavos":150000},"demais":{"tipo":"voucher","valor_centavos":30000}}},
     {"nome":"Bônus","gatilho":55,"premios":{"recepcao_crc":{"tipo":"experiencia","valor_centavos":150000,"descricao":"Super Meta + experiência da equipe"},"demais":{"tipo":"experiencia","valor_centavos":30000,"descricao":"Super Meta + experiência da equipe"}}}]',
   false,
   'Faixas da meta coletiva (modelo 2025 em conversões). O gestor ajusta ao criar a meta.', '2026-01-01 00:00-03'),
  ('rede', null, 'campanhas', 'campanhas_modelos',
   '[{"codigo":"dobro","nome":"Riso Coins em Dobro","descricao":"Toda indicação vale o dobro durante o período.","dias":30,"regras":{"multiplicador":2}},
     {"codigo":"familia","nome":"Traga sua Família","descricao":"Pontos extras no comparecimento e bônus na 2ª conversão.","dias":60,"regras":{"pontos_extra":{"comparecimento":100},"marcos":[{"conversoes":2,"bonus":300}]}},
     {"codigo":"inauguracao","nome":"Inauguração de Unidade","descricao":"Acelera as primeiras indicações de uma unidade nova.","dias":90,"regras":{"multiplicador":1.5,"pontos_extra":{"registro":50}}},
     {"codigo":"maratona","nome":"Maratona de Embaixadores","descricao":"Bônus crescente por conversões na campanha.","dias":90,"regras":{"marcos":[{"conversoes":3,"bonus":300},{"conversoes":5,"bonus":600},{"conversoes":10,"bonus":1500}]}}]',
   false,
   'Modelos prontos do assistente de campanhas (pontos de partida: o gestor ajusta antes de publicar).', '2026-01-01 00:00-03')
on conflict on constraint config_versao_unica do nothing;

-- -----------------------------------------------------------------------------
-- 2) Colunas novas
-- -----------------------------------------------------------------------------
alter table indica.campanhas
  add column if not exists modelo text,
  add column if not exists alerta_orcamento_em timestamptz,
  add column if not exists orcamento_esgotado_em timestamptz;

alter table indica.apuracoes
  add column if not exists premios jsonb not null default '[]'::jsonb,
  add column if not exists comparecimento_ok boolean,
  add column if not exists motivo text,
  add column if not exists criado_por uuid references public.profiles (id);
create unique index if not exists apuracoes_final_uq
  on indica.apuracoes (meta_id) where tipo = 'final' and status <> 'reprovada';

-- Apuração nasce e muda só pelas funções (é base de pagamento).
create or replace function indica.apuracao_so_pelo_motor()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'INDICA_APURACAO_NAO_SE_APAGA: apuração é reprovada, nunca apagada.';
  end if;
  if coalesce(current_setting('indica.motor', true), '') <> 'sim' then
    raise exception 'INDICA_FORA_DO_MOTOR: apuração só pelas funções do Indica +Risos.';
  end if;
  return coalesce(new, old);
end;
$$;
drop trigger if exists apuracoes_trava on indica.apuracoes;
create trigger apuracoes_trava
  before insert or update or delete on indica.apuracoes
  for each row execute function indica.apuracao_so_pelo_motor();

-- -----------------------------------------------------------------------------
-- 3) Campanha ATIVA só amplia: regras não diminuem, versão sobe a cada mudança
-- -----------------------------------------------------------------------------
create or replace function indica.campanha_protege_regras()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  k text;
begin
  -- Situação só muda pela porta (mudar_campanha) ou pela rotina.
  if new.status is distinct from old.status
     and coalesce(current_setting('indica.motor', true), '') <> 'sim' then
    raise exception 'INDICA_FORA_DO_MOTOR: a situação da campanha muda só pelos botões (publicar, pausar, encerrar).';
  end if;
  if coalesce((new.regras ->> 'multiplicador')::numeric, 1) < 1 then
    raise exception 'INDICA_CAMPANHA_INVALIDA: multiplicador de campanha menor que 1.';
  end if;
  if old.status in ('ativa', 'pausada', 'encerrada', 'apurada') then
    if coalesce((new.regras ->> 'multiplicador')::numeric, 1) < coalesce((old.regras ->> 'multiplicador')::numeric, 1) then
      raise exception 'INDICA_CAMPANHA_REDUZIDA: campanha em andamento não pode ter o multiplicador reduzido — encerre e crie outra.';
    end if;
    for k in select unnest(array['registro', 'comparecimento', 'fechamento']) loop
      if coalesce((new.regras #>> array['pontos_extra', k])::numeric, 0)
         < coalesce((old.regras #>> array['pontos_extra', k])::numeric, 0) then
        raise exception 'INDICA_CAMPANHA_REDUZIDA: campanha em andamento não pode ter pontos extras reduzidos.';
      end if;
    end loop;
    if new.inicio <> old.inicio then
      raise exception 'INDICA_CAMPANHA_REDUZIDA: o início de uma campanha já começada não muda.';
    end if;
    if new.publico is distinct from old.publico or new.especialidade is distinct from old.especialidade
       or new.escopo is distinct from old.escopo or new.unidades is distinct from old.unidades then
      raise exception 'INDICA_CAMPANHA_REDUZIDA: público, especialidade e unidades não mudam depois de começar.';
    end if;
  end if;
  -- Orçamento mudou: a rotina da madrugada confere de novo (aumentar reabre).
  if new.orcamento_max_centavos is distinct from old.orcamento_max_centavos then
    new.alerta_orcamento_em := null;
    new.orcamento_esgotado_em := null;
  end if;
  if new.regras is distinct from old.regras or new.beneficio_indicado is distinct from old.beneficio_indicado
     or new.regulamento_md is distinct from old.regulamento_md or new.fim is distinct from old.fim then
    new.versao := old.versao + 1;
  end if;
  return new;
end;
$$;
-- Campanha nasce rascunho: publicar é ato separado, com a conferência da porta.
create or replace function indica.campanha_nasce_rascunho()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status <> 'rascunho' and coalesce(current_setting('indica.motor', true), '') <> 'sim' then
    raise exception 'INDICA_FORA_DO_MOTOR: campanha nasce em rascunho.';
  end if;
  if coalesce((new.regras ->> 'multiplicador')::numeric, 1) < 1 then
    raise exception 'INDICA_CAMPANHA_INVALIDA: multiplicador de campanha menor que 1.';
  end if;
  return new;
end;
$$;
drop trigger if exists campanhas_nasce_rascunho on indica.campanhas;
create trigger campanhas_nasce_rascunho
  before insert on indica.campanhas
  for each row execute function indica.campanha_nasce_rascunho();

drop trigger if exists campanhas_protege_regras on indica.campanhas;
create trigger campanhas_protege_regras
  before update on indica.campanhas
  for each row execute function indica.campanha_protege_regras();

-- -----------------------------------------------------------------------------
-- 4) Público e valor da campanha
-- -----------------------------------------------------------------------------
-- Especialidades do tratamento do CLIENTE: procedimentos incluídos nas vendas
-- fechadas (não canceladas) dele.
create or replace function indica._especialidades_do_cliente(p_cliente_id uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct p.specialty), '{}')
    from public.commercial_sales s
    join public.plan_negotiation_items ni on ni.negotiation_id = s.negotiation_id and ni.included
    join public.treatment_plan_option_items it on it.id = ni.item_id
    join public.procedures p on p.id = it.procedure_id
   where s.client_id = p_cliente_id
     and s.closed_at is not null and s.cancelled_at is null
     and nullif(btrim(p.specialty), '') is not null;
$$;

-- Especialidades de UMA venda (para a especialidade-alvo no fechamento).
create or replace function indica._especialidades_da_venda(p_venda_id uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct p.specialty), '{}')
    from public.commercial_sales s
    join public.plan_negotiation_items ni on ni.negotiation_id = s.negotiation_id and ni.included
    join public.treatment_plan_option_items it on it.id = ni.item_id
    join public.procedures p on p.id = it.procedure_id
   where s.id = p_venda_id and nullif(btrim(p.specialty), '') is not null;
$$;

create or replace function indica._publico_ok(p_campanha indica.campanhas, p_embaixador_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_emb record;
  v_lista text[];
begin
  select e.id, e.cliente_id, n.codigo as nivel, c.empresarial_company_id
    into v_emb
    from indica.embaixadores e
    join indica.niveis n on n.id = e.nivel_id
    join public.clients c on c.id = e.cliente_id
   where e.id = p_embaixador_id;
  if not found then
    return false;
  end if;

  v_lista := array(select jsonb_array_elements_text(coalesce(p_campanha.publico -> 'niveis', '[]'::jsonb)));
  if cardinality(v_lista) > 0 and not (v_emb.nivel = any (v_lista)) then
    return false;
  end if;

  v_lista := array(select jsonb_array_elements_text(coalesce(p_campanha.publico -> 'empresas', '[]'::jsonb)));
  if cardinality(v_lista) > 0
     and (v_emb.empresarial_company_id is null or not (v_emb.empresarial_company_id::text = any (v_lista))) then
    return false;
  end if;

  v_lista := array(select jsonb_array_elements_text(coalesce(p_campanha.publico -> 'especialidades', '[]'::jsonb)));
  if cardinality(v_lista) > 0
     and not (indica._especialidades_do_cliente(v_emb.cliente_id) && v_lista) then
    return false;
  end if;
  return true;
end;
$$;

-- Quanto a campanha rende numa conversão completa (para escolher a melhor).
create or replace function indica._valor_da_campanha(p_regras jsonb, p_base jsonb)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select (coalesce((p_base ->> 'registro')::numeric, 0) + coalesce((p_regras #>> '{pontos_extra,registro}')::numeric, 0)
        + coalesce((p_base ->> 'comparecimento')::numeric, 0) + coalesce((p_regras #>> '{pontos_extra,comparecimento}')::numeric, 0)
        + coalesce((p_base ->> 'fechamento')::numeric, 0) + coalesce((p_regras #>> '{pontos_extra,fechamento}')::numeric, 0))
       * coalesce((p_regras ->> 'multiplicador')::numeric, 1);
$$;

-- Consumo do orçamento: Riso Coins líquidos das indicações da campanha
-- (créditos − estornos) + bônus de marcos, valorizados em centavos.
create or replace function indica.campanha_consumo(p_campanha_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_coins integer;
  v_valor numeric := indica.config_numero('valor_riso_coin_centavos');
  v_max bigint;
  v_custo bigint;
begin
  select coalesce(sum(l.riso_coins) filter (where l.tipo in ('pendente', 'credito', 'carencia', 'estorno')), 0)::integer
    into v_coins
    from indica.pontos_lancamentos l
    left join indica.indicacoes i on i.id = l.indicacao_id
   where i.campanha_id = p_campanha_id
      or (l.regra_aplicada ->> 'marco_campanha') = p_campanha_id::text;
  select orcamento_max_centavos into v_max from indica.campanhas where id = p_campanha_id;
  v_custo := round(v_coins * v_valor);
  return jsonb_build_object(
    'riso_coins', v_coins,
    'custo_centavos', v_custo,
    'orcamento_max_centavos', v_max,
    'percentual', case when coalesce(v_max, 0) > 0 then round(100.0 * v_custo / v_max, 1) end
  );
end;
$$;

-- A campanha que vale AGORA para este Embaixador nesta unidade (a melhor).
create or replace function indica._campanha_para(p_embaixador_id uuid, p_unidade_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c indica.campanhas;
  v_base jsonb := jsonb_build_object(
    'registro', indica.config_numero('pontos_registro', p_unidade_id),
    'comparecimento', indica.config_numero('pontos_comparecimento', p_unidade_id),
    'fechamento', indica.config_numero('pontos_fechamento', p_unidade_id));
  v_melhor uuid;
  v_melhor_valor numeric := -1;
  v_valor numeric;
begin
  if p_embaixador_id is null then
    return null;
  end if;
  for c in
    select * from indica.campanhas
     where status = 'ativa' and now() between inicio and fim
       and (escopo = 'rede' or p_unidade_id = any (unidades))
       and orcamento_esgotado_em is null
     order by fim, criado_em
  loop
    if indica._publico_ok(c, p_embaixador_id) then
      v_valor := indica._valor_da_campanha(c.regras, v_base);
      -- Especialidade-alvo é condicional: empata para baixo com a genérica.
      if c.especialidade is not null then
        v_valor := v_valor - 0.5;
      end if;
      if v_valor > v_melhor_valor then
        v_melhor := c.id;
        v_melhor_valor := v_valor;
      end if;
    end if;
  end loop;
  return v_melhor;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5) regra_vigente: a campanha leva também especialidade e marcos
-- -----------------------------------------------------------------------------
create or replace function indica.regra_vigente(
  p_unidade_id uuid,
  p_campanha_id uuid default null,
  p_em timestamptz default now()
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_camp indica.campanhas;
  v_campanha jsonb := null;
begin
  if p_campanha_id is not null then
    select * into v_camp from indica.campanhas where id = p_campanha_id;
    if not found then
      raise exception 'INDICA_CAMPANHA_INVALIDA: campanha não encontrada.';
    end if;
    if v_camp.status <> 'ativa' or p_em < v_camp.inicio or p_em > v_camp.fim then
      raise exception 'INDICA_CAMPANHA_INVALIDA: a campanha "%" não está ativa nesta data.', v_camp.nome;
    end if;
    if v_camp.escopo = 'unidades' and not (p_unidade_id = any (v_camp.unidades)) then
      raise exception 'INDICA_CAMPANHA_INVALIDA: a campanha "%" não vale para esta unidade.', v_camp.nome;
    end if;
    if coalesce((v_camp.regras ->> 'multiplicador')::numeric, 1) < 1 then
      raise exception 'INDICA_CAMPANHA_INVALIDA: multiplicador de campanha menor que 1.';
    end if;
    v_campanha := jsonb_build_object(
      'id', v_camp.id,
      'nome', v_camp.nome,
      'versao', v_camp.versao,
      'multiplicador', coalesce((v_camp.regras ->> 'multiplicador')::numeric, 1),
      'pontos_extra', coalesce(v_camp.regras -> 'pontos_extra', '{}'::jsonb),
      'marcos', coalesce(v_camp.regras -> 'marcos', '[]'::jsonb),
      'especialidade', v_camp.especialidade,
      'prazo_extra_dias', v_camp.prazo_extra_dias
    );
  end if;

  return jsonb_build_object(
    'pontos', jsonb_build_object(
      'registro', indica.config_numero('pontos_registro', p_unidade_id, p_em),
      'comparecimento', indica.config_numero('pontos_comparecimento', p_unidade_id, p_em),
      'fechamento', indica.config_numero('pontos_fechamento', p_unidade_id, p_em)
    ),
    'bonus_percentual_valor_fechado', indica.config_numero('bonus_percentual_valor_fechado', p_unidade_id, p_em),
    'carencia_dias', indica.config_numero('carencia_dias', p_unidade_id, p_em),
    'carencia_libera_na_primeira_parcela', indica.config_valor('carencia_libera_na_primeira_parcela', p_unidade_id, p_em),
    'validade_riso_coins_meses', indica.config_numero('validade_riso_coins_meses', p_unidade_id, p_em),
    'teto_conversoes_12_meses', indica.config_numero('teto_conversoes_12_meses', p_unidade_id, p_em),
    'trava_atribuicao_dias', indica.config_numero('trava_atribuicao_dias', p_unidade_id, p_em),
    'combinar_multiplicadores', indica.config_valor('combinar_multiplicadores', p_unidade_id, p_em),
    'campanha', v_campanha,
    'unidade_id', p_unidade_id,
    'calculada_em', p_em
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- 6) _pontuar: especialidade-alvo vale no FECHAMENTO
-- -----------------------------------------------------------------------------
create or replace function indica._pontuar(p_indicacao_id uuid, p_etapa text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v indica.indicacoes;
  v_nivel record;
  v_teto integer;
  v_fechamentos integer;
  v_teto_atingido boolean := false;
  v_pontos integer := 0;
  v_regra jsonb;
  v_regra_conta jsonb;
  v_alvo_fora boolean := false;
begin
  select * into v from indica.indicacoes where id = p_indicacao_id;
  if v.embaixador_id is null then
    return 0;
  end if;

  select n.codigo, n.multiplicador into v_nivel
    from indica.embaixadores e
    join indica.niveis n on n.id = e.nivel_id
   where e.id = v.embaixador_id;

  -- Especialidade-alvo: no fechamento, a vantagem da campanha só vale se a
  -- venda tem procedimento dessa especialidade.
  v_regra_conta := v.regra_congelada;
  if p_etapa = 'fechamento'
     and (v.regra_congelada #>> '{campanha,especialidade}') is not null
     and not ((v.regra_congelada #>> '{campanha,especialidade}') = any (indica._especialidades_da_venda(v.venda_id))) then
    v_regra_conta := v.regra_congelada || jsonb_build_object('campanha', null);
    v_alvo_fora := true;
  end if;

  v_teto := (v.regra_congelada ->> 'teto_conversoes_12_meses')::integer;
  select count(*) into v_fechamentos
    from indica.indicacoes i
   where i.embaixador_id = v.embaixador_id
     and i.id <> v.id
     and i.status in ('fechou', 'convertida')
     and i.fechou_em >= now() - interval '12 months';

  if v_fechamentos >= v_teto then
    v_teto_atingido := true;
  else
    v_pontos := indica.calcular_pontos(
      v_regra_conta, p_etapa, v_nivel.multiplicador, coalesce(v.valor_fechado_centavos, 0)
    );
  end if;

  v_regra := v_regra_conta || jsonb_build_object(
    'etapa', p_etapa,
    'nivel', v_nivel.codigo,
    'multiplicador_nivel', v_nivel.multiplicador,
    'fechamentos_12_meses', v_fechamentos,
    'teto_atingido', v_teto_atingido,
    'especialidade_fora_da_campanha', v_alvo_fora
  );

  if v_pontos = 0 then
    return 0;
  end if;

  if p_etapa = 'registro' then
    perform indica._lancar(v.embaixador_id, v.id, 'pendente', 'pendente', v_pontos, v_regra,
                           null, null, v.unidade_id);
  elsif p_etapa = 'comparecimento' then
    perform indica._lancar(v.embaixador_id, v.id, 'credito', 'disponivel', v_pontos, v_regra,
                           null,
                           now() + make_interval(months => (v.regra_congelada ->> 'validade_riso_coins_meses')::integer),
                           v.unidade_id);
  elsif p_etapa = 'fechamento' then
    perform indica._lancar(v.embaixador_id, v.id, 'carencia', 'carencia', v_pontos, v_regra,
                           v.fechou_em + make_interval(days => (v.regra_congelada ->> 'carencia_dias')::integer),
                           null, v.unidade_id);
  end if;

  return v_pontos;
end;
$$;

-- -----------------------------------------------------------------------------
-- 7) Marcos da campanha: bônus na N-ª conversão (gatilho blindado)
-- -----------------------------------------------------------------------------
create or replace function indica.marcos_da_campanha()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v indica.indicacoes;
  v_n integer;
  v_bonus integer;
begin
  if new.status_para <> 'convertida' then
    return new;
  end if;
  begin
    select * into v from indica.indicacoes where id = new.indicacao_id;
    if v.embaixador_id is null or v.campanha_id is null then
      return new;
    end if;
    select count(*) into v_n from indica.indicacoes
     where embaixador_id = v.embaixador_id and campanha_id = v.campanha_id and status = 'convertida';
    select (m ->> 'bonus')::integer into v_bonus
      from jsonb_array_elements(coalesce(v.regra_congelada #> '{campanha,marcos}', '[]'::jsonb)) m
     where (m ->> 'conversoes')::integer = v_n
     limit 1;
    if coalesce(v_bonus, 0) > 0 then
      perform indica._lancar(v.embaixador_id, v.id, 'credito', 'disponivel', v_bonus,
        v.regra_congelada || jsonb_build_object('marco_campanha', v.campanha_id, 'marco_conversoes', v_n),
        null,
        now() + make_interval(months => (v.regra_congelada ->> 'validade_riso_coins_meses')::integer),
        v.unidade_id, null, 'Bônus de marco da campanha: ' || v_n || 'ª conversão.');
    end if;
  exception when others then
    perform indica._registrar_falha('marco', v.campanha_id, new.indicacao_id, sqlerrm);
  end;
  return new;
end;
$$;
drop trigger if exists indicacao_eventos_marcos on indica.indicacao_eventos;
create trigger indicacao_eventos_marcos
  after insert on indica.indicacao_eventos
  for each row execute function indica.marcos_da_campanha();

-- -----------------------------------------------------------------------------
-- 8) registrar_indicacao: campanha AUTOMÁTICA (a melhor) e público conferido
-- -----------------------------------------------------------------------------
create or replace function indica.registrar_indicacao(p_dados jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_antes text := coalesce(current_setting('indica.motor', true), '');
  v_unidade uuid := nullif(p_dados ->> 'unidade_id', '')::uuid;
  v_canal text := nullif(btrim(p_dados ->> 'canal'), '');
  v_nome text := nullif(btrim(p_dados ->> 'indicado_nome'), '');
  v_tel text := nullif(btrim(p_dados ->> 'indicado_telefone'), '');
  v_tel_d text;
  v_cpf text := nullif(btrim(p_dados ->> 'indicado_cpf'), '');
  v_cpf_d text;
  v_email text := nullif(btrim(p_dados ->> 'indicado_email'), '');
  v_cliente uuid := nullif(p_dados ->> 'cliente_indicado_id', '')::uuid;
  v_emb_id uuid := nullif(p_dados ->> 'embaixador_id', '')::uuid;
  v_parc_id uuid := nullif(p_dados ->> 'parceiro_id', '')::uuid;
  v_campanha uuid := nullif(p_dados ->> 'campanha_id', '')::uuid;
  v_origem uuid := coalesce(nullif(p_dados ->> 'risartano_origem_id', '')::uuid, auth.uid());
  v_consent text := nullif(btrim(p_dados ->> 'consentimento'), '');
  v_ip inet := nullif(p_dados ->> 'consentimento_ip', '')::inet;
  v_emb indica.embaixadores;
  v_camp indica.campanhas;
  v_conf jsonb;
  v_expirar uuid;
  v_regra jsonb;
  v_id uuid;
  v_pontos integer;
begin
  v_tel_d := nullif(regexp_replace(coalesce(v_tel, ''), '\D', '', 'g'), '');
  v_cpf_d := nullif(regexp_replace(coalesce(v_cpf, ''), '\D', '', 'g'), '');

  if v_unidade is null
     or not exists (select 1 from public.clinics c
                     where c.id = v_unidade and c.type = 'franchise_unit' and c.is_active) then
    raise exception 'INDICA_UNIDADE_INVALIDA: escolha a unidade que vai atender o indicado.';
  end if;
  if v_uid is not null and not indica.eh_risartano(v_unidade) then
    raise exception 'INDICA_SEM_PERMISSAO: você não é desta unidade.';
  end if;
  if v_nome is null then
    raise exception 'INDICA_DADOS: informe o nome do indicado.';
  end if;
  if v_tel_d is not null and length(v_tel_d) not in (10, 11) then
    raise exception 'INDICA_TELEFONE_INVALIDO: telefone com DDD, 10 ou 11 números.';
  end if;
  if v_cpf_d is not null and length(v_cpf_d) <> 11 then
    raise exception 'INDICA_CPF_INVALIDO: CPF com 11 números.';
  end if;
  if v_tel_d is null and v_cpf_d is null and v_cliente is null then
    raise exception 'INDICA_DADOS: informe o telefone, o CPF ou o cadastro do indicado.';
  end if;
  if v_consent is not null and v_consent not in ('presencial', 'telefone', 'link') then
    raise exception 'INDICA_DADOS: forma de aceite inválida.';
  end if;
  if v_consent = 'link' and v_uid is not null then
    raise exception 'INDICA_DADOS: o aceite pelo link é do próprio indicado.';
  end if;

  if (v_emb_id is null) = (v_parc_id is null) then
    raise exception 'INDICA_DADOS: a indicação vem de um Embaixador ou de um parceiro (um dos dois).';
  end if;
  if v_canal is null
     or v_canal not in ('link', 'agendamento', 'embaixador', 'qr', 'parceiro')
     or ((v_canal = 'parceiro') <> (v_parc_id is not null)) then
    raise exception 'INDICA_CANAL_INVALIDO: canal "%" não combina com quem indicou.', coalesce(v_canal, '');
  end if;
  if v_emb_id is not null then
    select * into v_emb from indica.embaixadores where id = v_emb_id;
    if not found or v_emb.status <> 'ativo' then
      raise exception 'INDICA_EMBAIXADOR_INATIVO: este Embaixador não está ativo no programa.';
    end if;
  else
    if not exists (select 1 from indica.parceiros p
                    where p.id = v_parc_id and p.ativo and p.tipo in ('indicador', 'ambos')) then
      raise exception 'INDICA_PARCEIRO_INVALIDO: parceiro inativo ou que não indica.';
    end if;
  end if;
  if v_cliente is not null
     and not exists (select 1 from public.clients c where c.id = v_cliente and c.status <> 'anonymized') then
    raise exception 'INDICA_CLIENTE_NAO_ENCONTRADO: cadastro do indicado não encontrado.';
  end if;

  -- Campanha: informada → confere o público; vazia → a melhor, automática.
  if v_campanha is not null then
    select * into v_camp from indica.campanhas where id = v_campanha;
    if found and v_emb_id is not null and not indica._publico_ok(v_camp, v_emb_id) then
      raise exception 'INDICA_CAMPANHA_INVALIDA: este Embaixador não está no público da campanha "%".', v_camp.nome;
    end if;
  elsif v_emb_id is not null then
    v_campanha := indica._campanha_para(v_emb_id, v_unidade);
  end if;

  perform pg_advisory_xact_lock(hashtext('indica.registrar_indicacao'));

  v_conf := indica._conferir_indicado(v_tel_d, v_cpf_d, v_cliente, v_emb.cliente_id, v_unidade);
  case v_conf ->> 'situacao'
    when 'autoindicacao' then
      raise exception 'INDICA_AUTOINDICACAO: o Embaixador não pode indicar a si mesmo.';
    when 'ja_e_cliente' then
      raise exception 'INDICA_JA_E_CLIENTE: o indicado teve atendimento na rede nos últimos % meses.',
        v_conf ->> 'janela_meses';
    when 'duplicada' then
      raise exception 'INDICA_DUPLICADA: esta pessoa já foi indicada (%). Vale o primeiro registro.',
        v_conf ->> 'codigo';
    else
      null;
  end case;
  v_cliente := nullif(v_conf ->> 'cliente_id', '')::uuid;

  for v_expirar in select jsonb_array_elements_text(v_conf -> 'expirar')::uuid
  loop
    perform indica._mudar_status(v_expirar, 'expirada',
      'Trava de atribuição vencida (conferido ao registrar nova indicação).', '{}'::jsonb, v_uid);
  end loop;

  v_regra := indica.regra_vigente(v_unidade, v_campanha, now());

  perform set_config('indica.motor', 'sim', true);
  insert into indica.indicacoes
    (embaixador_id, parceiro_id, indicado_nome, indicado_telefone, indicado_cpf, indicado_email,
     cliente_indicado_id, unidade_id, canal, campanha_id, status, risartano_origem_id,
     trava_ate, regra_congelada, criado_por)
  values
    (v_emb_id, v_parc_id, v_nome, v_tel, v_cpf, v_email,
     v_cliente, v_unidade, v_canal, v_campanha, 'registrada', v_origem,
     now() + make_interval(days => (v_regra ->> 'trava_atribuicao_dias')::integer), v_regra, v_uid)
  returning id into v_id;
  perform set_config('indica.motor', v_antes, true);

  if v_consent is not null then
    perform indica._gravar_consentimento(v_id, v_consent, v_ip, v_uid);
  elsif v_cliente is null then
    perform indica._gerar_convite(v_id);
  end if;

  v_pontos := indica._pontuar(v_id, 'registro');

  perform set_config('indica.motor', 'sim', true);
  insert into indica.indicacao_eventos (indicacao_id, status_de, status_para, dados, usuario_id)
  values (v_id, null, 'registrada',
          jsonb_build_object('canal', v_canal, 'pontos_pendentes', v_pontos,
                             'cadastro_encontrado', v_cliente is not null,
                             'campanha', v_campanha,
                             'aceite', coalesce(v_consent, case when v_cliente is null then 'convite' else 'cadastro' end)),
          v_uid);
  perform set_config('indica.motor', v_antes, true);

  if v_uid is not null then
    insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
    values (v_uid, v_unidade, 'create', 'indica_indicacao', v_id::text,
            jsonb_build_object('canal', v_canal, 'campanha', v_campanha));
  end if;

  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 9) Situação da campanha (gestor das unidades dela / franqueadora)
-- -----------------------------------------------------------------------------
create or replace function indica.mudar_campanha(p_id uuid, p_acao text, p_motivo text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_antes text := coalesce(current_setting('indica.motor', true), '');
  c indica.campanhas;
  v_novo text;
begin
  select * into c from indica.campanhas where id = p_id for update;
  if not found then
    raise exception 'INDICA_NAO_ENCONTRADO: campanha não encontrada.';
  end if;
  if v_uid is not null and not (indica.eh_franqueadora()
       or (c.escopo = 'unidades' and indica.eh_gestor_de_todas(c.unidades))) then
    raise exception 'INDICA_SEM_PERMISSAO: esta campanha é da franqueadora ou do gestor das unidades dela.';
  end if;
  v_novo := case
    when p_acao = 'publicar' and c.status = 'rascunho' then
      case when c.inicio <= now() then 'ativa' else 'agendada' end
    when p_acao = 'pausar' and c.status = 'ativa' then 'pausada'
    when p_acao = 'retomar' and c.status = 'pausada' then 'ativa'
    when p_acao = 'encerrar' and c.status in ('agendada', 'ativa', 'pausada') then 'encerrada'
    when p_acao = 'apurar' and c.status = 'encerrada' then 'apurada'
    when p_acao = 'voltar_rascunho' and c.status = 'agendada' then 'rascunho'
  end;
  if v_novo is null then
    raise exception 'INDICA_TRANSICAO_INVALIDA: não dá para "%" uma campanha %.', p_acao, c.status;
  end if;
  if p_acao = 'encerrar' and length(btrim(coalesce(p_motivo, ''))) < 3 then
    raise exception 'INDICA_MOTIVO_OBRIGATORIO: informe o motivo do encerramento (fica no aviso).';
  end if;
  if p_acao = 'publicar' and c.fim <= now() then
    raise exception 'INDICA_DADOS: a campanha termina no passado.';
  end if;
  perform set_config('indica.motor', 'sim', true);
  update indica.campanhas
     set status = v_novo,
         fim = case when p_acao = 'encerrar' and fim > now() then now() else fim end,
         atualizado_em = now()
   where id = p_id;
  perform set_config('indica.motor', v_antes, true);
  if v_uid is not null then
    insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
    values (v_uid, null, 'update', 'indica_campanha', p_id::text,
            jsonb_build_object('acao', p_acao, 'status', v_novo, 'motivo', nullif(btrim(p_motivo), '')));
  end if;
  return v_novo;
end;
$$;

-- -----------------------------------------------------------------------------
-- 10) Simulador de custo (histórico real das unidades)
-- -----------------------------------------------------------------------------
-- Usa os últimos 180 dias: indicações por dia, taxa de comparecimento e de
-- fechamento → projeta o período da campanha. Devolve só números agregados.
create or replace function indica.simular_campanha(
  p_unidades uuid[],
  p_regras jsonb,
  p_inicio timestamptz,
  p_fim timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_unidades uuid[] := p_unidades;
  v_registradas numeric;
  v_compareceram numeric;
  v_fecharam numeric;
  v_dias numeric := greatest(1, extract(epoch from (p_fim - p_inicio)) / 86400.0);
  v_por_dia numeric;
  v_prev_ind numeric;
  v_prev_comp numeric;
  v_prev_fech numeric;
  v_base_r numeric := indica.config_numero('pontos_registro');
  v_base_c numeric := indica.config_numero('pontos_comparecimento');
  v_base_f numeric := indica.config_numero('pontos_fechamento');
  v_mult numeric := coalesce((p_regras ->> 'multiplicador')::numeric, 1);
  v_extra_r numeric := coalesce((p_regras #>> '{pontos_extra,registro}')::numeric, 0);
  v_extra_c numeric := coalesce((p_regras #>> '{pontos_extra,comparecimento}')::numeric, 0);
  v_extra_f numeric := coalesce((p_regras #>> '{pontos_extra,fechamento}')::numeric, 0);
  v_coins_base numeric;
  v_coins_camp numeric;
  v_valor numeric := indica.config_numero('valor_riso_coin_centavos');
begin
  if v_uid is not null and not (indica.eh_franqueadora()
       or (cardinality(coalesce(v_unidades, '{}')) > 0 and indica.eh_gestor_de_todas(v_unidades))) then
    raise exception 'INDICA_SEM_PERMISSAO: simulador é do gestor das unidades ou da franqueadora.';
  end if;
  if coalesce(cardinality(v_unidades), 0) = 0 then
    select array_agg(id) into v_unidades from public.clinics where type = 'franchise_unit' and is_active;
  end if;

  select count(*), count(*) filter (where compareceu_em is not null), count(*) filter (where fechou_em is not null)
    into v_registradas, v_compareceram, v_fecharam
    from indica.indicacoes
   where unidade_id = any (v_unidades) and registrada_em >= now() - interval '180 days';

  v_por_dia := v_registradas / 180.0;
  v_prev_ind := round(v_por_dia * v_dias, 1);
  v_prev_comp := case when v_registradas > 0 then round(v_prev_ind * v_compareceram / v_registradas, 1) else 0 end;
  v_prev_fech := case when v_registradas > 0 then round(v_prev_ind * v_fecharam / v_registradas, 1) else 0 end;

  v_coins_base := v_prev_ind * v_base_r + v_prev_comp * v_base_c + v_prev_fech * v_base_f;
  v_coins_camp := (v_prev_ind * (v_base_r + v_extra_r) + v_prev_comp * (v_base_c + v_extra_c)
                   + v_prev_fech * (v_base_f + v_extra_f)) * v_mult;

  return jsonb_build_object(
    'historico_dias', 180,
    'historico_indicacoes', v_registradas,
    'taxa_comparecimento', case when v_registradas > 0 then round(100 * v_compareceram / v_registradas, 1) end,
    'taxa_fechamento', case when v_registradas > 0 then round(100 * v_fecharam / v_registradas, 1) end,
    'previstas', jsonb_build_object('indicacoes', v_prev_ind, 'comparecimentos', v_prev_comp, 'fechamentos', v_prev_fech),
    'riso_coins_sem_campanha', round(v_coins_base),
    'riso_coins_com_campanha', round(v_coins_camp),
    'custo_extra_centavos', round((v_coins_camp - v_coins_base) * v_valor),
    'custo_total_centavos', round(v_coins_camp * v_valor)
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- 11) METAS: apuração, aprovação e ranking
-- -----------------------------------------------------------------------------
-- Só contam CONVERTIDAS (fechamentos que passaram da carência), com o
-- FECHAMENTO dentro do período (e da campanha, se a meta for de campanha).
create or replace function indica.apurar_meta(p_meta_id uuid, p_tipo text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_antes text := coalesce(current_setting('indica.motor', true), '');
  m indica.metas_equipe;
  v_de timestamptz;
  v_ate timestamptz;
  v_ids uuid[];
  v_valor numeric;
  v_registradas integer;
  v_compareceram integer;
  v_taxa numeric;
  v_ok boolean;
  v_faixa jsonb;
  v_pendentes integer;
  v_id uuid;
begin
  if p_tipo not in ('provisoria', 'final') then
    raise exception 'INDICA_DADOS: apuração provisória ou final.';
  end if;
  select * into m from indica.metas_equipe where id = p_meta_id;
  if not found then
    raise exception 'INDICA_NAO_ENCONTRADO: meta não encontrada.';
  end if;
  if v_uid is not null and not indica.eh_gestor(m.unidade_id) then
    raise exception 'INDICA_SEM_PERMISSAO: apuração é do gestor da unidade.';
  end if;

  v_de := m.periodo_inicio::timestamp at time zone 'America/Sao_Paulo';
  v_ate := (m.periodo_fim + 1)::timestamp at time zone 'America/Sao_Paulo';

  -- Final só depois do período e sem fechamento do período ainda em carência.
  select count(*) into v_pendentes from indica.indicacoes
   where unidade_id = m.unidade_id and status = 'fechou'
     and fechou_em >= v_de and fechou_em < v_ate
     and (m.campanha_id is null or campanha_id = m.campanha_id);
  if p_tipo = 'final' and (now() < v_ate or v_pendentes > 0) then
    raise exception 'INDICA_APURACAO_CEDO: a final sai depois do período e da carência da última conversão (% em carência).', v_pendentes;
  end if;

  select array_agg(id),
         case m.metrica
           when 'conversoes' then count(*)::numeric
           when 'receita_indicados' then coalesce(sum(valor_fechado_centavos), 0)::numeric
           else 0
         end
    into v_ids, v_valor
    from indica.indicacoes
   where unidade_id = m.unidade_id and status = 'convertida'
     and fechou_em >= v_de and fechou_em < v_ate
     and (m.campanha_id is null or campanha_id = m.campanha_id);

  if m.metrica = 'riso_coins' then
    select coalesce(sum(l.riso_coins) filter (where l.riso_coins > 0 and l.tipo in ('credito', 'liberacao')), 0)
      into v_valor
      from indica.pontos_lancamentos l
     where l.indicacao_id = any (coalesce(v_ids, '{}'));
  end if;

  -- Trava de qualidade: comparecimento das indicações REGISTRADAS no período.
  select count(*), count(*) filter (where compareceu_em is not null)
    into v_registradas, v_compareceram
    from indica.indicacoes
   where unidade_id = m.unidade_id and registrada_em >= v_de and registrada_em < v_ate
     and (m.campanha_id is null or campanha_id = m.campanha_id);
  v_taxa := case when v_registradas > 0 then round(100.0 * v_compareceram / v_registradas, 2) else 0 end;
  v_ok := m.trava_qualidade_comparecimento is null or v_taxa >= m.trava_qualidade_comparecimento;

  select f into v_faixa
    from jsonb_array_elements(m.faixas) f
   where (f ->> 'gatilho')::numeric <= v_valor
   order by (f ->> 'gatilho')::numeric desc
   limit 1;

  perform set_config('indica.motor', 'sim', true);
  insert into indica.apuracoes
    (meta_id, tipo, valor_apurado, faixa_atingida, taxa_comparecimento, comparecimento_ok,
     indicacoes_contadas, criado_por)
  values
    (m.id, p_tipo, v_valor, case when v_ok then v_faixa ->> 'nome' end, v_taxa, v_ok,
     coalesce(v_ids, '{}'), v_uid)
  returning id into v_id;
  perform set_config('indica.motor', v_antes, true);
  return v_id;
end;
$$;

-- Aprovar (ou reprovar) a apuração FINAL. Ao aprovar, grava a lista de
-- premiados e valores (a "foto" para a folha): recepção/CRC = recepcionistas
-- da unidade; demais = as outras funções da unidade.
create or replace function indica.aprovar_apuracao(p_id uuid, p_aprovar boolean, p_motivo text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_antes text := coalesce(current_setting('indica.motor', true), '');
  a indica.apuracoes;
  m indica.metas_equipe;
  v_faixa jsonb;
  v_premios jsonb := '[]'::jsonb;
begin
  select * into a from indica.apuracoes where id = p_id for update;
  if not found then
    raise exception 'INDICA_NAO_ENCONTRADO: apuração não encontrada.';
  end if;
  select * into m from indica.metas_equipe where id = a.meta_id;
  if v_uid is not null and not indica.eh_gestor(m.unidade_id) then
    raise exception 'INDICA_SEM_PERMISSAO: aprovar é do gestor da unidade.';
  end if;
  if a.tipo <> 'final' or a.status <> 'aguardando_aprovacao' then
    raise exception 'INDICA_TRANSICAO_INVALIDA: só a apuração FINAL aguardando aprovação.';
  end if;
  if not p_aprovar and length(btrim(coalesce(p_motivo, ''))) < 3 then
    raise exception 'INDICA_MOTIVO_OBRIGATORIO: informe o motivo da reprovação.';
  end if;

  if p_aprovar and a.faixa_atingida is not null then
    select f into v_faixa from jsonb_array_elements(m.faixas) f where f ->> 'nome' = a.faixa_atingida limit 1;
    select coalesce(jsonb_agg(jsonb_build_object(
             'user_id', r.user_id,
             'nome', p.full_name,
             'funcao', r.role,
             'grupo', case when r.role::text in ('receptionist', 'sdr') then 'recepcao_crc' else 'demais' end,
             'premio', v_faixa #> array['premios', case when r.role::text in ('receptionist', 'sdr') then 'recepcao_crc' else 'demais' end]
           ) order by p.full_name), '[]'::jsonb)
      into v_premios
      from public.user_clinic_roles_all r
      join public.profiles p on p.id = r.user_id and p.is_active and not p.is_admin_master
     where r.clinic_id = m.unidade_id;
  end if;

  perform set_config('indica.motor', 'sim', true);
  update indica.apuracoes
     set status = case when p_aprovar then 'aprovada' else 'reprovada' end,
         aprovado_por = v_uid, aprovado_em = now(),
         premios = v_premios,
         motivo = nullif(btrim(p_motivo), '')
   where id = p_id;
  perform set_config('indica.motor', v_antes, true);

  if v_uid is not null then
    insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
    values (v_uid, m.unidade_id, 'update', 'indica_apuracao', p_id::text,
            jsonb_build_object('aprovada', p_aprovar, 'faixa', a.faixa_atingida));
  end if;
  return case when p_aprovar then 'aprovada' else 'reprovada' end;
end;
$$;

-- Ranking individual da unidade no período.
create or replace function indica.ranking_equipe(p_unidade_id uuid, p_de date, p_ate date)
returns table (
  usuario_id uuid,
  nome text,
  pedidos integer,
  registradas integer,
  embaixadores_ativados integer,
  conversoes_origem integer,
  conversoes_fechamento integer,
  taxa_conversao numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_de timestamptz := p_de::timestamp at time zone 'America/Sao_Paulo';
  v_ate timestamptz := (p_ate + 1)::timestamp at time zone 'America/Sao_Paulo';
begin
  if auth.uid() is not null and not indica.eh_risartano(p_unidade_id) then
    raise exception 'INDICA_SEM_PERMISSAO: ranking é da equipe da unidade.';
  end if;
  return query
  with pessoas as (
    select risartano_id as uid from indica.pedidos_indicacao
     where unidade_id = p_unidade_id and criado_em >= v_de and criado_em < v_ate
    union
    select risartano_origem_id from indica.indicacoes
     where unidade_id = p_unidade_id and registrada_em >= v_de and registrada_em < v_ate
    union
    select risartano_conversao_id from indica.indicacoes
     where unidade_id = p_unidade_id and fechou_em >= v_de and fechou_em < v_ate
  ),
  primeiras as (
    select distinct on (embaixador_id) embaixador_id, risartano_origem_id, registrada_em
      from indica.indicacoes
     where embaixador_id is not null
     order by embaixador_id, registrada_em
  )
  select b.usuario_id, b.nome, b.pedidos, b.registradas, b.embaixadores_ativados,
         b.conversoes_origem, b.conversoes_fechamento,
         case when b.registradas > 0 then round(100.0 * b.conversoes_origem / b.registradas, 1) end
    from (
  select p.uid as usuario_id,
         pr.full_name as nome,
         (select count(*) from indica.pedidos_indicacao x
           where x.risartano_id = p.uid and x.unidade_id = p_unidade_id
             and x.criado_em >= v_de and x.criado_em < v_ate)::integer as pedidos,
         (select count(*) from indica.indicacoes i
           where i.risartano_origem_id = p.uid and i.unidade_id = p_unidade_id
             and i.registrada_em >= v_de and i.registrada_em < v_ate)::integer as registradas,
         (select count(*) from primeiras f
           where f.risartano_origem_id = p.uid and f.registrada_em >= v_de and f.registrada_em < v_ate)::integer as embaixadores_ativados,
         (select count(*) from indica.indicacoes i
           where i.risartano_origem_id = p.uid and i.unidade_id = p_unidade_id and i.status = 'convertida'
             and i.fechou_em >= v_de and i.fechou_em < v_ate)::integer as conversoes_origem,
         (select count(*) from indica.indicacoes i
           where i.risartano_conversao_id = p.uid and i.unidade_id = p_unidade_id and i.status = 'convertida'
             and i.fechou_em >= v_de and i.fechou_em < v_ate)::integer as conversoes_fechamento,
         0 as fim_colunas
    from pessoas p
    join public.profiles pr on pr.id = p.uid
   where p.uid is not null
    ) b
   order by b.conversoes_origem + b.conversoes_fechamento desc, b.registradas desc, b.nome;
end;
$$;

-- -----------------------------------------------------------------------------
-- 12) Rotina das campanhas (pg_cron 02:40 BRT): agenda → ativa, fim → encerra,
--     orçamento: alerta e esgotado
-- -----------------------------------------------------------------------------
create or replace function indica.rotina_campanhas()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c indica.campanhas;
  v_consumo jsonb;
  v_alerta numeric := indica.config_numero('campanha_alerta_orcamento_percentual');
  v_ativadas integer := 0;
  v_encerradas integer := 0;
  v_alertas integer := 0;
  v_esgotadas integer := 0;
  v_antes text := coalesce(current_setting('indica.motor', true), '');
begin
  if auth.uid() is not null then
    raise exception 'INDICA_SEM_PERMISSAO: a rotina roda sozinha.';
  end if;
  perform set_config('indica.motor', 'sim', true);
  update indica.campanhas set status = 'ativa' where status = 'agendada' and inicio <= now() and fim > now();
  get diagnostics v_ativadas = row_count;
  update indica.campanhas set status = 'encerrada' where status in ('ativa', 'pausada', 'agendada') and fim <= now();
  get diagnostics v_encerradas = row_count;

  for c in select * from indica.campanhas where status in ('ativa', 'pausada') and orcamento_max_centavos > 0 loop
    v_consumo := indica.campanha_consumo(c.id);
    if (v_consumo ->> 'percentual')::numeric >= v_alerta and c.alerta_orcamento_em is null then
      update indica.campanhas set alerta_orcamento_em = now() where id = c.id;
      v_alertas := v_alertas + 1;
    end if;
    if (v_consumo ->> 'percentual')::numeric >= 100 and c.orcamento_esgotado_em is null then
      -- Esgotado: deixa de entrar em indicações NOVAS; as já registradas mantêm a regra.
      update indica.campanhas set orcamento_esgotado_em = now() where id = c.id;
      v_esgotadas := v_esgotadas + 1;
    end if;
  end loop;

  perform set_config('indica.motor', v_antes, true);
  insert into indica.rotinas_execucoes (resultado)
  values (jsonb_build_object('rotina', 'campanhas', 'ativadas', v_ativadas, 'encerradas', v_encerradas,
                             'alertas_orcamento', v_alertas, 'orcamentos_esgotados', v_esgotadas));
  return jsonb_build_object('ativadas', v_ativadas, 'encerradas', v_encerradas,
                            'alertas_orcamento', v_alertas, 'orcamentos_esgotados', v_esgotadas);
end;
$$;

do $$
begin
  create extension if not exists pg_cron;
  begin
    perform cron.unschedule('indica-rotina-campanhas');
  exception when others then
    null;
  end;
  perform cron.schedule('indica-rotina-campanhas', '40 5 * * *', 'select indica.rotina_campanhas()');
exception when others then
  raise warning 'INDICA: não foi possível agendar a rotina das campanhas (pg_cron): %', sqlerrm;
end;
$$;

-- -----------------------------------------------------------------------------
-- 13) Permissões (AP15)
-- -----------------------------------------------------------------------------
revoke execute on function indica.apuracao_so_pelo_motor() from public, anon, authenticated;
revoke execute on function indica.campanha_protege_regras() from public, anon, authenticated;
revoke execute on function indica.campanha_nasce_rascunho() from public, anon, authenticated;
revoke execute on function indica._especialidades_do_cliente(uuid) from public, anon, authenticated;
revoke execute on function indica._especialidades_da_venda(uuid) from public, anon, authenticated;
revoke execute on function indica._publico_ok(indica.campanhas, uuid) from public, anon, authenticated;
revoke execute on function indica._valor_da_campanha(jsonb, jsonb) from public, anon, authenticated;
revoke execute on function indica.campanha_consumo(uuid) from public, anon, authenticated;
revoke execute on function indica._campanha_para(uuid, uuid) from public, anon, authenticated;
revoke execute on function indica.regra_vigente(uuid, uuid, timestamptz) from public, anon, authenticated;
revoke execute on function indica._pontuar(uuid, text) from public, anon, authenticated;
revoke execute on function indica.marcos_da_campanha() from public, anon, authenticated;
revoke execute on function indica.registrar_indicacao(jsonb) from public, anon, authenticated;
revoke execute on function indica.mudar_campanha(uuid, text, text) from public, anon, authenticated;
revoke execute on function indica.simular_campanha(uuid[], jsonb, timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function indica.apurar_meta(uuid, text) from public, anon, authenticated;
revoke execute on function indica.aprovar_apuracao(uuid, boolean, text) from public, anon, authenticated;
revoke execute on function indica.ranking_equipe(uuid, date, date) from public, anon, authenticated;
revoke execute on function indica.rotina_campanhas() from public, anon, authenticated;

grant execute on function indica.regra_vigente(uuid, uuid, timestamptz) to authenticated, service_role;
grant execute on function indica.registrar_indicacao(jsonb) to authenticated, service_role;
grant execute on function indica.campanha_consumo(uuid) to authenticated, service_role;
grant execute on function indica.mudar_campanha(uuid, text, text) to authenticated, service_role;
grant execute on function indica.simular_campanha(uuid[], jsonb, timestamptz, timestamptz) to authenticated, service_role;
grant execute on function indica.apurar_meta(uuid, text) to authenticated, service_role;
grant execute on function indica.aprovar_apuracao(uuid, boolean, text) to authenticated, service_role;
grant execute on function indica.ranking_equipe(uuid, date, date) to authenticated, service_role;
grant execute on function indica.rotina_campanhas() to service_role;

-- =============================================================================
-- 2001 — Indica +Risos (IND0, parte 2): parâmetros padrão, níveis e a leitura
--        da configuração em cascata Rede → Unidade → Campanha
-- -----------------------------------------------------------------------------
-- REGRA: nenhum número do programa mora no código. Tudo o que o motor usa vem
-- de `indica.config` (rede/unidade), de `indica.niveis` ou da campanha. Se um
-- parâmetro faltar, a leitura FALHA ALTO (INDICA_CONFIG_AUSENTE) em vez de cair
-- num padrão escondido — parâmetro que some em silêncio vira regra que ninguém
-- escolheu.
--
-- Os valores abaixo são os padrões do documento de diretrizes (seção
-- "Configuração e campanhas"). `travado = true` = só a franqueadora altera.
-- Parâmetros que a unidade pode ajustar "dentro de faixa" nascem SEM faixa
-- (min/max vazios): a franqueadora define a faixa na tela de configurações
-- (IND2) antes de liberar para as unidades.
--
-- Idempotente: os padrões têm data de vigência FIXA, então rodar de novo não
-- duplica (on conflict do nothing).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Parâmetros padrão da rede
-- -----------------------------------------------------------------------------
insert into indica.config (escopo, unidade_id, grupo, chave, valor, travado, descricao, vigente_desde)
values
  -- Pontuação
  ('rede', null, 'pontuacao', 'pontos_registro', '50', false,
   'Riso Coins pela indicação registrada (ficam pendentes até o comparecimento).', '2026-01-01 00:00-03'),
  ('rede', null, 'pontuacao', 'pontos_comparecimento', '150', false,
   'Riso Coins quando o indicado comparece à avaliação (e libera os pendentes).', '2026-01-01 00:00-03'),
  ('rede', null, 'pontuacao', 'pontos_fechamento', '200', false,
   'Riso Coins no fechamento do tratamento (ficam em carência).', '2026-01-01 00:00-03'),
  ('rede', null, 'pontuacao', 'bonus_percentual_valor_fechado', '0', true,
   'Bônus em Riso Coins como % do valor fechado (em reais). 0 = desligado.', '2026-01-01 00:00-03'),
  ('rede', null, 'pontuacao', 'carencia_dias', '30', true,
   'Dias de carência dos pontos de fechamento, se a 1ª parcela não for paga antes.', '2026-01-01 00:00-03'),
  ('rede', null, 'pontuacao', 'carencia_libera_na_primeira_parcela', 'true', true,
   'A carência termina antes do prazo quando a 1ª parcela da negociação é paga.', '2026-01-01 00:00-03'),
  ('rede', null, 'pontuacao', 'validade_riso_coins_meses', '12', true,
   'Meses de validade dos Riso Coins depois de liberados.', '2026-01-01 00:00-03'),
  ('rede', null, 'pontuacao', 'teto_conversoes_12_meses', '20', true,
   'Fechamentos por Embaixador nos últimos 12 meses que ainda geram pontos.', '2026-01-01 00:00-03'),
  ('rede', null, 'pontuacao', 'combinar_multiplicadores', '"maior"', true,
   'Como somar nível e campanha: "maior" (usa o maior) ou "multiplicar".', '2026-01-01 00:00-03'),
  -- Atribuição
  ('rede', null, 'atribuicao', 'trava_atribuicao_dias', '90', true,
   'Dias em que a indicação fica presa a quem indicou; sem comparecimento, expira.', '2026-01-01 00:00-03'),
  ('rede', null, 'atribuicao', 'janela_cliente_novo_meses', '24', true,
   'Só pode ser indicado quem não teve atendimento na rede neste período.', '2026-01-01 00:00-03'),
  -- Indicado
  ('rede', null, 'indicado', 'beneficio_indicado_percentual', '10', false,
   'Presente de boas-vindas no 1º plano do indicado (%).', '2026-01-01 00:00-03'),
  ('rede', null, 'indicado', 'beneficio_validade_dias', '60', false,
   'Dias de validade do presente de boas-vindas após a avaliação.', '2026-01-01 00:00-03'),
  -- Resgate
  ('rede', null, 'resgate', 'resgate_aprovacao_acima', '2000', false,
   'Resgates acima deste custo em Riso Coins precisam de aprovação do gestor.', '2026-01-01 00:00-03'),
  -- Níveis
  ('rede', null, 'niveis', 'niveis_janela_meses', '12', true,
   'Janela móvel (meses) de fechamentos para calcular o nível.', '2026-01-01 00:00-03'),
  -- Equipe
  ('rede', null, 'equipe', 'premio_individual_percentual_origem', '50', true,
   'Parte do prêmio individual por conversão de quem pediu (o resto é de quem fechou).', '2026-01-01 00:00-03'),
  -- Regulamento e portal
  ('rede', null, 'regulamento', 'regulamento_versao_vigente', '"2026.1"', true,
   'Versão do regulamento que o Embaixador precisa ter aceitado.', '2026-01-01 00:00-03'),
  ('rede', null, 'portal', 'portal_link_validade_dias', '30', true,
   'Dias de validade do link mágico do portal do Embaixador.', '2026-01-01 00:00-03'),
  -- LGPD
  ('rede', null, 'lgpd', 'consentimento_prazo_dias', '7', true,
   'Dias para o indicado aceitar o convite; sem aceite, os dados são anonimizados.', '2026-01-01 00:00-03'),
  ('rede', null, 'lgpd', 'anonimizar_encerradas_apos_meses', '12', true,
   'Meses depois do encerramento para anonimizar indicações expiradas/recusadas.', '2026-01-01 00:00-03'),
  -- Antifraude (alertas da IND5)
  ('rede', null, 'antifraude', 'fraude_volume_max_indicacoes', '5', true,
   'Indicações do mesmo Embaixador na janela que disparam alerta.', '2026-01-01 00:00-03'),
  ('rede', null, 'antifraude', 'fraude_volume_janela_dias', '7', true,
   'Janela (dias) do alerta de volume atípico.', '2026-01-01 00:00-03'),
  ('rede', null, 'antifraude', 'fraude_conluio_percentual', '50', true,
   '% das indicações de um Embaixador concentradas num Risartano que dispara alerta.', '2026-01-01 00:00-03'),
  ('rede', null, 'antifraude', 'fraude_ajustes_mes_max', '3', true,
   'Ajustes manuais do mesmo usuário no mês que disparam alerta.', '2026-01-01 00:00-03')
on conflict on constraint config_versao_unica do nothing;

-- -----------------------------------------------------------------------------
-- 2) Níveis padrão (tabela da seção "Arquitetura do programa")
-- -----------------------------------------------------------------------------
insert into indica.niveis (codigo, nome, ordem, criterio_conversoes, multiplicador, beneficios)
values
  ('amigo', 'Amigo +Risos', 1, 0, 1.00, 'Boas-vindas ao programa e link pessoal'),
  ('embaixador', 'Embaixador', 2, 1, 1.00, 'Certificado digital e acesso ao catálogo completo'),
  ('ouro', 'Embaixador Ouro', 3, 3, 1.20, 'Prioridade de agenda e mimo na próxima consulta'),
  ('diamante', 'Embaixador Diamante', 4, 6, 1.50,
   'Convite para o evento anual de embaixadores e experiências exclusivas')
on conflict (codigo) do nothing;

-- -----------------------------------------------------------------------------
-- 3) A unidade só grava parâmetro que a rede liberou, dentro da faixa
-- -----------------------------------------------------------------------------
create or replace function indica.config_confere_unidade()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rede indica.config;
  v numeric;
begin
  if new.unidade_id is null then
    return new;
  end if;

  select * into v_rede
    from indica.config
   where unidade_id is null and chave = new.chave and vigente_desde <= new.vigente_desde
   order by vigente_desde desc
   limit 1;

  if not found then
    raise exception 'INDICA_CONFIG_AUSENTE: a rede não tem o parâmetro "%"; a unidade não pode criar um.', new.chave;
  end if;
  if v_rede.travado then
    raise exception 'INDICA_CONFIG_TRAVADA: "%" é definido só pela franqueadora.', new.chave;
  end if;
  if jsonb_typeof(new.valor) is distinct from jsonb_typeof(v_rede.valor) then
    raise exception 'INDICA_CONFIG_TIPO: "%" precisa ser do mesmo tipo do padrão da rede.', new.chave;
  end if;
  if jsonb_typeof(new.valor) = 'number' then
    v := (new.valor #>> '{}')::numeric;
    if (v_rede.min is not null and v < v_rede.min) or (v_rede.max is not null and v > v_rede.max) then
      raise exception 'INDICA_CONFIG_FORA_DA_FAIXA: "%" precisa ficar entre % e %.',
        new.chave, coalesce(v_rede.min::text, '—'), coalesce(v_rede.max::text, '—');
    end if;
  end if;
  -- Faixa e trava da linha da unidade não valem nada: não guardar para não confundir.
  new.min := null;
  new.max := null;
  new.travado := false;
  return new;
end;
$$;

drop trigger if exists config_confere_unidade on indica.config;
create trigger config_confere_unidade
  before insert on indica.config
  for each row execute function indica.config_confere_unidade();

-- -----------------------------------------------------------------------------
-- 4) Leitura em cascata
-- -----------------------------------------------------------------------------
-- Vale a linha mais recente (vigente_desde <= p_em) da unidade, se a rede não
-- travou o parâmetro; senão, a da rede. Número da unidade fora da faixa ATUAL
-- da rede é trazido para dentro dela (a franqueadora pode apertar a faixa
-- depois que a unidade gravou).
create or replace function indica.config_valor(
  p_chave text,
  p_unidade_id uuid default null,
  p_em timestamptz default now()
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_rede indica.config;
  v_uni indica.config;
  v numeric;
begin
  select * into v_rede
    from indica.config
   where unidade_id is null and chave = p_chave and vigente_desde <= p_em
   order by vigente_desde desc
   limit 1;

  if not found then
    raise exception 'INDICA_CONFIG_AUSENTE: parâmetro "%" não existe na configuração da rede.', p_chave;
  end if;

  if p_unidade_id is not null and not v_rede.travado then
    select * into v_uni
      from indica.config
     where unidade_id = p_unidade_id and chave = p_chave and vigente_desde <= p_em
     order by vigente_desde desc
     limit 1;

    if found then
      if jsonb_typeof(v_uni.valor) = 'number' then
        v := (v_uni.valor #>> '{}')::numeric;
        if v_rede.min is not null and v < v_rede.min then v := v_rede.min; end if;
        if v_rede.max is not null and v > v_rede.max then v := v_rede.max; end if;
        return to_jsonb(v);
      end if;
      return v_uni.valor;
    end if;
  end if;

  return v_rede.valor;
end;
$$;

create or replace function indica.config_numero(
  p_chave text,
  p_unidade_id uuid default null,
  p_em timestamptz default now()
)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v jsonb := indica.config_valor(p_chave, p_unidade_id, p_em);
begin
  if jsonb_typeof(v) <> 'number' then
    raise exception 'INDICA_CONFIG_TIPO: "%" deveria ser número e é %.', p_chave, jsonb_typeof(v);
  end if;
  return (v #>> '{}')::numeric;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5) A REGRA VIGENTE — o que fica congelado na indicação no momento do registro
-- -----------------------------------------------------------------------------
-- Base (rede/unidade) + campanha (se houver). A campanha precisa estar ATIVA,
-- no período e alcançar a unidade. Chaves que a campanha pode trazer em
-- `regras` (o motor completo vem na IND4):
--   "multiplicador": número >= 1
--   "pontos_extra": {"registro": n, "comparecimento": n, "fechamento": n}
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
-- 6) A CONTA dos pontos de uma etapa (pura: tudo vem por parâmetro)
-- -----------------------------------------------------------------------------
-- base = pontos da etapa + extra da campanha
-- multiplicador = nível e campanha combinados pela regra ("maior" ou "multiplicar")
-- fechamento ainda soma o bônus % sobre o valor fechado (em reais, sem
-- multiplicador — é proporcional ao valor, não ao esforço).
create or replace function indica.calcular_pontos(
  p_regra jsonb,
  p_etapa text,
  p_multiplicador_nivel numeric,
  p_valor_centavos bigint default 0
)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_base numeric;
  v_mult_camp numeric := coalesce((p_regra #>> '{campanha,multiplicador}')::numeric, 1);
  v_mult numeric;
  v_pontos numeric;
begin
  if p_etapa not in ('registro', 'comparecimento', 'fechamento') then
    raise exception 'INDICA_ETAPA_INVALIDA: %', p_etapa;
  end if;
  if (p_regra #> array['pontos', p_etapa]) is null then
    raise exception 'INDICA_CONFIG_AUSENTE: a regra congelada não tem pontos de "%".', p_etapa;
  end if;

  v_base := (p_regra #>> array['pontos', p_etapa])::numeric
          + coalesce((p_regra #>> array['campanha', 'pontos_extra', p_etapa])::numeric, 0);

  v_mult := case p_regra #>> '{combinar_multiplicadores}'
              when 'multiplicar' then p_multiplicador_nivel * v_mult_camp
              when 'maior' then greatest(p_multiplicador_nivel, v_mult_camp)
            end;
  if v_mult is null then
    raise exception 'INDICA_CONFIG_TIPO: combinar_multiplicadores precisa ser "maior" ou "multiplicar".';
  end if;

  v_pontos := round(v_base * v_mult);

  if p_etapa = 'fechamento' then
    v_pontos := v_pontos + floor(
      coalesce(p_valor_centavos, 0) / 100.0
      * coalesce((p_regra #>> '{bonus_percentual_valor_fechado}')::numeric, 0) / 100.0
    );
  end if;

  return greatest(v_pontos, 0)::integer;
end;
$$;

-- -----------------------------------------------------------------------------
-- 7) Permissões (AP15: tirar de anon/authenticated pelo nome, depois conceder)
-- -----------------------------------------------------------------------------
revoke execute on function indica.config_confere_unidade() from public, anon, authenticated;
revoke execute on function indica.config_valor(text, uuid, timestamptz) from public, anon, authenticated;
revoke execute on function indica.config_numero(text, uuid, timestamptz) from public, anon, authenticated;
revoke execute on function indica.regra_vigente(uuid, uuid, timestamptz) from public, anon, authenticated;
revoke execute on function indica.calcular_pontos(jsonb, text, numeric, bigint) from public, anon, authenticated;

-- Ler parâmetros e simular a regra é útil às telas (config não é dado pessoal).
grant execute on function indica.config_valor(text, uuid, timestamptz) to authenticated, service_role;
grant execute on function indica.config_numero(text, uuid, timestamptz) to authenticated, service_role;
grant execute on function indica.regra_vigente(uuid, uuid, timestamptz) to authenticated, service_role;
grant execute on function indica.calcular_pontos(jsonb, text, numeric, bigint) to authenticated, service_role;

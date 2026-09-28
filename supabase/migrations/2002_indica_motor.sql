-- =============================================================================
-- 2002 — Indica +Risos (IND0, parte 3): o MOTOR
-- -----------------------------------------------------------------------------
-- A única porta de escrita do programa:
--   criar_embaixador      cliente + aceite do regulamento vigente → Embaixador
--   registrar_indicacao   nasce a indicação (+ pontos pendentes)
--   avancar_status        toda mudança de status: valida a sequência, grava o
--                         evento e os lançamentos com a regra congelada
--   recalcular_nivel      nível pela janela móvel de fechamentos
--   gerar_link_portal /   o "perfil embaixador": link mágico validado no
--   portal_embaixador     servidor; devolve só os dados daquele Embaixador
-- E as duas visões: v_saldo_embaixador (saldo = soma do extrato) e v_funil.
--
-- Como os pontos andam (valores vêm da regra congelada no registro):
--   registrada  → +registro   no PENDENTE
--   compareceu  → +comparecimento no DISPONÍVEL, e o pendente passa a disponível
--   fechou      → +fechamento (+ bônus %) na CARÊNCIA, libera_em = fechamento + carência
--   convertida  → a carência passa a disponível (prazo cumprido ou 1ª parcela paga)
--   cancelada   → estorna a carência
--   recusada / expirada → estorna o pendente
-- O multiplicador de NÍVEL é o do momento de cada lançamento ("vale só para
-- pontos novos"); base e campanha são as do registro (a promessa feita ao
-- Embaixador).
--
-- Idempotente (create or replace; drop de views antes de recriar).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Máquina de estados — a tabela das transições permitidas
-- -----------------------------------------------------------------------------
-- ⚠️ Espelhada em src/lib/indica/status.ts; o teste indica-status.test.ts lê
-- ESTE bloco e reprova se os dois divergirem.
create or replace function indica.transicao_permitida(p_de text, p_para text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_para = any (case p_de
    when 'registrada' then array['validada', 'recusada', 'expirada']
    when 'validada'   then array['agendada', 'recusada', 'expirada']
    when 'agendada'   then array['agendada', 'compareceu', 'faltou', 'recusada', 'expirada']
    when 'faltou'     then array['agendada', 'expirada']
    when 'compareceu' then array['fechou', 'nao_fechou']
    when 'nao_fechou' then array['fechou', 'expirada']
    when 'fechou'     then array['convertida', 'cancelada']
    else array[]::text[]
  end);
$$;

-- -----------------------------------------------------------------------------
-- 2) Peças internas (sem guarda — ninguém de fora executa)
-- -----------------------------------------------------------------------------

-- "Cliente novo" = sem atendimento (check-in que não virou desistência) na
-- rede dentro da janela. O agendamento da própria indicação não conta.
create or replace function indica.cliente_elegivel(
  p_cliente_id uuid,
  p_janela_meses integer,
  p_excluir_agendamento uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1
      from public.appointments a
     where a.client_id = p_cliente_id
       and a.checked_in_at is not null
       and a.checked_in_at >= now() - make_interval(months => p_janela_meses)
       and coalesce(a.attendance::text, '') <> 'gave_up'
       and a.id is distinct from p_excluir_agendamento
  );
$$;

-- Grava UMA linha no extrato. Abre a trava só durante o insert e devolve o
-- estado anterior (funções do motor chamam umas às outras).
create or replace function indica._lancar(
  p_embaixador_id uuid,
  p_indicacao_id uuid,
  p_tipo text,
  p_saldo text,
  p_riso_coins integer,
  p_regra jsonb,
  p_libera_em timestamptz default null,
  p_expira_em timestamptz default null,
  p_unidade_custo_id uuid default null,
  p_origem_id bigint default null,
  p_motivo text default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_antes text := coalesce(current_setting('indica.motor', true), '');
  v_id bigint;
begin
  perform set_config('indica.motor', 'sim', true);
  insert into indica.pontos_lancamentos
    (embaixador_id, indicacao_id, tipo, saldo, riso_coins, regra_aplicada,
     libera_em, expira_em, unidade_custo_id, origem_id, motivo, criado_por)
  values
    (p_embaixador_id, p_indicacao_id, p_tipo, p_saldo, p_riso_coins, p_regra,
     p_libera_em, p_expira_em, p_unidade_custo_id, p_origem_id, p_motivo, auth.uid())
  returning id into v_id;
  perform set_config('indica.motor', v_antes, true);
  return v_id;
end;
$$;

-- Pontos de uma ETAPA para a indicação (registro, comparecimento, fechamento).
-- Devolve quantos pontos lançou (0 se não houver Embaixador ou teto atingido).
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
begin
  select * into v from indica.indicacoes where id = p_indicacao_id;
  if v.embaixador_id is null then
    return 0;  -- parceiro indicador: recompensa definida em contrato, fora do extrato
  end if;

  select n.codigo, n.multiplicador into v_nivel
    from indica.embaixadores e
    join indica.niveis n on n.id = e.nivel_id
   where e.id = v.embaixador_id;

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
      v.regra_congelada, p_etapa, v_nivel.multiplicador, coalesce(v.valor_fechado_centavos, 0)
    );
  end if;

  v_regra := v.regra_congelada || jsonb_build_object(
    'etapa', p_etapa,
    'nivel', v_nivel.codigo,
    'multiplicador_nivel', v_nivel.multiplicador,
    'fechamentos_12_meses', v_fechamentos,
    'teto_atingido', v_teto_atingido
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

-- Tira TUDO o que a indicação tem num saldo (pendente ou carência):
-- 'liberacao' → vai para o disponível; 'estorno' → sai do programa.
create or replace function indica._mover_saldo(p_indicacao_id uuid, p_de text, p_tipo text, p_motivo text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v indica.indicacoes;
  v_total integer;
  v_regra jsonb;
  v_saida bigint;
begin
  if p_de not in ('pendente', 'carencia') or p_tipo not in ('liberacao', 'estorno') then
    raise exception 'INDICA_MOVIMENTO_INVALIDO: % de %', p_tipo, p_de;
  end if;

  select * into v from indica.indicacoes where id = p_indicacao_id;
  if v.embaixador_id is null then
    return 0;
  end if;

  select coalesce(sum(riso_coins), 0) into v_total
    from indica.pontos_lancamentos
   where indicacao_id = p_indicacao_id and saldo = p_de;

  if v_total <= 0 then
    return 0;
  end if;

  v_regra := v.regra_congelada || jsonb_build_object('movimento', p_tipo, 'de', p_de);

  v_saida := indica._lancar(v.embaixador_id, v.id, p_tipo, p_de, -v_total, v_regra,
                            null, null, v.unidade_id, null, p_motivo);

  if p_tipo = 'liberacao' then
    perform indica._lancar(v.embaixador_id, v.id, 'liberacao', 'disponivel', v_total, v_regra,
                           null,
                           now() + make_interval(months => (v.regra_congelada ->> 'validade_riso_coins_meses')::integer),
                           v.unidade_id, v_saida, p_motivo);
  end if;

  return v_total;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3) Código pessoal do Embaixador (ex.: JOAO27)
-- -----------------------------------------------------------------------------
create or replace function indica.gerar_codigo_embaixador(p_nome text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_base text;
  v_codigo text;
  v_digitos integer;
  i integer := 0;
begin
  v_base := upper(translate(
    split_part(btrim(coalesce(p_nome, '')), ' ', 1),
    'áàãâäéèêëíìîïóòõôöúùûüçñÁÀÃÂÄÉÈÊËÍÌÎÏÓÒÕÔÖÚÙÛÜÇÑ',
    'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN'
  ));
  v_base := left(regexp_replace(v_base, '[^A-Z]', '', 'g'), 6);
  if length(v_base) < 2 then
    v_base := 'RISO';
  end if;

  loop
    i := i + 1;
    v_digitos := case when i <= 20 then 2 else 4 end;
    v_codigo := v_base || (floor(random() * 9 * 10 ^ (v_digitos - 1)) + 10 ^ (v_digitos - 1))::bigint::text;
    exit when not exists (select 1 from indica.embaixadores where codigo = v_codigo);
    if i >= 60 then
      raise exception 'INDICA_CODIGO: não foi possível gerar um código livre para %.', v_base;
    end if;
  end loop;

  return v_codigo;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4) Criar Embaixador
-- -----------------------------------------------------------------------------
create or replace function indica.criar_embaixador(
  p_cliente_id uuid,
  p_versao_regulamento text,
  p_aceite_em timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_cli record;
  v_vigente text;
  v_nivel uuid;
  v_id uuid;
begin
  select id, clinic_id, preferred_clinic_id, full_name, status::text as status
    into v_cli
    from public.clients where id = p_cliente_id;
  if not found then
    raise exception 'INDICA_CLIENTE_NAO_ENCONTRADO: cliente não encontrado.';
  end if;

  if v_uid is not null
     and not indica.eh_risartano(v_cli.clinic_id)
     and not (v_cli.preferred_clinic_id is not null and indica.eh_risartano(v_cli.preferred_clinic_id)) then
    raise exception 'INDICA_SEM_PERMISSAO: você não atende este cliente.';
  end if;
  if v_cli.status = 'anonymized' then
    raise exception 'INDICA_CLIENTE_ANONIMIZADO: cadastro anonimizado não pode virar Embaixador.';
  end if;

  v_vigente := indica.config_valor('regulamento_versao_vigente') #>> '{}';
  if p_versao_regulamento is distinct from v_vigente then
    raise exception 'INDICA_REGULAMENTO_DESATUALIZADO: o aceite precisa ser do regulamento vigente (%).', v_vigente;
  end if;
  if p_aceite_em is null or p_aceite_em > now() + interval '5 minutes' then
    raise exception 'INDICA_ACEITE_INVALIDO: informe quando o regulamento foi aceito.';
  end if;

  select id into v_id from indica.embaixadores where cliente_id = p_cliente_id;
  if found then
    -- Já é Embaixador: só renova o aceite quando a versão mudou.
    update indica.embaixadores
       set aceite_regulamento_em = p_aceite_em, versao_regulamento = p_versao_regulamento
     where id = v_id and versao_regulamento is distinct from p_versao_regulamento;
    return v_id;
  end if;

  select id into v_nivel from indica.niveis where ativo order by ordem limit 1;
  if v_nivel is null then
    raise exception 'INDICA_CONFIG_AUSENTE: não há nível ativo cadastrado.';
  end if;

  insert into indica.embaixadores
    (cliente_id, codigo, nivel_id, aceite_regulamento_em, versao_regulamento,
     unidade_cadastro_id, criado_por)
  values
    (p_cliente_id, indica.gerar_codigo_embaixador(v_cli.full_name), v_nivel, p_aceite_em,
     p_versao_regulamento, v_cli.clinic_id, v_uid)
  returning id into v_id;

  if v_uid is not null then
    insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
    values (v_uid, v_cli.clinic_id, 'create', 'indica_embaixador', v_id::text,
            jsonb_build_object('versao_regulamento', p_versao_regulamento));
  end if;

  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5) Mudança de status (interna — a porta com guarda é `avancar_status`)
-- -----------------------------------------------------------------------------
create or replace function indica._mudar_status(
  p_indicacao_id uuid,
  p_novo text,
  p_motivo text,
  p_dados jsonb,
  p_usuario uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v indica.indicacoes;
  v_antes text := coalesce(current_setting('indica.motor', true), '');
  v_agora timestamptz := now();
  v_ag record;
  v_venda record;
  v_emb_cliente uuid;
  v_outra text;
  v_janela integer;
  v_libera_em timestamptz;
  v_parcela_paga boolean;
  v_evento jsonb := '{}'::jsonb;
  v_pontos integer;
begin
  select * into v from indica.indicacoes where id = p_indicacao_id for update;
  if not found then
    raise exception 'INDICA_NAO_ENCONTRADA: indicação não encontrada.';
  end if;

  if not indica.transicao_permitida(v.status, p_novo) then
    raise exception 'INDICA_TRANSICAO_INVALIDA: de "%" para "%" não é permitido.', v.status, p_novo;
  end if;

  if p_novo in ('recusada', 'cancelada', 'nao_fechou') and nullif(btrim(p_motivo), '') is null then
    raise exception 'INDICA_MOTIVO_OBRIGATORIO: informe o motivo.';
  end if;

  -- Trava de atribuição: enquanto o indicado não comparece (ou depois do "não
  -- fechou"), a indicação vive até `trava_ate`. Passou disso, só expira.
  if p_novo in ('validada', 'agendada', 'compareceu', 'fechou')
     and v.status in ('registrada', 'validada', 'agendada', 'faltou', 'nao_fechou')
     and v_agora > v.trava_ate then
    raise exception 'INDICA_TRAVA_VENCIDA: a trava de atribuição venceu em %; a indicação deve ser expirada.',
      to_char(v.trava_ate at time zone 'America/Sao_Paulo', 'DD/MM/YYYY');
  end if;
  if p_novo = 'expirada' and v_agora <= v.trava_ate then
    raise exception 'INDICA_TRAVA_ATIVA: a trava de atribuição vale até %; para encerrar antes, recuse com motivo.',
      to_char(v.trava_ate at time zone 'America/Sao_Paulo', 'DD/MM/YYYY');
  end if;

  if v.embaixador_id is not null then
    select cliente_id into v_emb_cliente from indica.embaixadores where id = v.embaixador_id;
  end if;

  -- ---- AGENDADA: liga o agendamento da AVALIAÇÃO (e, com ele, o cliente) ----
  if p_novo = 'agendada' then
    select a.id, a.client_id, a.type::text as tipo, a.status::text as situacao
      into v_ag
      from public.appointments a
     where a.id = coalesce((p_dados ->> 'agendamento_id')::uuid, v.agendamento_id);
    if not found then
      raise exception 'INDICA_AGENDAMENTO_OBRIGATORIO: informe o agendamento da avaliação.';
    end if;
    if v_ag.tipo <> 'evaluation' then
      raise exception 'INDICA_AGENDAMENTO_INVALIDO: a indicação anda com o agendamento da AVALIAÇÃO.';
    end if;
    if v_ag.situacao in ('cancelled', 'no_show') then
      raise exception 'INDICA_AGENDAMENTO_INVALIDO: este agendamento está cancelado ou marcado como falta.';
    end if;
    if v.cliente_indicado_id is not null and v_ag.client_id <> v.cliente_indicado_id then
      raise exception 'INDICA_AGENDAMENTO_DE_OUTRO_CLIENTE: o agendamento é de outro cliente.';
    end if;

    if v.cliente_indicado_id is null then
      -- Primeira vez que a indicação encontra um cadastro: mesmas conferências do registro.
      if v_ag.client_id = v_emb_cliente then
        raise exception 'INDICA_AUTOINDICACAO: o Embaixador não pode indicar a si mesmo.';
      end if;
      v_janela := (indica.config_numero('janela_cliente_novo_meses', v.unidade_id))::integer;
      if not indica.cliente_elegivel(v_ag.client_id, v_janela, v_ag.id) then
        raise exception 'INDICA_JA_E_CLIENTE: o indicado teve atendimento na rede nos últimos % meses.', v_janela;
      end if;
      select codigo into v_outra
        from indica.indicacoes
       where cliente_indicado_id = v_ag.client_id and id <> v.id
         and status not in ('recusada', 'cancelada', 'expirada')
       limit 1;
      if v_outra is not null then
        raise exception 'INDICA_DUPLICADA: esta pessoa já tem a indicação % em aberto. Vale o primeiro registro.', v_outra;
      end if;
    end if;

    v.cliente_indicado_id := v_ag.client_id;
    v.agendamento_id := v_ag.id;
    v.agendada_em := coalesce(v.agendada_em, v_agora);
    v_evento := jsonb_build_object('agendamento_id', v_ag.id);

    -- "Indicado por" do cadastro (o mesmo campo que o PPR+ usa), só se vazio
    -- e se o indicado não pediu para ser desligado de quem indicou.
    if v_emb_cliente is not null and v.desvinculada_em is null then
      update public.clients
         set referred_by_client_id = v_emb_cliente
       where id = v_ag.client_id and referred_by_client_id is null;
    end if;

  -- ---- COMPARECEU: check-in real da avaliação ----
  elsif p_novo = 'compareceu' then
    select a.id, a.client_id, a.type::text as tipo, a.status::text as situacao,
           a.checked_in_at, a.attendance::text as presenca
      into v_ag
      from public.appointments a
     where a.id = coalesce((p_dados ->> 'agendamento_id')::uuid, v.agendamento_id);
    if not found then
      raise exception 'INDICA_AGENDAMENTO_OBRIGATORIO: informe o agendamento da avaliação.';
    end if;
    if v_ag.client_id is distinct from v.cliente_indicado_id then
      raise exception 'INDICA_AGENDAMENTO_DE_OUTRO_CLIENTE: o agendamento é de outro cliente.';
    end if;
    if v_ag.tipo <> 'evaluation' then
      raise exception 'INDICA_AGENDAMENTO_INVALIDO: o comparecimento que conta é o da AVALIAÇÃO.';
    end if;
    if v_ag.checked_in_at is null or coalesce(v_ag.presenca, '') = 'gave_up'
       or v_ag.situacao in ('cancelled', 'no_show') then
      raise exception 'INDICA_SEM_COMPARECIMENTO: a recepção ainda não registrou a chegada do indicado nesta avaliação.';
    end if;
    v.agendamento_id := v_ag.id;
    v.compareceu_em := v_ag.checked_in_at;
    v_evento := jsonb_build_object('agendamento_id', v_ag.id);

  -- ---- FECHOU: venda com contrato assinado E pagamento confirmado ----
  elsif p_novo = 'fechou' then
    select s.id, s.client_id, s.negotiation_id, s.final_cents, s.closed_at, s.cancelled_at,
           n.consultant_id
      into v_venda
      from public.commercial_sales s
      join public.plan_negotiations n on n.id = s.negotiation_id
     where s.id = coalesce((p_dados ->> 'venda_id')::uuid, v.venda_id);
    if not found then
      raise exception 'INDICA_VENDA_OBRIGATORIA: informe a venda (fechamento do plano).';
    end if;
    if v_venda.client_id is distinct from v.cliente_indicado_id then
      raise exception 'INDICA_VENDA_DE_OUTRO_CLIENTE: a venda é de outro cliente.';
    end if;
    if v_venda.closed_at is null then
      raise exception 'INDICA_VENDA_NAO_FECHADA: só é fechamento com contrato assinado e pagamento confirmado.';
    end if;
    if v_venda.cancelled_at is not null then
      raise exception 'INDICA_VENDA_CANCELADA: esta venda foi cancelada.';
    end if;
    select codigo into v_outra from indica.indicacoes where venda_id = v_venda.id and id <> v.id limit 1;
    if v_outra is not null then
      raise exception 'INDICA_VENDA_JA_USADA: esta venda já converteu a indicação %.', v_outra;
    end if;
    v.venda_id := v_venda.id;
    v.orcamento_id := v_venda.negotiation_id;
    v.valor_fechado_centavos := v_venda.final_cents;
    v.risartano_conversao_id := coalesce((p_dados ->> 'risartano_conversao_id')::uuid, v_venda.consultant_id);
    v.fechou_em := v_venda.closed_at;
    v_evento := jsonb_build_object('venda_id', v_venda.id);

  -- ---- CONVERTIDA: fim da carência ----
  elsif p_novo = 'convertida' then
    select s.cancelled_at into v_venda from public.commercial_sales s where s.id = v.venda_id;
    if not found then
      raise exception 'INDICA_VENDA_OBRIGATORIA: a venda desta indicação não existe mais.';
    end if;
    if v_venda.cancelled_at is not null then
      raise exception 'INDICA_VENDA_CANCELADA: a venda foi cancelada; a indicação deve ser cancelada (estorno).';
    end if;
    v_libera_em := v.fechou_em + make_interval(days => (v.regra_congelada ->> 'carencia_dias')::integer);
    select exists (
      select 1 from public.payment_installments p
       where p.negotiation_id = v.orcamento_id
         and p.status = 'paga'
         and p.seq = (select min(q.seq) from public.payment_installments q
                       where q.negotiation_id = v.orcamento_id and q.status <> 'cancelada')
    ) into v_parcela_paga;
    if not (v_agora >= v_libera_em
            or (coalesce((v.regra_congelada ->> 'carencia_libera_na_primeira_parcela')::boolean, false)
                and v_parcela_paga)) then
      raise exception 'INDICA_CARENCIA: os pontos ficam em carência até % ou até a 1ª parcela ser paga.',
        to_char(v_libera_em at time zone 'America/Sao_Paulo', 'DD/MM/YYYY');
    end if;
    v.convertida_em := v_agora;
    v_evento := jsonb_build_object('primeira_parcela_paga', v_parcela_paga,
                                   'carencia_ate', v_libera_em);
  end if;

  -- Carimbos das etapas simples e do encerramento.
  if p_novo = 'validada' then v.validada_em := v_agora; end if;
  if p_novo in ('convertida', 'recusada', 'cancelada', 'expirada') then
    v.encerrada_em := v_agora;
  end if;

  perform set_config('indica.motor', 'sim', true);

  update indica.indicacoes
     set status = p_novo,
         cliente_indicado_id = v.cliente_indicado_id,
         agendamento_id = v.agendamento_id,
         orcamento_id = v.orcamento_id,
         venda_id = v.venda_id,
         valor_fechado_centavos = v.valor_fechado_centavos,
         risartano_conversao_id = v.risartano_conversao_id,
         validada_em = v.validada_em,
         agendada_em = v.agendada_em,
         compareceu_em = v.compareceu_em,
         fechou_em = v.fechou_em,
         convertida_em = v.convertida_em,
         encerrada_em = v.encerrada_em
   where id = v.id;

  -- Pontos da etapa (sempre DEPOIS de gravar: a conta lê a indicação atualizada).
  if p_novo = 'compareceu' then
    v_pontos := indica._pontuar(v.id, 'comparecimento');
    v_evento := v_evento || jsonb_build_object(
      'pontos', v_pontos,
      'liberados', indica._mover_saldo(v.id, 'pendente', 'liberacao', 'Comparecimento à avaliação'));
  elsif p_novo = 'fechou' then
    v_evento := v_evento || jsonb_build_object('pontos', indica._pontuar(v.id, 'fechamento'));
  elsif p_novo = 'convertida' then
    v_evento := v_evento || jsonb_build_object(
      'liberados', indica._mover_saldo(v.id, 'carencia', 'liberacao', 'Fim da carência'));
  elsif p_novo = 'cancelada' then
    v_evento := v_evento || jsonb_build_object(
      'estornados', indica._mover_saldo(v.id, 'carencia', 'estorno', p_motivo));
  elsif p_novo in ('recusada', 'expirada') then
    v_evento := v_evento || jsonb_build_object(
      'estornados', indica._mover_saldo(v.id, 'pendente', 'estorno', coalesce(p_motivo, 'Trava de atribuição vencida')));
  end if;

  perform set_config('indica.motor', 'sim', true);
  insert into indica.indicacao_eventos (indicacao_id, status_de, status_para, motivo, dados, usuario_id)
  values (v.id, v.status, p_novo, nullif(btrim(p_motivo), ''), v_evento, p_usuario);
  perform set_config('indica.motor', v_antes, true);

  if p_usuario is not null then
    insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
    values (p_usuario, v.unidade_id, 'update', 'indica_indicacao', v.id::text,
            jsonb_build_object('de', v.status, 'para', p_novo));
  end if;

  return p_novo;
end;
$$;

-- -----------------------------------------------------------------------------
-- 6) A PORTA: avancar_status (a única mudança de status aceita)
-- -----------------------------------------------------------------------------
-- Risartano da unidade da indicação. Cancelar (estorna pontos) exige gestor.
-- Sem sessão (auth.uid() nulo) = chave de serviço / rotina agendada: `anon`
-- nem enxerga o schema, então nulo aqui nunca é um visitante anônimo.
create or replace function indica.avancar_status(
  p_indicacao_id uuid,
  p_novo_status text,
  p_motivo text default null,
  p_dados jsonb default '{}'::jsonb
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_unidade uuid;
begin
  select unidade_id into v_unidade from indica.indicacoes where id = p_indicacao_id;
  if not found then
    raise exception 'INDICA_NAO_ENCONTRADA: indicação não encontrada.';
  end if;
  if v_uid is not null and not indica.eh_risartano(v_unidade) then
    raise exception 'INDICA_SEM_PERMISSAO: esta indicação é de outra unidade.';
  end if;
  if p_novo_status = 'cancelada' and v_uid is not null and not indica.eh_gestor(v_unidade) then
    raise exception 'INDICA_SEM_PERMISSAO: cancelar (e estornar os pontos) é do gestor da unidade.';
  end if;
  return indica._mudar_status(p_indicacao_id, p_novo_status, p_motivo, coalesce(p_dados, '{}'::jsonb), v_uid);
end;
$$;

-- -----------------------------------------------------------------------------
-- 7) Registrar indicação
-- -----------------------------------------------------------------------------
-- p_dados: unidade_id, canal, indicado_nome, indicado_telefone, indicado_cpf,
--          indicado_email, cliente_indicado_id, embaixador_id | parceiro_id,
--          campanha_id, risartano_origem_id (padrão: quem registra).
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
  v_emb indica.embaixadores;
  v_emb_cli record;
  v_achados uuid[];
  v_janela integer;
  v_conflito record;
  v_regra jsonb;
  v_id uuid;
  v_pontos integer;
begin
  v_tel_d := nullif(regexp_replace(coalesce(v_tel, ''), '\D', '', 'g'), '');
  v_cpf_d := nullif(regexp_replace(coalesce(v_cpf, ''), '\D', '', 'g'), '');

  -- Unidade e permissão
  if v_unidade is null
     or not exists (select 1 from public.clinics c
                     where c.id = v_unidade and c.type = 'franchise_unit' and c.is_active) then
    raise exception 'INDICA_UNIDADE_INVALIDA: escolha a unidade que vai atender o indicado.';
  end if;
  if v_uid is not null and not indica.eh_risartano(v_unidade) then
    raise exception 'INDICA_SEM_PERMISSAO: você não é desta unidade.';
  end if;

  -- Dados mínimos do indicado
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

  -- Quem indicou: Embaixador OU parceiro, nunca os dois
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

  -- Uma registração por vez: "primeiro registro válido vence" precisa de fila.
  perform pg_advisory_xact_lock(hashtext('indica.registrar_indicacao'));

  -- Conciliação: o indicado já tem cadastro? (CPF primeiro; telefone só se único)
  if v_cliente is null then
    if v_cpf_d is not null then
      select c.id into v_cliente from public.clients c
       where public.cpf_digits(c.cpf) = v_cpf_d and c.status <> 'anonymized'
       limit 1;
    end if;
    if v_cliente is null and v_tel_d is not null then
      select array_agg(c.id) into v_achados from public.clients c
       where regexp_replace(coalesce(c.phone, ''), '\D', '', 'g') = v_tel_d
         and c.status <> 'anonymized';
      if coalesce(cardinality(v_achados), 0) = 1 then
        v_cliente := v_achados[1];
      end if;
    end if;
  elsif not exists (select 1 from public.clients c where c.id = v_cliente and c.status <> 'anonymized') then
    raise exception 'INDICA_CLIENTE_NAO_ENCONTRADO: cadastro do indicado não encontrado.';
  end if;

  -- Autoindicação (mesmo cadastro, CPF ou telefone de quem indica)
  if v_emb_id is not null then
    select c.id,
           public.cpf_digits(c.cpf) as cpf_d,
           nullif(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g'), '') as tel_d
      into v_emb_cli
      from public.clients c where c.id = v_emb.cliente_id;
    if v_cliente = v_emb_cli.id
       or (v_cpf_d is not null and v_cpf_d = v_emb_cli.cpf_d)
       or (v_tel_d is not null and v_tel_d = v_emb_cli.tel_d) then
      raise exception 'INDICA_AUTOINDICACAO: o Embaixador não pode indicar a si mesmo.';
    end if;
  end if;

  -- Elegibilidade: cliente novo na rede
  if v_cliente is not null then
    v_janela := (indica.config_numero('janela_cliente_novo_meses', v_unidade))::integer;
    if not indica.cliente_elegivel(v_cliente, v_janela) then
      raise exception 'INDICA_JA_E_CLIENTE: o indicado teve atendimento na rede nos últimos % meses.', v_janela;
    end if;
  end if;

  -- Duplicidade: vence o primeiro registro. Indicação com a trava vencida que a
  -- rotina ainda não expirou é expirada AGORA, e libera a pessoa.
  for v_conflito in
    select i.id, i.codigo, i.status, i.trava_ate
      from indica.indicacoes i
     where i.status not in ('recusada', 'cancelada', 'expirada')
       and ((v_tel_d is not null and i.indicado_telefone_digitos = v_tel_d)
         or (v_cpf_d is not null and i.indicado_cpf_digitos = v_cpf_d)
         or (v_cliente is not null and i.cliente_indicado_id = v_cliente))
     order by i.registrada_em
  loop
    if v_conflito.status in ('registrada', 'validada', 'agendada', 'faltou', 'nao_fechou')
       and v_conflito.trava_ate < now() then
      perform indica._mudar_status(v_conflito.id, 'expirada',
        'Trava de atribuição vencida (conferido ao registrar nova indicação).', '{}'::jsonb, v_uid);
    else
      raise exception 'INDICA_DUPLICADA: esta pessoa já foi indicada (%). Vale o primeiro registro.', v_conflito.codigo;
    end if;
  end loop;

  -- A regra do momento, congelada na indicação.
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

  v_pontos := indica._pontuar(v_id, 'registro');

  perform set_config('indica.motor', 'sim', true);
  insert into indica.indicacao_eventos (indicacao_id, status_de, status_para, dados, usuario_id)
  values (v_id, null, 'registrada',
          jsonb_build_object('canal', v_canal, 'pontos_pendentes', v_pontos,
                             'cadastro_encontrado', v_cliente is not null),
          v_uid);
  perform set_config('indica.motor', v_antes, true);

  if v_uid is not null then
    insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
    values (v_uid, v_unidade, 'create', 'indica_indicacao', v_id::text,
            jsonb_build_object('canal', v_canal));
  end if;

  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 8) Nível do Embaixador (janela móvel de fechamentos convertidos)
-- -----------------------------------------------------------------------------
-- A rotina mensal (IND3) chama para todos; a franqueadora pode chamar à mão.
create or replace function indica.recalcular_nivel(p_embaixador_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_janela integer := (indica.config_numero('niveis_janela_meses'))::integer;
  v_conversoes integer;
  v_nivel record;
begin
  if v_uid is not null and not indica.eh_franqueadora() then
    raise exception 'INDICA_SEM_PERMISSAO: recalcular nível é da franqueadora.';
  end if;

  select count(*) into v_conversoes
    from indica.indicacoes
   where embaixador_id = p_embaixador_id
     and status = 'convertida'
     and fechou_em >= now() - make_interval(months => v_janela);

  select id, codigo into v_nivel
    from indica.niveis
   where ativo and criterio_conversoes <= v_conversoes
   order by ordem desc
   limit 1;
  if not found then
    raise exception 'INDICA_CONFIG_AUSENTE: nenhum nível ativo atende % conversões.', v_conversoes;
  end if;

  update indica.embaixadores
     set nivel_id = v_nivel.id, nivel_recalculado_em = now()
   where id = p_embaixador_id;
  if not found then
    raise exception 'INDICA_NAO_ENCONTRADO: Embaixador não encontrado.';
  end if;

  return v_nivel.codigo;
end;
$$;

-- -----------------------------------------------------------------------------
-- 9) Visões — saldo (soma do extrato) e funil
-- -----------------------------------------------------------------------------
-- security_invoker: quem consulta a visão enxerga só o que a RLS das tabelas
-- deixa. "A vencer em 30 dias": o que sai do disponível (resgate, expiração,
-- ajuste negativo) consome primeiro o que vence primeiro.
drop view if exists indica.v_saldo_embaixador;
create view indica.v_saldo_embaixador with (security_invoker = true) as
select
  e.id as embaixador_id,
  e.cliente_id,
  e.codigo,
  coalesce(sum(l.riso_coins) filter (where l.saldo = 'disponivel'), 0)::integer as disponivel,
  coalesce(sum(l.riso_coins) filter (where l.saldo = 'pendente'), 0)::integer as pendente,
  coalesce(sum(l.riso_coins) filter (where l.saldo = 'carencia'), 0)::integer as em_carencia,
  greatest(0,
    coalesce(sum(l.riso_coins) filter (where l.saldo = 'disponivel' and l.riso_coins > 0
                                          and l.expira_em <= now() + interval '30 days'), 0)
    + coalesce(sum(l.riso_coins) filter (where l.saldo = 'disponivel' and l.riso_coins < 0), 0)
  )::integer as a_vencer_30_dias,
  coalesce(-sum(l.riso_coins) filter (where l.tipo = 'resgate'), 0)::integer as total_resgatado
from indica.embaixadores e
left join indica.pontos_lancamentos l on l.embaixador_id = e.id
group by e.id, e.cliente_id, e.codigo;

-- Funil por unidade e MÊS DO REGISTRO (coorte), no fuso de Brasília.
drop view if exists indica.v_funil;
create view indica.v_funil with (security_invoker = true) as
select
  i.unidade_id,
  date_trunc('month', i.registrada_em at time zone 'America/Sao_Paulo')::date as mes,
  count(*)::integer as registradas,
  count(*) filter (where i.validada_em is not null)::integer as validadas,
  count(*) filter (where i.agendada_em is not null)::integer as agendadas,
  count(*) filter (where i.compareceu_em is not null)::integer as compareceram,
  count(*) filter (where i.fechou_em is not null)::integer as fecharam,
  count(*) filter (where i.status = 'convertida')::integer as convertidas,
  count(*) filter (where i.status = 'recusada')::integer as recusadas,
  count(*) filter (where i.status = 'expirada')::integer as expiradas,
  count(*) filter (where i.status = 'cancelada')::integer as canceladas,
  coalesce(sum(i.valor_fechado_centavos) filter (where i.status = 'convertida'), 0)::bigint
    as receita_convertida_centavos
from indica.indicacoes i
group by i.unidade_id, date_trunc('month', i.registrada_em at time zone 'America/Sao_Paulo');

grant select on indica.v_saldo_embaixador, indica.v_funil to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 10) Perfil EMBAIXADOR — link mágico, sem login
-- -----------------------------------------------------------------------------
-- O banco guarda só o HASH do link (sha256). O link em si aparece uma vez, para
-- o Risartano enviar pelo WhatsApp; gerar outro invalida o anterior.
create or replace function indica.gerar_link_portal(p_embaixador_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_emb record;
  v_token text;
begin
  select e.id, e.status, c.clinic_id, c.preferred_clinic_id
    into v_emb
    from indica.embaixadores e
    join public.clients c on c.id = e.cliente_id
   where e.id = p_embaixador_id;
  if not found then
    raise exception 'INDICA_NAO_ENCONTRADO: Embaixador não encontrado.';
  end if;
  if v_uid is not null
     and not indica.eh_risartano(v_emb.clinic_id)
     and not (v_emb.preferred_clinic_id is not null and indica.eh_risartano(v_emb.preferred_clinic_id)) then
    raise exception 'INDICA_SEM_PERMISSAO: você não atende este cliente.';
  end if;
  if v_emb.status <> 'ativo' then
    raise exception 'INDICA_EMBAIXADOR_INATIVO: este Embaixador não está ativo no programa.';
  end if;

  -- 2 × uuid v4 = 244 bits aleatórios (gerador forte do Postgres).
  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');

  update indica.embaixadores
     set portal_token_hash = sha256(convert_to(v_token, 'UTF8')),
         portal_token_expira_em = now() + make_interval(
           days => (indica.config_numero('portal_link_validade_dias'))::integer)
   where id = p_embaixador_id;

  if v_uid is not null then
    insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
    values (v_uid, v_emb.clinic_id, 'create', 'indica_link_portal', p_embaixador_id::text, '{}'::jsonb);
  end if;

  return v_token;
end;
$$;

-- Tudo o que o Embaixador vê, a partir do link. Nunca diagnóstico, tratamento
-- ou valor do indicado — só a etapa. Só a CHAVE DE SERVIÇO executa: a página do
-- portal (IND3) valida o link no servidor e chama esta função.
create or replace function indica.portal_embaixador(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_emb record;
begin
  if p_token is null or length(p_token) < 40 then
    return null;
  end if;

  select e.id, e.codigo, c.full_name, n.codigo as nivel_codigo, n.nome as nivel_nome
    into v_emb
    from indica.embaixadores e
    join public.clients c on c.id = e.cliente_id
    join indica.niveis n on n.id = e.nivel_id
   where e.portal_token_hash = sha256(convert_to(p_token, 'UTF8'))
     and e.portal_token_expira_em > now()
     and e.status = 'ativo';
  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'embaixador', jsonb_build_object(
      'codigo', v_emb.codigo,
      'primeiro_nome', split_part(btrim(v_emb.full_name), ' ', 1),
      'nivel', jsonb_build_object('codigo', v_emb.nivel_codigo, 'nome', v_emb.nivel_nome)
    ),
    'saldo', (select jsonb_build_object(
                'disponivel', s.disponivel, 'pendente', s.pendente,
                'em_carencia', s.em_carencia, 'a_vencer_30_dias', s.a_vencer_30_dias)
                from indica.v_saldo_embaixador s where s.embaixador_id = v_emb.id),
    'indicacoes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'codigo', i.codigo,
               'indicado', case when i.anonimizada_em is not null or i.desvinculada_em is not null
                                then null else split_part(btrim(i.indicado_nome), ' ', 1) end,
               'etapa', i.status,
               'registrada_em', i.registrada_em)
             order by i.registrada_em desc)
        from indica.indicacoes i where i.embaixador_id = v_emb.id), '[]'::jsonb),
    'extrato', coalesce((
      select jsonb_agg(jsonb_build_object(
               'tipo', l.tipo, 'saldo', l.saldo, 'riso_coins', l.riso_coins,
               'indicacao', i.codigo, 'libera_em', l.libera_em, 'expira_em', l.expira_em,
               'criado_em', l.criado_em)
             order by l.id desc)
        from indica.pontos_lancamentos l
        left join indica.indicacoes i on i.id = l.indicacao_id
       where l.embaixador_id = v_emb.id), '[]'::jsonb)
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- 11) Permissões (AP15). Primeiro ninguém; depois só quem deve.
-- -----------------------------------------------------------------------------
revoke execute on all functions in schema indica from public, anon, authenticated;

-- Os helpers de perfil são usados dentro das políticas (2000).
grant execute on function indica.eh_franqueadora() to authenticated, service_role;
grant execute on function indica.eh_gestor(uuid) to authenticated, service_role;
grant execute on function indica.eh_risartano(uuid) to authenticated, service_role;
grant execute on function indica.eh_gestor_de_todas(uuid[]) to authenticated, service_role;
-- Leitura de configuração e simulação (2001).
grant execute on function indica.config_valor(text, uuid, timestamptz) to authenticated, service_role;
grant execute on function indica.config_numero(text, uuid, timestamptz) to authenticated, service_role;
grant execute on function indica.regra_vigente(uuid, uuid, timestamptz) to authenticated, service_role;
grant execute on function indica.calcular_pontos(jsonb, text, numeric, bigint) to authenticated, service_role;
grant execute on function indica.transicao_permitida(text, text) to authenticated, service_role;
-- As portas do motor (cada uma com a sua guarda).
grant execute on function indica.criar_embaixador(uuid, text, timestamptz) to authenticated, service_role;
grant execute on function indica.registrar_indicacao(jsonb) to authenticated, service_role;
grant execute on function indica.avancar_status(uuid, text, text, jsonb) to authenticated, service_role;
grant execute on function indica.recalcular_nivel(uuid) to authenticated, service_role;
grant execute on function indica.gerar_link_portal(uuid) to authenticated, service_role;
-- Portal: só o servidor.
grant execute on function indica.portal_embaixador(text) to service_role;
-- Internas (_lancar, _pontuar, _mover_saldo, _mudar_status, cliente_elegivel,
-- gerar_codigo_embaixador, gatilhos): nenhum grant, de propósito.

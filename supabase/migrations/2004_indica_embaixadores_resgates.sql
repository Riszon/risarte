-- =============================================================================
-- 2004 — Indica +Risos (IND2): Embaixadores, catálogo, resgates e ajuste
-- -----------------------------------------------------------------------------
-- Decisões do dono (28/09/2026):
--   * "Crédito Risarte" vira VOUCHER com código (ex.: RIS-7K4P-2QX9). O
--     consultor aplica como desconto na negociação, como já faz hoje, e marca
--     o voucher como usado aqui, ligado à negociação. Comercial e Financeiro
--     não mudam nesta fase.
--   * Validade do voucher = parâmetro da rede, padrão 90 dias.
--
-- Regras presas no banco:
--   * O resgate RESERVA os pontos no pedido (débito imediato no extrato):
--     ninguém gasta o mesmo saldo duas vezes. Recusar/cancelar DEVOLVE com uma
--     linha nova (`devolucao`) — o extrato continua só crescendo.
--   * Confere saldo, estoque, nível mínimo e se o item vale na unidade.
--   * Acima do limite (`resgate_aprovacao_acima`) o gestor aprova; abaixo,
--     nasce aprovado.
--   * Resgate só nasce e muda pelas funções (mesma trava das indicações).
--   * Ajuste manual: só gestor, motivo obrigatório, nunca deixa saldo negativo.
--
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Extrato: novo tipo `devolucao` (resgate recusado/cancelado)
-- -----------------------------------------------------------------------------
alter table indica.pontos_lancamentos drop constraint if exists pontos_lancamentos_tipo_check;
alter table indica.pontos_lancamentos add constraint pontos_lancamentos_tipo_check
  check (tipo in ('credito', 'pendente', 'carencia', 'liberacao', 'estorno',
                  'resgate', 'expiracao', 'ajuste', 'devolucao'));
alter table indica.pontos_lancamentos drop constraint if exists lancamentos_sinal;
alter table indica.pontos_lancamentos add constraint lancamentos_sinal check (
  case
    when tipo in ('credito', 'pendente', 'carencia', 'devolucao') then riso_coins > 0
    when tipo in ('estorno', 'resgate', 'expiracao') then riso_coins < 0
    else true
  end
);
alter table indica.pontos_lancamentos drop constraint if exists lancamentos_saldo_do_tipo;
alter table indica.pontos_lancamentos add constraint lancamentos_saldo_do_tipo check (
  case
    when tipo = 'pendente' then saldo = 'pendente'
    when tipo = 'carencia' then saldo = 'carencia'
    when tipo in ('credito', 'resgate', 'expiracao', 'ajuste', 'devolucao') then saldo = 'disponivel'
    else true
  end
);

-- -----------------------------------------------------------------------------
-- 2) Resgate: o que foi resgatado fica GRAVADO (o item do catálogo pode mudar
--    depois) e o voucher ganha validade e uso
-- -----------------------------------------------------------------------------
alter table indica.resgates
  add column if not exists item_nome text,
  add column if not exists item_tipo text,
  add column if not exists valor_centavos bigint,
  add column if not exists encerrado_por uuid references public.profiles (id),
  add column if not exists encerrado_em timestamptz,
  add column if not exists voucher_valido_ate timestamptz,
  add column if not exists voucher_usado_em timestamptz,
  add column if not exists voucher_usado_por uuid references public.profiles (id),
  add column if not exists voucher_negociacao_id uuid references public.plan_negotiations (id) on delete set null;

create unique index if not exists resgates_voucher_uq
  on indica.resgates (codigo_voucher) where codigo_voucher is not null;
create index if not exists resgates_unidade_status_idx on indica.resgates (unidade_id, status);

-- Trava: resgate nasce e muda só pelas funções (como a indicação).
create or replace function indica.resgate_so_pelo_motor()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'INDICA_RESGATE_NAO_SE_APAGA: resgate encerra por status (recusado, cancelado), nunca é apagado.';
  end if;
  if coalesce(current_setting('indica.motor', true), '') <> 'sim' then
    raise exception 'INDICA_FORA_DO_MOTOR: resgate só nasce e muda pelas funções do Indica +Risos.';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists resgates_trava on indica.resgates;
create trigger resgates_trava
  before insert or update or delete on indica.resgates
  for each row execute function indica.resgate_so_pelo_motor();

-- -----------------------------------------------------------------------------
-- 3) Parâmetro novo: validade do voucher (padrão 90 dias, decisão do dono)
-- -----------------------------------------------------------------------------
insert into indica.config (escopo, unidade_id, grupo, chave, valor, travado, descricao, vigente_desde)
values ('rede', null, 'resgate', 'voucher_validade_dias', '90', true,
        'Dias de validade do voucher de Crédito Risarte depois de entregue.', '2026-01-01 00:00-03')
on conflict on constraint config_versao_unica do nothing;

-- -----------------------------------------------------------------------------
-- 4) Peças internas
-- -----------------------------------------------------------------------------

-- A unidade "do Embaixador" = a do cadastro do cliente (e a preferida).
create or replace function indica._gestor_do_embaixador(p_embaixador_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select indica.eh_franqueadora()
      or exists (
        select 1
          from indica.embaixadores e
          join public.clients c on c.id = e.cliente_id
         where e.id = p_embaixador_id
           and (indica.eh_gestor(c.clinic_id)
                or (c.preferred_clinic_id is not null and indica.eh_gestor(c.preferred_clinic_id)))
      );
$$;

create or replace function indica._saldo_disponivel(p_embaixador_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(riso_coins), 0)::integer
    from indica.pontos_lancamentos
   where embaixador_id = p_embaixador_id and saldo = 'disponivel';
$$;

-- Código de voucher: RIS-XXXX-XXXX, sem letras que se confundem (0/O, 1/I/L),
-- sorteado do gerador FORTE do Postgres (bytes de gen_random_uuid).
create or replace function indica._gerar_codigo_voucher()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_alfabeto constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_bytes bytea;
  v_codigo text;
  i integer;
  tentativa integer := 0;
begin
  loop
    tentativa := tentativa + 1;
    v_bytes := uuid_send(gen_random_uuid());
    v_codigo := 'RIS-';
    for i in 0..7 loop
      if i = 4 then v_codigo := v_codigo || '-'; end if;
      v_codigo := v_codigo || substr(v_alfabeto, (get_byte(v_bytes, i) % length(v_alfabeto)) + 1, 1);
    end loop;
    exit when not exists (select 1 from indica.resgates where codigo_voucher = v_codigo);
    if tentativa >= 20 then
      raise exception 'INDICA_CODIGO: não foi possível gerar um código de voucher livre.';
    end if;
  end loop;
  return v_codigo;
end;
$$;

-- Lançamento ligado a RESGATE (o `_lancar` da 2002 é para indicação).
create or replace function indica._lancar_resgate(
  p_embaixador_id uuid,
  p_resgate_id uuid,
  p_tipo text,
  p_riso_coins integer,
  p_unidade_id uuid,
  p_motivo text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_antes text := coalesce(current_setting('indica.motor', true), '');
  v_id bigint;
  v_validade integer;
begin
  v_validade := (indica.config_numero('validade_riso_coins_meses'))::integer;
  perform set_config('indica.motor', 'sim', true);
  insert into indica.pontos_lancamentos
    (embaixador_id, resgate_id, tipo, saldo, riso_coins, regra_aplicada,
     expira_em, unidade_custo_id, motivo, criado_por)
  values
    (p_embaixador_id, p_resgate_id, p_tipo, 'disponivel', p_riso_coins,
     jsonb_build_object('resgate', p_resgate_id, 'movimento', p_tipo),
     case when p_riso_coins > 0 then now() + make_interval(months => v_validade) end,
     p_unidade_id, p_motivo, auth.uid())
  returning id into v_id;
  perform set_config('indica.motor', v_antes, true);
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5) Ajuste manual (só gestor, motivo obrigatório, auditado)
-- -----------------------------------------------------------------------------
create or replace function indica.ajustar_pontos(
  p_embaixador_id uuid,
  p_riso_coins integer,
  p_motivo text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_antes text := coalesce(current_setting('indica.motor', true), '');
  v_emb record;
  v_disp integer;
  v_id bigint;
begin
  select e.id, e.status, c.clinic_id into v_emb
    from indica.embaixadores e join public.clients c on c.id = e.cliente_id
   where e.id = p_embaixador_id
   for update of e;
  if not found then
    raise exception 'INDICA_NAO_ENCONTRADO: Embaixador não encontrado.';
  end if;
  if v_uid is not null and not indica._gestor_do_embaixador(p_embaixador_id) then
    raise exception 'INDICA_SEM_PERMISSAO: ajuste manual é do gestor da unidade ou da franqueadora.';
  end if;
  if coalesce(p_riso_coins, 0) = 0 then
    raise exception 'INDICA_DADOS: informe quantos Riso Coins (positivo credita, negativo debita).';
  end if;
  if length(btrim(coalesce(p_motivo, ''))) < 5 then
    raise exception 'INDICA_MOTIVO_OBRIGATORIO: explique o ajuste (fica na auditoria).';
  end if;
  v_disp := indica._saldo_disponivel(p_embaixador_id);
  if p_riso_coins < 0 and v_disp + p_riso_coins < 0 then
    raise exception 'INDICA_SALDO_INSUFICIENTE: o saldo disponível é % Riso Coins.', v_disp;
  end if;

  perform set_config('indica.motor', 'sim', true);
  insert into indica.pontos_lancamentos
    (embaixador_id, tipo, saldo, riso_coins, regra_aplicada, expira_em,
     unidade_custo_id, motivo, criado_por)
  values
    (p_embaixador_id, 'ajuste', 'disponivel', p_riso_coins,
     jsonb_build_object('ajuste_manual', true, 'saldo_antes', v_disp),
     case when p_riso_coins > 0
          then now() + make_interval(months => (indica.config_numero('validade_riso_coins_meses'))::integer)
     end,
     v_emb.clinic_id, btrim(p_motivo), v_uid)
  returning id into v_id;
  perform set_config('indica.motor', v_antes, true);

  if v_uid is not null then
    insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
    values (v_uid, v_emb.clinic_id, 'update', 'indica_ajuste', p_embaixador_id::text,
            jsonb_build_object('riso_coins', p_riso_coins, 'lancamento', v_id));
  end if;
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 6) Suspender / reativar / encerrar Embaixador (só gestor, motivo)
-- -----------------------------------------------------------------------------
create or replace function indica.definir_status_embaixador(
  p_embaixador_id uuid,
  p_status text,
  p_motivo text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_clinica uuid;
begin
  if p_status not in ('ativo', 'suspenso', 'encerrado') then
    raise exception 'INDICA_DADOS: situação inválida.';
  end if;
  if v_uid is not null and not indica._gestor_do_embaixador(p_embaixador_id) then
    raise exception 'INDICA_SEM_PERMISSAO: mudar a situação do Embaixador é do gestor.';
  end if;
  if length(btrim(coalesce(p_motivo, ''))) < 5 then
    raise exception 'INDICA_MOTIVO_OBRIGATORIO: explique a mudança (fica na auditoria).';
  end if;
  update indica.embaixadores e
     set status = p_status
    from public.clients c
   where e.id = p_embaixador_id and c.id = e.cliente_id
  returning c.clinic_id into v_clinica;
  if not found then
    raise exception 'INDICA_NAO_ENCONTRADO: Embaixador não encontrado.';
  end if;
  if v_uid is not null then
    insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
    values (v_uid, v_clinica, 'update', 'indica_embaixador_status', p_embaixador_id::text,
            jsonb_build_object('status', p_status, 'motivo', btrim(p_motivo)));
  end if;
  return p_status;
end;
$$;

-- -----------------------------------------------------------------------------
-- 7) Resgate: pedir
-- -----------------------------------------------------------------------------
-- p_dados: embaixador_id, item_id, unidade_id (onde entrega),
--          cedido_para_nome, cedido_para_cpf, cedido_para_telefone (os três ou nenhum)
create or replace function indica.solicitar_resgate(p_dados jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_antes text := coalesce(current_setting('indica.motor', true), '');
  v_emb_id uuid := nullif(p_dados ->> 'embaixador_id', '')::uuid;
  v_item_id uuid := nullif(p_dados ->> 'item_id', '')::uuid;
  v_unidade uuid := nullif(p_dados ->> 'unidade_id', '')::uuid;
  v_ced_nome text := nullif(btrim(p_dados ->> 'cedido_para_nome'), '');
  v_ced_cpf text := nullif(btrim(p_dados ->> 'cedido_para_cpf'), '');
  v_ced_tel text := nullif(btrim(p_dados ->> 'cedido_para_telefone'), '');
  v_emb record;
  v_item indica.catalogo_itens;
  v_ordem_min integer;
  v_disp integer;
  v_limite numeric;
  v_status text;
  v_id uuid;
begin
  if v_unidade is null
     or not exists (select 1 from public.clinics c
                     where c.id = v_unidade and c.type = 'franchise_unit' and c.is_active) then
    raise exception 'INDICA_UNIDADE_INVALIDA: escolha a unidade que vai entregar o prêmio.';
  end if;
  if v_uid is not null and not indica.eh_risartano(v_unidade) then
    raise exception 'INDICA_SEM_PERMISSAO: você não é desta unidade.';
  end if;

  -- Embaixador (a linha fica presa até o fim: dois pedidos simultâneos entram
  -- em fila e o segundo já vê o saldo reservado pelo primeiro).
  select e.id, e.status, n.ordem as nivel_ordem
    into v_emb
    from indica.embaixadores e join indica.niveis n on n.id = e.nivel_id
   where e.id = v_emb_id
   for update of e;
  if not found then
    raise exception 'INDICA_NAO_ENCONTRADO: Embaixador não encontrado.';
  end if;
  if v_emb.status <> 'ativo' then
    raise exception 'INDICA_EMBAIXADOR_INATIVO: este Embaixador não está ativo no programa.';
  end if;

  select * into v_item from indica.catalogo_itens where id = v_item_id for update;
  if not found or not v_item.ativo then
    raise exception 'INDICA_ITEM_INDISPONIVEL: este item não está disponível no catálogo.';
  end if;
  if cardinality(v_item.unidades) > 0 and not (v_unidade = any (v_item.unidades)) then
    raise exception 'INDICA_ITEM_INDISPONIVEL: este item não vale nesta unidade.';
  end if;
  if v_item.estoque is not null and v_item.estoque <= 0 then
    raise exception 'INDICA_SEM_ESTOQUE: este item acabou.';
  end if;
  if v_item.nivel_minimo_id is not null then
    select ordem into v_ordem_min from indica.niveis where id = v_item.nivel_minimo_id;
    if v_emb.nivel_ordem < v_ordem_min then
      raise exception 'INDICA_NIVEL_INSUFICIENTE: este item é de um nível acima do atual do Embaixador.';
    end if;
  end if;

  -- Cessão do prêmio: os três dados, ou nenhum.
  if (v_ced_nome is null) <> (v_ced_cpf is null) or (v_ced_nome is null) <> (v_ced_tel is null) then
    raise exception 'INDICA_DADOS: para ceder o prêmio, informe nome, CPF e telefone de quem recebe.';
  end if;
  if v_ced_cpf is not null and length(regexp_replace(v_ced_cpf, '\D', '', 'g')) <> 11 then
    raise exception 'INDICA_CPF_INVALIDO: CPF de quem recebe com 11 números.';
  end if;
  if v_ced_tel is not null and length(regexp_replace(v_ced_tel, '\D', '', 'g')) not in (10, 11) then
    raise exception 'INDICA_TELEFONE_INVALIDO: telefone de quem recebe com DDD.';
  end if;

  v_disp := indica._saldo_disponivel(v_emb.id);
  if v_disp < v_item.custo_riso_coins then
    raise exception 'INDICA_SALDO_INSUFICIENTE: o saldo disponível é % Riso Coins e o item custa %.',
      v_disp, v_item.custo_riso_coins;
  end if;

  v_limite := indica.config_numero('resgate_aprovacao_acima', v_unidade);
  v_status := case when v_item.custo_riso_coins > v_limite then 'solicitado' else 'aprovado' end;

  perform set_config('indica.motor', 'sim', true);
  insert into indica.resgates
    (embaixador_id, item_id, unidade_id, riso_coins, status, item_nome, item_tipo,
     valor_centavos, cedido_para_nome, cedido_para_cpf, cedido_para_telefone,
     aprovado_por, aprovado_em, criado_por)
  values
    (v_emb.id, v_item.id, v_unidade, v_item.custo_riso_coins, v_status, v_item.nome, v_item.tipo,
     v_item.valor_centavos, v_ced_nome, v_ced_cpf, v_ced_tel,
     case when v_status = 'aprovado' then v_uid end,
     case when v_status = 'aprovado' then now() end,
     v_uid)
  returning id into v_id;
  if v_item.estoque is not null then
    update indica.catalogo_itens set estoque = estoque - 1 where id = v_item.id;
  end if;
  perform set_config('indica.motor', v_antes, true);

  -- Reserva: sai do disponível AGORA.
  perform indica._lancar_resgate(v_emb.id, v_id, 'resgate', -v_item.custo_riso_coins, v_unidade,
                                 'Resgate: ' || v_item.nome);

  if v_uid is not null then
    insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
    values (v_uid, v_unidade, 'create', 'indica_resgate', v_id::text,
            jsonb_build_object('item', v_item.id, 'riso_coins', v_item.custo_riso_coins,
                               'cedido', v_ced_nome is not null));
  end if;
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 8) Resgate: aprovar, entregar, recusar, cancelar
-- -----------------------------------------------------------------------------
create or replace function indica.mudar_resgate(
  p_resgate_id uuid,
  p_acao text,
  p_motivo text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_antes text := coalesce(current_setting('indica.motor', true), '');
  v indica.resgates;
  v_novo text;
  v_voucher text;
  v_valido timestamptz;
begin
  select * into v from indica.resgates where id = p_resgate_id for update;
  if not found then
    raise exception 'INDICA_NAO_ENCONTRADO: resgate não encontrado.';
  end if;
  if p_acao not in ('aprovar', 'entregar', 'recusar', 'cancelar') then
    raise exception 'INDICA_DADOS: ação inválida.';
  end if;

  -- Quem pode: aprovar e recusar = gestor; entregar e cancelar = Risartano da unidade.
  if v_uid is not null then
    if p_acao in ('aprovar', 'recusar') and not indica.eh_gestor(v.unidade_id) then
      raise exception 'INDICA_SEM_PERMISSAO: aprovar e recusar resgate é do gestor da unidade.';
    end if;
    if p_acao in ('entregar', 'cancelar') and not indica.eh_risartano(v.unidade_id) then
      raise exception 'INDICA_SEM_PERMISSAO: este resgate é de outra unidade.';
    end if;
  end if;

  -- A sequência.
  if p_acao = 'aprovar' and v.status <> 'solicitado' then
    raise exception 'INDICA_TRANSICAO_INVALIDA: só se aprova resgate aguardando aprovação.';
  end if;
  if p_acao = 'entregar' and v.status <> 'aprovado' then
    raise exception 'INDICA_TRANSICAO_INVALIDA: só se entrega resgate aprovado.';
  end if;
  if p_acao in ('recusar', 'cancelar') and v.status not in ('solicitado', 'aprovado') then
    raise exception 'INDICA_TRANSICAO_INVALIDA: resgate já entregue ou encerrado não volta.';
  end if;
  if p_acao in ('recusar', 'cancelar') and length(btrim(coalesce(p_motivo, ''))) < 3 then
    raise exception 'INDICA_MOTIVO_OBRIGATORIO: informe o motivo.';
  end if;

  v_novo := case p_acao
              when 'aprovar' then 'aprovado'
              when 'entregar' then 'entregue'
              when 'recusar' then 'recusado'
              else 'cancelado'
            end;

  if p_acao = 'entregar' and v.item_tipo in ('credito_risarte', 'voucher_parceiro') then
    v_voucher := indica._gerar_codigo_voucher();
    if v.item_tipo = 'credito_risarte' then
      v_valido := now() + make_interval(
        days => (indica.config_numero('voucher_validade_dias', v.unidade_id))::integer);
    end if;
  end if;

  perform set_config('indica.motor', 'sim', true);
  update indica.resgates
     set status = v_novo,
         aprovado_por = case when p_acao = 'aprovar' then v_uid else aprovado_por end,
         aprovado_em = case when p_acao = 'aprovar' then now() else aprovado_em end,
         entregue_por = case when p_acao = 'entregar' then v_uid else entregue_por end,
         entregue_em = case when p_acao = 'entregar' then now() else entregue_em end,
         codigo_voucher = coalesce(v_voucher, codigo_voucher),
         voucher_valido_ate = coalesce(v_valido, voucher_valido_ate),
         encerrado_por = case when p_acao in ('recusar', 'cancelar') then v_uid else encerrado_por end,
         encerrado_em = case when p_acao in ('recusar', 'cancelar') then now() else encerrado_em end,
         motivo = case when p_acao in ('recusar', 'cancelar') then btrim(p_motivo) else motivo end
   where id = v.id;
  if p_acao in ('recusar', 'cancelar') then
    update indica.catalogo_itens set estoque = estoque + 1 where id = v.item_id and estoque is not null;
  end if;
  perform set_config('indica.motor', v_antes, true);

  -- Devolução dos pontos reservados (linha nova, o extrato só cresce).
  if p_acao in ('recusar', 'cancelar') then
    perform indica._lancar_resgate(v.embaixador_id, v.id, 'devolucao', v.riso_coins, v.unidade_id,
                                   'Devolução do resgate ' || v.codigo || ': ' || btrim(p_motivo));
  end if;

  if v_uid is not null then
    insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
    values (v_uid, v.unidade_id, 'update', 'indica_resgate', v.id::text,
            jsonb_build_object('acao', p_acao, 'status', v_novo));
  end if;
  return v_novo;
end;
$$;

-- -----------------------------------------------------------------------------
-- 9) Voucher de Crédito Risarte: marcar como usado numa negociação
-- -----------------------------------------------------------------------------
-- O consultor aplica o valor como desconto na negociação (Comercial, como hoje)
-- e marca aqui. Usa-se UMA vez, dentro da validade.
create or replace function indica.usar_voucher(p_codigo text, p_negociacao_id uuid)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_antes text := coalesce(current_setting('indica.motor', true), '');
  v indica.resgates;
  v_clinica uuid;
begin
  select * into v from indica.resgates
   where codigo_voucher = upper(btrim(coalesce(p_codigo, '')))
   for update;
  if not found then
    raise exception 'INDICA_VOUCHER_INVALIDO: voucher não encontrado.';
  end if;
  if v.item_tipo <> 'credito_risarte' or v.status <> 'entregue' then
    raise exception 'INDICA_VOUCHER_INVALIDO: este código não é um Crédito Risarte entregue.';
  end if;
  if v.voucher_usado_em is not null then
    raise exception 'INDICA_VOUCHER_USADO: este voucher já foi usado em %.',
      to_char(v.voucher_usado_em at time zone 'America/Sao_Paulo', 'DD/MM/YYYY');
  end if;
  if v.voucher_valido_ate is not null and v.voucher_valido_ate < now() then
    raise exception 'INDICA_VOUCHER_VENCIDO: este voucher venceu em %.',
      to_char(v.voucher_valido_ate at time zone 'America/Sao_Paulo', 'DD/MM/YYYY');
  end if;

  select clinic_id into v_clinica from public.plan_negotiations where id = p_negociacao_id;
  if not found then
    raise exception 'INDICA_DADOS: negociação não encontrada.';
  end if;
  if v_uid is not null and not indica.eh_risartano(v_clinica) then
    raise exception 'INDICA_SEM_PERMISSAO: esta negociação é de outra unidade.';
  end if;

  perform set_config('indica.motor', 'sim', true);
  update indica.resgates
     set voucher_usado_em = now(), voucher_usado_por = v_uid, voucher_negociacao_id = p_negociacao_id
   where id = v.id;
  perform set_config('indica.motor', v_antes, true);

  if v_uid is not null then
    insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
    values (v_uid, v_clinica, 'update', 'indica_voucher', v.id::text,
            jsonb_build_object('negociacao', p_negociacao_id, 'valor_centavos', v.valor_centavos));
  end if;
  return v.valor_centavos;
end;
$$;

-- -----------------------------------------------------------------------------
-- 10) Visões: saldo (corrige o total resgatado) e a lista de Embaixadores
-- -----------------------------------------------------------------------------
-- `total_resgatado` passa a descontar as devoluções. A visão de Embaixadores
-- depende desta; as duas são recriadas juntas.
drop view if exists indica.v_embaixadores;
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
  (coalesce(-sum(l.riso_coins) filter (where l.tipo = 'resgate'), 0)
   - coalesce(sum(l.riso_coins) filter (where l.tipo = 'devolucao'), 0))::integer as total_resgatado,
  max(l.criado_em) as ultimo_lancamento_em
from indica.embaixadores e
left join indica.pontos_lancamentos l on l.embaixador_id = e.id
group by e.id, e.cliente_id, e.codigo;

create view indica.v_embaixadores with (security_invoker = true) as
select
  e.id, e.codigo, e.status, e.cliente_id, e.unidade_cadastro_id,
  e.aceite_regulamento_em, e.versao_regulamento, e.criado_em,
  c.full_name as nome, c.code as codigo_cliente, c.clinic_id,
  n.id as nivel_id, n.codigo as nivel_codigo, n.nome as nivel_nome, n.ordem as nivel_ordem,
  n.multiplicador,
  s.disponivel, s.pendente, s.em_carencia, s.a_vencer_30_dias, s.total_resgatado,
  (select count(*) from indica.indicacoes i where i.embaixador_id = e.id)::integer as indicacoes,
  (select count(*) from indica.indicacoes i
    where i.embaixador_id = e.id and i.status = 'convertida'
      and i.fechou_em >= now() - interval '12 months')::integer as conversoes_12_meses,
  greatest(
    s.ultimo_lancamento_em,
    (select max(i.atualizado_em) from indica.indicacoes i where i.embaixador_id = e.id)
  ) as ultima_atividade
from indica.embaixadores e
join public.clients c on c.id = e.cliente_id
join indica.niveis n on n.id = e.nivel_id
join indica.v_saldo_embaixador s on s.embaixador_id = e.id;

grant select on indica.v_saldo_embaixador, indica.v_embaixadores to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 11) Permissões (AP15)
-- -----------------------------------------------------------------------------
revoke execute on function indica.resgate_so_pelo_motor() from public, anon, authenticated;
revoke execute on function indica._gestor_do_embaixador(uuid) from public, anon, authenticated;
revoke execute on function indica._saldo_disponivel(uuid) from public, anon, authenticated;
revoke execute on function indica._gerar_codigo_voucher() from public, anon, authenticated;
revoke execute on function indica._lancar_resgate(uuid, uuid, text, integer, uuid, text) from public, anon, authenticated;
revoke execute on function indica.ajustar_pontos(uuid, integer, text) from public, anon, authenticated;
revoke execute on function indica.definir_status_embaixador(uuid, text, text) from public, anon, authenticated;
revoke execute on function indica.solicitar_resgate(jsonb) from public, anon, authenticated;
revoke execute on function indica.mudar_resgate(uuid, text, text) from public, anon, authenticated;
revoke execute on function indica.usar_voucher(text, uuid) from public, anon, authenticated;

grant execute on function indica.ajustar_pontos(uuid, integer, text) to authenticated, service_role;
grant execute on function indica.definir_status_embaixador(uuid, text, text) to authenticated, service_role;
grant execute on function indica.solicitar_resgate(jsonb) to authenticated, service_role;
grant execute on function indica.mudar_resgate(uuid, text, text) to authenticated, service_role;
grant execute on function indica.usar_voucher(text, uuid) to authenticated, service_role;
-- Internas (_gestor_do_embaixador, _saldo_disponivel, _gerar_codigo_voucher,
-- _lancar_resgate) e o gatilho: nenhum grant.

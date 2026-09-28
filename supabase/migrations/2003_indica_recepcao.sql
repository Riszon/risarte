-- =============================================================================
-- 2003 — Indica +Risos (IND1): o que as telas da recepção precisam do banco
-- -----------------------------------------------------------------------------
--   buscar_indicador       acha o cliente que indica por nome, código, CPF ou
--                          TELEFONE (a busca rápida do riSZon não olha
--                          telefone), já dizendo se ele é Embaixador
--   embaixador_pelo_codigo o código pessoal vale na REDE toda: acha o
--                          Embaixador de outra unidade (só código, 1º nome e
--                          nível — nada da ficha)
--   conferir_indicacao     a conferência de duplicidade EM TEMPO REAL, antes
--                          de gravar; devolve a situação e, se já indicado, só
--                          o CÓDIGO da indicação — nunca dados da pessoa
--   v_indicacoes           a lista das telas, com o rótulo do Embaixador
--
-- As regras de conferência passam a morar numa peça só (`_conferir_indicado`),
-- usada pela tela E pelo registro: a tela não pode dizer "livre" para algo que
-- o registro vai recusar.
--
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Extrato: quem vê a INDICAÇÃO vê os pontos que ela gerou
-- -----------------------------------------------------------------------------
-- O Embaixador pode ser cliente de outra unidade (carteira única na rede). Sem
-- isto, a recepção que cuida da indicação não veria os pontos dela.
drop policy if exists lancamentos_ler on indica.pontos_lancamentos;
create policy lancamentos_ler on indica.pontos_lancamentos for select to authenticated
  using (exists (select 1 from indica.embaixadores e where e.id = embaixador_id)
         or (indicacao_id is not null
             and exists (select 1 from indica.indicacoes i where i.id = indicacao_id)));

-- -----------------------------------------------------------------------------
-- 2) Rótulo do Embaixador: "JOANA27 · Joana" — o mínimo para a lista
-- -----------------------------------------------------------------------------
create or replace function indica.rotulo_embaixador(p_embaixador_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select e.codigo || ' · ' || split_part(btrim(c.full_name), ' ', 1)
    from indica.embaixadores e
    join public.clients c on c.id = e.cliente_id
   where e.id = p_embaixador_id;
$$;

-- -----------------------------------------------------------------------------
-- 3) Busca de quem indica (roda com os direitos de QUEM CHAMOU: a RLS de
--    clients decide quem aparece, como na busca rápida da 0251)
-- -----------------------------------------------------------------------------
drop function if exists indica.buscar_indicador(text);
create or replace function indica.buscar_indicador(p_termo text)
returns table (
  cliente_id uuid,
  nome text,
  codigo_cliente text,
  unidade text,
  embaixador_id uuid,
  embaixador_codigo text,
  embaixador_status text,
  nivel text
)
language sql
stable
-- Sem `security definer` de propósito (ver 0251).
set search_path = ''
as $$
  with t as (
    select btrim(coalesce(p_termo, '')) as texto,
           public.cpf_digits(p_termo) as digitos,
           nullif(regexp_replace(coalesce(p_termo, ''), '\D', '', 'g'), '') as tel
  )
  select c.id, c.full_name, c.code, cl.name, e.id, e.codigo, e.status, n.nome
    from public.clients c
    join public.clinics cl on cl.id = c.clinic_id
    left join indica.embaixadores e on e.cliente_id = c.id
    left join indica.niveis n on n.id = e.nivel_id
   cross join t
   where length(t.texto) >= 2
     and c.status <> 'anonymized'
     and (
       c.full_name ilike '%' || t.texto || '%'
       or c.code ilike '%' || t.texto || '%'
       or upper(e.codigo) = upper(t.texto)
       or (t.digitos is not null and length(t.digitos) >= 3
           and public.cpf_digits(c.cpf) like t.digitos || '%')
       -- Telefone: pelo FINAL (quem digita sem DDD ainda acha), 8+ números.
       or (t.tel is not null and length(t.tel) >= 8
           and regexp_replace(coalesce(c.phone, ''), '\D', '', 'g') like '%' || t.tel)
     )
   order by (e.id is null),
            case when c.full_name ilike t.texto || '%' then 0 else 1 end,
            c.full_name
   limit 8;
$$;

-- -----------------------------------------------------------------------------
-- 4) Embaixador pelo código pessoal, na rede toda
-- -----------------------------------------------------------------------------
drop function if exists indica.embaixador_pelo_codigo(text);
create or replace function indica.embaixador_pelo_codigo(p_codigo text)
returns table (
  embaixador_id uuid,
  codigo text,
  primeiro_nome text,
  nivel text,
  status text
)
language sql
stable
security definer
set search_path = ''
as $$
  select e.id, e.codigo, split_part(btrim(c.full_name), ' ', 1), n.nome, e.status
    from indica.embaixadores e
    join public.clients c on c.id = e.cliente_id
    join indica.niveis n on n.id = e.nivel_id
   where auth.uid() is not null
     and e.codigo = upper(btrim(coalesce(p_codigo, '')));
$$;

-- -----------------------------------------------------------------------------
-- 5) As conferências do indicado, numa peça só
-- -----------------------------------------------------------------------------
-- Devolve {situacao, ...}:
--   livre          pode registrar; `cliente_id` = cadastro encontrado (ou nulo);
--                  `expirar` = indicações com a trava vencida que o registro
--                  vai expirar
--   autoindicacao  mesmo cadastro, CPF ou telefone de quem indica
--   ja_e_cliente   teve atendimento na rede dentro da janela (`janela_meses`)
--   duplicada      já indicado e em aberto (`codigo` da primeira)
create or replace function indica._conferir_indicado(
  p_tel_d text,
  p_cpf_d text,
  p_cliente_id uuid,
  p_emb_cliente_id uuid,
  p_unidade_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cliente uuid := p_cliente_id;
  v_achados uuid[];
  v_emb record;
  v_janela integer;
  v_conflito record;
  v_expirar uuid[] := '{}';
begin
  -- Conciliação: o indicado já tem cadastro? (CPF primeiro; telefone só se único)
  if v_cliente is null then
    if p_cpf_d is not null then
      select c.id into v_cliente from public.clients c
       where public.cpf_digits(c.cpf) = p_cpf_d and c.status <> 'anonymized'
       limit 1;
    end if;
    if v_cliente is null and p_tel_d is not null then
      select array_agg(c.id) into v_achados from public.clients c
       where regexp_replace(coalesce(c.phone, ''), '\D', '', 'g') = p_tel_d
         and c.status <> 'anonymized';
      if coalesce(cardinality(v_achados), 0) = 1 then
        v_cliente := v_achados[1];
      end if;
    end if;
  end if;

  -- Autoindicação
  if p_emb_cliente_id is not null then
    select c.id,
           public.cpf_digits(c.cpf) as cpf_d,
           nullif(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g'), '') as tel_d
      into v_emb
      from public.clients c where c.id = p_emb_cliente_id;
    if v_cliente = v_emb.id
       or (p_cpf_d is not null and p_cpf_d = v_emb.cpf_d)
       or (p_tel_d is not null and p_tel_d = v_emb.tel_d) then
      return jsonb_build_object('situacao', 'autoindicacao');
    end if;
  end if;

  -- Elegibilidade: cliente novo na rede
  if v_cliente is not null then
    v_janela := (indica.config_numero('janela_cliente_novo_meses', p_unidade_id))::integer;
    if not indica.cliente_elegivel(v_cliente, v_janela) then
      return jsonb_build_object('situacao', 'ja_e_cliente', 'janela_meses', v_janela);
    end if;
  end if;

  -- Duplicidade: vence o primeiro registro; trava vencida libera a pessoa.
  for v_conflito in
    select i.id, i.codigo, i.status, i.trava_ate
      from indica.indicacoes i
     where i.status not in ('recusada', 'cancelada', 'expirada')
       and ((p_tel_d is not null and i.indicado_telefone_digitos = p_tel_d)
         or (p_cpf_d is not null and i.indicado_cpf_digitos = p_cpf_d)
         or (v_cliente is not null and i.cliente_indicado_id = v_cliente))
     order by i.registrada_em
  loop
    if v_conflito.status in ('registrada', 'validada', 'agendada', 'faltou', 'nao_fechou')
       and v_conflito.trava_ate < now() then
      v_expirar := v_expirar || v_conflito.id;
    else
      return jsonb_build_object('situacao', 'duplicada', 'codigo', v_conflito.codigo);
    end if;
  end loop;

  return jsonb_build_object('situacao', 'livre', 'cliente_id', v_cliente,
                            'expirar', to_jsonb(v_expirar));
end;
$$;

-- -----------------------------------------------------------------------------
-- 6) A conferência da TELA (enquanto se digita)
-- -----------------------------------------------------------------------------
-- p_dados: indicado_telefone, indicado_cpf, cliente_indicado_id, embaixador_id,
--          unidade_id. Nunca devolve o id do cadastro encontrado: diz só SE
--          existe (`cadastro_encontrado`), para não virar consulta de CPF.
create or replace function indica.conferir_indicacao(p_dados jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_unidade uuid := nullif(p_dados ->> 'unidade_id', '')::uuid;
  v_tel_d text := nullif(regexp_replace(coalesce(p_dados ->> 'indicado_telefone', ''), '\D', '', 'g'), '');
  v_cpf_d text := nullif(regexp_replace(coalesce(p_dados ->> 'indicado_cpf', ''), '\D', '', 'g'), '');
  v_cliente uuid := nullif(p_dados ->> 'cliente_indicado_id', '')::uuid;
  v_emb_id uuid := nullif(p_dados ->> 'embaixador_id', '')::uuid;
  v_emb_cliente uuid;
  v_r jsonb;
begin
  if auth.uid() is null then
    return jsonb_build_object('situacao', 'sem_permissao');
  end if;
  if v_unidade is not null and not indica.eh_risartano(v_unidade) then
    return jsonb_build_object('situacao', 'sem_permissao');
  end if;
  -- Número incompleto não é conferido (não é "livre" — é "ainda não sei").
  if v_tel_d is not null and length(v_tel_d) not in (10, 11) then v_tel_d := null; end if;
  if v_cpf_d is not null and length(v_cpf_d) <> 11 then v_cpf_d := null; end if;
  if v_tel_d is null and v_cpf_d is null and v_cliente is null then
    return jsonb_build_object('situacao', 'incompleto');
  end if;

  if v_emb_id is not null then
    select cliente_id into v_emb_cliente from indica.embaixadores where id = v_emb_id;
  end if;

  v_r := indica._conferir_indicado(v_tel_d, v_cpf_d, v_cliente, v_emb_cliente, v_unidade);
  return jsonb_build_object(
    'situacao', v_r ->> 'situacao',
    'codigo', v_r ->> 'codigo',
    'janela_meses', v_r -> 'janela_meses',
    'cadastro_encontrado', (v_r ->> 'cliente_id') is not null,
    'expira_ao_registrar', coalesce(jsonb_array_length(v_r -> 'expirar'), 0)
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- 7) registrar_indicacao passa a usar a MESMA conferência
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
  v_emb indica.embaixadores;
  v_conf jsonb;
  v_expirar uuid;
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
  if v_cliente is not null
     and not exists (select 1 from public.clients c where c.id = v_cliente and c.status <> 'anonymized') then
    raise exception 'INDICA_CLIENTE_NAO_ENCONTRADO: cadastro do indicado não encontrado.';
  end if;

  -- Uma registração por vez: "primeiro registro válido vence" precisa de fila.
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

  -- Indicação com a trava vencida que a rotina ainda não expirou: expira AGORA.
  for v_expirar in select jsonb_array_elements_text(v_conf -> 'expirar')::uuid
  loop
    perform indica._mudar_status(v_expirar, 'expirada',
      'Trava de atribuição vencida (conferido ao registrar nova indicação).', '{}'::jsonb, v_uid);
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
-- 8) A lista das telas
-- -----------------------------------------------------------------------------
-- security_invoker: a RLS de indicacoes decide o que aparece. O rótulo do
-- Embaixador vem da função (código + 1º nome), porque o Embaixador pode ser
-- cliente de uma unidade que quem olha não enxerga.
drop view if exists indica.v_indicacoes;
create view indica.v_indicacoes with (security_invoker = true) as
select
  i.id, i.codigo, i.status, i.unidade_id, i.canal, i.campanha_id,
  i.embaixador_id, i.parceiro_id,
  indica.rotulo_embaixador(i.embaixador_id) as embaixador_rotulo,
  p.nome as parceiro_nome,
  i.indicado_nome, i.indicado_telefone, i.cliente_indicado_id,
  i.risartano_origem_id, i.risartano_conversao_id,
  i.agendamento_id, i.orcamento_id, i.venda_id, i.valor_fechado_centavos,
  i.trava_ate, i.registrada_em, i.validada_em, i.agendada_em, i.compareceu_em,
  i.fechou_em, i.convertida_em, i.encerrada_em, i.atualizado_em,
  (i.trava_ate < now()
   and i.status in ('registrada', 'validada', 'agendada', 'faltou', 'nao_fechou')) as trava_vencida
from indica.indicacoes i
left join indica.parceiros p on p.id = i.parceiro_id;

grant select on indica.v_indicacoes to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 9) Permissões (AP15)
-- -----------------------------------------------------------------------------
revoke execute on function indica.rotulo_embaixador(uuid) from public, anon, authenticated;
revoke execute on function indica.buscar_indicador(text) from public, anon, authenticated;
revoke execute on function indica.embaixador_pelo_codigo(text) from public, anon, authenticated;
revoke execute on function indica._conferir_indicado(text, text, uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function indica.conferir_indicacao(jsonb) from public, anon, authenticated;
revoke execute on function indica.registrar_indicacao(jsonb) from public, anon, authenticated;

-- A visão chama o rótulo em nome de quem consulta.
grant execute on function indica.rotulo_embaixador(uuid) to authenticated, service_role;
grant execute on function indica.buscar_indicador(text) to authenticated, service_role;
grant execute on function indica.embaixador_pelo_codigo(text) to authenticated, service_role;
grant execute on function indica.conferir_indicacao(jsonb) to authenticated, service_role;
grant execute on function indica.registrar_indicacao(jsonb) to authenticated, service_role;
-- _conferir_indicado: interna, nenhum grant.

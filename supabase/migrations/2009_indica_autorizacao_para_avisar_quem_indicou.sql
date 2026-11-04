-- =============================================================================
-- 2009 — Indica +Risos: autorização do indicado para AVISAR QUEM O INDICOU
--        (+ evento e mensagem "agendou")
-- -----------------------------------------------------------------------------
-- Achado E10 do levantamento da Rita (docs/sdr/LEVANTAMENTO_DADOS_RITA_RESULTADO.md)
-- e item 2 do plano aprovado pelo dono em 03/11/2026
-- (docs/sdr/PLANO-CORRECOES-SECAO-2.md):
--
--   * `mensagens_dos_eventos` contava ao Embaixador o PRIMEIRO NOME do indicado
--     em "compareceu", "fechou" e "convertida", sem o indicado ter autorizado.
--     A única exceção dependia de `indicacoes.desvinculada_em` — coluna que
--     NENHUMA função gravava.
--   * O aceite LGPD (`consentimentos`) responde a OUTRA pergunta ("a Risarte
--     pode te contatar?"). "Podemos contar a quem te indicou?" é uma segunda
--     pergunta, e fica na própria indicação.
--
-- Decisões do dono (03/11/2026):
--   * SEM autorização a mensagem SAI, mas SEM o nome ("a pessoa que você
--     indicou"): os pontos continuam sendo informação do próprio Embaixador.
--   * A mensagem "registrada" (obrigado por indicar) continua igual — o nome
--     ali é o que o próprio Embaixador acabou de informar.
--   * Entra o evento "agendada" com modelo próprio, sem data nem horário.
--
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Colunas da autorização (na indicação, não em `consentimentos`)
-- -----------------------------------------------------------------------------
alter table indica.indicacoes
  add column if not exists autoriza_avisar_indicador_em timestamptz,
  add column if not exists autoriza_avisar_canal text,
  add column if not exists autoriza_avisar_por uuid references public.profiles (id),
  add column if not exists autoriza_avisar_revogado_em timestamptz;

-- O mesmo conjunto de canais de `consentimentos.canal` (2006).
alter table indica.indicacoes drop constraint if exists indicacoes_autoriza_avisar_canal_check;
alter table indica.indicacoes add constraint indicacoes_autoriza_avisar_canal_check
  check (autoriza_avisar_canal is null
         or autoriza_avisar_canal in ('link', 'whatsapp', 'presencial', 'telefone', 'portal'));

comment on column indica.indicacoes.autoriza_avisar_indicador_em is
  'Quando o indicado autorizou que quem o indicou seja avisado das etapas dele (com o nome). Nulo = sem autorização: as mensagens saem sem o nome.';
comment on column indica.indicacoes.autoriza_avisar_revogado_em is
  'Quando o indicado pediu para não contar mais a quem o indicou. Preenchido = autorização sem efeito.';

-- -----------------------------------------------------------------------------
-- 2) Modelo da mensagem "agendou" (rede; a unidade pode variar). Sem data nem
--    horário no texto (kickoff 3.3).
-- -----------------------------------------------------------------------------
insert into indica.config (escopo, unidade_id, grupo, chave, valor, travado, descricao, vigente_desde)
values
  ('rede', null, 'mensagens', 'msg_agendou_embaixador',
   '"{embaixador}, {indicado} marcou a avaliação na Risarte! Avisamos você quando a visita acontecer. 😁"', false,
   'Quando o indicado agenda a avaliação (sem data nem horário no texto).', '2026-01-01 00:00-03')
on conflict on constraint config_versao_unica do nothing;

-- -----------------------------------------------------------------------------
-- 3) Gravar / revogar a autorização (motor + porta da equipe)
-- -----------------------------------------------------------------------------
-- Interna: grava sem guarda (quem chama já conferiu). Idempotente: autorização
-- vigente não grava de novo; revogada volta a valer com data nova.
create or replace function indica._gravar_autorizacao_aviso(
  p_indicacao_id uuid, p_canal text, p_usuario uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_antes text := coalesce(current_setting('indica.motor', true), '');
  v indica.indicacoes;
begin
  select * into v from indica.indicacoes where id = p_indicacao_id for update;
  if not found then
    raise exception 'INDICA_NAO_ENCONTRADA: indicação não encontrada.';
  end if;
  if v.autoriza_avisar_indicador_em is not null and v.autoriza_avisar_revogado_em is null then
    return; -- já vale
  end if;
  perform set_config('indica.motor', 'sim', true);
  update indica.indicacoes
     set autoriza_avisar_indicador_em = now(),
         autoriza_avisar_canal = p_canal,
         autoriza_avisar_por = p_usuario,
         autoriza_avisar_revogado_em = null,
         desvinculada_em = null          -- voltou a aceitar ser ligado a quem indicou
   where id = p_indicacao_id;
  insert into indica.indicacao_eventos (indicacao_id, status_de, status_para, dados, usuario_id)
  values (p_indicacao_id, v.status, 'autorizou_aviso', jsonb_build_object('canal', p_canal), p_usuario);
  perform set_config('indica.motor', v_antes, true);
end;
$$;

-- A equipe registra ("Autorizou avisar quem indicou": pessoalmente, por
-- telefone ou pelo WhatsApp). `link` e `portal` são do próprio indicado, sem
-- pessoa logada (aceitar_convite).
create or replace function indica.registrar_autorizacao_aviso(p_indicacao_id uuid, p_canal text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v indica.indicacoes;
begin
  if p_canal is null or p_canal not in ('link', 'whatsapp', 'presencial', 'telefone', 'portal') then
    raise exception 'INDICA_DADOS: informe como o indicado autorizou (pessoalmente, por telefone ou pelo WhatsApp).';
  end if;
  if v_uid is not null and p_canal in ('link', 'portal') then
    raise exception 'INDICA_DADOS: a autorização pelo link é do próprio indicado.';
  end if;
  select * into v from indica.indicacoes where id = p_indicacao_id;
  if not found then
    raise exception 'INDICA_NAO_ENCONTRADA: indicação não encontrada.';
  end if;
  if v_uid is not null and not indica.eh_risartano(v.unidade_id) then
    raise exception 'INDICA_SEM_PERMISSAO: esta indicação é de outra unidade.';
  end if;
  if v.anonimizada_em is not null or v.status in ('recusada', 'cancelada', 'expirada') then
    raise exception 'INDICA_TRANSICAO_INVALIDA: indicação encerrada.';
  end if;
  perform indica._gravar_autorizacao_aviso(p_indicacao_id, p_canal, v_uid);
  if v_uid is not null then
    insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
    values (v_uid, v.unidade_id, 'update', 'indica_indicacao', v.id::text,
            jsonb_build_object('autoriza_avisar', true, 'canal', p_canal));
  end if;
end;
$$;

-- O indicado pediu para não contar mais. `p_desvincular` = "não quero ser
-- ligado a quem me indicou": grava também `desvinculada_em` (até aqui, coluna
-- que nada preenchia), e o portal/"Indicado por" deixam de ligar os dois.
create or replace function indica.revogar_autorizacao_aviso(
  p_indicacao_id uuid, p_motivo text, p_desvincular boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_antes text := coalesce(current_setting('indica.motor', true), '');
  v indica.indicacoes;
  v_vigente boolean;
begin
  if nullif(btrim(p_motivo), '') is null then
    raise exception 'INDICA_MOTIVO_OBRIGATORIO: informe o motivo.';
  end if;
  select * into v from indica.indicacoes where id = p_indicacao_id for update;
  if not found then
    raise exception 'INDICA_NAO_ENCONTRADA: indicação não encontrada.';
  end if;
  if v_uid is not null and not indica.eh_risartano(v.unidade_id) then
    raise exception 'INDICA_SEM_PERMISSAO: esta indicação é de outra unidade.';
  end if;
  if v.anonimizada_em is not null then
    raise exception 'INDICA_TRANSICAO_INVALIDA: indicação anonimizada.';
  end if;
  v_vigente := v.autoriza_avisar_indicador_em is not null and v.autoriza_avisar_revogado_em is null;
  if not v_vigente and not coalesce(p_desvincular, false) then
    return; -- nada a revogar
  end if;
  perform set_config('indica.motor', 'sim', true);
  update indica.indicacoes
     set autoriza_avisar_revogado_em = case when v_vigente then now() else autoriza_avisar_revogado_em end,
         desvinculada_em = case when coalesce(p_desvincular, false) then coalesce(desvinculada_em, now()) else desvinculada_em end
   where id = p_indicacao_id;
  insert into indica.indicacao_eventos (indicacao_id, status_de, status_para, motivo, dados, usuario_id)
  values (p_indicacao_id, v.status, 'revogou_aviso', btrim(p_motivo),
          jsonb_build_object('desvinculada', coalesce(p_desvincular, false)), v_uid);
  perform set_config('indica.motor', v_antes, true);
  if v_uid is not null then
    insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
    values (v_uid, v.unidade_id, 'update', 'indica_indicacao', v.id::text,
            jsonb_build_object('autoriza_avisar', false, 'desvinculada', coalesce(p_desvincular, false)));
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4) registrar_indicacao: + chave `autoriza_avisar` no p_dados
-- -----------------------------------------------------------------------------
-- A janela "Nova indicação" pergunta junto com o aceite presencial/por
-- telefone. Só vale COM aceite registrado na hora (sem aceite, o indicado não
-- está presente para responder; o convite /c/ pergunta as duas coisas).
-- Corpo = 2007 + a autorização.
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
  v_autoriza boolean := lower(coalesce(p_dados ->> 'autoriza_avisar', '')) in ('true', 't', 'sim', '1');
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
                             'aceite', coalesce(v_consent, case when v_cliente is null then 'convite' else 'cadastro' end),
                             'autoriza_avisar', v_autoriza and v_consent is not null),
          v_uid);
  perform set_config('indica.motor', v_antes, true);

  -- "Podemos avisar quem te indicou?" — só com o aceite dado na hora.
  if v_autoriza and v_consent is not null then
    perform indica._gravar_autorizacao_aviso(v_id, v_consent, v_uid);
  end if;

  if v_uid is not null then
    insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
    values (v_uid, v_unidade, 'create', 'indica_indicacao', v_id::text,
            jsonb_build_object('canal', v_canal, 'campanha', v_campanha));
  end if;

  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5) /c/[token]: o convite pergunta as DUAS coisas
-- -----------------------------------------------------------------------------
-- A assinatura ganha `p_avisar_indicador` (padrão falso = só o aceite, como
-- antes). Lista de parâmetros mudou: drop antes (Regra 3 do check-migrations).
drop function if exists indica.aceitar_convite(text, inet);
create or replace function indica.aceitar_convite(
  p_token text, p_ip inet, p_avisar_indicador boolean default false
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if auth.uid() is not null or length(coalesce(p_token, '')) < 40 then
    return false;
  end if;
  select id into v_id from indica.indicacoes
   where convite_token_hash = sha256(convert_to(p_token, 'UTF8'))
     and convite_expira_em > now()
     and anonimizada_em is null
     and status not in ('recusada', 'cancelada', 'expirada')
     and consentimento_id is null;
  if not found then
    return false;
  end if;
  perform indica._gravar_consentimento(v_id, 'link', p_ip, null);
  if coalesce(p_avisar_indicador, false) then
    perform indica._gravar_autorizacao_aviso(v_id, 'link', null);
  end if;
  return true;
end;
$$;

-- -----------------------------------------------------------------------------
-- 6) Mensagens dos eventos: o nome SÓ com autorização vigente; + "agendada"
-- -----------------------------------------------------------------------------
create or replace function indica.mensagens_dos_eventos()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v indica.indicacoes;
  v_emb record;
  v_chave text;
  v_vars jsonb;
  v_saldo integer;
  v_autorizado boolean;
begin
  if new.status_para not in ('registrada', 'agendada', 'compareceu', 'fechou', 'convertida') then
    return new;
  end if;
  begin
    select * into v from indica.indicacoes where id = new.indicacao_id;
    if v.embaixador_id is null or v.anonimizada_em is not null then
      return new;
    end if;
    select e.id, split_part(btrim(c.full_name), ' ', 1) as nome, c.phone
      into v_emb
      from indica.embaixadores e join public.clients c on c.id = e.cliente_id
     where e.id = v.embaixador_id;
    select coalesce(sum(riso_coins), 0)::integer into v_saldo
      from indica.pontos_lancamentos
     where embaixador_id = v.embaixador_id and saldo = 'disponivel';

    v_chave := case new.status_para
                 when 'registrada' then 'msg_obrigado_embaixador'
                 when 'agendada' then 'msg_agendou_embaixador'
                 when 'compareceu' then 'msg_compareceu_embaixador'
                 when 'fechou' then 'msg_fechou_embaixador'
                 else 'msg_convertida_embaixador'
               end;
    -- A autorização do INDICADO decide se o nome dele sai (decisão 20). O
    -- "obrigado" do registro continua igual: o nome ali é o que o próprio
    -- Embaixador acabou de informar.
    v_autorizado := v.autoriza_avisar_indicador_em is not null
                    and v.autoriza_avisar_revogado_em is null;
    v_vars := jsonb_build_object(
      'embaixador', v_emb.nome,
      'indicado', case
                    when new.status_para = 'registrada' and v.desvinculada_em is null
                      then split_part(btrim(v.indicado_nome), ' ', 1)
                    when new.status_para <> 'registrada' and v_autorizado and v.desvinculada_em is null
                      then split_part(btrim(v.indicado_nome), ' ', 1)
                    else 'a pessoa que você indicou'
                  end,
      'pontos', coalesce((new.dados ->> 'pontos')::integer, 0) + coalesce((new.dados ->> 'liberados')::integer, 0),
      'saldo', v_saldo,
      'data', case when v.fechou_em is not null
                   then to_char((v.fechou_em + make_interval(days => (v.regra_congelada ->> 'carencia_dias')::integer))
                                at time zone 'America/Sao_Paulo', 'DD/MM/YYYY') end
    );
    -- Índice único (indicacao_id, evento): "trocar a avaliação" (agendada →
    -- agendada) não gera segunda mensagem.
    perform indica._enfileirar(v.unidade_id, new.status_para, 'embaixador', v.embaixador_id, v.id,
                               v_emb.nome, v_emb.phone, indica._render(v_chave, v.unidade_id, v_vars));
  exception when others then
    perform indica._registrar_falha('mensagem', null, new.indicacao_id, sqlerrm);
  end;
  return new;
end;
$$;

drop trigger if exists indicacao_eventos_mensagens on indica.indicacao_eventos;
create trigger indicacao_eventos_mensagens
  after insert on indica.indicacao_eventos
  for each row execute function indica.mensagens_dos_eventos();

-- -----------------------------------------------------------------------------
-- 7) Permissões (AP15)
-- -----------------------------------------------------------------------------
revoke execute on function indica._gravar_autorizacao_aviso(uuid, text, uuid) from public, anon, authenticated;
revoke execute on function indica.registrar_autorizacao_aviso(uuid, text) from public, anon, authenticated;
revoke execute on function indica.revogar_autorizacao_aviso(uuid, text, boolean) from public, anon, authenticated;
revoke execute on function indica.registrar_indicacao(jsonb) from public, anon, authenticated;
revoke execute on function indica.aceitar_convite(text, inet, boolean) from public, anon, authenticated;
revoke execute on function indica.mensagens_dos_eventos() from public, anon, authenticated;

grant execute on function indica.registrar_autorizacao_aviso(uuid, text) to authenticated, service_role;
grant execute on function indica.revogar_autorizacao_aviso(uuid, text, boolean) to authenticated, service_role;
grant execute on function indica.registrar_indicacao(jsonb) to authenticated, service_role;
-- Página pública: só o servidor.
grant execute on function indica.aceitar_convite(text, inet, boolean) to service_role;

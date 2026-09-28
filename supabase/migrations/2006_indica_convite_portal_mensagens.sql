-- =============================================================================
-- 2006 — Indica +Risos (IND3b): aceite LGPD do indicado, convite por link,
--        páginas públicas, portal do Embaixador e fila de mensagens
-- -----------------------------------------------------------------------------
-- Decisões do dono (28/09/2026):
--   * WhatsApp em FILA MANUAL: o sistema monta a mensagem de cada evento e a
--     põe na fila; a recepção abre o WhatsApp com o texto pronto, envia e marca.
--     Trocar por provedor automático depois = ler a mesma fila.
--   * Endereço público = parâmetro `url_publica`. Vazio = o endereço do
--     próprio site (risarte.vercel.app hoje; o treino usa o dele). Domínio
--     próprio depois: muda-se num lugar só.
--   * Aceite LGPD do indicado: a RECEPÇÃO registra quando ele está presente ou
--     ao telefone (com data e quem registrou). Sem isso, o sistema gera um
--     CONVITE (link) para ele aceitar; sem aceite no prazo (7 dias), a
--     indicação é recusada e os dados dele são anonimizados.
--
-- Páginas públicas (sem login) — só pelas funções abaixo, só a chave de
-- serviço executa, e cada uma devolve o MÍNIMO:
--   /i/[código]  convite_publico + registrar_pelo_link
--   /c/[token]   ver_convite + aceitar_convite
--   /e/[token]   portal_embaixador (2002) + portal_catalogo + portal_resgatar
--                + portal_indicar
--
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Parâmetros novos
-- -----------------------------------------------------------------------------
insert into indica.config (escopo, unidade_id, grupo, chave, valor, travado, descricao, vigente_desde)
values
  ('rede', null, 'portal', 'url_publica', '""', true,
   'Endereço público dos links (ex.: https://risarte.com.br). Vazio = o endereço do próprio sistema.', '2026-01-01 00:00-03'),
  ('rede', null, 'lgpd', 'termo_lgpd_versao_vigente', '"2026.1"', true,
   'Versão do termo de contato (LGPD) que o indicado aceita.', '2026-01-01 00:00-03'),
  ('rede', null, 'antifraude', 'link_limite_diario_por_codigo', '10', true,
   'Indicações por dia que um mesmo link pessoal aceita (proteção contra abuso do formulário público).', '2026-01-01 00:00-03'),
  ('rede', null, 'mensagens', 'msg_obrigado_embaixador',
   '"Oi {embaixador}! Obrigado por indicar {indicado} para a Risarte. Vamos cuidar muito bem dessa pessoa. 😁"', false,
   'Ao registrar a indicação — para quem indicou.', '2026-01-01 00:00-03'),
  ('rede', null, 'mensagens', 'msg_convite_indicado',
   '"Oi {indicado}! {embaixador} indicou você para conhecer a Risarte Odontologia ({unidade}). Para a gente entrar em contato, é só confirmar aqui: {link}"', false,
   'Convite ao indicado para aceitar o contato (LGPD), quando a recepção não registrou o aceite.', '2026-01-01 00:00-03'),
  ('rede', null, 'mensagens', 'msg_compareceu_embaixador',
   '"{embaixador}, {indicado} veio conhecer a Risarte! Você ganhou {pontos} Riso Coins. Saldo disponível: {saldo}."', false,
   'Quando o indicado comparece à avaliação.', '2026-01-01 00:00-03'),
  ('rede', null, 'mensagens', 'msg_fechou_embaixador',
   '"{embaixador}, {indicado} começou o tratamento na Risarte! {pontos} Riso Coins liberam até {data}."', false,
   'Quando o indicado fecha o tratamento (pontos em carência).', '2026-01-01 00:00-03'),
  ('rede', null, 'mensagens', 'msg_convertida_embaixador',
   '"{embaixador}, seus Riso Coins da indicação de {indicado} foram liberados! Saldo disponível: {saldo}."', false,
   'Quando os pontos da carência são liberados.', '2026-01-01 00:00-03'),
  ('rede', null, 'mensagens', 'msg_a_vencer_embaixador',
   '"{embaixador}, você tem {pontos} Riso Coins que vencem nos próximos 30 dias. Que tal trocar por um prêmio? Fale com a sua unidade."', false,
   'Lembrete de Riso Coins a vencer (30 dias antes).', '2026-01-01 00:00-03'),
  ('rede', null, 'mensagens', 'msg_link_portal',
   '"Oi {embaixador}! Este é o seu acesso ao Indica +Risos: saldo, indicações e prêmios. {link}"', false,
   'Envio do link do portal ao Embaixador.', '2026-01-01 00:00-03')
on conflict on constraint config_versao_unica do nothing;

-- Aceite registrado por TELEFONE também vale (a recepção ligou para o indicado).
alter table indica.consentimentos drop constraint if exists consentimentos_canal_check;
alter table indica.consentimentos add constraint consentimentos_canal_check
  check (canal in ('link', 'whatsapp', 'presencial', 'telefone', 'portal'));

-- Convite ao indicado: só o HASH do link fica no banco.
alter table indica.indicacoes
  add column if not exists convite_token_hash bytea,
  add column if not exists convite_expira_em timestamptz;
create unique index if not exists indicacoes_convite_uq
  on indica.indicacoes (convite_token_hash) where convite_token_hash is not null;

-- -----------------------------------------------------------------------------
-- 2) FILA DE MENSAGENS (provedor plugável; hoje: envio manual pelo WhatsApp)
-- -----------------------------------------------------------------------------
create table if not exists indica.mensagens (
  id bigint generated always as identity primary key,
  unidade_id uuid not null references public.clinics (id),
  evento text not null,
  destinatario text not null check (destinatario in ('embaixador', 'indicado')),
  embaixador_id uuid references indica.embaixadores (id),
  indicacao_id uuid references indica.indicacoes (id),
  nome text not null,
  telefone text not null,
  texto text not null,                 -- `{link}` é completado na tela (endereço do site)
  link_caminho text,                   -- ex.: /c/<token>, /i/JOANA27
  status text not null default 'a_enviar' check (status in ('a_enviar', 'enviada', 'descartada')),
  enviada_por uuid references public.profiles (id),
  enviada_em timestamptz,
  criado_em timestamptz not null default now()
);
create index if not exists mensagens_fila_idx on indica.mensagens (unidade_id, status, criado_em);
-- Um aviso por indicação e evento (o gatilho pode ser chamado de novo).
create unique index if not exists mensagens_evento_uq
  on indica.mensagens (indicacao_id, evento) where indicacao_id is not null;

alter table indica.mensagens enable row level security;
drop policy if exists mensagens_ler on indica.mensagens;
create policy mensagens_ler on indica.mensagens for select to authenticated
  using (indica.eh_risartano(unidade_id));
grant select on indica.mensagens to authenticated;
grant all on indica.mensagens to service_role;

-- Monta o texto a partir do modelo (unidade → rede). `{link}` fica para a tela.
create or replace function indica._render(p_chave text, p_unidade_id uuid, p_vars jsonb)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_texto text := indica.config_valor(p_chave, p_unidade_id) #>> '{}';
  k text;
begin
  for k in select jsonb_object_keys(p_vars) loop
    v_texto := replace(v_texto, '{' || k || '}', coalesce(p_vars ->> k, ''));
  end loop;
  return v_texto;
end;
$$;

create or replace function indica._enfileirar(
  p_unidade_id uuid,
  p_evento text,
  p_destinatario text,
  p_embaixador_id uuid,
  p_indicacao_id uuid,
  p_nome text,
  p_telefone text,
  p_texto text,
  p_link text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if nullif(regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g'), '') is null then
    return; -- sem telefone não há para quem mandar
  end if;
  insert into indica.mensagens
    (unidade_id, evento, destinatario, embaixador_id, indicacao_id, nome, telefone, texto, link_caminho)
  values
    (p_unidade_id, p_evento, p_destinatario, p_embaixador_id, p_indicacao_id,
     p_nome, p_telefone, p_texto, p_link)
  on conflict (indicacao_id, evento) where indicacao_id is not null do nothing;
end;
$$;

-- Marcar como enviada / descartar (Risartano da unidade).
create or replace function indica.marcar_mensagem(p_id bigint, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_unidade uuid;
begin
  if p_status not in ('enviada', 'descartada', 'a_enviar') then
    raise exception 'INDICA_DADOS: situação inválida.';
  end if;
  select unidade_id into v_unidade from indica.mensagens where id = p_id;
  if not found then
    raise exception 'INDICA_NAO_ENCONTRADO: mensagem não encontrada.';
  end if;
  if auth.uid() is not null and not indica.eh_risartano(v_unidade) then
    raise exception 'INDICA_SEM_PERMISSAO: esta mensagem é de outra unidade.';
  end if;
  update indica.mensagens
     set status = p_status,
         enviada_por = case when p_status = 'enviada' then auth.uid() end,
         enviada_em = case when p_status = 'enviada' then now() end
   where id = p_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3) Mensagens dos EVENTOS da indicação (gatilho blindado na linha do tempo)
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
begin
  if new.status_para not in ('registrada', 'compareceu', 'fechou', 'convertida') then
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
                 when 'compareceu' then 'msg_compareceu_embaixador'
                 when 'fechou' then 'msg_fechou_embaixador'
                 else 'msg_convertida_embaixador'
               end;
    v_vars := jsonb_build_object(
      'embaixador', v_emb.nome,
      'indicado', case when v.desvinculada_em is null then split_part(btrim(v.indicado_nome), ' ', 1) else 'a pessoa que você indicou' end,
      'pontos', coalesce((new.dados ->> 'pontos')::integer, 0) + coalesce((new.dados ->> 'liberados')::integer, 0),
      'saldo', v_saldo,
      'data', case when v.fechou_em is not null
                   then to_char((v.fechou_em + make_interval(days => (v.regra_congelada ->> 'carencia_dias')::integer))
                                at time zone 'America/Sao_Paulo', 'DD/MM/YYYY') end
    );
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
-- 4) Consentimento e convite
-- -----------------------------------------------------------------------------
-- Grava o aceite e liga à indicação (motor).
create or replace function indica._gravar_consentimento(
  p_indicacao_id uuid, p_canal text, p_ip inet, p_usuario uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_antes text := coalesce(current_setting('indica.motor', true), '');
  v_id uuid;
begin
  insert into indica.consentimentos (indicacao_id, texto_versao, canal, ip, aceito_em, registrado_por)
  values (p_indicacao_id, indica.config_valor('termo_lgpd_versao_vigente') #>> '{}', p_canal, p_ip, now(), p_usuario)
  returning id into v_id;
  perform set_config('indica.motor', 'sim', true);
  update indica.indicacoes
     set consentimento_id = v_id, convite_token_hash = null, convite_expira_em = null
   where id = p_indicacao_id;
  perform set_config('indica.motor', v_antes, true);
  return v_id;
end;
$$;

-- Gera o convite (link /c/<token>) e põe a mensagem na fila da unidade.
create or replace function indica._gerar_convite(p_indicacao_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_antes text := coalesce(current_setting('indica.motor', true), '');
  v indica.indicacoes;
  v_token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  v_indicador text;
  v_unidade text;
begin
  select * into v from indica.indicacoes where id = p_indicacao_id;
  perform set_config('indica.motor', 'sim', true);
  update indica.indicacoes
     set convite_token_hash = sha256(convert_to(v_token, 'UTF8')),
         convite_expira_em = now() + make_interval(
           days => (indica.config_numero('consentimento_prazo_dias'))::integer)
   where id = p_indicacao_id;
  perform set_config('indica.motor', v_antes, true);

  v_indicador := coalesce(
    (select split_part(btrim(c.full_name), ' ', 1)
       from indica.embaixadores e join public.clients c on c.id = e.cliente_id
      where e.id = v.embaixador_id),
    (select p.nome from indica.parceiros p where p.id = v.parceiro_id),
    'Alguém');
  select name into v_unidade from public.clinics where id = v.unidade_id;

  perform indica._enfileirar(v.unidade_id, 'convite', 'indicado', v.embaixador_id, v.id,
    split_part(btrim(v.indicado_nome), ' ', 1), v.indicado_telefone,
    indica._render('msg_convite_indicado', v.unidade_id, jsonb_build_object(
      'indicado', split_part(btrim(v.indicado_nome), ' ', 1),
      'embaixador', v_indicador,
      'unidade', v_unidade)),
    '/c/' || v_token);
  return v_token;
end;
$$;

-- Aceite registrado pela RECEPÇÃO depois do registro (ex.: ligou para o indicado).
create or replace function indica.registrar_aceite(p_indicacao_id uuid, p_canal text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v indica.indicacoes;
begin
  if p_canal not in ('presencial', 'telefone') then
    raise exception 'INDICA_DADOS: o aceite registrado pela equipe é presencial ou por telefone.';
  end if;
  select * into v from indica.indicacoes where id = p_indicacao_id;
  if not found then
    raise exception 'INDICA_NAO_ENCONTRADA: indicação não encontrada.';
  end if;
  if v_uid is not null and not indica.eh_risartano(v.unidade_id) then
    raise exception 'INDICA_SEM_PERMISSAO: esta indicação é de outra unidade.';
  end if;
  if v.consentimento_id is not null then
    return v.consentimento_id;
  end if;
  if v.anonimizada_em is not null or v.status in ('recusada', 'cancelada', 'expirada') then
    raise exception 'INDICA_TRANSICAO_INVALIDA: indicação encerrada.';
  end if;
  return indica._gravar_consentimento(p_indicacao_id, p_canal, null, v_uid);
end;
$$;

-- -----------------------------------------------------------------------------
-- 5) registrar_indicacao: + aceite (recepção ou link) + convite quando faltar
-- -----------------------------------------------------------------------------
-- p_dados ganha: consentimento = 'presencial' | 'telefone' | 'link' | null,
--                consentimento_ip (só pelo link público).
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
  -- Aceite pelo link só existe na página pública (sem pessoa logada).
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

  -- LGPD: aceite já dado (recepção ou link) — ou convite para o indicado.
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
                             'aceite', coalesce(v_consent, case when v_cliente is null then 'convite' else 'cadastro' end)),
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
-- 6) PÁGINAS PÚBLICAS — só a chave de serviço executa; devolvem o mínimo
-- -----------------------------------------------------------------------------

-- /i/[código]: quem convida e as unidades para escolher.
create or replace function indica.convite_publico(p_codigo text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when e.id is null then null else jsonb_build_object(
    'indicador', split_part(btrim(c.full_name), ' ', 1),
    'codigo', e.codigo,
    'termo_versao', indica.config_valor('termo_lgpd_versao_vigente') #>> '{}',
    'unidades', coalesce((
      select jsonb_agg(jsonb_build_object('id', u.id, 'nome', u.name, 'cidade', u.city) order by u.name)
        from public.clinics u where u.type = 'franchise_unit' and u.is_active), '[]'::jsonb)
  ) end
    from (select 1) um
    left join indica.embaixadores e
      on e.codigo = upper(btrim(coalesce(p_codigo, ''))) and e.status = 'ativo'
    left join public.clients c on c.id = e.cliente_id;
$$;

-- /i/[código] → enviar. A resposta é GENÉRICA quando a pessoa já foi indicada
-- ou já é cliente: a página pública não pode virar consulta de quem é
-- paciente da rede.
create or replace function indica.registrar_pelo_link(p_codigo text, p_dados jsonb, p_ip inet)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_emb indica.embaixadores;
  v_hoje integer;
  v_limite integer := (indica.config_numero('link_limite_diario_por_codigo'))::integer;
  v_id uuid;
begin
  if auth.uid() is not null then
    raise exception 'INDICA_SEM_PERMISSAO: função da página pública.';
  end if;
  select * into v_emb from indica.embaixadores
   where codigo = upper(btrim(coalesce(p_codigo, ''))) and status = 'ativo';
  if not found then
    return jsonb_build_object('ok', false, 'erro', 'Este convite não está mais ativo.');
  end if;
  if coalesce((p_dados ->> 'aceite')::boolean, false) is not true then
    return jsonb_build_object('ok', false, 'erro', 'Para a Risarte entrar em contato, marque o aceite.');
  end if;

  select count(*) into v_hoje from indica.indicacoes
   where embaixador_id = v_emb.id and canal = 'link'
     and registrada_em >= date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
  if v_hoje >= v_limite then
    perform indica._registrar_falha('link_limite', v_emb.id, null, 'limite diário do link atingido');
    return jsonb_build_object('ok', true, 'situacao', 'recebido');
  end if;

  begin
    v_id := indica.registrar_indicacao(jsonb_build_object(
      'embaixador_id', v_emb.id,
      'canal', 'link',
      'unidade_id', p_dados ->> 'unidade_id',
      'indicado_nome', p_dados ->> 'nome',
      'indicado_telefone', p_dados ->> 'telefone',
      'consentimento', 'link',
      'consentimento_ip', p_ip::text));
    return jsonb_build_object('ok', true, 'situacao', 'recebido');
  exception when others then
    if sqlerrm like 'INDICA_DUPLICADA%' or sqlerrm like 'INDICA_JA_E_CLIENTE%'
       or sqlerrm like 'INDICA_AUTOINDICACAO%' then
      perform indica._registrar_falha('link_recusado', v_emb.id, null, sqlerrm);
      return jsonb_build_object('ok', true, 'situacao', 'recebido');
    end if;
    if sqlerrm like 'INDICA_%' then
      return jsonb_build_object('ok', false, 'erro', regexp_replace(sqlerrm, '^INDICA_[A-Z_]+:\s*', ''));
    end if;
    perform indica._registrar_falha('link', v_emb.id, null, sqlerrm);
    return jsonb_build_object('ok', false, 'erro', 'Não foi possível enviar agora. Tente de novo.');
  end;
end;
$$;

-- /c/[token]: o convite, antes de aceitar.
create or replace function indica.ver_convite(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when i.id is null then null else jsonb_build_object(
    'indicado', split_part(btrim(i.indicado_nome), ' ', 1),
    'indicador', coalesce(split_part(btrim(c.full_name), ' ', 1), p.nome, 'Alguém'),
    'unidade', u.name,
    'termo_versao', indica.config_valor('termo_lgpd_versao_vigente') #>> '{}'
  ) end
    from (select 1) um
    left join indica.indicacoes i
      on length(coalesce(p_token, '')) >= 40
     and i.convite_token_hash = sha256(convert_to(p_token, 'UTF8'))
     and i.convite_expira_em > now()
     and i.anonimizada_em is null
     and i.status not in ('recusada', 'cancelada', 'expirada')
    left join indica.embaixadores e on e.id = i.embaixador_id
    left join public.clients c on c.id = e.cliente_id
    left join indica.parceiros p on p.id = i.parceiro_id
    left join public.clinics u on u.id = i.unidade_id;
$$;

create or replace function indica.aceitar_convite(p_token text, p_ip inet)
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
  return true;
end;
$$;

-- Portal: o catálogo que o Embaixador pode resgatar.
create or replace function indica.portal_catalogo(p_token text)
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
  select e.id, c.clinic_id, n.ordem as nivel_ordem into v_emb
    from indica.embaixadores e
    join public.clients c on c.id = e.cliente_id
    join indica.niveis n on n.id = e.nivel_id
   where e.portal_token_hash = sha256(convert_to(p_token, 'UTF8'))
     and e.portal_token_expira_em > now() and e.status = 'ativo';
  if not found then
    return null;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', i.id, 'nome', i.nome, 'descricao', i.descricao, 'tipo', i.tipo,
             'custo', i.custo_riso_coins, 'valor_centavos', i.valor_centavos,
             'disponivel', (i.estoque is null or i.estoque > 0)
                           and (nm.ordem is null or nm.ordem <= v_emb.nivel_ordem))
           order by i.custo_riso_coins)
      from indica.catalogo_itens i
      left join indica.niveis nm on nm.id = i.nivel_minimo_id
     where i.ativo and (cardinality(i.unidades) = 0 or v_emb.clinic_id = any (i.unidades))), '[]'::jsonb);
end;
$$;

-- Portal: o Embaixador pede o resgate (entrega na unidade dele).
create or replace function indica.portal_resgatar(p_token text, p_item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_emb record;
  v_id uuid;
  v_codigo text;
  v_status text;
begin
  if auth.uid() is not null or p_token is null or length(p_token) < 40 then
    return jsonb_build_object('ok', false, 'erro', 'Acesso inválido.');
  end if;
  select e.id, c.clinic_id into v_emb
    from indica.embaixadores e join public.clients c on c.id = e.cliente_id
   where e.portal_token_hash = sha256(convert_to(p_token, 'UTF8'))
     and e.portal_token_expira_em > now() and e.status = 'ativo';
  if not found then
    return jsonb_build_object('ok', false, 'erro', 'Seu acesso venceu. Peça um novo link à sua unidade.');
  end if;
  begin
    v_id := indica.solicitar_resgate(jsonb_build_object(
      'embaixador_id', v_emb.id, 'item_id', p_item_id, 'unidade_id', v_emb.clinic_id));
  exception when others then
    return jsonb_build_object('ok', false, 'erro', regexp_replace(sqlerrm, '^INDICA_[A-Z_]+:\s*', ''));
  end;
  select codigo, status into v_codigo, v_status from indica.resgates where id = v_id;
  return jsonb_build_object('ok', true, 'codigo', v_codigo, 'status', v_status);
end;
$$;

-- Portal: o Embaixador indica um amigo. O amigo recebe o CONVITE (o
-- Embaixador manda pelo WhatsApp dele; a fila da unidade também guarda).
create or replace function indica.portal_indicar(p_token text, p_dados jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_emb record;
  v_id uuid;
  v_link text;
begin
  if auth.uid() is not null or p_token is null or length(p_token) < 40 then
    return jsonb_build_object('ok', false, 'erro', 'Acesso inválido.');
  end if;
  select e.id, c.clinic_id into v_emb
    from indica.embaixadores e join public.clients c on c.id = e.cliente_id
   where e.portal_token_hash = sha256(convert_to(p_token, 'UTF8'))
     and e.portal_token_expira_em > now() and e.status = 'ativo';
  if not found then
    return jsonb_build_object('ok', false, 'erro', 'Seu acesso venceu. Peça um novo link à sua unidade.');
  end if;
  begin
    v_id := indica.registrar_indicacao(jsonb_build_object(
      'embaixador_id', v_emb.id,
      'canal', 'embaixador',
      'unidade_id', coalesce(nullif(p_dados ->> 'unidade_id', ''), v_emb.clinic_id::text),
      'indicado_nome', p_dados ->> 'nome',
      'indicado_telefone', p_dados ->> 'telefone'));
  exception when others then
    if sqlerrm like 'INDICA_DUPLICADA%' or sqlerrm like 'INDICA_JA_E_CLIENTE%' then
      return jsonb_build_object('ok', false, 'erro', 'Esta pessoa já foi indicada ou já é paciente da Risarte.');
    end if;
    return jsonb_build_object('ok', false, 'erro', regexp_replace(sqlerrm, '^INDICA_[A-Z_]+:\s*', ''));
  end;
  select link_caminho into v_link from indica.mensagens where indicacao_id = v_id and evento = 'convite';
  return jsonb_build_object('ok', true, 'link', v_link,
    'texto', (select texto from indica.mensagens where indicacao_id = v_id and evento = 'convite'));
end;
$$;

-- -----------------------------------------------------------------------------
-- 7) Rotina diária: + aceite vencido (LGPD) + lembrete de pontos a vencer
-- -----------------------------------------------------------------------------
create or replace function indica.rotina_diaria()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_antes text := coalesce(current_setting('indica.motor', true), '');
  r record;
  v_expiradas integer := 0;
  v_convertidas integer := 0;
  v_riso_vencidos integer := 0;
  v_niveis integer := 0;
  v_anonimizadas integer := 0;
  v_sem_aceite integer := 0;
  v_lembretes integer := 0;
  v_falhas integer := 0;
  v_meses_lgpd integer;
  v_prazo_aceite integer;
  v_resultado jsonb;
begin
  if auth.uid() is not null then
    raise exception 'INDICA_SEM_PERMISSAO: a rotina diária roda sozinha.';
  end if;

  -- (0) LGPD: convite sem aceite no prazo → recusada e anonimizada já.
  v_prazo_aceite := (indica.config_numero('consentimento_prazo_dias'))::integer;
  for r in
    select id from indica.indicacoes
     where status in ('registrada', 'validada')
       and consentimento_id is null
       and cliente_indicado_id is null
       and anonimizada_em is null
       and registrada_em < now() - make_interval(days => v_prazo_aceite)
  loop
    begin
      perform indica._mudar_status(r.id, 'recusada', 'Rotina: o indicado não aceitou o contato no prazo (LGPD).', '{}'::jsonb, null);
      perform set_config('indica.motor', 'sim', true);
      update indica.indicacoes
         set indicado_nome = 'Anonimizado', indicado_telefone = null, indicado_cpf = null,
             indicado_email = null, anonimizada_em = now(),
             convite_token_hash = null, convite_expira_em = null
       where id = r.id;
      perform set_config('indica.motor', v_antes, true);
      update indica.mensagens set status = 'descartada'
       where indicacao_id = r.id and status = 'a_enviar';
      v_sem_aceite := v_sem_aceite + 1;
    exception when others then
      v_falhas := v_falhas + 1;
      perform indica._registrar_falha('rotina_aceite', null, r.id, sqlerrm);
    end;
  end loop;

  -- (1) Trava de atribuição vencida → expirada.
  for r in
    select id from indica.indicacoes
     where status in ('registrada', 'validada', 'agendada', 'faltou', 'nao_fechou')
       and trava_ate < now()
  loop
    begin
      perform indica._mudar_status(r.id, 'expirada', 'Rotina: trava de atribuição vencida.', '{}'::jsonb, null);
      v_expiradas := v_expiradas + 1;
    exception when others then
      v_falhas := v_falhas + 1;
      perform indica._registrar_falha('rotina_expirar', null, r.id, sqlerrm);
    end;
  end loop;

  -- (2) Carência vencida (prazo) → convertida.
  for r in
    select id from indica.indicacoes
     where status = 'fechou'
       and fechou_em + make_interval(days => (regra_congelada ->> 'carencia_dias')::integer) <= now()
  loop
    begin
      perform indica._mudar_status(r.id, 'convertida', 'Rotina: fim do prazo de carência.', '{}'::jsonb, null);
      v_convertidas := v_convertidas + 1;
    exception when others then
      v_falhas := v_falhas + 1;
      perform indica._registrar_falha('rotina_carencia', null, r.id, sqlerrm);
    end;
  end loop;

  -- (3) Riso Coins vencidos.
  for r in
    select distinct embaixador_id from indica.pontos_lancamentos
     where saldo = 'disponivel' and riso_coins > 0 and expira_em <= now()
  loop
    v_riso_vencidos := v_riso_vencidos + indica._expirar_riso_coins(r.embaixador_id);
  end loop;

  -- (4) Níveis: no dia 1 (Brasília), para todos os ativos.
  if extract(day from now() at time zone 'America/Sao_Paulo') = 1 then
    for r in select id from indica.embaixadores where status = 'ativo' loop
      begin
        perform indica.recalcular_nivel(r.id);
        v_niveis := v_niveis + 1;
      exception when others then
        v_falhas := v_falhas + 1;
        perform indica._registrar_falha('rotina_nivel', r.id, null, sqlerrm);
      end;
    end loop;
  end if;

  -- (5) LGPD: encerradas há mais que o parâmetro.
  v_meses_lgpd := (indica.config_numero('anonimizar_encerradas_apos_meses'))::integer;
  perform set_config('indica.motor', 'sim', true);
  update indica.indicacoes
     set indicado_nome = 'Anonimizado', indicado_telefone = null, indicado_cpf = null,
         indicado_email = null, anonimizada_em = now()
   where anonimizada_em is null
     and status in ('recusada', 'expirada', 'cancelada')
     and encerrada_em < now() - make_interval(months => v_meses_lgpd);
  get diagnostics v_anonimizadas = row_count;
  perform set_config('indica.motor', v_antes, true);

  -- (6) Lembrete: Riso Coins a vencer em 30 dias (no máximo 1 por mês).
  for r in
    select s.embaixador_id, s.a_vencer_30_dias, split_part(btrim(c.full_name), ' ', 1) as nome,
           c.phone, c.clinic_id
      from indica.v_saldo_embaixador s
      join indica.embaixadores e on e.id = s.embaixador_id and e.status = 'ativo'
      join public.clients c on c.id = e.cliente_id
     where s.a_vencer_30_dias > 0
       and not exists (select 1 from indica.mensagens m
                        where m.embaixador_id = s.embaixador_id and m.evento = 'a_vencer'
                          and m.criado_em > now() - interval '30 days')
  loop
    begin
      perform indica._enfileirar(r.clinic_id, 'a_vencer', 'embaixador', r.embaixador_id, null, r.nome, r.phone,
        indica._render('msg_a_vencer_embaixador', r.clinic_id,
          jsonb_build_object('embaixador', r.nome, 'pontos', r.a_vencer_30_dias)));
      v_lembretes := v_lembretes + 1;
    exception when others then
      v_falhas := v_falhas + 1;
      perform indica._registrar_falha('rotina_lembrete', r.embaixador_id, null, sqlerrm);
    end;
  end loop;

  v_resultado := jsonb_build_object(
    'expiradas', v_expiradas,
    'convertidas_por_prazo', v_convertidas,
    'riso_coins_vencidos', v_riso_vencidos,
    'niveis_recalculados', v_niveis,
    'anonimizadas', v_anonimizadas,
    'sem_aceite_lgpd', v_sem_aceite,
    'lembretes_a_vencer', v_lembretes,
    'falhas', v_falhas
  );
  insert into indica.rotinas_execucoes (resultado) values (v_resultado);
  return v_resultado;
end;
$$;

-- -----------------------------------------------------------------------------
-- 8) Permissões (AP15)
-- -----------------------------------------------------------------------------
revoke execute on function indica._render(text, uuid, jsonb) from public, anon, authenticated;
revoke execute on function indica._enfileirar(uuid, text, text, uuid, uuid, text, text, text, text) from public, anon, authenticated;
revoke execute on function indica.marcar_mensagem(bigint, text) from public, anon, authenticated;
revoke execute on function indica.mensagens_dos_eventos() from public, anon, authenticated;
revoke execute on function indica._gravar_consentimento(uuid, text, inet, uuid) from public, anon, authenticated;
revoke execute on function indica._gerar_convite(uuid) from public, anon, authenticated;
revoke execute on function indica.registrar_aceite(uuid, text) from public, anon, authenticated;
revoke execute on function indica.registrar_indicacao(jsonb) from public, anon, authenticated;
revoke execute on function indica.convite_publico(text) from public, anon, authenticated;
revoke execute on function indica.registrar_pelo_link(text, jsonb, inet) from public, anon, authenticated;
revoke execute on function indica.ver_convite(text) from public, anon, authenticated;
revoke execute on function indica.aceitar_convite(text, inet) from public, anon, authenticated;
revoke execute on function indica.portal_catalogo(text) from public, anon, authenticated;
revoke execute on function indica.portal_resgatar(text, uuid) from public, anon, authenticated;
revoke execute on function indica.portal_indicar(text, jsonb) from public, anon, authenticated;
revoke execute on function indica.rotina_diaria() from public, anon, authenticated;

grant execute on function indica.marcar_mensagem(bigint, text) to authenticated, service_role;
grant execute on function indica.registrar_aceite(uuid, text) to authenticated, service_role;
grant execute on function indica.registrar_indicacao(jsonb) to authenticated, service_role;
-- Páginas públicas e rotina: só o servidor.
grant execute on function indica.convite_publico(text) to service_role;
grant execute on function indica.registrar_pelo_link(text, jsonb, inet) to service_role;
grant execute on function indica.ver_convite(text) to service_role;
grant execute on function indica.aceitar_convite(text, inet) to service_role;
grant execute on function indica.portal_catalogo(text) to service_role;
grant execute on function indica.portal_resgatar(text, uuid) to service_role;
grant execute on function indica.portal_indicar(text, jsonb) to service_role;
grant execute on function indica.rotina_diaria() to service_role;

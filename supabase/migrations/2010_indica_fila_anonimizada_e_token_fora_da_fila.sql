-- =============================================================================
-- 2010 — Indica +Risos: a anonimização limpa a FILA de mensagens, e o token do
--        convite sai da fila (tabela só da chave de serviço)
-- -----------------------------------------------------------------------------
-- Achados AP100 e AP101 do BACKLOG (levantamento da Rita, E4 e E13) e item 3
-- do plano aprovado pelo dono em 03/11/2026 (docs/sdr/PLANO-CORRECOES-SECAO-2.md):
--
--   * AP101 — a rotina diária zerava nome/telefone/CPF/e-mail em
--     `indicacoes`, mas em `indica.mensagens` só marcava `a_enviar →
--     descartada`: nome, telefone, texto e link do indicado ficavam na fila.
--   * AP100 — `indicacoes` guarda só o sha256 do token do convite, mas
--     `_gerar_convite` gravava o token EM CLARO em `mensagens.link_caminho`
--     (`/c/<token>`), legível por qualquer Risartano da unidade
--     (`mensagens_ler`), que conseguiria aceitar em nome do indicado.
--
-- Decisão do dono (03/11/2026): OPÇÃO A — tabela `indica.convites_tokens`
-- sem política de leitura (só `service_role`), fora da auditoria (registro
-- técnico). `_gerar_convite` grava lá e deixa `mensagens.link_caminho = '/c/'`;
-- a tela "Abrir WhatsApp" pede o link ao servidor (`link_do_convite`, só a
-- chave de serviço), que registra quem pediu em `audit_logs`. Os tokens já
-- gravados são MOVIDOS (update, nada se apaga).
--
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) O cofre do token do convite — só a chave de serviço lê
-- -----------------------------------------------------------------------------
create table if not exists indica.convites_tokens (
  indicacao_id uuid primary key references indica.indicacoes (id) on delete cascade,
  token text not null,
  criado_em timestamptz not null default now()
);
comment on table indica.convites_tokens is
  'Token em claro do convite /c/<token> (AP100). Sem política de leitura: só a chave de serviço, por indica.link_do_convite. Registro técnico, fora da auditoria.';

alter table indica.convites_tokens enable row level security;
-- Nenhuma política: mesmo com privilégio, a RLS não entrega linha a quem está
-- logado. E o privilégio também sai (o schema `indica` dá `select` a
-- `authenticated` em outras tabelas, nunca nesta).
revoke all on table indica.convites_tokens from public, anon, authenticated;
grant all on table indica.convites_tokens to service_role;

-- Registro técnico: fora da auditoria (0288), com o motivo declarado.
insert into public.audit_excluded_tables (schema_name, table_name, motivo) values
  ('indica', 'convites_tokens', 'Registro técnico: token do convite ao indicado (AP100). Auditar gravaria o próprio token na trilha, que qualquer Admin lê; quem ABRE o link fica em audit_logs por indica.link_do_convite.')
on conflict (schema_name, table_name) do nothing;

-- -----------------------------------------------------------------------------
-- 2) _gerar_convite: o token vai para o cofre; a fila fica com '/c/'
-- -----------------------------------------------------------------------------
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

  -- O token em claro fica SÓ aqui (AP100).
  insert into indica.convites_tokens (indicacao_id, token)
  values (p_indicacao_id, v_token)
  on conflict (indicacao_id) do update set token = excluded.token, criado_em = now();

  v_indicador := coalesce(
    (select split_part(btrim(c.full_name), ' ', 1)
       from indica.embaixadores e join public.clients c on c.id = e.cliente_id
      where e.id = v.embaixador_id),
    (select p.nome from indica.parceiros p where p.id = v.parceiro_id),
    'Alguém');
  select name into v_unidade from public.clinics where id = v.unidade_id;

  -- `link_caminho` = só o caminho, SEM o token: a tela pede o link ao
  -- servidor na hora de abrir o WhatsApp (indica.link_do_convite).
  perform indica._enfileirar(v.unidade_id, 'convite', 'indicado', v.embaixador_id, v.id,
    split_part(btrim(v.indicado_nome), ' ', 1), v.indicado_telefone,
    indica._render('msg_convite_indicado', v.unidade_id, jsonb_build_object(
      'indicado', split_part(btrim(v.indicado_nome), ' ', 1),
      'embaixador', v_indicador,
      'unidade', v_unidade)),
    '/c/');
  return v_token;
end;
$$;

-- Aceite dado: o token deixa de valer (o hash já era zerado) e sai do cofre.
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
  delete from indica.convites_tokens where indicacao_id = p_indicacao_id;
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3) O link do convite, pela porta do servidor (só service_role)
-- -----------------------------------------------------------------------------
-- A tela "Mensagens" chama por server action com a chave de serviço e passa
-- quem pediu (`p_usuario`), que fica em `audit_logs` (só ids). Devolve nulo
-- quando o convite já foi aceito, venceu ou a indicação encerrou.
create or replace function indica.link_do_convite(p_mensagem_id bigint, p_usuario uuid default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  m indica.mensagens;
  v_token text;
  v_hash bytea;
  v_expira timestamptz;
begin
  if auth.uid() is not null then
    raise exception 'INDICA_SEM_PERMISSAO: o link do convite só sai pelo servidor.';
  end if;
  select * into m from indica.mensagens where id = p_mensagem_id;
  if not found or m.evento <> 'convite' or m.indicacao_id is null then
    return null;
  end if;
  select t.token, i.convite_token_hash, i.convite_expira_em
    into v_token, v_hash, v_expira
    from indica.convites_tokens t
    join indica.indicacoes i on i.id = t.indicacao_id
   where t.indicacao_id = m.indicacao_id
     and i.anonimizada_em is null
     and i.consentimento_id is null
     and i.status not in ('recusada', 'cancelada', 'expirada');
  if v_token is null
     or v_hash is distinct from sha256(convert_to(v_token, 'UTF8'))
     or v_expira is null or v_expira <= now() then
    return null;
  end if;
  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values (p_usuario, m.unidade_id, 'view', 'indica_convite_link', p_mensagem_id::text,
          jsonb_build_object('indicacao_id', m.indicacao_id));
  return '/c/' || v_token;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4) Portal: "indicar um amigo" devolve o convite pronto — o link vem do cofre
-- -----------------------------------------------------------------------------
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
  select '/c/' || t.token into v_link from indica.convites_tokens t where t.indicacao_id = v_id;
  return jsonb_build_object('ok', true, 'link', v_link,
    'texto', (select texto from indica.mensagens where indicacao_id = v_id and evento = 'convite'));
end;
$$;

-- -----------------------------------------------------------------------------
-- 5) Rotina diária: a anonimização limpa a fila junto (passos 0 e 5)
-- -----------------------------------------------------------------------------
-- Para cada indicação anonimizada: as mensagens dela ficam sem nome, telefone,
-- texto e link; `a_enviar` vira `descartada`; o token sai do cofre.
create or replace function indica._anonimizar_fila(p_indicacao_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update indica.mensagens
     set nome = 'Anonimizado', telefone = '', texto = '', link_caminho = null,
         status = case when status = 'a_enviar' then 'descartada' else status end
   where indicacao_id = p_indicacao_id;
  delete from indica.convites_tokens where indicacao_id = p_indicacao_id;
end;
$$;

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

  -- (0) LGPD: convite sem aceite no prazo → recusada e anonimizada já
  --     (a indicação E a fila de mensagens dela).
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
      perform indica._anonimizar_fila(r.id);
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

  -- (5) LGPD: encerradas há mais que o parâmetro — a indicação e a fila dela.
  v_meses_lgpd := (indica.config_numero('anonimizar_encerradas_apos_meses'))::integer;
  for r in
    select id from indica.indicacoes
     where anonimizada_em is null
       and status in ('recusada', 'expirada', 'cancelada')
       and encerrada_em < now() - make_interval(months => v_meses_lgpd)
  loop
    begin
      perform set_config('indica.motor', 'sim', true);
      update indica.indicacoes
         set indicado_nome = 'Anonimizado', indicado_telefone = null, indicado_cpf = null,
             indicado_email = null, anonimizada_em = now(),
             convite_token_hash = null, convite_expira_em = null
       where id = r.id;
      perform set_config('indica.motor', v_antes, true);
      perform indica._anonimizar_fila(r.id);
      v_anonimizadas := v_anonimizadas + 1;
    exception when others then
      v_falhas := v_falhas + 1;
      perform indica._registrar_falha('rotina_anonimizar', null, r.id, sqlerrm);
    end;
  end loop;

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
-- 6) Dados existentes: os tokens em claro são MOVIDOS para o cofre (update;
--    nada se apaga) e a fila fica com '/c/'. Mensagens de indicações já
--    anonimizadas ganham a mesma limpeza da rotina.
-- -----------------------------------------------------------------------------
insert into indica.convites_tokens (indicacao_id, token)
select m.indicacao_id, substr(m.link_caminho, 4)
  from indica.mensagens m
  join indica.indicacoes i on i.id = m.indicacao_id
 where m.evento = 'convite'
   and m.link_caminho ~ '^/c/[0-9a-f]{64}$'
   and i.convite_token_hash is not null
on conflict (indicacao_id) do nothing;

update indica.mensagens
   set link_caminho = '/c/'
 where link_caminho ~ '^/c/[0-9a-f]{64}$';

update indica.mensagens m
   set nome = 'Anonimizado', telefone = '', texto = '', link_caminho = null,
       status = case when m.status = 'a_enviar' then 'descartada' else m.status end
  from indica.indicacoes i
 where i.id = m.indicacao_id
   and i.anonimizada_em is not null
   and (m.nome <> 'Anonimizado' or m.telefone <> '' or m.texto <> '' or m.link_caminho is not null);

-- -----------------------------------------------------------------------------
-- 7) Permissões (AP15)
-- -----------------------------------------------------------------------------
revoke execute on function indica._gerar_convite(uuid) from public, anon, authenticated;
revoke execute on function indica._gravar_consentimento(uuid, text, inet, uuid) from public, anon, authenticated;
revoke execute on function indica._anonimizar_fila(uuid) from public, anon, authenticated;
revoke execute on function indica.link_do_convite(bigint, uuid) from public, anon, authenticated;
revoke execute on function indica.portal_indicar(text, jsonb) from public, anon, authenticated;
revoke execute on function indica.rotina_diaria() from public, anon, authenticated;

-- Só o servidor.
grant execute on function indica.link_do_convite(bigint, uuid) to service_role;
grant execute on function indica.portal_indicar(text, jsonb) to service_role;
grant execute on function indica.rotina_diaria() to service_role;

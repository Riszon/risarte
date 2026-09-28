-- =============================================================================
-- 2005 — Indica +Risos (IND3a): as etapas andam sozinhas + rotina diária
-- -----------------------------------------------------------------------------
-- GATILHOS nas tabelas do riSZon (agenda, Comercial, Financeiro):
--   avaliação do indicado AGENDADA  → (validada →) agendada
--   CHECK-IN da avaliação           → compareceu (libera os pendentes)
--   FALTA na avaliação              → faltou
--   venda FECHADA (closed_at)       → fechou (pontos em carência)
--   1ª PARCELA paga                 → convertida (libera a carência)
--   venda CANCELADA na carência     → cancelada (estorno)
--
-- ⚠️ BLINDADOS: estes gatilhos vivem DENTRO de fluxos do núcleo (check-in,
-- fechamento, baixa). Se o Indica falhar por QUALQUER motivo, o fluxo do
-- núcleo segue intacto: o erro vai para `indica.falhas_automacao` e a
-- indicação continua podendo andar pelo botão manual. Nenhuma recepção fica
-- sem fazer check-in por causa do programa de indicação.
--
-- ROTINA DIÁRIA (pg_cron, 02:30 de Brasília): expira travas vencidas, libera
-- carências por prazo, vence Riso Coins (o que vence primeiro sai primeiro),
-- recalcula níveis no dia 1 e anonimiza indicações encerradas há mais tempo
-- que o parâmetro (LGPD). Cada execução fica registrada.
--
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Registro das falhas da automação e das execuções da rotina
-- -----------------------------------------------------------------------------
create table if not exists indica.falhas_automacao (
  id bigint generated always as identity primary key,
  origem text not null,
  registro_id uuid,
  indicacao_id uuid references indica.indicacoes (id),
  erro text not null,
  criado_em timestamptz not null default now()
);
create index if not exists falhas_automacao_criado_idx on indica.falhas_automacao (criado_em desc);

create table if not exists indica.rotinas_execucoes (
  id bigint generated always as identity primary key,
  executada_em timestamptz not null default now(),
  resultado jsonb not null
);

alter table indica.falhas_automacao enable row level security;
alter table indica.rotinas_execucoes enable row level security;

drop policy if exists falhas_ler on indica.falhas_automacao;
create policy falhas_ler on indica.falhas_automacao for select to authenticated
  using (indica.eh_franqueadora()
         or (indicacao_id is not null
             and exists (select 1 from indica.indicacoes i
                          where i.id = indicacao_id and indica.eh_gestor(i.unidade_id))));
drop policy if exists rotinas_ler on indica.rotinas_execucoes;
create policy rotinas_ler on indica.rotinas_execucoes for select to authenticated
  using (indica.eh_franqueadora());

grant select on indica.falhas_automacao, indica.rotinas_execucoes to authenticated;
grant all on indica.falhas_automacao, indica.rotinas_execucoes to service_role;

create or replace function indica._registrar_falha(
  p_origem text, p_registro uuid, p_indicacao uuid, p_erro text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into indica.falhas_automacao (origem, registro_id, indicacao_id, erro)
  values (p_origem, p_registro, p_indicacao, left(coalesce(p_erro, ''), 1000));
exception when others then
  null; -- nem o registro da falha pode derrubar o fluxo do núcleo
end;
$$;

-- -----------------------------------------------------------------------------
-- 2) Qual indicação em aberto é deste cliente?
-- -----------------------------------------------------------------------------
-- Pelo cadastro ligado; se nenhuma está ligada, pelo TELEFONE ou CPF do
-- cadastro (a recepção registrou a indicação antes de o indicado ter ficha).
-- Só devolve se houver exatamente UMA — na dúvida, a automação não chuta.
create or replace function indica._indicacao_aberta_do_cliente(p_cliente_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_ids uuid[];
  v_tel text;
  v_cpf text;
begin
  select i.id into v_id
    from indica.indicacoes i
   where i.cliente_indicado_id = p_cliente_id
     and i.status not in ('recusada', 'cancelada', 'expirada', 'convertida')
   limit 1;
  if found then
    return v_id;
  end if;

  select nullif(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g'), ''),
         public.cpf_digits(c.cpf)
    into v_tel, v_cpf
    from public.clients c where c.id = p_cliente_id;

  select array_agg(i.id) into v_ids
    from indica.indicacoes i
   where i.cliente_indicado_id is null
     and i.status in ('registrada', 'validada', 'faltou')
     and ((v_tel is not null and i.indicado_telefone_digitos = v_tel)
       or (v_cpf is not null and i.indicado_cpf_digitos = v_cpf));
  if coalesce(cardinality(v_ids), 0) = 1 then
    return v_ids[1];
  end if;
  return null;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3) AGENDA: avaliação agendada, check-in e falta
-- -----------------------------------------------------------------------------
create or replace function indica.automacao_agenda()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ind uuid;
  v indica.indicacoes;
  v_situacao_atual text;
begin
  if new.type::text <> 'evaluation' then
    return new;
  end if;

  begin
    v_ind := indica._indicacao_aberta_do_cliente(new.client_id);
    if v_ind is null then
      return new;
    end if;
    select * into v from indica.indicacoes where id = v_ind;

    -- (a) Avaliação marcada (ou remarcada): liga a indicação a ela.
    if new.status::text not in ('cancelled', 'no_show') and new.checked_in_at is null
       and v.status in ('registrada', 'validada', 'faltou', 'agendada') then
      if v.status = 'agendada' then
        select a.status::text into v_situacao_atual
          from public.appointments a where a.id = v.agendamento_id;
        -- Já ligada a uma avaliação ainda válida: não troca sozinha.
        if v.agendamento_id = new.id
           or (v_situacao_atual is not null
               and v_situacao_atual not in ('cancelled', 'no_show')) then
          return new;
        end if;
      end if;
      if v.status = 'registrada' then
        perform indica._mudar_status(v.id, 'validada', 'Automático: avaliação agendada.', '{}'::jsonb, auth.uid());
      end if;
      perform indica._mudar_status(v.id, 'agendada', 'Automático: avaliação agendada.',
                                   jsonb_build_object('agendamento_id', new.id), auth.uid());
      return new;
    end if;

    -- (b) Check-in da avaliação: compareceu.
    if new.checked_in_at is not null
       and (tg_op = 'INSERT' or old.checked_in_at is null)
       and coalesce(new.attendance::text, '') <> 'gave_up' then
      if v.status = 'registrada' then
        perform indica._mudar_status(v.id, 'validada', 'Automático: check-in da avaliação.', '{}'::jsonb, auth.uid());
        v.status := 'validada';
      end if;
      if v.status in ('validada', 'faltou')
         or (v.status = 'agendada' and v.agendamento_id is distinct from new.id) then
        perform indica._mudar_status(v.id, 'agendada', 'Automático: check-in da avaliação.',
                                     jsonb_build_object('agendamento_id', new.id), auth.uid());
      end if;
      perform indica._mudar_status(v.id, 'compareceu', 'Automático: check-in da avaliação.',
                                   jsonb_build_object('agendamento_id', new.id), auth.uid());
      return new;
    end if;

    -- (c) Falta na avaliação ligada.
    if tg_op = 'UPDATE' and new.status::text = 'no_show' and old.status::text <> 'no_show'
       and v.status = 'agendada' and v.agendamento_id = new.id then
      perform indica._mudar_status(v.id, 'faltou', 'Automático: falta na avaliação.', '{}'::jsonb, auth.uid());
    end if;
  exception when others then
    perform indica._registrar_falha('agenda', new.id, v_ind, sqlerrm);
  end;
  return new;
end;
$$;

drop trigger if exists indica_automacao_agenda on public.appointments;
create trigger indica_automacao_agenda
  after insert or update of status, checked_in_at, attendance on public.appointments
  for each row execute function indica.automacao_agenda();

-- -----------------------------------------------------------------------------
-- 4) COMERCIAL: venda fechada e venda cancelada
-- -----------------------------------------------------------------------------
create or replace function indica.automacao_venda()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v indica.indicacoes;
begin
  begin
    -- Fechou: contrato + pagamento confirmados (closed_at passou a existir).
    if new.closed_at is not null and old.closed_at is null and new.cancelled_at is null then
      select * into v
        from indica.indicacoes
       where cliente_indicado_id = new.client_id and status in ('compareceu', 'nao_fechou')
       limit 1;
      if found then
        perform indica._mudar_status(v.id, 'fechou', 'Automático: venda fechada no Comercial.',
                                     jsonb_build_object('venda_id', new.id), auth.uid());
      end if;
    end if;

    -- Cancelada durante a carência: estorna.
    if new.cancelled_at is not null and old.cancelled_at is null then
      select * into v from indica.indicacoes where venda_id = new.id and status = 'fechou';
      if found then
        perform indica._mudar_status(v.id, 'cancelada',
          'Automático: venda cancelada no Comercial' ||
            coalesce(' (' || nullif(btrim(new.cancel_reason), '') || ')', '') || '.',
          '{}'::jsonb, auth.uid());
      end if;
    end if;
  exception when others then
    perform indica._registrar_falha('venda', new.id, v.id, sqlerrm);
  end;
  return new;
end;
$$;

drop trigger if exists indica_automacao_venda on public.commercial_sales;
create trigger indica_automacao_venda
  after update of closed_at, cancelled_at on public.commercial_sales
  for each row execute function indica.automacao_venda();

-- -----------------------------------------------------------------------------
-- 5) FINANCEIRO: 1ª parcela paga libera a carência
-- -----------------------------------------------------------------------------
create or replace function indica.automacao_parcela()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v indica.indicacoes;
begin
  if new.status <> 'paga' or new.negotiation_id is null
     or (tg_op = 'UPDATE' and old.status = 'paga') then
    return new;
  end if;
  begin
    select * into v from indica.indicacoes
     where orcamento_id = new.negotiation_id and status = 'fechou';
    if found then
      -- `convertida` confere se ESTA é a 1ª parcela; se não for, recusa (e fica
      -- registrado como falha esperada, sem efeito no Financeiro).
      perform indica._mudar_status(v.id, 'convertida', 'Automático: 1ª parcela paga.', '{}'::jsonb, auth.uid());
    end if;
  exception when others then
    perform indica._registrar_falha('parcela', new.id, v.id, sqlerrm);
  end;
  return new;
end;
$$;

drop trigger if exists indica_automacao_parcela on public.payment_installments;
create trigger indica_automacao_parcela
  after insert or update of status on public.payment_installments
  for each row execute function indica.automacao_parcela();

-- -----------------------------------------------------------------------------
-- 6) Vencimento de Riso Coins (o que vence primeiro sai primeiro)
-- -----------------------------------------------------------------------------
-- Vencido = créditos já vencidos − tudo o que já saiu do disponível (resgates,
-- expirações e ajustes negativos consomem primeiro o que vence primeiro).
create or replace function indica._expirar_riso_coins(p_embaixador_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_antes text := coalesce(current_setting('indica.motor', true), '');
  v_vencido integer;
begin
  select greatest(0,
           coalesce(sum(riso_coins) filter (where riso_coins > 0 and expira_em <= now()), 0)
         + coalesce(sum(riso_coins) filter (where riso_coins < 0), 0))::integer
    into v_vencido
    from indica.pontos_lancamentos
   where embaixador_id = p_embaixador_id and saldo = 'disponivel';

  if v_vencido <= 0 then
    return 0;
  end if;

  perform set_config('indica.motor', 'sim', true);
  insert into indica.pontos_lancamentos
    (embaixador_id, tipo, saldo, riso_coins, regra_aplicada, motivo)
  values
    (p_embaixador_id, 'expiracao', 'disponivel', -v_vencido,
     jsonb_build_object('rotina', 'vencimento'), 'Riso Coins vencidos (validade do programa).');
  perform set_config('indica.motor', v_antes, true);
  return v_vencido;
end;
$$;

-- -----------------------------------------------------------------------------
-- 7) A ROTINA DIÁRIA
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
  v_falhas integer := 0;
  v_meses_lgpd integer;
  v_resultado jsonb;
begin
  -- Rotina não é pessoa: só a chave de serviço / o agendador chamam.
  if auth.uid() is not null then
    raise exception 'INDICA_SEM_PERMISSAO: a rotina diária roda sozinha.';
  end if;

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

  -- (5) LGPD: indicações encerradas (sem virar cliente) há mais que o
  -- parâmetro perdem nome, telefone, CPF e e-mail do indicado.
  v_meses_lgpd := (indica.config_numero('anonimizar_encerradas_apos_meses'))::integer;
  perform set_config('indica.motor', 'sim', true);
  update indica.indicacoes
     set indicado_nome = 'Anonimizado',
         indicado_telefone = null,
         indicado_cpf = null,
         indicado_email = null,
         anonimizada_em = now()
   where anonimizada_em is null
     and status in ('recusada', 'expirada', 'cancelada')
     and encerrada_em < now() - make_interval(months => v_meses_lgpd);
  get diagnostics v_anonimizadas = row_count;
  perform set_config('indica.motor', v_antes, true);

  v_resultado := jsonb_build_object(
    'expiradas', v_expiradas,
    'convertidas_por_prazo', v_convertidas,
    'riso_coins_vencidos', v_riso_vencidos,
    'niveis_recalculados', v_niveis,
    'anonimizadas', v_anonimizadas,
    'falhas', v_falhas
  );
  insert into indica.rotinas_execucoes (resultado) values (v_resultado);
  return v_resultado;
end;
$$;

-- Agendamento: 05:30 UTC = 02:30 de Brasília. Se o pg_cron não estiver
-- disponível, AVISA (não cala): rotina que não roda é defeito, não detalhe.
do $$
begin
  create extension if not exists pg_cron;
  begin
    perform cron.unschedule('indica-rotina-diaria');
  exception when others then
    null; -- ainda não existia
  end;
  perform cron.schedule('indica-rotina-diaria', '30 5 * * *', 'select indica.rotina_diaria()');
exception when others then
  raise warning 'INDICA: não foi possível agendar a rotina diária (pg_cron): %', sqlerrm;
end;
$$;

-- -----------------------------------------------------------------------------
-- 8) Permissões (AP15): tudo interno; a rotina só pela chave de serviço
-- -----------------------------------------------------------------------------
revoke execute on function indica._registrar_falha(text, uuid, uuid, text) from public, anon, authenticated;
revoke execute on function indica._indicacao_aberta_do_cliente(uuid) from public, anon, authenticated;
revoke execute on function indica.automacao_agenda() from public, anon, authenticated;
revoke execute on function indica.automacao_venda() from public, anon, authenticated;
revoke execute on function indica.automacao_parcela() from public, anon, authenticated;
revoke execute on function indica._expirar_riso_coins(uuid) from public, anon, authenticated;
revoke execute on function indica.rotina_diaria() from public, anon, authenticated;
grant execute on function indica.rotina_diaria() to service_role;

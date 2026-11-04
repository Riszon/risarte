-- =============================================================================
-- 2011 — Indica +Risos: o presente de boas-vindas e o prêmio individual (AP24)
--
-- Decisões do dono (04/11/2026), docs/indica-mais-risos/AP24-PLANO.md:
--   * I1: o Consultor APLICA o presente com um botão na negociação;
--   * I2: o presente é POR FORA da regra comercial (a conta mora na 0363);
--   * I3: a validade conta do COMPARECIMENTO à avaliação;
--   * I4: o prêmio individual por conversão é em RISO COINS (não em R$),
--     dividido entre quem pediu e quem fechou pelo
--     `premio_individual_percentual_origem`. Começa desligado (0).
--
-- O que muda:
--   1) a indicação guarda QUANDO e EM QUAL negociação o presente foi usado;
--   2) parâmetro novo `premio_individual_riso_coins` (rede, 0 = desligado);
--   3) `presente_do_cliente`: o presente do cliente, a validade e a situação;
--   4) `aplicar_presente`: a PORTA do botão (aplicar ou tirar);
--   5) gatilho no ACEITE da negociação: o presente fica USADO (uma vez só) —
--      blindado como os da 2005: nunca derruba o aceite;
--   6) `premios_equipe`: o extrato de Riso Coins da EQUIPE (só cresce, só pelo
--      motor), creditado quando a indicação vira CONVERTIDA (fim da carência —
--      as diretrizes: "só contam indicações convertidas");
--   7) `premios_equipe_do_periodo`: a leitura da tela Equipe.
--
-- Depende da 0363 (as colunas do presente em plan_negotiations).
-- Nada apaga. Idempotente.
-- =============================================================================

-- 1) A indicação guarda o uso do presente ------------------------------------
alter table indica.indicacoes
  add column if not exists presente_usado_em timestamptz,
  add column if not exists presente_negociacao_id uuid
    references public.plan_negotiations (id) on delete set null;

-- 2) O parâmetro do prêmio individual ------------------------------------------
insert into indica.config (escopo, unidade_id, grupo, chave, valor, min, travado, descricao, vigente_desde)
values ('rede', null, 'equipe', 'premio_individual_riso_coins', '0', 0, true,
        'Prêmio individual por conversão, em Riso Coins (0 = desligado). Dividido entre quem pediu e quem fechou.',
        '2026-01-01 00:00-03')
on conflict (unidade_id, chave, vigente_desde) do nothing;

-- 3) O presente do cliente ------------------------------------------------------
-- Interna (sem guarda). A regra é a vigente no REGISTRO da indicação (regra muda
-- só para o futuro). Situações:
--   disponivel | aguarda_avaliacao | vencido | usado | encerrado (venda fechou
--   sem o presente). Sem indicação aberta, ou com o presente desligado (0%),
--   não devolve nada. Espelho em TS: `situacaoDoPresente` (src/lib/indica/presente.ts).
create or replace function indica._presente_do_cliente(p_cliente_id uuid)
returns table (
  indicacao_id uuid,
  codigo text,
  unidade_id uuid,
  percentual numeric,
  valido_ate timestamptz,
  situacao text,
  negociacao_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v indica.indicacoes;
  v_pct numeric;
  v_dias numeric;
  v_ate timestamptz;
begin
  select * into v from indica.indicacoes i
   where i.cliente_indicado_id = p_cliente_id
     and i.status not in ('recusada', 'cancelada', 'expirada')
   order by i.registrada_em desc
   limit 1;
  if not found then return; end if;

  v_pct := coalesce(indica.config_numero('beneficio_indicado_percentual', v.unidade_id, v.registrada_em), 0);
  if v_pct <= 0 then return; end if;
  v_dias := coalesce(indica.config_numero('beneficio_validade_dias', v.unidade_id, v.registrada_em), 0);
  v_ate := case when v.compareceu_em is not null
                then v.compareceu_em + make_interval(days => v_dias::integer) end;

  return query select
    v.id, v.codigo, v.unidade_id, v_pct, v_ate,
    case
      when v.presente_usado_em is not null then 'usado'
      when v.venda_id is not null then 'encerrado'
      when v.compareceu_em is null then 'aguarda_avaliacao'
      when now() > v_ate then 'vencido'
      else 'disponivel'
    end,
    v.presente_negociacao_id;
end;
$$;
revoke execute on function indica._presente_do_cliente(uuid) from public, anon, authenticated;

-- A leitura da tela: só a equipe da unidade da indicação enxerga.
create or replace function indica.presente_do_cliente(p_cliente_id uuid)
returns table (
  indicacao_id uuid,
  codigo text,
  unidade_id uuid,
  percentual numeric,
  valido_ate timestamptz,
  situacao text,
  negociacao_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return query
  select p.* from indica._presente_do_cliente(p_cliente_id) p
   where auth.uid() is null or indica.eh_risartano(p.unidade_id);
end;
$$;
revoke execute on function indica.presente_do_cliente(uuid) from public, anon, authenticated;
grant execute on function indica.presente_do_cliente(uuid) to authenticated;

-- 4) A porta do botão "Aplicar" -------------------------------------------------
-- Aplica (ou tira) o presente na negociação e recalcula o total pela regra
-- comercial. Devolve as violações da regra (como salvar a negociação).
create or replace function indica.aplicar_presente(p_negociacao_id uuid, p_aplicar boolean)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_neg public.plan_negotiations;
  v_p record;
  v_pct numeric;
  v_violacoes text[];
begin
  select * into v_neg from public.plan_negotiations where id = p_negociacao_id for update;
  if not found then
    raise exception 'INDICA_DADOS: negociação não encontrada.';
  end if;
  if v_uid is null or not (
    public.is_admin_master()
    or public.has_role_in_clinic(v_neg.clinic_id, array['unit_manager']::public.user_role[])
    or exists (select 1 from public.providers_with_access(v_neg.clinic_id, 'commercial_consultant') p
               where p.user_id = v_uid)
  ) then
    raise exception 'INDICA_SEM_PERMISSAO: só o Consultor Comercial (ou o Gerente) aplica o presente.';
  end if;
  if v_neg.status not in ('em_negociacao', 'aguardando_autorizacao', 'devolvida') then
    raise exception 'INDICA_PRESENTE_NEGOCIACAO_FECHADA: a negociação já foi aceita ou encerrada.';
  end if;

  if p_aplicar then
    select * into v_p from indica._presente_do_cliente(v_neg.client_id);
    if not found then
      raise exception 'INDICA_PRESENTE_SEM_INDICACAO: este cliente não chegou por indicação do Indica +Risos.';
    end if;
    if v_p.situacao = 'usado' and v_p.negociacao_id is distinct from p_negociacao_id then
      raise exception 'INDICA_PRESENTE_USADO: o presente de boas-vindas já foi usado.';
    elsif v_p.situacao = 'encerrado' then
      raise exception 'INDICA_PRESENTE_SO_NO_PRIMEIRO: o presente vale só no primeiro tratamento fechado.';
    elsif v_p.situacao = 'aguarda_avaliacao' then
      raise exception 'INDICA_PRESENTE_SEM_AVALIACAO: o presente vale depois do comparecimento à avaliação.';
    elsif v_p.situacao = 'vencido' then
      raise exception 'INDICA_PRESENTE_VENCIDO: o presente venceu em %.',
        to_char(v_p.valido_ate at time zone 'America/Sao_Paulo', 'DD/MM/YYYY');
    end if;
    -- Só no PRIMEIRO tratamento: nem complemento, nem cliente que já comprou.
    if exists (select 1 from public.treatment_plans tp
                where tp.id = v_neg.plan_id and tp.complement_of_plan_id is not null)
       or exists (select 1 from public.plan_negotiations n
                   where n.client_id = v_neg.client_id and n.id <> v_neg.id
                     and n.status in ('aceita', 'cancelada')) then
      raise exception 'INDICA_PRESENTE_SO_NO_PRIMEIRO: o presente vale só no primeiro tratamento fechado.';
    end if;
    v_pct := v_p.percentual;

    perform set_config('risarte.presente_indica', 'sim', true);
    update public.plan_negotiations
       set indica_presente_percent = v_p.percentual,
           indica_indicacao_id = v_p.indicacao_id
     where id = p_negociacao_id;
    perform set_config('risarte.presente_indica', '', true);
  else
    perform set_config('risarte.presente_indica', 'sim', true);
    update public.plan_negotiations
       set indica_presente_percent = null,
           indica_indicacao_id = null
     where id = p_negociacao_id;
    perform set_config('risarte.presente_indica', '', true);
  end if;

  v_violacoes := public.evaluate_negotiation_rules(p_negociacao_id, true);

  insert into public.audit_logs (user_id, clinic_id, action, entity_type, entity_id, details)
  values (v_uid, v_neg.clinic_id, 'update', 'indica_presente', p_negociacao_id::text,
          jsonb_build_object('aplicado', p_aplicar, 'percentual', v_pct));
  return coalesce(v_violacoes, '{}');
end;
$$;
revoke execute on function indica.aplicar_presente(uuid, boolean) from public, anon, authenticated;
grant execute on function indica.aplicar_presente(uuid, boolean) to authenticated;

-- 5) No aceite, o presente fica USADO (uma vez só) ------------------------------
-- Blindado: qualquer erro vai para falhas_automacao e o aceite segue.
create or replace function indica.automacao_presente_no_aceite()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_antes text := coalesce(current_setting('indica.motor', true), '');
  v_dono uuid;
begin
  if new.status = 'aceita' and old.status is distinct from 'aceita'
     and new.indica_indicacao_id is not null then
    begin
      perform set_config('indica.motor', 'sim', true);
      update indica.indicacoes
         set presente_usado_em = coalesce(presente_usado_em, now()),
             presente_negociacao_id = coalesce(presente_negociacao_id, new.id)
       where id = new.indica_indicacao_id
      returning presente_negociacao_id into v_dono;
      perform set_config('indica.motor', v_antes, true);
      if v_dono is distinct from new.id then
        perform indica._registrar_falha('presente', new.id, new.indica_indicacao_id,
          'O presente de boas-vindas já tinha sido usado em outra negociação.');
      end if;
    exception when others then
      perform set_config('indica.motor', v_antes, true);
      perform indica._registrar_falha('presente', new.id, new.indica_indicacao_id, sqlerrm);
    end;
  end if;
  return new;
end;
$$;
revoke execute on function indica.automacao_presente_no_aceite() from public, anon, authenticated;

drop trigger if exists indica_automacao_presente on public.plan_negotiations;
create trigger indica_automacao_presente
  after update of status on public.plan_negotiations
  for each row execute function indica.automacao_presente_no_aceite();

-- 6) O extrato de Riso Coins da EQUIPE -------------------------------------------
create table if not exists indica.premios_equipe (
  id bigint generated always as identity primary key,
  usuario_id uuid not null references public.profiles (id),
  unidade_id uuid not null references public.clinics (id),
  indicacao_id uuid references indica.indicacoes (id),
  papel text not null check (papel in ('origem', 'fechamento', 'origem_e_fechamento', 'ajuste')),
  riso_coins integer not null check (riso_coins <> 0),
  regra_aplicada jsonb not null,
  motivo text,
  criado_por uuid references public.profiles (id),
  criado_em timestamptz not null default now(),
  constraint premios_equipe_um_por_papel unique (indicacao_id, papel),
  constraint premios_equipe_ajuste_motivado check (papel <> 'ajuste' or nullif(btrim(motivo), '') is not null)
);
create index if not exists premios_equipe_usuario_idx on indica.premios_equipe (usuario_id, unidade_id);
create index if not exists premios_equipe_unidade_idx on indica.premios_equipe (unidade_id, criado_em);

drop trigger if exists premios_equipe_trava on indica.premios_equipe;
create trigger premios_equipe_trava
  before insert or update or delete on indica.premios_equipe
  for each row execute function indica.so_cresce_pelo_motor();

alter table indica.premios_equipe enable row level security;
drop policy if exists premios_equipe_ler on indica.premios_equipe;
create policy premios_equipe_ler on indica.premios_equipe for select to authenticated
  using (usuario_id = (select auth.uid()) or indica.eh_gestor(unidade_id));
grant select on indica.premios_equipe to authenticated;
grant all on indica.premios_equipe to service_role;

-- O crédito: quem pediu e quem fechou, pela divisão da rede. A mesma pessoa
-- nos dois papéis leva o valor inteiro; papel sem ninguém não é pago.
-- Espelho em TS: `divisaoDoPremio` (src/lib/indica/presente.ts).
create or replace function indica._premiar_equipe(p_indicacao_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v indica.indicacoes;
  v_total integer;
  v_pct numeric;
  v_origem integer;
  v_fech integer;
  v_regra jsonb;
  v_antes text := coalesce(current_setting('indica.motor', true), '');
  v_n integer := 0;
  v_k integer;
begin
  select * into v from indica.indicacoes where id = p_indicacao_id;
  if not found or v.status <> 'convertida' then return 0; end if;
  v_total := floor(coalesce(indica.config_numero('premio_individual_riso_coins', v.unidade_id, now()), 0))::integer;
  if v_total <= 0 then return 0; end if;
  v_pct := coalesce(indica.config_numero('premio_individual_percentual_origem', v.unidade_id, now()), 50);
  v_regra := jsonb_build_object('riso_coins_por_conversao', v_total,
                                'percentual_origem', v_pct, 'calculada_em', now());

  perform set_config('indica.motor', 'sim', true);
  if v.risartano_origem_id is not null and v.risartano_origem_id = v.risartano_conversao_id then
    insert into indica.premios_equipe (usuario_id, unidade_id, indicacao_id, papel, riso_coins, regra_aplicada)
    values (v.risartano_origem_id, v.unidade_id, v.id, 'origem_e_fechamento', v_total, v_regra)
    on conflict (indicacao_id, papel) do nothing;
    get diagnostics v_n = row_count;
  else
    v_origem := round(v_total * v_pct / 100)::integer;
    v_fech := v_total - v_origem;
    if v.risartano_origem_id is not null and v_origem > 0 then
      insert into indica.premios_equipe (usuario_id, unidade_id, indicacao_id, papel, riso_coins, regra_aplicada)
      values (v.risartano_origem_id, v.unidade_id, v.id, 'origem', v_origem, v_regra)
      on conflict (indicacao_id, papel) do nothing;
      get diagnostics v_k = row_count;
      v_n := v_n + v_k;
    end if;
    if v.risartano_conversao_id is not null and v_fech > 0 then
      insert into indica.premios_equipe (usuario_id, unidade_id, indicacao_id, papel, riso_coins, regra_aplicada)
      values (v.risartano_conversao_id, v.unidade_id, v.id, 'fechamento', v_fech, v_regra)
      on conflict (indicacao_id, papel) do nothing;
      get diagnostics v_k = row_count;
      v_n := v_n + v_k;
    end if;
  end if;
  perform set_config('indica.motor', v_antes, true);
  return v_n;
end;
$$;
revoke execute on function indica._premiar_equipe(uuid) from public, anon, authenticated;

create or replace function indica.automacao_premio_equipe()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'convertida' and old.status is distinct from 'convertida' then
    begin
      perform indica._premiar_equipe(new.id);
    exception when others then
      perform indica._registrar_falha('premio_equipe', new.id, new.id, sqlerrm);
    end;
  end if;
  return new;
end;
$$;
revoke execute on function indica.automacao_premio_equipe() from public, anon, authenticated;

drop trigger if exists indicacoes_premio_equipe on indica.indicacoes;
create trigger indicacoes_premio_equipe
  after update of status on indica.indicacoes
  for each row execute function indica.automacao_premio_equipe();

-- 7) A leitura da tela Equipe ------------------------------------------------------
create or replace function indica.premios_equipe_do_periodo(p_unidade_id uuid, p_de date, p_ate date)
returns table (
  usuario_id uuid,
  nome text,
  conversoes integer,
  riso_coins_periodo integer,
  riso_coins_acumulado integer
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
    raise exception 'INDICA_SEM_PERMISSAO: o prêmio individual é da equipe da unidade.';
  end if;
  return query
  select p.usuario_id,
         pr.full_name,
         (count(distinct p.indicacao_id) filter (where p.criado_em >= v_de and p.criado_em < v_ate))::integer,
         coalesce(sum(p.riso_coins) filter (where p.criado_em >= v_de and p.criado_em < v_ate), 0)::integer,
         coalesce(sum(p.riso_coins), 0)::integer
    from indica.premios_equipe p
    join public.profiles pr on pr.id = p.usuario_id
   where p.unidade_id = p_unidade_id
   group by p.usuario_id, pr.full_name
  having coalesce(sum(p.riso_coins) filter (where p.criado_em >= v_de and p.criado_em < v_ate), 0) <> 0
   order by 4 desc, 2;
end;
$$;
revoke execute on function indica.premios_equipe_do_periodo(uuid, date, date) from public, anon, authenticated;
grant execute on function indica.premios_equipe_do_periodo(uuid, date, date) to authenticated;

select public.audit_attach_all();

-- Conferência (só leitura) ------------------------------------------------------
select
  (select count(*) from information_schema.columns
    where table_schema = 'indica' and table_name = 'indicacoes'
      and column_name in ('presente_usado_em', 'presente_negociacao_id')) as colunas_2,
  (select valor #>> '{}' from indica.config
    where chave = 'premio_individual_riso_coins' and unidade_id is null
    order by vigente_desde desc limit 1) as premio_esperado_0,
  exists (select 1 from pg_trigger where tgname = 'indica_automacao_presente') as gatilho_do_aceite,
  exists (select 1 from pg_trigger where tgname = 'indicacoes_premio_equipe') as gatilho_do_premio,
  has_function_privilege('anon', 'indica.aplicar_presente(uuid, boolean)', 'execute') as sem_login_esperado_false;

-- =============================================================================
-- 0245 — Nenhum código de documento estoura por causa dos dígitos
-- -----------------------------------------------------------------------------
-- A 0191 já tinha achado e corrigido isto nos códigos de venda (PT-, VD-, RN-),
-- e deixou a lição escrita: **o `lpad` do Postgres TRUNCA** quando o número é
-- maior que a largura pedida — `lpad('100000', 5, '0')` devolve `'10000'`.
--
-- E todos esses códigos têm índice ÚNICO. Então o efeito não é "o código fica
-- feio" nem "para de contar": o número repetido bate no índice e **a operação
-- falha** — não dá para cadastrar o item, criar o pedido, admitir o Risartano.
-- O sistema para de funcionar naquele ponto, sem aviso prévio.
--
-- A correção de 0191 valeu só para as vendas. Oito geradores continuaram com
-- largura fixa; esta migração aplica a MESMA regra em todos: o preenchimento é
-- o MAIOR entre a largura desejada e o tamanho real do número. Nunca corta.
-- PD-0001 … PD-9999 … PD-10000 … e segue.
--
-- LARGURA NOVA ONDE A ANTIGA ERA CURTA DEMAIS (decisão do dono, 26/08/2026).
--
-- Crescer sem quebrar resolve o defeito, mas não é suficiente: um código que
-- muda de largura no primeiro ano (PD-9999 → PD-10000) fica desalinhado em
-- listagem, planilha e documento que a unidade e o FORNECEDOR leem. A largura
-- inicial tem de dar prazo longo, não prazo apertado.
--
-- Contas do pior caso realista, com as 200 unidades da meta de 5 anos:
--   PD- pedido de compra .... era 4 (9.999). Um pedido por unidade, por
--       fornecedor, por rodada: ~12.000/ano com rodada mensal, ~52.000/ano se
--       a rodada virar semanal. Em 4 dígitos estouraria em UM ANO.
--       AGORA 7 dígitos (9.999.999) → 830 anos, ou 190 no ritmo semanal.
--   RC- rodada de cotação ... era 4 (9.999); ~200 rodadas/ano na rede.
--       AGORA 6 dígitos (999.999) → milhares de anos.
--   RIS- Risartano .......... era 4 (9.999). ~3.000 pessoas com rotatividade
--       daria só uma década — pelo mesmo critério, subiu.
--       AGORA 6 dígitos (999.999).
--   PC- requisição .......... 6 dígitos, mantido → séculos.
--   INS-, AT-, PRC- ......... 5 dígitos, mantidos: são CATÁLOGO (itens, bens,
--       procedimentos), contados às centenas, não ao mês.
--   Cliente ................. 5 dígitos POR UNIDADE; a 60 avaliações/mês são
--       138 anos numa unidade. Mantido.
--
-- Os códigos já emitidos continuam válidos e legíveis: a busca e o próximo
-- número comparam o NÚMERO, não o texto, então PD-0001 e PD-0000002 convivem.
-- Na prática nem convivem — as tabelas de compras são zeradas na limpeza dos
-- dados de teste. Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Catálogo de procedimentos — PRC-
-- -----------------------------------------------------------------------------
create or replace function public.next_procedure_code()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v bigint := nextval('public.procedure_code_seq');
begin
  return 'PRC-' || lpad(v::text, greatest(5, length(v::text)), '0');
end;
$$;

-- -----------------------------------------------------------------------------
-- 2) Risartano (RH) — RIS-
-- -----------------------------------------------------------------------------
create or replace function public.set_staff_member_code()
returns trigger language plpgsql as $$
declare
  v bigint;
begin
  if new.code is null or btrim(new.code) = '' then
    v := nextval('public.staff_member_code_seq');
    new.code := 'RIS-' || lpad(v::text, greatest(6, length(v::text)), '0');
  end if;
  return new;
end $$;

-- -----------------------------------------------------------------------------
-- 3) Item de estoque — INS-
-- -----------------------------------------------------------------------------
create or replace function public.next_stock_item_code()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select 'INS-' || lpad(v::text, greatest(5, length(v::text)), '0')
  from (
    select coalesce(
             max(nullif(regexp_replace(code, '\D', '', 'g'), '')::bigint), 0
           ) + 1 as v
    from public.stock_items
    where code like 'INS-%'
  ) s;
$$;

-- -----------------------------------------------------------------------------
-- 4) Bem do patrimônio — AT-
-- -----------------------------------------------------------------------------
create or replace function public.next_asset_code()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select 'AT-' || lpad(v::text, greatest(5, length(v::text)), '0')
  from (
    select coalesce(
             max(nullif(regexp_replace(code, '\D', '', 'g'), '')::bigint), 0
           ) + 1 as v
    from public.fixed_assets
    where code like 'AT-%'
  ) s;
$$;

-- -----------------------------------------------------------------------------
-- 5) Requisição de compra — PC-
-- -----------------------------------------------------------------------------
create or replace function public.set_purchase_request_code()
returns trigger language plpgsql as $$
declare
  v bigint;
begin
  if new.code is null then
    v := nextval('public.purchase_request_code_seq');
    new.code := 'PC-' || lpad(v::text, greatest(6, length(v::text)), '0');
  end if;
  return new;
end $$;

-- -----------------------------------------------------------------------------
-- 6) Rodada de cotação — RC-
-- -----------------------------------------------------------------------------
create or replace function public.set_purchase_round_code()
returns trigger language plpgsql as $$
declare
  v bigint;
begin
  if new.code is null then
    v := coalesce(
      (select max(substring(code from 4)::bigint)
         from public.purchase_rounds
        where code ~ '^RC-[0-9]+$'), 0
    ) + 1;
    new.code := 'RC-' || lpad(v::text, greatest(6, length(v::text)), '0');
  end if;
  return new;
end $$;

-- -----------------------------------------------------------------------------
-- 7) Pedido de compra — PD-  (o que estoura primeiro)
-- -----------------------------------------------------------------------------
create or replace function public.set_purchase_order_code()
returns trigger language plpgsql as $$
declare
  v bigint;
begin
  if new.code is null then
    v := coalesce(
      (select max(substring(code from 4)::bigint)
         from public.purchase_orders
        where code ~ '^PD-[0-9]+$'), 0
    ) + 1;
    new.code := 'PD-' || lpad(v::text, greatest(7, length(v::text)), '0');
  end if;
  return new;
end $$;

-- -----------------------------------------------------------------------------
-- 8) Código do cliente — CAM-00001 e companhia
-- -----------------------------------------------------------------------------
-- Duas funções: a que usa o código da CLÍNICA e a que usa um prefixo de
-- PROGRAMA (PPR-, PRE-). As duas dividem o contador da unidade.
create or replace function public.next_client_code(p_clinic_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seq integer;
  v_clinic_code text;
begin
  select code into v_clinic_code from public.clinics where id = p_clinic_id;

  insert into public.clinic_client_counters (clinic_id, last_value)
  values (p_clinic_id, 1)
  on conflict (clinic_id)
  do update set last_value = public.clinic_client_counters.last_value + 1
  returning last_value into v_seq;

  return coalesce(v_clinic_code, 'RIS')
    || '-' || lpad(v_seq::text, greatest(5, length(v_seq::text)), '0');
end;
$$;

-- -----------------------------------------------------------------------------
-- 9) PPR- e PRE- passam a ter contador DA REDE (decisão do dono, 26/08/2026)
-- -----------------------------------------------------------------------------
-- O DEFEITO: o prefixo era do PROGRAMA (PPR, PRE) mas o contador era DA UNIDADE
-- — e `clients_code_unique` vale para a rede inteira. Duas unidades no mesmo
-- número de contador criando um cliente pelo PPR+ geravam o MESMO `PPR-00500`,
-- e o segundo cadastro falhava na cara do atendente.
--
-- Passava despercebido só porque as unidades estavam em contadores diferentes.
-- A limpeza dos dados de teste zera todos os contadores juntos, o que tornaria
-- o encontro provável já no primeiro cliente de cada unidade.
--
-- A correção mantém o que o código precisa dizer — por onde a pessoa entrou —
-- e garante que ele nunca se repete. O que ele deixa de dizer é a unidade, que
-- a ficha já guarda em campo próprio.
create sequence if not exists public.client_prefixed_code_seq;

-- Começa ACIMA do maior código de programa já emitido. Sem isto, rodar esta
-- migração antes da limpeza faria o contador novo colidir com os códigos que já
-- existem — trocar um defeito por outro.
select setval(
  'public.client_prefixed_code_seq',
  coalesce(
    (select max(nullif(regexp_replace(code, '\D', '', 'g'), '')::bigint)
       from public.clients
      where code ~ '^(PPR|PRE)-[0-9]+$'),
    0
  ) + 1,
  false
);

create or replace function public.next_client_code_prefixed(
  p_clinic_id uuid,
  p_prefix text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seq bigint;
begin
  -- O contador da UNIDADE não é tocado: este cliente não está levando um número
  -- dela. Consumir o número da unidade deixaria buracos na contagem dela sem
  -- que nenhum código explicasse o buraco.
  v_seq := nextval('public.client_prefixed_code_seq');

  return coalesce(nullif(btrim(p_prefix), ''), 'RIS')
    || '-' || lpad(v_seq::text, greatest(5, length(v_seq::text)), '0');
end;
$$;

grant execute on function public.next_client_code(uuid) to authenticated;
grant execute on function public.next_client_code_prefixed(uuid, text) to authenticated;

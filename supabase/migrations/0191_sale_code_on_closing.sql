-- =============================================================================
-- 0191 — FIN2.2: o código nasce no FECHAMENTO (e não estoura em 99.999)
-- -----------------------------------------------------------------------------
-- Três coisas, todas vindas de perguntas do dono (04/08/2026):
--
-- 1) BUG DE CAPACIDADE — e ele é sério. A 0190 gerava o código com
--    `lpad(n::text, 5, '0')`. O `lpad` do Postgres **TRUNCA** quando o texto é
--    maior que o tamanho pedido: `lpad('100000', 5, '0')` devolve `'10000'`.
--    Ou seja, na venda de número 100.000 o código sairia repetido, bateria no
--    índice único e o FECHAMENTO DA VENDA FALHARIA. Não era "parar de contar":
--    era quebrar. Com 200 unidades isso chega.
--    Correção: o preenchimento passa a ser o MAIOR entre 5 dígitos e o tamanho
--    real do número — nunca corta. PT-00001 … PT-99999 … PT-100000 … e segue.
--    A sequência é BIGINT (9,2 quintilhões): na prática, não acaba.
--
-- 2) O código passa a ser gerado no FECHAMENTO, não na criação — negociação
--    perdida não queima código. Plano de tratamento fecha em `aceita`; venda
--    direta fecha em `concluida` (assinado + pago, a regra de ouro).
--
-- 3) Códigos que a 0190 deu para vendas que NUNCA fecharam são devolvidos
--    (viram nulo), para o código significar sempre "venda fechada".
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Gerador que não trunca
-- -----------------------------------------------------------------------------
create or replace function public.next_sale_code(p_prefix text)
returns text
language sql
security definer
set search_path = ''
as $$
  select p_prefix || '-' || (
    select lpad(v::text, greatest(5, length(v::text)), '0')
    from (select nextval('public.sale_code_seq') as v) s
  );
$$;

grant execute on function public.next_sale_code(text) to authenticated;

create or replace function public.assign_sale_code()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.code is null then
    new.code := public.next_sale_code(tg_argv[0]);
  end if;
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- 2) O código nasce no fechamento
-- -----------------------------------------------------------------------------
-- Negociação perdida ou abandonada não consome número.
create or replace function public.assign_sale_code_on_close()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.code is null and new.status = tg_argv[1] then
    new.code := public.next_sale_code(tg_argv[0]);
  end if;
  return new;
end;
$$;

drop trigger if exists plan_negotiations_assign_code on public.plan_negotiations;
create trigger plan_negotiations_assign_code
  before insert or update of status on public.plan_negotiations
  for each row execute function public.assign_sale_code_on_close('PT', 'aceita');

drop trigger if exists direct_sales_assign_code on public.direct_sales;
create trigger direct_sales_assign_code
  before insert or update of status on public.direct_sales
  for each row execute function public.assign_sale_code_on_close('VD', 'concluida');

-- A renegociação só existe quando é feita: o código sai no nascimento.
drop trigger if exists payment_renegotiations_assign_code
  on public.payment_renegotiations;
create trigger payment_renegotiations_assign_code
  before insert on public.payment_renegotiations
  for each row execute function public.assign_sale_code('RN');

-- -----------------------------------------------------------------------------
-- 3) Devolve os códigos dados a vendas que nunca fecharam
-- -----------------------------------------------------------------------------
-- Guarda: quem já gerou cobrança mantém o código, para não sumir da ficha.
update public.plan_negotiations n
   set code = null
 where n.code is not null
   and n.status <> 'aceita'
   and not exists (
     select 1 from public.payment_installments i where i.negotiation_id = n.id);

update public.direct_sales s
   set code = null
 where s.code is not null
   and s.status <> 'concluida'
   and not exists (
     select 1 from public.payment_installments i where i.direct_sale_id = s.id);

-- Quem já está fechado e ficou sem código (fechou antes da 0190) recebe um.
update public.plan_negotiations
   set code = public.next_sale_code('PT')
 where code is null and status = 'aceita';

update public.direct_sales
   set code = public.next_sale_code('VD')
 where code is null and status = 'concluida';

select
  (select count(*) from public.plan_negotiations where code is not null)
    as planos_com_codigo,
  (select count(*) from public.direct_sales where code is not null)
    as vendas_diretas_com_codigo,
  (select count(*) from public.payment_renegotiations where code is not null)
    as renegociacoes_com_codigo;

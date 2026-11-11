-- =============================================================================
-- 0394 — VENDA DIRETA: O PREÇO É O DO CATÁLOGO, CONFERIDO PELO BANCO (AP139)
--
-- O QUE ESTAVA ERRADO (lido no código e no catálogo do treino, 10–11/11/2026):
--   1) `create_direct_sale_v2` gravava `unit_price_cents`,
--      `program_discount_cents` e `final_cents` exatamente como vinham da tela.
--      Pela tela o preço sai certo (a ação lê o catálogo da unidade), mas um
--      funcionário que chamasse a API direto gravava o preço que quisesse;
--   2) pior: as tabelas `direct_sales` e `direct_sale_items` tinham regra de
--      ESCRITA DIRETA para recepção, SDR, coordenador e gerente
--      (`direct_sales_write`, `direct_sale_items_write`). Bastava um UPDATE
--      pela API para mudar o valor de uma venda já lançada — sem passar por
--      função nenhuma, e com o pagamento e a receita usando esse valor.
--
-- MEDIDO ANTES DE TIRAR AS REGRAS: o app NÃO grava nessas tabelas (só lê); e
-- todas as funções do banco que gravam nelas rodam como dono
-- (`create_direct_sale_v2`, `_direct_sale_set_conditions_raw`,
-- `direct_sale_close_step`, `cancel_direct_sale`, `save_payment_schedule`, o
-- gatilho `direct_sale_autoclose_zero`) — a regra de linha não as alcança.
--
-- O QUE MUDA:
--   1) saem as duas regras de escrita direta (a LEITURA continua igual);
--   2) `create_direct_sale_v2` virou PORTA sobre `_create_direct_sale_v2_raw`.
--      Antes de gravar, ela confere item a item e REMONTA a lista:
--        • procedimento obrigatório, ativo e liberado para venda direta para
--          a função de quem lança (a mesma régua de
--          `canLaunchDirectSaleProcedure`) → PROCEDURE_NOT_ALLOWED;
--        • preço = `catalog_price_for` (o da unidade, senão o da rede); valor
--          diferente vindo da tela → PRICE_MISMATCH;
--        • nome do procedimento = o do catálogo;
--        • benefício do programa (Empresarial / PPR+) só para cliente que está
--          num programa, e nunca maior que a linha → PROGRAM_DISCOUNT_NOT_ALLOWED;
--        • valor final da linha = linha − benefício (não vem mais da tela).
--      A conta da venda (sessões, avisos, auditoria) continua na crua.
--
-- ⚠️ LIMITE DECLARADO: QUANTO de benefício cada procedimento tem (tipo,
-- percentual, carência, frequência de uso) é calculado pelo app
-- (`loadClientPrograms`); o banco ainda não sabe fazer essa conta. Ele garante
-- que só cliente de programa recebe benefício e que o benefício não passa do
-- valor da linha. Registrado no backlog.
--
-- Nada é apagado (só as duas regras de escrita). Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Sem escrita direta nas tabelas da venda direta
-- -----------------------------------------------------------------------------
drop policy if exists direct_sales_write on public.direct_sales;
drop policy if exists direct_sale_items_write on public.direct_sale_items;

-- -----------------------------------------------------------------------------
-- 2) A porta da criação
-- -----------------------------------------------------------------------------
do $$
begin
  if to_regprocedure('public._create_direct_sale_v2_raw(uuid, uuid, boolean, jsonb, text)') is null then
    alter function public.create_direct_sale_v2(uuid, uuid, boolean, jsonb, text)
      rename to _create_direct_sale_v2_raw;
  end if;
end $$;
revoke execute on function public._create_direct_sale_v2_raw(uuid, uuid, boolean, jsonb, text) from public, anon, authenticated;

create or replace function public.create_direct_sale_v2(
  p_client_id uuid,
  p_appointment_id uuid,
  p_attendance_done_before boolean,
  p_items jsonb,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic uuid;
  v_programa boolean;
  v_item jsonb;
  v_proc record;
  v_qtd integer;
  v_preco integer;
  v_veio integer;
  v_beneficio integer;
  v_linha integer;
  v_itens jsonb := '[]'::jsonb;
  v_admin boolean := public.is_admin_master();
  v_gerente boolean;
  v_recepcao boolean;
  v_sdr boolean;
begin
  select c.clinic_id,
         (c.empresarial_company_id is not null and c.empresarial_active is not false)
         or exists (
           select 1
             from public.ppr_beneficiaries b
             join public.ppr_memberships m on m.id = b.membership_id
            where b.client_id = c.id and b.left_at is null and m.status <> 'cancelado'
         )
    into v_clinic, v_programa
    from public.clients c
   where c.id = p_client_id;

  -- Cliente que não existe, sem permissão, sem itens: a crua responde como
  -- sempre (CLIENT_NOT_FOUND / NOT_ALLOWED / ITEMS_REQUIRED).
  if v_clinic is null or p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 then
    return public._create_direct_sale_v2_raw(
      p_client_id, p_appointment_id, p_attendance_done_before, p_items, p_notes);
  end if;

  v_gerente := public.has_role_in_clinic(v_clinic,
    array['unit_manager', 'clinical_coordinator']::public.user_role[]);
  v_recepcao := public.has_role_in_clinic(v_clinic, array['receptionist']::public.user_role[]);
  v_sdr := public.has_role_in_clinic(v_clinic, array['sdr']::public.user_role[]);
  if not (v_admin or v_gerente or v_recepcao or v_sdr) then
    raise exception 'NOT_ALLOWED';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    select p.id, p.name, p.is_active,
           coalesce(p.direct_sale, false) as livre,
           coalesce(p.direct_sale_reception, false) as recepcao,
           coalesce(p.direct_sale_sdr, false) as sdr
      into v_proc
      from public.procedures p
     where p.id = nullif(v_item->>'procedure_id', '')::uuid;

    -- A régua de `canLaunchDirectSaleProcedure` (src/lib/direct-sale.ts).
    if v_proc.id is null or not v_proc.is_active or not v_proc.livre or not (
         v_admin or v_gerente
         or (v_recepcao and v_proc.recepcao)
         or (v_sdr and v_proc.sdr)
       ) then
      raise exception 'PROCEDURE_NOT_ALLOWED';
    end if;

    v_qtd := coalesce((v_item->>'quantity')::integer, 1);
    if v_qtd < 1 then raise exception 'INVALID_QUANTITY'; end if;

    v_preco := coalesce(public.catalog_price_for(v_clinic, v_proc.id), 0);
    v_veio := coalesce((v_item->>'unit_price_cents')::integer, -1);
    if v_veio <> v_preco then
      raise exception 'PRICE_MISMATCH';
    end if;

    v_linha := v_preco * v_qtd;
    v_beneficio := coalesce((v_item->>'program_discount_cents')::integer, 0);
    if v_beneficio < 0 or v_beneficio > v_linha or (v_beneficio > 0 and not v_programa) then
      raise exception 'PROGRAM_DISCOUNT_NOT_ALLOWED';
    end if;

    v_itens := v_itens || jsonb_build_object(
      'procedure_id', v_proc.id,
      'description', v_proc.name,
      'quantity', v_qtd,
      'unit_price_cents', v_preco,
      'program_discount_cents', v_beneficio,
      'final_cents', v_linha - v_beneficio
    );
  end loop;

  return public._create_direct_sale_v2_raw(
    p_client_id, p_appointment_id, p_attendance_done_before, v_itens, p_notes);
end;
$$;
revoke execute on function public.create_direct_sale_v2(uuid, uuid, boolean, jsonb, text) from public, anon, authenticated;
grant execute on function public.create_direct_sale_v2(uuid, uuid, boolean, jsonb, text) to authenticated;

comment on function public.create_direct_sale_v2(uuid, uuid, boolean, jsonb, text) is
  'AP139 (0394): porta da venda direta. Remonta os itens com o preço do catálogo (catalog_price_for), o nome do catálogo e o valor final; recusa PROCEDURE_NOT_ALLOWED, PRICE_MISMATCH e PROGRAM_DISCOUNT_NOT_ALLOWED. A conta da venda mora em _create_direct_sale_v2_raw.';

-- CONFERÊNCIA (só leitura). Esperado: regras_de_escrita = 0, porta = true,
-- crua_fechada = true, leitura_continua = 2.
select
  (select count(*) from pg_policies
    where tablename in ('direct_sales', 'direct_sale_items') and cmd <> 'SELECT') as regras_de_escrita,
  position('_create_direct_sale_v2_raw' in
    pg_get_functiondef('public.create_direct_sale_v2(uuid, uuid, boolean, jsonb, text)'::regprocedure)) > 0 as porta,
  not has_function_privilege('authenticated',
    'public._create_direct_sale_v2_raw(uuid, uuid, boolean, jsonb, text)'::regprocedure, 'execute') as crua_fechada,
  (select count(*) from pg_policies
    where tablename in ('direct_sales', 'direct_sale_items') and cmd = 'SELECT') as leitura_continua;

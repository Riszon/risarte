-- =============================================================================
-- 0351 — A TSB FAZ O MESMO QUE A ASB NO MATERIAL (AP55)
--
-- Decisão do dono (03/11/2026), na AP55: "a TSB deve seguir com as mesmas da
-- ASB." A certificação passa a cobrar da TSB a lista da ASB — pedir material,
-- dar entrada, mandar para a sala, acertar o saldo, contar o inventário e
-- pedir indicação. Antes, a TSB recebia seis tarefas clínicas que o banco não
-- a deixava fazer.
--
-- Sem esta migração a troca repetiria o defeito: das oito tarefas da ASB, o
-- banco só aceitava três da TSB (consumo avulso e envio para uso, por
-- can_consume_stock desde a 0213; pedido de indicação, por ser Risartana). As
-- outras cinco passam pelas duas réguas que a 0296 abriu só para a ASB.
--
-- O QUE ABRE, E SÓ ISTO, na unidade onde a pessoa é TSB (o mesmo que a 0296
-- abriu para a ASB):
--   - montar, editar, enviar e cancelar a lista de compras (can_request_purchase);
--   - entradas e ajustes de estoque e a contagem do inventário (can_post_stock_entry).
-- O QUE NÃO ABRE: compra com nota e recebimento de pedido (criam CONTA A
-- PAGAR), kits e configuração dos itens — continuam com can_manage_stock.
--
-- A matriz de permissões ganha as linhas da TSB que faltarem. `on conflict do
-- nothing`: linha que o Admin já gravou fica como ele deixou.
--
-- Nada apaga. Idempotente: rodar de novo não muda nada.
-- =============================================================================

-- 1) As duas réguas da 0296, com a TSB ao lado da ASB ---------------------------
create or replace function public.can_request_purchase(p_clinic_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.can_manage_stock(p_clinic_id)
      or (p_clinic_id is not null and public.has_role_in_clinic(
            p_clinic_id, array['clinical_coordinator', 'asb', 'tsb']::public.user_role[]));
$$;

revoke execute on function public.can_request_purchase(uuid) from public, anon, authenticated;
grant execute on function public.can_request_purchase(uuid) to authenticated;

create or replace function public.can_post_stock_entry(p_clinic_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.can_manage_stock(p_clinic_id)
      or (p_clinic_id is not null and public.has_role_in_clinic(
            p_clinic_id, array['asb', 'tsb']::public.user_role[]));
$$;

revoke execute on function public.can_post_stock_entry(uuid) from public, anon, authenticated;
grant execute on function public.can_post_stock_entry(uuid) to authenticated;

-- 2) A matriz: as linhas da TSB que faltarem ------------------------------------
insert into public.permission_matrix (capability, role) values
  ('modulo.estoque', 'tsb'),
  ('acao.estoque.consumir', 'tsb'),
  ('acao.estoque.gerir', 'tsb'),
  ('acao.compras.requisitar', 'tsb')
on conflict (capability, role) do nothing;

-- 3) Conferência (só leitura) ---------------------------------------------------
select
  (select count(*) from public.permission_matrix
    where role = 'tsb'
      and capability in ('modulo.estoque', 'acao.estoque.consumir',
                         'acao.estoque.gerir', 'acao.compras.requisitar')
      and allowed) as tsb_ligada_na_matriz_esperado_4,
  (select count(*) from public.permission_matrix
    where role = 'tsb'
      and capability in ('modulo.estoque', 'acao.estoque.consumir',
                         'acao.estoque.gerir', 'acao.compras.requisitar')
      and not allowed) as tsb_desligada_pelo_admin,
  position('''tsb''' in pg_get_functiondef('public.can_request_purchase(uuid)'::regprocedure)) > 0
    as requisitar_tem_tsb,
  position('''tsb''' in pg_get_functiondef('public.can_post_stock_entry(uuid)'::regprocedure)) > 0
    as entrada_tem_tsb;

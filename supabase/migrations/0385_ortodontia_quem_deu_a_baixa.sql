-- =============================================================================
-- 0385 — ORTODONTIA: QUEM DEU A BAIXA NA MENSALIDADE (AP129)
--
-- `ortho_charges` grava `paid_by`/`paid_at` e `created_by` desde a 0329, mas
-- nenhuma tela mostrava. Era a segunda rodada do pedido do dono "quem lançou e
-- quem deu baixa" (0372, 09/11/2026).
--
-- POR QUE UMA FUNÇÃO: a regra de leitura de `profiles` só mostra colegas da
-- unidade. Quem dá a baixa pode ser o Financeiro da Franqueadora — sem a
-- função, o nome dele viria vazio e a tela diria "autor não registrado".
-- Mesmo desenho de `purchase_request_authors` (0323).
--
-- QUEM LÊ: só quem vê o dinheiro da Ortodontia naquela unidade
-- (`ortho_can_see_money`, a mesma régua da tabela). Só leitura. Idempotente.
-- =============================================================================

create or replace function public.ortho_charge_authors(p_ids uuid[])
returns table (
  charge_id uuid,
  paid_by_name text,
  created_by_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, pp.full_name::text, pc.full_name::text
  from public.ortho_charges c
  left join public.profiles pp on pp.id = c.paid_by
  left join public.profiles pc on pc.id = c.created_by
  where c.id = any(p_ids)
    and public.ortho_can_see_money(c.clinic_id);
$$;

revoke execute on function public.ortho_charge_authors(uuid[]) from public, anon, authenticated;
grant execute on function public.ortho_charge_authors(uuid[]) to authenticated;

comment on function public.ortho_charge_authors(uuid[]) is
  'AP129: nome de quem deu a baixa e de quem gerou cada mensalidade da Ortodontia, para quem vê o dinheiro da unidade (ortho_can_see_money).';

-- CONFERÊNCIA (só leitura). Esperado: 1 · false · true.
select
  count(*) as funcao,
  bool_or(has_function_privilege('anon', p.oid, 'execute')) as anon_executa,
  bool_or(has_function_privilege('authenticated', p.oid, 'execute')) as logado_executa
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'ortho_charge_authors';

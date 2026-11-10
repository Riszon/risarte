-- =============================================================================
-- 0388 — O DENTISTA VÊ OS PROCEDIMENTOS DO PLANO NO PRONTUÁRIO (OC-00172/00173)
--
-- Relato (10/11/2026, treino): a dentista abria "Sessões & Procedimentos" de um
-- cliente em atendimento e via "PROCEDIMENTOS 0/0 — Nenhum procedimento com
-- esse filtro", com "Tempo de cadeira 4h30" na mesma tela.
--
-- Causa: a aba monta a lista a partir de `treatment_plans` → opções → itens,
-- e a regra de leitura dessas três tabelas usa `user_full_access_clinic_ids()`,
-- que EXCLUI o dentista de propósito (0353). As sessões (`treatment_sessions`)
-- o dentista lê — por isso o tempo de cadeira aparecia e a lista não. Valia
-- para TODO dentista em TODO cliente.
--
-- Correção: a mesma saída da 0314 (`odontogram_sessions`) — uma leitura
-- `security definer` que devolve SÓ o necessário para a lista (plano, opção,
-- id e nome do item), SEM preço, para quem vê o odontograma do cliente
-- (`can_view_odontogram`: dentista, coordenador, gerente, consultor da
-- unidade, Planner, Admin). A regra das tabelas não muda: o dentista continua
-- sem ler valores do plano.
--
-- Só leitura. Idempotente. Não mexe em dado.
-- =============================================================================

create or replace function public.client_approved_plan_items(p_client uuid)
returns table (
  plan_id uuid,
  plan_created_at timestamptz,
  complement_of_plan_id uuid,
  complement_no integer,
  quality_locked boolean,
  quality_locked_at timestamptz,
  option_id uuid,
  is_primary boolean,
  option_sort integer,
  option_title text,
  item_id uuid,
  description text,
  item_sort integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.created_at, p.complement_of_plan_id, p.complement_no::integer,
         coalesce(p.quality_locked, false), p.quality_locked_at,
         o.id, o.is_primary, o.sort_order::integer, o.title,
         i.id, i.description, i.sort_order::integer
    from public.treatment_plans p
    join public.treatment_plan_options o on o.plan_id = p.id
    join public.treatment_plan_option_items i on i.option_id = o.id
   where p.client_id = p_client
     and p.status = 'approved'
     and public.can_view_odontogram(p_client)
   order by p.created_at, o.sort_order, i.sort_order;
$$;

comment on function public.client_approved_plan_items(uuid) is
  'Itens dos planos APROVADOS do cliente, sem preço, para a aba Sessões & Procedimentos de quem não lê o plano pela regra da tabela (o dentista). Mesmo portão do odontograma. OC-00172.';

revoke execute on function public.client_approved_plan_items(uuid) from public, anon, authenticated;
grant execute on function public.client_approved_plan_items(uuid) to authenticated;

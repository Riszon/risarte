-- =============================================================================
-- 0066 — Visibilidade de clientes da SDR (LOTE H3: item H3.7)
-- -----------------------------------------------------------------------------
-- A SDR (Encantador) enxerga, em Prontuários e na Jornada, os clientes que ela
-- "tocou": cadastrou, editou, agendou ou transferiu — para acompanhar o cliente
-- até a reavaliação. A Agenda continua completa (todos os horários), mas a
-- ficha dos clientes que não são dela fica bloqueada (tratado no app).
-- Esta função SECURITY DEFINER devolve os ids acessíveis (ignora RLS para
-- montar o conjunto, sem risco de recursão). Idempotente.
-- =============================================================================

create or replace function public.sdr_accessible_client_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  -- Cadastrou.
  select c.id
  from public.clients c
  where c.created_by = (select auth.uid())
  union
  -- Editou os dados cadastrais.
  select cc.client_id
  from public.client_changes cc
  where cc.changed_by = (select auth.uid())
  union
  -- Agendou (qualquer agendamento criado por ela).
  select a.client_id
  from public.appointments a
  where a.created_by = (select auth.uid())
  union
  -- Transferiu entre unidades.
  select h.client_id
  from public.client_clinic_history h
  where h.transferred_by = (select auth.uid());
$$;

grant execute on function public.sdr_accessible_client_ids() to authenticated;

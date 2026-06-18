-- =============================================================================
-- Risarte Odontologia — Migration 0024 (Lote D — etapa 3)
-- Cadastro com CPF primeiro: ao informar o CPF, se ele pertencer a um
-- "prospect" (pessoa cadastrada como RESPONSÁVEL, mas que ainda não é cliente),
-- preenchemos o cadastro automaticamente. A busca direta em client_guardians
-- esbarra na RLS (só responsáveis da própria clínica), então usamos uma função
-- SECURITY DEFINER que devolve apenas os campos básicos do responsável.
-- Idempotente: create or replace.
-- =============================================================================

create or replace function public.find_prospect_by_cpf(p_cpf text)
returns table (full_name text, birth_date date, phone text)
language sql
stable
security definer
set search_path = ''
as $$
  select g.full_name, g.birth_date, g.phone
  from public.client_guardians g
  where g.cpf = p_cpf
    and g.guardian_client_id is null  -- só "prospects": responsáveis que ainda não são clientes
  order by g.created_at desc
  limit 1;
$$;

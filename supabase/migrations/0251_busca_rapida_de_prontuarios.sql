-- =============================================================================
-- 0251 — Busca rápida de prontuários (nome, código e CPF)
-- -----------------------------------------------------------------------------
-- Pedido do dono: um botão sempre à mão que abre um campo para achar e abrir um
-- prontuário, sem precisar entrar na tela de Prontuários.
--
-- POR QUE ISTO PRECISA DE UMA FUNÇÃO NO BANCO, e não de uma consulta na tela:
--
--   O CPF é guardado COM MÁSCARA ("123.456.789-00"). Quem digita só os números
--   não acha ninguém com uma comparação de texto comum. Existe desde a 0078 a
--   função `cpf_digits()`, e desde a 0244 um índice único sobre ela — é por ali
--   que a busca tem de passar, senão ou não encontra, ou varre a tabela inteira.
--
-- ⚠️ ESTA FUNÇÃO NÃO É `security definer`, E ISSO É O PONTO.
--
--   Ela roda com os direitos de QUEM CHAMOU, então a RLS continua decidindo
--   quem enxerga qual paciente — a busca não abre porta nenhuma. Uma função
--   `security definer` aqui entregaria a lista de pacientes de qualquer unidade
--   a qualquer pessoa logada, que foi exatamente o defeito corrigido na 0227.
--
-- LGPD: devolve o mínimo para escolher entre dois homônimos (nome, código,
-- unidade, fase). Não devolve CPF, telefone nem endereço — quem precisa disso
-- abre a ficha, e abrir a ficha gera auditoria.
--
-- Idempotente.
-- =============================================================================

drop function if exists public.search_clients(text, integer);

create or replace function public.search_clients(
  p_term text,
  p_limit integer default 8
)
returns table (
  id uuid,
  full_name text,
  code text,
  status public.client_status,
  journey_phase public.journey_phase,
  clinic_name text
)
language sql
stable
-- Sem `security definer` de propósito. Ver o aviso acima.
set search_path = ''
as $$
  with termo as (
    select
      btrim(coalesce(p_term, '')) as texto,
      public.cpf_digits(p_term)   as digitos
  )
  select c.id, c.full_name, c.code, c.status, c.journey_phase, cl.name
    from public.clients c
    join public.clinics cl on cl.id = c.clinic_id
   cross join termo t
   where length(t.texto) >= 2
     and c.status <> 'anonymized'
     and (
       c.full_name ilike '%' || t.texto || '%'
       or c.code ilike '%' || t.texto || '%'
       -- Só entra na busca por CPF quando o que foi digitado é REALMENTE um
       -- pedaço de CPF (3+ dígitos). Sem isso, procurar "Ana 2" jogaria o "2"
       -- na comparação de documento e traria gente sem relação nenhuma.
       or (
         t.digitos is not null
         and length(t.digitos) >= 3
         and public.cpf_digits(c.cpf) like t.digitos || '%'
       )
     )
   -- Quem começa com o que foi digitado vem primeiro: quem procura "mari"
   -- quer a Mariana antes da Rosemari.
   order by
     case when c.full_name ilike t.texto || '%' then 0 else 1 end,
     c.full_name
   limit greatest(1, least(coalesce(p_limit, 8), 20));
$$;

comment on function public.search_clients(text, integer) is
  'Busca rápida de prontuários por nome, código ou CPF (por dígitos). Roda com os direitos de quem chamou — a RLS filtra. Devolve o mínimo para identificar; dados da ficha só abrindo a ficha.';

revoke all on function public.search_clients(text, integer) from public;
grant execute on function public.search_clients(text, integer) to authenticated;

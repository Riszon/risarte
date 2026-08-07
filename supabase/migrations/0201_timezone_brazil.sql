-- =============================================================================
-- 0201 — O SISTEMA VIRAVA O DIA ÀS 21H
-- -----------------------------------------------------------------------------
-- Achado do dono (06/08/2026, 21h45): uma parcela vencendo HOJE já aparecia em
-- atraso, e a baixa dada hoje (06/08) foi gravada como 07/08.
--
-- Causa: tudo — app e banco — usava a data em **UTC**. O Brasil está 3 horas
-- atrás, então das 21h à meia-noite o UTC já está no dia seguinte. Nesse
-- intervalo:
--   • `current_date` no banco devolvia amanhã;
--   • parcela vencendo hoje entrava na conta de multa e juros;
--   • a baixa nascia com data de amanhã, jogando a receita para o dia errado
--     no DFC.
--
-- Data de negócio (vencimento, recebimento, competência, vigência) é data
-- CIVIL brasileira, não instante em UTC. Duas correções:
--
--   1) O fuso do BANCO passa a ser America/Sao_Paulo. Corrige de uma vez os
--      ~40 usos de `current_date` espalhados pelas funções do Financeiro, sem
--      reescrever função por função (o que só criaria chance de erro novo).
--   2) `public.today_br()` fica como a forma explícita de dizer "hoje aqui",
--      para funções novas não dependerem da configuração do servidor.
--
-- ATENÇÃO: `alter database ... set` só vale para conexões NOVAS. As que já
-- estão abertas seguem em UTC até serem recicladas (minutos). Se o teste logo
-- após rodar esta migração ainda mostrar a data errada, espere um pouco e
-- recarregue.
--
-- NÃO corrige dados já gravados: as baixas que ficaram com 07/08 continuam
-- assim. Corrigir dinheiro por trás é contra a regra do módulo — o caminho é
-- estornar e lançar de novo.
--
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) O banco passa a pensar no fuso do Brasil
-- -----------------------------------------------------------------------------
do $$
begin
  execute format(
    'alter database %I set timezone to ''America/Sao_Paulo''',
    current_database()
  );
exception when insufficient_privilege then
  -- Sem permissão para mexer no banco: seguimos com today_br(), que não
  -- depende disso.
  raise notice 'Sem privilégio para alterar o fuso do banco — usando today_br().';
end $$;

-- Vale já nesta sessão (a configuração acima só pega em conexões novas).
set timezone to 'America/Sao_Paulo';

-- -----------------------------------------------------------------------------
-- 2) "Hoje" explícito, para não depender de configuração de servidor
-- -----------------------------------------------------------------------------
create or replace function public.today_br()
returns date
language sql
stable
as $$
  select (now() at time zone 'America/Sao_Paulo')::date;
$$;

comment on function public.today_br() is
  'Hoje no fuso do Brasil. Use em vez de current_date quando a data decidir '
  'dinheiro (vencimento, atraso, competência) — current_date depende da '
  'configuração do servidor, e em UTC ele vira o dia às 21h.';

grant execute on function public.today_br() to authenticated;

-- -----------------------------------------------------------------------------
-- 3) Conferência
-- -----------------------------------------------------------------------------
-- Os três primeiros valores têm de bater. `agora_utc` mostra a diferença que
-- causou o problema.
select
  current_setting('TimeZone') as fuso_da_sessao,
  current_date as current_date_agora,
  public.today_br() as hoje_no_brasil,
  (now() at time zone 'UTC')::date as data_em_utc,
  (select count(*) from public.payment_receipts
    where received_at > public.today_br()) as baixas_com_data_no_futuro;

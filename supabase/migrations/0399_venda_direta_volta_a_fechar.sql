-- =============================================================================
-- 0399 — VENDA DIRETA VOLTA A FECHAR (gatilho da receita separado por tabela)
-- -----------------------------------------------------------------------------
-- Achado em 11/11/2026 (sessão da integração Asaas, no ensaio da cobrança):
--
--   update public.direct_sales set closed_at = now() where id = ...
--   → ERRO: record "new" has no field "negotiation_id"
--
-- CAUSA: a 0373 ligou UMA função, `post_sale_accruals_on_close`, como gatilho
-- de `commercial_sales` E de `direct_sales`. A consulta dela juntava os dois
-- casos num `or`:
--
--   (tg_table_name = 'commercial_sales' and i.negotiation_id = new.negotiation_id)
--   or (tg_table_name = 'direct_sales' and i.direct_sale_id = new.id)
--
-- O PL/pgSQL monta a consulta INTEIRA antes de rodar: ele precisa do valor de
-- `new.negotiation_id` mesmo quando a tabela é `direct_sales` — e a venda
-- direta não tem essa coluna. O "and" não protege; a pergunta cai antes.
--
-- EFEITO desde 09/11/2026 (0373): NENHUMA venda direta fecha. Cai junto:
--   - o último passo do fechamento (contrato + pagamento confirmado);
--   - a venda direta de VALOR ZERO (o gatilho da 0165 fecha sozinho ao criar,
--     e o fechamento derruba a criação inteira).
-- Venda comercial (negociação) NÃO foi afetada: ela tem as duas colunas.
-- Na produção, em 11/11/2026, não havia venda alguma — nada a recuperar.
--
-- O QUE MUDA: um ramo por tabela. Cada consulta só fala das colunas da própria
-- tabela; o resto da regra da 0373 (receita só com a venda fechada, mês
-- fechado não derruba o fechamento) fica igual.
-- Idempotente (create or replace; os quatro gatilhos já existem e apontam para
-- esta função pelo nome — não precisam ser recriados).
-- =============================================================================

create or replace function public.post_sale_accruals_on_close()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_id uuid;
begin
  -- 0399: UM RAMO POR TABELA. Nunca citar coluna de uma tabela no ramo da
  -- outra: o PL/pgSQL avalia todo `new.<coluna>` da consulta, mesmo atrás de
  -- um `and tg_table_name = ...` falso.
  if tg_table_name = 'direct_sales' then
    select coalesce(array_agg(i.id), '{}') into v_ids
      from public.payment_installments i
     where i.direct_sale_id = new.id
       and i.renegotiation_id is null
       and i.status <> 'cancelada';
  elsif tg_table_name = 'commercial_sales' then
    select coalesce(array_agg(i.id), '{}') into v_ids
      from public.payment_installments i
     where i.negotiation_id = new.negotiation_id
       and i.renegotiation_id is null
       and i.status <> 'cancelada';
  else
    raise exception 'post_sale_accruals_on_close: tabela inesperada %', tg_table_name;
  end if;

  foreach v_id in array v_ids loop
    begin
      perform public.post_installment_accrual(v_id);
    exception when others then
      -- Mês já fechado na contabilidade (0231): o fechamento da VENDA não pode
      -- cair por isso (ele chega até pelo webhook da assinatura). Fica o aviso
      -- no log; `npm run check:dados` acusa venda fechada sem receita.
      if sqlerrm = 'PERIOD_CLOSED' then
        raise warning '0373: receita da cobrança % não lançada (mês fechado)', v_id;
      else
        raise;
      end if;
    end;
  end loop;
  return null;
end;
$$;

revoke execute on function public.post_sale_accruals_on_close() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Conferência (só contagens — nenhum dado pessoal)
-- -----------------------------------------------------------------------------
select
  (select count(*) from pg_trigger t join pg_proc p on p.oid = t.tgfoid
    where p.proname = 'post_sale_accruals_on_close' and not t.tgisinternal)
    as gatilhos_ligados_esperado_4,
  (select count(*) from public.direct_sales
    where closed_at is null and cancelled is not true
      and contract_signed and payment_confirmed)
    as vendas_diretas_prontas_e_abertas_fechar_pela_tela;

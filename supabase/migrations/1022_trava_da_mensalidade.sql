-- =============================================================================
-- 1022 — A TRAVA DA MENSALIDADE: uma por documento por mês, no BANCO
-- -----------------------------------------------------------------------------
-- Pedido do dono (26/09/2026), depois do AP11. Duas descobertas:
--
--   1. A trava contra cobrar a mesma empresa duas vezes no mês existia SÓ no
--      código da cobrança em LOTE — e, quando a contagem falhava, ela deixava
--      passar (AP11, já consertado no código).
--   2. Pior: a geração pela TELA DA EMPRESA ("Gerar cobrança mensal") não
--      tinha trava NENHUMA. O botão só fica bloqueado enquanto carrega; gerar
--      duas vezes, ou uma pela tela e outra pelo lote, cobrava em dobro — sem
--      falha nenhuma, só com dois cliques.
--
-- Por isso a trava passa a morar no BANCO, onde nenhum caminho escapa dela —
-- nem os que existem, nem os que alguém escrever amanhã. É a mesma lição da
-- regra de ouro das vendas (0203): quando uma regra importa, ela mora no banco.
--
-- ⚠️ A CHAVE É (EMPRESA, DOCUMENTO, MÊS) — NÃO (EMPRESA, MÊS).
-- Uma empresa com mais de um CNPJ/CAEPF recebe UM BOLETO POR DOCUMENTO no
-- mesmo mês, e isso é legítimo. Uma trava por empresa e mês barraria a segunda
-- cobrança correta: no banco de treino, ela acusaria exatamente um caso assim
-- (medido em 26/09/2026). A duplicata de verdade é o MESMO documento cobrado
-- duas vezes no MESMO mês.
--
-- `nulls not distinct`: cobrança sem documento (empresa com um só) também é
-- única por mês. Sem isso, o Postgres trataria cada nulo como diferente e duas
-- mensalidades "sem documento" passariam.
--
-- CANCELADA NÃO CONTA: cancelar e gerar de novo é o caminho certo para
-- corrigir uma cobrança errada, e ele continua livre. Nenhum caminho do sistema
-- reativa uma cobrança cancelada (conferido nas funções 1002, 1005 e 1013).
--
-- A IMPLANTAÇÃO FICA DE FORA, de propósito. Pela regra do dono, cada titular
-- novo paga a própria implantação — uma empresa que entrou com 80 e depois
-- incluiu 20 paga implantação duas vezes, e as duas são legítimas. Uma trava
-- por documento barraria a segunda. A proteção certa da implantação é outra
-- (não cobrar o MESMO titular duas vezes) e está registrada no BACKLOG.
--
-- Idempotente. Não apaga nem altera nenhuma cobrança.
-- =============================================================================

-- 1) Antes de travar, conferir se JÁ há duplicata ---------------------------
-- Se houver, a trava não pode ser criada — e, mais importante, alguma empresa
-- JÁ FOI cobrada em dobro. A migração para com uma frase que diz o que fazer,
-- em vez de um erro técnico do Postgres. Nada é cancelado aqui: decidir qual
-- das duas cobranças vale é trabalho de gente, não de migração.
do $$
declare
  v_n int;
begin
  select count(*) into v_n
    from (
      select company_id, company_document_id, reference_month
        from empresarial.adhesion_billing
       where billing_type = 'MONTHLY'
         and status <> 'CANCELLED'
       group by 1, 2, 3
      having count(*) > 1
    ) d;

  if v_n > 0 then
    raise exception
      'MENSALIDADE_DUPLICADA: % empresa(s)/documento(s) têm mais de uma mensalidade viva no mesmo mês. Nada foi alterado. Cancele a cobrança em dobro (tela da empresa → Financeiro) e rode esta migração de novo.',
      v_n;
  end if;
end;
$$;

-- 2) A trava ----------------------------------------------------------------
create unique index if not exists adhesion_billing_mensalidade_unica
  on empresarial.adhesion_billing (company_id, company_document_id, reference_month)
  nulls not distinct
  where billing_type = 'MONTHLY' and status <> 'CANCELLED';

comment on index empresarial.adhesion_billing_mensalidade_unica is
  'Uma mensalidade viva por empresa, documento e mês (1022). Implantação fica de fora: cada titular novo paga a sua.';

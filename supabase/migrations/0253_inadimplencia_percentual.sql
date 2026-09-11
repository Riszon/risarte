-- =============================================================================
-- 0253 — A TAXA DE INADIMPLÊNCIA COMO INDICADOR (relato OC-00005)
--
-- O pedido do Admin Master: *"qual a taxa de inadimplentes que é saudável para
-- uma empresa"*.
--
-- ⚠️ O SISTEMA NÃO SABE DISSO, E NÃO VAI FINGIR QUE SABE. Não existe número de
-- mercado que valha para toda clínica — depende do ticket, do meio de pagamento,
-- da praça e da política de crédito de cada unidade. Um percentual inventado
-- aqui viraria "o sistema disse que 5% é saudável", que é pior que não ter
-- indicador nenhum: decisão errada com cara de respaldo.
--
-- O que o sistema faz bem, e já faz em multa, juros, alçada, SLA e teto de
-- desconto, é deixar o DONO definir o limite e medir contra ele. Este é o mesmo
-- padrão: cascata rede → unidade, coluna ANULÁVEL na linha que sobrescreve
-- (sem isso a cascata não é cascata — lição da 0230).
--
-- ⚠️ POR QUE PERCENTUAL, SE JÁ EXISTE `alert_overdue_cents`. O limite em reais
-- que existe desde a 0230 responde "a unidade está com muito dinheiro parado?".
-- Ele NÃO responde a pergunta da Franqueadora, que é comparar unidades: R$ 5.000
-- vencidos é muito em Cambé e pouco numa unidade grande. Percentual compara;
-- reais, não. Os dois convivem, e medem coisas diferentes de propósito.
-- =============================================================================

alter table public.finance_settings
  add column if not exists alert_overdue_percent numeric(5,2);

comment on column public.finance_settings.alert_overdue_percent is
  'Teto da taxa de inadimplencia (vencido / a receber, em %). NULO na linha da unidade = segue a rede. Nao e referencia de mercado: e decisao da rede.';

-- O padrão da REDE nasce preenchido para o indicador ter linha de referência
-- desde o primeiro dia; a unidade continua nula (segue a rede) até alguém
-- decidir outra coisa para ela. 5% é ponto de partida, não verdade — e a tela
-- diz isso com todas as letras, ao lado do número.
insert into public.finance_settings (clinic_id, alert_overdue_percent)
select null, 5.00
 where not exists (
   select 1 from public.finance_settings where clinic_id is null
 );

update public.finance_settings
   set alert_overdue_percent = 5.00
 where clinic_id is null
   and alert_overdue_percent is null;

-- -----------------------------------------------------------------------------
-- A CASCATA, NUM LUGAR SÓ.
--
-- Copiada solta em cada consulta, ela viraria duas versões da mesma régua no dia
-- em que alguém mexesse numa delas. Vem ANTES de quem a usa: função `language
-- sql` tem o corpo validado na criação, e chamar o que ainda não existe derruba
-- a migração inteira.
-- -----------------------------------------------------------------------------
create or replace function public.overdue_limit_percent(p_clinic_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $fn$
  select coalesce(
    (select s.alert_overdue_percent from public.finance_settings s
      where s.clinic_id = p_clinic_id and s.alert_overdue_percent is not null),
    (select s.alert_overdue_percent from public.finance_settings s
      where s.clinic_id is null)
  );
$fn$;

-- -----------------------------------------------------------------------------
-- A TAXA POR UNIDADE — uma conta só, para a tela da unidade e a da rede.
--
-- ⚠️ ELA VIVE NO BANCO, e não em TypeScript como o indicador 9.28 da ficha do
-- cliente. O motivo é o alcance: a ficha calcula sobre as parcelas de UMA
-- pessoa, que já estão carregadas; a rede precisa da taxa de todas as unidades
-- sem trazer parcela nenhuma para o servidor do aplicativo. As duas contas têm
-- de dar o mesmo número, e é a mesma definição: **vencido ÷ a receber**.
--
-- ⚠️ O DENOMINADOR É O QUE ESTÁ A RECEBER, NÃO O FATURAMENTO. Sobre o
-- faturamento a taxa cairia em todo mês de venda forte, mesmo com a cobrança
-- piorando — o indicador andaria para o lado contrário do problema.
--
-- Cancelada e renegociada ficam de fora dos dois lados: cancelada não é dívida,
-- e renegociada foi SUBSTITUÍDA por outra cobrança que já está contada. Contá-la
-- somaria a mesma dívida duas vezes.
--
-- Vencido = passou da data efetiva e ainda falta valor. A data efetiva é
-- `expected_settlement_date` quando existe: cartão liquida em D+30, e cobrar
-- atraso antes disso acusaria a unidade de uma inadimplência que é só prazo de
-- adquirente.
-- -----------------------------------------------------------------------------
create or replace function public.clinic_overdue_rate(p_clinic_id uuid)
returns table (
  open_cents bigint,
  overdue_cents bigint,
  overdue_count integer,
  open_count integer,
  overdue_percent numeric,
  limit_percent numeric
)
language sql
stable
security definer
set search_path = ''
as $fn$
  with base as (
    select
      i.amount_cents - coalesce(i.paid_amount_cents, 0) as falta,
      coalesce(i.expected_settlement_date, i.due_date) < public.today_br() as vencida
    from public.payment_installments i
    where i.clinic_id = p_clinic_id
      and i.status in ('em_aberto', 'parcial')
      and i.amount_cents > coalesce(i.paid_amount_cents, 0)
  ),
  somas as (
    select
      coalesce(sum(falta), 0)::bigint as aberto,
      coalesce(sum(falta) filter (where vencida), 0)::bigint as vencido,
      count(*) filter (where vencida)::integer as n_vencidas,
      count(*)::integer as n_abertas
    from base
  )
  select
    s.aberto,
    s.vencido,
    s.n_vencidas,
    s.n_abertas,
    -- Sem nada a receber não existe taxa. Devolver 0% diria "está ótimo",
    -- quando a verdade é "não há o que medir" — e as duas pedem decisões
    -- opostas. Mesma regra da margem líquida sem receita (FIN6.1).
    case when s.aberto > 0
      then round((s.vencido::numeric * 100) / s.aberto, 2)
      else null
    end as overdue_percent,
    public.overdue_limit_percent(p_clinic_id) as limit_percent
  from somas s
  where public.can_see_clinic_finance(p_clinic_id);
$fn$;

-- ⚠️ `security definer` SEM GUARDA ENTREGA O DADO A QUEM CHAMAR (lição da 0227).
-- `clinic_overdue_rate` filtra por `can_see_clinic_finance`; mesmo assim, só
-- quem está autenticado executa qualquer uma das duas.
revoke all on function public.overdue_limit_percent(uuid) from public;
revoke all on function public.clinic_overdue_rate(uuid) from public;
grant execute on function public.overdue_limit_percent(uuid) to authenticated;
grant execute on function public.clinic_overdue_rate(uuid) to authenticated;

-- =============================================================================
-- 0252 — O INDICADOR DA BOIA: quantos relatos estão esperando
-- -----------------------------------------------------------------------------
-- Pedido do dono (08/09/2026): "no ícone relatar problemas deve aparecer um
-- indicador de que tem 'mensagem' relatando problemas, dúvidas ou sugestões".
--
-- ⚠️ O NÚMERO NÃO PODE SER O MESMO PARA TODO MUNDO, e é isto que a migração
-- resolve. A boia aparece para a operação inteira; contar "relatos abertos da
-- unidade" para a recepcionista seria pendurar no ícone dela um número sobre o
-- qual ela não pode fazer nada — e ícone com número que não é seu ensina a
-- ignorar o número. Então:
--
--   Admin Master  → a FILA DELE: relatos abertos e em análise. Zera respondendo.
--   Todo o resto  → as RESPOSTAS que ainda não leu, nos relatos que ele abriu.
--
-- **A segunda metade é a que exige coluna nova.** Sem uma marca de "já li", o
-- número da equipe nunca zeraria: o relato respondido continuaria contando para
-- sempre. Alerta que não zera é alerta que ninguém lê — a lição já escrita em
-- `finance_alerts` (0230), agora aplicada aqui antes de custar de novo.
--
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) A marca de "li a resposta"
-- -----------------------------------------------------------------------------
alter table public.system_reports
  add column if not exists reporter_seen_answer_at timestamptz;

comment on column public.system_reports.reporter_seen_answer_at is
  'Quando quem relatou abriu a tela de Problemas depois de ser respondido. É o que faz o indicador da boia zerar para ele.';

-- O índice serve às DUAS contas: a fila do Admin Master varre por status, e a
-- da pessoa varre pelas próprias linhas. Sem ele, cada consulta do navegador
-- (uma por minuto, por pessoa) leria a tabela inteira.
create index if not exists system_reports_pending_idx
  on public.system_reports (status)
  where status in ('aberto', 'em_analise');

create index if not exists system_reports_unseen_idx
  on public.system_reports (reporter_id)
  where answer is not null and reporter_seen_answer_at is null;

-- -----------------------------------------------------------------------------
-- 2) A conta — UMA só, no banco
-- -----------------------------------------------------------------------------
-- A tela poderia montar as duas consultas sozinha. Não monta de propósito: a
-- régua do que "está pendente" passaria a existir em dois lugares, e o dia em
-- que eles discordassem seria justamente o dia em que alguém precisa confiar no
-- número. Mesma decisão do custo de material (0216) e do painel da rede (8.3).
--
-- **Sem `security definer`**, e isso é deliberado: a função lê `system_reports`
-- com a RLS da 0247 valendo, então ela não enxerga nada que a pessoa já não
-- pudesse enxergar. Uma função dona do banco aqui abriria uma porta para contar
-- relato de unidade alheia — o defeito que a 0227 corrigiu no financeiro.
create or replace function public.system_reports_pending()
returns integer
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (
      case
        when public.is_admin_master() then (
          -- A fila dele. "Em análise" continua contando: já foi olhado, ainda
          -- não foi resolvido — e é isso que "pendente" quer dizer.
          select count(*)
            from public.system_reports
           where status in ('aberto', 'em_analise')
        )
        else (
          select count(*)
            from public.system_reports
           where reporter_id = (select auth.uid())
             and answer is not null
             and reporter_seen_answer_at is null
        )
      end
    ),
    0
  )::integer;
$$;

comment on function public.system_reports_pending() is
  'O número do indicador da boia, já resolvido para quem pergunta: fila para o Admin Master, respostas não lidas para os demais.';

revoke all on function public.system_reports_pending() from public;
grant execute on function public.system_reports_pending() to authenticated;

-- -----------------------------------------------------------------------------
-- 3) A porta estreita para marcar como lido
-- -----------------------------------------------------------------------------
-- ⚠️ POR QUE UMA FUNÇÃO E NÃO UMA POLÍTICA NOVA. A política de UPDATE da 0247
-- é do Admin Master e só dele, de propósito: "deixar quem relatou mudar o
-- status transformaria a fila numa lista que se resolve sozinha". Afrouxá-la
-- para caber esta marca devolveria à pessoa o poder de fechar o próprio relato.
--
-- Esta função é `security definer` porque precisa passar pela política — mas é
-- estreita nas duas pontas: escreve UMA coluna e SÓ nas linhas de quem chamou.
-- Não recebe parâmetro nenhum, então não há id de outra pessoa para passar.
create or replace function public.mark_system_reports_seen()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    return;
  end if;

  update public.system_reports
     set reporter_seen_answer_at = now()
   where reporter_id = v_user
     and answer is not null
     and reporter_seen_answer_at is null;
end;
$$;

comment on function public.mark_system_reports_seen() is
  'Marca como lidas as respostas dos relatos de quem chamou. Porta estreita: uma coluna, só as linhas do próprio usuário.';

revoke all on function public.mark_system_reports_seen() from public;
grant execute on function public.mark_system_reports_seen() to authenticated;

-- -----------------------------------------------------------------------------
-- 4) O que já está respondido nasce LIDO
-- -----------------------------------------------------------------------------
-- Sem isto, a entrega acenderia a boia de todo mundo que já foi respondido
-- alguma vez, com respostas que a pessoa leu semanas atrás. Estreia de
-- indicador com número velho é a maneira mais rápida de ensinar a equipe a
-- ignorá-lo.
update public.system_reports
   set reporter_seen_answer_at = coalesce(answered_at, now())
 where answer is not null
   and reporter_seen_answer_at is null;

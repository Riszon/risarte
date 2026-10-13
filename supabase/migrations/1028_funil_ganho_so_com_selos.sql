-- =============================================================================
-- 1028 — NO FUNIL, SÓ É GANHO COM OS DOIS SELOS; SÓ IMPLANTA COM A CONFERÊNCIA
-- (AP39, decisão do dono em 13/10/2026: "opção A")
--
-- A tela do funil sempre disse: "Só é ganho com contrato assinado E pagamento
-- da implantação confirmado", e a conferência do consultor é descrita como
-- "antes de a empresa entrar em implantação". Dois botões do cartão passavam
-- por fora das duas frases:
--
--   - "Fechar (ganho) → criar empresa", em qualquer fase aberta, não olhava
--     os selos;
--   - "Mover para Implantação" pulava a conferência — e é a conferência que
--     leva o combinado específico para o cadastro da empresa (1011).
--
-- Medido antes de mexer (só contagens): o funil da PRODUÇÃO estava vazio; no
-- treino, 4 de 5 empresas ganhas não tinham nenhum selo e 3 de 3 em
-- implantação não tinham conferência.
--
-- ⚠️ A REGRA PASSA A MORAR NO BANCO (CLAUDE.md §8b: "quando uma regra de
-- negócio importa, ela mora no banco"). Os botões saíram da tela na mesma
-- entrega, mas tela é UX: esta é a barreira, e vale por qualquer caminho.
--
-- ⚠️ SÓ A PASSAGEM É CONFERIDA, NUNCA O QUE JÁ ESTÁ LÁ. Empresa que entrou em
-- Fechamento ou Implantação antes desta migração continua onde está e pode ser
-- editada normalmente — o gatilho olha a MUDANÇA de fase, não a fase.
--
-- Nenhuma tabela nova, nenhum dado alterado. Idempotente.
-- =============================================================================

create or replace function empresarial.guard_lead_closing()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  selada boolean;
  estava_selada boolean;
begin
  selada := new.contract_signed_at is not null
        and new.implantation_paid_at is not null;

  -- (1) DESMARCAR UM SELO DESFAZ O GANHO — enquanto a empresa ainda não tem
  --     cadastro. Sem isto, marcar os dois, ganhar e desmarcar deixaria a
  --     empresa "ganha" sem selo: a mesma brecha, por outro caminho.
  --     Com o cadastro já criado o selo pode ser desmarcado e a fase não
  --     muda: é fato que precisa poder ser registrado (boleto devolvido), e
  --     desfazer um cadastro em uso não é ato de gatilho.
  if tg_op = 'UPDATE' then
    estava_selada := old.contract_signed_at is not null
                 and old.implantation_paid_at is not null;
    if old.stage = 'CLOSED_WON'
       and new.stage = 'CLOSED_WON'
       and new.company_id is null
       and estava_selada
       and not selada
    then
      new.stage := 'FOLLOW_UP';
    end if;
  end if;

  -- (2) EM NEGOCIAÇÃO E COM OS DOIS SELOS, É GANHO — por qualquer caminho.
  --     A 1010 só fechava no instante em que o SELO era marcado. Quem marcava
  --     os dois ainda em "Apresentado" e só depois registrava o envio da
  --     proposta ficava em Proposta enviada, selada e sem fechar — e o botão
  --     que resolvia isso à mão é o que esta migração aposenta.
  if selada and new.stage in ('PROPOSAL_SENT', 'FOLLOW_UP') then
    new.stage := 'CLOSED_WON';
  end if;

  -- (3) ENTRAR EM FECHAMENTO (GANHO) EXIGE OS DOIS SELOS.
  if new.stage = 'CLOSED_WON'
     and (tg_op = 'INSERT' or old.stage is distinct from 'CLOSED_WON')
     and not selada
  then
    raise exception 'WON_WITHOUT_SEALS'
      using hint = 'Só é ganho com contrato assinado e implantação paga. '
                   'Marque os dois selos na aba Envio e selos da ficha.';
  end if;

  -- (4) ENTRAR EM IMPLANTAÇÃO EXIGE O CADASTRO E A CONFERÊNCIA.
  --     A conferência confirmada move o cartão sozinha (gatilho da 1011, que é
  --     AFTER na tabela das conferências — a linha já existe quando este
  --     gatilho olha).
  if new.stage = 'IMPLEMENTATION'
     and (tg_op = 'INSERT' or old.stage is distinct from 'IMPLEMENTATION')
  then
    if new.company_id is null then
      raise exception 'IMPLEMENTATION_WITHOUT_COMPANY'
        using hint = 'Crie o cadastro da empresa antes: é nele que a '
                     'implantação cadastra os titulares.';
    end if;
    if not exists (
      select 1
      from empresarial.lead_closing_reviews r
      where r.lead_id = new.id
        and r.everything_ok
    ) then
      raise exception 'IMPLEMENTATION_WITHOUT_REVIEW'
        using hint = 'A implantação começa pela conferência do consultor, na '
                     'aba Fechamento da ficha.';
    end if;
  end if;

  return new;
end;
$fn$;

comment on function empresarial.guard_lead_closing() is
  '1028 (AP39): no funil, só entra em Fechamento (ganho) com os dois selos, e '
  'só entra em Implantação com cadastro criado e conferência confirmada. Olha '
  'a MUDANÇA de fase — o que já estava lá não é tocado.';

-- Função de gatilho não é chamada por ninguém; fechada mesmo assim (AP15:
-- `revoke ... from public` não basta no Supabase).
revoke execute on function empresarial.guard_lead_closing()
  from public, anon, authenticated;

-- ⚠️ O NOME DECIDE A ORDEM. Gatilhos BEFORE da mesma tabela rodam em ordem
-- alfabética, e este precisa vir DEPOIS de `commercial_leads_close_when_sealed`
-- (1010): é aquele que troca a fase para ganho quando o segundo selo é
-- marcado, e é este que confere o resultado. "guard" vem depois de "close".
drop trigger if exists commercial_leads_guard_closing
  on empresarial.commercial_leads;
create trigger commercial_leads_guard_closing
  before insert or update on empresarial.commercial_leads
  for each row execute function empresarial.guard_lead_closing();

notify pgrst, 'reload schema';

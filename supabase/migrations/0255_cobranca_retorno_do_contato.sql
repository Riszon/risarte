-- =============================================================================
-- 0255 — O retorno do contato da cobrança (relato OC-00009)
-- -----------------------------------------------------------------------------
-- O relato: *"uma aba de inadimplentes com NOME - TELEFONE - VALOR DEVEDOR -
-- CAMPO EDITÁVEL PARA INFORMAR RETORNO DO CONTATO"*.
--
-- O nome, o valor e o indicador já existiam (OC-00005). Faltavam o telefone —
-- que é do cadastro do cliente e só precisava ser trazido — e **onde registrar
-- o que a pessoa respondeu**, que não existia em lugar nenhum do sistema.
--
-- 1) É HISTÓRICO, NÃO CAMPO. O relato pede "campo editável", e a primeira ideia
--    seria uma coluna em `clients`. Seria errado: sobrescrever apagaria a
--    tentativa da semana passada, e é justamente a sequência — *"dia 2 não
--    atendeu, dia 5 prometeu pagar dia 10, dia 11 não pagou"* — que mostra se a
--    cobrança está andando ou parada. Uma linha por contato.
--
-- 2) O RESULTADO É LISTA FECHADA, a observação é livre. É o resultado que
--    permite contar depois quantos prometeram e não pagaram; em texto livre
--    esse número não existe. A observação continua ao lado, para o que é
--    conversa.
--
-- 3) A PROMESSA TEM DATA PRÓPRIA (`promised_date`). "Prometeu pagar" sem dizer
--    quando não dá para cobrar de volta — e é essa data que a tela usa para
--    mostrar a promessa vencida.
--
-- 4) É POR CLIENTE E POR UNIDADE, não por parcela. Quem deve cinco parcelas
--    recebe UMA ligação, não cinco. A dívida é somada por pessoa na tela; o
--    registro do contato acompanha a pessoa.
--
-- ⚠️ NENHUMA CONTA DE DINHEIRO NASCE AQUI. O valor devido, a multa e os juros
--    continuam saindo de `viewInstallment` (`src/lib/finance/receivables.ts`,
--    puro e com teste) — a mesma régua da ficha do cliente e da tela de
--    recebíveis. Uma segunda soma em SQL passaria a discordar delas, e aí
--    nenhum dos números valeria nada.
--
-- Idempotente.
-- =============================================================================

create table if not exists public.collection_contacts (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  outcome varchar(30) not null
    check (outcome in (
      'NAO_ATENDEU',
      'FALEI_COM_A_PESSOA',
      'PROMETEU_PAGAR',
      'JA_PAGOU',
      'CONTESTA',
      'PEDIU_RENEGOCIAR',
      'NUMERO_ERRADO',
      'SEM_CONDICOES'
    )),
  note text,
  -- Só faz sentido com 'PROMETEU_PAGAR'; a tela pede, e é o que vira cobrança
  -- de volta quando a data passa.
  promised_date date,
  contacted_at timestamptz not null default now(),
  author_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists collection_contacts_client_idx
  on public.collection_contacts (clinic_id, client_id, contacted_at desc);

alter table public.collection_contacts enable row level security;

-- Quem enxerga o financeiro da unidade enxerga a cobrança dela. `can_see_clinic_finance`
-- é a MESMA guarda que a DRE, o fluxo de caixa e os recebíveis usam (0227) —
-- guarda copiada solta vira duas versões da mesma régua.
drop policy if exists collection_contacts_select on public.collection_contacts;
create policy collection_contacts_select on public.collection_contacts
  for select to authenticated
  using (public.can_see_clinic_finance(clinic_id));

drop policy if exists collection_contacts_insert on public.collection_contacts;
create policy collection_contacts_insert on public.collection_contacts
  for insert to authenticated
  with check (public.can_see_clinic_finance(clinic_id));

-- Sem UPDATE e sem DELETE, de propósito: registro de cobrança que se apaga não
-- serve de prova de que a unidade cobrou. Errou ao digitar? Registra de novo —
-- a sequência conta a verdade, inclusive a correção.
grant select, insert on public.collection_contacts to authenticated;
grant all on public.collection_contacts to service_role;

comment on table public.collection_contacts is
  'Retorno de cada tentativa de cobrança (OC-00009). Uma linha por contato, por '
  'cliente e por unidade. Não se edita nem se apaga: a sequência é a prova de '
  'que a unidade cobrou.';

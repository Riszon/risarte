# AP179 — Sessões do plano duplicadas ao abrir a ficha (prioridade alta)

**Situação:** plano para o dono aprovar. Nada foi mudado ainda.

## O problema, em uma frase

Quando a ficha do paciente é aberta logo depois do fechamento da venda, cada
procedimento do plano pode ganhar **duas** sessões iguais. Não é só da
ortodontia: vale para qualquer venda nova.

## O que foi visto no treino (17/11/2026)

- Aparelho e limpeza ganharam duas sessões cada, todas "Sessão 1 de 1",
  criadas em duas operações da Recepção com 18 ms de diferença.
- A janela de agendamento lista as quatro; o item aparece "0/2 sessões"; a
  cópia do aparelho fica "a agendar" mesmo depois da instalação.
- **O repasse da instalação e o da limpeza não nasceram.** A regra do repasse
  só paga quando todas as sessões do mesmo procedimento estão feitas ou
  canceladas, e a cópia ficou pendente.
- **Não foi um caso isolado.** No treino há 16 procedimentos duplicados, em 4
  pacientes, desde 01/10/2026, todos com as duas cópias criadas no mesmo
  instante. Em 3 deles uma das cópias já foi atendida, então o repasse desses
  procedimentos também pode estar preso.

## A causa

A ficha chama duas rotinas do banco ao abrir: `ensure_treatment_sessions`
(Fase 5) e `topup_treatment_sessions` (aba Sessões & Procedimentos). As duas
perguntam "este item já tem sessão?" e, se não tem, criam. Quando as duas rodam
ao mesmo tempo, as duas ouvem "não" e as duas criam. Não há trava.

## A correção proposta (migração nova)

1. **Trava por paciente** nas três rotinas que criam sessões do plano
   (`ensure_treatment_sessions`, `topup_treatment_sessions` e
   `_generate_complement_sessions`): a segunda espera a primeira terminar e,
   quando roda, já vê as sessões criadas. É o mesmo tipo de trava que a agenda
   usa desde a 0362.
2. **A régua:** um teste que lê a migração e exige a trava nas três rotinas, e
   um ensaio no treino que roda as duas rotinas ao mesmo tempo para o mesmo
   paciente e confere que nasce uma sessão por item.
3. **Arrumar o que já duplicou** (produção e treino), na mesma migração:
   - acha os pares iguais (mesmo item, mesma sessão, sem refação nem revisão,
     criados com até 2 segundos de diferença) e **remove a cópia que nunca foi
     usada** (sem atendimento concluído e sem repasse);
   - depois, para cada procedimento que ficou completo, roda a conta do
     repasse de novo (`_payout_accrue_block`), para nascer o repasse que ficou
     preso.
   - **Por que remover e não cancelar:** sessão cancelada conta no repasse
     proporcional. Cancelar a cópia faria a instalação pagar **metade**.
   - Como a migração apaga dado, ela leva a marca `-- DESTRUTIVO:` com o
     motivo, e para sozinha se encontrar uma cópia com atendimento, evolução ou
     repasse ligado.

## O que a equipe percebe (manual)

Nada de tela nova. Some a sessão repetida na agenda e na ficha, e o repasse
preso aparece no relatório do dentista. Registro no changelog e no ESTADO; o
manual não muda.

## Antes de começar: uma consulta na produção (só leitura)

```sql
select count(*) as procedimentos_duplicados,
       coalesce(sum(n - 1), 0) as copias
from (
  select item_id, session_index, count(*) as n
  from public.treatment_sessions
  where item_id is not null and redo_kind is null and direct_sale_id is null
  group by 1, 2
  having count(*) > 1
) x;
```

O resultado diz quantas cópias a migração vai remover lá.

## Como provo

- No treino: o ensaio das rotinas simultâneas (antes: duplica; depois: não).
- A arrumação roda primeiro numa transação desfeita, contando o que removeria;
  depois de verdade. O paciente de teste tem duas cópias para servir de prova,
  e o repasse da instalação tem de nascer.
- `check-migrations`, `npm run verificar`, `npm test`, `npm run lint`.

## Decisões suas

- **D1:** autoriza remover as sessões copiadas que nunca foram usadas, na
  produção e no treino? Recomendo que sim: elas são resto do defeito, e
  cancelar pagaria repasse pela metade.
- **D2:** além da trava, quer uma **regra no banco** que recuse duas sessões
  iguais do mesmo item? Ela fecha a porta de vez, mas só posso pôr depois de
  saber, pela consulta acima, que não há caso legítimo de sessão repetida.
  Recomendo decidir depois da consulta.

## Tamanho

Médio. Uma migração (você roda na produção) e o push só depois dela.

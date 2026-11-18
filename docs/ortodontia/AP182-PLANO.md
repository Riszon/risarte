# AP182 — Cancelar o agendamento deixa uma manutenção "prevista" fantasma (prioridade média)

**Situação:** plano para o dono aprovar. Nada foi mudado ainda.

## O problema, em uma frase

Quando uma manutenção que nasceu do próprio agendamento tem o agendamento
cancelado, ela volta a "prevista" em vez de ser cancelada, e fica no
cronograma como se fosse do plano.

## O que foi visto no treino (18/11/2026)

- O controle da contenção foi agendado como "Manutenção ortodôntica" e virou a
  manutenção 48, criada pelo agendamento.
- Ao cancelar o agendamento, a manutenção 48 ficou "prevista", sem
  agendamento, num caso já com alta.

## A causa

Há duas regras para soltar uma manutenção do agendamento:

- A da 0417 (`_ortho_release_maintenance`), usada quando o agendamento muda de
  tipo ou vira sessão de plano: a que nasceu do agendamento é **cancelada**; a
  do cronograma volta a **prevista**. Está certa.
- O ramo do **cancelamento** em `ortho_appointment_sync` (recriado na 0425):
  sempre volta a prevista, sem olhar se nasceu do agendamento.

## A correção proposta (migração nova)

1. Recriar `ortho_appointment_sync` a partir da 0425, com o ramo do
   cancelamento usando a mesma regra da 0417: a que nasceu do agendamento é
   cancelada; a do cronograma volta a prevista. Nada mais muda na função.
2. **Arrumar as fantasmas** na mesma migração: manutenção criada por
   agendamento, "prevista", sem agendamento, passa a "cancelada". É só uma
   mudança de situação, nada é apagado.
3. **A régua:** o espelho da regra no teste da ortodontia, e um ensaio no
   treino: cancelar o agendamento de uma manutenção extra (vira cancelada) e
   o de uma do cronograma (volta a prevista).

## O que a equipe percebe

Some do cronograma a manutenção "prevista" que ninguém marcou. Registro no
changelog; o manual não muda.

## Antes de começar: uma consulta na produção (só leitura)

```sql
select count(*) as fantasmas
from public.ortho_maintenances
where from_appointment and status = 'prevista' and appointment_id is null;
```

## Decisão sua

Nenhuma. A regra certa já foi decidida na AP175 (0417); aqui é só fazer o
cancelamento segui-la.

## Tamanho

Pequeno. Uma migração (você roda na produção) e o push só depois dela.

# AP181 — Lote de mensalidades depois de suspender e retomar (prioridade alta)

**Situação:** plano para o dono aprovar. Nada foi mudado ainda.

## O problema, em uma frase

Depois de suspender e retomar um caso, o lote novo de mensalidades começa
depois do lote que a suspensão cancelou, e o paciente fica meses sem nenhuma
mensalidade.

## O que foi visto no treino (17/11/2026)

- Lote 1: 11/2026 a 10/2027. Lote 2: 11/2027 a 04/2028.
- "Suspender" cancelou as mensalidades dos meses seguintes e encerrou os dois
  lotes. Isso está certo.
- "Retomar" não criou lote. Isso também está certo.
- "Emitir novas mensalidades" criou o lote 3 em **05/2028 a 10/2028**.
- Resultado: de 12/2026 a 04/2028 o paciente ficou sem mensalidade nenhuma.

## A causa

A rotina que cria o lote (`_ortho_emit_batch`, 0335) começa "no mês seguinte ao
último lote", olhando o `last_month` do lote, mesmo quando todas as cobranças
dele foram canceladas.

## A correção proposta (migração nova)

1. **O lote novo começa no mês seguinte à última cobrança que não foi
   cancelada**, e nunca antes do mês atual (regra R7, que já existe).
   - Sem suspensão nada muda: a última cobrança válida é o fim do lote
     anterior.
   - Depois de uma suspensão, o lote recomeça do mês em que o tratamento foi
     retomado, sem cobrar os meses parados.
   - A renovação pela ficha ("Renovar" do aviso de lote terminando) segue
     igual.
2. **A janela "Emitir novas mensalidades"** passa a dizer o mês em que o lote
   novo vai começar, pela mesma regra. Hoje ela diz "O lote novo começa no mês
   seguinte ao último deste".
3. **A régua:** teste da regra (mês de início com e sem suspensão) e ensaio no
   treino: suspender, retomar, emitir, conferir o primeiro mês.
4. **Coordenação:** a sessão do Asaas mexe nas mensalidades da ortodontia
   (4018). Antes de escrever, confiro com ela se a 4018 ou alguma depois
   recriou a função do lote, para partir da versão certa.

## O que a equipe percebe (manual)

A janela de emitir mensalidades mostra o mês de início certo depois de uma
retomada. Atualizo a seção de Ortodontia do manual, o changelog e o Word.

## Antes de começar: uma consulta na produção (só leitura)

Casos em que um lote começou depois de um buraco sem cobrança válida:

```sql
select c.code, b.seq, b.first_month,
       (select max(ch.reference_month) from public.ortho_charges ch
         where ch.case_id = c.id and ch.status <> 'cancelada'
           and ch.reference_month < b.first_month) as ultima_valida_antes
from public.ortho_billing_batches b
join public.ortho_cases c on c.id = b.case_id
where b.seq > 1
order by c.code, b.seq;
```

Se algum lote começa muito depois da última cobrança válida, o caso precisa de
uma arrumação à mão. Mostro a lista e você decide caso a caso.

## Decisão sua

- **D1:** ao retomar no meio do mês, o mês da retomada é cobrado? Recomendo
  que sim, porque é a regra de hoje para o primeiro lote (nunca antes do mês
  atual) e o paciente volta a ser atendido naquele mês.

## Tamanho

Pequeno. Uma migração (você roda na produção) e o push só depois dela.

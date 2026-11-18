# AP180 — Contrato assinado pela ficha não fecha a venda (prioridade média)

**Situação:** plano para o dono aprovar. Nada foi mudado ainda.

## O problema, em uma frase

Quando o contrato é enviado pela aba Documentos da ficha, e não pelo Fechamento
da negociação, a assinatura não marca "Contrato assinado" na venda, e o
Fechamento ainda se recusa a mandar de novo.

## O que foi visto no treino (17/11/2026)

- O Gerente enviou o kit "Início de tratamento" pela ficha (ASS-000111). A
  janela mostrou o tratamento ligado: "2 procedimentos, R$ 180,00".
- Assinado por todos, a venda **não** marcou "Contrato assinado".
- O Fechamento passou a dizer "Este documento já foi assinado por todos… Não é
  preciso assinar de novo". A saída foi reenviar com motivo, e o paciente teria
  de assinar outra vez.

## A causa

O banco só fecha a venda quando o pacote nasce "da negociação" (origem
`plan_negotiation`). A ficha cria o pacote "do cliente" (origem `client`),
mesmo quando acha a negociação aceita e a usa para preencher o contrato.

## A correção proposta

1. **Prevenir (sem migração):** quando a ficha envia um pacote com contrato ou
   orçamento, e o tratamento ligado é uma **negociação aceita** do paciente, o
   pacote nasce com a origem da negociação. Assim a assinatura fecha a venda
   como pelo Fechamento.
2. **Aproveitar o que já foi assinado (migração nova):** no Fechamento, quando
   o aviso "já assinado" aponta um pacote da mesma negociação e a venda ainda
   não marcou o contrato, aparece o botão **"Usar este pacote no fechamento"**.
   Ele marca "Contrato assinado" pela mesma porta que a assinatura usa, com a
   origem "assinatura digital" e o número do pacote, sem o paciente assinar de
   novo. Só quem pode fechar a venda vê o botão.
3. **A régua:** teste que exige a origem da negociação no envio pela ficha com
   negociação aceita; ensaio no treino do botão do item 2.

## O que a equipe percebe (manual)

- Enviar o contrato pela ficha passa a valer para o fechamento.
- O botão "Usar este pacote no fechamento" no Fechamento.
- Atualizo a seção de Assinaturas e a do Comercial no manual, o changelog e o
  Word.

## Antes de começar: uma consulta na produção (só leitura)

Pacotes assinados pela ficha com contrato de uma negociação cuja venda não
marcou o contrato:

```sql
select p.number, p.completed_at::date as assinado_em
from public.signature_packages p
join public.commercial_sales s
  on s.negotiation_id = (p.cover_data ->> 'negotiation_id')::uuid
where p.status = 'signed'
  and p.origin_type = 'client'
  and not s.contract_signed;
```

Se aparecer algum, o botão do item 2 resolve, pela tela.

## Decisão sua

- **D1:** faço os dois itens, prevenir e aproveitar? Recomendo os dois. Só o
  item 1 não resolve quem já assinou pela ficha.

## Tamanho

Médio. O item 1 é só código; o item 2 tem uma migração pequena (a porta do
botão).

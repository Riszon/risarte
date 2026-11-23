# A 4026 na produção, passo a passo

A 4026 faz o riSZon **reconhecer o pagamento no cartão de débito**: a tarifa e o prazo do débito na baixa, a correção do split na hora e, quando a correção não sai, o crédito da unidade na cobrança mensal. Na Central, o item "Débito desabilitado" vira "Cartão de débito conferido".

**O débito continua desabilitado no painel do Asaas de todas as unidades** até a prova de R$ 10,00 passar.

**Arquivos:**
- a migração: `supabase/migrations/4026_asa4_pagamento_no_debito.sql`
- o desfazer: `docs/asaas/desfazer-4026.sql` (provado no treino com as funções em quebra de linha do Windows)

## Passo 1 — A migração

No SQL Editor da produção, rode a `4026_asa4_pagamento_no_debito.sql` **inteira, de uma vez**. A última linha é a conferência:

| Coluna | Esperado |
|---|---|
| `funcoes_trocadas` | **11** |
| `gatilhos` | **2** |
| `contas` | **3** |
| `na_lista` | **true** |
| `repasses_liberados` | **true** |

Se der erro no meio, nada fica gravado. Me mande a mensagem.

## Passo 2 — O código

Com o seu "pode", eu levo a 0.490.0 ao `main` e confiro de fora.

## Passo 3 — A prova de R$ 10,00

Só depois dos passos 1 e 2. Eu aviso antes, digo o que vai acontecer e espero o seu "pode".

## Se precisar desfazer

Rode `desfazer-4026.sql` inteiro. Conferência: `funcoes_com_a_4026 0 · migracoes_na_lista 31`.

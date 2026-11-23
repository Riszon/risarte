# A 4027 na produção, passo a passo

A 4027 deixa o banco aceitar o **cartão à vista em 1× na venda direta** (OC-00020). O paciente paga pelo link do Asaas e escolhe crédito ou débito na fatura. A tela e o servidor (0.491.0) tiram o desconto à vista automático do cartão.

**Arquivos:**
- a migração: `supabase/migrations/4027_asa4_cartao_a_vista_na_venda_direta.sql`
- o desfazer: `docs/asaas/desfazer-4027.sql` (provado no treino com a função na quebra de linha do Windows)

## Passo 1 — A migração

No SQL Editor da produção, rode a `4027_asa4_cartao_a_vista_na_venda_direta.sql` **inteira, de uma vez**. A última linha é a conferência:

| Coluna | Esperado |
|---|---|
| `funcao_trocada` | **1** |
| `na_lista` | **true** |

Se der erro no meio, nada fica gravado. Me mande a mensagem.

## Passo 2 — O código

Com o seu "pode", eu levo a 0.491.0 ao `main` e confiro de fora. Antes do código, a tela antiga continua sem oferecer o cartão em 1×: a migração sozinha não muda nada para quem usa.

## Se precisar desfazer

Volte o código para a 0.490.0 primeiro (senão a tela oferece o que o banco recusa). Depois rode `desfazer-4027.sql` inteiro. Conferência: `funcao_com_a_4027 0 · migracoes_na_lista 32`.

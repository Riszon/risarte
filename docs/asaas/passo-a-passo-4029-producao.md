# A 4029 na produção, passo a passo

A 4029 cria uma coluna na venda direta (e a função que a grava) para guardar **o combinado no cartão à vista: débito ou crédito**. O caixa (0.497.0) passa a ter os botões "Débito" e "Crédito à vista" e grava ali a escolha. O meio que o paciente usou de verdade continua vindo do Asaas.

**Arquivos:**
- a migração: `supabase/migrations/4029_asa4_combinado_no_cartao_a_vista.sql`
- o desfazer: `docs/asaas/desfazer-4029.sql` (provado no treino: aplica, desfaz, reaplica, roda de novo)

## Passo 1 — A migração

No SQL Editor da produção, rode a `4029_asa4_combinado_no_cartao_a_vista.sql` **inteira, de uma vez**. A última linha é a conferência:

| Coluna | Esperado |
|---|---|
| `coluna` | **1** |
| `porta` | **true** |
| `na_lista` | **true** |

Se der erro no meio, nada fica gravado. Me mande a mensagem.

**Risco:** baixo. É uma coluna nova, vazia nas vendas que já existem, e uma função nova que só grava essa coluna (quem pode é quem já fecha a venda direta). Nenhuma função existente muda. A tela atual (0.496.0) não lê nem grava essa coluna.

## Passo 2 — O código

Com o seu "pode", eu levo a 0.497.0 ao `main` e confiro de fora. A 0.497.0 também funciona sem a coluna (a escolha só não fica gravada), mas a ordem é a de sempre: a migração primeiro.

## Se precisar desfazer

Volte o código para a 0.496.0 primeiro. Depois rode `desfazer-4029.sql` inteiro. Conferência: `coluna 0 · porta 0 · migracoes_na_lista 34`. O desfazer **apaga o combinado** gravado nas vendas.

# A 4025 na produção, passo a passo

A 4025 deixa a **conta Asaas da RisLife só para quem a cadastrou** (você). O Edson (Admin Master) e o André (Financeiro da Franqueadora) deixam de ver o cadastro, a carteira, as conferências, o levantamento, o histórico e a auditoria dela, e só você liga ou muda o Empresarial pelo Asaas. As cobranças do Empresarial continuam visíveis como antes.

**Arquivos:**
- a migração: `supabase/migrations/4025_asa5_conta_da_rislife_restrita.sql`
- o desfazer: `docs/asaas/desfazer-4025.sql` (provado no treino)

## Passo 1 — A migração

No SQL Editor da produção, rode a `4025_asa5_conta_da_rislife_restrita.sql` **inteira, de uma vez**. A última linha é a conferência:

| Coluna | Esperado |
|---|---|
| `contas_restritas` | **1** (a conta real da RisLife) |
| `regras_com_a_trava` | **3** |
| `funcoes_com_a_trava` | **6** |
| `na_lista` | **true** |

Se der erro no meio, nada fica gravado. Me mande a mensagem.

## Passo 2 — O código

Com o seu "pode", eu levo a 0.489.0 ao `main` e confiro de fora.

## Se precisar desfazer

Rode `desfazer-4025.sql` inteiro. Conferência: `funcoes_com_a_trava 0 · migracoes_na_lista 30`.

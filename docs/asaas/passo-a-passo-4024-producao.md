# A 4024 na produção, passo a passo

A 4024 faz a **antecipação automática ligada deixar de travar** a unidade: vira alerta na Central, com a explicação. A regra do dinheiro não muda (a taxa da antecipação sai antes do split; a diferença da taxa da rede vira conta a pagar da unidade).

**Arquivos:**
- a migração: `supabase/migrations/4024_asa7_antecipacao_vira_alerta.sql`
- o desfazer: `docs/asaas/desfazer-4024.sql`

## Passo 1 — A migração

No SQL Editor da produção, rode `4024_asa7_antecipacao_vira_alerta.sql` **inteiro, de uma vez**. A última linha é a conferência:

| Coluna | Esperado |
|---|---|
| `item_novo` | **1** |
| `item_antigo` | **0** |
| `aviso_novo` | **true** |
| `na_lista` | **true** |

Se der erro no meio, nada fica gravado. Me mande a mensagem.

## Passo 2 — O código

Com o seu "pode", eu levo a 0.488.0 ao `main` e confiro a versão de fora.

## Passo 3 — Cambé

A marca de "Pronta para cobrar" de Cambé **foi desmarcada à mão** em 20/11/2026 às 17h09 (não foi a antecipação). Depois da 4024: na Central › Cambé › Conta e tarifas, use **Verificar agora** (o riSZon lê a antecipação no Asaas) e **marque como pronta** de novo.

## Se precisar desfazer

Rode `desfazer-4024.sql` inteiro. Conferência: `item_antigo_de_volta 1 · migracoes_na_lista 29`.

# Suíte e ensaios do Asaas depois de juntar o `main` 0.478.0 (17/11/2026)

**Branch:** `feat/asaas-integration`, com o `main` em 59653654 (venda direta v3, 0.478.0). O Asaas fica com a **0.479.0**; as evidências do Asaas viraram **EV-381 a EV-383**. A 0.478.0 e a EV-377 já eram da venda direta, e a Jornada do Cliente ficou com a 0.480.0, a EV-380 e a 0427.

## A suíte inteira

**4887 testes passaram, 0 falharam** (33 pulados: os de sandbox, que só rodam com chave). tsc limpo.

## Os ensaios do Asaas, no treino, cada um numa transação desfeita

| Ensaio | Resultado |
|---|---|
| ASA0 — fundação (4000–4002) | 63/63 * |
| ASA1 entrega 1 (4003) | 25/25 |
| ASA1 entrega 2 (4004) | 91/91 * |
| ASA2 entrega 1 (4005) | 63/63 * |
| ASA2 entrega 2 (4006) | 47/47 |
| ASA2 entrega 3 (4007) | 78/78 |
| ASA3 entrega 1 (4008) | 53/53 * |
| ASA3 entrega 2 (4009) | 76/76 * |
| **ASA3 entrega 3 (4010) — Repasses da franquia** | **55/59: achou um defeito real (abaixo)** |
| ASA4 meios (4011) | 60/60 * |
| ASA4 gatilhos (4012) | 44/44 * |
| ASA4 cartão parcelado (4013) | 34/34 * |
| ASA4 devolução e contestação (4014) | 31/31 * |
| ASA4 forma 2 (4015) | 42/42 * |
| 4015a | 13/13 |
| ASA4 renegociação (4017) | 73/73 * |
| 4017a | 39/39 |
| ASA4 mensalidades (4018) | 54/54 |
| 4018a | 7/7 |
| 4018b | 6/6 |
| ASA4 distrato (4020) | 64/64 |
| **4020a** | **38/38** |
| **ASA6 cobrança mensal (4021)** | **106/106** |
| **ASA6 conferência das taxas (4021a)** | **28/28** |

\* **Ensaio ajustado hoje: só o roteiro do ensaio mudou, nenhuma linha do sistema.** Eram ensaios antigos que tinham envelhecido com os dados e as regras novas do treino:
- **ASA0 e 4015:**
  - o Gerente de teste passou a gerir Cambé e Londrina (para o seu teste de Cambé e para a prova da 4020a);
  - desde a 4005, o Admin Master lê os avisos brutos ("Avisos com erro").
- **ASA1:** desde a 4011, a venda direta nova só aceita baixa à mão em dinheiro e permuta. O ensaio passou a montar uma venda antiga.
- **ASA2:** o resumo das vencidas é um por conta e por dia, e a rotina de verdade já tinha mandado o de hoje.
- **ASA3, entregas 1 e 2:**
  - o ensaio pegava parcelas reais de Londrina que hoje são de dinheiro e permuta, e essas nunca viram cobrança, por regra;
  - a multa e os juros tinham os seus valores de exemplo.
- **4011 a 4017:** esses ensaios reaplicam migrações antigas, e os CHECKs antigos já não aceitam os dados criados depois (o "encerrada" da 4017a, as origens novas do pacote de assinatura). Dentro da transação desfeita, o CHECK reaplicado entra "not valid": ele continua valendo para as linhas novas.
  - **Na produção, nenhuma migração é reaplicada**, então isso não a afeta.

## O defeito real: a taxa retida da mensalidade não entra no razão

**O que o ensaio achou:**
- Nas mensalidades do PPR+ e da Ortodontia pagas pelo Asaas com split (as provas do sandbox de 15 e 16/11 em Londrina), as **16 linhas de taxa retida** (R$ 90,80) estão marcadas como retidas.
- Mas elas **não têm o lançamento no razão**: falta a despesa de taxa da unidade (`split_retained`) e a receita da franqueadora (`split_retained_revenue`).
- **Os R$ 90,80 são exatamente a diferença** do ensaio entre "o devido do mês" e "o retido no razão + a conta a pagar".

**A causa:**
- Na mensalidade, o aviso do split liquidado chega **antes** da baixa que cria as linhas de taxa.
- A linha nasce "retida" (pelo gatilho da 4018), mas o lançamento no razão só é feito pela conferência do split, que roda no aviso. Nesse momento ainda não havia linha (4018a). **Depois, nada lança.**
- **Na parcela comum, isso não acontece:** a linha existe antes do aviso.

**Onde está:**
- **Na produção, a 4018 e a 4018a já rodaram, então o defeito está lá.** Hoje ele não tem efeito, porque nenhuma unidade tem conta Asaas nem mensalidade pelo Asaas.
- Ele afetaria o **piloto**: o DRE da unidade sem a despesa da taxa e o da franqueadora sem a receita.
- **O que não afeta:**
  - a cobrança mensal (4021), porque a linha retida não é cobrada de novo;
  - a Conferência das taxas (4021a), que olha as linhas, não o razão.

**A correção proposta (migração 4018c, pequena):**
1. Quando a linha de taxa **nasce retida**, o riSZon lança na hora a despesa da unidade e a receita da franqueadora (a mesma função que a parcela comum já usa).
2. As linhas retidas que já existem sem lançamento ganham o lançamento: 16 no treino; **na produção, a conferência deve dar 0**.
3. O ensaio da 4010 volta a fechar, e o da 4018 ganha a conferência "a taxa retida da mensalidade está no razão".

**O risco:**
- Ela lança no razão, em mês aberto, só as linhas retidas sem lançamento.
- Linha de mês fechado vai pelo ajuste no mês aberto, como na 4021.

**Como desfazer:** um `desfazer-4018c.sql`, que tira o gatilho novo. Os lançamentos ficam: eles corrigem o razão.

**A 4018c entra antes da 4020a na produção**, uma por vez, na ordem das respostas (`respostas-antes-do-pode-4021.md`, item 3).

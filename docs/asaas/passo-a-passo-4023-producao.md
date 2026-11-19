# A 4023 na produção, passo a passo (para quando houver o "pode")

A 4023 (ASA5, o Empresarial pelo Asaas) **não liga nada**: o Empresarial continua desligado do Asaas até alguém informar a data de início na Central (Rede › Empresarial). Ela cria as regras, as telas e as travas, e tira o legado vazio.

**Arquivos:**
- consulta prévia (só lê): `docs/asaas/consulta-previa-4023.sql`
- a migração: `supabase/migrations/4023_asa5_empresarial_pelo_asaas.sql`
- o desfazer: `docs/asaas/desfazer-4023.sql` (provado no treino: `0 · true · true · 28`)

---

## Passo 1 — A consulta prévia (só lê)

No SQL Editor da produção, rode `consulta-previa-4023.sql` inteiro. Me mande a linha.

| Coluna | Esperado | Se vier diferente |
|---|---|---|
| `producao_ligada` | **false** | Pare e me avise. |
| `a_4022_esta_ai` | **true** | Pare: falta a migração anterior. |
| `a_4023_ja_rodou` | **false** | Pare: já rodou. |
| `legado_avisos` | **0** | Pare: o legado tem dado (a 4023 pararia sozinha). |
| `legado_ids` | **0** | Pare (idem). |
| `regras_que_viram_100` | **0** (o levantamento deu 0) | Me avise: essas regras viram 100% RisLife na implantação, com registro na auditoria. |
| `titulares_com_outro_pagador` | **0** (o levantamento deu 0) | Me avise: eles passam a aparecer como pendência (falta e-mail ou celular). |
| `ancora_do_aviso` | **true** | Pare: a função do aviso mudou desde a 4021. |
| `ancora_do_funil` | **true** | Pare: a trava do funil mudou desde a 1041. |

## Passo 2 — A migração (só com o seu "pode", depois do passo 1)

No SQL Editor, rode `4023_asa5_empresarial_pelo_asaas.sql` **inteiro, de uma vez**. A última linha é a conferência:

| Coluna | Esperado |
|---|---|
| `tabelas_novas` | **3** |
| `desligado` | **true** |
| `ramo_do_aviso` | **true** |
| `legado_fora` | **true** |
| `implantacao_fora_de_100` | **0** |

Se der erro no meio, nada fica gravado. Me mande a mensagem.

## Passo 3 — Eu confiro de fora

Com o resultado do passo 2, eu confiro, sem login, que as portas novas barram quem não está logado (401) e que a página `/relatorio-do-mes/` com um código errado não mostra nada.

## Passo 4 — O código (só com o seu "pode", no mesmo dia)

Até o código entrar, a produção mostra a versão anterior, e o Empresarial funciona como hoje (as telas antigas não usam as funções novas).
1. Eu junto o `main` na branch do Asaas e confiro as versões com a sessão do Empresarial.
2. Eu rodo a suíte inteira e o ensaio.
3. Com o seu "pode", eu levo ao `main`, e a Vercel publica. Eu confiro a versão de fora.

## Passo 5 — Você confere no painel do Supabase

Em **Edge Functions**, a função `asaas-webhook` não pode aparecer (o código dela saiu; ela nunca foi publicada, mas a conferência é sua).

## O que NÃO fazer agora

- **Não informe a data de início** na Central › Rede › Empresarial antes de:
  - a conta Asaas da RisLife na produção, com a chave mínima, o termo assinado, o débito desabilitado e o webhook (aba Conta e tarifas);
  - a cláusula dos dois emissores no modelo de contrato (Empresarial › Configurações, texto seu);
  - o interruptor de produção e o roteiro da homologação (`docs/asaas/roteiro-homologacao.md`).

## Se precisar desfazer

Rode `desfazer-4023.sql` inteiro. Conferência: `funcoes_restantes 0 · aviso_como_antes true · funil_como_antes true · migracoes_na_lista 28`.
- Tira as funções, o gatilho e a regra de leitura; devolve o aviso do Asaas e a trava do funil como eram; solta as duas regras novas; devolve o legado **vazio**.
- As tabelas e as colunas novas ficam, com o que tiver sido gravado: não apaga dado.
- Cobrança do Empresarial viva no Asaas continua viva lá: cancele no painel do Asaas antes, se for o caso.

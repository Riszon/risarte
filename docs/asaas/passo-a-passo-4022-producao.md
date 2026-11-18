# A 4022 na produção, passo a passo (18/11/2026)

A 4022 (ASA7, as peças do piloto) **não liga nada**: o interruptor de produção continua desligado, e nenhuma unidade passa a cobrar. Ela cria as telas e as regras de antes do piloto.

**Arquivos:**
- consulta prévia (só lê): `docs/asaas/consulta-previa-4022.sql`
- a migração: `supabase/migrations/4022_asa7_pecas_do_piloto.sql`
- o desfazer: `docs/asaas/desfazer-4022.sql` (provado no treino: `0 · 8`)

---

## Passo 1 — A consulta prévia (só lê)

No SQL Editor da produção, rode `consulta-previa-4022.sql` inteiro. Me mande a linha.

| Coluna | Esperado | Se vier diferente |
|---|---|---|
| `unidades_prontas_hoje` | **0** | **Pare e me avise.** Cada unidade pronta perde a marca com a 4022 e para de emitir até ter o débito marcado, o levantamento feito e a nova marcação (passo 5). |
| `nomes_das_prontas` | vazio | (as que perderiam a marca) |
| `producao_ligada` | **false** | Pare. |
| `contas_producao` | **0** | Pare. |
| `contas_sandbox` | qualquer | só informativo |
| `a_4021a_esta_ai` | **true** | Pare: falta a migração anterior. |
| `a_4022_ja_rodou` | **false** | Pare: já rodou. |
| `pasta_ja_existe` | **false** | Pode seguir (a 4022 não recria a pasta), mas me avise. |

## Passo 2 — A migração (só com o seu "pode", depois do passo 1)

No SQL Editor, rode `4022_asa7_pecas_do_piloto.sql` **inteiro, de uma vez**. A última linha é a conferência:

| Coluna | Esperado |
|---|---|
| `tabelas_novas` | **3** |
| `producao_ligada` | **false** |
| `migracoes_faltando` | **0** |
| `itens_da_prontidao` | **11** |

Se der erro no meio, nada fica gravado. Me mande a mensagem.

## Passo 3 — Eu confiro de fora

Com o resultado do passo 2, eu confiro, sem login, que as 10 portas novas barram quem não está logado (401) e que as 3 tabelas novas não mostram nada a ele.

## Passo 4 — O código (só com o seu "pode", no mesmo dia)

Até o código entrar, a produção mostra a versão anterior (0.483.0). As telas novas não aparecem, e a conferência noturna das cobranças não roda. Nada quebra: as telas antigas não usam as funções novas.

1. Eu junto o `main` (0.483.0, com a 0429 e a 0430) na branch do Asaas, e a versão passa a **0.484.0** (Asaas 0.22.0).
2. Eu rodo a suíte inteira e os ensaios.
3. Com o seu "pode", eu levo ao `main`, e a Vercel publica. Eu confiro a versão de fora.

## Passo 5 — Só se o passo 1 mostrou unidades prontas

Para cada unidade, na Central, como Admin Master:
1. desabilite o débito no painel do Asaas da unidade e clique em **Marcar: o débito está desabilitado**;
2. clique em **Levantar o que já existe no Asaas** (só lê);
3. clique em **Marcar como pronta para cobrar**.

## O que NÃO fazer agora

- **Não ligue o interruptor de produção.** Faltam a confirmação do Asaas por escrito e as cinco marcas de cobrança na matriz. O roteiro da homologação (`docs/asaas/roteiro-homologacao.md`, parte A) vem antes.

## Se precisar desfazer

Rode `desfazer-4022.sql` inteiro. Conferência: `funcoes_restantes 0 · itens_da_prontidao 8`.
- Ele tira as 16 funções novas e devolve a prontidão de 8 itens (como na 4009).
- As tabelas, as colunas e a pasta ficam, com o que tiver sido gravado: não apaga dado.
- **Se o código 0.484.0 já estiver no ar**, as telas novas somem sozinhas (elas toleram a falta da migração).

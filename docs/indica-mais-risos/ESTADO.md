# Indica +Risos — estado do módulo

Documento de estado do programa de indicação dentro do riSZon. Diretrizes de
produto: `indica-mais-risos-diretrizes.md` (nesta pasta).

- **Schema:** `indica` · **Migrações:** faixa **2000+** · **Versão:**
  `INDICA_VERSION` / `INDICA_MIGRATION` em `src/lib/version.ts`
- **Branch:** `feature/indica-mais-risos` (o `main` publica sozinho; o módulo
  só vai para o `main` quando a IND1 tiver tela testada com a recepção)
- **Testes SQL:** `npm run test:indica` — roda no banco de TREINO, numa
  transação que é desfeita no fim (não deixa rastro)

## Decisões do dono (28/09/2026)

1. Nomes do schema em português, como no documento de diretrizes.
2. O Indica preenche o "Indicado por" do cadastro (`clients.referred_by_client_id`,
   campo do PPR+) quando liga o indicado a um cadastro — só se estiver vazio.
3. O Embaixador **não ganha login**. O portal (IND3) entra por link mágico,
   validado no servidor. O "perfil embaixador" é a função
   `indica.portal_embaixador`, que só a chave de serviço executa.
4. Venda direta (`direct_sales`) não conta como fechamento na 1ª versão.
5. Crédito Risarte no resgate: decidir na IND2 (desconto na negociação ou
   saldo próprio — o financeiro não tem carteira de crédito do cliente).
6. Sorteio: fora do escopo (adiado).

## Ligações com o riSZon

| Indica | riSZon | Regra |
|---|---|---|
| unidade, unidade do custo | `public.clinics` | |
| Embaixador | `public.clients` (1 por cliente) | carteira única na rede |
| indicado | `public.clients` | fica vazio se o cadastro sumir |
| quem pediu / quem converteu / quem fez | `public.profiles` | |
| **Compareceu** | `public.appointments` | avaliação (`evaluation`) com check-in, sem desistência |
| **Fechou** | `public.commercial_sales` (+ `plan_negotiations`) | `closed_at` preenchido (contrato + pagamento) e não cancelada |
| **Fim da carência** | `public.payment_installments` | 1ª parcela `paga`, ou o prazo de carência |
| parceiro do Empresarial | `empresarial.companies` | opcional |
| prêmio da equipe (IND4) | `public.payables` | |

Nenhuma ligação apaga em cascata.

## Fases

| Fase | Situação |
|---|---|
| **IND0 — Fundação** | ✅ entregue em 28/09/2026 (0.1.0, migrações 2000–2002). Aplicada no **treino**; **produção pendente** |
| IND1 — Operação da recepção | a fazer |
| IND2 — Embaixadores e resgates | a fazer |
| IND3 — Automação e portal | a fazer |
| IND4 — Campanhas e equipe | a fazer |
| IND5 — Gestão de rede | a fazer |

## IND0 — o que foi entregue

**Migrações**

- `2000_indica_estrutura.sql` — schema, 15 tabelas, RLS em todas, as duas
  travas do motor (extrato só cresce; indicação só muda pelo motor).
- `2001_indica_configuracao.sql` — 24 parâmetros padrão da rede, 4 níveis,
  leitura em cascata Rede → Unidade (com faixa e trava), regra vigente com
  campanha, a conta dos pontos.
- `2002_indica_motor.sql` — máquina de estados, `criar_embaixador`,
  `registrar_indicacao`, `avancar_status`, `recalcular_nivel`, portal por link
  mágico, visões `v_saldo_embaixador` e `v_funil`.

**Regras presas no banco (e provadas por `npm run test:indica`, 60 conferências)**

- Saldo = soma do extrato; o extrato não aceita update/delete, nem insert fora
  do motor — nem pela chave de serviço, nem pelo SQL Editor.
- Status só muda por `avancar_status`, que valida a sequência, grava o evento e
  lança os pontos com a regra **congelada no registro** (base + campanha). O
  multiplicador de nível é o do momento de cada lançamento.
- 50 pendentes no registro → liberados no comparecimento (+150) → 200 em
  carência no fechamento → liberados na 1ª parcela paga ou no fim do prazo.
  Cancelamento na carência estorna os 200; recusa/expiração estorna o pendente.
- Duplicidade: vence o primeiro registro (telefone, CPF ou cadastro). Trava de
  atribuição vencida expira a indicação antiga na hora de registrar a nova.
- Autoindicação, "já é cliente" (atendimento em 24 meses) e teto de
  conversões em 12 meses.
- Nenhum número no código: parâmetro que falta **falha alto**
  (`INDICA_CONFIG_AUSENTE`).
- RLS: Risartano vê a própria unidade; gestor configura a unidade;
  franqueadora vê a rede; Embaixador só pelo link.

**Espelho nas telas:** `src/lib/indica/status.ts` (rótulos e transições), preso
à migração por `indica-status.test.ts`.

**Ajustes em peças compartilhadas (mínimos e aditivos):**
`scripts/reset-test.mjs` (a limpeza da suíte E2E declara as tabelas do Indica
que apaga junto — medido com `check:alcance`), `scripts/backup-producao.mjs`
(schema `indica` no backup), `src/lib/version.ts` (duas linhas do Indica),
`CLAUDE.md` §0 (faixa 2000+).

### Passos do dono para levar a IND0 à produção

1. Supabase da **produção** → SQL Editor → rodar, nesta ordem, `2000`, `2001`,
   `2002` (o assistente copia cada uma em UTF-8 para a área de transferência).
2. Supabase da **produção** → Project Settings → API → **Exposed schemas** →
   adicionar `indica` → Save. Repetir no **treino**.
3. Nada muda na tela ainda: a IND0 é só a fundação.

### Checklist do que testar na unidade (IND0)

A IND0 não tem tela — o teste da recepção começa na IND1. O que dá para
conferir agora:

1. Depois dos passos acima, rodar `npm run backup:producao` e ver que ele NÃO
   avisa "schema sem acesso: indica".
2. Rodar `npm run test:indica` e ver **0 falha(s)** no fim.
3. No SQL Editor do treino: `select chave, valor from indica.config order by grupo, chave;`
   — conferir os 24 parâmetros contra a seção "Configuração" das diretrizes.
   Se algum padrão estiver diferente do que a rede quer, é aqui que se muda.

## Pendências e notas para a IND1

- ⚠️ **Embed ambíguo:** `indica.indicacoes` tem TRÊS ligações para `profiles`
  (origem, conversão, criado_por). Todo embed de `profiles` a partir dela
  precisa do nome da ligação (`profiles!indicacoes_risartano_origem_id_fkey(...)`).
  Acrescentar a tabela em `embed-ambiguo.test.ts` quando a IND1 criar o
  primeiro embed.
- Faixas da unidade: os pontos por etapa, o benefício do indicado e o limite
  de aprovação do resgate nascem SEM faixa. A franqueadora define a faixa na
  tela de configurações (IND2) antes de liberar para as unidades.
- Conciliação por telefone percorre `clients` sem índice (volume de hoje é
  pequeno). Com a rede crescendo, criar índice por dígitos do telefone.
- Rotinas diárias (expirar trava, liberar carência por prazo, expirar Riso
  Coins, recalcular nível) ficam para a IND3; até lá, as funções já existem e
  a expiração acontece ao registrar a mesma pessoa de novo.

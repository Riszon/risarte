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
| **IND0 — Fundação** | ✅ entregue em 28/09/2026 (0.1.0, migrações 2000–2002). **Aplicada e exposta nos dois bancos** (conferido pela API em 28/09: produção com 24 parâmetros, 4 níveis e o motor respondendo; sem login, recusa; treino com os 24 parâmetros) |
| **IND1 — Operação da recepção** | ✅ entregue em 28/09/2026 (0.2.0, migração 2003). 2003 **aplicada nos dois bancos** (produção conferida pela API em 28/09: visão e funções no lugar; sem login, recusa). Módulo **escondido** (só Admin Master) até o dono ligar a permissão |
| **IND2 — Embaixadores e resgates** | ✅ entregue em 28/09/2026 (0.3.0, migração 2004). 2004 aplicada no **treino**; **produção pendente**. Segue escondido (só Admin) |
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

### Passos do dono para levar a IND0 à produção — ✅ feitos em 28/09/2026

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

## IND1 — o que foi entregue (28/09/2026)

**Decisões do dono:** vai para o `main` **escondido** (a matriz gravada não
tem linha das permissões novas → só o Admin Master vê); aceite **verbal** do
regulamento 2026.1 até o texto definitivo (jurídico/CRO); quando ligar, veem o
módulo recepção, SDR, comercial, gerente, franqueado e rede, e o clínico
(coordenador, dentista, TSB, ASB) só pede e registra pela ficha.

**Telas** (`src/app/(app)/indica-mais-risos/`):

- `/indica-mais-risos` → leva às Indicações (o painel é da IND5).
- `/indica-mais-risos/indicacoes` — **quadro** (uma coluna por etapa, botão
  "Avançar…") e **lista** com filtros (etapa, período, código/nome; unidade na
  visão da rede). Cartão "parada" depois de 3 dias sem movimento.
- `/indica-mais-risos/indicacoes/[id]` — indicado, quem indicou, pontos,
  etapas, extrato da indicação e linha do tempo; botões da próxima etapa.
- **Nova indicação** (janela): busca de quem indica por nome, código,
  CPF, **telefone** ou código pessoal (na rede toda); "Tornar Embaixador(a)"
  com o aceite; conferência de duplicidade **enquanto digita**.
- **Na ficha do cliente:** "Pedi indicação" e "Nova indicação" (o cliente da
  ficha é quem indica).

**Etapas pela tela:** Validar · Ligar à avaliação (escolhe a avaliação na
agenda do indicado; se não há cadastro ligado, procura o cadastro primeiro) ·
Compareceu (exige check-in) · Faltou · Fechou (escolhe a venda fechada) · Não
fechou / Recusar (motivo) · Converter · Cancelar e estornar (só gestor) ·
Expirar (trava vencida).

**Migração 2003:** busca de quem indica (com telefone), Embaixador pelo
código na rede, conferência de duplicidade que nunca devolve dados da pessoa,
`registrar_indicacao` usando a MESMA conferência da tela, visão
`v_indicacoes`, e o extrato visível para quem vê a indicação.

**Permissões:** `modulo.indica` e `acao.indica.indicar` em
`src/lib/permissions.ts` (sem linha no banco = escondido). Para ligar:
Administração → Permissões → "Indica +Risos" e "Pedir e registrar indicação" →
**Restaurar padrão** (liga os papéis combinados). A matriz do treino é cópia
da produção: ligar na produção liga nos dois.

**Provas:**

- `npm run test:indica` — 70 conferências (as 60 da IND0 + 10 da 2003).
- Testes unitários: `indica-erros`, `indica-formato`, `indica-status`.
- **Tela de verdade** (servidor de teste na porta 3100, banco de TREINO,
  contas `@example.com`): admin abre quadro, lista, janela e ficha; recepção
  NÃO vê o módulo nem os botões (escondido funciona); fluxo real tornar
  Embaixador → registrar (+50 pendentes) → validar → recusar (−50), 0 erro no
  console. ⚠️ **Ficaram no treino, de propósito e marcados:** o Embaixador
  `TESTE12` (cliente "Teste do portão 1 (pode ignorar)") e a indicação
  `IND-000025` "Indicado de teste (pode ignorar)", **encerrada (recusada)**.
  Indicação não se apaga (regra do banco).

### Checklist do que testar na unidade (IND1) — no TREINO, como Admin

1. ✅ 2003 na produção (feito em 28/09/2026).
2. No treino, entrar como Admin → menu **Indica +Risos** → quadro vazio com a
   frase "Quem você atendeu hoje e saiu feliz?".
3. Abrir a ficha de um cliente → **Nova indicação** → marcar o aceite →
   **Tornar Embaixador(a)** → aparece o código (ex.: MARIA27).
4. Preencher o indicado com um WhatsApp → ver **"Livre para indicar"**.
   Repetir o mesmo número numa segunda indicação → **"já foi indicada
   (IND-…)"** e o botão fica apagado.
5. Registrar → abre o detalhe com **+50 pendentes**.
6. Cadastrar o indicado em Prontuários e agendar uma **avaliação** → no
   detalhe, **Validar** → **Ligar à avaliação** (procurar o cadastro e escolher
   a avaliação).
7. Tentar **Compareceu** antes do check-in → recusa com a explicação. Fazer o
   check-in no Atendimento → **Compareceu** → **200 disponíveis**.
8. Fechar a venda no Comercial (contrato + pagamento) → **Fechou** → escolher
   a venda → **200 em carência**. **Converter** só depois da 1ª parcela paga.
9. **Pedi indicação** na ficha → registrar o momento e a resposta.
10. Quando estiver bom: Administração → Permissões → **Restaurar padrão** nas
    duas permissões do Indica para abrir à equipe (aí entra o manual).

⚠️ **Antes de ligar para a equipe:** escrever a seção do manual
(`docs/treinamento/manual-treinamento-riSZon.md`) e a novidade em
`src/lib/changelog.ts` (§0c do CLAUDE.md). Hoje não entra porque ninguém da
equipe vê o módulo.

## IND2 — o que foi entregue (28/09/2026)

**Decisões do dono:** Crédito Risarte = **voucher com código** (RIS-XXXX-XXXX);
o consultor aplica como desconto na negociação (Comercial, como hoje) e marca
o voucher como usado no Indica, ligado à negociação. Validade do voucher =
parâmetro `voucher_validade_dias`, padrão **90 dias**. Comercial e Financeiro
não mudaram.

**Telas** (abas no topo do módulo: Indicações · Embaixadores · Resgates ·
Catálogo · Configurações):

- **Embaixadores:** ranking (conversões, saldo, indicações, nome), situação,
  saldo a vencer em 30 dias; **"Quem pedir hoje"** = quem fechou tratamento
  na unidade nos últimos 30 dias e ainda não é Embaixador.
- **Ficha do Embaixador:** saldos, barra até o próximo nível, indicações,
  resgates, extrato completo; **Novo resgate** (com cessão do prêmio),
  **Ajuste manual** e **Mudar situação** (só gestor, com motivo). Link
  pessoal/QR ficam para a IND3 (a página de convite ainda não existe).
- **Resgates:** fila (em aberto / por situação); Aprovar e Recusar (gestor),
  Entregar (gera o voucher e mostra o código), Cancelar (devolve os pontos);
  **Usar voucher** (código + cliente + negociação).
- **Catálogo:** itens (tipo, custo, valor, estoque, parceiro, nível mínimo,
  onde vale, ativo) e parceiros. Rede = franqueadora; unidade = gestor.
- **Configurações:** todos os parâmetros por grupo; a franqueadora grava o
  padrão da rede, **trava** ou define a **faixa**; o gestor ajusta a unidade
  ativa dentro da faixa. Níveis editáveis pela franqueadora. Toda mudança é
  uma versão nova (histórico preservado; regra muda só para o futuro).

**Migração 2004:** tipo `devolucao` no extrato; resgate grava o item e o
valor da época + voucher (validade, uso, negociação); trava de escrita nos
resgates; `ajustar_pontos`, `definir_status_embaixador`, `solicitar_resgate`
(reserva os pontos NA HORA; confere saldo, estoque, nível e unidade; nasce
aprovado até o limite), `mudar_resgate` (aprovar/entregar/recusar/cancelar),
`usar_voucher`; visões `v_embaixadores` e `v_saldo_embaixador` (total
resgatado desconta devoluções).

**Provas:** `npm run test:indica` **94/94** (24 novas: ajuste, catálogo,
resgate, reserva, estoque, nível, cessão, aprovação, devolução, voucher,
validade, uso único, trava, suspensão) — **provado quebrando** (tirar a
reserva derruba 3). Testes unitários `indica-rotulos` (rótulos presos aos
`check` do banco). Tela real no treino: as 4 telas abrem sem erro; cadastro
de item, ajuste, resgate, entrega com voucher (`RIS-UU35-S5EE`) e desativação
do item pela tela; recepção continua sem acesso.

⚠️ **Ficaram no treino, marcados "(teste — pode ignorar)":** item de catálogo
"Crédito R$ 50 (teste…)" (**desativado**), ajuste +1000 e o resgate
`RES-000007` **entregue** do Embaixador `TESTE12`.

⚠️ **AP22 (BACKLOG):** um aviso de hidratação apareceu UMA vez no navegador
durante o roteiro e não se repetiu em três voltas completas. Suspeita: relógio
da barra de cima (núcleo). Não é das telas do Indica (todas abriram limpas).

### Checklist da IND2 — no TREINO, como Admin

1. Rodar a **2004 na produção** (SQL Editor) — o assistente copia.
2. **Catálogo** → Novo item: "Crédito Risarte R$ 100", 1.000 Riso Coins,
   valor 100,00.
3. **Embaixadores** → abrir um Embaixador → **Ajuste manual** +1.000 com
   motivo → aparece no extrato.
4. **Novo resgate** → escolher o item → nasce **aprovado** (abaixo de 2.000)
   e o disponível cai na hora.
5. **Resgates** → **Entregar** → aparece o voucher `RIS-…`.
6. Aplicar o valor como desconto numa negociação (Comercial) → **Usar
   voucher** → código + cliente + negociação. Tentar de novo: recusa.
7. **Configurações** → ver os parâmetros; como franqueadora, definir a faixa
   de `pontos_registro` (ex.: 30 a 80) para liberar as unidades.

## Notas para as próximas fases

- ⚠️ **Embed ambíguo:** `indica.indicacoes` tem TRÊS ligações para `profiles`
  (origem, conversão, criado_por). Todo embed de `profiles` a partir dela
  precisa do nome da ligação. Presa em `embed-ambiguo.test.ts` (IND1); as
  telas buscam os nomes à parte (`nomesDePessoas`).
- Faixas da unidade: os pontos por etapa, o benefício do indicado e o limite
  de aprovação do resgate nascem SEM faixa. A franqueadora define a faixa na
  tela de configurações (IND2) antes de liberar para as unidades.
- Conciliação por telefone percorre `clients` sem índice (volume de hoje é
  pequeno). Com a rede crescendo, criar índice por dígitos do telefone.
- Rotinas diárias (expirar trava, liberar carência por prazo, expirar Riso
  Coins, recalcular nível) ficam para a IND3; até lá, as funções já existem e
  a expiração acontece ao registrar a mesma pessoa de novo.

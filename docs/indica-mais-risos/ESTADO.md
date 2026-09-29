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
| **IND2 — Embaixadores e resgates** | ✅ entregue em 28/09/2026 (0.3.0, migração 2004). 2004 **aplicada nos dois bancos** (produção conferida pela API em 28/09: visões, funções e o parâmetro de 90 dias no lugar; sem login, recusa). Segue escondido (só Admin) |
| **IND3a — Automação e rotinas** | ✅ entregue em 28/09/2026 (0.4.0, migração 2005). 2005 **aplicada nos dois bancos** (treino: gatilhos e rotina conferidos no banco; produção: tabelas e função conferidas pela API em 28/09; o dono conferiu no painel a rotina `indica-rotina-diaria` ativa — 1ª execução 29/09 02:30 — e, por SQL, os 3 gatilhos nas tabelas certas) |
| **IND3b — Convite público, portal e mensagens** | ✅ entregue em 28/09/2026 (0.5.0, migração 2006). 2006 **aplicada nos dois bancos** (produção conferida em 28/09: fila, 9 funções e 10 parâmetros pela API; `risarte.vercel.app/i/…` no ar respondendo "Convite não encontrado"; `/indica-mais-risos` sem login vai para o login). Módulo interno segue escondido; as páginas públicas só abrem com código/link válido |
| **IND4 — Campanhas e equipe** | ✅ entregue em 28/09/2026 (0.6.0, migração 2007). 2007 **aplicada nos dois bancos** (produção conferida pela API em 28/09: 7 funções, 5 parâmetros com as faixas 25/40/50/55, colunas novas; sem login, recusa; o dono conferiu no painel a rotina `indica-rotina-campanhas` ativa, 1ª execução 29/09 02:40). Módulo segue escondido |
| **IND5 — Gestão de rede** | ✅ entregue em 28/09/2026 (0.7.0, migração 2008). 2008 **aplicada nos dois bancos** (produção conferida pela API em 28/09: 5 funções, 5 parâmetros, colunas novas dos alertas, painel respondendo; sem login, recusa; o dono conferiu no painel a rotina `indica-rotina-antifraude`, 1ª execução 29/09 02:50). Módulo segue escondido |

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
botão **↺ "Voltar ao padrão do sistema"** de cada linha (liga os papéis combinados; sem linha no banco a linha aparece desmarcada e o ↺ aparece). A matriz do treino é cópia
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
10. Quando estiver bom: Administração → Permissões → **↺ Voltar ao padrão do sistema** nas
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

1. ✅ 2004 na produção (feito em 28/09/2026).
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

## IND3a — o que foi entregue (28/09/2026)

**Decisões do dono para a IND3:** WhatsApp em **fila manual** (a troca por
provedor é só plugar); endereço público `risarte.vercel.app` **como
parâmetro**; o **aceite LGPD do indicado registrado pela recepção** quando ele
está presente (sem isso, convite pelo link e anonimização em 7 dias); entrega
em duas partes (IND3a e IND3b).

**Gatilhos (2005) — blindados:**

| Acontece no riSZon | A indicação vira |
|---|---|
| Avaliação do indicado marcada (acha pelo cadastro ou, sem cadastro ligado, pelo telefone/CPF — só se houver UMA) | (validada →) **agendada** |
| Check-in da avaliação (inclusive encaixe) | **compareceu** |
| Falta na avaliação ligada | **faltou** |
| Venda fechada (`closed_at`) | **fechou** |
| 1ª parcela paga | **convertida** |
| Venda cancelada na carência | **cancelada** (estorno) |

Se o Indica recusar (ex.: trava vencida), o check-in / a venda / a baixa
acontecem normalmente e a falha vai para `indica.falhas_automacao`, visível em
Configurações → Automação (franqueadora: todas; gestor: as da unidade). Cada
passo automático aparece na linha do tempo como "Automático: …". Os botões
manuais continuam valendo.

**Rotina diária** `indica-rotina-diaria` (pg_cron, 02:30 de Brasília): expira
travas vencidas; converte carência vencida pelo prazo; vence Riso Coins (o que
vence primeiro sai primeiro); recalcula níveis no dia 1; anonimiza indicações
encerradas há mais de 12 meses (parâmetro). Cada execução fica em
`indica.rotinas_execucoes` e aparece em Configurações → Automação.

**Provas:** `npm run test:indica` **111/111** (17 novas: os seis gatilhos,
encaixe, blindagem, rotina completa, idempotência). **Provado quebrando:**
tirar a blindagem do gatilho da agenda faz o próprio CHECK-IN falhar com o erro
do Indica — é exatamente o que a blindagem impede. No treino: gatilhos ativos
e rotina agendada conferidos no banco; todas as telas do módulo abrem limpas.

### Checklist da IND3a — no TREINO, como Admin

1. ✅ 2005 na produção (28/09/2026), rotina e gatilhos conferidos pelo dono.
2. Registrar uma indicação (Nova indicação) só com nome e WhatsApp.
3. Cadastrar o indicado em Prontuários **com o mesmo WhatsApp** e agendar a
   **avaliação** → a indicação vai sozinha para **Agendada**.
4. Fazer o **check-in** no Atendimento → **Compareceu** sozinha.
5. Fechar a venda no Comercial → **Fechou**; dar baixa na 1ª parcela →
   **Convertida**.
6. Configurações → **Automação**: no dia seguinte, a execução das 02:30
   aparece com os números.

## IND3b — o que foi entregue (28/09/2026)

**Páginas públicas (sem login)** — `src/proxy.ts` libera só `/i/`, `/c/` e
`/e/` (com a barra; régua `indica-rotas-publicas.test.ts` reprova `/i` que
abriria `/indica-mais-risos`). Elas falam com o banco por UMA porta,
`src/lib/indica/publico.ts`, que só chama funções públicas (chave de serviço,
devolvem o mínimo):

- **`/i/[código]`** — "Fulano te convidou": nome, WhatsApp, unidade e aceite
  do contato (LGPD). Sem preço, desconto ou gratuidade (ética). Resposta
  **genérica** se a pessoa já foi indicada ou já é paciente (a página não vira
  consulta). Limite diário por código (parâmetro) + campo-isca contra robô.
- **`/c/[token]`** — o indicado aceita o contato (grava canal e IP). Vale uma
  vez; sem aceite em 7 dias, a rotina recusa a indicação e anonimiza.
- **`/e/[token]`** — portal do Embaixador (celular): saldo, nível, "Enviar meu
  convite pelo WhatsApp", copiar link, cadastrar amigo (devolve o convite
  pronto), minhas indicações (só a etapa), trocar Riso Coins, extrato.

**Na equipe:**

- **Nova indicação** pergunta o aceite do indicado: pessoalmente / por
  telefone (grava data e quem registrou) / ainda não (gera o convite).
- **Detalhe da indicação** mostra a situação do aceite e deixa registrar
  depois ("aceitou por telefone/pessoalmente").
- **Mensagens** (aba nova): a fila, com o texto pronto → "Abrir WhatsApp" →
  "Enviada" / "Descartar". Eventos: convite ao indicado, obrigado, compareceu,
  fechou, pontos liberados, pontos a vencer. Modelos editáveis em
  Configurações → Mensagens (rede, e a unidade pode variar).
- **Ficha do Embaixador → Links:** link pessoal para copiar e "Gerar link do
  portal" com envio pelo WhatsApp dele.

**Migração 2006:** parâmetros `url_publica` (vazio = o próprio site),
`termo_lgpd_versao_vigente`, `link_limite_diario_por_codigo` e os 7 modelos
de mensagem; aceite por telefone; convite com hash; fila `indica.mensagens`
com gatilho blindado na linha do tempo; `registrar_indicacao` com aceite ou
convite; funções públicas (`convite_publico`, `registrar_pelo_link`,
`ver_convite`, `aceitar_convite`, `portal_catalogo`, `portal_resgatar`,
`portal_indicar`); rotina diária + aceite vencido e lembrete a vencer.

**Provas:** `npm run test:indica` **135/135** (24 novas) — **provado
quebrando** (tirar a resposta genérica derruba a conferência "a página não vira
consulta de paciente"). Tela real no treino, **sem login**: convite →
obrigado (indicação canal 'link' com aceite), portal com saldo, indicar amigo
→ convite pronto → amigo aceita em `/c/`, fila de mensagens; o módulo interno
continua pedindo login; 0 erro no console.

⚠️ **Embaixador sem telefone no cadastro não recebe mensagens** (não há para
quem mandar — a fila pula, de propósito). A janela "Links" avisa. Ficaram no
treino, marcados "(pode ignorar)": "Link Teste" e "Amigo Portal".

### Checklist da IND3b — no TREINO

1. ✅ 2006 na produção (28/09/2026), conferida.
2. Como Admin: ficha de um Embaixador **com telefone** → **Links** → copiar o
   link pessoal e abrir numa janela anônima (sem login).
3. Preencher o convite com um WhatsApp seu, escolher a unidade, aceitar →
   "Recebemos o seu contato". Em Indicações aparece a nova, canal "Link
   pessoal", com o aceite gravado.
4. **Links → Gerar link do portal** → abrir no celular → ver saldo, indicar um
   amigo, mandar o convite, abrir o convite e aceitar.
5. Aba **Mensagens**: abrir o WhatsApp de uma mensagem, enviar e marcar.
6. Nova indicação com "Ainda não" no aceite → o convite aparece na fila.

## IND4 — o que foi entregue (28/09/2026)

**Decisões do dono (28/09/2026):** faixas das metas com os **valores de 2025
como modelo**; prêmio em dinheiro **só como relatório** para a folha (sem
conta a pagar até o OK do contador); campanha entra **sozinha**, a **mais
vantajosa**; **segmentos de público já** (nível, especialidade do tratamento
do Embaixador e empresa do Empresarial).

**Campanhas** (aba nova):

- **Assistente** com 4 modelos prontos — Riso Coins em Dobro, Traga sua
  Família, Inauguração de Unidade, Maratona de Embaixadores. Os números dos
  modelos são o parâmetro `campanhas_modelos` (editável em Configurações), não
  código.
- Vantagem: multiplicador (não soma com o nível — vale o maior), pontos extras
  por etapa e **bônus por marco** (N-ª conversão dentro da campanha, uma vez).
- **Público:** níveis; **especialidade do tratamento** que o Embaixador fechou
  (procedimentos incluídos nas vendas fechadas e não canceladas dele); **empresa**
  do Risarte Empresarial (`clients.empresarial_company_id`). Vazio = todos.
- **Especialidade-alvo** (opcional): a vantagem no FECHAMENTO só vale se a
  venda do indicado tiver procedimento dessa especialidade; senão o fechamento
  pontua sem a campanha e o motivo fica gravado no lançamento.
- **Situação:** rascunho → agendada/ativa → pausada → encerrada (motivo) →
  apurada. Nasce rascunho; só muda pelos botões (`mudar_campanha`). Depois de
  começar, **só amplia** (gatilho `campanha_protege_regras`: multiplicador e
  extras não caem; público, unidades e começo não mudam) e a versão sobe.
- **Escolha automática** (`_campanha_para`): entre as ativas que valem para a
  unidade e o público, a de maior valor numa conversão completa. Campanha com
  especialidade-alvo perde o empate (a vantagem dela é condicional).
- **Simulador de custo** pelo histórico de 180 dias da unidade (taxas reais de
  comparecimento e fechamento) e **orçamento** com alerta no % configurado
  (`campanha_alerta_orcamento_percentual`, 80) e **esgotado** em 100% (deixa de
  entrar em indicação nova; aumentar o orçamento reabre). Valor do Riso Coin
  para o custo: `valor_riso_coin_centavos` (10).
- Rotina `indica-rotina-campanhas` (02:40): agendada → ativa, fim → encerrada,
  alerta e esgotado de orçamento.

**Equipe** (aba nova):

- **Meta coletiva** por unidade (mês, trimestre ou campanha) com as faixas
  pré-preenchidas pelo `metas_faixas_padrao` (25/40/50/55 conversões; recepção
  e CRC R$ 500/1.000/1.500 e, no Bônus, Super Meta + experiência; demais
  funções voucher R$ 100/200/300). **Trava de qualidade** (comparecimento
  mínimo das indicações do período, padrão 50%).
- Só contam **convertidas** com fechamento no período. **Provisória** a
  qualquer hora; **final** só depois do período e sem fechamento do período
  ainda em carência; uma final por meta (reprovar permite refazer).
- **Aprovação do gestor** congela a lista de premiados (recepção/SDR =
  "Recepção / CRC"; as outras funções = "demais") → **Relatório para a folha**
  (página para imprimir, com totais em dinheiro, vouchers e experiências).
  Apuração só nasce e muda pelas funções (gatilho `apuracao_so_pelo_motor`).
- **Ranking individual** do mês: pedidos, indicações, Embaixadores ativados,
  conversões de origem e de fechamento, taxa.
- Auditoria da franqueadora: escolhe a unidade no topo da Equipe e vê metas,
  apurações e aprovações.

**Configurações:** parâmetros em lista (faixas, modelos) passaram a abrir e
gravar como JSON (antes apareceriam como "[object Object]").

**Provas:** `npm run test:indica` **180/180** (seção 16, 45 novas) — **provado
quebrando** três regras, uma de cada vez: a escolha da mais vantajosa, a
especialidade-alvo e o marco (cada quebra derrubou a sua conferência). A
régua da escolha passou verde na primeira quebra (as campanhas empatavam na
ordem e a certa saía primeiro por acaso) — corrigida para a pior vir primeiro.
Testes unitários `indica-campanhas` (espelho das transições lido do SQL) e
`indica-metas` (faixas de 2025 lidas da migração). Tela real no treino (Admin,
porque o módulo segue escondido): modelo → simulador → rascunho → publicar →
reduzir travado → ampliar (versão 2) → encerrar com motivo; meta com as faixas
de 2025 → apuração provisória → ranking; recepção continua barrada; 0 erro no
console. Ficou no treino, encerrada: a campanha "Riso Coins em Dobro (teste —
pode ignorar)" e uma meta de setembro encerrada.

⚠️ **Achado de passagem (núcleo), AP23 no BACKLOG:** a barra de cima estoura
a largura no celular em todas as telas (544 px em 390). As telas do IND4 não
passam disso.

### Checklist da IND4 — no TREINO, como Admin

1. ✅ 2007 na produção (28/09/2026), conferida.
2. **Campanhas → Nova campanha** → escolher "Riso Coins em Dobro" → marcar só
   a sua unidade → **Simular custo** → **Criar rascunho** → **Publicar**.
3. Registrar uma indicação nova: ela aparece com a campanha e o dobro de
   pontos pendentes.
4. **Editar** a campanha e tentar baixar o multiplicador: o botão trava.
   Aumentar funciona e sobe a versão. **Encerrar** pede motivo.
5. **Equipe → Nova meta**: as faixas vêm com os valores de 2025 → Criar →
   **Apurar agora**. No mês seguinte, **Apuração final** → **Aprovar** →
   **Relatório para a folha**.

## IND5 — o que foi entregue (28/09/2026)

**Decisões do dono (28/09/2026):** custo do programa **gerado e realizado lado a
lado**; alerta de fraude **alto em aberto segura os resgates**; planilha **sem
contato do indicado**; abertura do módulo **preparada, mas quem liga é o dono**.

**Painel** (`/indica-mais-risos`, que antes só redirecionava):
- Filtros que aplicam sozinhos: período, unidade (a franqueadora escolhe; vazio
  = rede inteira) e campanha.
- Cartões com variação sobre o período anterior de MESMO tamanho: indicações,
  comparecimento e fechamento (das registradas no período), conversões e
  receita (pelo fechamento no período, como as metas), % dos clientes novos
  que vieram de indicação, custo e CAC (gerado · realizado) e retorno em %.
- Funil com a perda entre etapas, evolução de 12 meses, destaques (Embaixadores
  e Risartanos), metas da equipe com barra e "ações do dia" (paradas há mais de
  `acoes_parada_dias`, faltaram, resgates aguardando, pontos a vencer,
  alertas em aberto).
- **Custo gerado** = Riso Coins lançados no período (pendente, crédito,
  carência, ajuste, menos estornos) × `valor_riso_coin_centavos` + prêmios de
  equipe aprovados. **Realizado** = resgates entregues (valor do item) +
  prêmios aprovados. Por campanha, o realizado não se aplica (resgate não é de
  campanha). Retorno = (receita − custo) ÷ custo, sobre a RECEITA.

**Relatórios** (aba nova): retorno e custo por unidade ou por campanha (com
"Sem campanha" e Total); coortes (das indicações de cada mês, quantas
compareceram, fecharam, converteram, se perderam ou seguem em andamento).
**Planilhas CSV** (ROI, coortes e indicações do período) para o Excel
brasileiro, **sem nome, telefone, CPF ou e-mail do indicado** (a de indicações
leva código, etapa, datas, unidade, campanha, código do Embaixador e valor);
protegidas contra fórmula injetada; cada download fica na auditoria.

**Antifraude** — `detectar_fraudes` roda às 02:50 (`indica-rotina-antifraude`)
e a franqueadora pode rodar na hora. Sete regras, limites e severidade em
Configurações → Antifraude:

| Regra | Dispara quando | Severidade padrão |
|---|---|---|
| Volume atípico | mais de 5 indicações do Embaixador em 7 dias | média |
| Mesmo contato do Embaixador | e-mail do indicado = e-mail do Embaixador | **alta** |
| Telefone de outra indicação | telefone igual ao de indicação de outro Embaixador | média |
| Registro depois do atendimento | indicado com check-in até 90 dias ANTES da indicação | **alta** |
| Concentração num Risartano | uma pessoa registrou mais de 50% (com mínimo de 4) | média |
| Ciclo fechado | o indicado virou Embaixador e indicou quem o indicou | **alta** |
| Ajustes manuais em excesso | mais de 3 ajustes do mesmo usuário no mês | média |

Um fato vira UM alerta para sempre (chave única): decidido improcedente, não
volta. **Alerta alto em aberto ou em análise segura os resgates** do
Embaixador (pedido novo, aprovação e entrega; recepção e portal), com
mensagem neutra ao Embaixador ("em análise… fale com a unidade"). Os pontos
continuam contando.

**Auditoria** (aba nova): alertas (abertos ou todos) com a explicação, links
para a indicação e o Embaixador, "resgates segurados"; a franqueadora marca
**em análise** e decide **procedente/improcedente com o que foi apurado**;
histórico dos ajustes manuais. O gestor vê os alertas da unidade dele; quem
decide é a franqueadora; a recepção não vê.

**Não cobre (declarado):** endereço igual (a indicação não guarda endereço) e
"responsável financeiro" (sem campo no cadastro). A concentração num
Risartano tende a acusar unidade pequena com uma só recepcionista — por isso é
média e não segura resgate; ajuste o limite em Configurações se virar ruído.

**Provas:** `npm run test:indica` **213/213** (seção 17, 33 novas) — **provado
quebrando** três regras (a trava do resgate por severidade, as perdidas das
coortes e as conversões do painel), cada uma derrubou a sua conferência. A
régua das coortes era fraca na primeira versão (somava um número que eu mesmo
calculo pela diferença) e foi trocada pela contagem direta. Unitários
`indica-painel` (as 7 regras lidas do SQL têm rótulo, descrição e
severidade). Tela real no treino (Admin): painel, filtro sozinho, relatórios,
3 planilhas conferidas sem telefone/e-mail e registradas na auditoria,
conferência antifraude pela tela, decidir alerta (recusa sem motivo, grava com
motivo); recepção barrada nas 3 telas e na planilha (403); 0 erro no console.
Ficou no treino um alerta de teste decidido "(pode ignorar)".

### Checklist da IND5 — no TREINO, como Admin

1. ✅ 2008 na produção (28/09/2026), conferida; rotina `indica-rotina-antifraude` no ar.
2. Abrir **Indica +Risos**: agora abre o **Painel**. Trocar o período e a
   unidade (aplicam sozinhos).
3. **Relatórios** → agrupar por campanha → baixar as três planilhas e abrir no
   Excel (acentos certos, sem telefone).
4. **Auditoria** → **Rodar conferência agora**. Se aparecer alerta, decidir
   com o que foi apurado.

### Para ABRIR o módulo à equipe (quando o dono decidir)

Nada disso foi ligado — decisão do dono ("preparar e esperar"):
1. Produção → Administração → Permissões → linhas **"Indica +Risos"** e
   **"Pedir e registrar indicação"** → botão **↺ (Voltar ao padrão do
   sistema)** → Salvar. O treino é espelho (só consulta): recebe sozinho.
2. Na mesma entrega: colar a seção de `MANUAL-rascunho.md` (nesta pasta) no
   manual (`docs/treinamento/manual-treinamento-riSZon.md`), com as
   evidências, escrever a novidade em `src/lib/changelog.ts`, bumpar
   `APP_VERSION` e rodar `npm run manual:docx` (regra do §0c do CLAUDE.md).

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

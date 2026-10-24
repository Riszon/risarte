# Módulo de Metas e Campanhas (metodologia SMART) — PLANO

*Plano aprovado pelo dono em 23/10/2026, com D1–D9 como propostas.*
*✅ **M1 entregue** em 23/10/2026 (core 0.343.0, migração 0318).*
*✅ **M2 entregue** em 23/10/2026 (core 0.344.0, migração 0319, decisões N1–N7 da §9b). 0318 e 0319 aplicadas no treino e na produção (24/10/2026).*
*✅ **M3 entregue** em 24/10/2026 (core 0.345.0, migração 0320, decisões O1–O7 da §9c). 0320 aplicada no treino; falta a produção.*
*Pedido de origem: mensagem do dono de 23/10/2026 ("Módulo de Metas/campanhas
com a metodologia de metas SMART"). Já estava previsto no `docs/BACKLOG.md`
(FASE 2: "Módulo de Metas/Objetivos/Combinados").*

> ⚠️ **O pedido novo muda uma regra do BACKLOG.** Lá estava escrito: *"criados
> no ambiente Franchising (…) unidades apenas visualizam"*. O pedido de hoje
> diz que **cada unidade também pode definir metas próprias**. Este plano segue
> o pedido de hoje (decisão D1 abaixo confirma).

---

## 1. A ideia em uma frase

**Indicador é código; META é dado.** (A mesma regra que já protege o portão de
certificação, `src/lib/certificacao.ts`.)

- O **indicador** é *o que* se mede ("vendas fechadas em R$", "novos clientes",
  "taxa de inadimplência"). Cada um tem uma consulta própria ao banco, escrita e
  conferida por nós. Ninguém cadastra indicador pela tela — senão alguém criaria
  "atendimentos de urgência por indicação" e o número ficaria em zero para
  sempre, sem a tela explicar por quê.
- A **meta** é *quanto, até quando, de quem e por quê*. Isso sim é configurado
  na tela, por quem tem permissão, seguindo as 5 letras do SMART.

Analogia: o indicador é o **velocímetro** do carro (vem de fábrica, a gente
garante que mede certo); a meta é **o destino e o horário de chegada** que cada
motorista escolhe.

---

## 2. Como o SMART vira tela (o assistente de criação)

A meta é criada num **assistente de 5 passos, um por letra**. Não dá para
publicar uma meta que falhe em alguma letra — o sistema mostra o que falta.

| Letra | Pergunta na tela | O que a pessoa preenche | O que o sistema faz sozinho |
|---|---|---|---|
| **S — Específica** | *O quê, quem e como?* | Nome da meta; **indicador** (do catálogo); **recorte** opcional (ex.: especialidade = Ortodontia; programa = Riso+ Familiar; tipo de agendamento = Avaliação); **abrangência** (rede / unidades); **participantes**; "como vamos fazer" (plano de ação, texto) | Monta a **frase SMART** automaticamente, ao vivo: *"Aumentar a receita de Ortodontia da Unidade Centro para R$ 15.000,00 por mês até 31/03/2027."* |
| **M — Mensurável** | *Qual número diz que chegamos?* | **Valor-alvo** e **direção** (aumentar até / reduzir até / manter acima / manter abaixo); opcional: **Super Meta** (faixas, como no Indica) | Mostra a **linha de base**: o mesmo indicador no período anterior equivalente (ex.: últimos 3 meses), já medido. O alvo pode ser digitado como número ou como "+15% sobre a base" |
| **A — Atingível** | *É realista com o que temos?* | Recursos/apoio necessários (texto); se o alvo for muito acima do histórico, **justificativa obrigatória** | Compara o alvo com o histórico: *"Este alvo é 48% acima da média dos últimos 3 meses (melhor mês já registrado: +22%)."* Selo: realista / desafiador / muito acima do histórico |
| **R — Relevante** | *Por que isso importa agora?* | **Objetivo estratégico** (lista: crescer receita, fidelizar, reduzir custo, saúde financeira, qualidade, expansão de programa, desenvolvimento da equipe) + "por que agora" (texto obrigatório) | — |
| **T — Temporal** | *Até quando?* | **Início** e **fim** (obrigatórios); **periodicidade** (meta única no período, ou mensal recorrente); **marcos intermediários** opcionais (ex.: 1º mês ≥ 20 novos clientes) | Calcula o **ritmo esperado** por dia/semana e, durante a meta, a **projeção**: *"No ritmo atual, termina em 87%."* |

O último passo é a **revisão**: a frase SMART completa, as 5 letras com ✅, e
os botões *Salvar rascunho* / *Publicar*.

**Os três exemplos do dono, como ficariam:**

| Desejo | Meta no sistema |
|---|---|
| "Precisamos melhorar a receita." | Indicador **Receita recebida** · recorte Ortodontia · alvo **R$ 15.000/mês** · periodicidade **mensal** · 01/01 a 31/03 · marco: *1º mês com ≥ 20 novos clientes de Ortodontia* (2º indicador no marco) |
| "Quero vender mais Riso+." | Indicador **Adesões ao Riso+** · recorte plano Familiar · alvo **15 contratos** · até **30/11** |
| "Juntar dinheiro neste ano." | (pessoal — não se aplica ao sistema; serve de exemplo de método na ajuda da tela) |

---

## 3. Quem a meta alcança (abrangência e participantes)

São duas perguntas separadas, porque misturá-las gera confusão:

**3.1 Abrangência — de ONDE os números vêm**

- **Rede toda** (todas as unidades somadas) — só a Franqueadora/Admin cria.
- **Unidades selecionadas** (ex.: as 4 unidades de SP) — só a Franqueadora/Admin.
- **Uma unidade** — a Franqueadora/Admin **ou o Gerente/Franqueado daquela
  unidade** (D1).

**3.2 Participantes — QUEM está na meta**

| Opção | Exemplo |
|---|---|
| Unidade toda (todos os Risartanos das unidades da abrangência) | "Toda a Unidade Centro" |
| Por função | "Recepcionistas e SDRs" (da rede toda ou das unidades escolhidas) |
| Usuários selecionados | "Ana, Bruno e Carla" |
| Combinação | "Consultores Comerciais + a gerente Maria" |

A lista de participantes é **recalculada sozinha** quando o critério é por
função ou por unidade (quem entra na equipe durante a meta entra na meta); na
opção "usuários selecionados" ela é fixa.

**3.3 Meta coletiva ou individual** (o ponto que mais muda o resultado)

- **Coletiva** — um número só, somando todo mundo. "A unidade vende R$ 100 mil."
- **Individual (desdobrada)** — cada participante tem o **seu** alvo e a sua
  barra. O alvo de cada um pode ser **igual para todos** ("cada consultor fecha
  10 vendas") ou **dividido** ("R$ 100 mil divididos entre 4 consultores =
  R$ 25 mil cada", com ajuste manual por pessoa).
- **Ambos** — barra da equipe + barra de cada pessoa.

⚠️ **Meta individual só existe para indicador que sabe QUEM fez.** "Vendas" sabe
(o consultor da negociação); "inadimplência da unidade" não tem dono por
pessoa. O catálogo diz isso em cada indicador (coluna *Por pessoa* abaixo), e o
assistente esconde a opção quando não se aplica — em vez de mostrar uma barra
que ninguém consegue mover.

---

## 4. CATÁLOGO — as metas que o riSZon consegue medir

Levantado **lendo o banco e o código** (não de memória), como manda o §0 do
`CLAUDE.md`. Cada linha diz de onde o número vem.

**Legenda:**
- **Etapa** — em que entrega o indicador fica disponível (seção 8).
- **Por pessoa** — ✅ dá para fazer meta individual; ➖ só coletiva.
- **Tipo** — **Soma** (acumula no período: vendas, cadastros); **Taxa**
  (fotografia/percentual: inadimplência, ocupação, margem).
- **Direção** — ⬆ maior é melhor; ⬇ menor é melhor.

### 4.1 Comercial e receita

| # | Indicador | Como é contado | Fonte no banco | Por pessoa | Tipo | Dir. | Etapa |
|---|---|---|---|---|---|---|---|
| C1 | **Vendas fechadas (R$)** | Valor final das vendas de plano + vendas diretas fechadas no período; canceladas não contam | `commercial_sales` (fechada = contrato + pagamento; `closed_at`, sem `cancelled_at`) + `direct_sales` | ✅ consultor (`plan_negotiations.consultant_id`; venda direta: quem criou) | Soma | ⬆ | M1 |
| C2 | **Vendas fechadas (quantidade)** | Mesmo recorte, contando vendas | idem | ✅ | Soma | ⬆ | M1 |
| C3 | **Ticket médio** | C1 ÷ C2 | idem | ✅ | Taxa | ⬆ | M1 |
| C4 | **Taxa de conversão (apresentação → venda)** | Negociações aceitas ÷ negociações abertas no período | `plan_negotiations` (status) | ✅ consultor | Taxa | ⬆ | M2 |
| C5 | **Receita recebida (caixa)** | Recebimentos válidos no período (sem estorno) | `payment_receipts` (`received_at`, `not reversed`) | ➖ (quem registra é a recepção, não o vendedor) | Soma | ⬆ | M2 |
| C6 | **Receita faturada (competência/DRE)** | Receita bruta − deduções no período | `dre_lines` (blocos receita_bruta, deducoes) | ➖ | Soma | ⬆ | M2 |
| C7 | **Vendas por especialidade (R$)** — ex.: Ortodontia | C1 recortado pelos procedimentos da venda | itens da negociação/venda direta → `procedures.specialty` | ✅ | Soma | ⬆ | M2 |
| C8 | **Desconto médio concedido (%)** | Ajuste negativo ÷ valor de tabela | `plan_negotiations.adjustment_cents` | ✅ consultor | Taxa | ⬇ | M3 |
| C9 | **Vendas canceladas** | Vendas canceladas no período | `commercial_sales.cancelled_at`, `direct_sales` | ✅ | Soma | ⬇ | M3 |

⚠️ **C7 por receita recebida (e não por venda) não existe hoje:** a parcela e o
recebimento não são separados por procedimento. Medir "receita de Ortodontia"
exigiria ratear — proposta: medir **venda** de Ortodontia (C7), que é exato.
Ver decisão D5.

### 4.2 Financeiro e saúde da unidade

| # | Indicador | Como é contado | Fonte | Por pessoa | Tipo | Dir. | Etapa |
|---|---|---|---|---|---|---|---|
| F1 | **Taxa de inadimplência (%)** | Vencido ÷ a receber (canceladas e renegociadas fora) — a mesma conta da tela do Financeiro | `clinic_overdue_rate()` | ➖ | Taxa | ⬇ | M2 |
| F2 | **Valor inadimplente (R$)** | Soma vencida em aberto | idem | ➖ | Taxa | ⬇ | M2 |
| F3 | **Recuperação de inadimplência (R$)** | Recebido de parcelas que já estiveram vencidas (`was_overdue`) | `payment_receipts` + `payment_installments.was_overdue` | ➖ | Soma | ⬆ | M2 |
| F4 | **Margem líquida (%)** | Resultado ÷ receita líquida (DRE) | `dre_lines` + `netMarginPercent` | ➖ | Taxa | ⬆ | M3 |
| F5 | **Margem de contribuição (%)** | Da tela de ponto de equilíbrio | `breakeven_lines` + `buildBreakeven` | ➖ | Taxa | ⬆ | M3 |
| F6 | **Ponto de equilíbrio financeiro atingido** | Receita líquida ÷ ponto de equilíbrio contábil (100% = empatou) — também a versão caixa | `buildBreakeven` (`pontoEquilibrioCents` / `pontoEquilibrioCaixaCents`) | ➖ | Taxa | ⬆ | M3 |
| F7 | **Dia do ponto de equilíbrio** | Em que dia do mês a receita cruza o equilíbrio (meta: "até o dia 20") | `breakevenDay` | ➖ | Taxa | ⬇ | M3 |
| F8 | **Ponto de equilíbrio OPERACIONAL** | ⚠️ **Não existe hoje.** Proposta: *quantos atendimentos (ou horas de cadeira) a unidade precisa fazer no mês para cobrir o custo fixo* = custo fixo ÷ margem de contribuição média por atendimento | cálculo novo sobre F5 + A2 | ➖ | Taxa | ⬆ | M3 (D6) |
| F9 | **Recebimento em dia (%)** | Parcelas pagas até o vencimento ÷ parcelas vencidas no período | `payment_installments` (`paid_at` × `due_date`) | ➖ | Taxa | ⬆ | M3 |

⚠️ **Mensalidade do Riso+ e cobrança do Empresarial não entram no razão
financeiro** (achado deste levantamento): F4–F8 hoje cobrem só venda de plano,
venda direta e taxas da rede. Anotado como achado de passagem (seção 10).

### 4.3 Agenda e atendimento

| # | Indicador | Como é contado | Fonte | Por pessoa | Tipo | Dir. | Etapa |
|---|---|---|---|---|---|---|---|
| A1 | **Agendamentos realizados (marcados)** | Agendamentos criados no período, por tipo (avaliação, início, retorno…) | `appointments` (`created_at`, `created_by`, `type`) | ✅ quem agendou | Soma | ⬆ | M1 |
| A2 | **Atendimentos concluídos** | Agendamentos concluídos no período, por tipo | `appointments` (`attendance='done'` ou `status='completed'`) | ✅ profissional (`provider_user_id`) | Soma | ⬆ | M1 |
| A3 | **Avaliações realizadas** | A2 com tipo = Avaliação (porta de entrada da Jornada) | idem | ✅ | Soma | ⬆ | M1 |
| A4 | **Taxa de comparecimento (%)** | Concluídos ÷ (concluídos + faltas) | `appointments.status` (`no_show`) | ✅ quem agendou | Taxa | ⬆ | M1 |
| A5 | **Taxa de faltas (%)** | O inverso de A4 | idem | ✅ | Taxa | ⬇ | M1 |
| A6 | **Ocupação da cadeira (%)** | Horas trabalhadas ÷ horas-cadeira possíveis (fechamentos descontados) — **a mesma conta do Planejamento Anual da agenda** | `horas-da-agenda.ts` (`horasPossiveis`, `ocupacao`) | ➖ | Taxa | ⬆ | M3 |
| A7 | **Tempo ocioso da cadeira (horas ou %)** | Horas-cadeira possíveis − horas trabalhadas | idem | ➖ | Taxa | ⬇ | M3 |
| A8 | **Check-ins na recepção** | Chegadas registradas | `appointments.checked_in_by/_at` | ✅ | Soma | ⬆ | M1 |
| A9 | **Retornos/reavaliações agendados** | A1 com tipo Retorno/Reavaliação (Fase 6–7) | `appointments.type` | ✅ | Soma | ⬆ | M1 |

### 4.4 Clínico e produção

| # | Indicador | Como é contado | Fonte | Por pessoa | Tipo | Dir. | Etapa |
|---|---|---|---|---|---|---|---|
| P1 | **Procedimentos executados (quantidade)** | Sessões concluídas no período; recorte por procedimento ou especialidade | `treatment_sessions` (`done`, `done_at`) / `provider_payouts` (`accrual_date`) | ✅ dentista executor | Soma | ⬆ | M1 |
| P2 | **Produção do dentista (R$)** | Valor de repasse congelado das sessões concluídas | `provider_payouts.amount_cents` | ✅ | Soma | ⬆ | M2 |
| P3 | **Planos de tratamento aprovados** | Planos aprovados pelo Coordenador no período | `treatment_plans` (`reviewed_at`) / `treatment_plan_status_events` | ✅ planner | Soma | ⬆ | M2 |
| P4 | **Tratamentos concluídos** | Clientes que concluíram o plano (passaram à Fase 6) | `journey_phase_history` | ➖ | Soma | ⬆ | M3 |

### 4.5 Clientes e Jornada

| # | Indicador | Como é contado | Fonte | Por pessoa | Tipo | Dir. | Etapa |
|---|---|---|---|---|---|---|---|
| J1 | **Novos clientes** | Clientes cadastrados no período; recorte por origem (unidade / Empresarial / Riso+) | `clients` (`created_at`, `created_by`, `origin_program`) | ✅ quem cadastrou | Soma | ⬆ | M1 |
| J2 | **Novos clientes que avaliaram** | J1 que tiveram avaliação concluída no período (qualidade do cadastro) | `clients` + `appointments` | ✅ | Soma | ⬆ | M2 |
| J3 | **Conversão da Jornada (avaliação → venda)** | Clientes avaliados que fecharam venda | `journey_phase_history` | ➖ | Taxa | ⬆ | M3 |
| J4 | **Reativação de inativos** | Clientes inativos que voltaram a ter atendimento | `clients.status` + `appointments` | ➖ | Soma | ⬆ | M3 |

> **Não dá para medir hoje:** *origem de marketing* do cliente (Instagram,
> Google, indicação…) — não existe campo; e **NPS/satisfação** — decidido no
> passado, nunca implementado. Ficam fora do catálogo até existirem.

### 4.6 Programas da Risarte

| # | Indicador | Como é contado | Fonte | Por pessoa | Tipo | Dir. | Etapa |
|---|---|---|---|---|---|---|---|
| G1 | **Adesões ao Riso+ (Programa de Prevenção)** | Adesões **ativadas** no período (contrato + 1º pagamento); transferências não contam como nova; recorte por plano (Individual/Familiar) | `ppr_memberships` (`activated_at`, `sold_by`, sem `transferred_from_id`) | ✅ quem vendeu | Soma | ⬆ | M1 |
| G2 | **Cancelamentos do Riso+** | Adesões canceladas no período | `ppr_memberships.cancelled_at` | ➖ | Soma | ⬇ | M2 |
| G3 | **Vidas no Riso+** | Beneficiários ativos (titulares + dependentes) no fim do período | `ppr_beneficiaries` | ➖ | Taxa | ⬆ | M2 |
| G4 | **Indica +Risos — indicações recebidas** | Indicações registradas no período | `indica.indicacoes.registrada_em` | ✅ Risartano de origem | Soma | ⬆ | M2 |
| G5 | **Indica +Risos — indicações convertidas** | Indicações convertidas (`fechou_em`) | `indica.indicacoes` | ✅ Risartano da conversão | Soma | ⬆ | M2 |
| G6 | **Indica +Risos — novos Embaixadores** | Embaixadores cadastrados | `indica.embaixadores.criado_em` | ✅ | Soma | ⬆ | M2 |
| G7 | **Empresarial — empresas que aderiram** | Leads ganhos (CLOSED_WON) / contratos assinados no período | `empresarial.contracts.signed_at`, `commercial_leads` | ✅ consultor RisLife | Soma | ⬆ | M2 (D7) |
| G8 | **Empresarial — vidas incluídas** | Titulares + dependentes incluídos no período | `empresarial.membership_history.started_at` | ➖ | Soma | ⬆ | M2 (D7) |

⚠️ **O Indica +Risos já tem metas próprias** (`indica.metas_equipe`, com faixas
e prêmio em dinheiro que vira relatório para a folha). Este módulo **não
substitui** aquelas — elas são o regulamento do programa, com apuração e
aprovação. Aqui o Indica entra só como **indicador** (G4–G6) para quem quiser
uma meta SMART sobre ele. Ver decisão D8.

### 4.7 Equipe

| # | Indicador | Como é contado | Fonte | Por pessoa | Tipo | Dir. | Etapa |
|---|---|---|---|---|---|---|---|
| E1 | **Certificação concluída (%)** | Participantes certificados ÷ participantes | `training_certifications` | ✅ | Taxa | ⬆ | M3 |
| E2 | **Relatos/sugestões enviados** | Já é indicador da certificação | `system_reports` | ✅ | Soma | ⬆ | M3 |

**Total: 45 indicadores** — 13 na Etapa M1, 17 na M2, 15 na M3.

---

## 5. Situações da meta (o painel)

```
Rascunho ──Publicar──▶ A iniciar ──(chega o início)──▶ Ativa ──(chega o fim)──▶ Finalizada
                          │                             │  ▲                      (Atingida / Super Meta /
                          │                          Pausar Retomar                Não atingida)
                          └──────────── Cancelar (com motivo) ──────────────────▶ Cancelada
```

- **A iniciar → Ativa → Finalizada** acontecem **sozinhas pela data** (não
  depende de ninguém lembrar).
- **Pausar** exige motivo; o tempo pausado **não conta** para o ritmo (decisão
  D4). **Cancelar** exige motivo e é definitivo.
- **Ao finalizar, o resultado é CONGELADO** no banco (fato histórico). Lição do
  portão de certificação: se o resultado fosse recalculado sempre, um estorno em
  fevereiro mudaria uma meta "atingida" de janeiro depois de comemorada.
- **Depois de publicada**, alvo e prazo só mudam com **motivo registrado**, e
  a tela mostra "alvo alterado em 12/11 de 30 para 25 (motivo…)". Meta que se
  pode baixar em silêncio no fim do mês não é meta.

**O painel (`/metas`)** tem cinco abas — **Ativas · A iniciar · Pausadas ·
Finalizadas · Canceladas** — com filtro por unidade, indicador, função e
"minhas metas". Cada cartão mostra:

- Nome + frase SMART resumida; abrangência; participantes;
- **Barra de percentual** realizado, com a marca da Super Meta quando houver;
- **Farol do ritmo**: 🟢 no ritmo · 🟡 atenção · 🔴 atrás (realizado comparado
  com o esperado para o dia de hoje);
- **Projeção** ("no ritmo atual: 87%") e **dias restantes**;
- Valor realizado / alvo ("R$ 11.250 de R$ 15.000").

**Como se calcula o percentual** (também na ajuda da tela):
- *Aumentar até X* (soma): realizado ÷ alvo.
- *Reduzir até X* (ex.: inadimplência de 8% para 5%): quanto já caiu ÷ quanto
  precisava cair → (8 − atual) ÷ (8 − 5). Em 6,5% → 50%.
- *Manter abaixo/acima de X*: % dos dias do período em que ficou dentro.
- A barra para em 100% visualmente; o número mostra o real (ex.: 128%).

**Ao abrir uma meta:** gráfico realizado × esperado ao longo do tempo,
**ranking dos participantes** (quando individual), **quadro por unidade**
(quando a abrangência tem mais de uma), marcos intermediários, plano de ação e
histórico de alterações.

**No Início de cada pessoa:** um cartão "Minhas metas" com as barras das metas
em que ela participa — é aí que a meta estimula, não numa tela que só o gestor
abre.

---

## 6. Quem pode o quê (permissões)

Proposta (ajustável depois em Administração → Permissões, como todo o resto):

| Ação | Quem (padrão) |
|---|---|
| Ver o módulo e as metas em que participa | Todos os Risartanos |
| Ver todas as metas da(s) sua(s) unidade(s) | Gerente, Franqueado, Coordenador |
| Ver todas as metas da rede | Franqueadora/Rede, Admin |
| Criar/editar meta da **rede** ou de várias unidades | Admin, Franqueadora/Rede |
| Criar/editar meta **da própria unidade** | Gerente de Unidade, Franqueado (D1) |
| Pausar / retomar / cancelar | Quem pode editar aquela meta |

⚠️ **Meta financeira e quem vê o número** (D3): uma recepcionista participante
de uma meta de **receita** ou **margem** veria valores que hoje só o
Financeiro vê. Proposta: participante vê **o percentual** sempre; vê o **valor
em R$** só se já tiver acesso ao financeiro daquela unidade.

A trava real fica **no banco** (RLS + funções com guarda, como em todo o
sistema); a tela só esconde o que a pessoa não pode.

---

## 7. Como fica por dentro (para quem constrói)

- **Rota:** `/metas` (painel), `/metas/nova` (assistente), `/metas/[id]`.
  Item "Metas" no menu lateral (ícone `Target`).
- **Migração 0318** (faixa do core):
  - `public.goals` — nome, indicador, recorte (jsonb), abrangência
    (`network`/`clinics`), unidades, direção, tipo (coletiva/individual/ambos),
    alvo, super meta, linha de base, periodicidade, início/fim, os campos
    SMART de texto (como, recursos, justificativa, objetivo estratégico, por que
    agora), situação, motivo de pausa/cancelamento, criado por.
  - `public.goal_participant_rules` — critérios (unidade toda / função / pessoa).
  - `public.goal_targets` — alvo por pessoa (meta individual).
  - `public.goal_milestones` — marcos intermediários.
  - `public.goal_changes` — histórico de alteração de alvo/prazo (motivo).
  - `public.goal_results` — **fotografia** do realizado (diária + final
    congelada), por meta, por pessoa e por unidade.
  - Funções `goal_measure(...)` por indicador, com guarda de unidade
    (`can_read_clinic_data`, e `can_see_clinic_finance` para os financeiros);
    `goal_change_status(...)` para pausar/retomar/cancelar; rotina diária
    (cron) que tira a fotografia e vira A iniciar → Ativa → Finalizada.
  - Termina com `select public.audit_attach_all();` (Regra 9).
- **Catálogo** `src/lib/metas/indicadores.ts` no molde do `INDICADORES` da
  certificação (`chave, rotulo, ajuda, onde, grupo, tipo, direcao, porPessoa,
  unidade (R$/qtde/%), recortes, origem, quando, etapa`), com teste que exige
  que todo indicador do catálogo tenha consulta no banco e vice-versa.
- **Regras puras com teste** (`src/lib/metas/`): percentual por direção, ritmo
  esperado, farol, projeção, frase SMART, selo de "atingível".
- **Leitura que falha não vira zero** (`contagemConfirmada`): se a medição
  falhar, a barra mostra "não foi possível medir agora", nunca 0%.
- **Fuso do Brasil** em todo período (`dates.ts`), e nada de ler mais de 1000
  linhas pela API — a soma é feita no banco.
- Registros obrigatórios: `permissions.ts` (`modulo.metas`,
  `acao.metas.criar_rede`, `acao.metas.criar_unidade`) + linhas na
  `permission_matrix` na própria migração; `quem-esta-online.ts`;
  `screen-rules.mjs` (rota `[id]`); `auditoria-catalogo.ts`; `audit-labels.ts`;
  `version.ts` + `changelog.ts`; **manual** (seção nova) + `npm run manual:docx`.

---

## 8. Etapas de entrega

Cada etapa vai ao ar sozinha e já serve para uso real.

| Etapa | O que entrega |
|---|---|
| **M1 — o módulo funcionando** | Estrutura (0318), assistente SMART completo, abrangência e participantes, coletiva e individual, painel com as 5 abas, barra, farol, projeção, detalhe da meta, cartão "Minhas metas" no Início, situações automáticas por data, resultado congelado. **13 indicadores**: vendas (R$, qtde, ticket), agendamentos, atendimentos, avaliações, comparecimento, faltas, check-ins, retornos, procedimentos executados, novos clientes, adesões ao Riso+ |
| **M2 — dinheiro e programas** | Indicadores financeiros que já têm conta pronta no sistema (receita recebida e faturada, inadimplência, recuperação), vendas por especialidade, conversão, produção do dentista, planos aprovados, Riso+ (cancelamentos, vidas), Indica +Risos, Empresarial. Regra do valor em R$ para quem não vê financeiro (D3) |
| **M3 — eficiência** | Ocupação e tempo ocioso da cadeira, margens, ponto de equilíbrio (financeiro, caixa e o **operacional** novo), dia do equilíbrio, recebimento em dia, desconto, cancelamentos, Jornada, equipe |
| **M4 — engajamento** (opcional) | Notificação ao publicar / ao atingir marco / quando o farol fica vermelho; modelos prontos de meta ("Mês do Riso+", "Meta de Ortodontia"…); comparação entre unidades numa mesma meta de rede ("campeonato"); recompensa descrita na meta (texto — **sem** lançar nada no Financeiro, como o Indica decidiu) |

---

## 9. Decisões para o dono

| # | Pergunta | Proposta |
|---|---|---|
| **D1** | A unidade cria metas próprias? (o BACKLOG dizia que só a Franqueadora cria) | **Sim**: Gerente e Franqueado criam metas da própria unidade; a Franqueadora vê todas |
| **D2** | Meta de rede pode ser **desdobrada** por unidade? ("rede vende R$ 1 milhão = R$ X por unidade") | **Sim**, com ajuste manual por unidade, igual ao desdobramento por pessoa |
| **D3** | Participante sem acesso ao financeiro vê o valor em R$ das metas financeiras? | Vê **só o percentual** |
| **D4** | Tempo pausado conta no prazo? | **Não conta** para o ritmo; o prazo final **não** se estende sozinho (quem quiser estende com motivo) |
| **D5** | "Receita de Ortodontia": medir **venda** de Ortodontia (exato) ou **receita recebida** rateada (aproximada)? | **Venda** (C7) |
| **D6** | Ponto de equilíbrio **operacional** = atendimentos necessários para cobrir o custo fixo. Está certo o conceito? | Confirmar antes da M3 |
| **D7** | Indicadores do **Empresarial** leem o schema de outro projeto (só leitura). Pode? | Sim, só leitura, combinado na sessão do Empresarial |
| **D8** | As metas do Indica +Risos continuam no Indica (com prêmio e apuração)? | **Sim**; aqui o Indica é só indicador |
| **D9** | Começar pela **M1** com os 13 indicadores listados? | **Sim** |

---

## 9b. Plano da etapa M2 — dinheiro e programas (aprovado em 23/10/2026; entregue)

**17 indicadores** (fontes conferidas no banco de treino, migração **0319**):

| # | Indicador | De onde vem | Por pessoa | Tipo |
|---|---|---|---|---|
| C4 | Conversão (apresentação → venda) | negociações abertas no período: aceitas ÷ todas (a mesma conta do painel do Comercial) | ✅ consultor | Taxa |
| C5 | Receita recebida | recebimentos válidos (`payment_receipts`, sem estorno) | ➖ | Soma |
| C6 | Receita faturada (DRE) | receita bruta − deduções, pela própria função da DRE (`dre_lines`) | ➖ | Soma |
| C7 | Vendas por especialidade | recorte novo em Vendas (R$ e quantidade): procedimentos da venda → especialidade | ✅ | Soma |
| F1 | Taxa de inadimplência | `clinic_overdue_rate` — a mesma conta da tela do Financeiro | ➖ | **Fotografia** |
| F2 | Valor inadimplente | idem | ➖ | **Fotografia** |
| F3 | Recuperação de inadimplência | recebido de parcelas que já estiveram vencidas (`was_overdue`) | ➖ | Soma |
| P2 | Produção do dentista (R$) | repasse congelado das sessões concluídas (`provider_payouts`) | ✅ dentista | Soma |
| P3 | Opções de plano aprovadas | aprovação do Coordenador (`treatment_plan_options.review_status`) | ✅ Planner do plano | Soma |
| J2 | Novos clientes que avaliaram | cadastrados no período que já fizeram a avaliação | ✅ quem cadastrou | Soma |
| G2 | Cancelamentos do Riso+ | adesões canceladas no período | ➖ | **Limite** |
| G3 | Vidas no Riso+ | beneficiários ativos hoje | ➖ | **Fotografia** |
| G4 | Indicações recebidas (Indica +Risos) | `indica.indicacoes.registrada_em` | ✅ Risartano de origem | Soma |
| G5 | Indicações convertidas | `indica.indicacoes.fechou_em`, situação convertida | ✅ Risartano da conversão | Soma |
| G6 | Novos Embaixadores | `indica.embaixadores.criado_em` | ✅ quem cadastrou | Soma |
| G7 | Empresas que aderiram (Empresarial) | empresa que entrou em **Fechado (ganho)** no funil | ✅ consultor RisLife | Soma |
| G8 | Vidas incluídas no Empresarial | titulares e dependentes incluídos (`membership_history`) | ➖ | Soma |

**Decisões novas da M2 (propostas):**

| # | Pergunta | Proposta |
|---|---|---|
| N1 | Inadimplência e vidas são **fotografia** (o valor de hoje), não soma. Não existe histórico guardado delas. | O sistema tira **uma foto por dia** a partir da publicação; a linha de base é o valor do dia da criação; o resultado final é o valor do **último dia do prazo**. Só "período inteiro" (não mensal). O gráfico mostra a evolução dia a dia |
| N2 | Cancelamentos do Riso+ é meta de **no máximo**. | A barra mostra **quanto do limite já foi usado** ("3 de 5 cancelamentos"); fica vermelha se passar; atingida se terminar dentro do limite |
| N3 | Receita faturada vem da DRE, que é por período. | Só a barra, sem gráfico dia a dia |
| N4 | Venda com várias especialidades. | Em R$, conta a **parte proporcional** dos procedimentos da especialidade (o desconto é repartido na mesma proporção); em quantidade, conta a venda que tem ao menos um procedimento dela |
| N5 | Receita recebida e recuperação: de quem é o número? | **Só coletiva**: quem registra o recebimento é a recepção, não quem vendeu |
| N6 | Empresarial não usa contrato assinado no sistema. | Adesão = empresa que entrou em **Fechado (ganho)** no funil; unidade = a unidade principal da empresa; só leitura do schema do Empresarial (D7) |
| N7 | Inadimplência em % também é dado financeiro. | Entra na D3: quem não vê o financeiro da unidade vê só o **percentual da meta**, nunca a taxa nem o valor |

## 9c. Plano da etapa M3 — eficiência (aprovado em 24/10/2026; entregue)

**13 indicadores** (fontes conferidas no banco de treino, migração **0320**):

| # | Indicador | De onde vem | Por pessoa | Tipo |
|---|---|---|---|---|
| C8 | Desconto médio concedido (%) | desconto ÷ valor de tabela das vendas fechadas (`plan_negotiations.adjustment_cents`, a mesma conta da autorização de desconto) | ✅ consultor | Taxa (reduzir) |
| C9 | Vendas canceladas | vendas de plano e diretas canceladas no período | ➖ | Limite |
| F4 | Margem líquida (%) | lucro líquido ÷ receita líquida — a mesma conta da tela DRE (`dre_lines`) | ➖ | Taxa |
| F5 | Margem de contribuição (%) | a mesma conta da tela Ponto de equilíbrio (`breakeven_lines`) | ➖ | Taxa |
| F6 | Ponto de equilíbrio atingido (%) | receita líquida ÷ ponto de equilíbrio (100% = empatou); recorte contábil ou caixa | ➖ | Taxa |
| F9 | Recebimento em dia (%) | das parcelas que venceram no período, quantas foram pagas até o vencimento | ➖ | Taxa |
| A6 | Ocupação da cadeira (%) | a MESMA conta do Planejamento Anual (horas trabalhadas ÷ horas de cadeira) | ➖ | Taxa |
| A7 | Horas ociosas da cadeira | horas de cadeira − horas trabalhadas, pela mesma conta | ➖ | Limite |
| P4 | Tratamentos concluídos | clientes que entraram na Fase 6 (reavaliação) no período | ➖ | Soma |
| J3 | Conversão da Jornada (avaliação → venda) | dos clientes avaliados no período, quantos % já fecharam venda | ➖ | Taxa |
| J4 | Clientes reativados | cliente atendido no período cujo atendimento anterior foi há mais de N dias | ➖ | Soma |
| E1 | Certificações concluídas | certificados emitidos no período (portão de certificação) | ✅ a pessoa | Soma |
| E2 | Relatos e sugestões enviados | relatos de problema e sugestões registrados | ✅ quem relatou | Soma |

**Decisões da M3 (propostas):**

| # | Pergunta | Proposta |
|---|---|---|
| O1 | Ponto de equilíbrio **operacional** (D6). Em percentual, ele dá **o mesmo número** do financeiro: (atendimentos feitos ÷ atendimentos necessários) = (margem ÷ custo fixo) = (receita ÷ ponto de equilíbrio). | **Uma meta só** (F6, "% do ponto de equilíbrio"), e a ficha mostra as duas leituras: **em R$** ("faltam R$ 8.400") e **em atendimentos** ("faltam 23 atendimentos", pela margem média por atendimento do período). O "dia do ponto de equilíbrio" (F7 do catálogo) sai: é uma projeção que muda todo dia, e o F6 já responde |
| O2 | Ocupação e horas ociosas são calculadas **no código** do Planejamento Anual (7 fontes: jornada, salas, feriados, planejamento, dias extras, fechamentos, agendamentos). Refazer no banco arriscaria números diferentes dos da tela. | Usar a **mesma conta do código**: a barra ao vivo bate com o Planejamento Anual. O resultado final é congelado **pelo servidor**, na primeira vez que a meta for aberta depois do fim (até lá aparece "apurando"). Custo: meta da rede inteira com muitas unidades abre mais devagar |
| O3 | O que é "cliente reativado"? | Cliente com atendimento concluído no período cujo atendimento concluído anterior foi há **mais de N dias**, com N = o **"dias sem atendimento"** que já existe em Administração (hoje 365) |
| O4 | Margem e ponto de equilíbrio de várias unidades. | **Ponderado**: margem da rede = lucro de todas ÷ receita de todas (a unidade grande pesa mais), como o Painel da rede |
| O5 | Desconto médio. | **Ponderado pelo valor**: desconto total ÷ valor de tabela das vendas fechadas no período. Meta de reduzir |
| O6 | Metas financeiras da M3 (margens, ponto de equilíbrio, recebimento em dia). | Entram na D3: quem não vê o financeiro vê só o percentual da meta |
| O7 | Certificação e relatos. | Certificação conta **certificados emitidos** (não "% da equipe certificada", que dependeria de saber quem deveria estar). Relatos: a tela avisa, como na certificação, que meta alta de relatos mede conversa, não qualidade |

## 10. Achados de passagem (registrados no `docs/BACKLOG.md` como AP69 e AP70)

- **Confirmado:** mensalidades do Riso+ (`ppr_charges`) e cobranças do
  Empresarial (`empresarial.adhesion_billing`) **não lançam no razão
  financeiro** (`financial_entries`) — DRE, fluxo de caixa e ponto de equilíbrio
  da unidade não enxergam essa receita.
- **Confirmado:** o painel do Riso+ conta "novas adesões" por `created_at`
  (criação), não por `activated_at` (ativação = contrato + 1º pagamento), e conta
  transferência como adesão nova.

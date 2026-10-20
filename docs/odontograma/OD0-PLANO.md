# Módulo Odontograma — Fase OD0 (diagnóstico e plano, sem código)

*19/10/2026 · base: o pedido "PROMPT — Módulo Odontograma do riSZon", os 4
arquivos de `docs/referencias/tuss/` e a leitura do sistema como ele está
(versão 0.331.1, migração 0307).*

> **Em uma frase:** quase tudo que o odontograma precisa para "andar" pela
> jornada **já existe** no riSZon — plano com alternativas, aprovação do
> Coordenador, negociação com aceite parcial, parcelas, sessões, evolução e
> repasse. O que falta é **o dente**: nenhuma tabela do sistema sabe hoje em
> qual dente, face ou região um procedimento acontece. O plano abaixo
> **acrescenta o dente ao que existe**, em vez de construir um segundo
> sistema ao lado.

---

## 1. Os arquivos TUSS — o que encontrei

| Arquivo | Tabela TUSS | Linhas | Situação |
|---|---|---|---|
| `dentes.json` | 28 | 60 | 32 permanentes + 20 decíduos + **8 "supranumerários"** (19, 29…89) |
| `faces_dentes.json` | 32 | 7 | V, P, O, M, L, I, D |
| `regioes_boca.json` | 42 | 61 | arcos, hemiarcos, sextantes, grupos de dentes **e tecidos moles** (língua, palato, úvula…) |
| `situacao_inicial.json` | 44 | **5** | Hígido, Cariado, Restaurado, Ausente, Extração indicada |

Nenhum código repetido, nenhum nome repetido, todos vigentes. **Mas há cinco
lacunas** — os arquivos não trazem o que o desenho e as regras precisam:

- **I1. Só 5 situações.** A TUSS 44 não tem "canal tratado", "coroa",
  "implante", "prótese", "selante", "fratura"… — justamente o "efeito depois
  de realizado" que o pedido exige (seção 3). Pela regra "nunca invente
  códigos", isso **não pode** sair de mim. Proposta: as 5 da TUSS ficam como
  são, e criamos uma lista **da Risarte** (marcada como "não TUSS") que você
  aprova item por item.
- **I2. Que faces valem para cada dente** não está nos arquivos. A regra
  odontológica é conhecida (dente anterior tem **Incisal**, posterior tem
  **Oclusal**; superior tem **Palatina**, inferior tem **Lingual**) —
  proponho derivar por essa regra, escrita e testada, e você confirma.
- **I3. Quais dentes cada região contém** também não está (ex.: o sextante
  S1 vai do 18 ao 14? inclui o 18?). Proponho uma tabela de correspondência
  só para as regiões **com dentes**, que você (ou um dentista da rede)
  confere antes de entrar. As regiões de tecido mole (língua, palato…)
  ficam disponíveis para achados, mas não selecionam dentes.
- **I4. Supranumerários** (19, 29…) não têm lugar fixo no arco. Proposta: só
  aparecem no desenho quando registrados, no fim do hemiarco.
- **I5. A TUSS de procedimentos (os 370 que importamos) não diz** se o
  procedimento é por dente, por face, por região ou da boca toda, nem com
  quais situações combina, nem o efeito. Proposta: o sistema **sugere** a
  classificação pelo nome ("… 2 faces" → face, 2 faces; "Exodontia…" →
  dente, efeito *ausente*; "Prótese total" → arcada) e gera uma planilha
  para um dentista revisar **antes** de valer. Nada entra sem revisão.

Detalhes miúdos (não mudo o texto oficial): "Segundo **m**olar Decíduo
Inferior Direito" (85) em minúscula; "Região dos Incisivos centrais
superiores" com espaço no fim.

---

## 2. O que já existe e o odontograma vai usar (não duplicar)

| O pedido fala em… | No riSZon já existe | Proposta |
|---|---|---|
| `dental_procedure_catalog` | **`procedures`** (catálogo único da rede, 370 TUSS, só o Admin grava — 0306) | **Acrescentar** as regras clínicas numa tabela-irmã (`procedure_dental_rules`), sem novo catálogo |
| `dental_procedure_price` versionado | `default_price_cents` + ajuste por unidade (`clinic_procedure_prices`), **sem vigência** | Ver decisão **D3** |
| `clinical_exams` (avaliação/reavaliação) | **`clinical_evaluations`** (rodadas *avaliação*/*reavaliação*, aberta/fechada) | Reusar e acrescentar o ciclo rascunho→finalizado |
| `clinical_exam_notes` | **`clinical_notes`** ("considerações", ligadas à rodada) | Reusar; travar quando a rodada for finalizada |
| `treatment_plans` + alternativas | **`treatment_plans` + `treatment_plan_options`** (principal + alternativas) + aprovação **por opção** pelo Coordenador (LOTE F4) | Reusar; acrescentar versão (D4) |
| `treatment_plan_items` | **`treatment_plan_option_items`** (procedimento, preço do catálogo travado — 0306, etapa, sessões) | Acrescentar **dente / faces / região** |
| aprovação parcial pelo paciente | **`plan_negotiations` + `plan_negotiation_items.included`** | Reusar como está |
| orçamento → contrato → parcelas | negociação → `commercial_sales` (regra de ouro no banco, 0203) → **`payment_installments`** | Reusar como está |
| `clinical_records` (evolução) | **`treatment_sessions`** (geradas da opção vendida, 0286) + **`clinical_progress_notes`** + desfecho por sessão | Reusar; a sessão herda o dente do item |
| produção clínica | **`provider_payouts`**: nasce sozinha quando a sessão é concluída (procedimento × dentista × unidade × data × valor congelado) | **Já é** a produção clínica. Ganha o dente pela sessão |
| `odontogram_audit_log` | **`audit_changes`** (0288): o banco já grava antes/depois/autor de **toda** tabela, só o Admin lê, imutável | Não criar log paralelo; motivo vai no próprio registro |
| assinatura ZapSign | **não integrada no núcleo** (só no Empresarial; no Comercial é uma marcação manual) | Ver D9 |
| "titular" (`is_owner`) | **`profiles.is_owner`** ("Admin Principal", no máximo 1, 0262) | Reusar |

**Novo de verdade:** as tabelas de referência TUSS, as regras clínicas do
catálogo, os **achados por dente** (`tooth_findings`, com sugestão →
definição), o **odontograma do paciente** (dentição atual), o local (dente/
faces/região) nos itens do plano, a **situação atual derivada** (em qualquer
data) e o componente visual `<Odontogram />`.

---

## 3. Modelo de dados proposto (resumo)

**Referência (da rede, só leitura; seed dos JSON):**
`dental_teeth` (código FDI, nome, dentição, arco, lado, grupo, supranumerário),
`dental_faces`, `dental_tooth_faces` (derivada, I2), `dental_regions` (com tipo:
*grupo de dentes* × *tecido mole*), `dental_region_teeth` (I3),
`dental_conditions` (as 5 TUSS + as da Risarte, I1, com a origem marcada).

**Catálogo:** `procedure_dental_rules` (1 por procedimento): nível de aplicação
(dente / face / região / arcada / boca), nº de faces, dentições e grupos
compatíveis, situações que **impedem** e que **exigem**, **efeito** depois de
realizado, símbolo e cor, ordem clínica. Preço: D3.

**Por paciente:**
- `odontograms` — 1 por paciente, dentição atual (permanente/decídua/mista).
- `tooth_findings` — **só acrescenta, nunca edita**: dente/faces/região,
  situação, origem (rodada de avaliação **ou** sessão de tratamento),
  `suggested | defined | rejected`, quem sugeriu/definiu, motivo,
  `superseded_by`.
- Itens do plano ganham `tooth_code`, `face_codes`, `region_code`
  (**um item por dente** quando o procedimento é por dente — é o que deixa
  a execução e a produção saberem qual dente foi feito).
- **Situação atual = cálculo**, nunca sobrescrita: achados definidos +
  efeitos dos procedimentos concluídos até a data pedida. Daí sai o
  odontograma "em qualquer dia do passado".

**Prontuário digital (seção 5 do pedido):** rodada de avaliação, versão
aprovada do plano e evolução ganham `finalized_at/by`, `content_hash`
(SHA-256), `signature_status/provider/reference`, `signed_at`; depois de
finalizado, **o banco recusa** alterar e apagar (gatilho), e a correção é
**adendo** com motivo. ⚠️ Hoje as considerações e mídias de uma rodada
**fechada** ainda podem ser editadas/apagadas — a trava nova muda isso.

---

## 4. Onde aparece

| Lugar (já existe) | Modo |
|---|---|
| Ficha do cliente — aba nova **Odontograma** (entre *Clínico* e *Desenvolvimento*) + miniatura no cabeçalho | `compact` / leitura / `history` |
| Cockpit de avaliação do Coordenador (`/avaliacao/[cliente]`) | `diagnosis` (sugere) |
| Fila do Centro de Planejamento (`/planejamento`) — situação nova **"Diagnóstico a definir"** | lista de pendentes |
| Cockpit do Planner (`/planejamento/[cliente]`) | `diagnosis` (define) + `planning` |
| Apresentação (`/apresentacao/[cliente]`) — e o PDF que ela já imprime | `presentation` + seleção dos itens aceitos |
| Atendimento do dia (painel de atendimento / Desenvolvimento) | `execution` (+ sugestão do dentista) |
| Financeiro | nada novo na tela: o repasse já nasce da sessão; passa a saber o dente |

---

## 5. Conflitos com o que está combinado (o pedido manda parar e perguntar)

| # | O pedido diz | O `CLAUDE.md` / o sistema hoje |
|---|---|---|
| **C1** | Planner **realiza consulta de avaliação** | Planner **não pode** avaliação clínica |
| **C2** | Planner usa o **modo apresentação** | Planner **não pode** apresentação (é do Consultor) |
| **C3** | Planner **registra evolução clínica** | Só o **Dentista** escreve evolução |
| **C4** | Admin Master **não titular** perde as ações clínicas | Admin Master = **"Tudo"** |
| **C5** | **Assistente comercial** vê o odontograma | Assistente não vê dado clínico hoje (LGPD: menor acesso) |
| **C6** | Plano aprovado → **nova versão** | Hoje: **"Reabrir para edição"** volta o mesmo plano a rascunho |
| **C7** | "aprovado" = o paciente aprovou | Hoje "aprovado" = **o Coordenador aprovou** a opção; o paciente "aceita" na negociação. Os dois continuam existindo |

---

## 6. Decisões que preciso de você

| # | Pergunta | Minha recomendação |
|---|---|---|
| **D1** | Situações além das 5 da TUSS (I1) | Lista da Risarte marcada "não TUSS", aprovada por você |
| **D2** | Faces por dente e dentes por região (I2, I3) | Derivar pela regra odontológica, com tabela para um dentista conferir |
| **D3** | Preço | Manter **rede + ajuste por unidade** (como hoje, 0306) e **acrescentar vigência** (data de início), como já fazemos no repasse |
| **D4** | Plano aprovado | **Nova versão** (a anterior fica "substituída", consultável) no lugar do "Reabrir" |
| **D5** | C1, C2, C3 (o que o Planner faz) | Planner **define** diagnóstico e monta plano; avaliação segue do Coordenador; apresentação do Consultor; evolução do Dentista — como hoje |
| **D6** | C4 (outros Admin Master) | Manter "Admin = tudo" **fora** das ações clínicas assinadas (sugerir/definir/evoluir) — o titular faz tudo |
| **D7** | Quem vê preço: Coordenador? Gerente? | Coordenador: **só totais** (como hoje); Gerente: **sim** (acompanha parcela e renegociação) |
| **D8** | C5 (Assistente vê odontograma) | **Não** — só o que precisa para documento e pagamento |
| **D9** | ZapSign no núcleo | A OD4 entrega o orçamento/contrato **impresso com a miniatura**; a assinatura digital entra quando houver token (o código do Empresarial é reaproveitável) |
| **D10** | Descontos por papel | Usar as **regras comerciais que já existem** (teto por unidade, gerente autoriza acima) |
| **D11** | Classificar os 370 procedimentos (I5) | O sistema sugere; **um dentista revisa a planilha** antes de valer; começar pelos mais usados |
| **D12** | Cores | Vermelho = a realizar · azul = existente/realizado · cinza = ausente · **tracejado = sugestão** (com símbolo, nunca só cor) |

---

## 7. Fases (ajustadas ao que já existe)

- **OD1 — Base:** tabelas de referência (seed dos JSON), regras clínicas do
  catálogo + tela do Admin, vigência do preço (se D3), `<Odontogram />` em
  `compact` e leitura, aba na ficha.
- **OD2 — Diagnóstico:** modo `diagnosis` no cockpit do Coordenador e do
  Planner, achados sugerido → definido, fila "Diagnóstico a definir", avisos,
  finalização com trava no banco.
- **OD3 — Plano:** modo `planning` sobre o plano que existe (dente/faces/
  região nos itens), compatibilidade, versões (D4).
- **OD4 — Apresentação e orçamento:** modo `presentation`, aceite total/
  parcial na negociação existente, miniatura no documento impresso.
- **OD5 — Execução:** modo `execution`, sessão herda o dente, efeito do
  procedimento atualiza a situação, sugestão do dentista.
- **OD6 — Histórico e prontuário:** linha do tempo, adendos, exportação do
  prontuário (LGPD).

Cada fase: plano → seu OK → código → testes → migração no treino → commit →
manual e estado → resumo para você.

---

## 8. Decisões do dono (19/10/2026) — OD0 fechada

| # | Decisão |
|---|---|
| D1 | Situações além das 5 TUSS: **lista da Risarte**, marcada "não TUSS", que eu proponho e **o dono aprova** item por item |
| D2 | Faces por dente e dentes por região: **derivadas pela regra odontológica**, conferidas pelo dono antes de valer |
| D3 | Preço: **rede + ajuste por unidade, com vigência** (data de início), como o repasse |
| D4 | Plano aprovado que muda: **nova versão**; a anterior fica "substituída" e consultável (sai o "Reabrir para edição") |
| D5 | Planner: **define** o diagnóstico e monta o plano. Avaliação segue do Coordenador, apresentação do Consultor — **o CLAUDE.md §5 não muda** nisso |
| D6 | Admin Master não titular **perde só as ações clínicas** do odontograma (sugerir, definir, montar plano, evoluir); o titular (`is_owner`) faz tudo |
| D7 | Coordenador vê **só totais**; Gerente **vê preços** |
| D8 | Assistente comercial **não vê** o odontograma |
| D8b | ⚠️ **Coordenador passa a registrar evolução clínica** (hoje só o Dentista) — mudança de regra, entra na OD5 |
| D9 | Orçamento/contrato **impresso com a miniatura** na OD4; ZapSign quando houver a chave |
| D10 | Descontos: **as regras comerciais que já existem** |
| D11 | Os 370 procedimentos: **o sistema sugere a classificação, o dono revisa** a planilha; só entra o revisado |
| D12 | Cores: vermelho = a realizar · azul = existente/realizado · cinza = ausente · tracejado + ícone = sugestão; sempre com símbolo |
| — | Revisor das planilhas clínicas (situações, faces/regiões, classificação): **o dono** |

## 9. OD1 — o que vem primeiro (aguardando o OK)

1. **Três planilhas para o dono revisar** (antes de qualquer migração):
   situações da Risarte (D1); faces por dente e dentes por região (D2);
   classificação sugerida dos 370 procedimentos (D11).
2. Depois da revisão: migração com as tabelas de referência (seed dos JSON
   TUSS + o que foi aprovado), as regras clínicas do catálogo e a
   **vigência do preço** (D3), no treino primeiro.
3. Tela do Admin para as regras clínicas de cada procedimento.
4. O `<Odontogram />` em modo `compact` e leitura, e a aba **Odontograma**
   na ficha (vazia de achados até a OD2).

### OD1 — passo 1 entregue (19/10/2026): as três planilhas

Na pasta sincronizada `Odontograma - revisão OD1/` (fora do repositório),
geradas por `scripts/odontograma-planilhas-od1.mjs` (lê os JSON TUSS e o
catálogo da PRODUÇÃO, só leitura):

1. **Situações do dente** — as 5 da TUSS 44 + 33 propostas da Risarte (`RZ-…`).
2. **Faces por dente** (60 dentes, pela regra anterior/posterior,
   superior/inferior) e **dentes por região** (33 regiões com dentes; as de
   tecido/osso não selecionam dente).
3. **Classificação dos 370 procedimentos** — nível, nº de faces, dentição,
   dentes compatíveis, situações que impedem/exigem, efeito, confiança
   (112 alta, 152 média, 106 baixa).

⏳ Aguardando a revisão do dono (coluna "Decisão" em cada planilha). Nada
vai para o banco antes disso.

### OD1 — passo 2 entregue (19/10/2026): a base no banco e a tela do Admin

As planilhas voltaram com a coluna "Decisão" vazia e o dono escreveu
"revisei as planilhas, pode seguir" — **aprovado como proposto**, com a
condição de o Admin poder ajustar depois. Migração **0308** (gerada por
`scripts/odontograma-gerar-0308.mjs`) + tela **Administração → Odontograma**
(Situações, Faces dos dentes, Regiões, Procedimentos). ✅ **0308 aplicada na
produção em 20/10/2026** (conferência do dono e de fora deram o esperado).

**Faltam da OD1:** (3) a **vigência do preço** (D3) — mexe no caminho do
preço que está no ar (`catalog_price_for`, a trava da 0306), por isso em
migração própria; (4) o `<Odontogram />` em `compact`/leitura e a aba
**Odontograma** na ficha.

### OD1 — passo 3 entregue (20/10/2026): a vigência do preço (D3)

Decisões do dono: o **banco aplica à 0h + aviso** (com "Aplicar agora"); data
**hoje ou futura**; nos **três lugares** (editar, preço da unidade, reajuste em
massa). Migração **0309**: histórico por gatilho (imutável) + agendamento +
rotina `risarte-precos-agendados`. O preço de hoje continua onde estava —
nenhuma tela nem conta que lê preço mudou. ⏳ Na produção depois do "cole aqui
a 0309".

**Falta da OD1:** (4) o `<Odontogram />` em `compact`/leitura e a aba
**Odontograma** na ficha.

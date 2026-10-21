# Odontograma — Fase OD4: apresentação, aceite por dente e orçamento (plano, sem código)

*20/10/2026 · base: o pedido do dono (seções 6.1 "presentation", 7.4, 7.5 e
8), as decisões D1–D12, E1–E4, F1–F4 e a leitura do sistema na versão
0.337.0.*

> **Em uma frase:** o cliente vê na apresentação o desenho da boca dele com o
> que vai ser feito, o Consultor marca o que ele aceitou **dente a dente**, e
> sai um **orçamento impresso** com a miniatura do odontograma — o documento
> que o cliente leva e assina.

---

## 1. O que existe hoje e a OD4 aproveita

| Já existe | Como funciona hoje | O que a OD4 faz |
|---|---|---|
| **Apresentação** (`/apresentacao/[cliente]`) | Slides: capa, diagnóstico (+ considerações do Coordenador), objetivos, imagens, sessões, proposta com preço, considerações do planejamento, próximas etapas. "Apresentar" em tela cheia; "Baixar PDF" imprime os slides. **Só a opção principal aprovada.** Nenhum desenho | Ganha o slide **"O seu odontograma"** (o que existe hoje e, em vermelho, o que o plano faz) e a proposta **por dente** |
| **Negociação** (painel do Consultor) | Uma caixinha por item: o cliente aprovou ou não; aprovação parcial pede motivo; desconto, pagamento, "Cliente aceitou" | Com **um item por dente** (OD3), o aceite já é **dente a dente**. Ganha o **desenho** do que está aceito (vermelho) e do que ficou de fora |
| **Documento impresso** | **Não existe orçamento nem contrato de tratamento** impresso. Existem: termo de cancelamento (CN-), acordo de renegociação (RN-), contrato do PPR+, contrato do Empresarial (este com modelo editável e campos `{{…}}`) | **Novo: Orçamento impresso** (no mesmo estilo do termo de cancelamento), com a miniatura |
| **Fechamento** | "Contrato assinado" é uma marcação manual (ZapSign ainda não plugado, D9) | Continua; o orçamento impresso passa a ser o papel que se assina |

A **produção tem 0 negociações e 0 vendas** — nada para adaptar.

---

## 2. Como vai funcionar

### 2.1. Na apresentação (Consultor, com o cliente)

1. Novo slide **"O seu odontograma"**: o desenho da boca — o que já existe
   (azul/cinza), o que precisa de tratamento (vermelho, OD2) e o que o plano
   propõe (vermelho com o símbolo do procedimento). Embaixo, a lista por
   dente: "16 — Selante (oclusal)", "46 — Implante".
2. O slide **"Proposta e investimento"** passa a listar por dente/região.
3. Alternativas: ver **decisão G1**.
4. O que é interno sai da tela do cliente: ver **decisão G4**.

### 2.2. No aceite (painel de negociação)

1. As caixinhas continuam — agora cada uma é **um dente** (ou uma região),
   com o rótulo do lugar ("Selante — 16 (O)").
2. Ao lado, o **desenho do aceite**: vermelho = aceito; tracejado/cinza = o
   cliente não quis agora. Tocar no dente marca/desmarca os itens dele.
3. O resto não muda: aprovação parcial pede motivo, desconto, pagamento,
   "Cliente aceitou". O que ficou de fora continua marcado no plano como "Não
   aprovado pelo cliente" e **não vira sessão** (já é assim).

### 2.3. O orçamento impresso

Uma página própria (como o termo de cancelamento), com o botão **Salvar em
PDF / Imprimir**:

- cabeçalho da unidade, cliente, data, código **PT-** (quando já aceito) ou
  "Proposta" (antes do aceite);
- **miniatura do odontograma** com o que foi aceito;
- tabela: procedimento · dente/região · sessões · valor; subtotal, benefício
  do programa, desconto, **total**; forma de pagamento e parcelas;
- o que ficou de fora (e o motivo), se a aprovação foi parcial;
- validade (**decisão G2**) e linhas de assinatura (cliente e Consultor).

O **contrato de tratamento** com cláusulas: **decisão G3**.

---

## 3. Um furo que a OD4 fecha (achado no levantamento)

A versão nova do plano (OD3) substitui a anterior — mas a **negociação** da
anterior não sabe disso:

- o painel de negociação procura "o plano aprovado mais novo" sem olhar se
  foi substituído;
- `ensure_treatment_sessions` (que cria as sessões depois da venda) aceita
  negociação de plano substituído.

**Proposta (segue a regra F2, não muda regra):** quando a nova versão é
aprovada, a negociação **ainda aberta** da anterior (em negociação,
aguardando autorização ou devolvida) é **encerrada** com o motivo "substituída
pela versão N" — o Consultor recomeça na nova. Negociação **já aceita** (venda)
não é tocada: o que foi vendido vale. As sessões e o painel passam a ignorar
plano substituído que não foi vendido.

---

## 4. O que muda no banco (migração 0313, no treino primeiro)

- Nada de tabela nova para a apresentação e o orçamento (os dados já
  existem; o orçamento é uma página que lê a negociação).
- O furo do item 3: gatilho que encerra a negociação aberta do plano
  substituído; `ensure_treatment_sessions` e a leitura do painel ignorando
  plano substituído não vendido.
- Se G2 = validade configurável: um campo na regra comercial da unidade
  (cascata rede → unidade).

## 5. Telas

| Tela | O que muda |
|---|---|
| `/apresentacao/[cliente]` | slide "O seu odontograma"; proposta por dente; G1 e G4 |
| Painel de negociação | rótulo do dente em cada caixinha; desenho do aceite |
| **Novo:** `/orcamentos/[negociação]` | o orçamento impresso com a miniatura |
| Fechamento | botão "Imprimir orçamento"; "Contrato assinado" segue manual |

**Fica para depois:** a assinatura digital (ZapSign — D9, quando houver a
chave); o envio do orçamento por WhatsApp/e-mail; o desenho no deck do Gamma
(ele recebe texto e fotos, não o desenho).

---

## 6. Decisões que preciso de você

| # | Pergunta | Minha recomendação |
|---|---|---|
| **G1** | As **alternativas** aprovadas (ex.: "Opção B — prótese") aparecem na apresentação? Hoje só a principal | **Sim, quando o Consultor escolher** — um botão "mostrar alternativa", cada uma com o seu odontograma e total |
| **G2** | O orçamento impresso tem **validade**? | **Sim, 15 dias**, configurável pelo Admin (rede → unidade) — o preço congela no envio (F3), mas o catálogo pode mudar depois |
| **G3** | O **contrato de tratamento** (com cláusulas) | **Agora só o orçamento com assinatura**; o contrato com cláusulas vem quando você mandar o modelo (como foi no Empresarial: o texto é seu/do jurídico, eu não redijo cláusula) |
| **G4** | A tela do cliente mostra as **considerações do Coordenador** (anotações da avaliação)? Hoje mostra | **Não** — elas são anotação clínica interna; o cliente vê o diagnóstico do plano, o odontograma e as considerações do planejamento (o campo do Planner que já diz "para a apresentação ao cliente") |

### Decisões do dono (20/10/2026) — as quatro como recomendado

| # | Decisão |
|---|---|
| G1 | Alternativas aparecem **quando o Consultor escolher** ("mostrar alternativa"), cada uma com o seu odontograma e total; abre na principal |
| G2 | Orçamento com **validade de 15 dias**, configurável pelo Admin (rede → unidade) |
| G3 | **Agora só o orçamento assinado**; o contrato com cláusulas quando o dono mandar o modelo |
| G4 | As **considerações do Coordenador saem** da tela do cliente |

⏳ Aguardando o OK do dono para começar o código.

---

## 7. Como vai ser provado

Ensaio da 0313 no treino (transação desfeita, 2×): nova versão aprovada
encerra a negociação aberta da anterior e não toca a vendida; sessões não
nascem de plano substituído não vendido. Testes da parte pura (o que entra
no orçamento, o desenho do aceite) + prova de quebra. Tela no treino:
apresentação e orçamento como Consultor/Admin de teste. ⚠️ **O aceite pela
tela** muda a fase do cliente e avisa a Assistente comercial — no treino há
gente real na unidade de teste: aceite só no ensaio do banco, a menos que
você autorize.

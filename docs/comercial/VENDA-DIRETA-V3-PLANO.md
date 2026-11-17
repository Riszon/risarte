# Venda direta v3 — o caixa da recepção

Pedido do dono, 16/11/2026, com a tela do treino (prontuário, aba
"Sessões & Procedimentos", duas vendas abertas):

> está muito confuso, começa por um botão de venda direta, mas precisa
> finalizar em outra aba "sessões e procedimentos"; quando está configurando
> as condições fica uma tela longa com um monte de informações; não sei onde
> envia o contrato ou termo; não dá baixa automática na assinatura, marca tudo
> manual, contrato e pagamento. A venda é feita dentro da clínica: poucos
> cliques e rápido.

**Status: VD3-1 CONSTRUÍDA em 16/11/2026 (core 0.463.0, sem migração), testada de ponta a ponta no
treino (VD-00587) e publicada no `main` no mesmo dia.
VD3-2 a VD3-4: não construídas.**

## 0. O que o dono já respondeu (16/11/2026)

- **Vendas mais comuns:** limpeza/profilaxia, consultas, urgências e
  emergências, restaurações em resina, conserto de próteses, manutenção de
  próteses, entre outros.
- **Quem está no computador:** a **recepção, no balcão**. O dentista não.
- **Termo:** assinado pela **ZapSign, a cada venda** — mantido. (Ficam fora
  as ideias de "termo uma vez por cliente" e "assinatura com o dedo na tela".)
- **Como o cliente costuma pagar:** varia bastante. **O Pix vem escolhido**
  quando a janela abre, e trocar de meio é um clique nos botões ao lado.
- **Quem assina (D1):** só o cliente (ou o responsável financeiro, se menor),
  sem testemunha e sem assinatura da Risarte. Texto provisório escrito na
  VD3-2 e revisado pelo dono/jurídico antes da produção.
- **Papel (D6):** aceito quando a internet ou o celular falhar, só com a foto
  do termo anexada.

---

## 1. O que existe hoje (lido no código, não suposto)

| # | Problema que o dono viu | Onde está | Causa |
|---|---|---|---|
| P1 | Começa num botão e termina em outra aba | `prontuarios/[id]/direct-sale-dialog.tsx` lança; o fechamento é o `SaleItem` na aba "Sessões & Procedimentos" | A janela só **lança**; uma mensagem manda ir a outra aba |
| P2 | Tela longa e confusa | `comercial/venda-direta/direct-sale-item.tsx` (1.026 linhas) | Mostra tudo de uma vez: PPR+, forma de pagamento, ajuste, resumo, editor de parcelas, custo do cartão, salvar; depois três chaves, cobranças, cancelar e distrato |
| P3 | Não sabe onde envia o termo | Só existe a chave "Contrato assinado" | **A venda direta não tem documento.** A assinatura digital não conhece a venda direta (`signature_packages.origin_type`, 0340, não tem `direct_sale`; o retorno da ZapSign, 0397, só fecha a venda do Consultor) e não há modelo de termo |
| P4 | Pagamento marcado à mão | Chaves "Cobrança emitida" e "Pagamento confirmado" | A baixa automática **já existe pelo Asaas** (4005 e 4012), mas: o Asaas está em sandbox até a ASA7; a cobrança automática nasce desligada nas unidades; e ela só nasce depois do contrato assinado |
| P5 | Só se vende pelo prontuário | A tela **Atendimento** e a agenda não têm nenhum caminho para a venda | A recepção trabalha no Atendimento; para vender, precisa procurar o prontuário e escolher o atendimento numa lista |

**Não muda** (regras do dono, `COMERCIAL.md` §7): toda venda ligada a um
atendimento; quem lança e quem fecha por papel; a regra comercial **bloqueia**
(desconto, acréscimo só do Gerente, parcelas, meio, parcela mínima); preço do
catálogo posto pelo banco (0394); só é venda com **termo assinado E pagamento
confirmado**; receita só depois de fechada (0373/0399).

---

## 2. Onde a venda direta fica

**Na tela Atendimento, que é onde a recepção já está.** Três portas, a mesma
janela:

1. **Atendimento** — botão **Vender** na linha do paciente que está na
   clínica. O atendimento já é aquele: ninguém escolhe nada. *(porta principal)*
2. **Agenda** — a mesma ação no cartão do agendamento.
3. **Prontuário** — o botão de hoje continua, abrindo a mesma janela. Se o
   cliente tem atendimento hoje, ele já vem escolhido.

E uma **fila "Para receber"** no alto do Atendimento: toda venda direta
aberta da unidade (falta assinar / falta pagar), com **Continuar**. É o que
substitui a ida à aba "Sessões & Procedimentos". A venda lançada pelo
Coordenador Clínico cai aqui (hoje é só um aviso no sino).

A aba **Sessões & Procedimentos** volta a ser só dos procedimentos (o
dentista dá baixa). **Comercial → Venda direta** continua sendo a lista para
conferir, usando a mesma janela.

---

## 3. A janela: um caixa, uma tela

Uma tela só para o caso comum (um procedimento, à vista). O que é raro fica
atrás de um link.

```
┌ Venda direta — Maria Silva · atendimento de hoje, 14h, Dr. João ────────┐
│                                                                         │
│ O QUE                                                                   │
│  [Limpeza] [Consulta] [Urgência] [Restauração resina] [Conserto prótese]│
│  [ buscar outro procedimento…                    ]                      │
│   Limpeza (profilaxia)                    1 ▾            R$ 180,00  ✕   │
│                                                                         │
│ COMO PAGA                                                               │
│  [ Pix ] [ Cartão ] [ Dinheiro ] [ Boleto ]                             │
│  [ À vista R$ 162,00 ] [ 2× R$ 90,00 ] [ 3× R$ 60,00 ]                  │
│   à vista: −10% da regra da unidade                                     │
│   dar desconto · ajustar parcelas                     Total  R$ 162,00  │
│                                                                         │
│                                        [ Finalizar: assinar e receber ] │
└─────────────────────────────────────────────────────────────────────────┘
```

- **Atalhos dos mais vendidos da unidade** (calculados das vendas diretas
  concluídas; só os que a pessoa pode lançar). Um clique põe na venda.
- **O Pix à vista já vem marcado** (decisão do dono); os outros meios ficam
  ao lado, um clique para trocar, e as parcelas se refazem sozinhas. Se a
  regra da unidade não permitir Pix, vem marcado o primeiro meio permitido.
- **Meios e parcelas:** só aparece o que a regra permite — meio proibido,
  parcela acima do máximo ou abaixo do mínimo **não aparece**, em vez de
  virar erro depois (a mesma conta `directSaleViolations`).
- **Descontos de programa e o automático à vista** entram sozinhos, com uma
  linha explicando.
- **"Dar desconto"**, **acréscimo** (só o Gerente) e **"Ajustar parcelas"**
  (o editor de cobranças de hoje) abrem só se alguém clicar.
- **Urgência já atendida:** se o atendimento já passou ou foi concluído, o
  sistema marca a exceção sozinho (hoje é uma caixa para marcar) e avisa
  Gerente/Franqueado como já faz.
- **Coordenador Clínico:** vê só o bloco "O QUE"; o botão vira **Enviar para
  a recepção** (vai para a fila "Para receber").
- **Sem atendimento hoje** (só pelo prontuário): botão **Atender agora**, que
  cria o atendimento na hora (D2).

### Depois do "Finalizar": assinar e receber, na mesma janela

```
┌ VD-00031 · Maria Silva · R$ 162,00 no Pix ──────────────────────────────┐
│  TERMO                               PAGAMENTO                          │
│  ○ aguardando a assinatura           ○ aguardando                       │
│  [ Assinar agora neste aparelho ]    QR do Pix / link     (Asaas)       │
│  [ Enviar por WhatsApp ]             [ Recebi R$ 162,00 ] (dinheiro,    │
│                                        maquininha, permuta)             │
└─────────────────────────────────────────────────────────────────────────┘
```

- **Finalizar** grava a venda, gera o termo e já o envia para a ZapSign —
  sem tela de preparação. As duas caixas se atualizam **ao vivo**.
- **Termo:** "Assinar agora neste aparelho" abre o link da ZapSign (tablet do
  balcão ou o celular do cliente pelo WhatsApp). Assinou → a caixa fica verde
  **sozinha** e a venda é marcada pelo retorno da ZapSign
  (`contract_signed_source = 'assinatura_digital'`), como já acontece na venda
  do Consultor.
- **Pagamento:**
  - dinheiro, maquininha, permuta → **um botão "Recebi R$ X"** (hoje são duas
    chaves);
  - Pix, boleto, cartão pelo Asaas → a cobrança aparece com QR/link e o aviso
    do Asaas **confirma sozinho**. Sem Asaas ligado na unidade: **"Confirmar
    que recebeu"**, um clique.
- As duas verdes → **Venda concluída**, o lembrete do brinde do programa
  ("Entregar: escova") e o comprovante pelo WhatsApp (D4).
- Fechou a janela no meio? A venda fica na fila **Para receber**.
- **Corrigir à mão, cancelar venda e distrato:** num menu "⋯ Mais".

**Conta de cliques, limpeza no Pix:** Vender → Limpeza → Pix → Finalizar →
Assinar agora = **5 cliques** + a assinatura do cliente. Hoje: abrir o
prontuário, Venda direta, escolher atendimento, procedimento, lançar, trocar
de aba, escolher formato, meio, salvar, marcar contrato, marcar cobrança,
marcar pagamento = **12 ou mais**, em duas telas, sem documento nenhum.

---

## 4. Entregas (cada uma testável sozinha)

| Entrega | O que | Migração | Resolve |
|---|---|---|---|
| **VD3-1** | O caixa em uma tela; porta no Atendimento, na agenda e no prontuário; fila "Para receber"; aba Sessões enxuta; avançados atrás de link; "Recebi R$ X" em 1 clique; atalhos dos mais vendidos; exceção marcada sozinha. O termo ainda é a chave manual, agora dentro da janela | **não** (mesmas actions e regras) | P1, P2, P5 |
| **VD3-2** | Termo de venda direta pela ZapSign: origem `direct_sale`, modelo "Termo de venda direta", envio no Finalizar, "Assinar agora"/WhatsApp, retorno da ZapSign marca a assinatura e libera a cobrança; trava contra termo em dobro | **sim — a próxima livre do core (0414+)** | P3 e a parte do P4 que depende da assinatura |
| **VD3-3** | Pix/boleto/cartão pelo Asaas dentro da janela (QR, link, ao vivo) + comprovante pelo WhatsApp | não (usa 4012/4005) | P4 — **na produção só depois da ASA7** |
| **VD3-4** | "Atender agora" (criar o atendimento na janela) | a ver | o caso sem agendamento |

Ordem: **VD3-1 → VD3-2 → VD3-3 → VD3-4.**

Cada entrega: seção do manual de treinamento, `changelog.ts`, testes das
regras (provados quebrando), ensaio no treino, `npm run check:telas`, e o dono
testa no treino antes da produção.

---

## 5. Decisões do dono

**Decididas em 16/11/2026:** D1 (como recomendado), D6 (como recomendado) e o
meio de pagamento (Pix já escolhido, troca rápida). **Sem resposta, seguem a
recomendação até o dono dizer o contrário:** D2, D3 (a cobrança continua
nascendo na assinatura), D4 e D5.

- **D1 — Quem assina o termo.** *Recomendo:* só o cliente (ou o responsável
  financeiro, se for menor), **sem testemunha e sem assinatura da Risarte** —
  é o que cabe no balcão. O texto: eu escrevo um termo curto e provisório
  (procedimentos, valor, forma de pagamento, desistência, foro) e o dono ou o
  jurídico revisa antes da produção.
- **D2 — "Atender agora".** *Recomendo:* sim, mas por último (VD3-4): com a
  porta no Atendimento, quase toda venda já nasce com o atendimento.
- **D3 — Pix antes da assinatura?** Hoje a cobrança do Asaas só nasce quando
  o termo é assinado. *Recomendo manter:* evita cobrar quem não assinou, e
  assinar no aparelho leva um minuto. (Para decidir melhor: no balcão, o
  cliente paga mais em Pix, cartão na maquininha ou dinheiro?)
- **D4 — Comprovante pelo WhatsApp ao concluir.** *Recomendo:* sim, com o
  texto aprovado pelo dono.
- **D5 — Desmarcar à mão.** *Recomendo:* só o Gerente, no "⋯ Mais", com
  motivo. Hoje quem fecha pode marcar e desmarcar à vontade.
- **D6 — Papel.** Com a ZapSign mantida, existe saída em papel quando a
  internet ou o celular do cliente falhar? *Recomendo:* sim, só com a foto do
  termo anexada (a mesma trava do contrato à mão do Consultor, OC-00171).

---

## 6. Limites (dito antes, para não surpreender)

- **Baixa automática do pagamento** só para o que passa pelo Asaas. Dinheiro,
  maquininha e permuta continuam confirmados por quem recebeu — com um clique.
- **Na produção o Asaas está trancado até a ASA7.** Até lá, Pix e boleto
  também serão "Confirmar que recebeu". No treino dá para ver o automático nas
  unidades com conta de sandbox (Londrina, Cambé).
- **Cada termo gasta um crédito da ZapSign** — uma limpeza gasta o mesmo que
  um contrato de tratamento.
- Entre a VD3-1 e a VD3-2 a tela já fica simples, mas o termo ainda é marcado
  à mão.

---

## 7. VD3-2 — o termo pela ZapSign (plano da etapa, 16/11/2026)

**Status: aprovado (V1–V3 como recomendado) e CONSTRUÍDO em 16/11/2026 (core 0.465.0, migração 0415), na branch. Antes da produção: o dono lê o texto do termo e roda a 0415.**

### O que foi lido no código antes de planejar

- O **termo de renegociação** (4017) já faz quase tudo o que a venda direta
  precisa: documento montado pelo código (texto provisório), pacote pela porta
  `signature_create_package`, PDF, envio, e o retorno da ZapSign aplicando o
  efeito (`reagirAoTermo`). A venda direta segue o mesmo caminho.
- ⚠️ **A Recepção e a SDR NÃO podem enviar para assinatura hoje.** A
  permissão `acao.assinaturas.enviar` nasce só com Consultor, Assistente,
  RisLife, Financeiro da Franqueadora e Gerente — e é conferida duas vezes
  (no app, `canSendSignatures`, e no banco, `signature_create_package`).
- O contrato "assinado no papel" do Consultor exige o papel anexado (0392,
  pasta `contratos-papel`, trava `PAPER_REQUIRED`). A venda direta ganha a
  mesma trava.

### Como fica

1. **"Finalizar"** grava a venda, monta o **Termo de venda direta** e o envia
   à ZapSign. Quem assina: o cliente (ou o responsável, se menor), sem
   testemunha, sem assinatura da Risarte (D1).
2. A caixa **Termo** mostra **"Assinar agora neste aparelho"** (abre o link
   da ZapSign no aparelho do balcão) e **"Enviar por WhatsApp"** (o link).
3. Assinou → a ZapSign avisa o riSZon → a venda fica **assinada sozinha**
   (origem `assinatura_digital`) e, com a unidade ligada no Asaas, a cobrança
   nasce. A janela se atualiza sozinha enquanto espera.
4. Sem internet / sem celular: **"Assinado em papel"** com a foto ou o PDF
   do termo (D6). O botão "Termo assinado" sem anexo **deixa de existir**, e o
   banco recusa marcar sem papel ou sem ZapSign (trava, como na 0392).
5. Cancelar a venda com o termo em aberto cancela o documento na ZapSign.
6. Cadastro sem CPF, data de nascimento ou contato: a janela diz o que falta
   antes de enviar (a ZapSign exige CPF).

### Decisões pedidas

- **V1 — Quem envia o termo.** *Recomendo:* **quem fecha a venda direta**
  (Recepção, Gerente, SDR nos procedimentos dela), por uma porta própria do
  termo da venda direta — **sem** dar à Recepção a permissão geral "Enviar
  para assinatura" (que também envia contrato, TCLE, orçamento). Alternativa:
  liberar a permissão geral para a Recepção e a SDR em Administração →
  Permissões, nos dois ambientes.
- **V2 — Quem anexa o termo em papel.** *Recomendo:* quem fecha a venda
  (é a saída quando a internet cai no balcão); fica na Auditoria com o
  arquivo. Alternativa: só o Gerente (como na renegociação).
- **V3 — O texto.** Eu escrevo um termo curto e provisório (procedimentos,
  valor, forma de pagamento, desistência, foro). O PDF sai com a marca de
  texto provisório, como os outros modelos, até a revisão. *Publicar na
  produção só depois de o dono ler o texto.*

### Migração (core 0415)

- `signature_packages.origin_type` aceita `direct_sale`;
- `direct_sales`: `contract_signed_source`, `signature_package_id` e as
  colunas do papel; trava `PAPER_REQUIRED` em gatilho;
- porta `direct_sale_term_package` (cria o pacote do termo, conferindo quem
  fecha) e `_direct_sale_mark_signed` (o retorno da ZapSign marca, sem
  usuário, em nome de quem enviou);
- `direct_sale_mark_paper` (anexo + marca, numa transação);
- `select public.audit_attach_all();`.

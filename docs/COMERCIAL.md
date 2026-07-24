# Módulo Comercial — Conversão Comercial (Fase 4)

Briefing do dono (22/07/2026), consolidado. Fonte da verdade do módulo
Comercial. Complementa `docs/JORNADA.md` (Fase 4) e antecede o módulo
Financeiro (split/recebíveis detalhados lá quando for construído).

**Regra de ouro (inalterada):** só é venda com **documentos assinados E
pagamento confirmado**.

## 1. Papéis

| Papel | Responsabilidade |
|---|---|
| **Consultor Comercial de Planejamentos** | Apresenta o plano ao cliente (videochamada Google Meet ou WhatsApp), negocia forma de pagamento/parcelamento/descontos, conduz follow-up, libera o cliente no fechamento |
| **Assistente Comercial** | Fechamento operacional: envia contrato para assinatura (ZapSign) e cobrança (ASAAS: link, boleto, PIX) |
| **Coordenador Comercial** (futuro) | Hierarquia acima do Consultor e do Assistente — criar depois |
| **Gerente da unidade** | Autoriza negociações fora da regra comercial; recebe follow-ups esgotados; na venda direta pode lançar e fechar |
| **Recepcionista / Coordenador Clínico** | Venda direta na unidade (ver §7) |

## 2. Fluxo principal da Fase 4

1. **Chegada:** plano de tratamento elaborado pelo Planner e aprovado pelo
   Coordenador Clínico chega da Fase 3.
   - O **plano PRINCIPAL** é o apresentado. Planos **secundários** só ficam
     acessíveis ao Consultor se **também aprovados pelo Coordenador** — são a
     "carta na manga" caso o principal não seja aceito.
2. **Apresentação:** por videochamada (Google Meet — integrar) ou WhatsApp.
   **Gravar toda a apresentação** + gerar **resumo** + espaço para
   considerações do Consultor.
3. **Negociação:** forma de pagamento, parcelamento, **desconto ou acréscimo**.
   O Consultor **NÃO altera o plano** — só negocia. Se precisar de outro
   procedimento/tratamento → devolve ao Planner.
4. **Aprovação parcial:** o Consultor pode **remover procedimentos** para
   viabilizar o fechamento (ex.: fecha 5 de 10), **sem alterar o plano
   original**:
   - Guiado pela **prioridade GUT** definida no Centro de Planejamento.
   - **Motivo da aprovação parcial é OBRIGATÓRIO.**
   - Fica registrado o plano completo × o que foi aprovado (ajuda o
     Coordenador na reavaliação e o Planner no próximo plano).
   - Os procedimentos **não aprovados ficam em evidência** ("não aprovados
     pelo cliente neste bloco/etapa").
   - **Alerta futuro ao Planner:** quando o cliente voltar ao Centro de
     Planejamento, mostrar os procedimentos não aprovados no passado + opção
     de incluí-los (ou não) no novo plano.
   - A aprovação parcial **vai registrada no contrato** que o cliente assina.
5. **Devolução ao Planejamento:** se o cliente não aprovar (e não houver
   secundários que resolvam), o Consultor devolve à Fase 3 **com
   considerações obrigatórias** sugerindo alterações.
6. **Fechamento (Assistente Comercial):** contrato assinado via **ZapSign** +
   cobrança via **ASAAS** (link de pagamento, boletos, PIX). Toda condição
   negociada (desconto, parcelamento, aprovação parcial) **entra no contrato**.
7. **Pós-fechamento:**
   - Cliente vai à **Fase 5**, estado **"Aguardando iniciar tratamento"**.
   - **Recepcionista:** mensagem FORTE + **pop-up** para iniciar conversa com
     o cliente e sugerir agendamentos (e preparar as boas-vindas).
   - **Coordenador Clínico:** notificação (acompanhar o tratamento inteiro,
     garantidor da execução com excelência).
   - **Gerente:** notificação com o **valor da venda** (reforçando a melhor
     entrega ao cliente).
   - Quando o cliente **conclui a 1ª sessão** do planejado: estado vira
     **"Em tratamento"**, o cliente **sai da lista do Consultor** e o
     Consultor recebe notificação de que o tratamento iniciou.

## 3. Follow-up

- Quando não há fechamento na apresentação, o cliente entra em **follow-up**.
- **Cadência configurável:** nº de tentativas, intervalo entre elas, prazo
  máximo para encerrar o follow-up.
- **Registro detalhado** de todo o follow-up (cada tentativa, resultado).
- Acompanhamento **claro e intuitivo** dos clientes em follow-up.
- Tentativas esgotadas sem fechamento → **encaminha à Gerente da unidade**
  para novas tentativas ("follow-up na clínica").

## 4. Kanban do Comercial

Colunas: **A apresentar → Acontecendo agora → Apresentados → Follow-up →
Fechamentos → Aguardando iniciar tratamento → Tratamento iniciado** +
**Cancelado**, **Perdido**, **Follow-up na clínica**.

## 5. Dashboard do Comercial

Métricas: apresentações realizadas; total de oportunidades; vendas
realizadas; total de fechamentos; perdas; **taxa de conversão**; tempo médio
F4→F5; clientes em follow-up; **ticket médio**; valor total de fechamento;
valor total e ticket médio **por pilar da metodologia**; total e média de
**desconto aplicado**; **parcelamento médio**; valor total **por tipo de
pagamento** (cartão, cartão parcelado, boleto, PIX, crédito recorrente,
depósito à vista).
Escopos: **Admin** = consolidado ou por unidade; **Gerente/Franqueado** = a
própria unidade.

## 6. Regras comerciais (config em cascata)

- Padrão da REDE + ajuste por UNIDADE (mesmo padrão dos SLAs): **descontos
  máximos, parcelamentos, meios de pagamento** (boleto, cartão, PIX).
- Negociação **fora da regra** → **alerta forte e insistente** ao **Gerente
  da unidade**, que autoriza (ou não) a condição.
- **Política de cancelamento e reembolso** (detalhar as regras com o dono).

## 7. Venda direta na unidade (fluxo excepcional)

Para casos que não passam por avaliação/planejamento/comercial:
urgência/emergência, consulta avulsa paga, limpeza, restauração quebrada etc.
**Spec completa passada pelo dono em 23/07/2026** (substitui a versão simples
entregue no COM5 v1).

### 7.1 Onde se lança
- Botão **"VENDA DIRETA"** no **prontuário**, ao lado de "Novo agendamento",
  abrindo um **pop-up** de lançamento.

### 7.2 Vínculo obrigatório com um ATENDIMENTO
- Toda venda direta é associada a um **atendimento** (já realizado ou a realizar).
- Se o procedimento **ainda não foi realizado / está sendo realizado**: indicar
  **qual atendimento/agendamento** está relacionado.
- Se **já foi realizado** (urgência/emergência: o profissional atende e depois
  lança): é **EXCEÇÃO** → **alerta a quem está lançando** + os dados vão para
  **franqueado, gerente e admin** (por unidade), para a equipe corrigir o fluxo.

### 7.3 Configuração dos procedimentos (Admin, na seção Procedimentos)
- Cada procedimento tem um **seletor "autorizado para venda direta"**, com
  **indicador visível** na lista de todos os procedimentos autorizados.
- Cada procedimento define também **quem pode lançar**: **Recepção** e/ou **SDR**.
- O **modelo de planilha de importação** precisa ser atualizado com todos os
  campos já configurados (incluindo os de venda direta).

### 7.4 Autorização por papel
| Papel | Lançar | Fechar (assinatura + pagamento) |
|---|---|---|
| **Gerente** | todos os liberados p/ venda direta | **todos** |
| **Coordenador Clínico** | todos os liberados p/ venda direta | **nenhum** — e **nem define** pagamento/parcelamento |
| **Recepcionista** | só os liberados **para recepcionista** | **todos** |
| **SDR** | só os liberados **para SDR** | só os **liberados p/ SDR** |

### 7.5 Fechamento (mesma regra de ouro)
- **Contrato assinado + pagamento realizado/emitido** — igual à venda do Consultor.
- Quem **solicita a assinatura** e **envia o link de pagamento**: **recepcionista
  ou SDR**. (A SDR precisa cobrar a consulta **antes** de o cliente vir à clínica
  — por isso ela tem venda direta.)
- **Regras comerciais** (rede ou personalizadas da unidade) **valem também aqui**:
  não permite fechar fora do padrão. **Desconto fora do configurado não é
  permitido**; **só o Gerente** pode definir **acréscimo** no valor.
- **Programas** (Risarte Empresarial e, no futuro, o **riso+** de prevenção):
  obedecem às regras de **descontos, condições de pagamento, prazos e carências**.

### 7.6 Pop-up de lançamento (o que a tela mostra)
- Lançar **um ou vários procedimentos**; mostra o **total**.
- Se houver programa com desconto: mostra **preço normal → desconto → valor final**.
- Mostra as **formas de pagamento e parcelamento permitidos** (seletor já com as
  parcelas liberadas).
- Definida a condição de pagamento, **libera emitir o documento para assinatura**
  e **realizar o pagamento**.
- Se o **total ficar R$ 0,00** (desconto de programa), o botão de pagamento já
  marca **pagamento realizado**.

### 7.7 Efeitos no prontuário e no comercial
- A venda direta **cria procedimentos EM ABERTO** no prontuário, na aba
  **"Sessões e Procedimentos"**. Quando o procedimento foi lançado **após** o
  atendimento, o **dentista pode "dar baixa"** (concluído/finalizado).
- O **Consultor Comercial responsável pela unidade** recebe **notificação** de
  cada venda direta **com o valor total**; as notificações ganham um **filtro
  específico de vendas diretas**.

### 7.8 Decisões do dono (23/07/2026)
- **Pagamento em DOIS passos:** "cobrança emitida" (fica **pendente**) → "pagamento
  **confirmado**" (só aí a venda é **concluída**, junto com o contrato assinado).
- **Atendimento obrigatório no lançamento:** o pop-up **exige escolher ou criar**
  o agendamento na hora — não existe venda direta sem atendimento vinculado.
- **Coordenador Clínico (corrigido pelo dono):** ele **APENAS lança os
  procedimentos** — é o profissional com o conhecimento técnico, o **responsável
  técnico**, e precisa estar alinhado com o que foi/será realizado no cliente.
  Ele **não vê nem define** forma de pagamento e parcelamento. Quem define as
  condições e faz o **fechamento** é a **Recepcionista ou o Gerente** (a venda
  fica "aguardando fechamento" e a recepção é **notificada**).
- Ordem de construção: **VD1** (configuração dos procedimentos + base/permissões)
  → **VD2** (pop-up no prontuário + fechamento + procedimentos em aberto) →
  **VD3** (tela Comercial + notificações + painel de exceções) → números no COM6.

### 7.9 Tela Comercial e Dashboard
- Na tela **Comercial**: detalhamento de **todas as vendas diretas por unidade**,
  com filtro **unidade específica × todas** e **período**; mostrar se o
  **fechamento saiu correto** (assinatura + pagamento), **sinalizando pendências**
  e o que foi **finalizado/concluído**.
- No **Dashboard do Comercial**: **quantidade** de vendas diretas, **ticket
  médio**, **valor total**, **quantidade de procedimentos** e **ranking dos
  procedimentos mais vendidos**. Consolidado **e** por unidade.

## 8. Split de pagamento (ponte com o Financeiro)

- Todo recebimento da unidade sofre **split**: Royalties (Risarte
  Franchising), Comercial, Centro de Planejamento, Fundo de propaganda.
- **Só o Admin configura** (padrão da rede + por unidade se necessário).
  Gerente/Franqueado apenas visualizam.

## 9. Cockpit do Consultor Comercial

Deve mostrar/permitir:
- Informações do cliente + **unidade a que pertence** + **nome do consultor
  responsável**; se o cliente é o **principal decisor** da negociação; selo
  **Risarte Empresarial**/outros programas.
- **Planos de tratamento detalhados** (principal + secundários aprovados).
- **Histórico:** aprovações de planos, planos finalizados e aprovados,
  pendências (procedimentos em aberto / reprovados / em revisão),
  **situação financeira** (em aberto × pago).
- Acesso à **apresentação do plano**; **WhatsApp do cliente** em 1 clique;
  **link fácil de videochamada**; **gravação da apresentação**; **resumo da
  apresentação**; espaço para **considerações do consultor**; atalho para o
  **dashboard comercial**.

## 10. Integrações

- **Google Meet** (videochamada da apresentação).
- **ZapSign** (contrato + plano assinados) — edge function pronta p/ plugar.
- **ASAAS** (link de pagamento, boleto, PIX, split) — edge function pronta
  p/ plugar.
- **Transcrição por IA** da gravação da apresentação (entra no lote de
  integrações; manual-primeiro = consultor revisa/edita o resumo).

## 10b. Gravação da apresentação (adição do dono, 22/07/2026)

- **Toda apresentação é gravada do início ao fim** (mesma infraestrutura
  segura das consultas clínicas — bucket privado, links assinados).
- Ao final: **transcrição + resumo**. Manual-primeiro: o consultor escreve/
  revisa o resumo; a transcrição automática por IA vem no lote de integrações.
- O **resumo é inserido no documento que o cliente assina** (contrato, COM4),
  junto das condições negociadas e da aprovação parcial.

## 10c. Honorário do Consultor Comercial (adição do dono, 22/07/2026)

- Composição: **parte fixa + variável** (a variável sobre as apresentações
  realizadas OU sobre as unidades sob responsabilidade — regra exata será
  definida no briefing do Financeiro).
- **Momento:** o cálculo/pagamento vive no **módulo Financeiro** (junto da
  remuneração dos dentistas). O Comercial registra desde o COM1 os
  dados-fonte (apresentações, fechamentos, valores, consultor e unidade).

## 11. Decisões do dono (22/07/2026)

- **Ordem dos lotes:** COM1 Negociação+regras → COM2 Cockpit do Consultor →
  COM3 Kanban+Follow-up → COM4 Fechamento → COM5 Venda direta → COM6 Dashboard.
- **Integrações manual-primeiro:** Assistente marca "contrato assinado" e
  "pagamento confirmado" à mão; link do Meet colado. A regra de ouro já vale.
  ZapSign/ASAAS/Meet reais entram em lotes próprios quando houver contas/chaves.
- **Split de pagamento fica no módulo Financeiro** (o Comercial registra a
  venda; o rateio nasce com o módulo de dinheiro).

### Ainda pendentes
- Detalhe da política de cancelamento/reembolso.
- "Principal decisor": registrado pelo Consultor na própria negociação
  (proposta — confirmar no COM1/COM2).

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

- **Lista configurável** de procedimentos "vendáveis" direto na clínica.
- **Recepcionista** faz o fechamento; **Coordenador Clínico** lança o
  procedimento; **Gerente** pode fazer os dois. Ausência de um deles **não
  trava o fluxo**.
- **Tudo registrado no módulo comercial** (entra nos números).

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

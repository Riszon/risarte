# Integração Asaas × riSZon — Especificação

Versão 3 · 10 de novembro de 2026 · Responsável: Jeferson Lopes (Risarte Odontologia)

Este arquivo é a fonte da verdade da integração. Fica em `docs/integracao-asaas.md` no repositório do riSZon.

**O que mudou da versão 2 para a 3.** A versão 3 registra as decisões tomadas na aprovação do plano final da ASA0 (10/11/2026) e o que a ASA0 entregou:

- **Taxa vigente no pagamento.** Vale o percentual da taxa da franquia e a tarifa do Asaas vigentes na data do pagamento. Quando uma taxa ou uma tarifa muda, o riSZon atualiza o split das cobranças em aberto. Isso substitui o "percentual congelado na emissão" (seção 4).
- **Rota mínima de webhook já na ASA0.** A ASA0 entrega a rota que confere o token, grava o evento bruto e responde 200, e a tabela `gateway_webhook_events`. O processamento continua na ASA2 (seção 7).
- **Chave fora da Vercel.** `ASAAS_API_KEY` fica só no `.env.local`, para o roteiro das contas de teste. Em tempo de execução, toda chave vem do Supabase Vault (seção 10).
- **Verificação semanal de cada conta.** Valida a chave, atualiza a situação e as tarifas e evita a desativação por 3 meses sem uso. Falha derruba a prontidão e avisa o Admin Master (seção 9.1).
- **Prontidão.** Entram "antecipação automática desligada, conferida pela API", "split habilitado" como declaração do Admin Master (confirmada sozinha pela ASA3 no primeiro split aceito) e "termo de autorização registrado" (data, quem assinou e observação; anexo e assinatura pelo ZapSign ficam preparados para depois).
- **Matriz 9.3.** A Recepcionista continua podendo registrar recebimento manual. O distrato continua só com o Gerente de Unidade e o Admin Master; o Financeiro da Franqueadora acompanha, sem concluir.
- **Baixa por PIX e boleto (ASA2).** `PAYMENT_RECEIVED` sem `PAYMENT_CONFIRMED` anterior é tratado como baixa e liquidação. Para a D21, a ordem é: marcar pagamento confirmado, fechar a venda, dar baixa.
- **Tarifas.** `acquirer_rates` ganhou o mínimo e o máximo da tarifa percentual (ASA0); a modalidade Pix Automático entra na ASA4B.
- **Pix Automático e cartão recorrente (ASA4B).** Registradas as restrições conferidas na documentação e a alternativa a avaliar (seção 5).
- **Régua.** O custo de SMS, WhatsApp e ligação fica com a conta da unidade; a aba Cobrança e comunicação mostra que cada canal é tarifado.

**Acréscimo à versão 3 — resposta escrita do Asaas (11/11/2026).** A equipe Sucesso de Integrações do Asaas respondeu por escrito às dúvidas técnicas. O registro completo está na **seção 13**; as seções 4, 5, 10, 11 e 12 foram ajustadas. Nada disso muda a ASA0. Em resumo:

- O split percentual incide sobre o valor efetivamente pago (passo 2 da prova do split cumprido).
- Uma entrada de split aceita `percentualValue` e `fixedValue` juntos (o formato da seção 4 está confirmado).
- Estorno total reverte o split; boleto pago pelo QR Code PIX é tarifado como PIX.
- O Pix Automático tem jornada sem pagamento inicial e aceita split com valor variável.
- A tokenização de cartão é nativa, sem liberação.
- A NFS-e de cobrança avulsa é pedida pelo riSZon.

**O que mudou da versão 1 para a 2.** A versão 2 incorpora o relatório de aderência do Claude Code (código real e documentação atual do Asaas) e as decisões tomadas em seguida:

- Reaproveita o que o riSZon já tem (taxas da rede, tarifas por meio de pagamento, split do Empresarial) em vez de criar tabelas paralelas.
- Toda unidade entra como conta vinculada; a criação de subconta fica desligada até o Asaas confirmar a viabilidade para franquias.
- Taxas percentuais incidem sobre todo recebimento, sem condições; SDR e tecnologia são valor fixo mensal.
- Pagamento confirmado apenas sinaliza a situação financeira; não há bloqueio clínico.
- Entram as mensalidades do PPR+ e da Ortodontia e a recorrência (Pix Automático e cartão de crédito recorrente).
- A prova do split passa a ter três passos, porque o sandbox não testa desconto nem multa.

---

## 1. Visão geral

O riSZon passa a emitir todas as cobranças da rede pelo Asaas, com baixa automática e split dos repasses à franqueadora já na origem. Todo recebimento — parcela de tratamento, renegociação, venda direta na clínica, mensalidade do PPR+ ou da Ortodontia, implantação ou mensalidade do Empresarial — nasce no riSZon, vira uma cobrança no Asaas e pode ser enviado ao pagador como link de pagamento.

**O que resolve**

- Fim da baixa manual de parcelas: o Asaas avisa o riSZon quando o pagamento entra.
- As taxas percentuais da franquia saem automaticamente da conta da unidade para a franqueadora, no próprio pagamento.
- Um único padrão de cobrança para as 2 unidades atuais e para as próximas.
- Menos inadimplência com cobrança recorrente automática (Pix Automático e cartão recorrente).
- Base real de recebimentos para o Módulo Financeiro.

**Escopo**

- Boleto, PIX e cartão de crédito (à vista e parcelado).
- Recorrência: Pix Automático e cartão de crédito recorrente.
- Link de pagamento para qualquer recebimento.
- Cobranças do Risarte Empresarial, emitidas pela franqueadora, com split para a RisLife.
- Split das taxas percentuais à franqueadora; cobrança mensal das taxas fixas.
- Lembretes pela régua nativa do Asaas até o WhatsApp da Risarte estar integrado ao riSZon.
- NFS-e pelo Asaas, em fase própria (ASA8).
- Central de Configuração: uma única tela para toda a configuração comercial e financeira.

**Fora desta integração:** remuneração de dentistas, antecipação de recebíveis, negativação, débito recorrente em cartão de débito ou em conta (o Asaas não oferece; o Pix Automático cumpre esse papel) e bloqueio de atendimento por falta de pagamento.

---

## 2. Decisões travadas

Vinte e duas decisões definem o desenho, fechadas entre 9 e 10 de novembro de 2026. Mudar qualquer uma delas exige revisar o modelo de dados.

| # | Tema | Decisão |
| --- | --- | --- |
| D1 | Quem recebe do paciente | O CNPJ da unidade emite e recebe todas as cobranças de paciente. |
| D2 | Contas Asaas | Toda unidade entra como **conta vinculada**: tem a própria conta Asaas e autoriza o riSZon a operá-la. Londrina e Cambé já têm conta. A Risarte Administração tem a conta raiz. A criação de subconta pela franqueadora fica construída, mas desligada, até o Asaas confirmar que é viável para franquias com CNPJ diferente. |
| D3 | Taxas percentuais (split) | Royalties, fundo de marketing, centro de planejamento e comercial são percentuais sobre **todo recebimento** de paciente, sem condições, e saem no split. |
| D4 | Base de cálculo | **Valor efetivamente pago pelo cliente** — com desconto, sobre o valor com desconto; com multa e juros, sobre o valor com multa e juros —, liquidado sempre no próprio split, sem acerto posterior. Percentuais configurados por unidade, com vigência. |
| D5 | Taxas fixas | SDR e tecnologia (sistema) são **valor fixo mensal por unidade**. Ficam fora do split e entram na cobrança mensal da franqueadora para a unidade. |
| D6 | Fundo de marketing | Por enquanto vai para a carteira da franqueadora; a carteira de destino é configurável para quando o fundo tiver conta própria. |
| D7 | Risarte Empresarial | A franqueadora emite as cobranças das empresas. **Implantação: 100% RisLife. Mensalidade: 50% RisLife e 50% Risarte**, sobre o valor pago. Percentuais configuráveis, com exceção por empresa. A unidade não recebe parte; a RisLife repassa ao consultor. |
| D8 | Pagador | A cobrança sai no CPF do responsável financeiro quando houver. Para menor, o responsável é obrigatório. Adulto pode ter um pagador opcional (cônjuge, pai, mãe). Exatamente um responsável fica marcado como financeiro. |
| D9 | Multa, juros e descontos | Vêm do que o riSZon já tem: multa, juros e arredondamento nas configurações financeiras; desconto à vista nas Regras Comerciais; pontualidade como benefício de programa, perdido no atraso; vouchers do Indica. **Carência fixa em zero** (11/11/2026): o Asaas não aplica carência, e o banco recusa outro valor (seção 14). |
| D10 | Cartão parcelado | A unidade absorve a tarifa. O máximo de parcelas vem das Regras Comerciais e das condições do programa do cliente. |
| D11 | Situação financeira | Pagamento confirmado **sinaliza** "em dia" ou "em atraso" na agenda e na ficha do cliente. O riSZon não bloqueia procedimento por falta de pagamento. |
| D12 | Distrato | Nada é cancelado no Asaas antes de o Gerente de Unidade concluir a checklist (pendências, procedimentos feitos × pagos, multa contratual). Só ao efetivar o distrato as cobranças em aberto são canceladas. |
| D13 | Devolução de repasse | Repasses já feitos à franqueadora **não são devolvidos** em distrato nem em estorno. Sem split (até a ASA3), a taxa da rede da baixa estornada continua devida; o Financeiro da Franqueadora e o Admin podem dispensá-la com motivo (16.5). |
| D14 | Comunicação | Régua nativa do Asaas agora; migra para o WhatsApp da Risarte no riSZon depois. |
| D15 | Gatilhos de cobrança | Contrato assinado no ZapSign; renegociação assinada; venda direta na clínica; mensalidades do PPR+ e da Ortodontia; implantação e mensalidade do Empresarial; cobrança mensal da franqueadora à unidade; link avulso. |
| D16 | Link de pagamento | Todo recebimento gerado no riSZon tem link copiável e enviável ao pagador. |
| D17 | Cobranças já existentes | As cobranças em aberto emitidas direto no Asaas **não são migradas**. Vão sendo reemitidas pelo riSZon aos poucos. |
| D18 | Nota fiscal | NFS-e pelo Asaas: a do paciente **a cada parcela recebida**; a de royalties e taxas, **uma nota mensal consolidada por unidade**. O Asaas entra como operador de dados no termo de privacidade. |
| D19 | Central de Configuração | Todas as configurações comerciais e financeiras ficam numa **única tela**, no padrão da rede e por unidade. As telas atuais passam a ser abas dela. |
| D20 | Recorrência | **Pix Automático** e **cartão de crédito recorrente** como meios de pagamento, para crediário, mensalidades do PPR+ e da Ortodontia e mensalidade do Empresarial. Não há débito recorrente. |
| D21 | Fechamento da venda | A confirmação de pagamento do Asaas para a primeira cobrança de um contrato fecha a venda automaticamente, no lugar da confirmação manual. |
| D22 | Reaproveitar o que existe | A integração estende as estruturas atuais (`network_fees`, `split_charges`, `acquirer_rates`, `empresarial.split_rules`, contas a pagar de taxa) em vez de criar tabelas paralelas. Nenhum valor pode ser lançado duas vezes no razão. |

**Regra de ouro:** o riSZon é a fonte da verdade de *o que* cobrar e *quanto repassar*; o Asaas é a fonte da verdade de *o que foi pago*. Nenhuma baixa é feita à mão quando a cobrança existe no Asaas.

---

## 3. Arquitetura de contas e carteiras

Cada unidade tem a própria conta Asaas e entra no riSZon como conta vinculada: o franqueado gera a chave de API na conta dele e o riSZon busca o identificador de carteira (walletId). A Risarte Administração tem a conta raiz, que emite o Empresarial e a cobrança mensal às unidades e recebe os splits.

**Dois fluxos de dinheiro**

```
Paciente ──paga──> Conta da unidade ──split──> Carteira da franqueadora
                   (CNPJ da unidade              (royalties, marketing,
                    emite e recebe)               planejamento, comercial)

Empresa ──paga──> Conta raiz da franqueadora ──split──> Carteira da RisLife
                  (emite o Empresarial)

riSZon: cria as cobranças via API e recebe os webhooks de todas as contas.
```

**Como cada conta entra no riSZon**

| Conta | Titular | Papel no fluxo | Origem no riSZon |
| --- | --- | --- | --- |
| Conta raiz | Risarte Administração | Emite o Empresarial e a cobrança mensal às unidades; recebe os splits | Chave de API cadastrada pelo Admin Master |
| Conta vinculada | Cada unidade (Londrina, Cambé e as próximas) | Emite e recebe todas as cobranças de paciente | Chave gerada pelo franqueado; o riSZon busca o walletId |
| Carteira de repasse | RisLife e outros recebedores | Só recebe split | Apenas o walletId é cadastrado |

**Por que não subcontas.** Depois do período de avaliação do Asaas, gerenciar a chave de uma subconta exige operação BaaS ou filiais com o mesmo prefixo de CNPJ. Franquias têm CNPJ diferente. A criação de subconta fica construída e desligada; no sandbox ela é usada só para criar as contas de teste.

**Cuidados obrigatórios**

- A chave de API dá acesso total à conta da unidade, inclusive a transferências. Exige termo de autorização do franqueado, registrado na Central.
- A chave é colada numa tela do riSZon que grava direto no Supabase Vault. Nunca passa por WhatsApp, e-mail ou chat, e nunca é exibida depois de gravada. Todo uso é registrado.
- Chave sem uso por 3 meses é desativada pelo Asaas; com 6 meses expira. A Central mostra o último uso e avisa antes.
- O split precisa ser habilitado à mão no painel de cada conta emissora (Integrações › Segurança).
- Cada conta precisa de uma chave Pix cadastrada; sem ela, o QR Code vale só até o fim do dia.
- Todas as chamadas ao Asaas saem do servidor, com a chave da conta certa por `clinic_id`.

---

## 4. Regras do split e das taxas

Os repasses percentuais incidem sobre o **valor efetivamente pago pelo cliente** e saem sempre no próprio split, no momento do pagamento, sem acerto posterior.

**Taxas da franquia**

| Taxa | Tipo | Como é cobrada |
| --- | --- | --- |
| Royalties | % sobre todo recebimento | Split |
| Fundo de marketing | % sobre todo recebimento | Split (carteira configurável) |
| Centro de planejamento | % sobre todo recebimento | Split |
| Comercial | % sobre todo recebimento | Split |
| SDR | Valor fixo mensal por unidade | Cobrança mensal da franqueadora à unidade |
| Tecnologia (sistema) | Valor fixo mensal por unidade | Cobrança mensal da franqueadora à unidade |

As taxas já existem no riSZon (`network_fees`, tela `/financeiro/taxas-da-rede`), com percentual por unidade, exceções, campanhas com data e o percentual congelado em cada recebimento (`split_charges`). A integração estende essa estrutura com a carteira de destino e a marca de "retido na origem". Hoje a unidade recebe tudo e paga a rede por conta a pagar mensal; com o split, a taxa percentual retida na origem **não** gera conta a pagar.

**Como o split é montado**

1. **Uma entrada por carteira.** O riSZon soma os percentuais de todas as taxas destinadas à mesma carteira e envia uma única entrada ao Asaas. O rateio por taxa fica registrado no riSZon (`charge_splits`).
2. **Percentual + compensação da tarifa.** O percentual nativo do Asaas incide sobre o valor líquido, depois da tarifa. Para o repasse fechar sobre o valor pago, a entrada leva `percentualValue` = soma dos percentuais e `fixedValue` = soma dos percentuais × tarifa do meio de pagamento. **Formato confirmado pelo Asaas (11/11/2026):** a mesma entrada aceita os dois campos, e o transferido é `fixedValue + netValue × percentualValue / 100`. O desenho exato da compensação para cada tipo de tarifa (fixa, percentual com mínimo e máximo, boleto pago pelo QR Code PIX) é da ASA3 — ver a seção 13.
3. **Tarifa conhecida na emissão.** Toda cobrança sai com o meio de pagamento definido. As tarifas vêm de `acquirer_rates`, preenchidas automaticamente pela consulta de tarifas do Asaas (`GET /myAccount/fees`), com vigência e fim de promoção: a tarifa promocional vale até a data de fim e a cheia já fica cadastrada para o dia seguinte. Tarifa que muda fecha a vigência da anterior; nada é sobrescrito. A tarifa percentual pode ter mínimo e máximo (PIX).
4. **Taxa vigente no pagamento.** Vale o percentual da taxa da franquia e a tarifa do Asaas vigentes na data do pagamento. A cobrança sai com os valores vigentes na emissão; quando uma taxa da franquia ou uma tarifa do Asaas muda (inclusive no fim de uma tarifa promocional), o riSZon atualiza o split das cobranças em aberto. Cobrança já paga não muda. Detalhe na ASA3.
5. **Arredondamento.** Parte fixa com 2 casas e percentual com até 4; a diferença de centavos fica com a unidade.
6. **Teto de segurança.** Antes de emitir, o riSZon confere que a soma dos repasses não passa do valor líquido no pior caso (maior desconto possível). Se passar, a cobrança não sai e o financeiro é avisado.
7. **Cartão parcelado.** O split é aplicado em cada parcela do cartão e liquidado a cada recebimento.
8. **Recebimento fora do split.** Dinheiro, maquininha física, cobranças antigas (D17) e qualquer pagamento sem split geram a conta a pagar de taxa que já existe hoje.
9. **Cobrança mensal à unidade.** Uma vez por mês, a conta raiz emite uma cobrança por unidade com as taxas fixas (SDR e tecnologia) e as contas a pagar de taxa do período. A nota mensal consolidada cobre essa cobrança e os splits recebidos no mês.
10. **Estorno.** O Asaas reverte o split automaticamente no estorno. Como repasses não são devolvidos (D13), o riSZon lança o valor revertido como conta a pagar da unidade.

**Formato da entrada: confirmado pelo Asaas (11/11/2026).** Uma entrada por carteira, com `percentualValue` e `fixedValue` juntos. O teste em sandbox vira só uma confirmação. As alternativas antigas (duas entradas para a mesma carteira, percentual ajustado) saem do desenho.

**Prova do split em três passos**

1. **Sandbox:** pagamento no prazo, nos três meios, e a confirmação do formato da entrada. O sandbox não testa desconto, multa nem juros em boleto e PIX.
2. ✅ **Confirmação por escrito do Asaas (11/11/2026):** o percentual incide sobre o `netValue` do valor efetivamente pago — com desconto, sobre o pago com desconto; com multa e juros, sobre o pago com encargos. Vale para boleto, PIX e cartão; no cartão parcelado, sobre o líquido de cada parcela. A antecipação reduz a base.
3. **Teste real com valores mínimos**, antes do piloto e com aprovação do Jeferson: três cobranças pagas com desconto, no prazo e com multa. Continua valendo, agora como conferência final.

**Empresarial**

- Usa as regras que já existem em `empresarial.split_rules` (padrão e exceção por empresa).
- **Implantação:** 100% para a carteira da RisLife. Como o Asaas só repassa até o valor líquido, a RisLife recebe o valor pago menos a tarifa.
- **Mensalidade:** 50% para a RisLife e 50% para a Risarte, sobre o valor pago. Hoje o cálculo é sobre o valor total; passa a ser sobre o pago.
- O cliente HTTP antigo e a Edge Function de webhook do Empresarial, nunca publicados, são aposentados em favor do cliente e da rota únicos.

**Exemplo ilustrativo** (percentuais e tarifa fictícios): boleto de R$ 1.000,00 com 5% de desconto até o vencimento, tarifa de R$ 2,00 e taxas que somam 8% para a carteira da franqueadora. A entrada vai como 8% + R$ 0,16.

- Pago no prazo, R$ 950,00 → líquido R$ 948,00 → 8% = R$ 75,84 + R$ 0,16 = **R$ 76,00**, exatamente 8% de R$ 950,00.
- Pago em atraso, R$ 1.020,00 → líquido R$ 1.018,00 → R$ 81,44 + R$ 0,16 = **R$ 81,60**, exatamente 8% de R$ 1.020,00.

---

## 5. Meios de pagamento

| Meio | Uso | Observação |
| --- | --- | --- |
| Boleto | Parcelas, mensalidades, Empresarial | Com QR Code Pix quando a conta tem chave Pix |
| PIX | Venda direta, parcelas, link | QR Code na tela ou no link |
| Cartão de crédito à vista ou parcelado | Tratamentos | Ocupa o limite inteiro; até 21x (Visa e Mastercard) ou 12x (demais), dentro do máximo das Regras Comerciais |
| Pix Automático | Crediário, PPR+, Ortodontia, Empresarial | O pagador autoriza uma vez e as cobranças seguintes são debitadas da conta dele |
| Cartão de crédito recorrente | Crediário, PPR+, Ortodontia | O cartão fica tokenizado e é cobrado todo mês; ocupa só o valor do mês |

**Regras da recorrência (D20)**

- O riSZon cria cada cobrança, uma a uma, vinculada à autorização do Pix Automático ou ao token do cartão. O Asaas não gera as cobranças sozinho. Assim o split, os descontos e a multa continuam sob controle do riSZon.
- **Pix Automático:** exige conta PJ aprovada e CNPJ ativo há pelo menos 6 meses; unidades novas só podem usar depois disso. A autorização é criada sem valor fixo, no modo em que o riSZon cria cada cobrança (`MANUAL`), para aceitar desconto, multa e renegociação. Fonte dos dois requisitos: https://docs.asaas.com/docs/faq-2. **O Asaas confirmou (11/11/2026)** que há jornada de autorização **sem pagamento inicial**. Com a autorização prevendo valor variável ou teto, cada cobrança do modo `MANUAL` pode ter valor diferente **e split**. A ASA4B usa essa jornada, e a primeira parcela também sai com split. Se a jornada sem pagamento inicial não estiver disponível numa conta, vale a regra anterior: a primeira parcela gera conta a pagar de taxa. Cada cobrança precisa ser criada entre 2 e 10 dias úteis antes do vencimento, e a autorização pode ser recusada pela instituição do pagador — os dois pontos entram no desenho da ASA4B. A elegibilidade de Londrina e Cambé está com o gerente de contas.
- **Cartão recorrente:** o riSZon guarda só o token devolvido pelo Asaas. Dados de cartão nunca passam pelo banco, pelo servidor nem pelos logs do riSZon.
  - **O Asaas confirmou (11/11/2026)** que a tokenização é nativa, sem liberação. O `creditCardToken` volta ao criar ou pagar uma cobrança com o objeto `creditCard`, e pode ser usado todo mês em `POST /v3/payments` com split.
  - ⚠️ **Mas obter o token enviando o objeto `creditCard` faria os dados do cartão passarem pelo servidor do riSZon, o que a regra proíbe.** Essa parte continua **em aberto**: o Jeferson aguarda do Asaas se o token volta quando o paciente digita o cartão na fatura do Asaas, e qual IP usar na cobrança automática.
  - Até lá, a ASA4B não implementa o cartão recorrente. Fica como alternativa a assinatura nativa do Asaas com split.
- **Falha no débito:** se o débito automático ou o cartão for recusado, a cobrança continua em aberto, o pagador recebe o link pela régua e o gerente da unidade é avisado.
- **Cancelamento:** o pagador pode cancelar a autorização no banco dele; o riSZon recebe o evento, marca o cliente e volta a cobrar por link.
- As tarifas dos dois meios entram em `acquirer_rates`, porque a compensação do split depende delas.

---

## 6. Fluxos de cobrança por gatilho

| Gatilho | Quem dispara | Conta emissora | O que o riSZon cria no Asaas |
| --- | --- | --- | --- |
| Contrato de tratamento assinado (ZapSign) | Automático, pelo webhook do ZapSign | Unidade | Uma cobrança por parcela ou um parcelamento no cartão, com split |
| Renegociação assinada (ZapSign) | Automático, pelo webhook do ZapSign | Unidade | Cancela as cobranças em aberto renegociadas e cria as novas, com split |
| Venda direta na clínica | Recepcionista ou Gerente de Unidade | Unidade | Cobrança avulsa com PIX na tela ou link para o cartão, com split |
| Mensalidade do PPR+ e da Ortodontia | Automático, no ciclo mensal | Unidade | Uma cobrança por mensalidade, com split |
| Implantação do Empresarial | Financeiro da Franqueadora, na adesão | Franqueadora | Cobrança com split de 100% para a RisLife |
| Mensalidade do Empresarial | Financeiro da Franqueadora, uma vez por mês | Franqueadora | Uma cobrança por empresa ativa, com split de 50% para a RisLife |
| Cobrança mensal à unidade | Financeiro da Franqueadora, uma vez por mês | Franqueadora | Uma cobrança por unidade: taxas fixas e contas a pagar de taxa |
| Link avulso | Quem tem permissão de cobrar | Unidade ou franqueadora | Cobrança avulsa no meio de pagamento escolhido por quem emite |

**Passos comuns a todo gatilho**

1. Definir o pagador: o responsável financeiro, quando houver; senão, o próprio cliente.
2. Sincronizar o pagador: buscar por CPF/CNPJ na conta emissora antes de criar; guardar o ID do Asaas.
3. Aplicar multa, juros e descontos conforme a D9. O benefício de pontualidade vai como desconto válido até o vencimento.
4. Criar a cobrança com `externalReference` = ID da cobrança no riSZon (tabela `charges`), que é estável. O ID da parcela não serve, porque hoje as parcelas são apagadas e recriadas antes do recebimento.
5. Travar a parcela que tem cobrança emitida: ela não pode mais ser apagada nem recriada.
6. Gravar o ID do Asaas, o link da fatura, a linha digitável e o PIX copia e cola.
7. Exibir na ficha do cliente com **Copiar link** e **Enviar pelo WhatsApp**.

**Regras de segurança dos fluxos**

- Renegociação só cancela as cobranças antigas depois da assinatura do novo contrato. Hoje a renegociação é manual; a assinatura no ZapSign entra na ASA4.
- **Distrato:** hoje `apply_plan_cancellation` cancela as parcelas em aberto ao efetivar. Passa a exigir a checklist concluída antes de efetivar; só então as cobranças são canceladas no riSZon e no Asaas. Repasses já feitos não voltam.
- **Cobranças antigas (D17):** a parcela com cobrança emitida direto no Asaas fica marcada como *cobrança externa*. Para reemitir, o usuário informa a cobrança antiga e o riSZon a cancela no Asaas, após confirmação, antes de criar a nova.
- Cobrança já paga nunca é cancelada nem editada pelo riSZon.
- Timeout é tratado como resultado desconhecido: o riSZon nunca repete uma criação sozinho; consulta o Asaas pelo `externalReference` antes.
- Falha de envio deixa a cobrança em *Erro de emissão*, numa fila de nova tentativa visível ao financeiro.
- Os gatilhos do Indica em `payment_installments` não podem ser quebrados: toda mudança ali exige `npm run test:indica`.

---

## 7. Webhooks, baixa automática e conciliação

**Eventos ouvidos e efeito no riSZon**

| Evento do Asaas | Significado | Efeito no riSZon |
| --- | --- | --- |
| `PAYMENT_CREATED` | Cobrança criada | Confirma o registro |
| `PAYMENT_CONFIRMED` | Pago, saldo ainda não disponível | Baixa da parcela (**Paga**); se for a primeira cobrança do contrato, fecha a venda (D21); atualiza a sinalização "em dia" |
| `PAYMENT_RECEIVED` | Valor disponível na conta | **Liquidada**; entra no fluxo de caixa |
| `PAYMENT_OVERDUE` | Venceu sem pagamento | **Vencida**; sinaliza "em atraso"; alerta ao gerente |
| `PAYMENT_UPDATED` / `PAYMENT_DELETED` | Alterada ou removida no Asaas | Atualiza ou cancela; registra a origem |
| `PAYMENT_REFUNDED` | Estornada | **Estornada**; split revertido vira conta a pagar da unidade; alerta ao financeiro |
| `PAYMENT_CHARGEBACK_REQUESTED` | Contestação no cartão | Alerta ao Financeiro da Franqueadora |
| `PAYMENT_SPLIT_DONE` | Repasse liquidado | Marca o repasse como liquidado e grava o valor |
| Bloqueio por divergência de split | Split maior que o líquido | Alerta urgente: 2 dias úteis para ajustar |
| Eventos do Pix Automático | Autorização ativada, recusada ou cancelada; débito agendado ou recusado | Atualiza a autorização do cliente |

No cartão de crédito, o `PAYMENT_RECEIVED` chega cerca de 32 dias após a confirmação; por isso a baixa usa o `PAYMENT_CONFIRMED` e o caixa usa o `PAYMENT_RECEIVED`. Em PIX e boleto o `PAYMENT_RECEIVED` pode chegar sem `PAYMENT_CONFIRMED` anterior: nesse caso ele é tratado como baixa e liquidação ao mesmo tempo (a provar em sandbox na ASA2).

**Ordem da D21.** Hoje o banco recusa baixa enquanto a venda não fecha. Na primeira cobrança de um contrato, o riSZon marca o pagamento como confirmado, deixa a venda fechar e só então dá baixa, nessa ordem.

**O que a ASA0 já entregou.** A rota mínima: confere o token, grava o evento bruto em `gateway_webhook_events` (o mesmo evento não entra duas vezes) e responde 200. Token errado ou endereço desconhecido recebe 401, sem ler o corpo. Quem processa o evento é a ASA2.

**Regras técnicas**

- Uma URL por conta: `/api/webhooks/asaas/[ref]`, com identificador opaco, para saber a conta de origem antes de comparar o token. O riSZon cria o webhook pela API, com token gerado por ele.
- Valida o cabeçalho `asaas-access-token`; token inválido é recusado.
- Grava o evento bruto e responde 200 em seguida. Só o 200 conta como sucesso, o prazo de resposta é de 10 segundos e 15 falhas seguidas pausam a fila.
- Processamento idempotente pelo ID do evento. Status só avança, nunca regride (exceto estorno).
- Evento de cobrança que não nasceu no riSZon é registrado e ignorado.
- A baixa usa a função que já existe (`register_payment_receipt`, idempotente por `client_token`).
- O riSZon monitora a fila e avisa o Admin Master se ela pausar.

**Conciliação diária.** Uma rotina noturna, no mesmo padrão da conferência do ZapSign, compara as cobranças do dia em cada conta Asaas com o riSZon. As divergências aparecem num painel para o financeiro resolver.

---

## 8. Modelo de dados

Princípio (D22): estender o que existe. O schema real é validado antes de cada migração. As migrações do Asaas usam a faixa própria 4000+ e são apenas aditivas.

**Estruturas existentes que a integração estende**

| Existente | Mudança |
| --- | --- |
| `network_fees` e tela `/financeiro/taxas-da-rede` | Carteira de destino por taxa; vira a aba Taxas da franquia |
| `split_charges` | Marca de "retido na origem", para não gerar conta a pagar em dobro |
| `acquirer_rates` | Adquirente "Asaas" ligado a cada conta, preenchido pela consulta de tarifas, com mínimo e máximo da tarifa percentual e a origem da tarifa (ASA0); a modalidade Pix Automático e o cartão recorrente entram na ASA4B. O adquirente "Asaas" não vira o padrão da unidade enquanto a integração não emite cobrança |
| `empresarial.split_rules` e `adhesion_billing` | Split sobre o valor pago; ligação com a cobrança nova |
| `payment_installments` | `charge_id`; trava da parcela com cobrança emitida |
| `ppr_charges` e `ortho_charges` | Ligação com a cobrança no Asaas |
| Responsáveis do cliente | Marca de responsável financeiro; IDs estáveis (hoje são apagados e recriados a cada edição); adulto pode ter responsável |
| `clinics` | Campos fiscais (ASA8) |
| `finance_settings` e `commercial_rules` | Sem mudança de dados; as telas viram abas da Central |
| Contas a pagar de taxa | Origem da cobrança mensal à unidade |

**Tabelas novas**

| Tabela | Para que serve |
| --- | --- |
| `gateway_accounts` | Uma linha por conta Asaas: dono, CNPJ, walletId, referência da chave e do token no Vault, modo, ambiente, último uso da chave, termo de autorização |
| Log de uso de chave e log de chamadas | Quem usou a chave, para quê e quando; método, rota, status e duração de cada chamada, sem corpo, chave ou CPF |
| `split_recipients` | Carteiras que podem receber split (franqueadora, fundo de marketing, RisLife) |
| `gateway_customers` | Vínculo do pagador com o cliente Asaas por conta; dono polimórfico (cliente, responsável ou empresa), porque não existe uma entidade única de pessoa |
| `charges` | Cada cobrança emitida, com origem, pagador, meio de pagamento, valor, valor pago, status e links; também as externas (D17) |
| `charge_splits` | O split enviado em cada cobrança, o rateio por taxa e o valor liquidado |
| `payment_authorizations` | Autorizações de Pix Automático por pagador e conta |
| `card_tokens` | Token do cartão recorrente (só o token) |
| `gateway_webhook_events` | Evento bruto e idempotência |
| `reconciliation_issues` | Divergências da conciliação |
| Checklist de distrato | Itens e conclusão antes de efetivar |
| `service_invoices` | NFS-e pedidas ao Asaas (ASA8) |

**Status da cobrança:** Rascunho → Emitida → Paga → Liquidada, com os desvios Vencida, Cancelada, Estornada, Em contestação e Erro de emissão.

---

## 9. Telas e permissões

### 9.1 Central de Configuração

Rotas `/central/rede/[aba]` e `/central/unidades/[unidade]/[aba]`, com uma entrada no menu Administração. Um registro de abas no código: cada fase acrescenta a sua, nenhuma cria tela de configuração à parte.

No nível **Rede**, a franqueadora define o padrão. No nível **Unidade**, cada campo mostra *herdado da rede* ou *personalizado*, com botão para voltar ao padrão. A herança segue o padrão já usado em `finance_settings`: campo vazio na unidade herda da rede.

| Aba | O que reúne | Origem | Fase |
| --- | --- | --- | --- |
| Conta e tarifas | Vínculo da conta Asaas, situação, walletId, chave (só gravação, com data do último uso), webhook, tarifas | Nova | ASA0 |
| Financeiro | Multa, juros, arredondamento e alertas; a carência aparece só para leitura, fixa em zero | `/financeiro/configuracao` | ASA1 |
| Comercial | Desconto à vista, máximo de parcelas, meios de pagamento aceitos, condições por programa | `/admin/regras-comerciais` | ASA1 |
| Cobrança e comunicação | Régua de lembretes do Asaas: avisos, canais e prazos, com o aviso de que cada canal (SMS, WhatsApp, ligação) é tarifado na conta da unidade | Nova | ASA2 |
| Taxas da franquia | Taxas percentuais e fixas por unidade, carteira de destino, vigências | `/financeiro/taxas-da-rede` | ASA3 |
| Empresarial | Percentuais da RisLife na implantação e na mensalidade, exceções | `/empresarial/configuracoes` | ASA5 |
| Fiscal | Inscrição municipal, código de serviço, alíquota, emissão de NFS-e | Nova | ASA8 |

As telas atuais viram componentes compartilhados: ações, tabelas e regras de acesso ficam onde estão; só a moldura muda. As rotas antigas redirecionam para a aba.

**Recursos da Central**

- **Prontidão da unidade:** uma função do banco devolve o que falta. Itens da ASA0: conta validada, walletId, webhook ativo, tarifas, chave Pix, split habilitado no painel, termo de autorização registrado e antecipação automática desligada (conferida pela API); as fases seguintes acrescentam os delas. O Asaas não informa pela API se o split está habilitado: na ASA0 o item é uma declaração do Admin Master, e a ASA3 o confirma sozinha no primeiro split aceito. O termo é registrado pelo Admin Master com data, nome de quem assinou e observação; o anexo e a assinatura pelo ZapSign ficam preparados para depois.
- **Verificação semanal:** uma rotina verifica cada conta uma vez por semana: valida a chave, atualiza a situação e as tarifas e mantém a chave em uso (o Asaas desativa a chave parada há 3 meses). Se a chave for recusada, a prontidão cai e o Admin Master é avisado. Falha passageira (rede, Asaas fora do ar) não derruba nada: a conta é tentada de novo no dia seguinte.
- **Termo antes da chave do Gerente:** o Gerente só grava a chave da própria unidade depois de o termo estar registrado e de a permissão ser liberada; até lá, só o Admin Master. O banco confere as duas coisas. "Pronta para cobrar" exige a lista completa e a marcação do Admin Master, que cai sozinha se um item voltar a faltar. O riSZon não emite cobrança de unidade que não esteja pronta.
- **Histórico:** leitura sobre a trilha de auditoria que já existe, filtrada pelas tabelas de cada aba.
- **Copiar de outra unidade:** ao configurar uma unidade nova (ASA7).

### 9.2 Demais telas

| Tela | Onde fica | Para quê |
| --- | --- | --- |
| Aba Financeiro do cliente | Ficha do cliente | Parcelas com status e pagador, situação "em dia" ou "em atraso", **Copiar link**, **Enviar pelo WhatsApp**, cobrança avulsa, recebimento manual, autorização de Pix Automático ou cartão recorrente, reemitir cobrança externa, iniciar distrato |
| Venda direta | Ficha do cliente (modal) | Valor, descrição e meio de pagamento; PIX na tela ou link |
| Faturamento do Empresarial | Empresarial | Implantações e mensalidades do mês por empresa, emissão em lote |
| Cobrança mensal às unidades | Franqueadora | Prévia por unidade e emissão com nota consolidada |
| Painel de cobranças | Unidade | A vencer, vencidas e pagas; cobranças externas a reemitir; débitos recorrentes recusados; distratos |
| Painel de repasses | Franqueadora | Repasse liquidado por unidade e taxa, conferido contra o percentual sobre o valor pago |
| Conciliação | Franqueadora | Divergências entre Asaas e riSZon |

### 9.3 Matriz de permissões

| Ação | Admin Master | Financeiro da Franqueadora | Gerente de Unidade | Recepcionista | Assistente Comercial | Consultor Comercial | Consultor RisLife |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Vincular conta Asaas | Sim | Não | Própria unidade, após o termo registrado | Não | Não | Não | Não |
| Marcar unidade como pronta | Sim | Não | Não | Não | Não | Não | Não |
| Editar taxas da franquia | Sim | Sim | Não | Não | Não | Não | Não |
| Editar multa e juros | Sim | Sim | Não | Não | Não | Não | Não |
| Editar Regras Comerciais | Sim | Não | Não | Não | Não | Não | Não |
| Ver cobranças e enviar link | Rede | Rede | Própria unidade | Própria unidade | Seus clientes | Seus clientes | Não |
| Emitir venda direta e link avulso | Sim | Sim | Própria unidade | Própria unidade | Não | Não | Não |
| Registrar recebimento manual | Sim | Sim | Própria unidade | Própria unidade | Não | Não | Não |
| Renegociar parcelas | Sim | Sim | Própria unidade | Não | Não | Não | Não |
| Iniciar e concluir distrato | Sim | Acompanha, sem concluir | Própria unidade | Não | Não | Não | Não |
| Emitir cobranças do Empresarial | Sim | Sim | Não | Não | Não | Não | Não |
| Emitir cobrança mensal às unidades | Sim | Sim | Não | Não | Não | Não | Não |
| Ver painel de repasses | Rede | Rede | Própria unidade | Não | Não | Não | Não |
| Ver pagamentos das empresas | Rede | Rede | Não | Não | Não | Não | Suas empresas |
| Resolver conciliação | Sim | Sim | Não | Não | Não | Não | Não |

A Recepcionista continua registrando recebimento manual, como hoje (`can_receive_payment`); todo recebimento manual gera conta a pagar de taxa. O distrato continua só com o Gerente de Unidade e o Admin Master, como hoje.

As permissões da Central (`modulo.central` e `acao.central.vincular_conta`) nascem sem papel nenhum: só o Admin Master a enxerga até serem liberadas em Administração › Permissões.

Toda ação de cobrança grava autor, data e motivo na auditoria.

---

## 10. Requisitos técnicos da implementação

| Requisito | Regra |
| --- | --- |
| Ambientes do Asaas | Sandbox em `https://api-sandbox.asaas.com/v3`, chave iniciada por `$aact_hmlg_`; produção em `https://api.asaas.com/v3`, chave `$aact_prod_`. Chave e URL do mesmo ambiente. |
| Autenticação | Cabeçalho `access_token` (não é `Authorization: Bearer`), mais `User-Agent` identificando o riSZon e `Content-Type: application/json`. |
| Cifrão na chave | No `.env.local`, barra invertida antes do cifrão (`\$aact_...`). No painel da Vercel, a chave vai como está. |
| Código | Worktree separado, branch `feat/asaas-integration`. Cada fase aprovada entra no main, escondida atrás de permissão e com a trava de produção desligada. |
| Banco | Banco de treino, migrações só aditivas na faixa 4000+, contas marcadas `environment = 'sandbox'`. A produção só recebe as migrações de uma fase depois de aprovada. |
| Trava de produção | O banco recusa conta `production` enquanto um interruptor, só do Admin Master e ligado na ASA7, estiver desligado (não existe função que o ligue até lá). O cliente HTTP recusa chave `$aact_prod_` e recusa chave e URL de ambientes diferentes; produção só passa com a variável `ASAAS_ALLOW_PRODUCTION=sim`, que não existe em nenhum ambiente até a ASA7. |
| Chave fora da Vercel | `ASAAS_API_KEY` e `ASAAS_BASE_URL` ficam só no `.env.local`, para o roteiro das contas de teste. Em tempo de execução toda chave vem do Vault, pela conta da unidade. Nenhum projeto da Vercel tem a chave do Asaas. |
| Webhook em teste | Terceiro projeto na Vercel, com a branch `feat/asaas-integration` como produção, só as três variáveis do Supabase de treino e `NEXT_PUBLIC_AMBIENTE=treino`, e região São Paulo. Sem `CRON_SECRET` (para as rotinas não rodarem em dobro no treino), sem ZapSign e sem chave do Asaas. O domínio de produção de um projeto fica fora da proteção de deployment, então o Asaas alcança o webhook sem token na URL. |
| Verificação semanal | Rotina diária na Vercel (`/api/cron/gateway-accounts`) que verifica cada conta quando a última verificação tem 7 dias ou mais, ou falhou. |
| Limites da API | 25.000 requisições por conta a cada 12 horas e 50 consultas simultâneas. Erro 429 com espera progressiva pelo `RateLimit-Reset`. Sem consultas repetidas: o estado vem por webhook. |
| Sem cobrança duplicada | Timeout é resultado desconhecido: consultar pelo `externalReference` antes de repetir. O gatilho do ZapSign também é idempotente. |
| Sem cliente duplicado | Buscar por CPF/CNPJ antes de criar o cliente no Asaas. |
| Meio de pagamento na emissão | Toda cobrança sai com o meio definido. A opção em que o pagador escolhe o meio fica desligada. |
| Antecipação | Antecipar um recebível reduz o repasse, porque o percentual passa a incidir sobre o líquido depois da antecipação (confirmado pelo Asaas em 11/11/2026). A antecipação automática fica desligada nas contas das unidades. |
| Lista de IPs autorizados | O Asaas recomenda restringir a chave por IP. Sem IP fixo de saída na Vercel, ativar a lista derruba a integração: **não ativar**. IP fixo custa US$ 100/mês por projeto e é compartilhado entre clientes; decisão de custo na ASA7 (seção 13.2, item 2). |
| Vault | O Supabase Vault nunca foi usado no riSZon. Conferir a extensão nos dois projetos antes da ASA0. A função que lê a chave responde só à chave de serviço. |
| Dados de cartão | Nunca passam pelo banco nem pelos logs do riSZon; só o token do Asaas é guardado. |
| Contas de teste | No sandbox, a conta raiz representa a franqueadora. Um script cria três subcontas (Londrina, Cambé e RisLife) e as registra como vinculadas. Recusa rodar fora do sandbox e do banco de treino. |
| Enviar pelo WhatsApp | Enquanto o WhatsApp da Risarte não estiver integrado, o botão abre o WhatsApp com a mensagem e o link prontos. |

---

## 11. Passo a passo da integração

### Parte A — responsabilidade do Jeferson

- [x] Conta raiz da Risarte Administração no Asaas.
- [x] Contas Asaas de Londrina e Cambé.
- [x] Conta sandbox criada.
- [x] Especificação salva em `docs/integracao-asaas.md`.
- [x] `ASAAS_API_KEY` e `ASAAS_BASE_URL` no `.env.local` — e só lá: nenhum projeto da Vercel recebe a chave do Asaas.
- [x] Vault conferido nos dois bancos (`supabase_vault` 0.3.1 no treino e na produção).
- [x] Sandbox: "BaaS para subcontas" e "Autoaprovação de subcontas" ligadas (Menu do usuário › Minha conta › Configurações › Sandbox). A opção do período de avaliação não aparece nessa tela.
- [x] Terceiro projeto na Vercel (`risarte-asaas`), com a branch `feat/asaas-integration` como produção, para o webhook do sandbox — no ar em 10/11/2026; webhook real recebido.
- [x] **Equipe Sucesso de Integrações do Asaas — respostas técnicas por escrito (11/11/2026).** Registro completo na seção 13.
- [ ] **Gerente de contas do Asaas — ainda em aberto:**
  - Uso da chave de API da unidade pela franqueadora entre CNPJs distintos (contratual e regulatório).
  - Subcontas geridas pela franqueadora entre CNPJs distintos.
  - O split é revertido em caso de chargeback?
  - Tabelas de tarifas de cada conta e negociação pelo volume da rede.
  - Elegibilidade de Londrina e Cambé ao Pix Automático.
  - Parecer sobre o repasse de 100% da implantação do Empresarial à RisLife.
- [ ] **Equipe de integrações — ainda em aberto (ASA4B):** o token do cartão volta quando o paciente digita o cartão na fatura do Asaas? Qual IP informar na cobrança automática com token?
- [ ] **Em cada conta Asaas (raiz, Londrina, Cambé):** habilitar o split no painel (Integrações › Segurança, com 2FA — o Jeferson vai habilitar nas três), cadastrar uma chave Pix e manter a antecipação automática desligada. **Não** ativar a lista de IPs autorizados (seção 13.2, item 2).
- [ ] **Autorização dos franqueados:** termo ou aditivo em que cada unidade autoriza a franqueadora a operar a conta Asaas dela pelo riSZon e a receber os repasses por split.
- [ ] **Contador:** configuração da NFS-e em cada conta e tratamento fiscal do Empresarial, em que a Risarte emite a cobrança e repassa 100% ou 50% à RisLife.
- [ ] **Termo de privacidade:** incluir o Asaas como operador de dados de pagamento.
- [ ] **RisLife:** walletId da conta Asaas.
- [ ] **Homologação** com o financeiro (ASA7) e **teste real com valores mínimos** do split.
- [ ] **Produção:** chaves de produção cadastradas pela Central.
- [ ] **Régua do Asaas:** avisos e canais para pacientes e empresas.
- [ ] **Piloto:** uma unidade por 30 dias; depois a segunda.

### Parte B — fases de desenvolvimento

| Fase | Entrega | Critério de aceite (em sandbox) |
| --- | --- | --- |
| ASA0 — Fundação | Casca da Central (níveis, herança, histórico, prontidão) e aba Conta e tarifas; `gateway_accounts`, Vault, logs, cliente HTTP, vinculação de conta, tarifas pela consulta do Asaas, travas de ambiente; rota mínima de webhook e `gateway_webhook_events`; verificação semanal das contas; roteiro das contas de teste (migrações 4000 a 4002) | Vincular uma conta sandbox e ver walletId, tarifas e webhook ativos; um evento de teste chega; a chave não aparece em tela, log nem repositório; o Gerente só alcança a própria unidade, e só depois do termo; conta de produção é recusada; com o menu escondido e sem as migrações, a produção abre como hoje |
| ASA1 — Cobrança avulsa e link | Em duas entregas (seção 14). **Entrega 1:** abas Financeiro e Comercial (carência fixa em zero) e responsável financeiro com IDs estáveis. **Entrega 2:** `gateway_customers`, `charges`, cobrança de parcela existente (boleto, PIX ou cartão à vista pela fatura do Asaas), Copiar link e Enviar pelo WhatsApp, cancelar, cobrança externa, recebimento no balcão com cobrança ativa | Link gerado pelo riSZon pago no sandbox, no CPF do responsável quando houver; menus antigos abrem as abas novas; nenhuma cobrança duplicada |
| ASA2 — Webhooks e baixa | Rota por conta, idempotência, baixa pela função existente, fechamento da venda (D21), sinalização "em dia" ou "em atraso", aba Cobrança e comunicação; Painel de cobranças com a visão "A receber do Asaas" (16.8.1) | Pagamento simulado dá baixa, fecha a venda e atualiza a sinalização sem ação humana |
| ASA3 — Split | Aba Taxas da franquia sobre `network_fees`; `split_recipients`, `charge_splits`; marca de retido na origem; teto de segurança; painel de repasses, mostrando por unidade quanto foi recebido com split e quanto por fora (dinheiro, maquininha, cobrança externa), e as dispensas do período (quitação por valor menor) com valor, autor e motivo. Antes de implementar: os cálculos da compensação da tarifa nos três casos e a diferença máxima por meio de pagamento, para aprovação (seção 13.2, item 1); "Repasses a receber" no Painel de repasses (16.8.2) | No prazo, o repasse liquidado é exatamente o percentual sobre o valor pago, nos três meios; formato da entrada confirmado; nenhuma conta a pagar em dobro |
| ASA4 — Gatilhos de contrato | Emissão na assinatura; renegociação assinada no ZapSign; cartão parcelado; venda direta; mensalidades do PPR+ e da Ortodontia; reemissão de cobrança externa; distrato com checklist | Contrato de teste gera N cobranças corretas; distrato só cancela ao efetivar; `npm run test:indica` verde |
| ASA4B — Recorrência | Pix Automático (jornada sem pagamento inicial, com split desde a primeira parcela) e cartão de crédito recorrente: autorização, token, cobrança mensal vinculada, falha e cancelamento. O cartão recorrente só entra quando o token puder ser obtido sem o cartão passar pelo riSZon (seção 13.2, item 3) | Autorização ativa gera débito no ciclo seguinte com split; recusa volta para o link |
| ASA5 — Empresarial | Aba Empresarial sobre `split_rules`; implantação e mensalidade com split para a RisLife; emissão em lote; aposentar o cliente e a Edge Function antigos | Implantação e mensalidade de teste pagas com o repasse correto, sobre o valor pago |
| ASA6 — Cobrança mensal e conciliação | Cobrança mensal a partir das contas a pagar de taxa e das taxas fixas; rotina de conciliação e painel | Fechamento de um mês de teste gera a cobrança certa por unidade, sem duplicar o razão |
| ASA7 — Homologação e produção | Interruptor de produção, roteiro com o financeiro, monitor da fila, Copiar de outra unidade, teste real do split | Piloto de 30 dias sem divergência aberta; Central de cada unidade pronta |
| ASA8 — NFS-e | Aba Fiscal, nota pedida pelo riSZon (`POST /v3/invoices`) a cada recebimento — no momento validado pelo contador (seção 13.2, item 4) —, nota mensal consolidada, webhooks de nota | Nota autorizada em sandbox para cada tipo |

Dependências: ASA2 depende de ASA1; ASA3 de ASA2; ASA4, ASA4B, ASA5 e ASA6 dependem de ASA3. A ASA5 pode andar em paralelo à ASA4.

Método: plano aprovado antes do código, uma fase por vez, testes de cada fluxo, commit ao fim de cada sessão e `ESTADO_DO_PROJETO.md` atualizado.

---

## 12. Pontos pendentes de validação

- [x] **Formato da entrada de split** — uma entrada com `percentualValue` e `fixedValue` juntos, confirmado pelo Asaas (11/11/2026). Na ASA3, só a confirmação em sandbox.
- [x] **Base do percentual com desconto, multa e juros** — confirmado pelo Asaas (11/11/2026). Falta só o teste real com valores mínimos antes do piloto.
- [x] **Tarifa do boleto pago pelo QR Code Pix** — tarifado como PIX; pelo código de barras, como boleto (Asaas, 11/11/2026).
- [ ] **Compensação da tarifa nos três casos (ASA3):** cálculos e diferença máxima por meio de pagamento, apresentados ao Jeferson antes de implementar (seção 13).
- [ ] **Uso da chave e subcontas entre CNPJs distintos (gerente de contas).**
- [ ] **Split em chargeback (gerente de contas).** Estorno total reverte o split (Asaas, 11/11/2026).
- [ ] **Pix Automático (ASA4B):** a jornada sem pagamento inicial e o split com valor variável estão confirmados; faltam a elegibilidade de Londrina e Cambé (gerente de contas), a tarifa e o teste em sandbox.
- [ ] **Cartão recorrente (ASA4B):** a tokenização é nativa; em aberto, o token pela fatura do Asaas (sem o cartão passar pelo riSZon) e o IP da cobrança automática.
- [ ] **Lista de IPs autorizados na chave de API:** avaliada em 11/11/2026 (seção 13); decisão de custo do Jeferson, não antes da ASA7.
- [ ] **Momento da nota do paciente (ASA8):** proposta na seção 13, a validar com o contador.
- [x] **Webhook no terceiro projeto da Vercel (primeiro passo da ASA0)** — o Asaas alcança o endereço de produção do projeto sem token na URL (10/11/2026).
- [ ] **NFS-e (ASA8):** o riSZon chama `POST /v3/invoices` ao receber o pagamento (a emissão automática nativa é só para assinaturas — Asaas, 11/11/2026); faltam as regras de cada prefeitura e a configuração fiscal com o contador.

---

## 13. Resposta escrita do Asaas (11/11/2026) e o que ela muda

A equipe Sucesso de Integrações do Asaas respondeu por escrito às dúvidas técnicas. Nada disso muda a ASA0.

### 13.1 Confirmado pelo Asaas

| Tema | Resposta do Asaas | O que muda no riSZon |
| --- | --- | --- |
| Base do split percentual | Incide sobre o `netValue` do valor efetivamente pago: com desconto, sobre o pago com desconto; com multa e juros, sobre o pago com encargos. Vale para boleto, PIX e cartão; no cartão parcelado, sobre o líquido de cada parcela. A antecipação reduz a base. | Passo 2 da prova do split cumprido (seção 4). O teste real com valores mínimos continua antes do piloto, como conferência final. A antecipação automática continua desligada e é item de prontidão. |
| Formato da entrada | Uma entrada aceita `percentualValue` e `fixedValue` juntos para a mesma carteira: transferido = `fixedValue + netValue × percentualValue / 100`. | Uma entrada por carteira nesse formato (seção 4). O teste de formato em sandbox vira só confirmação. |
| Estorno | Estorno total reverte o split de todas as carteiras automaticamente. | Mantida a regra da D13: o valor revertido vira conta a pagar da unidade. Chargeback segue com o gerente de contas. |
| Tarifas da conta | `GET /v3/myAccount/fees` traz boleto, PIX, transferências e as faixas do cartão parcelado. | É a fonte que a ASA0 já usa (`acquirer_rates`, com vigência). |
| Boleto pago pelo QR Code PIX | Tarifado como PIX; pelo código de barras, como boleto. | Entra no desenho da compensação da ASA3 (13.2, item 1). |
| Pix Automático | Há jornada de autorização sem pagamento inicial. Com a autorização prevendo valor variável ou teto, cada cobrança do modo `MANUAL` pode ter valor diferente e split. | A ASA4B usa essa jornada; a primeira parcela também sai com split (seção 5). |
| Tokenização de cartão | Nativa, sem liberação. O `creditCardToken` volta ao criar ou pagar cobrança com o objeto `creditCard`, e pode ser usado todo mês em `POST /v3/payments` com split. | Ver 13.2, item 3: o jeito de obter o token conflita com a regra do riSZon. |
| Habilitar o split | Precisa ser habilitado no painel de cada conta emissora, com 2FA. | O Jeferson vai habilitar na raiz, em Londrina e em Cambé. Continua como declaração do Admin Master na Central até a ASA3 confirmar sozinha. |
| NFS-e de cobrança avulsa | O riSZon chama `POST /v3/invoices` ao receber o pagamento. A emissão automática nativa é só para assinaturas. | Confirma o desenho da ASA8 (13.2, item 4). |
| Chave sem uso | A chave só é desativada sem uso por 3 meses; uso contínuo, inclusive a verificação semanal, a mantém ativa. | Confirma a verificação semanal da ASA0. |

### 13.2 Para tratar nas fases

1. **ASA3 — compensação da tarifa.** Desenhar a compensação para três casos:
   - tarifa **fixa** (boleto, PIX fixo);
   - tarifa **percentual** (cartão; PIX percentual com mínimo e máximo);
   - **boleto que pode ser pago pelo QR Code PIX**, com tarifa diferente.

   **Regra:** o repasse nunca pode passar do percentual sobre o valor pago. Quando não der para fechar exato, a diferença máxima deve ser de centavos e a favor da unidade. **Mostrar os cálculos e a diferença máxima por meio de pagamento ao Jeferson antes de implementar.**

2. **Lista de IPs autorizados na chave de API.** O Asaas recomenda restringir a chave por IP. **Avaliação (11/11/2026, documentação da Vercel):**
   - **O que existe:** a Vercel tem IP fixo de saída ("Static IPs") nos planos Pro e Enterprise. Custa **US$ 100 por mês por projeto**, mais a transferência de dados cobrada por região.
   - **Os IPs não são exclusivos.** Saem de um conjunto compartilhado por um pequeno grupo de clientes da mesma região, então a lista não identifica o riSZon sozinha: a chave continua sendo a proteção principal.
   - **Alcance:** vale para todos os ambientes do projeto (produção e prévias), com até 3 regiões. Rotinas e funções passam por ele; a montagem só se ligada à parte. Não foi confirmado se São Paulo (gru1) está entre as regiões oferecidas.
   - **Sem IP fixo**, a Vercel não publica faixa de endereços. Ativar a lista no painel do Asaas derrubaria a integração.
   - **Recomendação:** não ativar a lista agora. Reavaliar na ASA7, antes das chaves de produção. Se o Jeferson decidir pelo custo, ligar o IP fixo **só no projeto de produção**, conferir que as chamadas saem pelos IPs novos e só então cadastrar a lista em cada conta de produção. As contas de sandbox ficam sem lista.

3. **ASA4B — cartão recorrente.** Obter o token enviando o objeto `creditCard` faria os dados do cartão passarem pelo servidor do riSZon, o que viola a regra. Em aberto, aguardando o Asaas: o token volta quando o paciente digita o cartão na fatura do Asaas? Qual IP usar na cobrança automática? Até a resposta, o cartão recorrente não é implementado.

4. **ASA8 — momento da nota do paciente.** No cartão, o `PAYMENT_RECEIVED` chega cerca de 32 dias depois da confirmação. **Proposta, a validar com o contador:** a nota do paciente sai no **primeiro** dos dois eventos (`PAYMENT_CONFIRMED` ou `PAYMENT_RECEIVED`).
   - **Na prática:** no cartão, sai na confirmação; no boleto e no PIX, os dois chegam juntos ou só chega o `RECEIVED`, e a nota sai nele. Assim o paciente não espera um mês pela nota de algo que já pagou, e a regra é uma só para todos os meios.
   - **Se houver estorno ou chargeback depois**, o riSZon pede o cancelamento da nota no Asaas e avisa o financeiro.
   - **A alternativa** — emitir só no `PAYMENT_RECEIVED` — atrasa a nota do cartão em cerca de 32 dias, mas evita cancelar nota em contestação.
   - **Para o contador decidir:** qual dos dois momentos a prefeitura e o regime de cada unidade aceitam.

### 13.3 Ainda com o gerente de contas do Asaas

- Uso da chave de API entre CNPJs distintos (contratual e regulatório).
- Subcontas entre CNPJs distintos.
- Split em chargeback.
- Tabelas de tarifas e negociação.
- Elegibilidade de Londrina e Cambé ao Pix Automático.
- Parecer sobre o repasse de 100% à RisLife.

A **D2** (todas as unidades como contas vinculadas) continua valendo.

---

## 14. Decisões da ASA1 (11/11/2026)

O plano da ASA1 foi aprovado em **duas entregas**, cada uma entrando no `main` separada: primeiro as abas Financeiro e Comercial e o responsável financeiro; depois a cobrança.

### 14.1 O que se cobra e como

- **Só parcela que já existe** (tratamento, venda direta, renegociação). Cobrança de valor livre fica para a ASA4.
- **Meio de pagamento:** quem emite escolhe entre boleto, PIX e cartão à vista, partindo do meio gravado na parcela. Parcela de cartão parcelado, cartão recorrente ou depósito não emite na ASA1.
- **Cartão só pela fatura do Asaas.** No cartão à vista, o pagador digita o cartão na fatura do Asaas, aberta pelo link. O riSZon não tem campo de cartão nem recebe dados de cartão em nenhuma rota.
- **Sem split até a ASA3.** O recebimento dessas cobranças (baixa na ASA2) gera a conta a pagar de taxa de hoje, para nenhum repasse se perder.
- **Pagador no Asaas:** criado com os avisos desligados e só com nome e CPF, até a ASA2 ligar a régua.
- **Uma cobrança ativa por parcela.** A mesma parcela pode ter várias cobranças ao longo do tempo (por exemplo, o saldo de um pagamento parcial), mas só uma ativa por vez. Não existe `charge_id` em `payment_installments`: a cobrança ativa sai da tabela de cobranças.
- **Modelo pronto para as próximas fases.** `charges` e `gateway_customers` nascem aceitando os meios Pix Automático e cartão recorrente (ASA4B), a empresa como pagadora (ASA5) e as origens PPR+, Ortodontia, Empresarial e cobrança mensal à unidade. Na ASA1 só parcela é emitida; o resto é recusado por regra.

### 14.2 Carência fixa em zero

- Na produção a carência já é zero na rede e nas unidades, e passa a ser **fixa em zero**: o Asaas não aplica carência, e multa e juros contam do dia seguinte ao vencimento.
- Na aba Financeiro, o campo fica só leitura, com o valor e a explicação: "o Asaas não aplica carência; multa e juros contam do dia seguinte ao vencimento".
- O banco recusa carência diferente de zero em `finance_settings`, na rede e na unidade.
- Proteção para dados antigos: parcela com carência maior que zero não é emitida pelo Asaas, com o motivo na tela.

### 14.3 Parcela vencida

- **Conferido no sandbox (11/11/2026):** o Asaas **recusa** vencimento no passado, nos três meios ("Não é permitido data de vencimento inferior a hoje"), e **aceita** vencimento hoje.
- ✅ **Regra aprovada pelo Jeferson (11/11/2026):**
  - quem emite escolhe a nova data, **de hoje até 7 dias corridos à frente**;
  - o valor sai atualizado com a multa e os juros que o riSZon já calcula **até a nova data**, não até o dia da emissão;
  - o desconto de pontualidade não vale (o benefício já foi perdido);
  - a cobrança reemitida vai **sem multa nova**, com os **juros mensais normais** a partir da nova data;
  - se a nova data também passar, a diferença de centavos que o Asaas cobrar a mais é registrada **como juros** na baixa (ASA2);
  - **acima do limite de dias a emissão é recusada**, com a indicação de que o caminho é a **renegociação**;
  - o limite é **configuração da rede** na aba Financeiro da Central, com **padrão 7**.

### 14.4 Pagamento no balcão com cobrança ativa

Quando o paciente paga em dinheiro ou maquininha uma parcela com cobrança emitida, a tela oferece uma ação única: cancelar a cobrança no Asaas e, com o cancelamento confirmado, abrir o recebimento manual. Se a cobrança já estiver paga no Asaas, a ação é recusada. Esse recebimento manual gera a conta a pagar de taxa da unidade, como hoje.

### 14.5 Recebimento manual — a regra pedida e a de hoje

**A regra pedida pelo Jeferson (11/11/2026):**

- a tela já traz o valor devido na data (parcela, menos o benefício de pontualidade se no prazo, mais multa e juros se em atraso), igual ao que o Asaas cobraria;
- a Recepcionista pode receber o valor devido ou um valor menor, como pagamento parcial; não pode dar desconto nem dispensar multa e juros;
- o Gerente de Unidade e o Admin Master podem quitar por valor diferente do devido, com motivo obrigatório e registro na auditoria;
- pagamento parcial é aceito: o valor pago é baixado e o saldo continua em aberto na parcela, podendo ganhar nova cobrança pelo Asaas;
- a conta a pagar de taxa é calculada sobre o valor efetivamente recebido.

**Como é hoje** (`register_payment_receipt`, 0188; `installment_balance`; `apply_receipt_split`, 0370), conferido no código em 11/11/2026:

| Ponto | Hoje | Diferença para a regra pedida |
| --- | --- | --- |
| Valor sugerido | A tela já abre com o saldo atualizado: parcela + benefício perdido + multa + juros na data (`updatedBalanceCents`). | Igual. |
| Quem recebe | Admin Master, Financeiro da Franqueadora, Gerente e Recepcionista da unidade (`can_receive_payment`). | Igual para receber. O Financeiro da Franqueadora também recebe hoje e não é citado na regra pedida — mantido como está. |
| Valor menor | Aceito como **pagamento parcial**: abate principal → benefício perdido → multa → juros; a parcela fica "parcial" e o saldo continua aberto. Multa e juros continuam sobre o valor cheio. | Igual. |
| Valor maior que o devido | Recusado (`AMOUNT_OVER_BALANCE`). | Igual. |
| Desconto ou dispensa na baixa | **Não existe**: "só quita quem paga tudo". Desconto hoje só por **renegociação** (Gerente, Financeiro com autorização do Gerente, Admin). | **Diferença:** a regra pedida cria a **quitação por valor menor**, só para o Gerente da unidade e o Admin Master, com motivo obrigatório e auditoria. |
| Conta a pagar de taxa | Sobre o valor recebido inteiro, inclusive multa e juros (`_apply_fee_split` com o valor da baixa). | Igual. |

**✅ Quitação por valor menor — aprovada pelo Jeferson (11/11/2026):**

- só o **Gerente da unidade** e o **Admin Master**, com **motivo obrigatório**;
- é um recebimento normal do valor pago, mais uma **dispensa** registrada com o motivo, que fecha o saldo;
- a dispensa abate primeiro os juros, depois a multa, depois o benefício perdido e por último o principal;
- só a parte de principal dispensada entra no razão como **Descontos concedidos (1.9.02)**. Multa, juros e benefício perdido nunca chegaram a ser lançados como receita, então dispensá-los não gera lançamento;
- a conta a pagar de taxa é calculada sobre o valor efetivamente recebido;
- **acréscimo:** toda dispensa fica visível para a franqueadora. Na ASA1, a dispensa é gravada com valor por natureza, autor, data e motivo, num registro que o painel consegue ler depois; na **ASA3**, o painel de repasses lista, por unidade, as dispensas do período com valor, autor e motivo.

**A diferença entre parcial e quitação por valor menor:** a Recepcionista recebe o valor devido ou um valor menor como **pagamento parcial** — o saldo continua em aberto, e ela não dá desconto nem dispensa multa e juros. A **quitação por valor menor** fecha o saldo e exige o Gerente da unidade ou o Admin Master.

### 14.6 Decididos em 11/11/2026

A regra da parcela vencida (14.3) e a quitação por valor menor (14.5) foram aprovadas, com os dois acréscimos: o limite de dias da reemissão (padrão 7, na aba Financeiro) e a dispensa visível para a franqueadora (painel de repasses da ASA3).

### 14.7 Permissões

- As três permissões novas da cobrança (ver, emitir, cancelar) nascem só com o Admin Master.
- Na liberação futura, conforme a matriz 9.3:
  - **Financeiro da Franqueadora:** ver, emitir e cancelar na rede toda;
  - **Gerente de Unidade:** ver, emitir e cancelar na própria unidade;
  - **Recepcionista:** ver e emitir na própria unidade;
  - **Assistente Comercial e Consultor Comercial:** ver e enviar o link dos clientes deles.

## 15. Registrado para a ASA4 (11/11/2026)

Pedido do Jeferson ao aprovar a entrega 2 da ASA1. Vale quando a ASA4 for planejada.

### 15.1 O Consultor Comercial não gera nem cancela cobrança

A geração é **automática na assinatura do contrato no ZapSign**. O consultor não tem botão de gerar nem de cancelar cobrança.

### 15.2 O cockpit do Consultor Comercial

Mostra as cobranças das vendas dele, com a situação de cada uma e os botões **Copiar link**, **Enviar pelo WhatsApp**, **Copiar Pix** e a **linha digitável**. Mostra também quando o pagamento da primeira cobrança foi confirmado e a venda fechou (D21).

### 15.3 O fluxo depois da assinatura, por meio de pagamento

- **Boleto:** a primeira cobrança é enviada automaticamente ao pagador; as seguintes são lembradas antes do vencimento, pela régua.
- **Pix:** o cockpit mostra o QR Code da primeira cobrança para pagamento na hora, e o mesmo Pix vai por link; as seguintes vão por link antes do vencimento. No Pix Automático (ASA4B), o pagador autoriza uma vez.
- **Cartão:** o pagador recebe o link da fatura do Asaas e digita o cartão lá. No parcelado, um único pagamento cobre o tratamento; no recorrente (ASA4B), a cobrança é mensal e automática.
- **Contrato com muitas parcelas:** o pagador não recebe todas de uma vez. Recebe só a primeira na assinatura e cada uma das seguintes perto do vencimento.
- **O envio automático usa a régua do Asaas**, ligada na ASA2. A aba Cobrança e comunicação da Central mostra o custo de cada canal.

## 16. Decisões da ASA2 (11/11/2026)

Plano aprovado pelo Jeferson em 11/11/2026, em **duas entregas**. **Entrega 1:** o aviso do Asaas vira baixa (processamento, baixa automática, fechamento da venda pela D21, estorno, duplicidade, avisos, reprocessar). **Entrega 2:** sinalização "em atraso" e a aba Cobrança e comunicação (régua). Migração da entrega 1: **4005**.

### 16.1 O que a documentação do Asaas mostrou

- **Pix não tem "confirmado":** chega só `PAYMENT_RECEIVED`. Boleto: `PAYMENT_CONFIRMED` e depois `PAYMENT_RECEIVED`. Cartão: confirmado no dia, recebido cerca de 32 dias depois.
- **Valor pago com multa e juros:** o Asaas devolve o valor original num campo à parte (`originalValue`); qual campo traz o total pago é provado no sandbox, com uma cobrança vencendo hoje e paga no dia seguinte (a prova leva dois dias).
- **Régua por pagador:** cada pagador no Asaas tem a própria configuração de avisos (eventos, antecedência, canais), editável pela API; não dá para criar nem apagar avisos, só ligar, desligar e trocar canal.
- **Custo de cada canal** vem de `GET /v3/myAccount/fees` (`notification`): no sandbox, SMS R$ 0,50, WhatsApp R$ 0,55, ligação R$ 0,55, Correios R$ 2,91 e mensageria R$ 0,99.

### 16.2 O que cada aviso faz

| Aviso do Asaas | Efeito no riSZon |
| --- | --- |
| Confirmado (boleto, cartão) | Fecha a venda se aberta (D21), dá a baixa; cobrança **Paga** |
| Recebido sem confirmado antes (Pix) | O mesmo e já **Liquidada** |
| Recebido depois de confirmado | **Liquidada**; a data em que o dinheiro cai é a real |
| Vencido | **Vencida**; entra no **resumo diário** da unidade (sem aviso individual) |
| Apagada no painel do Asaas | **Cancelada** com a origem registrada; a parcela destrava; aviso ao Gerente e ao Admin |
| Restaurada | Volta a valer se a parcela não tiver outra cobrança ativa; senão, só aviso |
| Alterada no painel do Asaas | Registra e avisa; se o pagamento vier com valor diferente do emitido, a baixa segue a regra do valor a maior ou a menor (16.3) |
| Estorno total | Estorna a baixa; a parcela volta a ficar em aberto; cobrança **Estornada**; **a taxa da rede continua devida** (16.5); aviso ao Financeiro da Franqueadora e ao Admin |
| Estorno parcial; contestação no cartão | Só avisa; o Financeiro trata à mão (**D**) |
| Chave ou conta com problema | Aviso ao Admin |

- O mesmo aviso nunca é processado duas vezes; a situação só avança (exceto estorno). Aviso de cobrança que não nasceu no riSZon é guardado e ignorado.
- **O webhook responde 200 depois de gravar o aviso**, mesmo que o processamento falhe ou demore. Erro de processamento nunca vira outra resposta, para a fila do Asaas não pausar.
- **Reprocessar o aviso com erro:** na rotina diária, quando chega o próximo aviso da mesma cobrança, e pelo botão **Reprocessar** na lista de avisos com erro (Central, aba Conta e tarifas, Admin).
- A rotina diária confere se o Asaas pausou a fila de avisos e avisa o Admin.

### 16.3 Valor pago diferente do esperado (A)

- **Na emissão:** a multa vai **em reais**, já calculada pelo riSZon sobre o valor cheio, e os juros vão **ajustados na mesma proporção** (juros da parcela × valor cheio ÷ valor da cobrança). Assim a diferença entre o Asaas e o riSZon fica em centavos.
- **A maior:** o que o Asaas cobrar a mais entra como **juros** na baixa (já aprovado na 14.3).
- **A menor até o limite (padrão R$ 0,10):** a parcela fecha sozinha, com a diferença registrada como **"arredondamento (automático)"** — não é dispensa. O limite é configuração da rede na aba Financeiro.
- **A menor acima do limite:** o saldo fica em aberto na parcela, com aviso ao Gerente.

### 16.4 A baixa automática

- **Ordem da D21 numa operação só:** confirma o pagamento na venda → a venda fecha (com a receita, o card comercial, o Indica e os avisos de sempre) → dá a baixa. O fechamento fica registrado com origem **Asaas**. Vale para venda comercial, venda direta e renegociação.
- A baixa segue a regra de sempre (principal → benefício perdido → multa → juros; taxa da rede sobre o valor pago). Quem deu a baixa: **"Asaas (automático)"**.
- **Conta "Asaas" (B):** cada unidade pronta ganha uma conta bancária "Asaas"; toda baixa automática entra nela, e a transferência ao banco aparece na Conciliação.
- **Taxa do Asaas (C):** a taxa e a data em que o dinheiro cai vêm do próprio aviso (valor menos valor líquido; data de crédito), não da tabela de tarifas.
- **Funções internas:** as versões de fechar venda, dar baixa, aplicar a taxa e estornar usadas pelo aviso respondem **só à chave de serviço**, fechadas para usuário logado e anônimo (provado no ensaio). As telas de hoje não mudam.

### 16.5 Estorno e a D13

- No estorno total, a baixa é estornada e a parcela volta a ficar em aberto, mas a **taxa da rede permanece devida** pela unidade (D13: repasse não volta em estorno).
- O **Financeiro da Franqueadora** e o **Admin Master** podem **dispensar essa taxa à mão**, com motivo obrigatório e registro na auditoria (ex.: pagamento em duplicidade devolvido).

### 16.6 Pagamento em duplicidade

- Pagamento de cobrança **já cancelada pelo riSZon** ou de parcela **já baixada** (ex.: boleto pago no banco e, antes da compensação, recebimento no balcão) **não gera baixa em dobro**.
- O riSZon registra **"pagamento em duplicidade"** com o valor, e avisa o Gerente da unidade e o Financeiro da Franqueadora, que decidem entre **devolver** ou **abater em outra parcela**.

### 16.7 Avisos (ajuste 3)

- Parcela vencida: **resumo diário por unidade** e o Painel de cobranças, sem aviso por parcela.
- Aviso individual só para o que exige ação: estorno, contestação, duplicidade, diferença a menor acima do limite, cobrança apagada ou alterada no painel do Asaas.

### 16.8 Entrega 2 — sinalização e régua

- **Selo "Em atraso" (E):** só para quem lida com pagamento — Recepcionista, Gerente de Unidade, Consultor e Assistente Comercial, Financeiro da Franqueadora e Admin Master. Dentistas e auxiliares não veem selo nem valores. Sem selo "Em dia". Aparece no cabeçalho da ficha, na agenda (card e janela do agendamento) e no cockpit da avaliação. Nenhum atendimento é bloqueado (D11).
- **Tolerância do selo:** a parcela só conta como "em atraso" para o selo depois de **3 dias úteis** do vencimento (compensação do boleto). Multa e juros não mudam. O prazo é configuração da rede.
- **Régua (F):** a aba Cobrança e comunicação nasce com **tudo desligado**. Uma unidade só liga algum aviso depois de o **Admin Master declarar na Central** que o termo de privacidade foi atualizado com o Asaas como operador. Ao ligar, o riSZon passa a mandar e-mail e celular dos pagadores daquela unidade ao Asaas e aplica a configuração em cada pagador. A aba mostra o custo de cada canal e uma **estimativa mensal** pelo número de cobranças da unidade.

### 16.8.1 Entrega 2 — Painel de cobranças e "A receber do Asaas" (pedido do Jeferson, 11/11/2026)

**Visão "A receber do Asaas"** — os valores **pagos** que o Asaas ainda **não liquidou** (cobrança Paga, ainda não Liquidada):

- total a receber e a **agenda por data prevista de liquidação**: hoje, próximos 7, 30 e 60 dias, e dia a dia;
- quebra por meio de pagamento: boleto, Pix, cartão à vista, cartão parcelado e, depois, recorrente e Pix Automático;
- no cartão parcelado, **cada parcela do cartão** com a sua data prevista;
- **valor bruto, taxa do Asaas e valor líquido**;
- por unidade para o **Gerente**; a rede toda, com filtro por unidade, para o **Admin Master** e o **Financeiro da Franqueadora**;
- quando chega o aviso de "recebido", o valor **sai** desta visão e **entra na conta "Asaas"** da unidade.

**Lista de cobranças** — todas as cobranças **emitidas pelo riSZon**, com filtro por situação, meio de pagamento, período e unidade. A tela diz com clareza que **cobranças criadas direto no painel do Asaas não aparecem**.

**De onde vêm os dados (conferido na documentação do Asaas em 11/11/2026):**

- **Data prevista de liquidação:** cada cobrança traz `estimatedCreditDate` (prevista) e `creditDate` (efetiva). O riSZon já grava a data no aviso de pagamento (`charges.credit_date`) e a corrige no aviso de "recebido". **Provado no sandbox** no Pix, no boleto e no cartão à vista (cartão de 11/11 com crédito previsto para 14/12).
- **Taxa e líquido:** o aviso traz `value` e `netValue`; a taxa é a diferença (já gravada na baixa).
- **Cartão parcelado:** o Asaas cria **uma cobrança por parcela do cartão**, cada uma com identificador e ciclo próprios. A documentação **não diz** se cada parcela traz a própria data prevista nem se o crédito é mês a mês — **a provar no sandbox quando o cartão parcelado for emitido (ASA4)**. Até lá, a visão mostra cartão parcelado vazio.

### 16.8.2 Registrado para a ASA3 — "Repasses a receber"

No Painel de repasses, a mesma lógica para a franqueadora: os **splits de cobranças já pagas que ainda não foram liquidados**, por data prevista, unidade e taxa, e os **já liquidados no período**.

**De onde vêm os dados (conferido na documentação do Asaas em 11/11/2026):** o split tem situação (`PENDING`, `AWAITING_CREDIT`, `DONE`, `CANCELLED`, `REFUNDED`, `BLOCKED_BY_VALUE_DIVERGENCE`…), valor e `creditDate` **só quando é pago**; o aviso `PAYMENT_SPLIT_DONE` chega por split. **O Asaas não informa data prevista para o split.** Proposta, a confirmar com o Jeferson antes de implementar: usar como data prevista a **data prevista de liquidação da cobrança** de origem (o split é creditado quando a cobrança é liquidada), e conferir a hipótese no sandbox na ASA3.

### 16.9 Provas

- Ensaio no treino em transação desfeita: cada aviso; o repetido; o fora de ordem; a D21 nas três origens; valor a maior, a menor dentro e fora do limite; estorno com a taxa mantida e a dispensa manual dela; duplicidade; as funções internas fechadas para logado e anônimo; `npm run test:indica`.
- Sandbox de ponta a ponta: Pix e boleto pagos pelo sandbox dão baixa e fecham uma venda de teste sozinhos; o pagamento atrasado em dois dias (**✅ 12/11/2026**: boleto de R$ 10,00 com multa de 2% e juros de 1% ao mês, vencido em 11/11 e pago em 12/11 — o Asaas mandou `value` 10,20, `originalValue` 10,00, `interestValue` 0,20; a baixa saiu de R$ 10,20 = 10,00 de principal + 0,20 de multa + 0,00 de juros, porque um dia de 1% ao mês sobre R$ 10 dá menos de meio centavo; `payment.value` é o campo certo e nada mudou no código); o **cartão pago pelo Jeferson** na página da fatura com o cartão de teste do Asaas (**G**).

## 17. Decisões da ASA2, entregas 2 e 3 (12/11/2026)

Plano aprovado pelo Jeferson em 12/11/2026. A ASA2 passa a ter **três entregas**: a 1 (4005, concluída), a **2** (migração **4006**: selo "Em atraso" e Painel de cobranças) e a **3** (migração **4007**: a régua, depois das respostas do Asaas às lacunas da 17.4).

### 17.1 Selo "Em atraso" (entrega 2)

- **Regra:** a parcela em aberto (ou parcial) conta como "em atraso" depois de **3 dias úteis** do vencimento. Dias úteis excluem sábado, domingo e **feriados nacionais** (a compensação bancária segue o calendário nacional). O prazo é configuração da rede, na aba Financeiro da Central. Multa e juros não mudam: contam desde o vencimento.
- **O texto do selo:** "Em atraso há N dias", com N contado **desde o vencimento**; o selo só aparece depois da tolerância. **Sem valor** no selo; o valor continua só na aba Financeiro, para quem já o vê.
- **Onde:** cabeçalho da ficha, card da agenda e janela do agendamento, cockpit da avaliação (no lugar do "Em breve"). Nenhum atendimento é bloqueado (D11).
- **Quem vê, em duas etapas por permissão:** primeiro, só **Admin Master, Gerente de Unidade e Franqueado** (própria unidade). Depois que o Jeferson liberar em Administração › Permissões, também **Recepcionista, Consultor e Assistente Comercial e Financeiro da Franqueadora**. **Dentistas, auxiliares e SDR nunca veem**, mesmo que a permissão seja marcada para eles.
- **Uma regra só:** o aviso "cobrança(s) em atraso" da ficha, o número vermelho da aba Financeiro e o filtro "em atraso" da lista de prontuários usam a mesma tolerância do selo. A aba Financeiro continua mostrando cada parcela como **vencida** desde o vencimento, com multa e juros.
- **Recepcionista na etapa 1 (decisão do Jeferson, 13/11/2026):** sem o selo, mas **continua vendo** o aviso "cobrança(s) em atraso" da ficha, o número vermelho da aba Financeiro e o filtro/marca de Prontuários (a cobrança da recepção, FIN1.1). Conferido no projeto de teste publicado por `npm run test:e2e:publicado`.
- **Manual:** o selo serve para a recepção tratar do pagamento **com discrição, fora da sala clínica**, e **não bloqueia** o atendimento.

### 17.2 Painel de cobranças (entrega 2)

- Em **Financeiro → Cobranças**, duas abas: **"A receber do Asaas"** (16.8.1) e **"Cobranças emitidas"** (todas as emitidas pelo riSZon, com filtros por situação, meio, período e unidade, link para a ficha e planilha; aviso de que as criadas direto no painel do Asaas não aparecem).
- A taxa do Asaas e o valor líquido passam a ser gravados em cada cobrança (antes só no lançamento contábil); as antigas são preenchidas pelos avisos já guardados.
- **Quem vê:** Gerente de Unidade e **Franqueado**, a própria unidade; Admin Master e Financeiro da Franqueadora, a rede com filtro por unidade. A Recepcionista não vê. **Na produção, o painel nasce visível só para o Admin Master** enquanto a integração estiver em testes.
- **Cada download da planilha fica na auditoria**, com quem baixou, quando e com quais filtros.

### 17.2.1 Ajustes do teste do dono (12/11/2026)

- **Dois sentidos para "em atraso":** na aba Financeiro, a parcela passada do vencimento é **"vencida"** ("vencida há N dias", o cartão e o filtro **Vencidas**); "em atraso" fica só para o que passou da tolerância (selo, aviso da ficha, número da aba, filtro de Prontuários).
- **Painel sem termos internos:** só aparecem os meios que o riSZon já emite (boleto, Pix, cartão à vista); os outros entram quando a fase deles existir.
- **Homônimos:** o código do prontuário aparece ao lado do nome no painel e na planilha (coluna **Prontuário**).
- **Auditoria:** os dois registros de cobrança ganharam nomes distintos ("emitir e cancelar" e "registro"); a exportação mostra os filtros com acento e por extenso.
- **Arredondamento automático do Asaas:** o máximo cai de R$ 5,00 para **R$ 1,00** (fecha saldo sem passar pelo Gerente).
- **Parcela "Cartão":** emite como **cartão à vista daquela parcela** (o paciente paga a parcela no cartão pela fatura do Asaas); o que não emite é o **cartão de crédito parcelado** (14.1). A janela de emissão agora diz isso.

### 17.3 Régua (entrega 3)

- A tela segue os **8 avisos fixos** do Asaas por pagador (cobrança criada; 2 lembretes antes do vencimento, em 0/5/10/15/30 dias; linha digitável; 2 avisos de vencida, no dia e em 1/7/15/30 dias; pagamento recebido; cobrança alterada), com os canais e-mail, SMS, WhatsApp e ligação. Correios fica fora.
- A **declaração do Admin Master** sobre o termo de privacidade é feita uma vez, para a rede; sem ela nenhuma unidade liga aviso.
- Ao ligar numa unidade, o riSZon manda e-mail e celular dos pagadores dela e aplica a régua um por um, em segundo plano; pagadores novos nascem com a régua. O telefone só vai como celular quando parecer celular (11 dígitos começando com 9); a tela mostra quantos pagadores estão sem e-mail ou sem celular.
- **Ao desligar**, os avisos são desligados; e-mail e celular **continuam no Asaas** e só são removidos quando a conta da unidade for **desvinculada**.
- **Desligamento individual por pagador**, para o paciente que pedir para não receber avisos, com registro de quem desligou e o motivo; a tela da unidade mostra quantos pagadores estão com os avisos desligados.
- **Quem edita:** só Admin Master e Financeiro da Franqueadora. O Gerente e o Franqueado veem a régua e a estimativa de custo da própria unidade.
- Custo: o preço de cada canal (`GET /myAccount/fees`) e uma estimativa mensal (cobranças da unidade nos últimos 30 dias × avisos ligados × preço).

### 17.4 Lacunas levadas ao Asaas pelo Jeferson — respondidas em 12/11/2026

1. **Mensageria (R$ 0,99 no sandbox):** é a tarifa dos avisos por **e-mail e SMS**, **uma vez por cobrança** (não por aviso) e descontada **só na compensação** do pagamento. **E-mail não é gratuito**: entra na mensageria.
2. **WhatsApp:** nativo, sem contratação nem modelos para aprovar. Sai dos **números oficiais do Asaas**; se o pagador responder, um assistente virtual do Asaas orienta a procurar a empresa (a resposta **não chega à clínica**). Tarifado **por disparo**. Exige `mobilePhone` válido, **saldo disponível** na conta da unidade no momento do envio e que o pagador não tenha bloqueado o número. Vem desligado por padrão.
3. **Sandbox:** e-mail e SMS são **enviados de verdade**. Toda prova no sandbox usa pagador **sem e-mail nem celular**, salvo a prova de envio, que só acontece com contato do Jeferson e com a aprovação dele na hora.
4. **Correios:** é por cobrança, só boleto com vencimento a mais de 15 dias. **Fica fora** da régua.
5. **Avisos desligados** (`notificationDisabled`): o Asaas não envia nada ao pagador, **nem a confirmação de pagamento**.

**Conferido no treino (12/11/2026):** os R$ 0,99 de diferença das cobranças de teste liquidadas (Pix de R$ 6,00 com líquido de R$ 5,01) são a **tarifa promocional do Pix** (R$ 0,99 até 10/02/2027, depois R$ 1,99; boleto também R$ 0,99), não mensageria: os pagadores de teste nasceram com os avisos desligados, e o `netValue` já vem com o desconto no aviso de cobrança criada.

**O que a documentação do Asaas mostrou (12/11/2026)**, sem contradizer a 17.3:

- Os 8 avisos por pagador, com os prazos: lembrete antes do vencimento (`PAYMENT_DUEDATE_WARNING`) em 0, 5, 10, 15 ou 30 dias; vencida (`PAYMENT_OVERDUE`) no dia e outro em 1, 7, 15 ou 30 dias. A API só liga, desliga, troca canal e prazo (`GET /v3/customers/{id}/notifications`, `PUT /v3/notifications/batch`); contato e `notificationDisabled` por `PUT /v3/customers/{id}`.
- Padrão do Asaas: e-mail e SMS em tudo, **ligação** nos dois avisos de vencida, WhatsApp desligado, e **e-mail para a conta da unidade** em "recebida" e "vencida". O riSZon grava todos os canais explicitamente; o padrão do Asaas nunca vale.
- **Cota:** 25.000 requisições **por conta** a cada 12 horas, 50 GET simultâneos por conta e limites próprios em alguns endpoints (429). O saldo da conta sai de `GET /v3/finance/balance`. **Não há aviso (webhook) de falha de envio de notificação.**
- O pagamento traz `transactionReceiptUrl` ("comprovante de confirmação, recebimento, estorno ou remoção"); os avisos de pagamento guardados no treino já o trazem.

### 17.5 Decisões da entrega 3 — a régua (12/11/2026)

Plano aprovado pelo Jeferson em 12/11/2026. Migração **4007**; core 0.439.0, Asaas 0.6.0. Começa já: na produção nenhuma unidade tem conta Asaas até a ASA7, então nada é enviado antes disso.

- **D1. Avisos para a unidade desligados.** Os e-mails e SMS que o Asaas manda para a conta da unidade (`*EnabledForProvider`) ficam desligados em todos os avisos: o riSZon já avisa (baixa automática, resumo diário, Painel de cobranças).
- **D2. Uma régua só, da rede.** Admin Master e Financeiro da Franqueadora definem os avisos, prazos e canais uma vez, na aba Cobrança e comunicação da Rede. A unidade só **liga ou desliga**. Régua por unidade fica para quando alguém pedir.
- **D3. Ao ligar numa unidade**, as cobranças já abertas passam a receber os **próximos** lembretes; "cobrança criada" não é reenviada. A tela avisa antes de confirmar.
- **D4. E-mail do responsável financeiro:** campo opcional no cadastro do responsável. Responsável que também é cliente usa o e-mail da ficha dele quando o campo estiver vazio.
- **D5. "Não receber avisos de cobrança" vale para o CPF na rede toda**, em todas as contas Asaas em que ele for pagador. Registra quem, quando e o motivo.
- **D6. Conta desativada** (`gateway_accounts.status = 'disabled'`) apaga e-mail e celular dos pagadores dela no Asaas; a forma de apagar é provada no sandbox antes.
- **D7. Quem desliga e quem religa os avisos de um pagador:** **desligar** — Recepcionista, Gerente de Unidade, Financeiro da Franqueadora e Admin Master, com motivo; **religar** — só Gerente, Financeiro e Admin.
- **D9. O lembrete do dia é fixo** (aprovado pelo Jeferson em 12/11/2026). Medido no sandbox: o Asaas aceita no 1º lembrete 5, 10, 15 ou 30 dias antes; o **2º lembrete só no dia do vencimento**; a vencida do dia só no dia; o 2º aviso de vencida 1, 7, 15 ou 30 dias depois. A documentação dava 0/5/10/15/30 para os dois lembretes. A tela mostra o 2º lembrete como "no dia", sem escolha.
- **Canal só com o contato** (medido no sandbox): o Asaas recusa ligar o e-mail de um pagador sem e-mail. E-mail só vai ligado com e-mail; SMS, WhatsApp e ligação só com celular. Quando o contato chega na ficha, o pagador volta à fila.
- **D10. Trava fora da produção** (pedido do Jeferson, 12/11/2026). O sandbox envia e-mail e SMS de verdade e o treino tem pacientes com contato que pode ser de gente real. Em toda conta que não é de produção, o servidor só manda ao Asaas o e-mail e o celular da **lista de permitidos** (variável `ASAAS_SANDBOX_CONTATOS_PERMITIDOS`, só no servidor, separados por vírgula), que **começa vazia**. Pagador sem contato permitido fica com os avisos **desligados** no Asaas (`notificationDisabled: true`), mesmo com a régua da unidade ligada. A trava é de código (`travaForaDaProducao`), não depende dos dados do treino. Para o envio real de teste, o Jeferson inclui o próprio e-mail e celular.
- **D8. Padrão inicial da régua da rede:** e-mail e SMS ligados em todos os avisos; WhatsApp só no primeiro aviso de vencida (o do dia); ligação desligada em tudo. A régua nasce assim, mas **nenhuma unidade nasce ligada** (16.8).

**Custo na tela (ajuste 1).** Dois blocos separados, com os preços lidos da conta **da unidade** (`GET /myAccount/fees`, `notification`):

- **E-mail e SMS (mensageria):** preço × cobranças **pagas** estimadas (as pagas da unidade nos últimos 30 dias), **uma vez por cobrança**, se houver qualquer aviso por e-mail ou SMS ligado. Explicação: "cobrada uma vez por cobrança, só quando ela é paga".
- **WhatsApp e ligação:** preço por disparo × avisos ligados naquele canal × cobranças emitidas nos últimos 30 dias, **paga ou não**. Explicação: "cobrado a cada envio".

**WhatsApp sem trava (ajuste 2).** O canal fica disponível. A tela informa que a mensagem sai de um número do Asaas, que respostas não chegam à clínica e que o envio depende de saldo na conta Asaas da unidade. A unidade com WhatsApp ligado e **saldo zero** (lido de `GET /v3/finance/balance` na rotina diária das contas) ganha alerta na aba e aviso ao Gerente e ao Admin. O Asaas **não avisa falha de envio**: isso não aparece.

**Comprovante próprio (ajuste 4), na 4007.** A cobrança paga ganha o link do comprovante do Asaas (`transactionReceiptUrl`, gravado pelo aviso de pagamento e preenchido nas antigas pelos avisos guardados). Na ficha, a cobrança paga mostra **"Ver comprovante"** e **"Enviar comprovante pelo WhatsApp"** (abre o WhatsApp com a mensagem pronta para o telefone do pagador). Vale com a régua desligada e para quem pediu para não receber avisos — é a clínica quem envia.

**Aplicação em segundo plano.** Fila de pagadores processada por uma rotina a cada 10 minutos: até 50 pagadores por conta por vez, 3 chamadas cada (contato, leitura dos avisos, gravação). Pior caso: 50 × 3 × 6 × 12 = **10.800 chamadas a cada 12 horas por conta**, menos da metade da cota de 25.000; as outras rotinas (contas, emissão) somam poucas dezenas. Ao receber 429, a rotina para aquela conta até a próxima volta. Entram na fila: a unidade ligada ou desligada, a régua alterada, e-mail ou telefone alterados na ficha ou no responsável, o pedido de não receber avisos e a conta desativada. Pagador novo nasce já com a régua se a unidade estiver ligada.

**Celular:** só vai ao Asaas o número com DDD + 9 + 8 dígitos (11 dígitos, o terceiro é 9). A tela mostra quantos pagadores estão sem e-mail, sem celular ou com os avisos desligados.

**Provas.** Ensaio no treino em transação desfeita; testes das contas puras; sandbox **sem envio** (pagador sem e-mail nem celular): ler os 8 avisos, gravar e conferir, ligar e desligar `notificationDisabled`, apagar o contato (D6). Envio real só com aprovação do Jeferson na hora.

**Para a ASA3 (pedido do Jeferson):** verificar no sandbox se a mensageria reduz o `netValue` da cobrança (e portanto a base do split percentual) ou é debitada à parte, com uma cobrança paga com aviso por e-mail ligado para o contato do Jeferson, com a aprovação dele na hora. Se não ficar claro, o Jeferson pergunta ao Asaas.

**Prova de envio real (13/11/2026):** na emissão, a régua foi aplicada antes da cobrança (contato, leitura dos avisos e gravação da régua, depois `POST /payments`), e o Jeferson recebeu por e-mail e SMS os avisos de "cobrança criada" e de "pagamento recebido". Os outros pagadores de Londrina, sem contato na lista de permitidos, não receberam nada.

**Conferido no sandbox (13/11/2026, com a aprovação do Jeferson na hora):** cobrança Pix de R$ 8,00 do LDN-00068, com a régua aplicada (contato do Jeferson, e-mail e SMS ligados) antes da emissão, paga pela simulação do sandbox (`POST /v3/sandbox/payment/{id}/confirm`). O `netValue` veio R$ 7,01: só a taxa do Pix (R$ 0,99), igual às cobranças de teste com os avisos desligados. O extrato da conta (`GET /v3/financialTransactions`) tem só duas linhas para a cobrança ("Cobrança recebida" R$ 8,00 e "Taxa do Pix" −R$ 0,99): **nenhum débito de mensageria**, nem no `netValue` nem à parte. **Inconclusivo para a produção:** o sandbox pode não cobrar a mensageria. Antes do split da ASA3, o Jeferson pergunta ao Asaas se, na produção, a mensageria sai do `netValue` da cobrança (e entra na base do split) ou é debitada à parte no extrato.

---

## 18. Decisões da ASA3 — Split (13/11/2026)

Plano aprovado pelo Jeferson em 13/11/2026, em **três entregas**: (1) o split na emissão; (2) as cobranças em aberto (fila de atualização, divergência, estorno, bloqueio); (3) o Painel de repasses (recebido com split × por fora, dispensas, repasses a receber). O teste real com valores mínimos fica para antes do piloto, com a aprovação do Jeferson.

### 18.1 O que se mediu antes

- **Taxas da franquia na produção (13/11/2026):** royalty 6%, fundo de propaganda 2%, centro de planejamento 3%, comercial 6% (**17%** sobre cada real recebido); sistema e suporte R$ 250,00 e SDR R$ 550,00 por mês. Londrina e Cambé seguem a rede. Nenhuma campanha.
- **Tarifas do Asaas por conta** (`acquirer_rates`, com vigência): Pix e boleto R$ 0,99 até 10/02/2027 e R$ 1,99 depois (uma conta de teste já sem promoção); cartão à vista 2,99% + R$ 0,49 (promoção 1,99% + R$ 0,49).
- **Documentação do Asaas:** o split incide sobre o `netValue`; a carteira da própria conta emissora não entra; o split de cobrança em aberto muda por `PUT /v3/payments/{id}` reenviando `splits` (lista vazia **desliga** o split); split acima do líquido bloqueia a cobrança por 2 dias úteis e depois é cancelado; avisos `PAYMENT_SPLIT_DONE`, `PAYMENT_SPLIT_DIVERGENCE_BLOCK` e `PAYMENT_SPLIT_DIVERGENCE_BLOCK_FINISHED`.

### 18.2 A conta da compensação (S1, S2 e ajuste 1)

Para cada carteira com percentual **p** e tarifa **T = a × V + b** (a = parte percentual, b = parte fixa):

- `percentualValue` = **q = p ÷ (1 − a)**, arredondado **para baixo** em 4 casas;
- `fixedValue` = **F = q × b**, arredondado **para baixo** no centavo.

O Asaas transfere F + q × (V − aV − b) = p × V: **exato para qualquer valor pago**, com desconto ou com multa. Com tarifa fixa (Pix, boleto), a = 0 e a conta vira a da S1 (q = p, F = p × tarifa). **Boleto (S2):** usa a menor tarifa entre código de barras e QR Code Pix. **Tarifa percentual com mínimo e máximo:** a e b da faixa do menor valor possível.

Comparação no cartão (17%, uma ou duas carteiras; método A = percentual p e F pela tarifa do menor valor; método B = o adotado acima, a escolher pelo Jeferson):

| Parcela | Cenário | Diferença A | Diferença B |
|---|---|---|---|
| R$ 500 | no prazo | R$ 0,09 a 0,14 | R$ 0,01 a 0,02 |
| R$ 500 | multa 2% + juros 1% (30 dias) | R$ 0,14 a 0,21 | R$ 0,01 a 0,02 |
| R$ 5.000 | no prazo | R$ 0,85 a 1,28 | R$ 0,01 a 0,02 |
| R$ 5.000 | multa 2% + juros 1% (30 dias) | R$ 1,36 a 2,04 | R$ 0,01 a 0,02 |

As diferenças são sempre **a favor da unidade** (o repasse nunca passa do percentual). No método B o erro é de até **2 centavos por carteira**: até 1 pelo F arredondado para baixo e, em parcelas grandes (a partir de uns R$ 5.000), mais 1 pelo corte do percentual em 4 casas (0,0001% × líquido). O do método A cresce com o valor e passa da tolerância da S5. **Escolhido: método B** (Jeferson, 13/11/2026), uma fórmula só para Pix, boleto e cartão. **Proteção:** se houver mais de uma tarifa vigente entre a emissão e o vencimento (início ou fim de promoção), vale a menor parte percentual e a menor parte fixa; a fila da entrega 2 corrige quando a tarifa muda.

**Promoção com a cobrança em aberto (testes, 14,72% + 1,83%, Pix de R$ 500,00):** emitida na promoção (R$ 0,99) e paga depois do fim (R$ 1,99): repasse R$ 0,16 e R$ 0,03 abaixo do devido, a favor da unidade. O inverso (cheia na emissão, promoção começando antes do vencimento): pago na cheia, os mesmos R$ 0,16 e R$ 0,03 a favor da unidade; pago na promoção, até 1 centavo.

### 18.3 Decisões

- **S1.** F = percentual × tarifa, arredondado para baixo no centavo (generalizado em 18.2).
- **S2.** Boleto: a menor tarifa entre código de barras e QR Code Pix.
- **S3.** Mensageria **fora** do F até a resposta do Asaas (o Jeferson envia a pergunta em 13/11/2026).
- **S4. Não existe desconto de pontualidade nas taxas da franquia.** O split retém o **percentual cheio**. O recebimento fora do split vira conta a pagar de taxa e entra na cobrança mensal da franqueadora à unidade (ASA6): paga em dia, valor cheio; em atraso, com multa e juros. A **multa e os juros da cobrança à unidade** ficam configuráveis na aba Taxas da franquia, **no nível da rede**; os percentuais são do Jeferson, conforme o contrato de franquia.
  - **Hoje (13/11/2026):** o desconto de pontualidade está em `network_fees.punctuality_discount_percent` (rede e exceção da unidade), aplicado só no pagamento da conta a pagar até o vencimento (`payable_punctuality_discount`, 0235). Na produção, está **zerado** em todas as taxas (rede, Londrina e Cambé). As contas a pagar de taxa **não têm multa nem juros calculados**: só os campos para informar à mão o que foi pago (`paid_fee_cents`, `paid_interest_cents`, conta 4.2.01).
- **S5.** Diferença **a menor** de até **R$ 0,10 por cobrança** é absorvida, sem conta a pagar; acima disso, vira conta a pagar da unidade. O limite é configuração da rede. Repasse **a maior** vira divergência para o Financeiro da Franqueadora. **O valor que vale é o liquidado no aviso `PAYMENT_SPLIT_DONE`**: o riSZon grava e compara com o esperado (ajuste 2).
- **S6.** Só emite com split a unidade com o split habilitado declarado e a conta pronta; sem isso, a cobrança sai como hoje. O primeiro split aceito confirma o "split habilitado" na prontidão. A franqueadora não faz split para si mesma.
- **S7.** As quatro taxas percentuais vão para a carteira da conta raiz; o fundo de propaganda tem carteira configurável (D6), começando na raiz; RisLife na ASA5.
- **S8.** Data prevista dos "Repasses a receber": a data prevista de liquidação da cobrança de origem, conferida no sandbox.

### 18.3.1 A taxa retida já nasce paga (pedido do Jeferson, 13/11/2026)

A baixa de uma cobrança com split nasce com a taxa **retida** (`_split_charge_born_retained`, pela referência "Asaas <id>" da baixa): a conta a pagar de taxa do mês **nem é criada** quando tudo foi retido. Antes ela nascia e era cancelada logo depois ("sem valor apurado no mês"), dando a impressão de que o custo não existia. O apurado do mês (`network_fee_summary.retained_cents`) mostra **"pago no split"** em cada taxa; o custo está no razão (despesa da unidade, liquidada) e no resultado.

### 18.4 Entre a entrega 1 e a 2

Enquanto a fila de atualização não existir, uma mudança de taxa (percentual, campanha ou tarifa do Asaas) com cobrança em aberto **não muda o split já enviado**: a diferença cai na S5 (a menor, conta a pagar acima de R$ 0,10; a maior, divergência). O manual diz isso.

### 18.5 Prova

Percentuais de exemplo **diferentes por taxa e não redondos** (para pegar erro de rateio e de arredondamento), com um caso de **duas carteiras** (o fundo de propaganda com carteira própria). Sandbox: os três meios, o formato da entrada e o arredondamento do Asaas.

### 18.5.1 Prova no sandbox (13/11/2026, aprovada pelo Jeferson)

**Parte 1 — formato e arredondamento, direto na API** (`scripts/asaas-prova-split-sandbox.mjs`). Conta de teste de Londrina; pagador sem e-mail e sem celular, avisos desligados (nada enviado); split para a franqueadora (14,72%) e para a conta de teste **"Fundo de Propaganda Teste"** (1,83%). ⚠️ O caso de duas carteiras **só prova que o split funciona com o fundo em carteira própria, no futuro**: hoje o fundo vai para a franqueadora (D6), e a RisLife nunca é destino de taxa de paciente (D7). Pix e boleto pagos pela simulação do sandbox; cartão pela API com o cartão de teste publicado pelo Asaas. Antes, o Jeferson habilitou o split na conta principal do sandbox (sem isso o Asaas recusa a cobrança com split).

| Meio | Pago | Tarifa | Carteira | Enviado | Devido | Liquidado | Diferença |
|---|---|---|---|---|---|---|---|
| Pix | 8,17 | 0,99 | franqueadora | 14,72% + 0,14 | 1,20 | 1,19 | 0,01 |
| Pix | 8,17 | 0,99 | fundo (própria) | 1,83% + 0,01 | 0,15 | 0,14 | 0,01 |
| Pix | 500,00 | 0,99 | franqueadora | 14,72% + 0,14 | 73,60 | 73,59 | 0,01 |
| Pix | 500,00 | 0,99 | fundo (própria) | 1,83% + 0,01 | 9,15 | 9,14 | 0,01 |
| Pix | 1.234,56 | 0,99 | franqueadora | 14,72% + 0,14 | 181,73 | 181,72 | 0,01 |
| Pix | 1.234,56 | 0,99 | fundo (própria) | 1,83% + 0,01 | 22,59 | 22,58 | 0,01 |
| Boleto | 500,00 | 0,99 | franqueadora | 14,72% + 0,14 | 73,60 | 73,59 | 0,01 |
| Boleto | 500,00 | 0,99 | fundo (própria) | 1,83% + 0,01 | 9,15 | 9,14 | 0,01 |
| Boleto | 987,65 | 0,99 | franqueadora | 14,72% + 0,14 | 145,38 | 145,37 | 0,01 |
| Boleto | 987,65 | 0,99 | fundo (própria) | 1,83% + 0,01 | 18,07 | 18,06 | 0,01 |
| Cartão | 500,00 | 10,44 | franqueadora | 15,0188% + 0,07 | 73,60 | 73,59 | 0,01 |
| Cartão | 500,00 | 10,44 | fundo (própria) | 1,8671% + 0,00 | 9,15 | 9,14 | 0,01 |
| Cartão | 1.234,56 | 25,05 | franqueadora | 15,0188% + 0,07 | 181,73 | 181,72 | 0,01 |
| Cartão | 1.234,56 | 25,05 | fundo (própria) | 1,8671% + 0,00 | 22,59 | 22,58 | 0,01 |

- **Formato confirmado:** uma entrada por carteira com `percentualValue` e `fixedValue` juntos; o Asaas aceitou nos três meios.
- **Arredondamento do Asaas: PARA BAIXO** (trunca o percentual × líquido no centavo). Nos casos que distinguem os dois modos: 1,19690 → 1,19; 145,37635 → 145,37; 18,06588 → 18,06; 73,59604 → 73,59. A conta simulada do riSZon (`repasseSimulado`) passou a truncar também.
- **Resultado:** o repasse **nunca passou do devido**; a diferença foi de **1 centavo por carteira** em todos os casos (o truncamento do Asaas somado ao F para baixo), dentro da tolerância de R$ 0,10.
- **Cartão:** o split fica `AWAITING_CREDIT`/`PENDING` até a liquidação do cartão (cerca de 32 dias); o valor já vem calculado na cobrança.

**Parte 2 — de ponta a ponta no projeto de teste.** Taxas do treino iguais às da produção (royalty 6%, fundo 2%, planejamento 3%, comercial 6%; as quatro para a carteira da franqueadora; ficaram assim). Cobrança Pix de R$ 6,00 do LDN-00069 (responsável financeiro sem e-mail e sem telefone), emitida pelo caminho do servidor com a sessão da Recepcionista de teste e paga pela simulação do sandbox:
- **Split gravado:** uma carteira (franqueadora), 17% + R$ 0,16, com o id do Asaas; "split habilitado" de Londrina confirmado sozinho.
- **Avisos:** `PAYMENT_SPLIT_DONE` chegou **antes** do `PAYMENT_RECEIVED` e os dois foram processados sem erro (`split_liquidado`, `baixa`).
- **Liquidado R$ 1,01 × devido R$ 1,02** (17% de R$ 5,01 = 0,8517 → 0,85 + 0,16): 1 centavo, absorvido (S5).
- **Retido na origem:** as 4 taxas (R$ 0,36 + 0,12 + 0,18 + 0,36) retidas inteiras; as contas a pagar de taxa do mês ficaram **sem valor** — nada em dobro.
- **Razão:** 8 lançamentos liquidados — despesa da unidade (2.6.01 a 2.6.04) e receita da franqueadora (1.3.01, 1.3.03, 1.3.05, 1.3.06).

### 18.6 Pendências com o Asaas que afetam a ASA3

- [ ] Mensageria no `netValue` (produção) — perguntado pelo Jeferson em 13/11/2026.
- [ ] Cartão de débito na fatura de cobrança `CREDIT_CARD` (se aceitar, a tarifa do débito entra como a menor).
- [x] Arredondamento do `percentualValue` × `netValue` — **para baixo** (medido no sandbox em 13/11/2026, 18.5.1).
- [ ] Split em chargeback (gerente de contas).

### 18.7 Entrega 2 — as cobranças em aberto (plano aprovado em 13/11/2026; migração 4009)

**Escopo:** (1) a **fila** que atualiza o split das cobranças em aberto quando a taxa do dia muda; (2) **estorno** total com split e **bloqueio** por divergência; (3) a **visão da unidade** na aba Taxas da franquia (D19) e o fim da tela antiga.

**Decisões (U1–U9, aprovadas como propostas, com os ajustes do Jeferson):**
- **U1. Gatilhos:** padrão da rede ou acordo da unidade (percentual, ligada/desligada); campanha criada, alterada ou apagada; destino da taxa; tarifa nova do Asaas (inclusive o fim da promoção em 10/02/2027); rodada diária. Mudança que não altera a conta **não** chama o Asaas.
- **U2. Rodada diária às 00:05 (Brasília).** Pagamento entre 00:00 e o fim da rodada, no dia da mudança, cai na S5.
- **U3.** Cobrança emitida sem split que passou a poder ter: a fila **acrescenta** o split.
- **U4. Nunca tirar o split automaticamente** (a lista vazia desliga tudo); aviso ao Financeiro. Taxa que vai a zero sai do split, as outras ficam. **Exceção (ajuste 3):** se **todas** as taxas da unidade forem a zero **por decisão registrada** (isenção ou campanha), o riSZon pode enviar a lista vazia **com confirmação do Financeiro ou do Admin e registro na auditoria**. Em qualquer outro caso, nunca.
- **U5.** Cartão confirmado fora da janela do Asaas (até 1 dia útil antes do crédito, sem antecipação): sai da fila; a diferença cai na S5.
- **U6. Estorno total com split (D13):** o retido já liquidado é estornado no razão (a unidade recebe de volta, a franqueadora devolve) e a taxa volta a ser devida na conta a pagar; a dispensa manual (16.5) continua. **Ajuste 4:** verificar na documentação e no sandbox o que acontece quando a carteira que recebeu o split não tem saldo para devolver; se o estorno falhar ou ficar pendente, o riSZon avisa o Financeiro. Estorno parcial e chargeback continuam à mão.
- **U7. Bloqueio por divergência:** o riSZon refaz o split para caber no líquido real e reenvia dentro dos 2 dias úteis; avisa se falhar. **Ajuste 5:** a diferença em relação ao devido segue a S5 (acima da tolerância, conta a pagar da unidade).
- **U8. "Atualizar agora"** na aba Taxas da franquia (Admin e Financeiro): roda a fila da unidade na hora. **Ajuste 6:** cada uso vai para a auditoria (quem, quando, unidade, quantas cobranças mudaram).
- **U9.** Visão da unidade na Central: Gerente e Franqueado só leem; a tela antiga sai.

**Ajustes:**
1. **Atualizar o split sem efeito para o pagador:** provar no sandbox que o `PUT /payments/{id}` só com o split não dispara o aviso "cobrança alterada" da régua, não muda o link da fatura, a linha digitável nem o Pix copia e cola, e não reinicia o registro do boleto. Se disparar ou mudar, **parar e apresentar a alternativa antes de construir a fila**.
2. **Ordem da fila:** primeiro as já vencidas e as de vencimento mais próximo. Estimar o tempo da fila no fim da promoção (10/02/2027) com o volume de uma unidade cheia.
7. **Histórico por cobrança:** na ficha, a cobrança mostra quando o split foi atualizado e por qual motivo (taxa, campanha, destino ou tarifa).

**Mantido:** fila a cada 10 minutos com até 50 cobranças por conta, parando no limite de chamadas.

**Prova do ajuste 1 (13/11/2026, sandbox):** `PUT /payments/{id}` só com o split, em Pix e boleto: link da fatura, PDF do boleto, nosso número, linha digitável, Pix copia e cola, vencimento e valor **iguais**, e **nenhum** `PAYMENT_UPDATED` (de onde nasce o aviso "cobrança alterada"); o boleto não foi registrado de novo. Controle (só o vencimento): veio `PAYMENT_UPDATED` e a linha digitável mudou. **Aprovado pelo Jeferson: a fila segue como planejada.** (`scripts/asaas-prova-split-put-sandbox.mjs --put`)

**Achado do ajuste 4 (13/11/2026, sandbox):** o estorno pedido pela API fica **`AWAITING_CRITICAL_ACTION_AUTHORIZATION`** até alguém da conta autorizar com o código (SMS). Por isso:

#### 18.7.1 O estorno nasce no riSZon (decisão do Jeferson, 13/11/2026)

1. Na ficha do paciente, a pessoa autorizada pede o **estorno total** de uma cobrança paga, com **motivo obrigatório**.
2. O riSZon envia o pedido ao Asaas pela API. A cobrança fica **"Estorno aguardando autorização"**, com a orientação de autorizar no Asaas (e o link para o lugar certo do painel, se houver).
3. A pessoa autoriza no Asaas com o código que recebe.
4. Com o aviso de estorno concluído, o riSZon aplica a **U6**: estorna a baixa e o retido no razão; a taxa volta a ser devida pela unidade (D13), com a dispensa manual do Financeiro e do Admin.

- **O riSZon nunca pede, recebe nem guarda o código de autorização.** A tela diz isso.
- **Permissão nova "Pedir estorno":** nasce com o Admin Master. Na Central, a unidade indica quem tem o acesso de autorização do Asaas — por padrão o **Franqueado**; o Admin Master pode liberar para o **Gerente** da unidade. Só essas pessoas veem o botão.
- Estorno **aguardando autorização há mais de 1 dia útil**: aviso a quem pediu e ao Financeiro da Franqueadora. Quem pediu pode **cancelar o pedido** enquanto pendente, se o Asaas permitir.
- Estorno **recusado ou com falha** (ex.: saldo insuficiente): a cobrança volta para "Paga"; aviso a quem pediu e ao Financeiro.
- Estorno feito **direto no painel do Asaas** continua tratado pelos avisos, como hoje. Estorno parcial e chargeback continuam à mão.
- **Auditoria:** pedido, autor, motivo e resultado.
- **A verificar (documentação e sandbox):** onde o titular autoriza a ação crítica (painel, aplicativo); se o pedido pendente pode ser cancelado pela API; o estorno de boleto (dados bancários do pagador) e de cartão confirmado; os avisos do Asaas em cada etapa. **Prova:** duas cobranças pela conta principal do sandbox (split para a carteira de Londrina, com saldo; e para a do Fundo de teste, sem saldo); o Jeferson autoriza no painel — **o código nunca passa pelo riSZon nem pela sessão**.

#### 18.7.2 Ritmo da fila (decisão do Jeferson, 13/11/2026)

- **150 cobranças por rodada** (10 min), parando no limite de chamadas; **as vencidas e as de vencimento mais próximo primeiro**. Estimativa: unidade com ~3.600 cobranças em aberto (300 contratos × 12 parcelas) → ~4 h no fim da promoção (10/02/2027), usando menos da metade da cota do Asaas.
- **Diferença causada por mudança de TARIFA do Asaas**, em cobrança paga enquanto ainda estava na fila aguardando atualização, é **absorvida** (sem conta a pagar). Vale **só para tarifa**; mudança de taxa da rede ou de campanha continua na S5.
- A tela mostra o **andamento da fila por unidade**: quantas faltam e a previsão de término.

#### 18.7.3 Prova do estorno com split (13/11/2026, sandbox, autorizado pelo Jeferson no painel)

Conta principal do sandbox, duas cobranças Pix de R$ 20,00 pagas e estornadas por inteiro (`scripts/asaas-prova-estorno-raiz-sandbox.mjs`):

| Caso | Split | Estorno | Split depois | Carteira que recebeu o split |
|---|---|---|---|---|
| E1 | 14,72% para Londrina (com saldo) | `DONE` | `REFUNDED` (R$ 2,79) | devolveu R$ 2,79 (2.739,44 → 2.736,65) |
| E2 | 1,83% para o Fundo de teste (**sem saldo**) | `DONE` | `REFUNDED` (R$ 0,33) | **ficou negativa: −R$ 0,33** |

- **Carteira recebedora sem saldo:** o estorno **não falha nem fica pendente**; o Asaas debita a carteira mesmo assim e ela **fica negativa**. Na rede, a carteira é a da franqueadora (conta raiz).
- **Avisos:** `PAYMENT_REFUNDED` (o Pix foi direto, sem `PAYMENT_REFUND_IN_PROGRESS`); **nenhum** `PAYMENT_SPLIT_CANCELLED` — o split aparece como `REFUNDED` dentro da cobrança.
- **Antes da autorização:** o pedido fica `AWAITING_CRITICAL_ACTION_AUTHORIZATION` e a cobrança continua `RECEIVED`. A autorização é pelo token SMS ou do aplicativo do Asaas.
- **Cancelar pedido pendente pela API: não existe** na documentação (o cancelamento aparece no extrato como `REFUND_REQUEST_CANCELLED`, sem aviso pelo webhook).
- **Boleto:** rota própria (`POST /payments/{id}/bankSlip/refund`) que devolve um link (`requestUrl`) para o **pagador** informar os dados bancários e enviar documentos; pode ser **negado** (`PAYMENT_REFUND_DENIED`, ainda não assinado pelo riSZon).
- **Cartão:** estornável confirmado ou recebido; até 10 dias úteis na fatura do pagador.

#### 18.7.4 Estorno — decisões finais (Jeferson, 13/11/2026)

1. **Saldo negativo:** depois de cada estorno com split, o riSZon confere o saldo da conta que recebeu e avisa o Financeiro da Franqueadora se ficou negativo; a rotina diária também confere. **Aviso preventivo:** saldo da conta da franqueadora abaixo de um **mínimo configurável na rede** avisa o Financeiro — nasce em branco (sem aviso) até o Jeferson definir. **Pendência com o Asaas:** o que acontece com conta de saldo negativo na produção (tarifa, bloqueio ou prazo para cobrir).
2. **Pedido pendente:** sem botão de cancelar (o Asaas não cancela pela API); a tela orienta a cancelar no painel do Asaas ou a não autorizar. A rotina diária consulta os pedidos pendentes: cancelado → a cobrança volta para "Paga" e avisa quem pediu; pendente há mais de 1 dia útil → o aviso de 18.7.1.
3. **Boleto:** o pedido mostra o link do Asaas com "Copiar link" e "Enviar pelo WhatsApp"; a cobrança fica **"Estorno aguardando o pagador"**; negado (`PAYMENT_REFUND_DENIED`) → volta para "Paga" e avisa quem pediu e o Financeiro. A tela explica que o pagador informa os dados bancários direto no Asaas e que o riSZon não recebe esses dados. O pagador é o **responsável financeiro**, quando houver.
4. **Pix e cartão:** pedido no riSZon, autorização no Asaas pelo titular, U6 com o aviso de concluído. O riSZon nunca pede o código.

#### 18.7.5 Webhook sem recriação manual (Jeferson, 13/11/2026)

- A verificação de cada conta compara os avisos assinados no Asaas com a lista que o riSZon espera e **corrige sozinha, pela API**.
- A mesma correção roda **logo depois de cada entrega** que muda a lista (a rotina de 10 minutos confere a versão da lista).
- Webhook desatualizado **derruba a prontidão** da unidade até ser corrigido, e a Central mostra o motivo.
- O botão manual "Criar o webhook" continua, como recurso.

#### 18.7.6 Prova da entrega 2 no sandbox (13/11/2026, código real do servidor)

- **Webhook que se corrige sozinho:** a rotina conferiu as 4 contas de teste com webhook e corrigiu a lista pela API (versão 2, com `PAYMENT_REFUND_DENIED`); o webhook de Londrina passou a ouvir o estorno negado. Sem clique de ninguém.
- **A fila:** cobrança de boleto do LDN-00066 emitida pelo caminho da tela (17% + R$ 0,16). Royalty do treino de 6% → 6,5%: a cobrança entrou na fila (motivo taxa); a rodada mudou o split no Asaas para **17,5% + R$ 0,17**; de volta a 6%, voltou para 17% + R$ 0,16. Link da fatura, nosso número, vencimento e valor **iguais**; nenhum `PAYMENT_UPDATED`; o histórico da cobrança registrou as duas atualizações. A mesma rodada **acrescentou o split (U3)** às 3 cobranças de teste de Londrina emitidas antes do split habilitado.
- **Estorno de boleto: LACUNA.** O Asaas recusou: *"Não é possível efetuar o estorno pois o seu cliente não possui um celular válido."* O estorno de boleto exige o **celular do pagador cadastrado no Asaas** (o riSZon cria o pagador só com nome e CPF; o celular só vai pela régua). **Parado para decisão do Jeferson** antes de adaptar.

#### 18.7.7 Estorno de boleto com o celular do pagador (Jeferson, 13/11/2026)

1. No pedido de estorno de boleto, o riSZon envia ao Asaas o **celular do pagador** que está na ficha (o responsável financeiro, quando houver). A tela mostra, antes de confirmar, **qual número** será enviado e avisa que o Asaas vai mandar um **SMS** com o link.
2. Sem celular válido na ficha, o botão fica desabilitado e explica que é preciso cadastrar antes.
3. Enviar o celular **não liga avisos**: os avisos do pagador ficam como estavam (`notificationDisabled` mantido). **Prova no sandbox com o celular do Jeferson, com a aprovação dele na hora.**
4. **Limpeza:** com a régua da unidade **desligada**, o celular é apagado no Asaas (`mobilePhone: ""`, o método da D6) quando o estorno é concluído, negado ou cancelado; com a régua ligada, fica.
5. Exige a **declaração do termo de privacidade** (a da régua). Sem ela, o estorno de boleto não sai pelo riSZon e a tela orienta a fazer no painel do Asaas.
6. No sandbox vale a **lista de permitidos** (D10).
7. **Auditoria:** celular enviado (por quem, quando) e apagado — **sem o número**.
8. O manual (13g.7) explica o passo a passo e o que o pagador recebe.

**Correção da 4008 dentro da 4009 (13/11/2026):** o razão da taxa retida lançava a receita numa "franqueadora qualquer" (com mais de uma clínica do tipo franqueadora, a conta bancária não batia e o aviso de split dava erro); e uma carteira recebedora **sem clínica** (o fundo com conta própria) fazia o razão recusar. Agora a receita vai para a clínica dona da conta que recebeu o split (sem clínica: a da conta raiz). Na produção ainda não há cobrança com split, então nada foi afetado.

**Prova do estorno de boleto (13/11/2026, celular do Jeferson, aprovada na hora):** o riSZon enviou o celular ao Asaas (`PUT /customers`, aceito; avisos do pagador continuaram **desligados**; nenhuma mensagem chegou ao Jeferson). O Asaas então recusou o estorno por OUTRO dado: *"Não é possível efetuar o estorno pois o seu cliente não possui um e-mail válido."* **O estorno de boleto exige celular E e-mail do pagador no Asaas.** **Decisão do Jeferson (13/11/2026): o e-mail vai junto, com as mesmas regras do celular** (mostrado antes de confirmar; sem e-mail válido, o botão diz o que falta; avisos como estavam; apagado no fim com a régua desligada; termo; lista de permitidos; auditoria sem o endereço). **E em todo erro o motivo aparece na tela** (o riSZon passa a mostrar a descrição do Asaas nos dados recusados — só na tela, nunca no registro). (A primeira tentativa foi feita no riSZon Treino, que roda a versão publicada, sem o botão; os dados gravados lá valeram porque o banco é o mesmo.)

**Prova do estorno de boleto concluída (13/11/2026, 19:25, com o celular e o e-mail do Jeferson, aprovada na hora):** boleto de R$ 6,00 do LDN-00066 (pagador: o responsável financeiro, com "Não receber avisos" ativo). O riSZon enviou celular e e-mail ao Asaas mantendo os avisos **desligados**; o Asaas aceitou o estorno (`AWAITING_CUSTOMER_EXTERNAL_AUTHORIZATION`) e devolveu o link; a ficha mostra "Estorno aguardando o pagador" com "Copiar link" e "Enviar pelo WhatsApp". O Jeferson recebeu **o link por e-mail** (nenhum SMS, nenhum aviso de cobrança). Auditoria sem os dados. Régua de Londrina ligada: o contato fica no Asaas (regra 4). **Cartão (R$ 7,00, mesmo paciente):** o estorno foi concluído na hora no sandbox, **sem pedir autorização do titular** (o Pix ficou aguardando o código); o riSZon desfez a baixa e marcou a cobrança como estornada.

**Achado (13/11/2026):** o "Estornar baixa" manual do riSZon desfaz a baixa de uma parcela **paga pelo Asaas** só no riSZon — no Asaas o pagamento continua recebido. A parcela fica "Em aberto" e "Paga pelo Asaas" ao mesmo tempo, com "Gerar cobrança no Asaas" de novo (risco de cobrar duas vezes). Levado ao Jeferson para decisão.
